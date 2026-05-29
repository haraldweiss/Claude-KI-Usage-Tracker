export function formatResetDateDisplay(
  resetDateStr: string | null | undefined,
  recordTimestamp: string
): string {
  if (!resetDateStr || !resetDateStr.trim()) {
    return 'Reset: Nicht verfügbar';
  }

  const parsed = parseShortResetDate(resetDateStr.trim(), recordTimestamp);
  if (!parsed) {
    return 'Reset: Nicht verfügbar';
  }

  const { resetDate, daysFromNow } = parsed;

  const formatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const absoluteDate = formatter.format(resetDate);

  if (daysFromNow === 0) {
    return 'Reset heute';
  }
  if (daysFromNow === 1) {
    return 'Reset morgen';
  }
  if (daysFromNow < 0) {
    return `Reset war am ${absoluteDate}`;
  }

  return `Reset in ${daysFromNow} Tagen (${absoluteDate})`;
}

const GERMAN_MONTHS: Record<string, string> = {
  'jan.': 'Jan', 'jän.': 'Jan', 'jänner': 'Jan', 'januar': 'Jan',
  'feb.': 'Feb', 'feber': 'Feb', 'februar': 'Feb',
  'mär.': 'Mar', 'märz': 'Mar',
  'apr.': 'Apr', 'april': 'Apr',
  'mai': 'May',
  'jun.': 'Jun', 'juni': 'Jun',
  'jul.': 'Jul', 'juli': 'Jul',
  'aug.': 'Aug', 'august': 'Aug',
  'sep.': 'Sep', 'sept.': 'Sep', 'september': 'Sep',
  'okt.': 'Oct', 'oktober': 'Oct',
  'nov.': 'Nov', 'november': 'Nov',
  'dez.': 'Dec', 'dezember': 'Dec',
};

function normalizeGermanResetDate(s: string): string | null {
  // Try "1. Mai" or "1 Mai" → "May 1"
  const deMatch = s.match(/^(\d{1,2})\.?\s+([A-Za-z]{3,9})$/);
  if (deMatch) {
    const engMonth = GERMAN_MONTHS[deMatch[2].toLowerCase().replace(/\.$/, '')];
    if (engMonth) {
      return `${engMonth} ${deMatch[1]}`;
    }
  }
  // Already English "May 1"
  const enMatch = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (enMatch) return s;
  return null;
}

function parseShortResetDate(
  resetStr: string,
  recordTimestamp: string
): { resetDate: Date; daysFromNow: number } | null {
  const normalized = normalizeGermanResetDate(resetStr);
  if (!normalized) return null;

  const match = normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const monthStr = match[1];
  const dayStr = match[2];
  const day = parseInt(dayStr, 10);

  if (isNaN(day) || day < 1 || day > 31) {
    return null;
  }

  const recordDate = new Date(recordTimestamp);
  let year = recordDate.getFullYear();

  // Check if reset date month is valid
  const testDate = new Date(`${monthStr} 1, ${year}`);
  if (isNaN(testDate.getTime())) {
    return null;
  }

  // Determine if we need next year:
  // If reset month is STRICTLY before record month, it must be next year
  const resetMonthIndex = testDate.getMonth();
  const recordMonthIndex = recordDate.getMonth();

  if (resetMonthIndex < recordMonthIndex) {
    // Reset is earlier in the year, must be next year
    year += 1;
  } else if (resetMonthIndex === recordMonthIndex && day < recordDate.getDate()) {
    // Same month, but reset day is earlier than today, so next year
    year += 1;
  }

  const resetDate = new Date(`${monthStr} ${day}, ${year}`);

  const today = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());
  const resetMidnight = new Date(resetDate.getFullYear(), resetDate.getMonth(), resetDate.getDate());
  const daysFromNow = Math.floor((resetMidnight.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return { resetDate, daysFromNow };
}
