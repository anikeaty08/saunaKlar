# Edge: one CloudFront distribution for every reseller host (*.platform_domain) and the
# manufacturer admin host, wildcard ACM certificate (us-east-1), WAF (us-east-1), tenant router
# CloudFront Function + KeyValueStore, Route 53 aliases, security response headers.
#
# Behaviours (first match wins):
#   /api/*        → storefront API Gateway; on the admin host the router selects the admin API
#                   (no cache unless the API sends Cache-Control; key includes x-tenant-host)
#   /assets/*     → assets bucket (signed cookies/URLs via trusted key group; key WITHOUT Host, G1).
#                   LOW cookies cover https://{host}/assets/lo/*, FULL cookies https://{host}/assets/*,
#                   AR files use signed URLs. No URI rewriting: S3 key = URL path without leading "/".
#   /static/*     → web bucket (hashed SPA bundles, cached 1 year, immutable)
#   /media/*      → public bucket (catalog thumbnails/galleries, immutable, no Host in key)
#   /branding/*   → public bucket (tenant logos/favicons under branding/<slug>/)
#   /favicon.ico  → branding bucket (rewritten to /branding/<slug>/favicon.ico by the function)
#   default       → web bucket, not cached, Cache-Control: no-cache (index.html; the function
#                   rewrites SPA routes to /index.html)

locals {
  wildcard = "*.${var.platform_domain}"
  aliases  = distinct([local.wildcard, var.admin_host])

  admin_zone_id = coalesce(var.admin_zone_id, var.zone_id)
  cert_domains  = distinct([local.wildcard, var.admin_host])

  origin_ids = {
    web    = "s3-web"
    public = "s3-public"
    assets = "s3-assets"
    api    = "api"
  }

  kvs_id = element(split("/", aws_cloudfront_key_value_store.tenants.arn), 1)

  router_code = replace(replace(replace(replace(
    file("${path.module}/functions/tenant-router.js"),
    "__PLATFORM_DOMAIN__", var.platform_domain),
    "__ADMIN_HOST__", var.admin_host),
    "__ADMIN_API_ORIGIN_ID__", local.origin_ids.admin),
  "__KVS_ID__", local.kvs_id)

  # Both API origins carry the origin secret; the tenant router picks the admin one on ADMIN_HOST.
  api_origins = {
    (local.origin_ids.api)   = var.api_origin_domain
    (local.origin_ids.admin) = var.admin_api_origin_domain
  }
}

# ---------------------------------------------------------------------------------------------
# Certificate (us-east-1, required by CloudFront)
# ---------------------------------------------------------------------------------------------

resource "aws_acm_certificate" "this" {
  provider                  = aws.us_east_1
  domain_name               = local.wildcard
  subject_alternative_names = [for d in local.cert_domains : d if d != local.wildcard]
  validation_method         = "DNS"
  key_algorithm             = "RSA_2048"

  lifecycle {
    create_before_destroy = true
  }
}

# Keyed by the (static) domain names so the plan works before the certificate exists.
resource "aws_route53_record" "cert_validation" {
  for_each = toset(local.cert_domains)

  zone_id         = each.key == var.admin_host ? local.admin_zone_id : var.zone_id
  name            = one([for d in aws_acm_certificate.this.domain_validation_options : d.resource_record_name if d.domain_name == each.key])
  type            = one([for d in aws_acm_certificate.this.domain_validation_options : d.resource_record_type if d.domain_name == each.key])
  records         = [one([for d in aws_acm_certificate.this.domain_validation_options : d.resource_record_value if d.domain_name == each.key])]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---------------------------------------------------------------------------------------------
# Tenant router: KeyValueStore + CloudFront Function
# ---------------------------------------------------------------------------------------------

resource "aws_cloudfront_key_value_store" "tenants" {
  name    = "${var.name}-tenants"
  comment = "Tenant slug -> status (ACTIVE|SUSPENDED). Written by the worker; do not edit by hand."
}

resource "aws_cloudfront_function" "tenant_router" {
  name                         = "${var.name}-tenant-router"
  runtime                      = "cloudfront-js-2.0"
  comment                      = "Tenant check, x-tenant-host, favicon and SPA rewrites"
  publish                      = true
  code                         = local.router_code
  key_value_store_associations = [aws_cloudfront_key_value_store.tenants.arn]
}

# ---------------------------------------------------------------------------------------------
# Signed cookies / URLs: trusted key group
# ---------------------------------------------------------------------------------------------

resource "aws_cloudfront_public_key" "signing" {
  for_each    = var.signing_public_keys
  name        = "${var.name}-${each.key}"
  comment     = "Asset signing key ${each.key}"
  encoded_key = each.value

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_key_group" "assets" {
  name    = "${var.name}-assets"
  comment = "Keys accepted for /assets/* signed cookies and AR signed URLs"
  items   = [for k in aws_cloudfront_public_key.signing : k.id]
}

# ---------------------------------------------------------------------------------------------
# Origin access + policies
# ---------------------------------------------------------------------------------------------

# AWS managed "CachingDisabled": index.html must never be served stale after a release.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# ---------------------------------------------------------------------------------------------
# Cache, origin request and response headers policies
# ---------------------------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.name}-s3"
  description                       = "OAC for the saunaklar S3 origins"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Public media and branding: honour origin Cache-Control (hashed keys are uploaded immutable).
resource "aws_cloudfront_cache_policy" "static" {
  name        = "${var.name}-static"
  comment     = "S3 static files; no headers, cookies or query strings in the key"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# /static/* (hashed SPA bundles): cached for a year at the edge whatever the origin says.
resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "${var.name}-immutable"
  comment     = "Hashed SPA bundles; 1 year; no cookies, headers or query strings in the key"
  min_ttl     = 31536000
  default_ttl = 31536000
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Protected assets (G1): the cache key does NOT include Host. Access control is the signed cookie
# policy, which is bound to https://{host}/assets/* (G2) and checked on every request, even on hits.
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${var.name}-assets"
  comment     = "Protected 3D assets; key excludes Host, cookies and signature query params"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    # GLB/KTX2 are already compressed (Draco/meshopt/Basis); no Accept-Encoding variants.
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# API: only cached when the API says so (versioned catalog, 60 s tenant config). The key includes
# the tenant host so tenants never share a cached response, and every query string (?v=).
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${var.name}-api"
  comment     = "API responses; cached only per origin Cache-Control; keyed by x-tenant-host"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["x-tenant-host"]
      }
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# Everything the API needs that is not in the cache key. Host is NOT forwarded (API Gateway
# requires its own host name); the tenant host travels as x-tenant-host (cache key above).
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "${var.name}-api"
  comment = "Forward cookies, query strings and the headers the API uses"

  cookies_config {
    cookie_behavior = "all"
  }
  query_strings_config {
    query_string_behavior = "all"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "x-csrf-token",
        "accept",
        "accept-language",
        "content-type",
        "origin",
        "user-agent",
        "cloudfront-viewer-address",
        "cloudfront-viewer-country",
        "cloudfront-is-mobile-viewer",
        "cloudfront-is-tablet-viewer",
      ]
    }
  }
}

# Same security headers everywhere; the variants differ only in an enforced Cache-Control:
#   security : API, assets, media, branding (origin decides caching)
#   static   : /static/* hashed SPA bundles → public, max-age=1 year, immutable
#   document : default behaviour (index.html / SPA routes) → no-cache, so releases show at once
locals {
  response_header_variants = {
    security = null
    static   = "public, max-age=31536000, immutable"
    document = "no-cache"
  }
}

resource "aws_cloudfront_response_headers_policy" "this" {
  for_each = local.response_header_variants
  name     = "${var.name}-${each.key}"
  comment  = "HSTS preload, CSP, frame-ancestors none, nosniff, referrer policy${each.value == null ? "" : "; Cache-Control: ${each.value}"}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "permissions-policy"
      value    = "camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=(), usb=()"
      override = true
    }
    items {
      header   = "cross-origin-opener-policy"
      value    = "same-origin"
      override = true
    }
    dynamic "items" {
      for_each = each.value == null ? [] : [each.value]
      content {
        header   = "cache-control"
        value    = items.value
        override = true
      }
    }
  }

  remove_headers_config {
    items {
      header = "server"
    }
  }
}

# ---------------------------------------------------------------------------------------------
# Distribution
# ---------------------------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "${var.name} storefronts, admin and API"
  aliases             = local.aliases
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  price_class         = var.price_class
  web_acl_id          = aws_wafv2_web_acl.this.arn

  origin {
    origin_id                = local.origin_ids.web
    domain_name              = var.bucket_regional_domain_names["web"]
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.origin_ids.public
    domain_name              = var.bucket_regional_domain_names["public"]
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.origin_ids.assets
    domain_name              = var.bucket_regional_domain_names["assets"]
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id

    # Optional extra cache layer in front of S3 for the large 3D files (fewer origin fetches).
    dynamic "origin_shield" {
      for_each = var.origin_shield_region == null ? [] : [var.origin_shield_region]
      content {
        enabled              = true
        origin_shield_region = origin_shield.value
      }
    }
  }

  dynamic "origin" {
    for_each = local.api_origins
    content {
      origin_id   = origin.key
      domain_name = origin.value

      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 30
        origin_keepalive_timeout = 5
      }

      custom_header {
        name  = var.origin_secret_header
        value = var.origin_secret_value
      }
    }
  }

  # /api/* targets the storefront API; on ADMIN_HOST the tenant router switches the request to
  # the admin API origin (cf.selectRequestOriginById).
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.origin_ids.api
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["security"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.origin_ids.assets
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = aws_cloudfront_cache_policy.assets.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["security"].id
    trusted_key_groups         = [aws_cloudfront_key_group.assets.id]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  # Hashed SPA bundles (Vite build.assetsDir = "static"). /assets/* is reserved for 3D files.
  # Tenant-agnostic, so no tenant-router invocation (saves a function call per bundle file).
  ordered_cache_behavior {
    path_pattern               = "/static/*"
    target_origin_id           = local.origin_ids.web
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["static"].id
  }

  # Public catalog media (thumbnails, galleries): immutable hashed keys, no Host in the key, so one
  # cached copy serves every tenant.
  ordered_cache_behavior {
    path_pattern               = "/media/*"
    target_origin_id           = local.origin_ids.public
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["security"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/branding/*"
    target_origin_id           = local.origin_ids.public
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["security"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/favicon.ico"
    target_origin_id           = local.origin_ids.public
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["security"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  default_cache_behavior {
    target_origin_id           = local.origin_ids.web
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["document"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tenant_router.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.geo_allow_list) > 0 ? "whitelist" : "none"
      locations        = var.geo_allow_list
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------------------------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------------------------

resource "aws_route53_record" "wildcard" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = local.wildcard
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "admin" {
  for_each = var.admin_host == local.wildcard ? toset([]) : toset(["A", "AAAA"])
  zone_id  = local.admin_zone_id
  name     = var.admin_host
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
