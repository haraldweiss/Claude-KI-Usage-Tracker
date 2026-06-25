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
  var nextLabel =
    '5\\s*(?:Stunden|hour)\\s*(?:Nutzungsgrenze|usage limit)|' +
    'Wöchentliches Nutzungslimit|Weekly usage limit|' +
    'Monatliches Nutzungslimit|Monthly usage limit|' +
    'Verbleibende Credits|Credits remaining|Nutzungsaufschlüsselung|Usage breakdown';
  var percent = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,100}?([0-9]{1,3}(?:[.,][0-9]+)?)\\s*%', 'i'));
  var reset = text.match(new RegExp('(?:' + labelPattern + ')[\\s\\S]{0,180}?(?:Zurücksetzungen?|Resets?)\\s+([^\\n]+?)(?=\\s+(?:' + nextLabel + ')|$)', 'i'));
  return {
    remaining_pct: percent ? parseCodexLocalizedNumber(percent[1]) : null,
    reset_at: reset ? parseCodexResetDate(reset[1].trim()) : null
  };
}

function parseCodexUsageText(rawText) {
  var text = typeof rawText === 'string' ? rawText.replace(/\u00a0/g, ' ').trim() : '';
  var fiveHour = codexLimit(text, '5\\s*(?:Stunden|hour)\\s*(?:Nutzungsgrenze|usage limit)');
  var weekly = codexLimit(text, '(?:Wöchentliches Nutzungslimit|Weekly usage limit)');
  var monthly = codexLimit(text, '(?:Monatliches Nutzungslimit|Monthly usage limit)');

  if (
    !Number.isFinite(fiveHour.remaining_pct) ||
    !Number.isFinite(weekly.remaining_pct) ||
    !Number.isFinite(monthly.remaining_pct) ||
    fiveHour.remaining_pct < 0 || fiveHour.remaining_pct > 100 ||
    weekly.remaining_pct < 0 || weekly.remaining_pct > 100 ||
    monthly.remaining_pct < 0 || monthly.remaining_pct > 100
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
