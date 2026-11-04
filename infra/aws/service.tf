resource "aws_ecs_cluster" "demo" {
  name = var.name
}
resource "aws_ecs_task_definition" "demo" {
  count                    = var.image_tag == null ? 0 : 1
  family                   = var.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "demo", image = "${aws_ecr_repository.demo.repository_url}:${var.image_tag}", essential = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 8080, protocol = "tcp" }]
    environment            = [{ name = "PARENT_ORIGIN", value = var.parent_origin }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = { awslogs-group = aws_cloudwatch_log_group.demo.name, awslogs-region = var.aws_region, awslogs-stream-prefix = "demo" }
    }
    healthCheck = {
      command  = ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval = 30, timeout = 5, retries = 3, startPeriod = 15
    }
  }])
}
resource "aws_ecs_service" "demo" {
  count                              = var.image_tag == null ? 0 : 1
  name                               = var.name
  cluster                            = aws_ecs_cluster.demo.id
  task_definition                    = aws_ecs_task_definition.demo[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  wait_for_steady_state              = true
  health_check_grace_period_seconds  = 60
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task[0].id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.demo[0].arn
    container_name   = "demo"
    container_port   = 8080
  }
  lifecycle {
    # Tag releases select the running revision; Terraform owns the bootstrap template.
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.demo, aws_iam_role_policy.execution, aws_route_table_association.public]
}
