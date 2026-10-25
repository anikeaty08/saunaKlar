# One-time bootstrap per AWS account (dev, staging, prod), applied by an administrator with
# local state:
#
#   cd infra/bootstrap
#   terraform init && terraform apply -var environment=staging -var github_repository=anikeaty08/saunaKlar
#
# Creates the Terraform state bucket (versioned, encrypted, TLS-only; locking uses S3 lock files)
# and the GitHub Actions OIDC provider + deploy role used by .github/workflows/deploy.yml.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }
}

provider "aws" {
  region = "eu-central-1"
  default_tags {
    tags = {
      Project     = "saunaklar"
      Environment = var.environment
      ManagedBy   = "terraform-bootstrap"
    }
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
}

variable "state_bucket_name" {
  description = "Override the state bucket name (bucket names are global)."
  type        = string
  default     = null
}

locals {
  bucket = coalesce(var.state_bucket_name, "saunaklar-tfstate-${var.environment}")
  # prod and staging deploy only from the protected GitHub environment of the same name;
  # dev also accepts main-branch runs.
  subjects = var.environment == "dev" ? [
    "repo:${var.github_repository}:environment:dev",
    "repo:${var.github_repository}:ref:refs/heads/main",
    ] : [
    "repo:${var.github_repository}:environment:${var.environment == "prod" ? "production" : var.environment}",
  ]
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.state]
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate chain itself; the thumbprint is kept for older APIs.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.subjects
    }
  }
}

# Terraform manages IAM, KMS, VPC, RDS, … so the deploy role needs broad rights in its own
# (single-purpose) account. Guard rails are the per-environment account, the OIDC subject
# condition and the GitHub environment protection rules.
resource "aws_iam_role" "deploy" {
  name                 = "saunaklar-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_admin" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "deploy_role_arn" {
  description = "Set as the GitHub environment variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}
