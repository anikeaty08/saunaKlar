output "identity_arn" {
  value = aws_sesv2_email_identity.domain.arn
}

output "email_domain" {
  value = var.email_domain
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "configuration_set_arn" {
  value = aws_sesv2_configuration_set.this.arn
}

output "events_topic_arn" {
  value = aws_sns_topic.ses_events.arn
}
