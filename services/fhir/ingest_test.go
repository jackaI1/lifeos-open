package fhir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("fixtures/bundle.json")
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func TestNormalize(t *testing.T) {
	for _, tt := range []struct {
		name               string
		edit               func(string) string
		accepted, rejected int
	}{
		{"base", func(s string) string { return s }, 2, 1},
		{"unknown units", func(s string) string { return strings.ReplaceAll(s, "Cel", "mystery") }, 1, 2},
		{"missing status", func(s string) string { return strings.ReplaceAll(s, `"status":"final"`, `"status":"preliminary"`) }, 1, 2},
		{"missing name", func(s string) string { return strings.ReplaceAll(s, `"family":"Example"`, `"family":""`) }, 0, 3},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Normalize(context.Background(), []byte(tt.edit(string(fixture(t)))), "fixture", 4)
			if err != nil || len(result.Records) != tt.accepted || len(result.Quarantine) != tt.rejected {
				t.Fatalf("unexpected result: %+v %v", result, err)
			}
			for _, reject := range result.Quarantine {
				if reject.Reason == "" || !strings.Contains(reject.SourcePath, "#/entry/") {
					t.Fatal("missing quarantine provenance")
				}
			}
		})
	}
}
func TestIdempotentAndCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Normalize(ctx, fixture(t), "fixture", 2); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	result, err := Normalize(context.Background(), fixture(t), "fixture", 2)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err = WriteOnce(dir, result); err != nil {
		t.Fatal(err)
	}
	if err = WriteOnce(dir, result); err != nil {
		t.Fatal(err)
	}
	result.Records[0].Name = "changed"
	if err = WriteOnce(dir, result); err == nil {
		t.Fatal("must reject conflicting identity")
	}
}
func TestMalformedAndRetries(t *testing.T) {
	for _, data := range []string{`{`, `{}`, `{"resourceType":"Patient"}`} {
		result, err := Normalize(context.Background(), []byte(data), "bad.json", 1)
		if err == nil || len(result.Quarantine) != 1 {
			t.Fatal("malformed bundle not quarantined")
		}
	}
	attempts := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(503)
			return
		}
		w.Write(fixture(t))
	}))
	defer s.Close()
	if _, err := Fetch(context.Background(), s.URL); err != nil || attempts != 3 {
		t.Fatalf("%v %d", err, attempts)
	}
}
func FuzzParse(f *testing.F) {
	b, _ := os.ReadFile("fixtures/bundle.json")
	f.Add(b)
	f.Add([]byte("{"))
	f.Fuzz(func(t *testing.T, data []byte) {
		bundle, err := Parse(data)
		if err == nil {
			if bundle.ResourceType != "Bundle" {
				t.Fatal("invalid bundle accepted")
			}
			if _, err = json.Marshal(bundle); err != nil {
				t.Fatal(err)
			}
		}
	})
}

func TestPublicR4Examples(t *testing.T) {
 data,err:=os.ReadFile("fixtures/public-bundle.json");if err!=nil{t.Fatal(err)}
 result,err:=Normalize(context.Background(),data,"HL7 public fictional examples",2)
 if err!=nil||len(result.Records)!=2||len(result.Quarantine)!=0{t.Fatalf("public examples: %+v %v",result,err)}
}
