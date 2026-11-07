package main

import (
	"context"
	"github.com/aws/aws-lambda-go/lambda"
	fhir "github.com/jackaI1/lifeos-open/services/fhir"
	"log"
)

func main() {
	pipeline, err := fhir.NewPipeline(context.Background())
	if err != nil {
		log.Fatal("pipeline configuration failed")
	}
	lambda.Start(pipeline.Handle)
}
