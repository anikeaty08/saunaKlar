variable "name" {
  type = string
}

variable "resource_arns" {
  description = "Resources to back up (the RDS instance)."
  type        = list(string)
}

variable "retention_days" {
  description = "Retention of the daily backups in the primary region."
  type        = number
  default     = 35
}

variable "copy_retention_days" {
  description = "Retention of the cross-region copies (eu-west-1)."
  type        = number
  default     = 35
}

variable "vault_lock_min_retention_days" {
  description = "Vault Lock (governance) minimum retention on the replica vault; 0 disables."
  type        = number
  default     = 0
}
