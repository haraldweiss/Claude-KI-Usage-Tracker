#!/usr/bin/env bash
# setup-proxy-tunnel.sh
#
# Richtet einen kostenlosen SOCKS5-Proxy-Tunnel ein, der über den Mac
# (Residential-IP) läuft, damit die Server-Scraper Cloudflare umgehen können.
#
# Voraussetzung: brew install microsocks
#
# Usage:
#   bash server-scraper/setup-proxy-tunnel.sh start    # Startet Tunnel
#   bash server-scraper/setup-proxy-tunnel.sh stop     # Stoppt Tunnel
#   bash server-scraper/setup-proxy-tunnel.sh status   # Status prüfen
#
# Nach dem Starten: Auf der Oracle-VM spielt sich alles automatisch ab.
# PLAYWRIGHT_PROXY_URL=socks5://127.0.0.1:40000 ist bereits
# (kommentiert) im Service-File eingetragen.

set -euo pipefail

PROXY_PORT=1080
TUNNEL_PORT=40000
REMOTE_USER="${REMOTE_USER:-opc}"
REMOTE_HOST="${REMOTE_HOST:-oracle-vm}"
PIDFILE="/tmp/microsocks.pid"
TUNNEL_PIDFILE="/tmp/proxy-tunnel-ssh.pid"

cmd_start() {
  echo "=== Proxy-Tunnel starten ==="

  # 1. microsocks starten (SOCKS5-Server auf dem Mac)
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "  ✅ microsocks läuft bereits (PID $(cat "$PIDFILE"))"
  else
    echo "  🚀 Starte microsocks auf Port $PROXY_PORT..."
    microsocks -i 127.0.0.1 -p "$PROXY_PORT" &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "  ✅ microsocks läuft (PID $(cat "$PIDFILE"))"
    else
      echo "  ❌ microsocks konnte nicht gestartet werden"
      exit 1
    fi
  fi

  # 2. SSH Reverse Tunnel: VM:PORT → Mac:PROXY_PORT
  #    Der VM kann über localhost:${TUNNEL_PORT} auf den Mac-Proxy zugreifen
  if [ -f "$TUNNEL_PIDFILE" ] && kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
    echo "  ✅ SSH-Tunnel läuft bereits (PID $(cat "$TUNNEL_PIDFILE"))"
  else
    echo "  🚀 Starte SSH-Tunnel (${REMOTE_HOST}:${TUNNEL_PORT} → Mac:${PROXY_PORT})..."
    autossh -M 0 -o "ExitOnForwardFailure=yes" -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" \
      -N -R "${TUNNEL_PORT}:localhost:${PROXY_PORT}" "${REMOTE_USER}@${REMOTE_HOST}" &
    echo $! > "$TUNNEL_PIDFILE"
    sleep 2
    if kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
      echo "  ✅ SSH-Tunnel aktiv"
    else
      # Fallback ohne autossh
      echo "  ⚠️  autossh nicht verfügbar, versuche SSH..."
      ssh -o "ExitOnForwardFailure=yes" -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" \
        -N -R "${TUNNEL_PORT}:localhost:${PROXY_PORT}" "${REMOTE_USER}@${REMOTE_HOST}" &
      echo $! > "$TUNNEL_PIDFILE"
      sleep 3
      if kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
        echo "  ✅ SSH-Tunnel aktiv"
      else
        echo "  ❌ SSH-Tunnel fehlgeschlagen"
        exit 1
      fi
    fi
  fi

  # 3. Proxy auf VM aktivieren
  echo ""
  echo "  >>> Proxy ist bereit! <<<"
  echo ""
  echo "  Setze PLAYWRIGHT_PROXY_URL=socks5://127.0.0.1:${TUNNEL_PORT}"
  echo "  im Service-File auf der VM:"
  echo ""
  echo "    ssh ${REMOTE_HOST}"
  echo "    sudo sed -i 's|^# Environment=PLAYWRIGHT_PROXY_URL|Environment=PLAYWRIGHT_PROXY_URL|' \\"
  echo "      /etc/systemd/system/ki-usage-scraper.service"
  echo "    sudo systemctl daemon-reload && sudo systemctl restart ki-usage-scraper.timer"
  echo ""

  # Aktivieren
  ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "sudo sed -i 's|^# Environment=PLAYWRIGHT_PROXY_URL|Environment=PLAYWRIGHT_PROXY_URL|' \
      /etc/systemd/system/ki-usage-scraper.service && \
     sudo systemctl daemon-reload && \
     sudo systemctl restart ki-usage-scraper.timer" \
    2>&1 | tail -1
  echo "  ✅ Proxy auf VM aktiviert"

  echo ""
  echo "=== Fertig! Der Tunnel läuft jetzt. ==="
  echo "  Lass dieses Terminal-Fenster offen."
  echo "  Zum Stoppen: $0 stop"
}

cmd_stop() {
  echo "=== Tunnel stoppen ==="

  # Proxy auf VM deaktivieren
  ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "sudo sed -i 's|^Environment=PLAYWRIGHT_PROXY_URL|# Environment=PLAYWRIGHT_PROXY_URL|' \
      /etc/systemd/system/ki-usage-scraper.service && \
     sudo systemctl daemon-reload && \
     sudo systemctl restart ki-usage-scraper.timer" \
    2>/dev/null || true
  echo "  ⏹  Proxy auf VM deaktiviert"

  # SSH-Tunnel beenden
  if [ -f "$TUNNEL_PIDFILE" ]; then
    kill "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null || true
    rm -f "$TUNNEL_PIDFILE"
    echo "  ⏹  SSH-Tunnel beendet"
  fi

  # microsocks beenden
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "  ⏹  microsocks beendet"
  fi

  echo "=== Alle Tunnel gestoppt ==="
}

cmd_status() {
  echo "=== Proxy-Tunnel Status ==="
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "  ✅ microsocks: läuft (PID $(cat "$PIDFILE"))"
  else
    echo "  ❌ microsocks: läuft nicht"
  fi
  if [ -f "$TUNNEL_PIDFILE" ] && kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
    echo "  ✅ SSH-Tunnel: aktiv (PID $(cat "$TUNNEL_PIDFILE"))"
  else
    echo "  ❌ SSH-Tunnel: nicht aktiv"
  fi
  echo ""
  echo "  Playwright auf VM verwendet: socks5://127.0.0.1:${TUNNEL_PORT}"
}

case "${1:-}" in
  start) cmd_start ;;
  stop)  cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    echo ""
    echo "  start  — Startet SOCKS5-Proxy auf Mac + SSH-Tunnel zur VM"
    echo "  stop   — Stoppt alles"
    echo "  status — Zeigt Status"
    exit 1
    ;;
esac
