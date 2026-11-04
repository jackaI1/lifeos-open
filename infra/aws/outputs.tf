output "repository_url" { value = aws_ecr_repository.demo.repository_url }
output "release_role_arn" { value = aws_iam_role.release.arn }
output "cluster_name" { value = aws_ecs_cluster.demo.name }
output "service_name" { value = var.image_tag == null ? null : aws_ecs_service.demo[0].name }
output "task_definition_arn" { value = var.image_tag == null ? null : aws_ecs_task_definition.demo[0].arn }
output "demo_url" { value = var.image_tag == null ? null : "https://${aws_cloudfront_distribution.demo[0].domain_name}" }
