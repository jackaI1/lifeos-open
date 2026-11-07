package fhir

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Pipeline struct {
	S3                             *s3.Client
	DB                             *dynamodb.Client
	RawBucket, RejectBucket, Table string
}

func NewPipeline(ctx context.Context) (*Pipeline, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRetryMaxAttempts(3))
	if err != nil {
		return nil, err
	}
	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	return &Pipeline{S3: s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	}), DB: dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	}), RawBucket: os.Getenv("RAW_BUCKET"), RejectBucket: os.Getenv("REJECT_BUCKET"), Table: os.Getenv("FHIR_TABLE")}, nil
}
func (p *Pipeline) Handle(ctx context.Context, event events.S3Event) error {
	for _, entry := range event.Records {
		key, err := url.QueryUnescape(entry.S3.Object.Key)
		if err != nil {
			return err
		}
		if entry.S3.Bucket.Name != p.RawBucket || !strings.HasPrefix(key, "raw/") {
			return errors.New("untrusted source bucket or prefix")
		}
		object, err := p.S3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(p.RawBucket), Key: aws.String(key)})
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(object.Body, (2<<20)+1))
		object.Body.Close()
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		digest := hex.EncodeToString(sum[:])
		result, _ := Normalize(ctx, data, "s3://"+p.RawBucket+"/"+key, 4)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		for _, record := range result.Records {
			payload, err := json.Marshal(record)
			if err != nil {
				return err
			}
			pk := digest + "/" + record.Kind + "/" + record.ID
			_, err = p.DB.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(p.Table), ConditionExpression: aws.String("attribute_not_exists(pk)"), Item: map[string]types.AttributeValue{"pk": &types.AttributeValueMemberS{Value: pk}, "payload": &types.AttributeValueMemberS{Value: string(payload)}}})
			var duplicate *types.ConditionalCheckFailedException
			if err != nil && !errors.As(err, &duplicate) {
				return err
			}
		}
		if len(result.Quarantine) > 0 {
			rejects, err := json.Marshal(result.Quarantine)
			if err != nil {
				return err
			}
			source := sha256.Sum256([]byte(p.RawBucket + "/" + key))
			rejectKey := "rejects/" + hex.EncodeToString(source[:]) + "-" + digest + ".json"
			_, err = p.S3.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(p.RejectBucket), Key: aws.String(rejectKey), Body: strings.NewReader(string(rejects)), ContentType: aws.String("application/json")})
			if err != nil {
				return err
			}
		}
	}
	return nil
}
