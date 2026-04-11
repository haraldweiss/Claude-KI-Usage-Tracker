import { runQuery, getQuery, allQuery } from '../database/sqlite.js';

export async function trackUsage(req, res) {
  try {
    const {
      model,
      input_tokens,
      output_tokens,
      conversation_id,
      source = 'claude_ai',
      // NEW FIELDS FOR RECOMMENDATIONS
      task_description = null,
      success_status = 'unknown',
      response_metadata = null
    } = req.body;

    if (!model || input_tokens === undefined || output_tokens === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const total_tokens = input_tokens + output_tokens;

    // Get pricing for this model
    const pricing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);
    let cost = 0;

    if (pricing) {
      cost = (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1000000;
    }

    // Convert response_metadata to JSON string if it's an object
    const metadataJson = response_metadata
      ? typeof response_metadata === 'string'
        ? response_metadata
        : JSON.stringify(response_metadata)
      : null;

    const result = await runQuery(
      `INSERT INTO usage_records (
        model, input_tokens, output_tokens, total_tokens, cost, conversation_id, source,
        task_description, success_status, response_metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        cost,
        conversation_id,
        source,
        task_description,
        success_status,
        metadataJson
      ]
    );

    res.status(201).json({
      success: true,
      id: result.lastID,
      cost: cost.toFixed(4)
    });
  } catch (error) {
    console.error('Error tracking usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSummary(req, res) {
  try {
    const { period = 'day' } = req.query;

    let dateFilter = '';
    if (period === 'day') {
      dateFilter = 'date(timestamp) = date(\'now\')';
    } else if (period === 'week') {
      dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-7 days\')';
    } else if (period === 'month') {
      dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-30 days\')';
    }

    const summary = await getQuery(
      `SELECT
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE ${dateFilter}`
    );

    res.json({
      period,
      ...summary
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getModelBreakdown(req, res) {
  try {
    const breakdown = await allQuery(
      `SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE datetime(timestamp) >= datetime('now', '-30 days')
       GROUP BY model
       ORDER BY total_tokens DESC`
    );

    res.json({
      models: breakdown || []
    });
  } catch (error) {
    console.error('Error getting model breakdown:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getHistory(req, res) {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const history = await allQuery(
      `SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id
       FROM usage_records
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );

    res.json({
      records: history || [],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
