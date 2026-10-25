variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "database_subnet_ids" {
  description = "Isolated subnets for the RDS instance."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets for RDS Proxy (same subnets as the Lambdas)."
  type        = list(string)
}

variable "proxy_client_security_group_ids" {
  description = "Static name → security group id allowed to connect to RDS Proxy (map keys must be known at plan time)."
  type        = map(string)
}

variable "direct_client_security_group_ids" {
  description = "Static name → security group id allowed to connect to the instance directly (migrations only)."
  type        = map(string)
  default     = {}
}

variable "engine_version" {
  description = "PostgreSQL version. A major version only (\"16\") lets AWS pick the current minor."
  type        = string
  default     = "16"
}

variable "instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "database_name" {
  type    = string
  default = "sauna"
}

variable "allocated_storage_gb" {
  type    = number
  default = 100
}

variable "max_allocated_storage_gb" {
  description = "Upper bound for gp3 storage autoscaling."
  type        = number
  default     = 1000
}

variable "backup_retention_days" {
  description = "Automated backup / point-in-time recovery window (design 19: 14-35 days)."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be 1-35."
  }
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "apply_immediately" {
  type    = bool
  default = false
}

variable "performance_insights_retention_days" {
  description = "7 (free tier) or a multiple of 31."
  type        = number
  default     = 7
}

variable "enhanced_monitoring_interval" {
  description = "Seconds between Enhanced Monitoring samples (0 disables)."
  type        = number
  default     = 60
}

variable "log_min_duration_statement_ms" {
  type    = number
  default = 500
}

variable "statement_timeout_ms" {
  description = "Server-side statement timeout. Migrations override it per session."
  type        = number
  default     = 15000
}

variable "proxy_max_connections_percent" {
  type    = number
  default = 90
}
