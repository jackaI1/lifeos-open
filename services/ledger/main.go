package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/lib/pq"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

//go:embed schema.sql
var schema string

type Trade struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Amount      int64  `json:"amount_cents"`
	State       string `json:"state"`
}
type Service struct{ DB *sql.DB }

var conflict = errors.New("Idempotency key was already used for a different request")
var insufficient = errors.New("Insufficient balance")

func fingerprint(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func claim(ctx context.Context, tx *sql.Tx, key, body, trade string) error {
	if key == "" || len(key) > 100 {
		return errors.New("Supply an Idempotency-Key of 1 to 100 characters")
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO ledger_requests VALUES($1,$2,$3) ON CONFLICT DO NOTHING", key, fingerprint(body), trade)
	if err != nil {
		return err
	}
	var previous string
	if err = tx.QueryRowContext(ctx, "SELECT fingerprint FROM ledger_requests WHERE key=$1 FOR UPDATE", key).Scan(&previous); err != nil {
		return err
	}
	if previous != fingerprint(body) {
		return conflict
	}
	return nil
}
func readTrade(ctx context.Context, tx *sql.Tx, id string, lock bool) (Trade, error) {
	var t Trade
	q := "SELECT id,source,destination,amount,state FROM ledger_trades WHERE id=$1"
	if lock {
		q += " FOR UPDATE"
	}
	err := tx.QueryRowContext(ctx, q, id).Scan(&t.ID, &t.Source, &t.Destination, &t.Amount, &t.State)
	return t, err
}
func (s Service) Create(ctx context.Context, key string, t Trade) (Trade, error) {
	if t.Source == t.Destination || t.Source == "" || t.Destination == "" || t.Amount <= 0 || t.Amount > 100000000 {
		return Trade{}, errors.New("Use different accounts and an amount between 1 and 100000000 cents")
	}
	t.ID = fingerprint("trade:" + key)[:24]
	t.State = "pending"
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Trade{}, err
	}
	defer tx.Rollback()
	if err = claim(ctx, tx, key, fmt.Sprintf("create:%s:%s:%d", t.Source, t.Destination, t.Amount), t.ID); err != nil {
		return Trade{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO ledger_trades(id,source,destination,amount) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", t.ID, t.Source, t.Destination, t.Amount)
	if err != nil {
		return Trade{}, err
	}
	t, err = readTrade(ctx, tx, t.ID, false)
	if err != nil {
		return Trade{}, err
	}
	return t, tx.Commit()
}
func (s Service) Settle(ctx context.Context, key, id string) (Trade, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Trade{}, err
	}
	defer tx.Rollback()
	if err = claim(ctx, tx, key, "settle:"+id, id); err != nil {
		return Trade{}, err
	}
	t, err := readTrade(ctx, tx, id, true)
	if err != nil {
		return Trade{}, err
	}
	if t.State == "settled" {
		return t, tx.Commit()
	}
	// A fixed lock order prevents two different trades from deadlocking on accounts.
	rows, err := tx.QueryContext(ctx, "SELECT id FROM ledger_accounts WHERE id IN ($1,$2) ORDER BY id FOR UPDATE", t.Source, t.Destination)
	if err != nil {
		return Trade{}, err
	}
	for rows.Next() {
		var account string
		if err = rows.Scan(&account); err != nil {
			rows.Close()
			return Trade{}, err
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Trade{}, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE ledger_accounts SET balance=balance-$1 WHERE id=$2 AND balance >= $1", t.Amount, t.Source)
	if err != nil {
		return Trade{}, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return Trade{}, insufficient
	}
	if _, err = tx.ExecContext(ctx, "UPDATE ledger_accounts SET balance=balance+$1 WHERE id=$2", t.Amount, t.Destination); err != nil {
		return Trade{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO ledger_entries(trade_id,account_id,delta) VALUES($1,$2,$4),($1,$3,-$4)", t.ID, t.Destination, t.Source, t.Amount); err != nil {
		return Trade{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE ledger_trades SET state='settled' WHERE id=$1", t.ID); err != nil {
		return Trade{}, err
	}
	t.State = "settled"
	return t, tx.Commit()
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func (s Service) Handler() http.Handler {
	mux := http.NewServeMux()
	handleError := func(w http.ResponseWriter, err error) {
		status := 400
		if errors.Is(err, conflict) || errors.Is(err, insufficient) {
			status = 409
		}
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		write(w, status, map[string]string{"error": err.Error()})
	}
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.DB.PingContext(ctx); err != nil {
			write(w, 503, map[string]bool{"ok": false})
			return
		}
		write(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /trades", func(w http.ResponseWriter, r *http.Request) {
		var t Trade
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&t); err != nil {
			handleError(w, errors.New("Invalid trade JSON"))
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			handleError(w, errors.New("Send one JSON object"))
			return
		}
		result, err := s.Create(r.Context(), r.Header.Get("Idempotency-Key"), t)
		if err != nil {
			handleError(w, err)
			return
		}
		write(w, 201, result)
	})
	mux.HandleFunc("POST /trades/{id}/settle", func(w http.ResponseWriter, r *http.Request) {
		t, err := s.Settle(r.Context(), r.Header.Get("Idempotency-Key"), r.PathValue("id"))
		if err != nil {
			handleError(w, err)
			return
		}
		write(w, 200, t)
	})
	mux.HandleFunc("GET /balances", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT id,balance FROM ledger_accounts ORDER BY id")
		if err != nil {
			handleError(w, err)
			return
		}
		defer rows.Close()
		result := map[string]int64{}
		for rows.Next() {
			var id string
			var balance int64
			if err = rows.Scan(&id, &balance); err != nil {
				handleError(w, err)
				return
			}
			result[id] = balance
		}
		if err = rows.Err(); err != nil {
			handleError(w, err)
			return
		}
		write(w, 200, result)
	})
	mux.HandleFunc("GET /audit", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT id,trade_id,account_id,delta FROM ledger_entries ORDER BY id LIMIT 1000")
		if err != nil {
			handleError(w, err)
			return
		}
		defer rows.Close()
		result := []map[string]any{}
		for rows.Next() {
			var id, delta int64
			var trade, account string
			if err = rows.Scan(&id, &trade, &account, &delta); err != nil {
				handleError(w, err)
				return
			}
			result = append(result, map[string]any{"id": id, "trade_id": trade, "account_id": account, "delta": delta})
		}
		if err = rows.Err(); err != nil {
			handleError(w, err)
			return
		}
		write(w, 200, result)
	})
	return mux
}
func main() {
	db, err := sql.Open("postgres", os.Getenv("LEDGER_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	if _, err = db.Exec(schema); err != nil {
		log.Fatal(err)
	}
	address := os.Getenv("LEDGER_ADDRESS")
	if strings.TrimSpace(address) == "" {
		address = "127.0.0.1:8082"
	}
	server := &http.Server{Addr: address, Handler: Service{db}.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("fictional settlement ledger listening on %s", address)
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
