// Package fhir accepts a deliberately small, documented FHIR R4 subset.
package fhir

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Resource struct {
	ResourceType string `json:"resourceType"`
	ID           string `json:"id"`
	Name         []struct {
		Family string   `json:"family"`
		Given  []string `json:"given"`
	} `json:"name"`
	Status string `json:"status"`
	Code   struct {
		Coding []struct {
			System string `json:"system"`
			Code   string `json:"code"`
		} `json:"coding"`
	} `json:"code"`
	Subject struct {
		Reference string `json:"reference"`
	} `json:"subject"`
	ValueQuantity *struct {
		Value  *float64 `json:"value"`
		Unit   string   `json:"unit"`
		System string   `json:"system"`
		Code   string   `json:"code"`
	} `json:"valueQuantity"`
}
type Bundle struct {
	ResourceType string `json:"resourceType"`
	Type         string `json:"type"`
	Entry        []struct {
		FullURL  string          `json:"fullUrl"`
		Resource json.RawMessage `json:"resource"`
	} `json:"entry"`
}
type Record struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	PatientID  string   `json:"patientId"`
	Name       string   `json:"name,omitempty"`
	Code       string   `json:"code,omitempty"`
	Value      *float64 `json:"value,omitempty"`
	Unit       string   `json:"unit,omitempty"`
	SourcePath string   `json:"sourcePath"`
}
type Reject struct {
	SourcePath string `json:"sourcePath"`
	Reason     string `json:"reason"`
}
type Result struct {
	Records    []Record `json:"records"`
	Quarantine []Reject `json:"quarantine"`
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9.-]{1,64}$`)

func Parse(data []byte) (Bundle, error) {
	var bundle Bundle
	if len(data) > 2<<20 {
		return bundle, errors.New("bundle exceeds 2 MiB")
	}
	if err := json.Unmarshal(data, &bundle); err != nil {
		return bundle, errors.New("invalid JSON bundle")
	}
	if bundle.ResourceType != "Bundle" || bundle.Type != "collection" || len(bundle.Entry) == 0 || len(bundle.Entry) > 1000 {
		return bundle, errors.New("expected collection Bundle with 1–1000 entries")
	}
	return bundle, nil
}
func validate(r Resource, patients map[string]string, path string) (Record, error) {
	out := Record{ID: r.ID, Kind: r.ResourceType, SourcePath: path}
	if !idPattern.MatchString(r.ID) {
		return out, errors.New("missing or invalid resource id")
	}
	switch r.ResourceType {
	case "Patient":
		if len(r.Name) == 0 || strings.TrimSpace(r.Name[0].Family) == "" || len(r.Name[0].Given) == 0 {
			return out, errors.New("patient name required by this importer")
		}
		out.PatientID = r.ID
		out.Name = strings.Join(r.Name[0].Given, " ") + " " + r.Name[0].Family
	case "Observation":
		if r.Status != "final" && r.Status != "amended" && r.Status != "corrected" {
			return out, errors.New("observation must have a final, amended or corrected status")
		}
		patient, ok := patients[r.Subject.Reference]
		if !ok {
			return out, errors.New("subject must reference a Patient in this bundle")
		}
		out.PatientID = patient
		for _, code := range r.Code.Coding {
			if code.System == "http://loinc.org" && code.Code != "" {
				out.Code = code.Code
				break
			}
		}
		if out.Code == "" {
			return out, errors.New("LOINC observation code required")
		}
		q := r.ValueQuantity
		if q == nil || q.Value == nil || math.IsNaN(*q.Value) || math.IsInf(*q.Value, 0) || q.System != "http://unitsofmeasure.org" {
			return out, errors.New("finite UCUM quantity required")
		}
		units := map[string]string{"Cel": "degC", "mm[Hg]": "mmHg", "/min": "per_minute", "%": "percent", "mg/dL": "mg/dL"}
		unit, ok := units[q.Code]
		if !ok {
			return out, errors.New("unsupported UCUM unit; no conversion guessed")
		}
		if q.Unit != "" && q.Unit != q.Code && q.Unit != unit && !(q.Code == "/min" && q.Unit == "breaths/minute") {
			return out, errors.New("unit display conflicts with UCUM code")
		}
		out.Value = q.Value
		out.Unit = unit
	default:
		return out, errors.New("unsupported resource type")
	}
	return out, nil
}
func Normalize(ctx context.Context, data []byte, source string, workers int) (Result, error) {
	b, err := Parse(data)
	if err != nil {
		return Result{Quarantine: []Reject{{SourcePath: source, Reason: err.Error()}}}, err
	}
	if workers < 1 || workers > 8 {
		return Result{}, errors.New("workers must be 1–8")
	}
	resources := make([]Resource, len(b.Entry))
	patients := map[string]string{}
	duplicates := map[string]bool{}
	seen := map[string]bool{}
	for i, e := range b.Entry {
		if json.Unmarshal(e.Resource, &resources[i]) != nil {
			continue
		}
		r := resources[i]
		key := r.ResourceType + "/" + r.ID
		if seen[key] {
			duplicates[key] = true
		}
		seen[key] = true
	}
	for i, r := range resources {
		if r.ResourceType == "Patient" && !duplicates["Patient/"+r.ID] {
			if _, err := validate(r, nil, ""); err == nil {
				patients["Patient/"+r.ID] = r.ID
				if b.Entry[i].FullURL != "" {
					patients[b.Entry[i].FullURL] = r.ID
				}
			}
		}
	}
	records := make([]*Record, len(resources))
	rejects := make([]*Reject, len(resources))
	jobs := make(chan int)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				if ctx.Err() != nil {
					return
				}
				r := resources[i]
				path := fmt.Sprintf("%s#/entry/%d/resource", source, i)
				record, err := validate(r, patients, path)
				if duplicates[r.ResourceType+"/"+r.ID] {
					err = errors.New("duplicate resource id")
				}
				if err != nil {
					rejects[i] = &Reject{SourcePath: path, Reason: err.Error()}
				} else {
					records[i] = &record
				}
			}
		}()
	}
dispatch:
	for i := range resources {
		select {
		case jobs <- i:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(jobs)
	wg.Wait()
	if ctx.Err() != nil {
		return Result{}, ctx.Err()
	}
	result := Result{Records: []Record{}, Quarantine: []Reject{}}
	for i := range resources {
		if records[i] != nil {
			result.Records = append(result.Records, *records[i])
		}
		if rejects[i] != nil {
			result.Quarantine = append(result.Quarantine, *rejects[i])
		}
	}
	return result, nil
}

// Fetch retries only transient failures and observes cancellation during backoff.
func Fetch(ctx context.Context, url string) ([]byte, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	for attempt := range 3 {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		response, err := client.Do(req)
		if err == nil {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
			response.Body.Close()
			if response.StatusCode == 200 && readErr == nil && len(data) <= 2<<20 {
				return data, nil
			}
			if response.StatusCode < 500 && response.StatusCode != 429 {
				return nil, fmt.Errorf("source returned %d", response.StatusCode)
			}
		}
		timer := time.NewTimer(time.Duration(1<<attempt) * 100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, errors.New("source unavailable after three attempts")
}
func WriteOnce(dir string, result Result) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	for _, record := range result.Records {
		data, err := json.MarshalIndent(record, "", "  ")
		if err != nil {
			return err
		}
		path := filepath.Join(dir, record.Kind+"-"+record.ID+".json")
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if os.IsExist(err) {
			previous, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			if string(previous) != string(data) {
				return errors.New("record identity already has different content")
			}
			continue
		}
		if err != nil {
			return err
		}
		_, err = file.Write(data)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	quarantine, err := json.MarshalIndent(result.Quarantine, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "quarantine.json"), quarantine, 0600)
}
