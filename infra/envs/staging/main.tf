# staging environment. Structure lives in modules/platform; only sizing differs per environment.

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
  mail_from_name  = var.mail_from_name

  signing_public_keys = var.signing_public_keys
  active_signing_key  = var.active_signing_key

  # --- sizing for staging ---------------------------------------------------------------------
  vpc_cidr                 = "10.20.0.0/16"
  single_nat_gateway       = true
  flow_logs_retention_days = 14

  db_instance_class                      = "db.t4g.large"
  db_multi_az                            = true
  db_allocated_storage_gb                = 50
  db_max_allocated_storage_gb            = 200
  db_backup_retention_days               = 7
  db_performance_insights_retention_days = 7
  deletion_protection                    = true

  lambda_reserved_concurrency = {
    "public-catalog"     = 50
    "customer"           = 50
    "reseller-admin"     = 15
    "manufacturer-admin" = 5
    "asset-signer"       = 25
    "worker"             = 5
  }
  enable_codedeploy = false

  enable_asset_replication = true
  enable_bot_control       = true
  enable_backup            = true
  backup_retention_days    = 14
  backup_vault_lock_days   = 0

  log_retention_days = 30
  alarm_emails       = var.alarm_emails
  monthly_budget_usd = var.monthly_budget_usd
  budget_emails      = var.budget_emails
}
