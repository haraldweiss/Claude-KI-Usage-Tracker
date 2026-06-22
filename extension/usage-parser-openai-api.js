var OPENAI_API_MONTHS = {
  jan: 1, january: 1, januar: 1,
  feb: 2, february: 2, februar: 2,
  mar: 3, march: 3, mär: 3, maerz: 3, märz: 3,
  apr: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dez: 12, dezember: 12
};

function parseOpenAiLocalizedNumber(value) {
  if (typeof value !== 'string') return null;
  var compact = value.trim().replace(/\s/g, '');
  var multiplier = 1;
  var suffix = compact.match(/([KMB])$/i);
  if (suffix) {
    multiplier = suffix[1].toUpperCase() === 'K' ? 1e3 : suffix[1].toUpperCase() === 'M' ? 1e6 : 1e9;
    compact = compact.slice(0, -1);
  }
  if (compact.includes(',') && compact.includes('.')) {
    compact = compact.lastIndexOf(',') > compact.lastIndexOf('.')
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (compact.includes(',')) {
    var pieces = compact.split(',');
    compact = pieces.length === 2 && pieces[1].length === 3
      ? pieces.join('')
      : compact.replace(',', '.');
  }
  var parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

function openAiIsoDate(year, month, day) {
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function openAiMonthNumber(label) {
  return OPENAI_API_MONTHS[label.toLowerCase().replace(/\.$/, '')] || null;
}

function parseOpenAiDateRange(text, expectedPeriod) {
  var year = Number(expectedPeriod.start.slice(0, 4));
  var english = text.match(/\b([A-Za-zÄÖÜäöü]+)\s+(\d{1,2})\s*[–—-]\s*([A-Za-zÄÖÜäöü]+\s+)?(\d{1,2})\b/);
  if (english) {
    var startMonth = openAiMonthNumber(english[1]);
    var endMonth = english[3] ? openAiMonthNumber(english[3].trim()) : startMonth;
    if (startMonth && endMonth) {
      return {
        start: openAiIsoDate(year, startMonth, Number(english[2])),
        end: openAiIsoDate(year, endMonth, Number(english[4]))
      };
    }
  }

  var german = text.match(/\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\s*[–—-]\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\b/);
  if (german) {
    var germanStartMonth = openAiMonthNumber(german[2]);
    var germanEndMonth = openAiMonthNumber(german[4]);
    if (germanStartMonth && germanEndMonth) {
      return {
        start: openAiIsoDate(year, germanStartMonth, Number(german[1])),
        end: openAiIsoDate(year, germanEndMonth, Number(german[3]))
      };
    }
  }
  return null;
}

function openAiLabelNumber(text, labels) {
  var match = text.match(new RegExp('(?:' + labels + ')\\s*\\$?\\s*([0-9][0-9.,]*\\s*[KMB]?)', 'i'));
  return match ? parseOpenAiLocalizedNumber(match[1]) : null;
}

function parseOpenAiApiUsageText(rawText, expectedPeriod) {
  var text = typeof rawText === 'string' ? rawText.replace(/\u00a0/g, ' ').trim() : '';
  var renderedPeriod = parseOpenAiDateRange(text, expectedPeriod);
  if (!renderedPeriod || renderedPeriod.start !== expectedPeriod.start || renderedPeriod.end !== expectedPeriod.end) {
    return { success: false, reason: 'period_not_verified' };
  }

  var cost = openAiLabelNumber(text, 'Total spend|Gesamtausgaben|Gesamtkosten');
  var organization = text.match(/(?:Organization|Organisation)\s+(.+?)(?=\s+(?:Total spend|Gesamtausgaben|Total tokens|Input tokens|Requests|Anfragen)|$)/i);
  if (!Number.isFinite(cost) || cost < 0 || !organization || !organization[1].trim()) {
    return { success: false, reason: 'layout_changed' };
  }

  var input = openAiLabelNumber(text, 'Input tokens|Eingabetokens');
  var output = openAiLabelNumber(text, 'Output tokens|Ausgabetokens');
  var total = openAiLabelNumber(text, 'Total tokens|Tokens gesamt');
  if (!Number.isFinite(input) && Number.isFinite(total)) input = total;

  return {
    success: true,
    data: {
      organization_name: organization[1].trim(),
      period_start: renderedPeriod.start,
      period_end: renderedPeriod.end,
      cost_usd: cost,
      input_tokens: Number.isFinite(input) ? input : 0,
      output_tokens: Number.isFinite(output) ? output : 0,
      requests: openAiLabelNumber(text, 'Requests|Anfragen') || 0,
      by_project: [],
      by_model: []
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseOpenAiApiUsageText, parseOpenAiLocalizedNumber, parseOpenAiDateRange };
}
