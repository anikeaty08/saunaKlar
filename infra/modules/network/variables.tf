variable "name" {
  description = "Name prefix, e.g. saunaklar-prod."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR (a /16 is expected; subnets are carved as /20s)."
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3 (RDS Multi-AZ needs at least 2)."
  }
}

variable "single_nat_gateway" {
  description = "Use one NAT gateway for all AZs (cheaper, not AZ-resilient). Use false in prod."
  type        = bool
  default     = false
}

variable "interface_endpoints" {
  description = "Interface VPC endpoint service short names."
  type        = list(string)
  default     = ["secretsmanager", "sqs", "kms"]
}

variable "flow_logs_retention_days" {
  description = "Retention for VPC flow logs; 0 disables flow logs."
  type        = number
  default     = 30
}

variable "flow_logs_traffic_type" {
  description = "ACCEPT, REJECT or ALL."
  type        = string
  default     = "REJECT"
}
