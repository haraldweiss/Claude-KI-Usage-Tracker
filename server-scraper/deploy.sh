#!/usr/bin/env bash
# Deploy server-side scrapers to Oracle VM and install systemd timer.
# Run from project root: bash server-scraper/deploy.sh
set -euo pipefail

REMOTE="${1:-oracle-vm}"
REMOTE_DIR="/opt/ki-usage-tracker/server-scraper"
SERVICE_FILE="ki-usage-scraper.service"
TIMER_FILE="ki-usage-scraper.timer"

echo "🚀 Deploying server-scraper to ${REMOTE}:${REMOTE_DIR}"

# 1. Copy files
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'cookies' \
  --exclude 'dist' \
  --exclude '.env' \
  server-scraper/ "${REMOTE}:${REMOTE_DIR}/"

# 2. Install dependencies on remote
ssh "${REMOTE}" "cd ${REMOTE_DIR} && npm ci --omit=dev && npx playwright install chromium"

# 3. Install systemd service + timer
ssh "${REMOTE}" << EOF
  set -e
  sudo cp "${REMOTE_DIR}/${SERVICE_FILE}" /etc/systemd/system/
  sudo cp "${REMOTE_DIR}/${TIMER_FILE}" /etc/systemd/system/
  sudo chown root:root "/etc/systemd/system/${SERVICE_FILE}" "/etc/systemd/system/${TIMER_FILE}"
  # SELinux: systemd silently ignores unit files that aren't systemd_unit_file_t
  sudo restorecon "/etc/systemd/system/${SERVICE_FILE}" "/etc/systemd/system/${TIMER_FILE}"
  if [ ! -r /etc/ki-usage-tracker/scraper.env ]; then
    echo "⚠️  /etc/ki-usage-tracker/scraper.env missing — create it (API_TOKEN=..., chmod 600, SELinux ctx etc_t) or the scraper will 401."
  fi
  sudo systemctl daemon-reload
  sudo systemctl enable --now ki-usage-scraper.timer
  echo "✅ Timer installed and started"
  sudo systemctl status ki-usage-scraper.timer --no-pager
EOF

echo "✅ Deploy complete"
echo ""
echo "Next step: run 'ssh ${REMOTE} \"cd ${REMOTE_DIR} && npx tsx src/login.ts <scraper-key>\"'"
echo "for each scraper to save login cookies."
echo "Available keys: claude-ai, anthropic-console, codex, openai-api, opencode-go, zai"
