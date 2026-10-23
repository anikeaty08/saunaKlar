# WAF web ACL for the CloudFront distribution (scope CLOUDFRONT → must live in us-east-1).

locals {
  # Per-IP rate limits (requests per evaluation window) by path prefix.
  rate_rules = {
    auth = {
      priority = 10
      prefix   = "/api/auth/"
      limit    = var.rate_limits.auth
    }
    shared = {
      priority = 11
      prefix   = "/api/shared/"
      limit    = var.rate_limits.shared
    }
    asset-session = {
      priority = 12
      prefix   = "/api/assets/session"
      limit    = var.rate_limits.asset_session
    }
    assets = {
      priority = 13
      prefix   = "/assets/"
      limit    = var.rate_limits.assets
    }
  }

  managed_rule_groups = {
    AWSManagedRulesAmazonIpReputationList = { priority = 0, overrides = [] }
    # The API enforces its own 1 MB JSON limit; the CRS 8 KB body rule would block legitimate
    # admin payloads, so it only counts.
    AWSManagedRulesCommonRuleSet          = { priority = 20, overrides = ["SizeRestrictions_BODY"] }
    AWSManagedRulesKnownBadInputsRuleSet  = { priority = 30, overrides = [] }
    AWSManagedRulesSQLiRuleSet            = { priority = 40, overrides = [] }
  }

  bot_control_paths = ["/api/assets/session", "/api/auth/signup"]
}

resource "aws_wafv2_web_acl" "this" {
  provider    = aws.us_east_1
  name        = var.name
  description = "saunaklar edge protection"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.managed_rule_groups
    content {
      name     = rule.key
      priority = rule.value.priority

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key

          dynamic "rule_action_override" {
            for_each = rule.value.overrides
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  dynamic "rule" {
    for_each = local.rate_rules
    content {
      name     = "rate-${rule.key}"
      priority = rule.value.priority

      action {
        block {
          custom_response {
            response_code = 429
          }
        }
      }

      statement {
        rate_based_statement {
          limit                 = rule.value.limit
          aggregate_key_type    = "IP"
          evaluation_window_sec = 300

          scope_down_statement {
            byte_match_statement {
              search_string         = rule.value.prefix
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "LOWERCASE"
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "rate-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  # Bot Control is billed per inspected request: scope it to the two abuse-prone endpoints.
  dynamic "rule" {
    for_each = var.enable_bot_control ? [1] : []
    content {
      name     = "AWSManagedRulesBotControlRuleSet"
      priority = 50

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = "AWSManagedRulesBotControlRuleSet"

          managed_rule_group_configs {
            aws_managed_rules_bot_control_rule_set {
              inspection_level = "COMMON"
            }
          }

          scope_down_statement {
            or_statement {
              dynamic "statement" {
                for_each = local.bot_control_paths
                content {
                  byte_match_statement {
                    search_string         = statement.value
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      uri_path {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "LOWERCASE"
                    }
                  }
                }
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "bot-control"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

# WAF logs (log group name must start with aws-waf-logs-). Cookies are redacted.
resource "aws_cloudwatch_log_group" "waf" {
  provider          = aws.us_east_1
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.waf_log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  provider                = aws.us_east_1
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }

  redacted_fields {
    single_header {
      name = "x-csrf-token"
    }
  }
}
