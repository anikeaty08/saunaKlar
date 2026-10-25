# Values CI needs (deploy-env.yml reads them with `terraform output -json platform`).

output "name_prefix" {
  value = local.name
}

output "web_bucket" {
  value = module.storage.bucket_names["web"]
}

output "public_bucket" {
  description = "media/ (catalog thumbnails), branding/<slug>/, uploads/ staging."
  value       = module.storage.bucket_names["public"]
}

output "assets_bucket" {
  value = module.storage.bucket_names["assets"]
}

output "distribution_id" {
  value = module.edge.distribution_id
}

output "distribution_domain_name" {
  value = module.edge.distribution_domain_name
}

output "function_names" {
  description = "Function key → Lambda function name (CI deploys services/api/dist/lambda/<key>/)."
  value       = merge(module.api.function_names, { "cognito-custom-message" = module.auth.custom_message_function_name })
}

output "worker_function_name" {
  value = module.api.function_names["worker"]
}

output "codedeploy_app_name" {
  value = module.api.codedeploy_app_name
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "kvs_arn" {
  value = module.edge.kvs_arn
}

output "signing_key_secret_arn" {
  description = "Put the CloudFront signing private key (PEM) here after the first apply."
  value       = module.api.signing_key_secret_arn
}

output "db_proxy_endpoint" {
  value = module.database.proxy_endpoint
}

output "db_master_secret_arn" {
  value = module.database.master_secret_arn
}

output "customer_pool_id" {
  value = module.auth.customer_pool_id
}

output "staff_pool_id" {
  value = module.auth.staff_pool_id
}

output "nat_public_ips" {
  value = module.network.nat_public_ips
}

output "alarm_topic_arn" {
  value = module.observability.alarm_topic_arn
}
