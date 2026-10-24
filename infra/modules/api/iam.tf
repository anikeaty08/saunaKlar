# Least-privilege policies: one role per function. Shared basics + function-specific statements.

locals {
  # arn:aws:rds-db:<region>:<account>:dbuser:<proxy-resource-id>/<db-user>
  rds_connect_arn = { for k, v in local.functions :
    k => "arn:${local.partition}:rds-db:${local.region}:${local.account_id}:dbuser:${var.db_proxy_resource_id}/${v.db_user}"
  }

  # Cognito actions the BFF needs for the customer pool (sign-up, login, reset, erasure).
  customer_cognito_actions = [
    "cognito-idp:SignUp",
    "cognito-idp:ConfirmSignUp",
    "cognito-idp:ResendConfirmationCode",
    "cognito-idp:InitiateAuth",
    "cognito-idp:ForgotPassword",
    "cognito-idp:ConfirmForgotPassword",
    "cognito-idp:RevokeToken",
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminDeleteUser",
    "cognito-idp:AdminUserGlobalSignOut",
    "cognito-idp:AdminUpdateUserAttributes",
  ]

  # Staff login with TOTP MFA (both admin functions serve it).
  staff_auth_actions = [
    "cognito-idp:InitiateAuth",
    "cognito-idp:RespondToAuthChallenge",
    "cognito-idp:AssociateSoftwareToken",
    "cognito-idp:VerifySoftwareToken",
    "cognito-idp:RevokeToken",
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminUserGlobalSignOut",
  ]
}

data "aws_iam_policy_document" "common" {
  for_each = local.functions

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${var.log_group_arns[each.key]}:*"]
  }

  # Hyperplane ENIs for VPC access. These EC2 actions do not support resource-level scoping.
  statement {
    sid = "VpcAccess"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "XRay"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  # APP_SECRET_ARN and ORIGIN_SECRET_ARN (lib/runtimeEnv.ts). Function-specific secrets are
  # granted below: the signing key to asset-signer, DB owner + login secrets to the worker.
  statement {
    sid       = "AppSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.origin.arn, aws_secretsmanager_secret.app.arn]
  }

  statement {
    sid       = "AppKey"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.app.arn]
  }

  statement {
    sid       = "DbConnect"
    actions   = ["rds-db:connect"]
    resources = [local.rds_connect_arn[each.key]]
  }
}

data "aws_iam_policy_document" "customer" {
  statement {
    sid       = "CustomerPool"
    actions   = local.customer_cognito_actions
    resources = [var.customer_pool_arn]
  }

  # Sign-up confirmation mail is branded and sent by the API itself (routes/auth.ts).
  statement {
    sid       = "SendEmail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [var.ses_identity_arn, var.ses_configuration_set_arn]
  }
}

data "aws_iam_policy_document" "reseller_admin" {
  statement {
    sid       = "StaffPool"
    actions   = local.staff_auth_actions
    resources = [var.staff_pool_arn]
  }

  # Branding uploads (one public bucket, S3 key = URL path): the browser PUTs to the presigned
  # staging key uploads/<slug>/<random> (never served by CloudFront); the function reads it,
  # re-encodes it and writes branding/<slug>/<random>/<name>, then deletes the upload.
  statement {
    sid       = "BrandingUploads"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${var.public_bucket_arn}/uploads/*", "${var.public_bucket_arn}/branding/*"]
  }
}

data "aws_iam_policy_document" "manufacturer_admin" {
  statement {
    sid       = "StaffPoolAuth"
    actions   = local.staff_auth_actions
    resources = [var.staff_pool_arn]
  }

  # Inviting, disabling and re-enabling reseller owners / staff.
  statement {
    sid = "StaffPoolAdmin"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminResetUserPassword",
    ]
    resources = [var.staff_pool_arn]
  }

}

data "aws_iam_policy_document" "asset_signer" {
  statement {
    sid       = "SigningKey"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.signing_key.arn]
  }
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "ConsumeJobs"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "SendEmail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [var.ses_identity_arn, var.ses_configuration_set_arn]
  }

  # Edge tenant table: slug → status (design 5.1).
  statement {
    sid = "TenantKvs"
    actions = [
      "cloudfront-keyvaluestore:DescribeKeyValueStore",
      "cloudfront-keyvaluestore:GetKey",
      "cloudfront-keyvaluestore:ListKeys",
      "cloudfront-keyvaluestore:PutKey",
      "cloudfront-keyvaluestore:DeleteKey",
      "cloudfront-keyvaluestore:UpdateKeys",
    ]
    resources = [var.kvs_arn]
  }

  # G3 cleanup of abandoned PENDING sign-ups.
  statement {
    sid       = "CustomerPoolCleanup"
    actions   = ["cognito-idp:AdminDeleteUser", "cognito-idp:AdminGetUser"]
    resources = [var.customer_pool_arn]
  }

  # `migrate` task (worker/deps.ts): schema owner + svc_* login passwords to sync.
  statement {
    sid       = "MigrationSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat([var.db_master_secret_arn], values(var.db_login_secret_arns))
  }

  statement {
    sid       = "MigrationSecretsKms"
    actions   = ["kms:Decrypt"]
    resources = [var.db_kms_key_arn]
  }
}

locals {
  extra_policy = {
    "public-catalog"     = ""
    "customer"           = data.aws_iam_policy_document.customer.json
    "reseller-admin"     = data.aws_iam_policy_document.reseller_admin.json
    "manufacturer-admin" = data.aws_iam_policy_document.manufacturer_admin.json
    "asset-signer"       = data.aws_iam_policy_document.asset_signer.json
    "worker"             = data.aws_iam_policy_document.worker.json
  }
}

data "aws_iam_policy_document" "function" {
  for_each                = local.functions
  source_policy_documents = compact([data.aws_iam_policy_document.common[each.key].json, local.extra_policy[each.key]])
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  name     = "least-privilege"
  role     = aws_iam_role.function[each.key].id
  policy   = data.aws_iam_policy_document.function[each.key].json
}
