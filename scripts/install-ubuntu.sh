#!/usr/bin/env bash
#
# LangoClass — Ubuntu server install script
#
# Installs system dependencies, Node.js, npm packages, systemd service,
# and (optionally) Nginx reverse proxy with Socket.IO WebSocket support.
#
# Usage (on the server, from the project root):
#   sudo bash scripts/install-ubuntu.sh
#
# Options:
#   --app-dir PATH        Install location (default: /opt/langoclass)
#   --port PORT           App listen port (default: 3000)
#   --domain DOMAIN       Public hostname for Nginx + PUBLIC_BASE_URL
#   --with-nginx          Install and configure Nginx reverse proxy
#   --skip-copy           Use current directory instead of copying to --app-dir
#   --node-major N        Node.js major version (default: 22)
#   --help                Show this help
#
set -euo pipefail

APP_NAME="langoclass"
APP_USER="langoclass"
APP_GROUP="langoclass"
APP_DIR="/opt/langoclass"
APP_PORT="3000"
NODE_MAJOR="22"
WITH_NGINX="0"
SKIP_COPY="0"
DOMAIN=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Run as root: sudo bash scripts/install-ubuntu.sh"
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir)     APP_DIR="$2"; shift 2 ;;
      --port)        APP_PORT="$2"; shift 2 ;;
      --domain)      DOMAIN="$2"; shift 2 ;;
      --with-nginx)  WITH_NGINX="1"; shift ;;
      --skip-copy)   SKIP_COPY="1"; shift ;;
      --node-major)  NODE_MAJOR="$2"; shift 2 ;;
      --help|-h)     usage; exit 0 ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

detect_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    err "Cannot detect OS. This script is for Ubuntu."
    exit 1
  fi
  # shellcheck source=/dev/null
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"ubuntu"* && "${ID_LIKE:-}" != *"debian"* ]]; then
    warn "This script targets Ubuntu/Debian. Detected: ${PRETTY_NAME:-unknown}"
    read -r -p "Continue anyway? [y/N] " reply
    [[ "${reply,,}" == "y" ]] || exit 1
  fi
  log "Detected: ${PRETTY_NAME:-Linux}"
}

install_system_packages() {
  log "Updating apt and installing system packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    git \
    rsync \
    ffmpeg \
    build-essential \
    ufw
}

install_nodejs() {
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${current_major}" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js $(node -v) already installed — skipping NodeSource setup."
      return
    fi
    warn "Node.js $(node -v) is older than ${NODE_MAJOR}.x — upgrading via NodeSource."
  fi

  log "Installing Node.js ${NODE_MAJOR}.x (NodeSource)..."
  local keyring="/etc/apt/keyrings/nodesource.gpg"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o "${keyring}"

  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  if [[ -z "${codename}" ]]; then
    codename="noble"
    warn "Could not detect Ubuntu codename; using NodeSource repo for ${codename}."
  fi

  echo "deb [signed-by=${keyring}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  apt-get install -y nodejs

  log "Node.js $(node -v), npm $(npm -v)"
}

create_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "User ${APP_USER} already exists."
    return
  fi
  log "Creating system user ${APP_USER}..."
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
}

deploy_application() {
  if [[ "${SKIP_COPY}" == "1" ]]; then
    APP_DIR="${PROJECT_ROOT}"
    log "Using project at ${APP_DIR} (--skip-copy)."
  else
    log "Deploying application to ${APP_DIR}..."
    install -d -m 0755 "${APP_DIR}"
    rsync -a --delete \
      --exclude node_modules \
      --exclude .git \
      --exclude .wrangler \
      --exclude .env \
      "${PROJECT_ROOT}/" "${APP_DIR}/"
  fi

  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    err "package.json not found in ${APP_DIR}"
    exit 1
  fi

  log "Installing npm dependencies..."
  cd "${APP_DIR}"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi

  install -d -m 0755 "${APP_DIR}/data"
  install -d -m 0755 "${APP_DIR}/public/uploads"/{courses,sections,questions,captions,videos}

  chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"
}

write_env_file() {
  local env_file="${APP_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    log ".env already exists — leaving unchanged."
    return
  fi

  local public_url="http://localhost:${APP_PORT}"
  if [[ -n "${DOMAIN}" ]]; then
    public_url="https://${DOMAIN}"
  fi

  log "Creating ${env_file} (edit with your API keys)..."
  cat > "${env_file}" <<EOF
# LangoClass environment — see server.js for all supported variables
PORT=${APP_PORT}
PUBLIC_BASE_URL=${public_url}

# Optional: store data outside the app directory
# PERSISTENT_DATA_PATH=/var/lib/langoclass

# AI / speech APIs (optional — can also be set in the web config UI)
# INWORLD_API_KEY=
# INWORLD_LLM_MODEL=auto
# INWORLD_STT_MODEL=inworld/inworld-stt-1
# INWORLD_STT_LANGUAGE=en
# QWEN_API_KEY=
# QWEN_MODEL=qwen-plus
# QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
# OPENROUTER_API_KEY=
# OPENROUTER_BUZZIN_MODEL=mistralai/voxtral-small-24b-2507
EOF
  chmod 600 "${env_file}"
  chown "${APP_USER}:${APP_GROUP}" "${env_file}"
}

install_systemd_service() {
  log "Installing systemd service..."
  cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=LangoClass quiz server
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
# Video caption generation and course imports can be CPU-heavy
TimeoutStopSec=30

# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}.service"
  systemctl restart "${APP_NAME}.service"
  log "Service status:"
  systemctl --no-pager status "${APP_NAME}.service" || true
}

install_nginx() {
  if [[ "${WITH_NGINX}" != "1" ]]; then
    return
  fi

  if [[ -z "${DOMAIN}" ]]; then
    err "--with-nginx requires --domain your.hostname.example"
    exit 1
  fi

  log "Installing Nginx..."
  apt-get install -y nginx

  local conf="/etc/nginx/sites-available/${APP_NAME}"
  cat > "${conf}" <<EOF
# LangoClass — reverse proxy with Socket.IO WebSocket support
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

  ln -sf "${conf}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx

  log "Nginx configured for http://${DOMAIN}"
  warn "For HTTPS, run: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d ${DOMAIN}"
}

configure_firewall() {
  if ! command -v ufw >/dev/null 2>&1; then
    return
  fi
  if ! ufw status | grep -q "Status: active"; then
    warn "UFW is not active — skipping firewall rules."
    return
  fi

  log "Opening firewall ports..."
  if [[ "${WITH_NGINX}" == "1" ]]; then
    ufw allow 'Nginx Full' >/dev/null 2>&1 || ufw allow 80/tcp && ufw allow 443/tcp
  else
    ufw allow "${APP_PORT}/tcp"
  fi
}

verify_installation() {
  log "Verifying installation..."
  command -v node >/dev/null && log "  node:   $(node -v)"
  command -v npm >/dev/null && log "  npm:    $(npm -v)"
  command -v ffmpeg >/dev/null && log "  ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

  sleep 2
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/network-urls" >/dev/null 2>&1; then
    log "App is responding on port ${APP_PORT}."
  else
    warn "App did not respond yet on port ${APP_PORT}. Check: journalctl -u ${APP_NAME} -f"
  fi
}

print_summary() {
  local access_url="http://$(hostname -I 2>/dev/null | awk '{print $1}'):${APP_PORT}"
  if [[ -n "${DOMAIN}" ]]; then
    access_url="http://${DOMAIN}"
    [[ "${WITH_NGINX}" == "1" ]] || access_url="${access_url}:${APP_PORT}"
  fi

  cat <<EOF

================================================================================
 LangoClass install complete
================================================================================
 App directory : ${APP_DIR}
 Service       : systemctl status ${APP_NAME}
 Logs          : journalctl -u ${APP_NAME} -f
 Config        : ${APP_DIR}/.env
 Web UI        : ${access_url}

 Next steps:
   1. Edit ${APP_DIR}/.env with your PUBLIC_BASE_URL and API keys
   2. Restart: sudo systemctl restart ${APP_NAME}
   3. Open ${access_url}/config.html to finish setup in the browser
================================================================================

EOF
}

main() {
  parse_args "$@"
  require_root
  detect_ubuntu
  install_system_packages
  install_nodejs
  create_app_user
  deploy_application
  write_env_file
  install_systemd_service
  install_nginx
  configure_firewall
  verify_installation
  print_summary
}

main "$@"
