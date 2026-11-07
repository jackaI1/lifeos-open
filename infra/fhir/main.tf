terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
provider "aws" { region = var.region }
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "name" {
  type        = string
  description = "Unique deployment and S3 bucket prefix"
}
variable "lambda_zip" {
  type        = string
  description = "Go bootstrap zip, built for Linux amd64"
}
resource "aws_s3_bucket" "raw" { bucket = "${var.name}-raw" }
resource "aws_s3_bucket" "rejects" { bucket = "${var.name}-rejects" }
resource "aws_kms_key" "objects" {
  description             = "Fictional FHIR raw and rejected objects"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_s3_bucket_public_access_block" "raw" {
  bucket                  = aws_s3_bucket.raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.objects.arn
    }
  }
}
resource "aws_s3_bucket_public_access_block" "rejects" {
  bucket                  = aws_s3_bucket.rejects.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "rejects" {
  bucket = aws_s3_bucket.rejects.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.objects.arn
    }
  }
}
resource "aws_dynamodb_table" "records" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  attribute {
    name = "pk"
    type = "S"
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
}
resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 7
}
resource "aws_iam_role" "ingest" {
  name_prefix        = "${var.name}-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "ingest" {
  role = aws_iam_role.ingest.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.raw.arn}/raw/*" },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.rejects.arn}/rejects/*" },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.objects.arn },
    { Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = aws_dynamodb_table.records.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.ingest.arn}:*" }
  ] })
}
resource "aws_lambda_function" "ingest" {
  function_name    = var.name
  role             = aws_iam_role.ingest.arn
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  architectures    = ["x86_64"]
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  timeout          = 30
  memory_size      = 128
  environment { variables = { RAW_BUCKET = aws_s3_bucket.raw.id, REJECT_BUCKET = aws_s3_bucket.rejects.id, FHIR_TABLE = aws_dynamodb_table.records.id } }
  depends_on = [aws_iam_role_policy.ingest, aws_cloudwatch_log_group.ingest]
}
resource "aws_lambda_permission" "s3" {
  statement_id  = "AllowRawS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.raw.arn
}
resource "aws_s3_bucket_notification" "ingest" {
  bucket = aws_s3_bucket.raw.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "raw/"
  }
  depends_on = [aws_lambda_permission.s3]
}
output "raw_bucket" { value = aws_s3_bucket.raw.id }
output "reject_bucket" { value = aws_s3_bucket.rejects.id }
output "table" { value = aws_dynamodb_table.records.id }
