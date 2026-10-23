variable "name" {
  type = string
}

variable "environment" {
  type = string
}

variable "platform_domain" {
  type = string
}

variable "admin_host" {
  type = string
}

variable "log_level" {
  type    = string
  default = "info"
}

# --- network ---------------------------------------------------------------------------------

variable "private_subnet_ids" {
  type = list(string)
}

variable "lambda_security_group_id" {
  type = string
}

variable "worker_security_group_id" {
  type = string
}

# --- database --------------------------------------------------------------------------------

variable "db_proxy_endpoint" {
  type = string
}

variable "db_proxy_resource_id" {
  type = string
}

variable "db_name" {
  type = string
}

variable "db_instance_address" {
  description = "Direct instance endpoint, used only by the worker's migrate task."
  type        = string
}

variable "db_master_secret_arn" {
  type = string
}

variable "db_login_secret_arns" {
  description = "DB login user → secret ARN (the migrate task syncs role passwords from these)."
  type        = map(string)
}

variable "db_kms_key_arn" {
  type = string
}

# --- auth ------------------------------------------------------------------------------------

variable "customer_pool_id" {
  type = string
}

variable "customer_pool_arn" {
  type = string
}

variable "customer_client_id" {
  type = string
}

variable "staff_pool_id" {
  type = string
}

variable "staff_pool_arn" {
  type = string
}

variable "staff_client_id" {
  type = string
}

# --- storage / edge / messaging --------------------------------------------------------------

variable "uploads_bucket_name" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}

variable "branding_bucket_name" {
  type = string
}

variable "branding_bucket_arn" {
  type = string
}

variable "kvs_arn" {
  description = "CloudFront KeyValueStore ARN (tenant slug → status)."
  type        = string
}

variable "cloudfront_key_pair_id" {
  description = "Id of the active CloudFront public key used for signed cookies/URLs."
  type        = string
}

variable "ses_identity_arn" {
  type = string
}

variable "ses_configuration_set" {
  type = string
}

variable "ses_configuration_set_arn" {
  type = string
}

variable "email_from" {
  type = string
}

variable "ses_events_topic_arn" {
  type = string
}

# --- observability ---------------------------------------------------------------------------

variable "log_group_names" {
  description = "Function key → CloudWatch log group name."
  type        = map(string)
}

variable "log_group_arns" {
  description = "Function key → CloudWatch log group ARN."
  type        = map(string)
}

variable "api_access_log_group_arn" {
  type = string
}

variable "xray_tracing" {
  type    = bool
  default = true
}

# --- sizing ----------------------------------------------------------------------------------

variable "memory_mb" {
  description = "Override memory per function key."
  type        = map(number)
  default     = {}
}

variable "reserved_concurrency" {
  description = "Reserved concurrency per function key (-1 = unreserved). Protects the database."
  type        = map(number)
  default = {
    "public-catalog"     = 100
    "customer"           = 100
    "reseller-admin"     = 30
    "manufacturer-admin" = 10
    "asset-signer"       = 50
    "worker"             = 10
  }
}

variable "worker_timeout_seconds" {
  description = "Worker timeout; long enough for the migrate task. SQS visibility = 6x this."
  type        = number
  default     = 300
}

variable "worker_max_sqs_concurrency" {
  type    = number
  default = 5
}

variable "throttle_burst_limit" {
  type    = number
  default = 1000
}

variable "throttle_rate_limit" {
  type    = number
  default = 500
}

variable "route_throttles" {
  description = "Per-route API Gateway throttles (route key → {burst, rate})."
  type        = map(object({ burst = number, rate = number }))
  default = {
    "ANY /api/auth/{proxy+}"       = { burst = 100, rate = 50 }
    "ANY /api/auth/staff/{proxy+}" = { burst = 20, rate = 10 }
    "POST /api/assets/session"     = { burst = 200, rate = 100 }
  }
}

# --- routing ---------------------------------------------------------------------------------

variable "routes" {
  description = "HTTP API route key → function key (design 13). Most specific route wins."
  type        = map(string)
  default = {
    "GET /api/health"                  = "public-catalog"
    "GET /api/tenant"                  = "public-catalog"
    "GET /api/catalog"                 = "public-catalog"
    "GET /api/catalog/{proxy+}"        = "public-catalog"
    "GET /api/rooms"                   = "public-catalog"
    "GET /api/shared/{token}"          = "asset-signer"
    "POST /api/assets/session"         = "asset-signer"
    "POST /api/shared/{token}/claim"   = "customer"
    "ANY /api/auth/{proxy+}"           = "customer"
    "ANY /api/me"                      = "customer"
    "ANY /api/me/{proxy+}"             = "customer"
    "ANY /api/configurations"          = "customer"
    "ANY /api/configurations/{proxy+}" = "customer"
    "ANY /api/auth/staff/{proxy+}"     = "reseller-admin"
    "ANY /api/admin/{proxy+}"          = "reseller-admin"
    "ANY /api/manufacturer/{proxy+}"   = "manufacturer-admin"
  }

  validation {
    condition = alltrue([for f in values(var.routes) :
    contains(["public-catalog", "customer", "reseller-admin", "manufacturer-admin", "asset-signer"], f)])
    error_message = "Routes must target an API function (not the worker)."
  }
}

variable "worker_schedules" {
  description = "EventBridge Scheduler entries invoking the worker with {\"task\": <task>}."
  type        = map(object({ expression = string, task = string }))
  default = {
    "outbox-sweep"  = { expression = "rate(1 minute)", task = "outbox-sweep" }
    "kvs-reconcile" = { expression = "rate(1 hour)", task = "kvs-reconcile" }
    "retention"     = { expression = "cron(15 3 * * ? *)", task = "retention" }
  }
}

# --- secrets ---------------------------------------------------------------------------------

variable "origin_verify_header" {
  type    = string
  default = "x-origin-verify"
}

variable "origin_secret_rotation" {
  description = "Change this value to rotate the CloudFront origin secret (functions accept current + previous)."
  type        = string
  default     = "1"
}

variable "secret_recovery_window_days" {
  type    = number
  default = 30
}

# --- canary deployments ----------------------------------------------------------------------

variable "enable_codedeploy" {
  description = "Create CodeDeploy app/groups for alias canaries with alarm rollback."
  type        = bool
  default     = false
}

variable "codedeploy_config_name" {
  type    = string
  default = "CodeDeployDefault.LambdaCanary10Percent5Minutes"
}

variable "codedeploy_alarm_names" {
  description = "Function key → CloudWatch alarm names that stop and roll back a deployment."
  type        = map(list(string))
  default     = {}
}
