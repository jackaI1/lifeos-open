"""Small organization billing service. Amounts are integer US cents."""
import calendar
import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import RLock
from urllib.parse import urlsplit

ROLES = {'owner': {'read', 'usage', 'manage', 'owner'}, 'admin': {'read', 'usage', 'manage'},
         'developer': {'read', 'usage'}, 'viewer': {'read'}}
PLANS = {'free': 0, 'pro': 5000}

def now():
    return datetime.now(timezone.utc).isoformat()

def instant(value):
    try:
        d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if d.tzinfo is None: raise ValueError()
        return d.astimezone(timezone.utc)
    except (ValueError, AttributeError, TypeError):
        raise BillingError('timestamp must include a timezone', 400)

def stamp(value): return instant(value).isoformat()
def digest(key): return hashlib.sha256(key.encode()).hexdigest()

class BillingError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message); self.status = status

class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = RLock()
        self.db.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS members (org TEXT REFERENCES orgs(id), name TEXT, role TEXT, key_hash TEXT UNIQUE, PRIMARY KEY(org,name));
        CREATE TABLE IF NOT EXISTS plans (org TEXT REFERENCES orgs(id), plan TEXT, effective TEXT, UNIQUE(org,effective));
        CREATE TABLE IF NOT EXISTS events (org TEXT REFERENCES orgs(id), event_id TEXT, units INTEGER, occurred TEXT, PRIMARY KEY(org,event_id));
        CREATE TABLE IF NOT EXISTS audit (org TEXT, actor TEXT, action TEXT, detail TEXT, at TEXT);
        ''')

    def log(self, org, actor, action, detail):
        self.db.execute('INSERT INTO audit VALUES (?,?,?,?,?)', (org, actor, action, detail, now()))

    def create_org(self, org, owner, key, created=None):
        if not all(isinstance(x, str) and x.strip() for x in (org, owner, key)): raise BillingError('organization, owner and key are required')
        created = stamp(created or now())
        with self.lock, self.db:
            try:
                self.db.execute('INSERT INTO orgs VALUES (?, ?, ?)', (org, 'active', created))
                self.db.execute('INSERT INTO members VALUES (?,?,?,?)', (org, owner, 'owner', digest(key)))
                self.db.execute('INSERT INTO plans VALUES (?,?,?)', (org, 'free', created))
            except sqlite3.IntegrityError: raise BillingError('organization or key already exists', 409)

    def authorize(self, org, key, permission, allow_inactive=False):
        if not isinstance(key, str): raise BillingError('invalid credentials', 401)
        row = self.db.execute('SELECT m.name,m.role,m.key_hash,o.status FROM members m JOIN orgs o ON o.id=m.org WHERE m.org=? AND m.key_hash=?', (org, digest(key))).fetchone()
        if not row or not hmac.compare_digest(row['key_hash'], digest(key)): raise BillingError('invalid credentials', 401)
        if row['status'] != 'active' and not (allow_inactive and row['status'] == 'suspended' and row['role'] == 'owner'): raise BillingError('account is not active', 403)
        if permission not in ROLES[row['role']]: raise BillingError('permission denied', 403)
        return row['name']

    def set_member(self, org, key, name, role, new_key):
        with self.lock, self.db:
            actor = self.authorize(org, key, 'manage')
            if role not in ROLES or not isinstance(name, str) or not name.strip() or not isinstance(new_key, str) or not new_key: raise BillingError('invalid member')
            old = self.db.execute('SELECT role FROM members WHERE org=? AND name=?', (org, name)).fetchone()
            actor_role = self.db.execute('SELECT role FROM members WHERE org=? AND name=?', (org, actor)).fetchone()['role']
            if (role == 'owner' or (old and old['role'] == 'owner')) and actor_role != 'owner': raise BillingError('only owners can change owners', 403)
            if old and old['role'] == 'owner' and role != 'owner' and self.db.execute("SELECT COUNT(*) FROM members WHERE org=? AND role='owner'", (org,)).fetchone()[0] == 1: raise BillingError('organization needs an owner', 409)
            try: self.db.execute('INSERT INTO members VALUES (?,?,?,?) ON CONFLICT(org,name) DO UPDATE SET role=excluded.role,key_hash=excluded.key_hash', (org, name, role, digest(new_key)))
            except sqlite3.IntegrityError: raise BillingError('key already in use', 409)
            self.log(org, actor, 'member_changed', name + ':' + role)

    def change_plan(self, org, key, plan, effective):
        with self.lock, self.db:
            actor = self.authorize(org, key, 'manage')
            if plan not in PLANS: raise BillingError('unknown plan')
            effective = stamp(effective)
            created = self.db.execute('SELECT created FROM orgs WHERE id=?', (org,)).fetchone()[0]
            if effective < created: raise BillingError('plan predates organization')
            try: self.db.execute('INSERT INTO plans VALUES (?,?,?)', (org, plan, effective))
            except sqlite3.IntegrityError: raise BillingError('plan change already exists at that time', 409)
            self.log(org, actor, 'plan_changed', plan + ':' + effective)

    def set_status(self, org, key, status):
        with self.lock, self.db:
            actor = self.authorize(org, key, 'owner', allow_inactive=True)
            if status not in ('active', 'suspended', 'closed'): raise BillingError('invalid status')
            self.db.execute('UPDATE orgs SET status=? WHERE id=?', (status, org))
            self.log(org, actor, 'status_changed', status)

    def record_usage(self, org, key, event_id, units, occurred):
        with self.lock, self.db:
            self.authorize(org, key, 'usage')
            if not isinstance(event_id, str) or not event_id.strip() or type(units) is not int or units <= 0: raise BillingError('event ID and positive integer units required')
            occurred = stamp(occurred)
            created = self.db.execute('SELECT created FROM orgs WHERE id=?', (org,)).fetchone()[0]
            if occurred < created: raise BillingError('event predates organization')
            old = self.db.execute('SELECT units,occurred FROM events WHERE org=? AND event_id=?', (org, event_id)).fetchone()
            if old:
                if (old['units'], old['occurred']) != (units, occurred): raise BillingError('event ID already used with different data', 409)
                return False
            self.db.execute('INSERT INTO events VALUES (?,?,?,?)', (org, event_id, units, occurred))
            return True

    def invoice(self, org, key, period):
        with self.lock:
            self.authorize(org, key, 'read')
            try:
                if len(period) != 7 or period[4] != '-': raise ValueError()
                start = datetime(int(period[:4]), int(period[5:]), 1, tzinfo=timezone.utc)
                end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1, tzinfo=timezone.utc)
            except (ValueError, TypeError): raise BillingError('period must be YYYY-MM')
            a, b = start.isoformat(), end.isoformat()
            units = self.db.execute('SELECT COALESCE(SUM(units),0) FROM events WHERE org=? AND occurred>=? AND occurred<?', (org,a,b)).fetchone()[0]
            plans = self.db.execute('SELECT plan,effective FROM plans WHERE org=? AND effective<? ORDER BY effective', (org,b)).fetchall()
            subscription = Decimal(0)
            for i, p in enumerate(plans):
                left = max(start, instant(p['effective']))
                right = min(end, instant(plans[i+1]['effective'])) if i+1 < len(plans) else end
                if right > left: subscription += Decimal(PLANS[p['plan']]) * Decimal(str((right-left).total_seconds())) / Decimal(str((end-start).total_seconds()))
            subscription_cents = int(subscription.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
            usage_cents = min(units, 100)*1 + max(units-100, 0)*2
            return {'period': period, 'units': units, 'subscription_cents': subscription_cents, 'usage_cents': usage_cents, 'total_cents': subscription_cents + usage_cents}

    def audit(self, org, key):
        with self.lock:
            self.authorize(org, key, 'manage')
            return [dict(x) for x in self.db.execute('SELECT actor,action,detail,at FROM audit WHERE org=? ORDER BY rowid', (org,))]

class Handler(BaseHTTPRequestHandler):
    def handle_request(self):
        try:
            parts = urlsplit(self.path).path.strip('/').split('/')
            if len(parts) != 3 or parts[0] != 'orgs': raise BillingError('not found', 404)
            org, action = parts[1:]; key = self.headers.get('Authorization', '')
            if key.startswith('Bearer '): key = key[7:]
            else: key = ''
            body = {}
            if self.command == 'POST':
                length = int(self.headers.get('Content-Length', '0'))
                if length > 65536: raise BillingError('request too large', 413)
                body = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(body, dict): raise BillingError('JSON object required')
            s = self.server.store
            if self.command == 'POST' and action == 'members': s.set_member(org,key,body['name'],body['role'],body['key']); result = {'ok': True}
            elif self.command == 'POST' and action == 'plans': s.change_plan(org,key,body['plan'],body['effective']); result = {'ok': True}
            elif self.command == 'POST' and action == 'status': s.set_status(org,key,body['status']); result = {'ok': True}
            elif self.command == 'POST' and action == 'usage': result = {'created': s.record_usage(org,key,body['event_id'],body['units'],body['occurred'])}
            elif self.command == 'GET' and action == 'audit': result = s.audit(org,key)
            elif self.command == 'GET' and action == 'invoice':
                from urllib.parse import parse_qs
                result = s.invoice(org,key,parse_qs(urlsplit(self.path).query).get('period',[''])[0])
            else: raise BillingError('not found', 404)
            status = 200
        except BillingError as e: status, result = e.status, {'error': str(e)}
        except (KeyError, ValueError, json.JSONDecodeError): status, result = 400, {'error': 'invalid request'}
        data = json.dumps(result).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    do_GET = handle_request
    do_POST = handle_request

def main():
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('--db', default='billing.sqlite3'); p.add_argument('--port', type=int, default=8000)
    p.add_argument('--init-org'); p.add_argument('--owner', default='owner'); args = p.parse_args()
    store = Store(args.db)
    if args.init_org:
        key = os.environ.get('BILLING_OWNER_KEY')
        if not key: p.error('set BILLING_OWNER_KEY to initialize an organization')
        store.create_org(args.init_org, args.owner, key); print('Organization created'); return
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler); server.store = store
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close(); store.db.close()

if __name__ == '__main__': main()
