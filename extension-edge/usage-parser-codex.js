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
  // Relative countdowns from the current UI: "in 2h 34m", "in 6d 21h".
  var relDays = value.match(/in\s+(\d+)\s*d(?:ays?)?\s*(?:(\d+)\s*h(?:ours?)?)?/i);
  if (relDays) {
    var daysMs = Number(relDays[1]) * 86400000 + (relDays[2] ? Number(relDays[2]) * 3600000 : 0);
    return new Date(Date.now() + daysMs).toISOString();
  }
  var relHours = value.match(/in\s+(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i);
  if (relHours) {
    var hoursMs = Number(relHours[1]) * 3600000 + (relHours[2] ? Number(relHours[2]) * 60000 : 0);
    return new Date(Date.now() + hoursMs).toISOString();
  }
  var relMinutes = value.match(/in\s+(\d+)\s*m(?:in(?:ute)?s?)?/i);
  if (relMinutes) return new Date(Date.now() + Number(relMinutes[1]) * 60000).toISOString();
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

// Labels vary between the German long form ("5 Stunden Nutzungsgrenze"),
// the older English form ("5 hour usage limit") and the current terse UI
// ("5-hour limit", "Weekly limit", "Monthly limit"). Accept all of them.
var CODEX_5H_LABEL =
  '5\\s*[-–—]?\\s*(?:Std\\.?|Stunden|hours?)(?:\\s*(?:Nutzungsgrenze|usage limit|limit))?';
var CODEX_WEEKLY_LABEL =
  '(?:Wöchentliches?\\s+Nutzungslimit|Wöchentlich|Weekly(?:\\s+usage)?\\s+limit|Weekly)';
var CODEX_MONTHLY_LABEL =
  '(?:Monatliches?\\s+Nutzungslimit|Monatlich|Monthly(?:\\s+usage)?\\s+limit|Monthly)';

function codexLimit(text, labelPattern) {
  var percent = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,100}?([0-9]{1,3}(?:[.,][0-9]+)?)\\s*%', 'i'));
  // Reset text sits on its own line in the current UI ("Resets in 2h 34m")
  // and after the label on the same line in the older UI
  // ("... Zurücksetzungen 22.06.2026 04:36"). Capture the rest of that line.
  var reset = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,180}?(?:Zurücksetzungen?|Resets?)\\s+([^\\n]+)', 'i'));
  return {
    remaining_pct: percent ? parseCodexLocalizedNumber(percent[1]) : null,
    reset_at: reset ? parseCodexResetDate(reset[1].trim()) : null
  };
}

function parseCodexUsageText(rawText) {
  var text = typeof rawText === 'string' ? rawText.replace(/\u00a0/g, ' ').trim() : '';
  var fiveHour = codexLimit(text, CODEX_5H_LABEL);
  var weekly = codexLimit(text, CODEX_WEEKLY_LABEL);
  var monthly = codexLimit(text, CODEX_MONTHLY_LABEL);

  if (
    !Number.isFinite(fiveHour.remaining_pct) ||
    !Number.isFinite(weekly.remaining_pct) ||
    (Number.isFinite(monthly.remaining_pct) && (monthly.remaining_pct < 0 || monthly.remaining_pct > 100)) ||
    fiveHour.remaining_pct < 0 || fiveHour.remaining_pct > 100 ||
    weekly.remaining_pct < 0 || weekly.remaining_pct > 100
  ) {
    return { success: false, reason: 'usage_cards_not_found' };
  }

  var planMatch = text.match(
    /(?:Plan|plan|Dein Plan|Your plan|ChatGPT|Konto)[\s:–\-]*\n*\s*(Pro|Plus|Go|Free)\b/i
  );
  if (!planMatch) {
    var header = text.slice(0, 200);
    var headerMatch = header.match(/\b(Pro|Plus|Go|Free)\b/);
    if (headerMatch) planMatch = headerMatch;
  }
  var plan_name = planMatch ? planMatch[1] : null;
  if (plan_name) plan_name = 'ChatGPT ' + plan_name;

  return {
    success: true,
    data: {
      plan_name: plan_name,
      five_hour_remaining_pct: fiveHour.remaining_pct,
      five_hour_reset_at: fiveHour.reset_at,
      weekly_remaining_pct: weekly.remaining_pct,
      weekly_reset_at: weekly.reset_at,
      monthly_remaining_pct: monthly.remaining_pct,
      monthly_reset_at: monthly.reset_at,
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
