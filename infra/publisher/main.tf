terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "bucket_name" {
  type        = string
  description = "Globally unique private bucket for fictional demo JSON"
}
provider "aws" { region = var.region }
resource "aws_s3_bucket" "feed" { bucket = var.bucket_name }
resource "aws_s3_bucket_public_access_block" "feed" {
  bucket                  = aws_s3_bucket.feed.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_kms_key" "feed" {
  description             = "Fictional LifeOS demo feed objects"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_s3_bucket_server_side_encryption_configuration" "feed" {
  bucket = aws_s3_bucket.feed.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.feed.arn
    }
  }
}
resource "aws_iam_role" "publisher" {
  name_prefix        = "lifeos-feed-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/aws/lambda/lifeos-demo-publisher"
  retention_in_days = 7
}
resource "aws_iam_role_policy" "publisher" {
  role = aws_iam_role.publisher.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.feed.arn, Condition = { StringEquals = { "s3:prefix" = "demo/today.json" } } },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.feed.arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.feed.arn}/demo/today.json" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.publisher.arn}:*" }
  ] })
}
data "archive_file" "publisher" {
  type        = "zip"
  source_file = "${path.module}/../../integrations/aws-feed/publisher.py"
  output_path = "${path.module}/publisher.zip"
}
resource "aws_lambda_function" "publisher" {
  function_name    = "lifeos-demo-publisher"
  role             = aws_iam_role.publisher.arn
  runtime          = "python3.12"
  handler          = "publisher.handler"
  filename         = data.archive_file.publisher.output_path
  source_code_hash = data.archive_file.publisher.output_base64sha256
  timeout          = 15
  memory_size      = 128
  environment { variables = { DEMO_BUCKET = aws_s3_bucket.feed.id } }
  depends_on = [aws_iam_role_policy.publisher, aws_cloudwatch_log_group.publisher]
}
output "bucket" { value = aws_s3_bucket.feed.id }
output "function_name" { value = aws_lambda_function.publisher.function_name }
