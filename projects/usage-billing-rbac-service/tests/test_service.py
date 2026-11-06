import unittest
from datetime import datetime, timezone
from service import Store, BillingError

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(':memory:')
        self.s.create_org('acme', 'owner', 'owner-key', '2026-01-01T00:00:00Z')

    def test_permissions_and_audit(self):
        for role in ('admin', 'developer', 'viewer'):
            self.s.set_member('acme', 'owner-key', role, role, role+'-key')
        for role in ('owner', 'admin', 'developer', 'viewer'):
            self.assertTrue(self.s.authorize('acme', role+'-key', 'read'))
        for role in ('developer', 'viewer'):
            with self.assertRaises(BillingError): self.s.authorize('acme', role+'-key', 'manage')
        with self.assertRaises(BillingError): self.s.authorize('acme', 'admin-key', 'owner')
        self.assertEqual(len(self.s.audit('acme', 'owner-key')), 3)

    def test_duplicate_events_and_conflict(self):
        self.assertTrue(self.s.record_usage('acme', 'owner-key', 'req-1', 3, '2026-01-03T00:00:00Z'))
        self.assertFalse(self.s.record_usage('acme', 'owner-key', 'req-1', 3, '2026-01-03T00:00:00Z'))
        with self.assertRaises(BillingError): self.s.record_usage('acme', 'owner-key', 'req-1', 4, '2026-01-03T00:00:00Z')
        self.assertEqual(self.s.invoice('acme', 'owner-key', '2026-01')['units'], 3)

    def test_proration_and_tiers(self):
        self.s.change_plan('acme', 'owner-key', 'pro', '2026-01-16T12:00:00Z')
        self.s.record_usage('acme', 'owner-key', 'a', 150, '2026-01-02T00:00:00Z')
        bill = self.s.invoice('acme', 'owner-key', '2026-01')
        self.assertEqual(bill['subscription_cents'], 2500)
        self.assertEqual(bill['usage_cents'], 200)
        self.assertEqual(bill['total_cents'], 2700)

    def test_lifecycle_blocks_access_and_metering(self):
        self.s.set_status('acme', 'owner-key', 'suspended')
        with self.assertRaises(BillingError): self.s.record_usage('acme', 'owner-key', 'x', 1, '2026-01-05T00:00:00Z')
        with self.assertRaises(BillingError): self.s.authorize('acme', 'owner-key', 'read')

if __name__ == '__main__': unittest.main()

class HttpTests(unittest.TestCase):
    def test_endpoints_enforce_credentials_and_record_usage(self):
        import json, threading, urllib.request, urllib.error
        from service import Handler, ThreadingHTTPServer
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.store = Store(':memory:')
        server.store.create_org('acme', 'owner', 'secret', '2026-01-01T00:00:00Z')
        thread = threading.Thread(target=server.serve_forever); thread.start()
        try:
            base = 'http://127.0.0.1:%s/orgs/acme/' % server.server_port
            def request(path, key, body=None):
                req = urllib.request.Request(base+path, data=json.dumps(body).encode() if body is not None else None, headers={'Authorization': 'Bearer '+key})
                with urllib.request.urlopen(req) as response: return json.load(response)
            with self.assertRaises(urllib.error.HTTPError) as error: request('invoice?period=2026-01', 'wrong')
            self.assertEqual(error.exception.code, 401)
            event = {'event_id':'one', 'units':2, 'occurred':'2026-01-02T00:00:00Z'}
            self.assertTrue(request('usage', 'secret', event)['created'])
            self.assertFalse(request('usage', 'secret', event)['created'])
            self.assertEqual(request('invoice?period=2026-01', 'secret')['units'], 2)
        finally:
            server.shutdown(); thread.join(); server.server_close(); server.store.db.close()

class EdgeTests(unittest.TestCase):
    def test_leap_month_and_multiple_changes(self):
        s = Store(':memory:'); s.create_org('x','o','k','2024-02-01T00:00:00Z')
        s.change_plan('x','k','pro','2024-02-15T12:00:00Z')
        s.change_plan('x','k','free','2024-03-01T00:00:00Z')
        self.assertEqual(s.invoice('x','k','2024-02')['subscription_cents'], 2500)
        self.assertEqual(s.invoice('x','k','2024-03')['subscription_cents'], 0)
        s.db.close()
    def test_suspension_can_be_reversed_by_owner_but_closed_is_final(self):
        s = Store(':memory:'); s.create_org('x','o','k')
        s.set_status('x','k','suspended'); s.set_status('x','k','active')
        self.assertTrue(s.authorize('x','k','read'))
        s.set_status('x','k','closed')
        with self.assertRaises(BillingError): s.set_status('x','k','active')
        s.db.close()
