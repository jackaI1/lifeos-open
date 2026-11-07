resource "aws_cloudwatch_log_metric_filter" "failed_health" {
  name           = "${var.name}-failed-health"
  log_group_name = aws_cloudwatch_log_group.demo.name
  pattern        = "{ $.event = \"health_check\" && $.ok = false }"
  metric_transformation {
    name      = "FailedHealthChecks"
    namespace = "LifeOS/${var.name}"
    value     = "1"
  }
}
resource "aws_cloudwatch_metric_alarm" "failed_health" {
  alarm_name          = "${var.name}-failed-health"
  alarm_description   = "LifeOS logged three failed health checks in five minutes"
  namespace           = "LifeOS/${var.name}"
  metric_name         = "FailedHealthChecks"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 3
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
}
