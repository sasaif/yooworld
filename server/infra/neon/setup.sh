#!/usr/bin/env bash
# Neon project + branches + roles for YoLand. DRY-RUN BY DEFAULT; Alessandro runs it with --apply after
# `neonctl auth` on HIS Neon account (2FA on). Creates: project `yoland` (region eu-central-1 by default),
# branch `uat` (from main) and the database; then runs our migrations as the owner and sets role passwords.
# Production uses the project's `main` branch; uat is a separate branch with its OWN role passwords.
# Inputs (env): NEON_REGION (default aws-eu-central-1), and for the roles step the *_PW variables of setup-roles.sql.
# Usage: infra/neon/setup.sh <create-project|create-uat-branch|migrate|roles> <uat|prod> [--apply]
set -euo pipefail
STEP="${1:?step}"; ENV="${2:?uat|prod}"; APPLY="${3:-}"
REGION="${NEON_REGION:-aws-eu-central-1}"
run() { if [[ "$APPLY" == --apply ]]; then "$@"; else { printf 'DRY-RUN:'; printf ' %q' "$@"; echo; } | sed -E 's#(postgres(ql)?://[^:/ ]+):[^@ ]+@#\1:***@#g; s#(_pw=)[^ ]+#\1***#g'; fi; }
cd "$(dirname "$0")/../.."
case "$STEP" in
  create-project)    run npx neonctl projects create --name yoland --region-id "$REGION" ;;
  create-uat-branch) run npx neonctl branches create --project-id "${NEON_PROJECT_ID:?}" --name uat --parent main ;;
  migrate)
    # migrations as the project owner (first time) — later CI uses the `migrator` role
    : "${NEON_OWNER_URL:?postgres://neondb_owner:...@host/neondb?sslmode=require}"
    run env YOLAND_ENV="$ENV" DATABASE_URL="$NEON_OWNER_URL" node infra/neon/migrate-url.mjs $([[ "$ENV" == prod ]] && echo --i-am-alessandro) ;;
  roles)
    : "${NEON_OWNER_URL:?}"
    run psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -v env="$ENV" \
      -v app_api_pw="${APP_API_PW:?}" -v app_auth_pw="${APP_AUTH_PW:?}" -v app_rw_pw="${APP_RW_PW:?}" -v admin_ops_pw="${ADMIN_OPS_PW:?}" \
      -v backup_ro_pw="${BACKUP_RO_PW:?}" -v reporting_ro_pw="${REPORTING_RO_PW:?}" -v migrator_pw="${MIGRATOR_PW:?}" -f infra/neon/setup-roles.sql ;;
  *) echo "unknown step"; exit 2 ;;
esac
