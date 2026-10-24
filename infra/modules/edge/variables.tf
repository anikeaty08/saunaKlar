variable "name" {
  type = string
}

variable "platform_domain" {
  description = "Reseller storefronts live on {slug}.<platform_domain>."
  type        = string
}

variable "admin_host" {
  description = "Manufacturer admin host (C6: may be a different registrable domain)."
  type        = string
}

variable "zone_id" {
  description = "Route 53 hosted zone of platform_domain."
  type        = string
}

variable "admin_zone_id" {
  description = "Route 53 zone of admin_host when it is not inside zone_id (null = zone_id)."
  type        = string
  default     = null
}

variable "bucket_regional_domain_names" {
  description = "Bucket key (web, public, assets) → regional domain name."
  type        = map(string)
}

variable "api_origin_domain" {
  description = "API Gateway host name (<id>.execute-api.<region>.amazonaws.com)."
  type        = string
}

variable "admin_api_origin_domain" {
  description = "Admin-host API Gateway host name (manufacturer-admin only)."
  type        = string
}

variable "origin_secret_header" {
  type = string
}

variable "origin_secret_value" {
  type      = string
  sensitive = true
}

variable "signing_public_keys" {
  description = "Key name → PEM public key for signed cookies/URLs. Two entries during rotation."
  type        = map(string)

  validation {
    condition     = length(var.signing_public_keys) >= 1
    error_message = "At least one CloudFront signing public key is required."
  }
}

variable "active_signing_key" {
  description = "Name (key of signing_public_keys) the asset-signer currently signs with."
  type        = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "origin_shield_region" {
  description = "Origin Shield region for the assets origin (null disables)."
  type        = string
  default     = null
}

variable "geo_allow_list" {
  description = "ISO country codes to allow (empty = no geo restriction)."
  type        = list(string)
  default     = []
}

variable "content_security_policy" {
  description = "CSP for every response. 'wasm-unsafe-eval' is required by the Draco/Basis decoders."
  type        = string
  default     = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
}

variable "enable_bot_control" {
  type    = bool
  default = true
}

variable "rate_limits" {
  description = "Per-IP request limits per 5-minute window."
  type = object({
    auth          = number
    shared        = number
    asset_session = number
    assets        = number
  })
  default = {
    auth          = 100
    shared        = 300
    asset_session = 200
    assets        = 3000
  }
}

variable "waf_log_retention_days" {
  type    = number
  default = 90
}
