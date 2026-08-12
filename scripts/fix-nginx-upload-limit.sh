#!/usr/bin/env bash
#
# Raise Nginx upload limit so course backup ZIP imports are not rejected with 413.
# Safe to re-run. Applies to all server blocks (including Certbot HTTPS).
#
# Usage (on the Ubuntu server):
#   sudo bash scripts/fix-nginx-upload-limit.sh
#   sudo bash scripts/fix-nginx-upload-limit.sh --size 1024m
#
set -euo pipefail

SIZE="512m"
APP_NAME="langoclass"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --size) SIZE="$2"; shift 2 ;;
    --help|-h)
      sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      err "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  err "Run as root: sudo bash scripts/fix-nginx-upload-limit.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  err "Nginx is not installed on this host."
  exit 1
fi

CONF_D="/etc/nginx/conf.d/${APP_NAME}-upload.conf"
SITE_CONF="/etc/nginx/sites-available/${APP_NAME}"

log "Setting client_max_body_size ${SIZE} (global via conf.d)..."
cat > "${CONF_D}" <<EOF
# Managed by scripts/fix-nginx-upload-limit.sh — course backup ZIP imports
client_max_body_size ${SIZE};
EOF

# Ensure site configs also declare the limit (covers older installs / Certbot copies).
patch_server_blocks() {
  local conf="$1"
  [[ -f "${conf}" ]] || return 0

  if grep -qE '^\s*client_max_body_size\s+' "${conf}"; then
    sed -i -E "s|^\s*client_max_body_size\s+[^;]+;|    client_max_body_size ${SIZE};|g" "${conf}"
    log "Updated existing client_max_body_size in ${conf}"
  else
    # Insert after each "server {" opening line.
    awk -v size="${SIZE}" '
      BEGIN { patched = 0 }
      /^[[:space:]]*server[[:space:]]*\{/ {
        print
        print "    client_max_body_size " size ";"
        patched = 1
        next
      }
      { print }
      END {
        if (!patched) exit 2
      }
    ' "${conf}" > "${conf}.tmp" && mv "${conf}.tmp" "${conf}"
    log "Inserted client_max_body_size into ${conf}"
  fi
}

patch_server_blocks "${SITE_CONF}"

# Also patch any enabled site that proxies this app (common after Certbot).
if [[ -d /etc/nginx/sites-enabled ]]; then
  while IFS= read -r -d '' conf; do
    if grep -qE 'proxy_pass\s+http://127\.0\.0\.1:(3000|3[0-9]{3})' "${conf}" 2>/dev/null; then
      patch_server_blocks "${conf}"
    fi
  done < <(find /etc/nginx/sites-enabled -type f -print0 2>/dev/null || true)
fi

log "Testing Nginx config..."
nginx -t

log "Reloading Nginx..."
systemctl reload nginx

log "Done. Upload limit is now ${SIZE}."
warn "Retry Import all in the CMS. If it still fails, the ZIP may exceed the app limit (500 MB)."
