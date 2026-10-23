terraform {
  # use_lockfile in the S3 backend needs Terraform 1.10+.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

locals {
  default_tags = {
    Project     = "saunaklar"
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "github.com/anikeaty08/saunaKlar"
  }
}

# Primary region (A1).
provider "aws" {
  region              = "eu-central-1"
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = local.default_tags
  }
}

# CloudFront certificate, WAF and edge metrics must live in us-east-1 (no personal data).
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = local.default_tags
  }
}

# Replica region for asset replication and backup copies (EU only).
provider "aws" {
  alias               = "replica"
  region              = "eu-west-1"
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = local.default_tags
  }
}
