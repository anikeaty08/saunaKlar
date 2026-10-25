output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "https://<id>.execute-api.<region>.amazonaws.com"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_origin_domain" {
  value = replace(aws_apigatewayv2_api.this.api_endpoint, "https://", "")
}

output "admin_api_id" {
  value = aws_apigatewayv2_api.admin.id
}

output "admin_api_origin_domain" {
  value = replace(aws_apigatewayv2_api.admin.api_endpoint, "https://", "")
}

output "function_names" {
  description = "Function key → Lambda function name."
  value       = { for k, f in aws_lambda_function.this : k => f.function_name }
}

output "function_arns" {
  value = { for k, f in aws_lambda_function.this : k => f.arn }
}

output "role_arns" {
  value = { for k, r in aws_iam_role.function : k => r.arn }
}

output "jobs_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "jobs_queue_name" {
  value = aws_sqs_queue.jobs.name
}

output "jobs_dlq_name" {
  value = aws_sqs_queue.jobs_dlq.name
}

output "origin_secret_header" {
  value = var.origin_secret_header
}

output "origin_secret_value" {
  value     = random_password.origin.result
  sensitive = true
}

output "signing_key_secret_arn" {
  value = aws_secretsmanager_secret.signing_key.arn
}

output "app_kms_key_arn" {
  value = aws_kms_key.app.arn
}

output "codedeploy_app_name" {
  value = var.enable_codedeploy ? aws_codedeploy_app.this[0].name : null
}
