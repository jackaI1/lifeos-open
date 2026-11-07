# Checking fictional health records

I wanted to learn a careful import workflow, so I wrote a Go importer for public
FHIR examples. FHIR is a standard JSON format for exchanging health records.
The importer accepts a documented subset of Patient and Observation resources,
normalizes only known fields, and writes rejected records with a source path and
reason. It does not invent missing values or make clinical decisions.

```sh
cd services/fhir
go run ./cmd/ingest -source fixtures/public-bundle.json -out output -workers 4
go vet ./...
go test -race ./...
go test -fuzz=FuzzParse -fuzztime=5s .
```

The checked-in [public bundle](../services/fhir/fixtures/public-bundle.json)
contains reduced, fictional examples from the
[HL7 FHIR R4 Patient example](https://hl7.org/fhir/R4/patient-example.json.html)
and respiratory-rate example. Exact source URLs and original SHA-256 digests
are in `fixtures/sources.json`. The second bundle is self-made and includes a
broken reference so I can see quarantine behavior without an outside service.
The CLI also fetches HTTPS bundle URLs with three attempts, backoff, a size limit
and context cancellation.

For this importer, Patient needs an id and an explicit given/family name.
Observation needs a supported final status, a LOINC code, a reference to a valid
Patient inside the bundle, and a finite UCUM quantity with a known unit.
LOINC names measurements; UCUM standardizes unit codes. Five unit codes and an
explicit respiratory-rate display alias are supported. Unknown units, duplicate
ids, unresolved references, malformed records and unsupported resource types
are quarantined. These are importer rules, stricter than some
[FHIR R4 requirements](https://hl7.org/fhir/R4/observation.html), not a complete
FHIR conformance validator. A pool of at most eight goroutines, Go's concurrent
workers, validates entries while preserving source order. Repeated identical
local writes are skipped; conflicting identities are rejected.

## The optional S3 path

`cmd/lambda` packages the same parser as an AWS Lambda handler:

1. An object under `raw/` in the configured S3 bucket triggers the function.
2. The handler checks the source bucket and prefix, reads at most 2 MiB and runs
   the bounded parser with the Lambda request's cancellation context.
3. It writes normalized records to DynamoDB with `attribute_not_exists(pk)`,
   a conditional write that skips duplicates. Keys include the content digest,
   resource type and id, so different source versions are distinct.
4. It writes rejects under `rejects/` in a separate S3 bucket with their reasons
   and source paths. A malformed whole bundle creates a quarantine object too.
   Storage errors fail the invocation so AWS can retry; repeated delivery is safe.

Build and deploy with an AWS account and suitable operator permissions:

```sh
cd services/fhir
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bootstrap ./cmd/lambda
zip function.zip bootstrap
cd ../..
terraform -chdir=infra/fhir init
terraform -chdir=infra/fhir apply -var name=your-unique-lifeos-example -var lambda_zip="$PWD/services/fhir/function.zip"
```

The module defines private encrypted buckets, an on-demand table, seven-day logs,
a least-privilege role and the S3 event notification. Keep this fictional; it is
not configured for regulated health data. Delete the example objects before
`terraform destroy` to avoid losing a bucket unexpectedly.

CI runs vet, table-driven tests, the race detector and a parser fuzz test. Then
LocalStack, a local AWS emulator on the Linux runner, runs the actual Linux Go
Lambda triggered by S3. The check requires two accepted records, a duplicate
with no extra writes, and quarantine objects for a broken reference and malformed
JSON. It cleans up its buckets, function, table, role and owned network. No real
AWS account or Mac container runtime is used by these tests. Emulator success
is not a production AWS deployment.
