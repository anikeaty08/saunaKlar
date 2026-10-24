#!/usr/bin/env bash
# Post-deploy smoke test through CloudFront (real hosts, real WAF, real tenant router).
# Environment:
#   SMOKE_HOSTS      space-separated hosts that must serve the app, e.g.
#                    "demo.saunas.example.com admin.saunas.example.com"
#   PLATFORM_DOMAIN  used to check that an unknown tenant is rejected at the edge
set -euo pipefail
: "${SMOKE_HOSTS:?}" "${PLATFORM_DOMAIN:?}"

fail=0
check() { # url expected-status [grep-pattern]
  local url="$1" want="$2" pattern="${3:-}" body status
  body="$(mktemp)"
  for attempt in 1 2 3 4 5; do
    status="$(curl -sS -o "$body" -w '%{http_code}' --max-time 15 "$url" || echo 000)"
    [ "$status" = "$want" ] && break
    sleep $((attempt * 5))
  done
  if [ "$status" != "$want" ] || { [ -n "$pattern" ] && ! grep -q "$pattern" "$body"; }; then
    echo "FAIL $url: status $status (want $want)${pattern:+, pattern '$pattern'}" >&2
    head -c 400 "$body" >&2; echo >&2
    fail=1
  else
    echo "ok   $url ($status)"
  fi
  rm -f "$body"
}

for host in $SMOKE_HOSTS; do
  check "https://$host/api/health" 200 '"ok":true'
  check "https://$host/" 200 '<div id="root"'
  check "https://$host/some/client/route" 200 '<div id="root"'
  # Protected assets without a signed cookie must be refused by CloudFront.
  check "https://$host/assets/hi/smoke-test.glb" 403
done

# Unknown tenants are rejected by the edge function (HTML and problem+json).
unknown="smoke-$(date +%s)-x.$PLATFORM_DOMAIN"
check "https://$unknown/" 404
check "https://$unknown/api/tenant" 404 'TENANT_NOT_FOUND'

# HSTS and CSP from the response headers policy.
first="${SMOKE_HOSTS%% *}"
headers="$(curl -sSI --max-time 15 "https://$first/")"
grep -qi '^strict-transport-security: .*preload' <<<"$headers" || { echo "FAIL missing HSTS preload" >&2; fail=1; }
grep -qi "^content-security-policy: .*frame-ancestors 'none'" <<<"$headers" || { echo "FAIL missing CSP" >&2; fail=1; }

exit "$fail"
