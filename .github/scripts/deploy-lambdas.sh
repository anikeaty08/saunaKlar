#!/usr/bin/env bash
# Deploys the Lambda bundles built by build-lambda-artifacts.sh.
#
#   1. Publishes the native-modules layer (sharp, aws-crt) if its content key is new.
#   2. For every function in FUNCTIONS_JSON that has artifacts/lambda/<key>.zip: attaches the
#      layer, uploads the code and publishes a new version. Nothing takes traffic yet.
#   3. Runs database migrations by invoking the NEW worker version with {"task":"migrate"}.
#      Migrations are expand-only, so the old API versions keep working against the new schema.
#   4. Moves the `live` alias: worker at once, then the API functions, either through CodeDeploy
#      (CODEDEPLOY_APP set) or as a weighted canary that rolls back if the function's error or
#      throttle alarm fires (CANARY_PERCENT > 0), or at once.
#
# Environment:
#   FUNCTIONS_JSON   {"<key>": "<function name>", ...}  (terraform output function_names)
#   NAME_PREFIX      e.g. saunaklar-staging (layer name prefix)
#   ARTIFACTS        artifacts directory (default ./artifacts)
#   CANARY_PERCENT   0-50, default 0
#   CANARY_MINUTES   default 5
#   CODEDEPLOY_APP   optional CodeDeploy application (deployment group = function key)
set -euo pipefail

ARTIFACTS="${ARTIFACTS:-artifacts}"
CANARY_PERCENT="${CANARY_PERCENT:-0}"
CANARY_MINUTES="${CANARY_MINUTES:-5}"
CODEDEPLOY_APP="${CODEDEPLOY_APP:-}"
: "${FUNCTIONS_JSON:?}" "${NAME_PREFIX:?}"

log() { printf '[deploy] %s\n' "$*"; }

keys() { jq -r 'keys[]' <<<"$FUNCTIONS_JSON"; }
fname() { jq -r --arg k "$1" '.[$k]' <<<"$FUNCTIONS_JSON"; }

# --- 1. layer ---------------------------------------------------------------------------------
layer_name="${NAME_PREFIX}-native-arm64"
layer_key="$(cat "$ARTIFACTS/layer/native-arm64.sha")"
layer_arn="$(aws lambda list-layer-versions --layer-name "$layer_name" \
  --query "LayerVersions[?Description=='$layer_key'].LayerVersionArn | [0]" --output text 2>/dev/null || true)"
if [ -z "$layer_arn" ] || [ "$layer_arn" = "None" ]; then
  size=$(stat -c %s "$ARTIFACTS/layer/native-arm64.zip")
  if [ "$size" -gt 52428800 ]; then
    echo "Layer zip is $size bytes (> 50 MB direct upload limit)." >&2
    exit 1
  fi
  layer_arn="$(aws lambda publish-layer-version --layer-name "$layer_name" \
    --description "$layer_key" --zip-file "fileb://$ARTIFACTS/layer/native-arm64.zip" \
    --compatible-runtimes nodejs22.x --compatible-architectures arm64 \
    --query LayerVersionArn --output text)"
  log "published layer $layer_arn"
else
  log "layer unchanged: $layer_arn"
fi

# --- 2. code + versions -----------------------------------------------------------------------
declare -A new_version old_version
for key in $(keys); do
  fn="$(fname "$key")"
  zip="$ARTIFACTS/lambda/$key.zip"
  if [ ! -f "$zip" ]; then
    log "WARNING: no bundle for $key ($zip); leaving $fn unchanged"
    continue
  fi
  aws lambda update-function-configuration --function-name "$fn" --layers "$layer_arn" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$fn"
  aws lambda update-function-code --function-name "$fn" --zip-file "fileb://$zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$fn"
  new_version[$key]="$(aws lambda publish-version --function-name "$fn" --query Version --output text)"
  old_version[$key]="$(aws lambda get-alias --function-name "$fn" --name live --query FunctionVersion --output text 2>/dev/null || echo none)"
  log "$fn: published version ${new_version[$key]} (live: ${old_version[$key]})"
done

# --- 3. migrations ----------------------------------------------------------------------------
if [ -n "${new_version[worker]:-}" ]; then
  worker="$(fname worker)"
  log "running migrations with $worker:${new_version[worker]}"
  aws lambda invoke --function-name "$worker" --qualifier "${new_version[worker]}" \
    --cli-binary-format raw-in-base64-out --payload '{"task":"migrate"}' \
    --cli-read-timeout 900 --log-type Tail /tmp/migrate-out.json >/tmp/migrate-meta.json
  if jq -e '.FunctionError' /tmp/migrate-meta.json >/dev/null; then
    jq -r '.LogResult' /tmp/migrate-meta.json | base64 -d >&2 || true
    cat /tmp/migrate-out.json >&2
    echo "Migration failed; no alias was moved." >&2
    exit 1
  fi
  log "migrations done: $(cat /tmp/migrate-out.json)"
fi

# --- 4. traffic -------------------------------------------------------------------------------
alarms_firing() {
  local fn="$1"
  aws cloudwatch describe-alarms --alarm-names "$fn-errors" "$fn-throttles" \
    --state-value ALARM --query 'length(MetricAlarms)' --output text
}

shift_alias() {
  local key="$1" fn new old
  fn="$(fname "$key")"
  new="${new_version[$key]}"
  old="${old_version[$key]}"

  if [ "$old" = "none" ]; then
    log "$fn has no live alias (not invoked through an alias); skipping"
    return
  fi
  if [ "$old" = "$new" ]; then
    log "$fn: live already at $new"
    return
  fi

  if [ -n "$CODEDEPLOY_APP" ] && [ "$key" != "worker" ]; then
    local spec deployment
    spec="$(jq -cn --arg fn "$fn" --arg old "$old" --arg new "$new" '{version: 0.0, Resources: [{live: {Type: "AWS::Lambda::Function", Properties: {Name: $fn, Alias: "live", CurrentVersion: $old, TargetVersion: $new}}}]}')"
    deployment="$(aws deploy create-deployment --application-name "$CODEDEPLOY_APP" --deployment-group-name "$key" \
      --revision "$(jq -cn --arg c "$spec" '{revisionType: "AppSpecContent", appSpecContent: {content: $c}}')" \
      --query deploymentId --output text)"
    log "$fn: CodeDeploy $deployment ($old → $new)"
    aws deploy wait deployment-successful --deployment-id "$deployment"
    return
  fi

  if [ "$CANARY_PERCENT" -gt 0 ] && [ "$key" != "worker" ]; then
    local weight
    weight="$(awk -v p="$CANARY_PERCENT" 'BEGIN { printf "%.2f", p / 100 }')"
    aws lambda update-alias --function-name "$fn" --name live --function-version "$old" \
      --routing-config "AdditionalVersionWeights={$new=$weight}" >/dev/null
    log "$fn: canary $CANARY_PERCENT% on $new for $CANARY_MINUTES min"
    local end=$((SECONDS + CANARY_MINUTES * 60))
    while [ $SECONDS -lt $end ]; do
      if [ "$(alarms_firing "$fn")" != "0" ]; then
        aws lambda update-alias --function-name "$fn" --name live --function-version "$old" --routing-config '{}' >/dev/null
        echo "$fn: alarm during canary; rolled back to $old" >&2
        exit 1
      fi
      sleep 30
    done
  fi

  aws lambda update-alias --function-name "$fn" --name live --function-version "$new" --routing-config '{}' >/dev/null
  log "$fn: live → $new"
}

if [ -n "${new_version[worker]:-}" ]; then shift_alias worker; fi
for key in $(keys); do
  [ "$key" = "worker" ] && continue
  [ -n "${new_version[$key]:-}" ] && shift_alias "$key"
done
log "done"
