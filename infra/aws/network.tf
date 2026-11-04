data "aws_availability_zones" "available" { state = "available" }
data "aws_ec2_managed_prefix_list" "cloudfront" { name = "com.amazonaws.global.cloudfront.origin-facing" }

resource "aws_vpc" "demo" {
  count                = var.image_tag == null ? 0 : 1
  cidr_block           = "10.86.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}
resource "aws_subnet" "public" {
  count             = var.image_tag == null ? 0 : 2
  vpc_id            = aws_vpc.demo[0].id
  cidr_block        = cidrsubnet(aws_vpc.demo[0].cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
}
resource "aws_internet_gateway" "demo" {
  count  = var.image_tag == null ? 0 : 1
  vpc_id = aws_vpc.demo[0].id
}
resource "aws_route_table" "public" {
  count  = var.image_tag == null ? 0 : 1
  vpc_id = aws_vpc.demo[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.demo[0].id
  }
}
resource "aws_route_table_association" "public" {
  count          = var.image_tag == null ? 0 : 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}
resource "aws_security_group" "load_balancer" {
  count       = var.image_tag == null ? 0 : 1
  name_prefix = "${var.name}-alb-"
  description = "Only CloudFront origin servers may reach the static origin"
  vpc_id      = aws_vpc.demo[0].id
}
resource "aws_security_group" "task" {
  count       = var.image_tag == null ? 0 : 1
  name_prefix = "${var.name}-task-"
  description = "Only the ALB may reach the static task"
  vpc_id      = aws_vpc.demo[0].id
}
resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  count             = var.image_tag == null ? 0 : 1
  security_group_id = aws_security_group.load_balancer[0].id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}
resource "aws_vpc_security_group_egress_rule" "alb" {
  count                        = var.image_tag == null ? 0 : 1
  security_group_id            = aws_security_group.load_balancer[0].id
  referenced_security_group_id = aws_security_group.task[0].id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}
resource "aws_vpc_security_group_ingress_rule" "task" {
  count                        = var.image_tag == null ? 0 : 1
  security_group_id            = aws_security_group.task[0].id
  referenced_security_group_id = aws_security_group.load_balancer[0].id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}
resource "aws_vpc_security_group_egress_rule" "task" {
  count             = var.image_tag == null ? 0 : 1
  security_group_id = aws_security_group.task[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_lb" "demo" {
  count                      = var.image_tag == null ? 0 : 1
  name                       = var.name
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.load_balancer[0].id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
}
resource "aws_lb_target_group" "demo" {
  count                = var.image_tag == null ? 0 : 1
  name                 = var.name
  port                 = 8080
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.demo[0].id
  deregistration_delay = 10
  health_check {
    path                = "/healthz"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
}
resource "aws_lb_listener" "demo" {
  count             = var.image_tag == null ? 0 : 1
  load_balancer_arn = aws_lb.demo[0].arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.demo[0].arn
  }
}
resource "aws_cloudfront_distribution" "demo" {
  count           = var.image_tag == null ? 0 : 1
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} browser-only demo"
  price_class     = "PriceClass_100"
  origin {
    domain_name = aws_lb.demo[0].dns_name
    origin_id   = "static-container"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id       = "static-container"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
