// © 2026 Harald Weiss
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Handoff controller — checks all sources for limits ≥ 90% and returns
// structured data for automated AGENTS.md handoff entries.

import { Request, Response } from 'express';
import { allQuery, getQuery } from '../database/sqlite.js';
import { isPlanExpired } from '../utils/planValidity.js';
import { getProviderValidityMap } from '../services/providerValidityService.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface LimitAlert {
  /** Human-readable source name (e.g. "Codex", "z.ai") */
  source: string;
  /** Which limit (e.g. "5h Quota", "Weekly", "Monthly") */
  limit_type: string;
  /** Utilization in percent (0-100) */
  used_pct: number;
  /** Current value (e.g. $ spent, remaining %) */
  current_value: string;
  /** Reset info if available */
  reset_hint: string | null;
  /** When this data point was synced */
  last_synced: string | null;
}

interface HandoffCheckResponse {
  /** At least one limit ≥ 90% */
  has_alerts: boolean;
  /** All limit alerts (≥90%) */
  alerts: LimitAlert[];
  /** All known limits (for reference, regardless of %), sorted by used_pct descending */
  all_limits: LimitAlert[];
  /** Pre-formatted AGENTS.md handoff block (only when has_alerts) */
  markdown_block: string | null;
}


// ──────────────────────────────────────────────
// Controller
// ──────────────────────────────────────────────

export async function getHandoffCheck(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const alerts = await collectAllLimits(userId);
    const hasAlerts = alerts.some(a => a.used_pct >= 90);

    // Sort all_limits descending by used_pct
    const allLimits = [...alerts].sort((a, b) => b.used_pct - a.used_pct);

    // Only active alerts
    const activeAlerts = allLimits.filter(a => a.used_pct >= 90);

    const markdownBlock = hasAlerts ? buildHandoffMarkdown(activeAlerts, allLimits) : null;

    const response: HandoffCheckResponse = {
      has_alerts: hasAlerts,
      alerts: activeAlerts,
      all_limits: allLimits,
      markdown_block: markdownBlock,
    };

    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}


// ──────────────────────────────────────────────
// Limit collection
// ──────────────────────────────────────────────

async function collectAllLimits(userId: number): Promise<LimitAlert[]> {
  const limits: LimitAlert[] = [];

  // Only limits of active providers matter. A provider is tracked when it has
  // an assigned plan in provider_config whose valid_until date has not passed.
  // Fail open when no provider config exists at all (fresh installations).
  const validity = await getProviderValidityMap(userId);
  const track = (key: string): boolean => {
    if (validity.size === 0) return true;
    const v = validity.get(key);
    if (!v?.plan_name) return false;
    return !isPlanExpired(v.plan_valid_until);
  };

  // -- OpenCode Go --
  const ogRow = track('opencode_go') ? await getQuery<{ response_metadata: string | null; timestamp: string }>(
    `SELECT response_metadata, timestamp FROM usage_records
     WHERE source = 'opencode_go_sync' AND user_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [userId]
  ) : undefined;
  if (ogRow?.response_metadata) {
    try {
      const meta = JSON.parse(ogRow.response_metadata);
      for (const [key, label] of Object.entries({
        continuous_pct: 'Rolling Usage',
        weekly_pct: 'Weekly',
        monthly_pct: 'Monthly',
      })) {
        const val = (meta as Record<string, unknown>)[key];
        if (typeof val === 'number' && Number.isFinite(val)) {
          limits.push({
            source: 'OpenCode Go',
            limit_type: label,
            used_pct: val,
            current_value: `${val}% used`,
            reset_hint: ((meta as Record<string, unknown>)['reset_in'] as string)
              ?? ((meta as Record<string, unknown>)[key.replace('_pct', '_reset_in')] as string) ?? null,
            last_synced: ogRow.timestamp,
          });
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // -- z.ai --
  const zaiRow = track('zai') ? await getQuery<{ response_metadata: string | null; timestamp: string }>(
    `SELECT response_metadata, timestamp FROM usage_records
     WHERE source = 'zai_sync' AND user_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [userId]
  ) : undefined;
  if (zaiRow?.response_metadata) {
    try {
      const meta = JSON.parse(zaiRow.response_metadata);
      // Handle both flat and nested formats
      const usage = (meta as Record<string, unknown>)?.usage as Record<string, unknown> ?? meta;
      for (const [key, label] of Object.entries({
        five_hour_pct: '5h Quota',
        weekly_pct: 'Weekly Quota',
        monthly_pct: 'Monthly (Total)',
      })) {
        const val = usage[key] as number;
        if (typeof val === 'number' && Number.isFinite(val)) {
          limits.push({
            source: 'z.ai',
            limit_type: label,
            used_pct: val,
            current_value: `${val}% used`,
            reset_hint: null,
            last_synced: zaiRow.timestamp,
          });
        }
      }
    } catch { /* ignore */ }
  }

  // -- Codex (remaining pct → inverse) --
  const codexRow = track('codex') ? await allQuery<{ response_metadata: string | null; timestamp: string }>(
    `SELECT response_metadata, timestamp FROM usage_records
     WHERE source = 'codex_sync' AND user_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [userId]
  ) : [];
  if (codexRow?.[0]?.response_metadata) {
    try {
      const meta = JSON.parse(codexRow[0].response_metadata);
      for (const [key, label] of Object.entries({
        five_hour_remaining_pct: '5h Quota',
        weekly_remaining_pct: 'Weekly',
        monthly_remaining_pct: 'Monthly',
      })) {
        const remaining = meta[key] as number;
        if (typeof remaining === 'number' && Number.isFinite(remaining)) {
          const used = Math.round((1 - remaining / 100) * 100);
          limits.push({
            source: 'Codex (ChatGPT)',
            limit_type: label,
            used_pct: used,
            current_value: `${remaining}% remaining`,
            reset_hint: null,
            last_synced: codexRow[0].timestamp,
          });
        }
      }
    } catch { /* ignore */ }
  }

  // -- Claude.ai meta --
  const caRow = track('claude_ai') ? await getQuery<{ response_metadata: string | null; timestamp: string }>(
    `SELECT response_metadata, timestamp FROM usage_records
     WHERE source = 'claude_official_sync' AND user_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [userId]
  ) : undefined;
  if (caRow?.response_metadata) {
    try {
      const meta = JSON.parse(caRow.response_metadata);
      const entries: [string, string][] = [
        ['session_pct', 'Session Limit'],
        ['weekly_pct', 'Weekly'],
        ['monthly_pct', 'Monthly'],
        ['spent_pct', 'Overall Spend'],
      ];
      for (const [key, label] of entries) {
        const val = (meta as Record<string, unknown>)[key] as number;
        if (typeof val === 'number' && Number.isFinite(val)) {
          limits.push({
            source: 'Claude.ai',
            limit_type: label,
            used_pct: val,
            current_value: `${val}% used`,
            reset_hint: null,
            last_synced: caRow.timestamp,
          });
        }
      }
    } catch { /* ignore */ }
  }

  return limits;
}


// ──────────────────────────────────────────────
// Markdown generation
// ──────────────────────────────────────────────

function buildHandoffMarkdown(
  activeAlerts: LimitAlert[],
  allLimits: LimitAlert[]
): string {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const day = new Date().toISOString().substring(0, 10);

  let block = `\n### ${day} — ⚠️ Limit-Warnung: Agent-Handover erforderlich\n\n`;
  block += `**Ausgelöst:** ${now}\n\n`;
  block += `**Kritische Limits (≥90%):**\n\n`;
  block += `| Quelle | Limit | Verbrauch | Reset |\n`;
  block += `|--------|-------|-----------|-------|\n`;
  for (const a of activeAlerts) {
    block += `| ${a.source} | ${a.limit_type} | ${a.used_pct}% | ${a.reset_hint ?? '—'} |\n`;
  }

  block += `\n**Alle Limits (absteigend):**\n\n`;
  block += `| Quelle | Limit | Verbrauch | Status |\n`;
  block += `|--------|-------|-----------|--------|\n`;
  for (const l of allLimits) {
    const status = l.used_pct >= 90 ? '🔴 Kritisch' : l.used_pct >= 70 ? '🟡 Erhöht' : '🟢 OK';
    block += `| ${l.source} | ${l.limit_type} | ${l.used_pct}% | ${status} |\n`;
  }

  block += `\n**Wechsel zu einem anderen Agenten empfohlen.** Der aktuelle agent hat seine Limits zu ≥90% ausgeschöpft. `;
  block += `Der übernehmende Agent kann die aktuellen Werte im Dashboard (OverviewTab) einsehen und bei Bedarf `;
  block += `einen neuen Sync via \`Sync geschützte Quellen\` im Extension-Popup auslösen.\n`;

  return block;
}
