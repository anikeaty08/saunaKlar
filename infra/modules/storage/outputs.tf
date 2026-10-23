output "bucket_names" {
  description = "Bucket key (web, branding, assets, uploads) → bucket name."
  value       = { for k, b in aws_s3_bucket.this : k => b.id }
}

output "bucket_arns" {
  value = { for k, b in aws_s3_bucket.this : k => b.arn }
}

output "bucket_regional_domain_names" {
  value = { for k, b in aws_s3_bucket.this : k => b.bucket_regional_domain_name }
}

output "assets_kms_key_arn" {
  value = aws_kms_key.assets.arn
}

output "assets_replica_bucket" {
  value = var.enable_replication ? aws_s3_bucket.assets_replica[0].id : null
}
