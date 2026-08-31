#!/usr/bin/env bash
#
# LangoClass — Ubuntu server install script
#
# Installs system dependencies, Node.js, npm packages, systemd service,
# optional git auto-update timer (pull + restart every 5 minutes), and
# (optionally) Nginx reverse proxy with Socket.IO WebSocket support.
#
# Usage (on the server, from the project root):
#   sudo bash scripts/install-ubuntu.sh
#
# Options:
#   --app-dir PATH        Install location (default: /opt/langoclass)
#   --port PORT           App listen port (default: 3000; 3001 for --variant hk-elderly)
#   --domain DOMAIN       Public hostname for Nginx + PUBLIC_BASE_URL
#   --variant NAME        App variant: hk-elderly (separate service, data, and defaults)
#   --data-path PATH      PERSISTENT_DATA_PATH (hk-elderly default: /var/lib/langoclass-hk)
#   --with-nginx          Install and configure Nginx reverse proxy
#   --skip-copy           Use current directory instead of copying to --app-dir
#   --no-auto-update      Do not install the 5-minute git pull + restart timer
#   --node-major N        Node.js major version (default: 22)
#   --help                Show this help
#
# HK elderly on the same machine as the main app (shared code, separate process):
#   sudo bash scripts/install-ubuntu.sh --skip-copy --variant hk-elderly \\
#     --app-dir /opt/langoclass --port 3001 --domain hk.example.com --with-nginx
#
set -euo pipefail

APP_NAME="langoclass"
APP_USER="langoclass"
APP_GROUP="langoclass"
APP_DIR="/opt/langoclass"
APP_PORT="3000"
APP_VARIANT=""
DATA_PATH=""
ENV_FILE_NAME=".env"
NODE_MAJOR="22"
WITH_NGINX="0"
SKIP_COPY="0"
AUTO_UPDATE="1"
DOMAIN=""
APP_DIR_SET="0"
APP_PORT_SET="0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

usage() {
  sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
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
      --app-dir)     APP_DIR="$2"; APP_DIR_SET="1"; shift 2 ;;
      --port)        APP_PORT="$2"; APP_PORT_SET="1"; shift 2 ;;
      --domain)      DOMAIN="$2"; shift 2 ;;
      --variant)     APP_VARIANT="$2"; shift 2 ;;
      --data-path)   DATA_PATH="$2"; shift 2 ;;
      --with-nginx)  WITH_NGINX="1"; shift ;;
      --skip-copy)   SKIP_COPY="1"; shift ;;
      --no-auto-update) AUTO_UPDATE="0"; shift ;;
      --node-major)  NODE_MAJOR="$2"; shift 2 ;;
      --help|-h)     usage; exit 0 ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done

  if [[ -n "${APP_VARIANT}" && "${APP_VARIANT}" != "hk-elderly" ]]; then
    err "Unknown --variant: ${APP_VARIANT} (supported: hk-elderly)"
    exit 1
  fi

  if [[ "${APP_VARIANT}" == "hk-elderly" ]]; then
    APP_NAME="langoclass-hk"
    ENV_FILE_NAME=".env.hk-elderly"
    if [[ "${APP_DIR_SET}" != "1" ]]; then
      APP_DIR="/opt/langoclass-hk"
    fi
    if [[ "${APP_PORT_SET}" != "1" ]]; then
      APP_PORT="3001"
    fi
    if [[ -z "${DATA_PATH}" ]]; then
      DATA_PATH="/var/lib/langoclass-hk"
    fi
  fi
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
  elif [[ -d "${PROJECT_ROOT}/.git" ]]; then
    local remote branch
    remote="$(git -C "${PROJECT_ROOT}" remote get-url origin 2>/dev/null || true)"
    branch="$(git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
    if [[ -n "${remote}" ]]; then
      log "Deploying from git: ${remote} (${branch})"
      install -d -m 0755 "${APP_DIR}"
      if [[ -d "${APP_DIR}/.git" ]]; then
        git -C "${APP_DIR}" remote set-url origin "${remote}" || true
        git -C "${APP_DIR}" fetch --depth 1 origin "${branch}"
        git -C "${APP_DIR}" checkout -B "${branch}" "origin/${branch}"
        git -C "${APP_DIR}" reset --hard "origin/${branch}"
      else
        rm -rf "${APP_DIR:?}/"*
        git clone --branch "${branch}" --depth 1 "${remote}" "${APP_DIR}"
      fi
      git -C "${APP_DIR}" branch --set-upstream-to="origin/${branch}" "${branch}" 2>/dev/null || true
    else
      warn "No git remote in ${PROJECT_ROOT} — falling back to rsync (auto-update will not work)."
      log "Deploying application to ${APP_DIR}..."
      install -d -m 0755 "${APP_DIR}"
      rsync -a --delete \
        --exclude node_modules \
        --exclude .git \
        --exclude .wrangler \
        --exclude .env \
        --exclude '.env.*' \
        "${PROJECT_ROOT}/" "${APP_DIR}/"
    fi
  else
    log "Deploying application to ${APP_DIR}..."
    install -d -m 0755 "${APP_DIR}"
    rsync -a --delete \
      --exclude node_modules \
      --exclude .git \
      --exclude .wrangler \
      --exclude .env \
      --exclude '.env.*' \
      "${PROJECT_ROOT}/" "${APP_DIR}/"
    if [[ "${AUTO_UPDATE}" == "1" ]]; then
      warn "Source is not a git repo — auto-update timer will be installed but will no-op until ${APP_DIR} is a git checkout."
    fi
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

seed_hk_data() {
  if [[ "${APP_VARIANT}" != "hk-elderly" || -z "${DATA_PATH}" ]]; then
    return
  fi

  log "Preparing HK elderly data at ${DATA_PATH}..."
  install -d -m 0755 "${DATA_PATH}/data"
  install -d -m 0755 "${DATA_PATH}/uploads"/{courses,sections,questions,captions,videos}

  local seed_root="${PROJECT_ROOT}/hk-data"
  if [[ -d "${APP_DIR}/hk-data" ]]; then
    seed_root="${APP_DIR}/hk-data"
  fi

  if [[ -f "${seed_root}/data/teacher-courses.json" && ! -f "${DATA_PATH}/data/teacher-courses.json" ]]; then
    cp -a "${seed_root}/data/." "${DATA_PATH}/data/"
  fi
  if [[ -d "${seed_root}/uploads" ]]; then
    cp -a "${seed_root}/uploads/." "${DATA_PATH}/uploads/" 2>/dev/null || true
  fi

  chown -R "${APP_USER}:${APP_GROUP}" "${DATA_PATH}"
}

write_env_file() {
  local env_file="${APP_DIR}/${ENV_FILE_NAME}"
  if [[ -f "${env_file}" ]]; then
    log "${ENV_FILE_NAME} already exists — leaving unchanged."
    return
  fi

  local public_url="http://localhost:${APP_PORT}"
  if [[ -n "${DOMAIN}" ]]; then
    public_url="https://${DOMAIN}"
  fi

  log "Creating ${env_file} (edit with your API keys)..."
  if [[ "${APP_VARIANT}" == "hk-elderly" ]]; then
    cat > "${env_file}" <<EOF
# LangoClass HK elderly environment — separate from the main app .env
PORT=${APP_PORT}
APP_VARIANT=hk-elderly
PUBLIC_BASE_URL=${public_url}
PERSISTENT_DATA_PATH=${DATA_PATH}
INWORLD_STT_LANGUAGE=yue

# AI / speech APIs (optional — can also be set in the web config UI)
# INWORLD_API_KEY=
# INWORLD_LLM_MODEL=auto
# INWORLD_STT_MODEL=inworld/inworld-stt-1
# QWEN_API_KEY=
# QWEN_MODEL=qwen-plus
# QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
# OPENROUTER_API_KEY=
# OPENROUTER_BUZZIN_MODEL=mistralai/voxtral-small-24b-2507
EOF
  else
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
  fi
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
EnvironmentFile=-${APP_DIR}/${ENV_FILE_NAME}
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

install_auto_update() {
  if [[ "${AUTO_UPDATE}" != "1" ]]; then
    log "Skipping auto-update timer (--no-auto-update)."
    return
  fi

  log "Installing git auto-update (every 5 minutes)..."

  install -m 0755 "${PROJECT_ROOT}/scripts/auto-update.sh" "/usr/local/bin/${APP_NAME}-auto-update"

  cat > "/etc/systemd/system/${APP_NAME}-auto-update.service" <<EOF
[Unit]
Description=LangoClass git auto-update check
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_NAME=${APP_NAME}
Environment=APP_DIR=${APP_DIR}
Environment=APP_USER=${APP_USER}
ExecStart=/usr/local/bin/${APP_NAME}-auto-update
EOF

  cat > "/etc/systemd/system/${APP_NAME}-auto-update.timer" <<EOF
[Unit]
Description=Check for LangoClass git updates every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}-auto-update.timer"
  systemctl restart "${APP_NAME}-auto-update.timer"
  log "Auto-update timer enabled: systemctl status ${APP_NAME}-auto-update.timer"
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

  # Global upload limit so Certbot HTTPS server blocks inherit it too.
  cat > "/etc/nginx/conf.d/${APP_NAME}-upload.conf" <<EOF
# Managed by scripts/install-ubuntu.sh — course backup ZIP imports
client_max_body_size 512m;
EOF

  nginx -t
  systemctl enable nginx
  systemctl reload nginx

  log "Nginx configured for http://${DOMAIN}"
  warn "For HTTPS, run: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d ${DOMAIN}"
  warn "If import shows 413 later, run: sudo bash ${APP_DIR}/scripts/fix-nginx-upload-limit.sh"
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
 Config        : ${APP_DIR}/${ENV_FILE_NAME}
 Web UI        : ${access_url}
$(if [[ "${AUTO_UPDATE}" == "1" ]]; then
  echo " Auto-update   : every 5 min (git pull + restart) — timer status: systemctl status ${APP_NAME}-auto-update.timer"
fi)

 Next steps:
   1. Edit ${APP_DIR}/${ENV_FILE_NAME} with your PUBLIC_BASE_URL and API keys
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
  seed_hk_data
  write_env_file
  install_systemd_service
  install_auto_update
  install_nginx
  configure_firewall
  verify_installation
  print_summary
}

main "$@"
