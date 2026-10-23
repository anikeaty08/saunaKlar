# RDS PostgreSQL 16 (Multi-AZ) behind RDS Proxy with IAM authentication.
#
# Login users (one per Lambda function, each a member of exactly one application role):
#
#   | DB login user           | Member of     | Used by Lambda      |
#   |-------------------------|---------------|---------------------|
#   | svc_public_catalog      | app_tenant    | public-catalog      |
#   | svc_customer            | app_tenant    | customer            |
#   | svc_reseller_admin      | app_tenant    | reseller-admin      |
#   | svc_asset_signer        | app_tenant    | asset-signer        |
#   | svc_manufacturer_admin  | app_platform  | manufacturer-admin  |
#   | svc_worker              | app_worker    | worker              |
#   | svc_catalog_import      | catalog_admin | catalog import (CI) |
#
# Clients authenticate to the proxy with an IAM token (rds-db:connect). The proxy itself logs in
# to PostgreSQL with the per-user password stored in Secrets Manager (generated here). The worker's
# `migrate` task (connecting as the RDS-managed master user, directly to the instance) creates or
# updates these login roles with the passwords from the secrets listed in `login_secret_arns`.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  login_users = {
    svc_public_catalog     = "app_tenant"
    svc_customer           = "app_tenant"
    svc_reseller_admin     = "app_tenant"
    svc_asset_signer       = "app_tenant"
    svc_manufacturer_admin = "app_platform"
    svc_worker             = "app_worker"
    svc_catalog_import     = "catalog_admin"
  }
}

# ---------------------------------------------------------------------------------------------
# KMS
# ---------------------------------------------------------------------------------------------

resource "aws_kms_key" "db" {
  description             = "${var.name} RDS storage, Performance Insights, DB secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "db" {
  name          = "alias/${var.name}-db"
  target_key_id = aws_kms_key.db.key_id
}

# ---------------------------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------------------------

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.database_subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-rds"
  description = "RDS PostgreSQL"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-rds" }
}

resource "aws_security_group" "proxy" {
  name        = "${var.name}-rds-proxy"
  description = "RDS Proxy"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-rds-proxy" }
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_clients" {
  for_each                     = toset(var.proxy_client_security_group_ids)
  security_group_id            = aws_security_group.proxy.id
  description                  = "PostgreSQL from Lambda"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = each.value
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  security_group_id            = aws_security_group.proxy.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

# Proxy must reach Secrets Manager (interface endpoint) to fetch the login secrets.
resource "aws_vpc_security_group_egress_rule" "proxy_https" {
  security_group_id = aws_security_group.proxy.id
  description       = "HTTPS to Secrets Manager endpoint"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from RDS Proxy"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.proxy.id
}

# Direct access for migrations only (worker `migrate` task); DDL should not go through the proxy.
resource "aws_vpc_security_group_ingress_rule" "db_from_migrator" {
  for_each                     = toset(var.direct_client_security_group_ids)
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from migration runner"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = each.value
}

# ---------------------------------------------------------------------------------------------
# Parameter group
# ---------------------------------------------------------------------------------------------

resource "aws_db_parameter_group" "this" {
  name        = "${var.name}-pg16"
  family      = "postgres16"
  description = "${var.name} PostgreSQL 16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Only TLS 1.2+.
  parameter {
    name  = "ssl_min_protocol_version"
    value = "TLSv1.2"
  }

  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = tostring(var.log_min_duration_statement_ms)
  }

  # Never log statement parameters: they can contain personal data (G10).
  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_parameter_max_length"
    value = "0"
  }

  parameter {
    name  = "log_parameter_max_length_on_error"
    value = "0"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  parameter {
    name  = "statement_timeout"
    value = tostring(var.statement_timeout_ms)
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------------------------
# Instance
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class
  db_name        = var.database_name
  port           = 5432

  username                      = "sauna_owner"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.db.arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.this.name
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.db.arn

  iam_database_authentication_enabled = true

  backup_retention_period   = var.backup_retention_days
  backup_window             = "01:00-02:00"
  maintenance_window        = "sun:02:30-sun:03:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name}-final" : null

  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = var.apply_immediately

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.db.arn
  performance_insights_retention_period = var.performance_insights_retention_days

  monitoring_interval = var.enhanced_monitoring_interval
  monitoring_role_arn = var.enhanced_monitoring_interval > 0 ? aws_iam_role.monitoring.arn : null

  enabled_cloudwatch_logs_exports = ["postgresql"]

  lifecycle {
    # Minor upgrades are applied by AWS; do not fight them.
    ignore_changes = [engine_version]
  }
}

# ---------------------------------------------------------------------------------------------
# Login users: passwords for the proxy → DB hop
# ---------------------------------------------------------------------------------------------

resource "random_password" "login" {
  for_each = local.login_users
  length   = 40
  special  = false
}

resource "aws_secretsmanager_secret" "login" {
  for_each                = local.login_users
  name                    = "${var.name}/db/${each.key}"
  description             = "PostgreSQL login ${each.key} (member of ${each.value}); used by RDS Proxy"
  kms_key_id              = aws_kms_key.db.arn
  recovery_window_in_days = var.deletion_protection ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "login" {
  for_each  = local.login_users
  secret_id = aws_secretsmanager_secret.login[each.key].id
  secret_string = jsonencode({
    username = each.key
    password = random_password.login[each.key].result
    role     = each.value
    engine   = "postgres"
    host     = aws_db_instance.this.address
    port     = 5432
    dbname   = var.database_name
  })
}

# ---------------------------------------------------------------------------------------------
# RDS Proxy (IAM auth required for every client)
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.name}-rds-proxy"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
}

data "aws_iam_policy_document" "proxy" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.login : s.arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.db.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "proxy" {
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.proxy.json
}

resource "aws_db_proxy" "this" {
  name                   = var.name
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  dynamic "auth" {
    for_each = local.login_users
    content {
      description               = "${auth.key} (${auth.value})"
      auth_scheme               = "SECRETS"
      iam_auth                  = "REQUIRED"
      client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
      secret_arn                = aws_secretsmanager_secret.login[auth.key].arn
    }
  }
}

resource "aws_db_proxy_default_target_group" "this" {
  db_proxy_name = aws_db_proxy.this.name

  connection_pool_config {
    max_connections_percent      = var.proxy_max_connections_percent
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 10
  }
}

resource "aws_db_proxy_target" "this" {
  db_proxy_name          = aws_db_proxy.this.name
  target_group_name      = aws_db_proxy_default_target_group.this.name
  db_instance_identifier = aws_db_instance.this.identifier
}

locals {
  # arn:aws:rds:<region>:<account>:db-proxy:prx-0123abcd → prx-0123abcd (used in rds-db:connect ARNs)
  proxy_resource_id = element(split(":", aws_db_proxy.this.arn), 6)
}
