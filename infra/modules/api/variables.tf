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

variable "public_bucket_name" {
  description = "Public bucket (branding/, media/, uploads/ staging). S3_ASSETS_BUCKET for the admin functions."
  type        = string
}

variable "public_bucket_arn" {
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

variable "mail_from_domain" {
  description = "Platform mail domain; From is always no-reply@<domain> (MAIL_FROM_DOMAIN)."
  type        = string
}

variable "mail_default_from_name" {
  description = "From display name when no reseller brand applies (MAIL_DEFAULT_FROM_NAME)."
  type        = string
  default     = "Saunaklar"
}

variable "totp_issuer" {
  description = "Issuer shown in authenticator apps for staff MFA (TOTP_ISSUER)."
  type        = string
  default     = "Saunaklar"
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
    "ANY /api/assets/{proxy+}"     = { burst = 200, rate = 100 }
  }
}

# --- routing ---------------------------------------------------------------------------------

variable "routes" {
  description = "HTTP API route key → function key. Mirrors app.ts: each function mounts only its own routes."
  type        = map(string)
  default = {
    # public-catalog: routes/catalog.ts
    "GET /api/health"           = "public-catalog"
    "GET /api/tenant"           = "public-catalog"
    "GET /api/catalog"          = "public-catalog"
    "GET /api/catalog/{proxy+}" = "public-catalog"
    "GET /api/rooms"            = "public-catalog"
    "GET /api/shared/{token}"   = "public-catalog"
    # asset-signer: routes/assets.ts (/api/assets/session, /api/assets/ar)
    "ANY /api/assets/{proxy+}" = "asset-signer"
    # customer: routes/auth.ts, account.ts, configurations.ts (incl. C5 claim)
    "POST /api/shared/{token}/claim"   = "customer"
    "ANY /api/auth/{proxy+}"           = "customer"
    "ANY /api/me"                      = "customer"
    "ANY /api/me/{proxy+}"             = "customer"
    "ANY /api/configurations"          = "customer"
    "ANY /api/configurations/{proxy+}" = "customer"
    # reseller-admin: routes/staffAuth.ts + admin.ts. Staff login is served here for both the
    # tenant hosts and the admin host (manufacturer-admin also mounts it, but one route can only
    # target one function).
    "ANY /api/auth/staff/{proxy+}" = "reseller-admin"
    "ANY /api/admin/{proxy+}"      = "reseller-admin"
    # manufacturer-admin
    "ANY /api/manufacturer/{proxy+}" = "manufacturer-admin"
  }

  validation {
    condition = alltrue([for f in values(var.routes) :
    contains(["public-catalog", "customer", "reseller-admin", "manufacturer-admin", "asset-signer"], f)])
    error_message = "Routes must target an API function (not the worker)."
  }
}

variable "worker_schedules" {
  description = "EventBridge rule suffix → schedule. The worker maps the suffix to a job (outbox-sweep, retention)."
  type        = map(string)
  default = {
    "outbox-sweep" = "rate(1 minute)"
    "retention"    = "cron(15 2 * * ? *)"
  }
}
# --- secrets ---------------------------------------------------------------------------------

variable "origin_secret_header" {
  description = "Header CloudFront adds and middleware/core.ts checks."
  type        = string
  default     = "x-origin-secret"
}

variable "origin_secret_rotation" {
  description = "Change this value to rotate the CloudFront origin secret."
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
