# Offline plan of the whole stack with mocked providers: catches dependency cycles, unknown
# for_each keys and validation errors without AWS credentials.
#   cd infra/modules/platform && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-central-1a", "eu-central-1b", "eu-central-1c"] }
  }
  mock_data "aws_region" {
    defaults = { name = "eu-central-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_cloudfront_cache_policy" {
    defaults = { id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
}

mock_provider "aws" {
  alias = "replica"
}

mock_provider "random" {}
mock_provider "archive" {}

variables {
  platform_domain     = "saunas.example.com"
  admin_host          = "admin.example.net"
  zone_id             = "Z0000000000000000001"
  admin_zone_id       = "Z0000000000000000002"
  email_domain        = "mail.saunas.example.com"
  signing_public_keys = { k1 = "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n" }
  active_signing_key  = "k1"
}

run "prod_like" {
  command = plan

  variables {
    environment       = "prod"
    enable_codedeploy = true
  }
}

run "dev_like" {
  command = plan

  variables {
    environment              = "dev"
    single_nat_gateway       = true
    db_multi_az              = false
    deletion_protection      = false
    enable_asset_replication = false
    enable_backup            = false
    enable_bot_control       = false
  }
}
