output "customer_pool_id" {
  value = aws_cognito_user_pool.customers.id
}

output "customer_pool_arn" {
  value = aws_cognito_user_pool.customers.arn
}

output "customer_client_id" {
  value = aws_cognito_user_pool_client.customers.id
}

output "staff_pool_id" {
  value = aws_cognito_user_pool.staff.id
}

output "staff_pool_arn" {
  value = aws_cognito_user_pool.staff.arn
}

output "staff_client_id" {
  value = aws_cognito_user_pool_client.staff.id
}

output "custom_message_function_name" {
  value = aws_lambda_function.custom_message.function_name
}
