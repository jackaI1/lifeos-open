CREATE TABLE IF NOT EXISTS ledger_accounts (
 id text PRIMARY KEY, balance bigint NOT NULL CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS ledger_trades (
 id text PRIMARY KEY, source text NOT NULL REFERENCES ledger_accounts(id), destination text NOT NULL REFERENCES ledger_accounts(id),
 amount bigint NOT NULL CHECK(amount > 0), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','settled')), CHECK(source <> destination)
);
CREATE TABLE IF NOT EXISTS ledger_requests (
 key text PRIMARY KEY, fingerprint text NOT NULL, trade_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, trade_id text NOT NULL REFERENCES ledger_trades(id),
 account_id text NOT NULL REFERENCES ledger_accounts(id), delta bigint NOT NULL, posted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(trade_id,account_id)
);
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is append only'; END $$;
DROP TRIGGER IF EXISTS ledger_no_change ON ledger_entries;
CREATE TRIGGER ledger_no_change BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
INSERT INTO ledger_accounts VALUES ('student',100000),('materials',0),('lab',0) ON CONFLICT DO NOTHING;
