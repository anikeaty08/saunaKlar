variable "project" {
  type    = string
  default = "saunaklar"
}

variable "environment" {
  description = "dev, staging or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

# --- domains ---------------------------------------------------------------------------------

variable "platform_domain" {
  description = "Storefronts are {slug}.<platform_domain> (A13)."
  type        = string
}

variable "admin_host" {
  description = "Manufacturer admin host, e.g. admin.<platform_domain> or a separate domain (C6)."
  type        = string
}

variable "zone_id" {
  description = "Route 53 hosted zone for platform_domain (and email_domain)."
  type        = string
}

variable "admin_zone_id" {
  description = "Route 53 zone for admin_host when it is not in zone_id."
  type        = string
  default     = null
}

variable "email_domain" {
  description = "SES sending domain, inside zone_id (e.g. mail.<platform_domain>)."
  type        = string
}

variable "mail_from_name" {
  description = "Default From display name; mail is always sent from no-reply@<email_domain>."
  type        = string
  default     = "Saunaklar"
}

# --- network ---------------------------------------------------------------------------------

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "single_nat_gateway" {
  type    = bool
  default = false
}

variable "flow_logs_retention_days" {
  type    = number
  default = 30
}

# --- database --------------------------------------------------------------------------------

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "db_max_allocated_storage_gb" {
  type    = number
  default = 1000
}

variable "db_backup_retention_days" {
  description = "PITR window in days."
  type        = number
  default     = 14
}

variable "db_performance_insights_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  description = "Protects RDS, Cognito pools, secrets and buckets from deletion."
  type        = bool
  default     = true
}

# --- auth ------------------------------------------------------------------------------------

variable "customer_access_token_minutes" {
  type    = number
  default = 60
}

variable "customer_refresh_token_days" {
  type    = number
  default = 30
}

variable "staff_access_token_minutes" {
  type    = number
  default = 15
}

variable "staff_refresh_token_hours" {
  type    = number
  default = 12
}

# --- api / edge ------------------------------------------------------------------------------

variable "lambda_reserved_concurrency" {
  description = "Function key → reserved concurrency (-1 = unreserved)."
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

variable "enable_codedeploy" {
  type    = bool
  default = false
}

variable "signing_public_keys" {
  description = "Key name → CloudFront signing public key (PEM). The private key goes to Secrets Manager."
  type        = map(string)
}

variable "active_signing_key" {
  type = string
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "enable_bot_control" {
  type    = bool
  default = true
}

variable "enable_asset_replication" {
  type    = bool
  default = true
}

# --- observability / backup ------------------------------------------------------------------

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_emails" {
  type    = list(string)
  default = []
}

variable "monthly_budget_usd" {
  type    = number
  default = 0
}

variable "budget_emails" {
  type    = list(string)
  default = []
}

variable "enable_backup" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "backup_vault_lock_days" {
  type    = number
  default = 0
}
