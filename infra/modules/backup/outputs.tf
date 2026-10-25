output "plan_id" {
  value = aws_backup_plan.this.id
}

output "primary_vault_name" {
  value = aws_backup_vault.primary.name
}

output "replica_vault_arn" {
  value = aws_backup_vault.replica.arn
}
