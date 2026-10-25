output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  value = aws_subnet.database[*].id
}

output "lambda_security_group_id" {
  value = aws_security_group.lambda.id
}

output "worker_security_group_id" {
  value = aws_security_group.worker.id
}

output "nat_public_ips" {
  description = "Egress IPs of the Lambdas (useful for allow-lists at third parties)."
  value       = aws_eip.nat[*].public_ip
}
