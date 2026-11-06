FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go schema.sql ./
RUN CGO_ENABLED=0 go build -trimpath -o /ledger .
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /ledger /ledger
ENV LEDGER_ADDRESS=0.0.0.0:8082
EXPOSE 8082
ENTRYPOINT ["/ledger"]
