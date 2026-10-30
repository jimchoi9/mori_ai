#!/usr/bin/env bash
# Dedicated local sandbox. Does not read .env/.env.qa/.env.production.
set -euo pipefail
cd "$(dirname "$0")/.."
action="${1:-up}"
case "$action" in up|down|logs|status) ;; *) echo 'Usage: bash scripts/admin-local.sh [up|down|logs|status]' >&2; exit 2 ;; esac
if [[ $# -gt 1 ]]; then echo 'This helper accepts one action only.' >&2; exit 2; fi
endpoint="$(env -i PATH="$PATH" HOME="$HOME" docker context inspect --format '{{.Endpoints.docker.Host}}')"
if [[ "$endpoint" != unix://* ]]; then
  echo 'This helper requires a local Unix-socket Docker context (Docker Desktop).' >&2
  exit 1
fi
config=.local/admin-local.env
if [[ "$action" == up ]]; then
  umask 077
  mkdir -p .local
  if [[ ! -f .local/admin-local.password ]]; then
    openssl rand -hex 24 > .local/admin-local.password
  fi
  password="$(cat .local/admin-local.password)"
  if [[ ! "$password" =~ ^[a-f0-9]{48}$ ]]; then
    echo 'Invalid local password file; refusing to replace existing database credentials.' >&2
    exit 1
  fi
  cat > "$config" <<CONFIG
POSTGRES_USER=mori
POSTGRES_DB=mori_admin_local
POSTGRES_PASSWORD=$password
MORI_IMAGE=mori-ai:admin-local
WEB_PORT=18090
APP_ORIGIN=http://127.0.0.1:18090
APP_ENV=local
ACCESS_MODE=approved_only
DEV_AUTH_ENABLED=true
SESSION_COOKIE_ALLOW_INSECURE_LOCAL=true
DEV_AI_ENABLED=true
AI_REAL_CALLS_ENABLED=false
STORAGE_MODE=local
GOODS_GUEST_ENABLED=false
CONFIG
elif [[ ! -f "$config" ]]; then
  echo 'Start this environment first: bash scripts/admin-local.sh up' >&2
  exit 1
fi
# Clear inherited application variables so a production shell cannot override the
# generated settings. Docker uses the current user's standard local context.
compose() {
  env -i PATH="$PATH" HOME="$HOME" docker compose --env-file "$config" \
    -p mori-admin-local -f compose.yaml "$@"
}
case "$action" in
  up)
    # All three application services use the same runtime image. Build it once.
    compose build web
    compose up --no-build -d --wait
    compose exec -T web python -m backend.access.local_seed
    printf '\nAdmin: http://127.0.0.1:18090/admin\nUse alpha development login. Test beta in a private window at http://127.0.0.1:18090/login\nStop: bash scripts/admin-local.sh down (keeps local data)\n'
    ;;
  down) compose down --remove-orphans ;;
  logs) compose logs --tail=100 -f web worker ;;
  status) compose ps ;;
esac
