#!/usr/bin/env bash
#
# Check git for updates, pull if behind, reinstall deps, restart the app service.
# Installed by scripts/install-ubuntu.sh as a systemd timer (every 5 minutes).
#
set -euo pipefail

APP_NAME="${APP_NAME:-langoclass}"
APP_DIR="${APP_DIR:-/opt/langoclass}"
APP_USER="${APP_USER:-langoclass}"
LOG_TAG="${APP_NAME}-auto-update"

log() {
  logger -t "${LOG_TAG}" "$*"
  printf '%s %s\n' "$(date -Is)" "$*"
}

run_as_app() {
  sudo -u "${APP_USER}" -- "$@"
}

if [[ ! -d "${APP_DIR}/.git" ]]; then
  exit 0
fi

LOCK_FILE="/var/lock/${APP_NAME}-auto-update.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "Update already in progress — skipping"
  exit 0
fi

if ! run_as_app git -C "${APP_DIR}" fetch -q origin; then
  log "git fetch failed"
  exit 1
fi

UPSTREAM="$(run_as_app git -C "${APP_DIR}" rev-parse --abbrev-ref '@{u}' 2>/dev/null || true)"
if [[ -z "${UPSTREAM}" ]]; then
  log "No upstream branch configured — skipping"
  exit 0
fi

LOCAL="$(run_as_app git -C "${APP_DIR}" rev-parse HEAD)"
REMOTE="$(run_as_app git -C "${APP_DIR}" rev-parse '@{u}')"

if [[ "${LOCAL}" == "${REMOTE}" ]]; then
  exit 0
fi

log "Update available (${LOCAL:0:7} -> ${REMOTE:0:7}); pulling..."

BRANCH="$(run_as_app git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD)"
run_as_app git -C "${APP_DIR}" fetch -q origin "${BRANCH}"
run_as_app git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"

log "Installing npm dependencies..."
if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  run_as_app npm ci --prefix "${APP_DIR}" --omit=dev
else
  run_as_app npm install --prefix "${APP_DIR}" --omit=dev
fi

log "Restarting ${APP_NAME}.service..."
systemctl restart "${APP_NAME}.service"
log "Update complete"
