# Log groups, alarms (design 17), dashboard and AWS Budgets.
#
# Log groups are created here (before the functions) so retention is always set and Lambda never
# auto-creates a never-expiring group. CloudFront, WAF and ACM metrics only exist in us-east-1,
# so those alarms use the us_east_1 provider and their own SNS topic.

data "aws_region" "current" {}

locals {
  region = data.aws_region.current.name

  lambda_log_groups = merge(
    { for k in var.function_keys : k => "/aws/lambda/${var.name}-${k}" },
    { "cognito-custom-message" = "/aws/lambda/${var.name}-cognito-custom-message" },
  )

  alarm_actions      = [aws_sns_topic.alarms.arn]
  alarm_actions_use1 = [aws_sns_topic.alarms_us_east_1.arn]

  apis = { api = var.api_id, admin-api = var.admin_api_id }
}

# ---------------------------------------------------------------------------------------------
# Log groups
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_log_groups
  name              = each.value
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------------------------
# Notification topics
# ---------------------------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic" "alarms_us_east_1" {
  provider = aws.us_east_1
  name     = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_sns_topic_subscription" "alarms_email_us_east_1" {
  provider  = aws.us_east_1
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms_us_east_1.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------------------------
# API Gateway
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  for_each            = local.apis
  alarm_name          = "${var.name}-${each.key}-5xx-rate"
  alarm_description   = "More than ${var.api_5xx_rate_percent}% of ${each.key} requests fail with 5xx."
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.api_5xx_rate_percent
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 20, 100 * errors / requests, 0)"
    label       = "5xx %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "5xx"
      dimensions  = { ApiId = each.value, Stage = "$default" }
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "Count"
      dimensions  = { ApiId = each.value, Stage = "$default" }
      period      = 60
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p95" {
  for_each            = local.apis
  alarm_name          = "${var.name}-${each.key}-latency-p95"
  alarm_description   = "${each.key} p95 latency above ${var.api_p95_latency_ms} ms (target < 300 ms)."
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = each.value, Stage = "$default" }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.api_p95_latency_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------------------------
# Lambda
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = var.function_names
  alarm_name          = "${var.name}-${each.key}-errors"
  alarm_description   = "Lambda ${each.key}: unhandled errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = var.lambda_error_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = var.function_names
  alarm_name          = "${var.name}-${each.key}-throttles"
  alarm_description   = "Lambda ${each.key} is being throttled (reserved concurrency exhausted?)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------------------------
# RDS + RDS Proxy
# ---------------------------------------------------------------------------------------------

locals {
  rds_alarms = {
    cpu = {
      metric      = "CPUUtilization"
      threshold   = 80
      comparison  = "GreaterThanThreshold"
      description = "RDS CPU above 80% for 15 minutes."
    }
    freeable-memory = {
      metric      = "FreeableMemory"
      threshold   = var.rds_min_freeable_memory_bytes
      comparison  = "LessThanThreshold"
      description = "RDS freeable memory low."
    }
    free-storage = {
      metric      = "FreeStorageSpace"
      threshold   = var.rds_min_free_storage_bytes
      comparison  = "LessThanThreshold"
      description = "RDS free storage low (autoscaling may be at its maximum)."
    }
    connections = {
      metric      = "DatabaseConnections"
      threshold   = var.rds_max_connections
      comparison  = "GreaterThanThreshold"
      description = "RDS connection count high."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "rds" {
  for_each            = local.rds_alarms
  alarm_name          = "${var.name}-rds-${each.key}"
  alarm_description   = each.value.description
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# R4: session pinning exhausts the proxy pool. Application code must only use transaction-local
# settings (set_config(..., true)); any sustained pinning is a bug.
resource "aws_cloudwatch_metric_alarm" "proxy_pinning" {
  alarm_name          = "${var.name}-rds-proxy-session-pinning"
  alarm_description   = "RDS Proxy connections pinned to sessions (look for session-level SET or prepared statements)."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnectionsCurrentlySessionPinned"
  dimensions          = { ProxyName = var.db_proxy_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.proxy_pinned_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "proxy_borrow_latency" {
  alarm_name          = "${var.name}-rds-proxy-borrow-latency"
  alarm_description   = "Clients wait for a pooled connection (pool exhausted)."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnectionsBorrowLatency"
  dimensions          = { ProxyName = var.db_proxy_name }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 50000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------------------------
# SQS
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${var.name}-jobs-dlq-depth"
  alarm_description   = "Messages in the worker dead-letter queue (e-mails or KVS syncs failed 5 times)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.jobs_dlq_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "jobs_age" {
  alarm_name          = "${var.name}-jobs-oldest-message-age"
  alarm_description   = "Worker is not keeping up with the jobs queue."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = var.jobs_queue_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------------------------
# SES reputation (account level, eu-central-1)
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  alarm_name          = "${var.name}-ses-bounce-rate"
  alarm_description   = "SES bounce rate above ${var.ses_bounce_rate_threshold * 100}% (AWS reviews accounts at 5%)."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 900
  evaluation_periods  = 1
  threshold           = var.ses_bounce_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  alarm_name          = "${var.name}-ses-complaint-rate"
  alarm_description   = "SES complaint rate above ${var.ses_complaint_rate_threshold * 100}%."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 900
  evaluation_periods  = 1
  threshold           = var.ses_complaint_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------------------------
# Edge (us-east-1 metrics)
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name}-cloudfront-5xx-rate"
  alarm_description   = "CloudFront 5xx error rate above ${var.cloudfront_5xx_rate_percent}%."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  dimensions          = { DistributionId = var.distribution_id, Region = "Global" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.cloudfront_5xx_rate_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions_use1
  ok_actions          = local.alarm_actions_use1
}

resource "aws_cloudwatch_metric_alarm" "waf_blocked_spike" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name}-waf-blocked-spike"
  alarm_description   = "WAF blocked-request spike (attack, scraping or a false positive after a rule update)."
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = var.web_acl_name, Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.waf_blocked_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions_use1
}

resource "aws_cloudwatch_metric_alarm" "certificate_expiry" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name}-certificate-expiry"
  alarm_description   = "Wildcard certificate expires within 30 days (ACM renewal is failing: check DNS validation records)."
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  dimensions          = { CertificateArn = var.certificate_arn }
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions_use1
}

# ---------------------------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "API requests and errors"
          region = local.region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", "$default"],
            [".", "4xx", ".", ".", ".", "."],
            [".", "5xx", ".", ".", ".", "."],
            ["AWS/ApiGateway", "Count", "ApiId", var.admin_api_id, "Stage", "$default", { label = "admin Count" }],
            [".", "5xx", ".", ".", ".", ".", { label = "admin 5xx" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "API latency"
          region = local.region
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, "Stage", "$default", { stat = "p50" }],
            ["...", { stat = "p95" }],
            ["...", { stat = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title   = "Lambda duration p95"
          region  = local.region
          period  = 60
          stat    = "p95"
          metrics = [for k, f in var.function_names : ["AWS/Lambda", "Duration", "FunctionName", f, { label = k }]]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title  = "Lambda errors / throttles / concurrency"
          region = local.region
          period = 60
          stat   = "Sum"
          metrics = concat(
            [for k, f in var.function_names : ["AWS/Lambda", "Errors", "FunctionName", f, { label = "${k} errors" }]],
            [for k, f in var.function_names : ["AWS/Lambda", "Throttles", "FunctionName", f, { label = "${k} throttles" }]],
          )
        }
      },
      {
        type = "metric", x = 0, y = 12, width = 12, height = 6
        properties = {
          title  = "RDS"
          region = local.region
          period = 300
          stat   = "Average"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier],
            [".", "DatabaseConnections", ".", ".", { yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 12, width = 12, height = 6
        properties = {
          title  = "RDS Proxy"
          region = local.region
          period = 60
          stat   = "Maximum"
          metrics = [
            ["AWS/RDS", "ClientConnections", "ProxyName", var.db_proxy_name],
            [".", "DatabaseConnections", ".", "."],
            [".", "DatabaseConnectionsCurrentlySessionPinned", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 18, width = 12, height = 6
        properties = {
          title  = "Worker queue"
          region = local.region
          period = 60
          stat   = "Maximum"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.jobs_queue_name],
            [".", "ApproximateAgeOfOldestMessage", ".", ".", { yAxis = "right" }],
            [".", "ApproximateNumberOfMessagesVisible", ".", var.jobs_dlq_name, { label = "DLQ" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 18, width = 12, height = 6
        properties = {
          title  = "E-mail reputation"
          region = local.region
          period = 900
          stat   = "Maximum"
          metrics = [
            ["AWS/SES", "Reputation.BounceRate"],
            [".", "Reputation.ComplaintRate"],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 24, width = 12, height = 6
        properties = {
          title  = "CloudFront"
          region = "us-east-1"
          period = 300
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", var.distribution_id, "Region", "Global", { stat = "Sum" }],
            [".", "BytesDownloaded", ".", ".", ".", ".", { stat = "Sum", yAxis = "right" }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { stat = "Average" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 24, width = 12, height = 6
        properties = {
          title  = "WAF"
          region = "us-east-1"
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/WAFV2", "AllowedRequests", "WebACL", var.web_acl_name, "Rule", "ALL"],
            [".", "BlockedRequests", ".", ".", ".", "."],
          ]
        }
      },
    ]
  })
}

# ---------------------------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd > 0 ? 1 : 0
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_emails
  }
}
