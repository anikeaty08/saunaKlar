output "lambda_log_group_names" {
  value = { for k, g in aws_cloudwatch_log_group.lambda : k => g.name }
}

output "lambda_log_group_arns" {
  value = { for k, g in aws_cloudwatch_log_group.lambda : k => g.arn }
}

output "api_access_log_group_arn" {
  value = aws_cloudwatch_log_group.api_access.arn
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

output "canary_alarm_names" {
  description = "Function key → alarms that should roll back a canary deployment."
  value = { for k in keys(var.function_names) : k => [
    aws_cloudwatch_metric_alarm.lambda_errors[k].alarm_name,
    aws_cloudwatch_metric_alarm.lambda_throttles[k].alarm_name,
  ] }
}
