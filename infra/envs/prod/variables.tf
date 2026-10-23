variable "environment" {
  type    = string
  default = "prod"
}

variable "allowed_account_ids" {
  description = "Guard against applying to the wrong AWS account (the prod account id)."
  type        = list(string)
  default     = null
}

variable "platform_domain" {
  description = "Storefront domain: resellers are {slug}.<platform_domain>."
  type        = string
}

variable "admin_host" {
  description = "Manufacturer admin host (may be another registrable domain, C6)."
  type        = string
}

variable "zone_id" {
  description = "Route 53 hosted zone id of platform_domain."
  type        = string
}

variable "admin_zone_id" {
  description = "Route 53 zone id of admin_host if it is not inside zone_id."
  type        = string
  default     = null
}

variable "email_domain" {
  description = "SES sending domain inside zone_id, e.g. mail.<platform_domain>."
  type        = string
}

variable "mail_from_name" {
  description = "From display name for platform mail (sent from no-reply@<email_domain>)."
  type        = string
  default     = "Saunaklar"
}

variable "signing_public_keys" {
  description = "Key name → CloudFront signing public key (PEM)."
  type        = map(string)
}

variable "active_signing_key" {
  description = "Key name the asset-signer signs with."
  type        = string
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
