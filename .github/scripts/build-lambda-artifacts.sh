#!/usr/bin/env bash
# Packages the outputs of `npm run build` for deployment:
#   artifacts/lambda/<function>.zip   one zip per function in services/api/dist/lambda/; the worker
#                                     zip holds worker/ + migrations/ (handler worker/index.handler)
#   artifacts/layer/native-arm64.zip  sharp + aws-crt for linux-arm64 (esbuild keeps them external)
#   artifacts/layer/native-arm64.sha  content key of the layer (versions + platform)
#   artifacts/web/                    apps/web/dist
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
out="$root/artifacts"
rm -rf "$out" && mkdir -p "$out/lambda" "$out/layer" "$out/web"

shopt -s nullglob
dist="$root/services/api/dist/lambda"
for dir in "$dist"/*/; do
  fn="$(basename "$dir")"
  case "$fn" in
    migrations) continue ;; # shipped inside the worker zip, not a function
    worker)
      # Handler worker/index.handler; packages/db resolves ../migrations/ from the bundle.
      [ -d "$dist/migrations" ] || { echo "worker bundle needs $dist/migrations" >&2; exit 1; }
      (cd "$dist" && zip -qr -X "$out/lambda/worker.zip" worker migrations)
      ;;
    *)
      (cd "$dir" && zip -qr -X "$out/lambda/$fn.zip" .)
      ;;
  esac
  echo "lambda/$fn.zip $(du -h "$out/lambda/$fn.zip" | cut -f1)"
done
if [ -z "$(ls "$out/lambda")" ]; then
  echo "No Lambda bundles in services/api/dist/lambda (did npm run build run?)" >&2
  exit 1
fi

# Native modules, pinned to the versions in package-lock.json.
pkgs="$(node -e '
  const l = require(process.argv[1]);
  const names = ["sharp", "aws-crt", "@aws-sdk/signature-v4-crt"];
  console.log(names.filter(n => l.packages["node_modules/" + n]).map(n => n + "@" + l.packages["node_modules/" + n].version).join(" "));
' "$root/package-lock.json")"
echo "layer packages: $pkgs"
layer_dir="$(mktemp -d)"
mkdir -p "$layer_dir/nodejs"
(cd "$layer_dir/nodejs" && echo '{"private":true}' > package.json &&
  npm install --no-audit --no-fund --omit=dev --os=linux --cpu=arm64 --libc=glibc $pkgs >/dev/null)
# aws-crt ships prebuilt binaries for every platform; keep only linux arm64 (layer size limit).
crt_bin="$layer_dir/nodejs/node_modules/aws-crt/dist/bin"
if [ -d "$crt_bin" ]; then
  find "$crt_bin" -mindepth 1 -maxdepth 1 -type d ! -name 'linux-arm64-glibc' -exec rm -rf {} +
fi
(cd "$layer_dir" && zip -qr -X "$out/layer/native-arm64.zip" nodejs)
echo "linux-arm64 $pkgs" | sha256sum | cut -c1-16 > "$out/layer/native-arm64.sha"
echo "layer/native-arm64.zip $(du -h "$out/layer/native-arm64.zip" | cut -f1) key=$(cat "$out/layer/native-arm64.sha")"

cp -R "$root/apps/web/dist/." "$out/web/"
