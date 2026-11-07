package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	fhir "github.com/jackaI1/lifeos-open/services/fhir"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	source := flag.String("source", "fixtures/bundle.json", "FHIR bundle file or https URL")
	output := flag.String("out", "output", "private output directory")
	workers := flag.Int("workers", 4, "bounded worker count, 1–8")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var data []byte
	var err error
	if len(*source) > 8 && (*source)[:8] == "https://" {
		data, err = fhir.Fetch(ctx, *source)
	} else {
		data, err = os.ReadFile(*source)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	result, parseErr := fhir.Normalize(ctx, data, *source, *workers)
	if err = fhir.WriteOnce(*output, result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]int{"accepted": len(result.Records), "quarantined": len(result.Quarantine)})
	if parseErr != nil {
		os.Exit(1)
	}
}
