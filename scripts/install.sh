#!/usr/bin/env bash
# Lumio one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Plattnericus/lumio/main/scripts/install.sh | sudo bash
#
# Targets a fresh Ubuntu/Debian server where nginx can own ports 80 and
# HTTPS_PORT itself. If something else already holds one of those ports
# (another reverse proxy, a different app), this script detects it and
# prints what to do instead of guessing at someone else's config - see
# the "existing service on port X" messages below.
#
# Every setting is overridable via environment variables, none are
# hardcoded:
#   REPO_URL, INSTALL_DIR, HTTPS_PORT, LE_EMAIL, SERVER_ADDRESS,
#   SYSTEM_USER, BACKUP_RETENTION_DAYS
set -euo pipefail

# ---------- config (override via env) ----------
REPO_URL="${REPO_URL:-https://github.com/Plattnericus/lumio.git}"
INSTALL_DIR="${INSTALL_DIR:-/root/lumio}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
SYSTEM_USER="${SYSTEM_USER:-lumio}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
NODE_MAJOR="${NODE_MAJOR:-22}"

# ---------- output helpers ----------
if [ -t 1 ]; then
  BOLD="$(tput bold)"; DIM="$(tput dim)"; RESET="$(tput sgr0)"
  GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"; RED="$(tput setaf 1)"; CYAN="$(tput setaf 6)"
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; YELLOW=""; RED=""; CYAN=""
fi

STEP_NUM=0
STEP_TOTAL=11
step() {
  STEP_NUM=$((STEP_NUM + 1))
  echo ""
  echo "${BOLD}${CYAN}[${STEP_NUM}/${STEP_TOTAL}]${RESET} ${BOLD}$1${RESET}"
}
ok() { echo "  ${GREEN}✓${RESET} $1"; }
warn() { echo "  ${YELLOW}!${RESET} $1"; }
fail() { echo "  ${RED}✗${RESET} $1"; exit 1; }
skip() { echo "  ${DIM}- $1 (already done)${RESET}"; }

banner() {
  echo "${CYAN}${BOLD}"
  cat <<'BANNER'
   _                    _
  | |   _   _ _ __ ___ (_) ___
  | |  | | | | '_ ` _ \| |/ _ \
  | |__| |_| | | | | | | | (_) |
  |_____\__,_|_| |_| |_|_|\___/
BANNER
  echo "${RESET}${DIM}  self-hosted file cloud - installer${RESET}"
}

# ---------- preflight ----------
banner

if [ "$(id -u)" -ne 0 ]; then
  fail "Run this as root (sudo)."
fi

if ! command -v apt-get &>/dev/null; then
  fail "This installer targets Ubuntu/Debian (needs apt-get). Everything it does is plain shell - adapt it for your distro if needed."
fi

SERVER_ADDRESS="${SERVER_ADDRESS:-$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}"
if [ -z "$SERVER_ADDRESS" ]; then
  fail "Could not detect this server's public IP. Set SERVER_ADDRESS explicitly and re-run."
fi
echo "  Detected server address: ${BOLD}${SERVER_ADDRESS}${RESET}"

port_owned_by_something_else() {
  ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .
}

if port_owned_by_something_else 80; then
  warn "Port 80 is already in use. Let's Encrypt's HTTP-01 challenge needs it free (even briefly) unless you route /.well-known/acme-challenge/ to this box's ACME webroot through whatever already owns port 80. This installer will still configure nginx for HTTPS_PORT; you'll need to sort certificate issuance out by hand - see README's Certificate renewal section."
fi
if port_owned_by_something_else "$HTTPS_PORT"; then
  fail "Port $HTTPS_PORT is already in use. Re-run with HTTPS_PORT=<a free port>."
fi

# ---------- 1. packages ----------
step "Installing nginx, fail2ban, certbot, acl"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx fail2ban acl snapd curl gnupg >/dev/null
ok "apt packages installed"

if ! command -v certbot &>/dev/null; then
  snap install core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
  ok "certbot installed via snap ($(certbot --version))"
else
  skip "certbot"
fi

# ---------- 2. Node.js ----------
step "Installing Node.js ${NODE_MAJOR}.x"
if command -v node &>/dev/null && [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" = "$NODE_MAJOR" ]; then
  skip "Node.js $(node --version)"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  ok "Node.js $(node --version) installed"
fi

# ---------- 3. system user ----------
step "Creating the ${SYSTEM_USER} system user"
if id "$SYSTEM_USER" &>/dev/null; then
  skip "user $SYSTEM_USER"
else
  useradd --system --shell /usr/bin/bash --home-dir "/home/${SYSTEM_USER}" --create-home "$SYSTEM_USER"
  ok "created system user $SYSTEM_USER"
fi

# If the install directory lives under another user's home (e.g. /root),
# that directory blocks traversal by anyone else by default - grant just
# enough ACL to reach INSTALL_DIR and nginx's worker user to serve it,
# without opening up anything else in that home directory.
PARENT_DIR="$(dirname "$INSTALL_DIR")"
setfacl -m "u:${SYSTEM_USER}:--x" "$PARENT_DIR" 2>/dev/null || true
NGINX_USER="$(grep -oP '^user\s+\K\S+' /etc/nginx/nginx.conf 2>/dev/null | tr -d ';' || echo www-data)"
usermod -aG "$SYSTEM_USER" "$NGINX_USER" 2>/dev/null || true
setfacl -m "u:${NGINX_USER}:--x" "$PARENT_DIR" 2>/dev/null || true
ok "scoped ACL access to $PARENT_DIR for $SYSTEM_USER and $NGINX_USER"

# ---------- 4. clone/update repo ----------
step "Fetching Lumio into ${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}/.git" ]; then
  git -C "$INSTALL_DIR" fetch origin >/dev/null
  git -C "$INSTALL_DIR" merge --ff-only origin/main >/dev/null
  ok "updated existing checkout"
else
  git clone --branch main "$REPO_URL" "$INSTALL_DIR" >/dev/null
  ok "cloned $REPO_URL"
fi
mkdir -p "${INSTALL_DIR}/backend/data/uploads/thumbnails" "${INSTALL_DIR}/backend/data/uploads/previews" "${INSTALL_DIR}/backend/data/backups"
chown -R "${SYSTEM_USER}:${SYSTEM_USER}" "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"

# ---------- 5. backend env ----------
step "Writing backend/.env"
ENV_FILE="${INSTALL_DIR}/backend/.env"
if [ -f "$ENV_FILE" ]; then
  skip ".env (already exists, not overwriting)"
else
  SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64"))')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
SESSION_SECRET=${SESSION_SECRET}
DB_PATH=${INSTALL_DIR}/backend/data/lumio.sqlite
UPLOAD_DIR=${INSTALL_DIR}/backend/data/uploads
MAX_UPLOAD_MB=25
LOGIN_RATE_LIMIT_MAX=5
LOGIN_LOCKOUT_MINUTES=15
PAIRING_CODE_TTL_MINUTES=10
EOF
  chown "${SYSTEM_USER}:${SYSTEM_USER}" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "generated .env with a random session secret"
fi

# ---------- 6. install & build ----------
step "Installing dependencies and building the frontend"
sudo -u "$SYSTEM_USER" bash -c "cd '${INSTALL_DIR}/backend' && npm ci --omit=dev" >/dev/null
ok "backend dependencies installed"
sudo -u "$SYSTEM_USER" bash -c "cd '${INSTALL_DIR}/frontend' && npm ci && npm run build" >/dev/null
ok "frontend built"

# ---------- 7. systemd service ----------
step "Installing the lumio systemd service"
cat > /etc/systemd/system/lumio.service <<EOF
[Unit]
Description=Lumio backend API
After=network.target

[Service]
Type=simple
User=${SYSTEM_USER}
Group=${SYSTEM_USER}
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=15

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}/backend/data
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
EOF
# ProtectHome is deliberately absent (blocks access to /root entirely,
# where the code deliberately lives) and so is MemoryDenyWriteExecute
# (breaks Node's V8 JIT) - found both by hand while deploying this exact
# script's logic to a real box, not guessed at.
systemctl daemon-reload
systemctl enable lumio.service >/dev/null
ok "systemd unit installed and enabled"

# ---------- 8. certificate ----------
step "Requesting a Let's Encrypt certificate for ${SERVER_ADDRESS}"
if [ -d "/etc/letsencrypt/live/${SERVER_ADDRESS}" ]; then
  skip "certificate for $SERVER_ADDRESS"
elif port_owned_by_something_else 80; then
  warn "Skipping automatic issuance - port 80 is already owned by something else. Run certbot yourself once ACME challenges can reach this box; see README's Certificate renewal section for the exact command."
else
  # --webroot against the default site's existing docroot, not the
  # --nginx plugin: verified this exact combination works for an IP
  # certificate by hand against a live server; --nginx-plugin
  # autoconfiguration for --ip-address certs is untested territory and
  # this script doesn't guess at things it can't check.
  mkdir -p /var/www/html/.well-known/acme-challenge
  certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/html \
    --non-interactive --agree-tos -m "${LE_EMAIL:?Set LE_EMAIL to your certificate registration email and re-run}" \
    --ip-address "$SERVER_ADDRESS" || warn "Certificate issuance failed - check the certbot output above. You can re-run this script once it's sorted out."
fi

# ---------- 9. nginx vhost ----------
step "Configuring nginx"
rm -f /etc/nginx/sites-enabled/default
CERT_DIR="/etc/letsencrypt/live/${SERVER_ADDRESS}"
cat > /etc/nginx/sites-available/lumio.conf <<EOF
server {
    listen ${HTTPS_PORT} ssl;
    listen [::]:${HTTPS_PORT} ssl;
    server_name _;

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    client_max_body_size 26M;

    root ${INSTALL_DIR}/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
ln -sf /etc/nginx/sites-available/lumio.conf /etc/nginx/sites-enabled/lumio.conf
if [ ! -d "$CERT_DIR" ]; then
  warn "No certificate present yet - nginx will fail to start until one exists at ${CERT_DIR}. Re-run certbot, then: systemctl restart nginx"
else
  nginx -t && systemctl restart nginx
  ok "nginx configured and restarted (listening on ${HTTPS_PORT})"
fi

# ---------- 10. fail2ban + cert check + backups ----------
step "Setting up fail2ban, certificate monitoring, and backups"
cat > /etc/fail2ban/filter.d/lumio-auth.conf <<'EOF'
[Definition]
failregex = ^.*"url":"/api/auth/login".*"clientIp":"<HOST>".*"statusCode":401.*$
ignoreregex =
EOF
cat > /etc/fail2ban/jail.d/lumio.conf <<EOF
[lumio-auth]
enabled = true
backend = systemd
journalmatch = _SYSTEMD_UNIT=lumio.service
filter = lumio-auth
maxretry = 5
findtime = 900
bantime = 3600
EOF
systemctl restart fail2ban
ok "fail2ban app-login jail active"

cat > /usr/local/bin/lumio-cert-check.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail
CERT="${CERT_DIR}/fullchain.pem"
[ -f "\$CERT" ] || exit 0
remaining=\$(( \$(date -d "\$(openssl x509 -in "\$CERT" -noout -enddate | cut -d= -f2)" +%s) - \$(date +%s) ))
if [ "\$remaining" -lt \$((48 * 3600)) ]; then
  logger -t lumio-cert-check -p daemon.crit "Lumio TLS cert expires in \$((remaining / 3600))h"
  exit 1
fi
logger -t lumio-cert-check -p daemon.info "Lumio TLS cert OK, \$((remaining / 3600))h remaining"
EOF
chmod 755 /usr/local/bin/lumio-cert-check.sh
cat > /etc/systemd/system/lumio-cert-check.timer <<'EOF'
[Unit]
Description=Check Lumio TLS certificate expiry
[Timer]
OnCalendar=*-*-* 06:00,18:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/lumio-cert-check.service <<'EOF'
[Unit]
Description=Lumio certificate expiry check
[Service]
Type=oneshot
ExecStart=/usr/local/bin/lumio-cert-check.sh
EOF

cat > /etc/systemd/system/lumio-backup.service <<EOF
[Unit]
Description=Lumio database and upload backup
[Service]
Type=oneshot
User=${SYSTEM_USER}
Group=${SYSTEM_USER}
WorkingDirectory=${INSTALL_DIR}/backend
Environment=BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS}
ExecStart=$(command -v node) src/scripts/backup.js
EOF
cat > /etc/systemd/system/lumio-backup.timer <<'EOF'
[Unit]
Description=Run Lumio backup daily
[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1800
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now lumio-cert-check.timer lumio-backup.timer >/dev/null
ok "certificate check and backup timers enabled"

# ---------- 11. start ----------
step "Starting Lumio"
systemctl restart lumio.service
sleep 2
if systemctl is-active --quiet lumio.service && curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  ok "lumio.service is running and healthy"
else
  fail "lumio.service did not start cleanly - check: journalctl -u lumio.service -n 50"
fi

echo ""
echo "${GREEN}${BOLD}Lumio is up.${RESET}"
echo ""
echo "  URL:      ${BOLD}https://${SERVER_ADDRESS}:${HTTPS_PORT}${RESET}"
echo "  Install:  ${INSTALL_DIR}"
echo ""
SETUP_TOKEN_FILE="${INSTALL_DIR}/backend/data/setup-token.txt"
if [ -f "$SETUP_TOKEN_FILE" ]; then
  echo "  ${BOLD}Next step${RESET} - open the URL above and follow the first-run setup wizard."
  echo "  One-time setup token: ${BOLD}$(cat "$SETUP_TOKEN_FILE")${RESET}"
  echo "  (single-use - re-read any time with: cat ${SETUP_TOKEN_FILE})"
else
  echo "  ${BOLD}Next step${RESET} - an account already exists on this install. To replace it in an"
  echo "  emergency (SSH-only, deletes every account and file):"
  echo "    sudo -u ${SYSTEM_USER} node ${INSTALL_DIR}/backend/src/scripts/setup-account.js --force"
fi
echo ""
if port_owned_by_something_else 80 || [ ! -d "$CERT_DIR" ]; then
  echo "  ${YELLOW}Action needed:${RESET} certificate issuance was skipped or failed above - see the warning for what to do."
fi
