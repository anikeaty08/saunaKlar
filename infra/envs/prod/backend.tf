# Remote state: S3 with native lock file (Terraform >= 1.10, no DynamoDB table needed).
# The bucket is created once by infra/bootstrap (see infra/README.md). Override per account with
#   terraform init -backend-config="bucket=<state-bucket>"
terraform {
  backend "s3" {
    bucket       = "saunaklar-tfstate-prod"
    key          = "platform/prod.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
