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
  const year = Number(expectedPeriod.start.slice(0, 4));

  // NEW: OpenAI changed to MM/DD/YY-MM/DD/YY format (e.g., "06/07/26-06/22/26")
  const newFormat = text.match(/\b(\d{2})\/(\d{2})\/(\d{2})\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{2})\b/);
  if (newFormat) {
    // Assume 20xx for the year (e.g., 26 → 2026)
    const startYear = 2000 + Number(newFormat[3]);
    const endYear = 2000 + Number(newFormat[6]);
    return {
      start: openAiIsoDate(startYear, Number(newFormat[1]), Number(newFormat[2])),
      end: openAiIsoDate(endYear, Number(newFormat[4]), Number(newFormat[5]))
    };
  }

  // English: "Jun 1 – Jun 22, 2026" or "Jun 1 – 22, 2026" or "Jun 1 – 22"
  const english = text.match(/\b([A-Za-zÄÖÜäöü]+)\s+(\d{1,2}),?\s*(?:\d{4})?\s*[–—-]\s*(?:([A-Za-zÄÖÜäöü]+)\s+)?(\d{1,2}),?\s*(?:\d{4})?\b/);
  if (english) {
    const startMonth = openAiMonthNumber(english[1]);
    const endMonth = english[3] ? openAiMonthNumber(english[3].trim()) : startMonth;
    if (startMonth && endMonth) {
      return {
        start: openAiIsoDate(year, startMonth, Number(english[2])),
        end: openAiIsoDate(year, endMonth, Number(english[4]))
      };
    }
  }

  // German: "1. Juni – 22. Juni 2026" or "1. Juni – 22. Juni"
  const german = text.match(/\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\s*(?:\d{4})?\s*[–—-]\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\s*(?:\d{4})?\b/);
  if (german) {
    const germanStartMonth = openAiMonthNumber(german[2]);
    const germanEndMonth = openAiMonthNumber(german[4]);
    if (germanStartMonth && germanEndMonth) {
      return {
        start: openAiIsoDate(year, germanStartMonth, Number(german[1])),
        end: openAiIsoDate(year, germanEndMonth, Number(german[3]))
      };
    }
  }

  // Fallback: look for current month name anywhere then try to extract days
  const monthNames = Object.keys(OPENAI_API_MONTHS).sort((a,b) => b.length - a.length);
  const monthPat = '(?:' + monthNames.join('|') + ')';
  const fallback = text.match(new RegExp('(' + monthPat + ')\\s+(\\d{1,2}),?\\s*(?:\\d{4})?', 'i'));
  if (fallback && openAiMonthNumber(fallback[1]) === Number(expectedPeriod.start.slice(5,7))) {
    // Found the expected month with a day — infer month-to-date range
    return {
      start: expectedPeriod.start,
      end: expectedPeriod.end
    };
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

  // NEW LAYOUT: "Total Spend | $0.00" (no label anymore)
  var cost = null;
  var costMatch = text.match(/Total\s+Spend\s*\|\s*\$?([0-9][0-9.,]*\s*[KMB]?)/i);
  if (costMatch) {
    cost = parseOpenAiLocalizedNumber(costMatch[1]);
  }
  // Fallback: old labels
  if (!Number.isFinite(cost)) {
    cost = openAiLabelNumber(text, 'Total spend|Gesamtausgaben|Gesamtkosten');
  }

  // NEW LAYOUT: No organization displayed — use "Default project" or fallback
  var organization = null;
  // Try to find "Personal | Organization | wolfini" pattern (new layout navigation)
  var orgContext = text.match(/Personal\s*\|\s*Organization\s*\|\s*([A-Za-z0-9_\-\s]+)/i);
  if (orgContext) {
    organization = orgContext[1].trim();
  }
  // Try old pattern
  if (!organization) {
    organization = text.match(/(?:Organization|Organisation)\s+(.+?)(?=\s+(?:Total spend|Gesamtausgaben|Total tokens|Input tokens|Output tokens|Requests|Anfragen)|$)/i);
    if (organization) organization = organization[1].trim();
  }
  // Fallback: label like "Organization: wolfini"
  if (!organization) {
    organization = text.match(/(?:Organization|Organisation)[:\s]+(.+?)(?:\s*(?:$|\n|Total|Gesamt|Input|Output|Request|Anfrage))/i);
    if (organization) organization = organization[1].trim();
  }
  // Fallback: look for "Default project" in new layout
  if (!organization) {
    var defaultProject = text.match(/Default\s+project\s*\|\s*([A-Za-z0-9_\-\s]+)/i);
    if (defaultProject) organization = defaultProject[1].trim();
  }
  // Last resort: "Unknown"
  if (!organization) {
    organization = 'Unknown';
  }

  // NEW LAYOUT: "Total tokens | 0" (pipe-separated)
  var input = 0;
  var output = 0;
  var total = 0;
  
  // Try new layout: "Total tokens | 0" or "Total tokens: 0"
  var totalTokensMatch = text.match(/Total\s+tokens\s*[:|]\s*([0-9][0-9.,]*\s*[KMB]?)/i);
  if (totalTokensMatch) {
    total = parseOpenAiLocalizedNumber(totalTokensMatch[1]);
  }
  
  // Try old layout
  if (!Number.isFinite(total)) {
    total = openAiLabelNumber(text, 'Total tokens|Tokens gesamt');
  }
  
  // Try individual token counts (new layout: "Input tokens | 0")
  var inputMatch = text.match(/(?:Input\s+tokens|Eingabetokens)\s*[:|]\s*([0-9][0-9.,]*\s*[KMB]?)/i);
  if (inputMatch) {
    input = parseOpenAiLocalizedNumber(inputMatch[1]);
  }
  
  var outputMatch = text.match(/(?:Output\s+tokens|Ausgabetokens)\s*[:|]\s*([0-9][0-9.,]*\s*[KMB]?)/i);
  if (outputMatch) {
    output = parseOpenAiLocalizedNumber(outputMatch[1]);
  }
  
  // Fallback: use old label parsing
  if (!Number.isFinite(input)) {
    input = openAiLabelNumber(text, 'Input tokens|Eingabetokens');
  }
  if (!Number.isFinite(output)) {
    output = openAiLabelNumber(text, 'Output tokens|Ausgabetokens');
  }
  if (!Number.isFinite(input) && Number.isFinite(total)) input = total;

  // NEW LAYOUT: "Total requests | 0"
  var requests = 0;
  var requestsMatch = text.match(/Total\s+requests\s*[:|]\s*([0-9][0-9.,]*\s*[KMB]?)/i);
  if (requestsMatch) {
    requests = parseOpenAiLocalizedNumber(requestsMatch[1]);
  }
  // Fallback: old label
  if (!Number.isFinite(requests)) {
    requests = openAiLabelNumber(text, 'Requests|Anfragen') || 0;
  }

  if (!Number.isFinite(cost) || cost < 0) {
    // Diagnostic: log text preview for debugging layout_changed
    var preview = (text || '').slice(0, 800).replace(/\n+/g, ' | ');
    return { success: false, reason: 'layout_changed', debug: 'cost=' + cost + ' org=' + (organization || 'null') + ' text=' + preview };
  }

  return {
    success: true,
    data: {
      organization_name: organization ? organization.toString().trim() : 'Unknown',
      period_start: renderedPeriod.start,
      period_end: renderedPeriod.end,
      cost_usd: cost,
      input_tokens: Number.isFinite(input) ? input : 0,
      output_tokens: Number.isFinite(output) ? output : 0,
      requests: requests,
      by_project: [],
      by_model: []
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseOpenAiApiUsageText, parseOpenAiLocalizedNumber, parseOpenAiDateRange };
}
