function parseCodexLocalizedNumber(value) {
  if (typeof value !== 'string') return null;
  var compact = value.trim().replace(/\s/g, '');
  if (compact.includes(',') && compact.includes('.')) {
    compact = compact.lastIndexOf(',') > compact.lastIndexOf('.')
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (compact.includes(',')) {
    compact = compact.replace(',', '.');
  }
  var parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCodexResetDate(value) {
  if (!value) return null;
  var german = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (german) {
    return new Date(
      Number(german[3]),
      Number(german[2]) - 1,
      Number(german[1]),
      Number(german[4]),
      Number(german[5])
    ).toISOString();
  }
  var parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function codexLabelNumber(text, labels) {
  var match = text.match(new RegExp('(?:' + labels + ')\\s*([0-9][0-9.,]*)', 'i'));
  return match ? parseCodexLocalizedNumber(match[1]) : null;
}

function codexLimit(text, labelPattern) {
  var percent = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,100}?([0-9]{1,3}(?:[.,][0-9]+)?)\\s*%', 'i'));
  var reset = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,180}?(?:Zurücksetzungen?|Resets?)\\s+([^\\n]+?)(?=\\s+(?:Wöchentliches|Weekly|Verbleibende Credits|Credits remaining|Nutzungsaufschlüsselung|Usage breakdown)|$)', 'i'));
  return {
    remaining_pct: percent ? parseCodexLocalizedNumber(percent[1]) : null,
    reset_at: reset ? parseCodexResetDate(reset[1].trim()) : null
  };
}

function parseCodexUsageText(rawText) {
  var text = typeof rawText === 'string' ? rawText.replace(/\u00a0/g, ' ').trim() : '';
  var fiveHour = codexLimit(text, '5\\s*(?:Stunden|hour)\\s*(?:Nutzungsgrenze|usage limit)');
  var weekly = codexLimit(text, '(?:Wöchentliches Nutzungslimit|Weekly usage limit)');

  if (
    !Number.isFinite(fiveHour.remaining_pct) ||
    !Number.isFinite(weekly.remaining_pct) ||
    fiveHour.remaining_pct < 0 || fiveHour.remaining_pct > 100 ||
    weekly.remaining_pct < 0 || weekly.remaining_pct > 100
  ) {
    return { success: false, reason: 'usage_cards_not_found' };
  }

  // Extract ChatGPT plan name (Pro, Plus, Go, Free) from the page header.
  // The analytics/settings page shows "Dein Plan: Pro", "Your plan: Plus",
  // or just "ChatGPT Pro" / "ChatGPT Plus" in headings.
  var planMatch = text.match(
    /(?:Plan|plan|Dein Plan|Your plan|ChatGPT|Konto)[\s:–\-]*\n*\s*(Pro|Plus|Go|Free)\b/i
  );
  // Fallback: look for "Pro" / "Plus" / "Go" / "Free" in the first 200 chars
  // (usually the page title or header area) but only if it's a standalone word.
  if (!planMatch) {
    var header = text.slice(0, 200);
    var headerMatch = header.match(/\b(Pro|Plus|Go|Free)\b/);
    if (headerMatch) planMatch = headerMatch;
  }
  var plan_name = planMatch ? planMatch[1] : null;
  // Normalize: "Pro" -> "ChatGPT Pro"
  if (plan_name) plan_name = 'ChatGPT ' + plan_name;

  return {
    success: true,
    data: {
      plan_name: plan_name,
      five_hour_remaining_pct: fiveHour.remaining_pct,
      five_hour_reset_at: fiveHour.reset_at,
      weekly_remaining_pct: weekly.remaining_pct,
      weekly_reset_at: weekly.reset_at,
      credits_remaining: codexLabelNumber(text, 'Verbleibende Credits|Credits remaining'),
      interactions: codexLabelNumber(text, 'Interaktionen|Interactions') || 0,
      interactions_by_model: [],
      interactions_by_surface: [],
      plugin_calls: codexLabelNumber(text, 'Plugins? calls?') || 0,
      skills_used: codexLabelNumber(text, 'Skills used|Verwendete Skills') || 0,
      credit_usage: []
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCodexUsageText, parseCodexResetDate };
}
