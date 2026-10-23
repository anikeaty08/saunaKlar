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

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "ses_identity_arn" {
  description = "SES identity used to send Cognito mail. null = Cognito default sender (dev only; 50 mails/day)."
  type        = string
  default     = null
}

variable "ses_configuration_set" {
  description = "SES configuration set name for Cognito mail (bounce/complaint tracking)."
  type        = string
  default     = null
}

variable "email_from" {
  description = "From header for Cognito mail, e.g. \"Sauna Configurator <no-reply@mail.example.com>\"."
  type        = string
  default     = null
}

variable "custom_message_log_group_name" {
  type = string
}

variable "custom_message_log_group_arn" {
  type = string
}

variable "customer_access_token_minutes" {
  description = "Customer access/id token validity (5-1440 minutes)."
  type        = number
  default     = 60
}

variable "customer_refresh_token_days" {
  description = "Customer refresh token validity in days."
  type        = number
  default     = 30
}

variable "staff_access_token_minutes" {
  type    = number
  default = 15
}

variable "staff_refresh_token_hours" {
  description = "Staff refresh token validity (short sessions; staff log in daily)."
  type        = number
  default     = 12
}
