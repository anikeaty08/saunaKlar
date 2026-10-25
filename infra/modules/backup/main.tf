# AWS Backup: daily RDS snapshot in eu-central-1, copied to a vault in eu-west-1 (design 19).
# PITR (5-minute RPO) comes from the RDS automated backups; this plan covers region loss
# (RPO ≤ 24 h) and operator error beyond the PITR window.

data "aws_partition" "current" {}

resource "aws_kms_key" "vault" {
  description             = "${var.name} backup vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_key" "vault_replica" {
  provider                = aws.replica
  description             = "${var.name} backup vault (cross-region copy)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_backup_vault" "primary" {
  name          = var.name
  kms_key_arn   = aws_kms_key.vault.arn
  force_destroy = false
}

resource "aws_backup_vault" "replica" {
  provider      = aws.replica
  name          = "${var.name}-replica"
  kms_key_arn   = aws_kms_key.vault_replica.arn
  force_destroy = false
}

# Optional WORM protection against deletion (also by administrators) in prod.
resource "aws_backup_vault_lock_configuration" "replica" {
  count               = var.vault_lock_min_retention_days > 0 ? 1 : 0
  provider            = aws.replica
  backup_vault_name   = aws_backup_vault.replica.name
  min_retention_days  = var.vault_lock_min_retention_days
  max_retention_days  = max(var.copy_retention_days, var.vault_lock_min_retention_days)
  changeable_for_days = 3
}

resource "aws_backup_plan" "this" {
  name = var.name

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 2 * * ? *)"
    start_window      = 60
    completion_window = 360

    lifecycle {
      delete_after = var.retention_days
    }

    copy_action {
      destination_vault_arn = aws_backup_vault.replica.arn
      lifecycle {
        delete_after = var.copy_retention_days
      }
    }
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "rds" {
  name         = "${var.name}-rds"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resource_arns
}
