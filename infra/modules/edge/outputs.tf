output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "kvs_arn" {
  value = aws_cloudfront_key_value_store.tenants.arn
}

output "kvs_id" {
  value = local.kvs_id
}

output "signing_key_pair_id" {
  description = "CloudFront public key id the asset-signer puts in CloudFront-Key-Pair-Id."
  value       = aws_cloudfront_public_key.signing[var.active_signing_key].id
}

output "web_acl_arn" {
  value = aws_wafv2_web_acl.this.arn
}

output "web_acl_name" {
  value = aws_wafv2_web_acl.this.name
}

output "certificate_arn" {
  value = aws_acm_certificate.this.arn
}

output "tenant_router_function_name" {
  value = aws_cloudfront_function.tenant_router.name
}
