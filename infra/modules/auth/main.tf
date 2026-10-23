# Two Cognito user pools (design 6.1):
#
#  customers: username = customers.id (UUID). E-mail is a plain attribute (NO alias / username
#             attribute) because the same address may exist at several resellers. Sign-up is done
#             only through the backend-for-frontend; there is no hosted UI / OAuth domain, and the
#             app client id is never sent to browsers.
#  staff    : reseller and manufacturer admins. Admin-created only, TOTP MFA required.
#
# Both pools send e-mail through SES (when an identity is given) and run the CustomMessage
# trigger, which renders reseller branding from the ClientMetadata the API passes.

data "aws_partition" "current" {}

locals {
  email_configuration = var.ses_identity_arn == null ? null : {
    source_arn = var.ses_identity_arn
    from       = var.email_from
  }
}

# ---------------------------------------------------------------------------------------------
# CustomMessage trigger Lambda
# ---------------------------------------------------------------------------------------------
#
# Terraform only creates the function with a bootstrap stub; CI deploys the real bundle
# (services/api/dist/lambda/cognito-custom-message/index.mjs). The trigger needs no VPC/DB access:
# everything it renders comes from the event's clientMetadata.

data "archive_file" "custom_message_stub" {
  type        = "zip"
  output_path = "${path.root}/.terraform/build/custom-message-stub.zip"

  source {
    filename = "index.mjs"
    content  = <<-JS
      // Bootstrap stub replaced by CI. Returns the event unchanged (Cognito default message).
      export const handler = async (event) => event;
    JS
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "custom_message" {
  name               = "${var.name}-cognito-custom-message"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "custom_message" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${var.custom_message_log_group_arn}:*"]
  }
}

resource "aws_iam_role_policy" "custom_message" {
  role   = aws_iam_role.custom_message.id
  policy = data.aws_iam_policy_document.custom_message.json
}

resource "aws_lambda_function" "custom_message" {
  function_name    = "${var.name}-cognito-custom-message"
  role             = aws_iam_role.custom_message.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  memory_size      = 256
  timeout          = 5
  filename         = data.archive_file.custom_message_stub.output_path
  source_code_hash = data.archive_file.custom_message_stub.output_base64sha256

  environment {
    variables = {
      APP_ENV         = var.environment
      PLATFORM_DOMAIN = var.platform_domain
      ADMIN_HOST      = var.admin_host
      NODE_OPTIONS    = "--enable-source-maps"
    }
  }

  logging_config {
    log_format            = "JSON"
    log_group             = var.custom_message_log_group_name
    application_log_level = "INFO"
    system_log_level      = "WARN"
  }

  lifecycle {
    # Code is deployed by CI (.github/workflows/deploy.yml).
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_permission" "custom_message" {
  for_each = {
    customers = aws_cognito_user_pool.customers.arn
    staff     = aws_cognito_user_pool.staff.arn
  }
  statement_id  = "AllowCognito-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.custom_message.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = each.value
}

# ---------------------------------------------------------------------------------------------
# Customer pool
# ---------------------------------------------------------------------------------------------

resource "aws_cognito_user_pool" "customers" {
  name                = "${var.name}-customers"
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  # No username_attributes and no alias_attributes: the username is the customers.id UUID.
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  username_configuration {
    case_sensitive = false
  }

  # Self-registration happens through the SignUp API called by the BFF (not a hosted UI).
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 3
      max_length = 254
    }
  }

  dynamic "email_configuration" {
    for_each = local.email_configuration == null ? [] : [local.email_configuration]
    content {
      email_sending_account  = "DEVELOPER"
      source_arn             = email_configuration.value.source_arn
      from_email_address     = email_configuration.value.from
      configuration_set      = var.ses_configuration_set
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  lambda_config {
    custom_message = aws_lambda_function.custom_message.arn
  }

  lifecycle {
    # Cognito does not allow changing the schema after creation.
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "customers" {
  name         = "${var.name}-customers-bff"
  user_pool_id = aws_cognito_user_pool.customers.id

  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = false
  supported_identity_providers         = ["COGNITO"]

  access_token_validity  = var.customer_access_token_minutes
  id_token_validity      = var.customer_access_token_minutes
  refresh_token_validity = var.customer_refresh_token_days
  auth_session_validity  = 3

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  read_attributes  = ["email", "email_verified"]
  write_attributes = ["email"]
}

# ---------------------------------------------------------------------------------------------
# Staff pool
# ---------------------------------------------------------------------------------------------

resource "aws_cognito_user_pool" "staff" {
  name                = "${var.name}-staff"
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  # Staff sign in with their e-mail address (unique across the platform).
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  mfa_configuration = "ON"
  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Your administrator account"
      email_message = "You have been invited as an administrator. Username: {username} Temporary password: {####} You will be asked to set a new password and an authenticator app."
      sms_message   = "Username: {username} Temporary password: {####}"
    }
  }

  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  dynamic "email_configuration" {
    for_each = local.email_configuration == null ? [] : [local.email_configuration]
    content {
      email_sending_account  = "DEVELOPER"
      source_arn             = email_configuration.value.source_arn
      from_email_address     = email_configuration.value.from
      configuration_set      = var.ses_configuration_set
    }
  }

  lambda_config {
    custom_message = aws_lambda_function.custom_message.arn
  }

  lifecycle {
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "staff" {
  name         = "${var.name}-staff-bff"
  user_pool_id = aws_cognito_user_pool.staff.id

  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = false
  supported_identity_providers         = ["COGNITO"]

  # Short staff sessions (design 15.1).
  access_token_validity  = var.staff_access_token_minutes
  id_token_validity      = var.staff_access_token_minutes
  refresh_token_validity = var.staff_refresh_token_hours
  auth_session_validity  = 5

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }

  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["name"]
}
