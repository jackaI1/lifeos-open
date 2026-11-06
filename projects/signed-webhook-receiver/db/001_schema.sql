CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','dead')), attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS deliveries (id bigserial PRIMARY KEY, event_id text, received_at timestamptz NOT NULL DEFAULT now(), outcome text NOT NULL, detail text);
CREATE TABLE IF NOT EXISTS dead_letters (event_id text PRIMARY KEY REFERENCES events(id), payload jsonb NOT NULL, error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY, rep_id uuid NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents >= 0), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (id bigserial PRIMARY KEY, order_id text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION audit_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO audit_log(order_id, action) VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'status:' || NEW.status END); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS orders_audit ON orders;
CREATE TRIGGER orders_audit AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION audit_order();
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- Supabase supplies auth.uid(); this equivalent reads its verified JWT subject.
DROP POLICY IF EXISTS rep_orders ON orders;
CREATE POLICY rep_orders ON orders FOR SELECT USING (rep_id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);
-- Only a trusted backend role may write. Never expose the service database credentials to clients.
CREATE TABLE IF NOT EXISTS workflow_approvals (order_id text PRIMARY KEY REFERENCES orders(id), callback_url text, created_at timestamptz NOT NULL DEFAULT now());
