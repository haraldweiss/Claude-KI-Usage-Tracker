function buildCodexTrackPayload(data, nowIso) {
  return {
    model: 'OpenAI Codex',
    input_tokens: 0,
    output_tokens: 0,
    conversation_id: 'codex-daily-' + nowIso.slice(0, 10),
    source: 'codex_sync',
    cost_usd: 0,
    response_metadata: Object.assign({}, data, { scraped_at: nowIso })
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCodexTrackPayload };
}
