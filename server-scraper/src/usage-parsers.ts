/** Parse provider numbers without dropping decimal commas or thousands groups. */
export function parseUsageNumber(raw: string): number | null {
  let value = raw.trim().replace(/[\s$€]/g, '');
  if (!value || !/^[\d.,]+(?:[KMB])?$/i.test(value)) return null;
  const suffix = value.match(/[KMB]$/i)?.[0].toUpperCase();
  if (suffix) value = value.slice(0, -1);
  if (value.includes(',') && value.includes('.')) {
    value = value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (value.includes(',')) {
    value = /^\d{1,3}(?:,\d{3})+$/.test(value) ? value.replace(/,/g, '') : value.replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, '');
  }
  const number = Number(value) * (suffix === 'K' ? 1000 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseOpenAiUsage(text: string): Record<string, number> | null {
  // Require the spend label and currency; percentages and budgets are not spend.
  const match = text.match(/(?:total\s+spend|month[- ]to[- ]date\s+(?:spend|usage)|MTD\s+spend|Gesamtausgaben)\s*[:\s]*\$\s*([\d.,]+)/i)
    ?? text.match(/(?:total\s+spend|MTD\s+spend|Gesamtausgaben)\s*[:\s]*([\d.,]+)\s*\$/i);
  const cost = match ? parseUsageNumber(match[1]) : null;
  if (cost === null) return null;
  const data: Record<string, number> = { cost_usd: cost };
  const tokens = text.match(/(?:total\s+tokens|tokens\s+gesamt)\s*[:\s]*([\d.,]+\s*[KMB]?)/i);
  const requests = text.match(/(?:total\s+requests|requests|Anfragen)\s*[:\s]*([\d.,]+\s*[KMB]?)/i);
  if (tokens) data.total_tokens = parseUsageNumber(tokens[1]) ?? 0;
  if (requests) data.requests = parseUsageNumber(requests[1]) ?? 0;
  return data;
}
