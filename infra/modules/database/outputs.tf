output "instance_identifier" {
  value = aws_db_instance.this.identifier
}

output "instance_arn" {
  value = aws_db_instance.this.arn
}

output "instance_address" {
  description = "Direct instance endpoint (migrations only)."
  value       = aws_db_instance.this.address
}

output "database_name" {
  value = var.database_name
}

output "master_secret_arn" {
  description = "RDS-managed master user secret (owner of the schema; used by the migrate task)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "proxy_name" {
  value = aws_db_proxy.this.name
}

output "proxy_endpoint" {
  value = aws_db_proxy.this.endpoint
}

output "proxy_resource_id" {
  description = "prx-… id used in rds-db:connect resource ARNs."
  value       = local.proxy_resource_id
}

output "login_users" {
  description = "Map of DB login user → application role."
  value       = local.login_users
}

output "login_secret_arns" {
  description = "Map of DB login user → Secrets Manager ARN."
  value       = { for k, s in aws_secretsmanager_secret.login : k => s.arn }
}

output "kms_key_arn" {
  value = aws_kms_key.db.arn
}
