#!/usr/bin/env bash
# Publishes the SPA build to the web bucket and invalidates only index.html.
#   static/*    hashed bundles: immutable for a year. Never deleted on deploy, so tabs opened
#               on the previous release can still lazy-load their chunks.
#   other files robots.txt, manifest, …: short cache.
#   index.html  uploaded last, no-cache (the default behaviour is not cached at the edge either).
# Environment: WEB_BUCKET, DISTRIBUTION_ID, WEB_DIR (default artifacts/web)
set -euo pipefail
: "${WEB_BUCKET:?}" "${DISTRIBUTION_ID:?}"
WEB_DIR="${WEB_DIR:-artifacts/web}"
[ -f "$WEB_DIR/index.html" ] || { echo "No index.html in $WEB_DIR" >&2; exit 1; }

if [ -d "$WEB_DIR/static" ]; then
  aws s3 sync "$WEB_DIR/static" "s3://$WEB_BUCKET/static" --no-progress \
    --cache-control "public, max-age=31536000, immutable"
fi

aws s3 sync "$WEB_DIR" "s3://$WEB_BUCKET" --no-progress \
  --exclude "static/*" --exclude "index.html" --exclude "*.map" \
  --cache-control "public, max-age=300"

aws s3 cp "$WEB_DIR/index.html" "s3://$WEB_BUCKET/index.html" --no-progress \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

id="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" \
  --paths /index.html --query Invalidation.Id --output text)"
echo "invalidation $id created for /index.html"
