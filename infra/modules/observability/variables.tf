variable "name" {
  type = string
}

variable "function_keys" {
  description = "Lambda function keys (used for log group names before the functions exist)."
  type        = list(string)
  default     = ["public-catalog", "customer", "reseller-admin", "manufacturer-admin", "asset-signer", "worker"]
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_emails" {
  type    = list(string)
  default = []
}

# --- resources to watch ----------------------------------------------------------------------

variable "function_names" {
  description = "Function key → Lambda function name."
  type        = map(string)
}

variable "api_id" {
  type = string
}

variable "db_instance_identifier" {
  type = string
}

variable "db_proxy_name" {
  type = string
}

variable "jobs_queue_name" {
  type = string
}

variable "jobs_dlq_name" {
  type = string
}

variable "distribution_id" {
  type = string
}

variable "web_acl_name" {
  type = string
}

variable "certificate_arn" {
  type = string
}

# --- thresholds ------------------------------------------------------------------------------

variable "api_5xx_rate_percent" {
  type    = number
  default = 1
}

variable "api_p95_latency_ms" {
  type    = number
  default = 1000
}

variable "lambda_error_threshold" {
  type    = number
  default = 5
}

variable "rds_min_freeable_memory_bytes" {
  type    = number
  default = 536870912
}

variable "rds_min_free_storage_bytes" {
  type    = number
  default = 10737418240
}

variable "rds_max_connections" {
  type    = number
  default = 400
}

variable "proxy_pinned_threshold" {
  type    = number
  default = 10
}

variable "ses_bounce_rate_threshold" {
  type    = number
  default = 0.04
}

variable "ses_complaint_rate_threshold" {
  type    = number
  default = 0.001
}

variable "cloudfront_5xx_rate_percent" {
  type    = number
  default = 1
}

variable "waf_blocked_threshold" {
  type    = number
  default = 5000
}

# --- budgets ---------------------------------------------------------------------------------

variable "monthly_budget_usd" {
  description = "Monthly cost budget in USD (0 disables)."
  type        = number
  default     = 0
}

variable "budget_emails" {
  type    = list(string)
  default = []
}
