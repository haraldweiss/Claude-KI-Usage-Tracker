#!/bin/bash
# ============================================================
# check-handoff.sh — 90% Limit-Handoff Check
# ============================================================
# Ruft das Backend auf und prüft, ob irgendein LLM-Limit ≥90% ist.
# Falls ja: markdown_block → AGENTS.md (§7 Handoff zone) + git commit
#
# Aufruf: ./scripts/check-handoff.sh
#
# Erwartet in ~/.netrc oder Umgebungsvariablen:
#   KI_TRACKER_API=https://claudetracker.wolfinisoftware.de/api
#   KI_TRACKER_TOKEN=ck_live_...
#
# Oder: --api URL --token TOKEN als Argumente
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_MD="$SCRIPT_DIR/AGENTS.md"
API="${KI_TRACKER_API:-https://claudetracker.wolfinisoftware.de/api}"
TOKEN="${KI_TRACKER_TOKEN:-}"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    *) echo "Usage: $0 [--api URL] [--token TOKEN]"; exit 1 ;;
  esac
done

# Fallback: Token-Datei (~/.config/ki-tracker-token)
TOKEN_FILE="$HOME/.config/ki-tracker-token"
if [[ -z "$TOKEN" && -f "$TOKEN_FILE" ]]; then
  TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')
fi

if [[ -z "$TOKEN" ]]; then
  echo "❌ Kein API-Token. Setze KI_TRACKER_TOKEN, --token, oder ~/.config/ki-tracker-token"
  exit 1
fi

echo "🔍 Prüfe Limits via $API/handoff/check..."

# Call backend
RESPONSE=$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/handoff/check")
CURL_EXIT=$?

if [[ $CURL_EXIT -ne 0 ]]; then
  echo "❌ Backend nicht erreichbar ($CURL_EXIT)"
  exit 1
fi

HAS_ALERTS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('has_alerts', False))")

if [[ "$HAS_ALERTS" != "True" ]]; then
  echo "✅ Keine Limits ≥90% — kein Handoff nötig"
  echo ""
  echo "Alle Limits (absteigend):"
  echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for l in data.get('all_limits', []):
    bar = '#' * int(l['used_pct'] / 5) + '-' * (20 - int(l['used_pct'] / 5))
    print(f\"  {l['source']:20s} {l['limit_type']:15s} {l['used_pct']:3d}% {bar}\")
"
  exit 0
fi

# Extract markdown block
MARKDOWN=$(echo "$RESPONSE" | python3 -c "
import sys, json
print(json.load(sys.stdin).get('markdown_block', ''))
")

if [[ -z "$MARKDOWN" ]]; then
  echo "⚠️  has_alerts=True aber kein markdown_block"
  exit 1
fi

echo "⚠️  Kritische Limits erkannt! Schreibe Handoff-Eintrag..."

# Append markdown_block to AGENTS.md
{
  echo ""
  echo "$MARKDOWN"
  echo ""
} >> "$AGENTS_MD"
echo "✅ Eintrag an AGENTS.md angehängt"

# Git commit
cd "$SCRIPT_DIR"

# Korrekte Git-Identity sicherstellen
git config user.email "harald.weiss@wolfinisoftware.de" 2>/dev/null || true
git config user.name "Harald Weiss" 2>/dev/null || true

git add AGENTS.md
TIMESTAMP=$(date "+%Y-%m-%d %H:%M")
git commit -m "docs: ⚠️ handoff — Limit ≥90% erreicht ($TIMESTAMP)

Automatischer Handoff-Eintrag durch check-handoff.sh.

$(echo "$MARKDOWN" | head -5 | sed 's/^/  /')" --no-verify 2>&1 || echo "⚠️  Commit fehlgeschlagen (keine Änderungen?)"

echo "✅ Git-Commit erstellt oder aktuell"
echo ""
echo "📋 Nächste Schritte:"
echo "  1. git push origin main"
echo "  2. AGENTS.md prüfen auf vollständigen Handoff"
echo "  3. Neuen Agenten starten (pi, Claude Code, etc.)"
