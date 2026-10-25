# Composition of the whole stack for one environment. Each env (infra/envs/<env>) configures the
# providers and calls this module with its sizing, so dev/staging/prod cannot drift structurally.

locals {
  name = "${var.project}-${var.environment}"
}

module "network" {
  source = "../network"

  name                     = local.name
  cidr_block               = var.vpc_cidr
  single_nat_gateway       = var.single_nat_gateway
  flow_logs_retention_days = var.flow_logs_retention_days
}

module "observability" {
  source    = "../observability"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name               = local.name
  log_retention_days = var.log_retention_days
  alarm_emails       = var.alarm_emails
  monthly_budget_usd = var.monthly_budget_usd
  budget_emails      = var.budget_emails

  function_names         = module.api.function_names
  api_id                 = module.api.api_id
  admin_api_id           = module.api.admin_api_id
  db_instance_identifier = module.database.instance_identifier
  db_proxy_name          = module.database.proxy_name
  jobs_queue_name        = module.api.jobs_queue_name
  jobs_dlq_name          = module.api.jobs_dlq_name
  distribution_id        = module.edge.distribution_id
  web_acl_name           = module.edge.web_acl_name
  certificate_arn        = module.edge.certificate_arn
}

module "database" {
  source = "../database"

  name                             = local.name
  vpc_id                           = module.network.vpc_id
  vpc_cidr                         = module.network.vpc_cidr
  database_subnet_ids              = module.network.database_subnet_ids
  private_subnet_ids               = module.network.private_subnet_ids
  proxy_client_security_group_ids  = { lambda = module.network.lambda_security_group_id, worker = module.network.worker_security_group_id }
  direct_client_security_group_ids = { worker = module.network.worker_security_group_id }

  instance_class                      = var.db_instance_class
  multi_az                            = var.db_multi_az
  allocated_storage_gb                = var.db_allocated_storage_gb
  max_allocated_storage_gb            = var.db_max_allocated_storage_gb
  backup_retention_days               = var.db_backup_retention_days
  deletion_protection                 = var.deletion_protection
  performance_insights_retention_days = var.db_performance_insights_retention_days
}

module "messaging" {
  source = "../messaging"

  name         = local.name
  email_domain = var.email_domain
  zone_id      = var.zone_id
}

module "auth" {
  source = "../auth"

  name                          = local.name
  environment                   = var.environment
  platform_domain               = var.platform_domain
  admin_host                    = var.admin_host
  deletion_protection           = var.deletion_protection
  ses_identity_arn              = module.messaging.identity_arn
  ses_configuration_set         = module.messaging.configuration_set_name
  email_from                    = "${var.mail_from_name} <no-reply@${var.email_domain}>"
  mail_default_from_name        = var.mail_from_name
  custom_message_log_group_name = module.observability.lambda_log_group_names["cognito-custom-message"]
  custom_message_log_group_arn  = module.observability.lambda_log_group_arns["cognito-custom-message"]
  customer_access_token_minutes = var.customer_access_token_minutes
  customer_refresh_token_days   = var.customer_refresh_token_days
  staff_access_token_minutes    = var.staff_access_token_minutes
  staff_refresh_token_hours     = var.staff_refresh_token_hours
}

module "storage" {
  source    = "../storage"
  providers = { aws = aws, aws.replica = aws.replica }

  name                        = local.name
  platform_domain             = var.platform_domain
  admin_host                  = var.admin_host
  cloudfront_distribution_arn = module.edge.distribution_arn
  enable_replication          = var.enable_asset_replication
  force_destroy               = !var.deletion_protection
}

module "api" {
  source = "../api"

  name            = local.name
  environment     = var.environment
  platform_domain = var.platform_domain
  admin_host      = var.admin_host

  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  worker_security_group_id = module.network.worker_security_group_id

  db_proxy_endpoint    = module.database.proxy_endpoint
  db_proxy_resource_id = module.database.proxy_resource_id
  db_name              = module.database.database_name
  db_instance_address  = module.database.instance_address
  db_master_secret_arn = module.database.master_secret_arn
  db_login_secret_arns = module.database.login_secret_arns
  db_kms_key_arn       = module.database.kms_key_arn

  customer_pool_id   = module.auth.customer_pool_id
  customer_pool_arn  = module.auth.customer_pool_arn
  customer_client_id = module.auth.customer_client_id
  staff_pool_id      = module.auth.staff_pool_id
  staff_pool_arn     = module.auth.staff_pool_arn
  staff_client_id    = module.auth.staff_client_id

  public_bucket_name = module.storage.bucket_names["public"]
  public_bucket_arn  = module.storage.bucket_arns["public"]

  kvs_arn                = module.edge.kvs_arn
  cloudfront_key_pair_id = module.edge.signing_key_pair_id

  ses_identity_arn          = module.messaging.identity_arn
  ses_configuration_set     = module.messaging.configuration_set_name
  ses_configuration_set_arn = module.messaging.configuration_set_arn
  ses_events_topic_arn      = module.messaging.events_topic_arn
  mail_from_domain          = var.email_domain
  mail_default_from_name    = var.mail_from_name

  log_group_names          = module.observability.lambda_log_group_names
  log_group_arns           = module.observability.lambda_log_group_arns
  api_access_log_group_arn = module.observability.api_access_log_group_arn

  reserved_concurrency        = var.lambda_reserved_concurrency
  secret_recovery_window_days = var.deletion_protection ? 30 : 0
  enable_codedeploy           = var.enable_codedeploy
  codedeploy_alarm_names      = var.enable_codedeploy ? module.observability.canary_alarm_names : {}
}

module "edge" {
  source    = "../edge"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name            = local.name
  platform_domain = var.platform_domain
  admin_host      = var.admin_host
  zone_id         = var.zone_id
  admin_zone_id   = var.admin_zone_id

  bucket_regional_domain_names = module.storage.bucket_regional_domain_names
  api_origin_domain            = module.api.api_origin_domain
  admin_api_origin_domain      = module.api.admin_api_origin_domain
  origin_secret_header         = module.api.origin_secret_header
  origin_secret_value          = module.api.origin_secret_value

  signing_public_keys = var.signing_public_keys
  active_signing_key  = var.active_signing_key
  price_class         = var.cloudfront_price_class
  enable_bot_control  = var.enable_bot_control
}

module "backup" {
  source    = "../backup"
  providers = { aws = aws, aws.replica = aws.replica }
  count     = var.enable_backup ? 1 : 0

  name                          = local.name
  resource_arns                 = [module.database.instance_arn]
  retention_days                = var.backup_retention_days
  copy_retention_days           = var.backup_retention_days
  vault_lock_min_retention_days = var.backup_vault_lock_days
}
