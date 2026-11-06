package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestFingerprint(t *testing.T) {
	if fingerprint("one") == fingerprint("two") || fingerprint("one") != fingerprint("one") {
		t.Fatal("fingerprint is not stable")
	}
}
func TestInvalidTrade(t *testing.T) {
	for _, trade := range []Trade{{Source: "a", Destination: "a", Amount: 1}, {Source: "a", Destination: "b", Amount: -1}} {
		if _, err := (Service{}).Create(context.Background(), "key", trade); err == nil {
			t.Fatal("accepted invalid trade")
		}
	}
}
func fixture(t *testing.T) Service {
	t.Helper()
	url := os.Getenv("LEDGER_DATABASE_URL")
	if url == "" {
		t.Skip("Postgres integration runs in CI")
	}
	db, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err = db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("TRUNCATE ledger_requests,ledger_entries,ledger_trades,ledger_accounts RESTART IDENTITY CASCADE; INSERT INTO ledger_accounts VALUES('student',100000),('materials',0),('lab',0)"); err != nil {
		t.Fatal(err)
	}
	return Service{db}
}
func TestConcurrentSettlementsAndRetry(t *testing.T) {
	s := fixture(t)
	ctx := context.Background()
	var trades []Trade
	for i := 0; i < 20; i++ {
		trade, err := s.Create(ctx, fmt.Sprint("create", i), Trade{Source: "student", Destination: "materials", Amount: 10000})
		if err != nil {
			t.Fatal(err)
		}
		trades = append(trades, trade)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for i, trade := range trades {
		wg.Add(1)
		go func(i int, trade Trade) {
			defer wg.Done()
			_, err := s.Settle(ctx, fmt.Sprint("settle", i), trade.ID)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				success++
			} else if !errors.Is(err, insufficient) {
				t.Error(err)
			}
		}(i, trade)
	}
	wg.Wait()
	if success != 10 {
		t.Fatalf("wanted 10 affordable settlements, got %d", success)
	}
	var balance, sum, count int64
	s.DB.QueryRow("SELECT balance FROM ledger_accounts WHERE id='student'").Scan(&balance)
	s.DB.QueryRow("SELECT coalesce(sum(delta),0),count(*) FROM ledger_entries").Scan(&sum, &count)
	if balance != 0 || sum != 0 || count != 20 {
		t.Fatalf("balance=%d sum=%d entries=%d", balance, sum, count)
	}
	var settled string
	s.DB.QueryRow("SELECT id FROM ledger_trades WHERE state='settled' LIMIT 1").Scan(&settled)
	for i := 0; i < 8; i++ {
		if _, err := s.Settle(ctx, "retry-key", settled); err != nil {
			t.Fatal(err)
		}
	}
	s.DB.QueryRow("SELECT count(*) FROM ledger_entries").Scan(&count)
	if count != 20 {
		t.Fatal("retry double-posted")
	}
	if _, err := s.DB.Exec("UPDATE ledger_entries SET delta=1"); err == nil {
		t.Fatal("audit is mutable")
	}
}
func TestKeysRollbackAndHTTP(t *testing.T) {
	s := fixture(t)
	ctx := context.Background()
	trade, err := s.Create(ctx, "create", Trade{Source: "student", Destination: "lab", Amount: 100001})
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.Create(ctx, "create", trade)
	if err != nil || trade.ID != again.ID {
		t.Fatal("create retry changed ID", err)
	}
	if _, err = s.Create(ctx, "create", Trade{Source: "student", Destination: "lab", Amount: 3}); !errors.Is(err, conflict) {
		t.Fatal("key conflict accepted", err)
	}
	if _, err = s.Settle(ctx, "settle", trade.ID); !errors.Is(err, insufficient) {
		t.Fatal(err)
	}
	var count int
	s.DB.QueryRow("SELECT count(*) FROM ledger_requests WHERE key='settle'").Scan(&count)
	if count != 0 {
		t.Fatal("failed transaction retained idempotency key")
	}
	s.DB.Exec("UPDATE ledger_accounts SET balance=200000 WHERE id='student'")
	if _, err = s.Settle(ctx, "settle", trade.ID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/balances", "/audit", "/healthz"} {
		r := httptest.NewRecorder()
		s.Handler().ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 200 {
			t.Fatalf("%s: %d %s", path, r.Code, r.Body)
		}
	}
	r := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/trades", strings.NewReader(`{"source":"student","destination":"lab","amount_cents":500}`))
	req.Header.Set("Idempotency-Key", "http")
	s.Handler().ServeHTTP(r, req)
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body)
	}
}
