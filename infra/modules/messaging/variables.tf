variable "name" {
  type = string
}

variable "email_domain" {
  description = "Sending domain (A11), e.g. mail.example.com. Must be inside zone_id."
  type        = string
}

variable "zone_id" {
  description = "Route 53 zone that holds email_domain."
  type        = string
}

variable "mail_from_subdomain" {
  description = "Custom MAIL FROM is <mail_from_subdomain>.<email_domain> (SPF alignment)."
  type        = string
  default     = "bounce"
}

variable "dmarc_policy" {
  description = "DMARC TXT value for _dmarc.<email_domain>; null to manage it elsewhere."
  type        = string
  default     = "v=DMARC1; p=quarantine; adkim=s; aspf=r; pct=100"
}
