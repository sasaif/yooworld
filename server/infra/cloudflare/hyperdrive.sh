#!/usr/bin/env bash
# Hyperdrive configs for one environment: one per database role, so each Worker binding keeps least privilege.
# DRY-RUN BY DEFAULT (prints the commands). Alessandro runs it with --apply, logged in with `wrangler login` on HIS
# Cloudflare account. Inputs come from the environment (never committed):
#   NEON_HOST (pooler-less endpoint host of the env branch), NEON_DB, APP_API_PW, APP_AUTH_PW, ADMIN_OPS_PW
# Usage: infra/cloudflare/hyperdrive.sh <uat|prod> [--apply]
set -euo pipefail
ENV="${1:?uat|prod}"; APPLY="${2:-}"
[[ "$ENV" == uat || "$ENV" == prod ]] || { echo "env must be uat|prod"; exit 2; }
for v in NEON_HOST NEON_DB APP_API_PW APP_AUTH_PW ADMIN_OPS_PW; do [[ -n "${!v:-}" ]] || { echo "missing $v"; exit 2; }; done
[[ "$ENV" == prod || ! "$NEON_HOST$NEON_DB" =~ prod ]] || { echo "refusing: uat pointed at something named prod"; exit 2; }
run() { if [[ "$APPLY" == --apply ]]; then "$@"; else { printf 'DRY-RUN:'; printf ' %q' "$@"; echo; } | sed -E 's#(postgres(ql)?://[^:/ ]+):[^@ ]+@#\1:***@#g; s#(_pw=)[^ ]+#\1***#g'; fi; }
# caching OFF: every query is transactional / per-user; Hyperdrive is used for connection pooling + latency only
for pair in "api:app_api:$APP_API_PW" "auth:app_auth:$APP_AUTH_PW" "admin:admin_ops:$ADMIN_OPS_PW"; do
  IFS=: read -r name role pw <<<"$pair"
  run npx wrangler hyperdrive create "yoland-$ENV-$name" \
    --connection-string="postgres://$role:$pw@$NEON_HOST:5432/$NEON_DB?sslmode=require" --caching-disabled
done
echo "Copy the three ids into server/.local/phase-c.params (${ENV^^}_HYPERDRIVE_{API,AUTH,ADMIN}_ID)."
