mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_availability_zones" { defaults = { names = ["us-east-1a", "us-east-1b"] } }
  mock_data "aws_ec2_managed_prefix_list" { defaults = { id = "pl-0123456789abcdef0" } }
  mock_resource "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:us-east-1:123456789012:repository/lifeos-open-demo"
      repository_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com/lifeos-open-demo"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/lifeos-open-demo-task-execution" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/lifeos-open-demo" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { id = "arn:aws:ecs:us-east-1:123456789012:cluster/lifeos-open-demo" }
  }
}

run "bootstrap_without_image" {
  command = apply
  assert {
    condition     = length(aws_ecs_service.demo) == 0 && length(aws_lb.demo) == 0 && length(aws_cloudfront_distribution.demo) == 0
    error_message = "Bootstrap must not create billable compute or try an empty ECR image."
  }
  assert {
    condition     = aws_ecr_repository.demo.image_tag_mutability == "IMMUTABLE" && !aws_ecr_repository.demo.force_delete
    error_message = "Images must be immutable and destruction must require explicit image cleanup."
  }
  assert {
    condition     = jsondecode(aws_iam_role.release.assume_role_policy).Statement[0].Condition.StringLike["token.actions.githubusercontent.com:sub"] == "repo:jackaI1/lifeos-open:ref:refs/tags/aws-v*"
    error_message = "Only AWS release tags in the exact repository may assume the role."
  }
  assert {
    condition     = jsondecode(aws_iam_role.release.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "Reject OIDC tokens intended for a different audience."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.release.policy).Statement[2].Resource == "arn:aws:ecs:us-east-1:123456789012:service/lifeos-open-demo/lifeos-open-demo"
    error_message = "CI must only update its dedicated service."
  }
}

run "public_demo_service" {
  command = plan
  variables { image_tag = "aws-0123456789abcdef0123456789abcdef01234567" }
  assert {
    condition     = aws_ecs_task_definition.demo[0].cpu == "256" && aws_ecs_task_definition.demo[0].memory == "512" && aws_ecs_service.demo[0].desired_count == 1
    error_message = "Use one small Fargate task."
  }
  assert {
    condition     = aws_ecs_service.demo[0].deployment_maximum_percent == 100 && aws_ecs_service.demo[0].deployment_circuit_breaker[0].rollback
    error_message = "Do not exceed one task during a rollout; roll back failed deployments."
  }
  assert {
    condition     = aws_lb_target_group.demo[0].health_check[0].path == "/healthz" && aws_vpc_security_group_ingress_rule.task[0].from_port == 8080
    error_message = "Use the static transport's port and readiness contract."
  }
  assert {
    condition     = aws_cloudfront_distribution.demo[0].default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" && aws_cloudfront_distribution.demo[0].viewer_certificate[0].cloudfront_default_certificate
    error_message = "Public viewers must use managed HTTPS without bringing a custom domain."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.demo[0].container_definitions)[0].readonlyRootFilesystem && aws_cloudwatch_log_group.demo.retention_in_days == 7
    error_message = "Keep the static filesystem read-only and bound log retention."
  }
}

run "reuse_account_oidc" {
  command = plan
  variables { existing_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "Do not recreate an account's existing GitHub OIDC provider."
  }
}
run "reject_wildcard_repository" {
  command = plan
  variables { github_repository = "jackaI1/*" }
  expect_failures = [var.github_repository]
}
run "reject_mutable_image_tag" {
  command = plan
  variables { image_tag = "latest" }
  expect_failures = [var.image_tag]
}
run "reject_parent_with_path" {
  command = plan
  variables { parent_origin = "https://portfolio.example.invalid/path" }
  expect_failures = [var.parent_origin]
}
