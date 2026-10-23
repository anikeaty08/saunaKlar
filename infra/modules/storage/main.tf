# S3 buckets. All block public access, enforce TLS, disable ACLs.
#
#   web      : SPA bundle (hashed files immutable, index.html no-cache). CloudFront OAC only.
#   branding : the public bucket: tenant branding and public catalog media, still only via OAC.
#              Keys: branding/<slug>/... (logo, favicon.ico, favicon-*.png) and media/... (thumbnails,
#              galleries). Key = URL path without the leading slash.
#   assets   : protected 3D assets (GLB/KTX2/USDZ) under assets/lo/... and assets/hi/... SSE-KMS, versioned, OAC only, replicated to
#              eu-west-1. Only reachable through CloudFront behaviours that require signed cookies/URLs.
#   uploads  : presigned PUT target for branding uploads; objects expire after one day.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  buckets = {
    web      = "${var.name}-web-${local.account_id}"
    branding = "${var.name}-branding-${local.account_id}"
    assets   = "${var.name}-assets-${local.account_id}"
    uploads  = "${var.name}-uploads-${local.account_id}"
  }

  cloudfront_buckets = toset(["web", "branding", "assets"])

  upload_origins = concat(["https://*.${var.platform_domain}", "https://${var.admin_host}"], var.extra_upload_origins)
}

# ---------------------------------------------------------------------------------------------
# KMS for protected assets
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "assets_key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  # CloudFront OAC decrypts objects for this distribution only.
  statement {
    sid       = "CloudFrontOacDecrypt"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [var.cloudfront_distribution_arn]
    }
  }
}

resource "aws_kms_key" "assets" {
  description             = "${var.name} protected 3D assets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.assets_key.json
}

resource "aws_kms_alias" "assets" {
  name          = "alias/${var.name}-assets"
  target_key_id = aws_kms_key.assets.key_id
}

# ---------------------------------------------------------------------------------------------
# Buckets
# ---------------------------------------------------------------------------------------------

resource "aws_s3_bucket" "this" {
  for_each      = local.buckets
  bucket        = each.value
  force_destroy = var.force_destroy && each.key != "assets"
  tags          = { Purpose = each.key }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = { for k, b in aws_s3_bucket.this : k => b if k != "uploads" }
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = each.key == "assets" ? "aws:kms" : "AES256"
      kms_master_key_id = each.key == "assets" ? aws_kms_key.assets.arn : null
    }
    bucket_key_enabled = each.key == "assets"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "versioned" {
  for_each = { for k, b in aws_s3_bucket.this : k => b if k != "uploads" }
  bucket   = each.value.id

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.this["uploads"].id

  rule {
    id     = "expire-uploads"
    status = "Enabled"
    filter {}

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browsers PUT directly to the uploads bucket with a presigned URL from the tenant host.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.this["uploads"].id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = local.upload_origins
    allowed_headers = ["content-type", "content-length", "content-md5", "x-amz-checksum-sha256"]
    expose_headers  = ["etag"]
    max_age_seconds = 600
  }
}

# ---------------------------------------------------------------------------------------------
# Bucket policies
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "bucket" {
  for_each = aws_s3_bucket.this

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      each.value.arn,
      "${each.value.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  dynamic "statement" {
    for_each = contains(local.cloudfront_buckets, each.key) ? [1] : []
    content {
      sid       = "AllowCloudFrontOac"
      actions   = ["s3:GetObject"]
      resources = ["${each.value.arn}/*"]
      principals {
        type        = "Service"
        identifiers = ["cloudfront.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "aws:SourceArn"
        values   = [var.cloudfront_distribution_arn]
      }
    }
  }

  # Protected assets must always be KMS-encrypted with our key (importer uploads).
  dynamic "statement" {
    for_each = each.key == "assets" ? [1] : []
    content {
      sid       = "DenyWrongEncryption"
      effect    = "Deny"
      actions   = ["s3:PutObject"]
      resources = ["${each.value.arn}/*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "StringNotEqualsIfExists"
        variable = "s3:x-amz-server-side-encryption"
        values   = ["aws:kms"]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  policy   = data.aws_iam_policy_document.bucket[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.this]
}

# ---------------------------------------------------------------------------------------------
# Cross-region replication of protected assets to eu-west-1
# ---------------------------------------------------------------------------------------------

resource "aws_kms_key" "assets_replica" {
  count                   = var.enable_replication ? 1 : 0
  provider                = aws.replica
  description             = "${var.name} protected 3D assets (replica)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_s3_bucket" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = "${var.name}-assets-replica-${local.account_id}"
  tags     = { Purpose = "assets-replica" }
}

resource "aws_s3_bucket_public_access_block" "assets_replica" {
  count                   = var.enable_replication ? 1 : 0
  provider                = aws.replica
  bucket                  = aws_s3_bucket.assets_replica[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = aws_s3_bucket.assets_replica[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = aws_s3_bucket.assets_replica[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = aws_s3_bucket.assets_replica[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.assets_replica[0].arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = aws_s3_bucket.assets_replica[0].id

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.assets_replica]
}

data "aws_iam_policy_document" "replica_bucket" {
  count = var.enable_replication ? 1 : 0
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.assets_replica[0].arn,
      "${aws_s3_bucket.assets_replica[0].arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "assets_replica" {
  count    = var.enable_replication ? 1 : 0
  provider = aws.replica
  bucket   = aws_s3_bucket.assets_replica[0].id
  policy   = data.aws_iam_policy_document.replica_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.assets_replica]
}

data "aws_iam_policy_document" "replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  count              = var.enable_replication ? 1 : 0
  name               = "${var.name}-assets-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
}

data "aws_iam_policy_document" "replication" {
  count = var.enable_replication ? 1 : 0

  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [aws_s3_bucket.this["assets"].arn]
  }
  statement {
    actions = [
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.this["assets"].arn}/*"]
  }
  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
    resources = ["${aws_s3_bucket.assets_replica[0].arn}/*"]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.assets.arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.assets_replica[0].arn]
  }
}

resource "aws_iam_role_policy" "replication" {
  count  = var.enable_replication ? 1 : 0
  role   = aws_iam_role.replication[0].id
  policy = data.aws_iam_policy_document.replication[0].json
}

resource "aws_s3_bucket_replication_configuration" "assets" {
  count  = var.enable_replication ? 1 : 0
  bucket = aws_s3_bucket.this["assets"].id
  role   = aws_iam_role.replication[0].arn

  rule {
    id     = "assets-to-replica"
    status = "Enabled"
    filter {}

    delete_marker_replication {
      status = "Enabled"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }

    destination {
      bucket        = aws_s3_bucket.assets_replica[0].arn
      storage_class = "STANDARD_IA"
      encryption_configuration {
        replica_kms_key_id = aws_kms_key.assets_replica[0].arn
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.this, aws_s3_bucket_versioning.assets_replica]
}
