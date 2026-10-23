# API tier: six Lambda functions (one IAM role and one DB login user each), API Gateway HTTP API,
# SQS jobs queue + DLQ for the worker, EventBridge schedules, and the application secrets.
#
# Lambda code is NOT built by Terraform. Functions are created with a bootstrap stub and the real
# bundles (services/api/dist/lambda/<function>/index.mjs) are deployed by CI, which publishes a
# version and shifts the `live` alias. Everything that invokes a function (API Gateway, SQS, SNS,
# EventBridge Scheduler) targets the `live` alias, never $LATEST.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
  partition  = data.aws_partition.current.partition

  # Function → DB login user (see modules/database for the role mapping) and network placement.
  functions = {
    "public-catalog"     = { db_user = "svc_public_catalog", worker = false, timeout = 10, memory = 512 }
    "customer"           = { db_user = "svc_customer", worker = false, timeout = 10, memory = 512 }
    "reseller-admin"     = { db_user = "svc_reseller_admin", worker = false, timeout = 15, memory = 768 }
    "manufacturer-admin" = { db_user = "svc_manufacturer_admin", worker = false, timeout = 15, memory = 512 }
    "asset-signer"       = { db_user = "svc_asset_signer", worker = false, timeout = 5, memory = 256 }
    "worker"             = { db_user = "svc_worker", worker = true, timeout = var.worker_timeout_seconds, memory = 512 }
  }

  api_functions = { for k, v in local.functions : k => v if !v.worker }

  function_names = { for k in keys(local.functions) : k => "${var.name}-${k}" }

  common_env = {
    APP_ENV                             = var.environment
    PLATFORM_DOMAIN                     = var.platform_domain
    ADMIN_HOST                          = var.admin_host
    LOG_LEVEL                           = var.log_level
    NODE_OPTIONS                        = "--enable-source-maps"
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    DB_HOST                             = var.db_proxy_endpoint
    DB_PORT                             = "5432"
    DB_NAME                             = var.db_name
    DB_AUTH                             = "iam"
    DB_SSL                              = "require"
    ORIGIN_SECRET_ARN                   = aws_secretsmanager_secret.origin_verify.arn
    APP_SECRET_ARN                      = aws_secretsmanager_secret.app_keys.arn
  }

  function_env = {
    "public-catalog" = {}
    "customer" = {
      CUSTOMER_POOL_ID   = var.customer_pool_id
      CUSTOMER_CLIENT_ID = var.customer_client_id
      QUEUE_URL          = aws_sqs_queue.jobs.url
    }
    "reseller-admin" = {
      STAFF_POOL_ID   = var.staff_pool_id
      STAFF_CLIENT_ID = var.staff_client_id
      UPLOADS_BUCKET  = var.uploads_bucket_name
      BRANDING_BUCKET = var.branding_bucket_name
      QUEUE_URL       = aws_sqs_queue.jobs.url
    }
    "manufacturer-admin" = {
      STAFF_POOL_ID   = var.staff_pool_id
      STAFF_CLIENT_ID = var.staff_client_id
      UPLOADS_BUCKET  = var.uploads_bucket_name
      QUEUE_URL       = aws_sqs_queue.jobs.url
    }
    "asset-signer" = {
      SIGNING_KEY_SECRET_ARN   = aws_secretsmanager_secret.signing_key.arn
      CF_KEY_PAIR_ID           = var.cloudfront_key_pair_id
      ASSET_COOKIE_TTL_SECONDS = "600"
      AR_URL_TTL_SECONDS       = "300"
    }
    "worker" = {
      QUEUE_URL             = aws_sqs_queue.jobs.url
      CUSTOMER_POOL_ID      = var.customer_pool_id
      SES_CONFIGURATION_SET = var.ses_configuration_set
      EMAIL_FROM            = var.email_from
      KVS_ARN               = var.kvs_arn
      DB_DIRECT_HOST        = var.db_instance_address
      DB_MASTER_SECRET_ARN  = var.db_master_secret_arn
      DB_LOGIN_SECRET_ARNS  = jsonencode(var.db_login_secret_arns)
    }
  }
}

# ---------------------------------------------------------------------------------------------
# KMS key for application data at rest (SQS, application secrets, Lambda environment)
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "app_key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  # SNS (SES event topic) and EventBridge must be able to write to the encrypted queue.
  statement {
    sid       = "AllowServicePublishers"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com", "events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_kms_key" "app" {
  description             = "${var.name} application data (SQS, secrets, Lambda env)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.app_key.json
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.name}-app"
  target_key_id = aws_kms_key.app.key_id
}

# ---------------------------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------------------------

# Shared secret CloudFront adds as an origin header; every function rejects requests without it.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
  keepers = { rotation = var.origin_secret_rotation }
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name                    = "${var.name}/edge/origin-verify"
  description             = "Value of the x-origin-verify header CloudFront sends to API Gateway"
  kms_key_id              = aws_kms_key.app.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id = aws_secretsmanager_secret.origin_verify.id
  secret_string = jsonencode({
    header = var.origin_verify_header
    value  = random_password.origin_verify.result
  })
}

# HMAC keys for session/CSRF tokens (C6) and the share-token pepper.
resource "random_password" "app_keys" {
  for_each = toset(["sessionHmacKey", "csrfHmacKey", "shareTokenPepper"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app_keys" {
  name                    = "${var.name}/app/keys"
  description             = "Application HMAC keys (session, CSRF, share-token pepper)"
  kms_key_id              = aws_kms_key.app.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "app_keys" {
  secret_id     = aws_secretsmanager_secret.app_keys.id
  secret_string = jsonencode({ for k, v in random_password.app_keys : k => v.result })
}

# CloudFront signing private key. Created empty: the operator stores the PEM out of band
# (see infra/README.md) so the private key never enters Terraform state.
resource "aws_secretsmanager_secret" "signing_key" {
  name                    = "${var.name}/edge/cloudfront-signing-key"
  description             = "CloudFront trusted key group private key (PEM) for signed cookies/URLs"
  kms_key_id              = aws_kms_key.app.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

# ---------------------------------------------------------------------------------------------
# SQS jobs queue (worker) + DLQ
# ---------------------------------------------------------------------------------------------

resource "aws_sqs_queue" "jobs_dlq" {
  name                              = "${var.name}-jobs-dlq"
  message_retention_seconds         = 1209600
  kms_master_key_id                 = aws_kms_key.app.arn
  kms_data_key_reuse_period_seconds = 300
}

resource "aws_sqs_queue" "jobs" {
  name                              = "${var.name}-jobs"
  visibility_timeout_seconds        = var.worker_timeout_seconds * 6
  message_retention_seconds         = 345600
  receive_wait_time_seconds         = 20
  kms_master_key_id                 = aws_kms_key.app.arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}

# ---------------------------------------------------------------------------------------------
# Lambda functions
# ---------------------------------------------------------------------------------------------

data "archive_file" "stub" {
  type        = "zip"
  output_path = "${path.root}/.terraform/build/api-stub.zip"

  source {
    filename = "index.mjs"
    content  = <<-JS
      // Bootstrap stub. CI replaces it with services/api/dist/lambda/<function>/index.mjs.
      export const handler = async () => ({
        statusCode: 503,
        headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
        body: JSON.stringify({ type: "about:blank", title: "Not deployed", status: 503, code: "NOT_DEPLOYED" }),
      });
    JS
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "function" {
  for_each           = local.functions
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_lambda_function" "this" {
  for_each = local.functions

  function_name = local.function_names[each.key]
  description   = "saunaklar ${each.key}"
  role          = aws_iam_role.function[each.key].arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = lookup(var.memory_mb, each.key, each.value.memory)
  timeout       = each.value.timeout
  publish       = true
  kms_key_arn   = aws_kms_key.app.arn

  filename         = data.archive_file.stub.output_path
  source_code_hash = data.archive_file.stub.output_base64sha256

  reserved_concurrent_executions = lookup(var.reserved_concurrency, each.key, -1)

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [each.value.worker ? var.worker_security_group_id : var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.common_env, local.function_env[each.key], {
      APP_FUNCTION = each.key
      DB_USER      = each.value.db_user
    })
  }

  tracing_config {
    mode = var.xray_tracing ? "Active" : "PassThrough"
  }

  logging_config {
    log_format            = "JSON"
    log_group             = var.log_group_names[each.key]
    application_log_level = upper(var.log_level)
    system_log_level      = "WARN"
  }

  # The role policy must exist before the function, otherwise the first invocation (e.g. by SQS)
  # fails on missing permissions.
  depends_on = [aws_iam_role_policy.function]

  lifecycle {
    # Code is deployed by CI. Terraform owns configuration only.
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version]
  }
}

resource "aws_lambda_alias" "live" {
  for_each         = local.functions
  name             = "live"
  description      = "Production traffic. CI shifts this alias (optionally weighted for canaries)."
  function_name    = aws_lambda_function.this[each.key].function_name
  function_version = aws_lambda_function.this[each.key].version

  lifecycle {
    ignore_changes = [function_version, routing_config]
  }
}

# ---------------------------------------------------------------------------------------------
# API Gateway HTTP API
# ---------------------------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
  description   = "saunaklar API (only reachable through CloudFront: x-origin-verify is checked by every function)"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit   = var.throttle_burst_limit
    throttling_rate_limit    = var.throttle_rate_limit
    detailed_metrics_enabled = true
  }

  # Tighter limits on unauthenticated, abuse-prone endpoints (WAF adds per-IP limits on top).
  dynamic "route_settings" {
    for_each = { for k, v in var.route_throttles : k => v if contains(keys(var.routes), k) }
    content {
      route_key              = route_settings.key
      throttling_burst_limit = route_settings.value.burst
      throttling_rate_limit  = route_settings.value.rate
    }
  }

  access_log_settings {
    destination_arn = var.api_access_log_group_arn
    # No query strings, cookies or bodies: they can carry tokens or personal data (G10).
    format = jsonencode({
      requestId      = "$context.requestId"
      requestTime    = "$context.requestTimeEpoch"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      path           = "$context.path"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      latency        = "$context.responseLatency"
      integration    = "$context.integration.latency"
      integrationErr = "$context.integration.error"
      ip             = "$context.identity.sourceIp"
    })
  }

  depends_on = [aws_apigatewayv2_route.this]
}

resource "aws_apigatewayv2_integration" "this" {
  for_each               = local.api_functions
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live[each.key].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = min(29000, each.value.timeout * 1000 + 1000)
}

resource "aws_apigatewayv2_route" "this" {
  for_each  = var.routes
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.this[each.value].id}"
}

resource "aws_lambda_permission" "api" {
  for_each      = local.api_functions
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.key].function_name
  qualifier     = aws_lambda_alias.live[each.key].name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------------------------
# Worker triggers: SQS, SES events (SNS), schedules
# ---------------------------------------------------------------------------------------------

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn                   = aws_sqs_queue.jobs.arn
  function_name                      = aws_lambda_alias.live["worker"].arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 1
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.worker_max_sqs_concurrency
  }
}

resource "aws_sns_topic_subscription" "ses_events" {
  topic_arn = var.ses_events_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_alias.live["worker"].arn
}

resource "aws_lambda_permission" "ses_events" {
  statement_id  = "AllowSesEventsTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["worker"].function_name
  qualifier     = aws_lambda_alias.live["worker"].name
  principal     = "sns.amazonaws.com"
  source_arn    = var.ses_events_topic_arn
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_alias.live["worker"].arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule_group" "this" {
  name = var.name
}

resource "aws_scheduler_schedule" "worker" {
  for_each = var.worker_schedules

  name                         = "${var.name}-${each.key}"
  group_name                   = aws_scheduler_schedule_group.this.name
  schedule_expression          = each.value.expression
  schedule_expression_timezone = "Europe/Berlin"
  description                  = "Worker task ${each.value.task}"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_alias.live["worker"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ task = each.value.task })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 300
    }
  }
}

# ---------------------------------------------------------------------------------------------
# Optional: CodeDeploy canaries with automatic rollback on alarms
# ---------------------------------------------------------------------------------------------

resource "aws_codedeploy_app" "this" {
  count            = var.enable_codedeploy ? 1 : 0
  name             = var.name
  compute_platform = "Lambda"
}

data "aws_iam_policy_document" "codedeploy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codedeploy.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codedeploy" {
  count              = var.enable_codedeploy ? 1 : 0
  name               = "${var.name}-codedeploy"
  assume_role_policy = data.aws_iam_policy_document.codedeploy_assume.json
}

resource "aws_iam_role_policy_attachment" "codedeploy" {
  count      = var.enable_codedeploy ? 1 : 0
  role       = aws_iam_role.codedeploy[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSCodeDeployRoleForLambdaLimited"
}

resource "aws_codedeploy_deployment_group" "this" {
  for_each = var.enable_codedeploy ? local.functions : {}

  app_name               = aws_codedeploy_app.this[0].name
  deployment_group_name  = each.key
  service_role_arn       = aws_iam_role.codedeploy[0].arn
  deployment_config_name = var.codedeploy_config_name

  deployment_style {
    deployment_type   = "BLUE_GREEN"
    deployment_option = "WITH_TRAFFIC_CONTROL"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }

  dynamic "alarm_configuration" {
    for_each = length(lookup(var.codedeploy_alarm_names, each.key, [])) > 0 ? [1] : []
    content {
      enabled = true
      alarms  = var.codedeploy_alarm_names[each.key]
    }
  }
}
