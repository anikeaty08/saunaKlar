# dev environment. Structure lives in modules/platform; only sizing differs per environment.

module "platform" {
  source = "../../modules/platform"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.replica   = aws.replica
  }

  environment = var.environment

  platform_domain = var.platform_domain
  admin_host      = var.admin_host
  zone_id         = var.zone_id
  admin_zone_id   = var.admin_zone_id
  email_domain    = var.email_domain
  email_from      = var.email_from

  signing_public_keys = var.signing_public_keys
  active_signing_key  = var.active_signing_key

  # --- sizing for dev ---------------------------------------------------------------------
  vpc_cidr                 = "10.10.0.0/16"
  single_nat_gateway       = true
  flow_logs_retention_days = 7

  db_instance_class                      = "db.t4g.medium"
  db_multi_az                            = false
  db_allocated_storage_gb                = 20
  db_max_allocated_storage_gb            = 100
  db_backup_retention_days               = 7
  db_performance_insights_retention_days = 7
  deletion_protection                    = false

  lambda_reserved_concurrency = {
    "public-catalog"     = -1
    "customer"           = -1
    "reseller-admin"     = -1
    "manufacturer-admin" = -1
    "asset-signer"       = -1
    "worker"             = -1
  }
  enable_codedeploy = false

  enable_asset_replication = false
  enable_bot_control       = false
  enable_backup            = false
  backup_retention_days    = 7
  backup_vault_lock_days   = 0

  log_retention_days = 14
  alarm_emails       = var.alarm_emails
  monthly_budget_usd = var.monthly_budget_usd
  budget_emails      = var.budget_emails
}
