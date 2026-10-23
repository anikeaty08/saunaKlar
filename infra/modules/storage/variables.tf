variable "name" {
  type = string
}

variable "platform_domain" {
  type = string
}

variable "admin_host" {
  type = string
}

variable "extra_upload_origins" {
  description = "Additional origins allowed to PUT to uploads/ in the public bucket."
  type        = list(string)
  default     = []
}

variable "cloudfront_distribution_arn" {
  description = "Distribution allowed to read the web, public and assets buckets via OAC."
  type        = string
}

variable "enable_replication" {
  description = "Replicate protected assets to the replica region (eu-west-1)."
  type        = bool
  default     = true
}

variable "noncurrent_version_days" {
  type    = number
  default = 90
}

variable "force_destroy" {
  description = "Allow destroying non-empty buckets (dev only). Never applies to the assets bucket."
  type        = bool
  default     = false
}
