# Design Spec: Intelligent Data Categorization & Effectiveness Tracking

**Date:** 2026-04-29  
**Project:** Claude Usage Tracker  
**Author:** Design Brainstorm Session  
**Status:** Draft

---

## Overview

This spec defines improvements to data quality and insights for the Claude Usage Tracker by introducing:

1. **Intelligent Categorization** – Claude Haiku automatically categorizes each API call (Code, Research, Analysis, Writing, Support, Other)
2. **Model Attribution** – Proper model identification from API response headers
3. **Effectiveness Tracking** – Haiku estimates whether a task was successful, user confirms/corrects
4. **Dashboard Analytics** – New views showing insights by category, by model×category, and effectiveness trends

**Problem Statement:**
- Currently, tasks are only generically categorized (all "general")
- Model attribution doesn't work
- No way to understand which types of tasks are most valuable or which models are used for which work

**Solution:**
- Use Claude Haiku (cheap, fast) to categorize and rate effectiveness
- Extend database to store category, effectiveness_score, and user confirmations
- New dashboard views to analyze by category and by model×category
- User can confirm/correct suggestions in dashboard (feedback loop)

---

## Architecture & Data Flow

### Request Flow

```
Claude.ai API Call
    ↓
Extension (content.js) captures:
  - prompt (user's message)
  - response (assistant's response)
  - tokens (input/output counts)
  - model (from response headers, fallback to detection)
  - timestamp
    ↓
Extension → Background Script → POST /api/usage/track
    ↓
Backend (usageController):
  1. Save to DB with initial values:
     - category: "Pending"
     - effectiveness_score: null
     - effectiveness_confirmed: false
  2. Extract prompt & response text
  3. Call categorizationService.categorize(prompt, response)
  4. Receive: { category, effectiveness_score, reasoning }
  5. Update DB record with categorization result
    ↓
Dashboard fetches /api/usage/history
    ↓
User sees categorization with confirmation/correction options:
  - ✓ "This looks right"
  - ✗ "This is wrong" → Modal to override
    ↓
User click triggers: PUT /api/usage/:id/confirm-effectiveness
  Body: { effectiveness_confirmed: true, user_category_override?: "Code" }
    ↓
Backend updates record + stores feedback
```

### Database Schema Changes

**Table: `usage_records`** (extend existing)

Add columns:
- `category` (TEXT, nullable) – "Code", "Research", "Analysis", "Writing", "Support", "Other", "Pending"
- `effectiveness_score` (REAL, nullable) – 0.0-1.0, AI-generated estimate
- `effectiveness_confirmed` (BOOLEAN, default: 0) – has user confirmed this?
- `user_category_override` (TEXT, nullable) – if user corrected, store their override here
- `haiku_reasoning` (TEXT, nullable) – Haiku's explanation (for debugging/transparency)

**Indexes:**
- `idx_category` on `category` (for filtering)
- `idx_effectiveness_confirmed` on `effectiveness_confirmed` (for "Pending" reviews)

---

## Extension Changes

### content.js (Fetch Interception)

**Current behavior:** ✓ Extracts prompt, response, tokens  
**New behavior:**

Extract model name from response headers:
```javascript
// Try to read x-model-id or x-request-id from response headers
const model = response.headers.get('x-model-id') 
  || response.headers.get('x-request-id')
  || fallbackModelDetection(); // existing logic

// Send to background with model included
chrome.runtime.sendMessage({
  type: 'trackUsage',
  prompt: promptText,
  response: responseText,
  tokens: { input: inputCount, output: outputCount },
  model: model,
  timestamp: Date.now()
});
```

### background.js (Service Worker)

**Current behavior:** ✓ Receives message, sends to backend  
**New behavior:**

Enhanced payload to backend includes raw_prompt and raw_response:
```javascript
const payload = {
  model: message.model,
  input_tokens: message.tokens.input,
  output_tokens: message.tokens.output,
  raw_prompt: message.prompt,      // NEW: for categorization
  raw_response: message.response,   // NEW: for categorization
  timestamp: message.timestamp
};

fetch('http://localhost:3000/api/usage/track', {
  method: 'POST',
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' }
});
```

**No UI changes** – all processing happens silently in background.

---

## Backend Changes

### New Service: `categorizationService.js`

Purpose: Call Claude Haiku to categorize and rate effectiveness.

**Function: `categorize(prompt, response)`**

Input:
```typescript
{
  prompt: string,      // user's original message (max 2000 chars)
  response: string     // assistant's response (max 2000 chars)
}
```

Output:
```typescript
{
  category: "Code" | "Research" | "Analysis" | "Writing" | "Support" | "Other",
  effectiveness_score: number (0.0-1.0),
  reasoning: string
}
```

**Implementation:**

1. Truncate inputs to 2000 chars if longer (preserve start + end)
2. Build system prompt for Haiku:
   ```
   Categorize this interaction into ONE category:
   - Code: Programming, debugging, code reviews, technical implementation
   - Research: Fact-finding, explanations, learning, analysis
   - Analysis: Data analysis, comparisons, evaluations, business logic
   - Writing: Content creation, text refinement, creative writing
   - Support: Troubleshooting, help requests, how-to guidance
   - Other: Anything else
   
   Also provide an effectiveness score (0.0-1.0) indicating whether the assistant's response successfully addressed the user's request.
   
   User Prompt: "[prompt]"
   Assistant Response: "[response]"
   
   Respond as JSON:
   {
     "category": "Code",
     "effectiveness_score": 0.85,
     "reasoning": "User asked for debugging help, assistant provided working code solution."
   }
   ```
3. Call Anthropic SDK with Haiku model
4. Parse JSON response
5. Return structured result or throw error (caught by controller)

### Updated: `usageController.js` (`POST /api/usage/track`)

**Current flow:** ✓ Save to DB, calculate cost  
**New flow:**

```javascript
// 1. Save initial record with pending categorization
const record = {
  model,
  input_tokens,
  output_tokens,
  cost,
  source: 'extension',
  category: 'Pending',
  effectiveness_score: null,
  effectiveness_confirmed: false,
  created_at: new Date()
};
const recordId = await db.insert('usage_records', record);

// 2. Async: Categorize (don't wait for response)
categorizationService.categorize(rawPrompt, rawResponse)
  .then(result => {
    // Update record with categorization
    db.update('usage_records', recordId, {
      category: result.category,
      effectiveness_score: result.effectiveness_score,
      haiku_reasoning: result.reasoning
    });
  })
  .catch(err => {
    // Log error, leave as 'Pending', retry later
    console.error('Categorization failed:', err);
  });

// 3. Return immediately to client (don't block)
res.json({ success: true, recordId });
```

### New Endpoint: `PUT /api/usage/:id/confirm-effectiveness`

Purpose: User confirms or corrects the categorization.

**Request:**
```json
{
  "effectiveness_confirmed": true,
  "user_category_override": "Code"  // optional, if user disagrees
}
```

**Response:**
```json
{
  "success": true,
  "record": { id, category, effectiveness_score, effectiveness_confirmed, ... }
}
```

**Implementation:**
```javascript
app.put('/api/usage/:id/confirm-effectiveness', (req, res) => {
  const { id } = req.params;
  const { effectiveness_confirmed, user_category_override } = req.body;
  
  const updates = { effectiveness_confirmed };
  if (user_category_override) {
    updates.category = user_category_override;
  }
  
  db.update('usage_records', id, updates);
  res.json(db.findById('usage_records', id));
});
```

### Existing Endpoints: Enhanced

**GET `/api/usage/history`** – Add filters:
- `?category=Code|Research|...` – Filter by category
- `?confirmed=true|false|pending` – Filter by confirmation status

**GET `/api/usage/summary`** – Group by category:
```json
{
  "by_category": {
    "Code": { count: 45, cost: 12.50, effectiveness_avg: 0.82 },
    "Research": { count: 23, cost: 5.20, effectiveness_avg: 0.76 },
    ...
  }
}
```

**GET `/api/usage/models`** – Include category breakdown per model:
```json
{
  "claude-3-5-sonnet": {
    "total_cost": 45.20,
    "by_category": {
      "Code": { count: 45, cost: 12.50 },
      "Research": { count: 23, cost: 5.20 }
    }
  }
}
```

---

## Frontend Changes

### ActivityTable Component

**New Columns:**

1. **Category**
   - Display category badge (Code=green, Research=blue, Analysis=purple, Writing=orange, Support=red, Other=gray)
   - If `effectiveness_confirmed=false`: show badge with outline/dashed border (indicates "suggested")
   - If `effectiveness_confirmed=true`: solid badge

2. **Effectiveness**
   - If pending: `⏳ Pending` (Haiku still processing)
   - If not confirmed: `⭐ 0.82 | ✓ ✗` (score + quick confirm/reject buttons)
   - If confirmed: `✓ Success` or `✗ Failed` (simple checkmark/cross)

3. **Actions** (expand existing)
   - `✓` button → Mark as confirmed (POST confirmation)
   - `✗` button → Open "Correct" modal
   - `🔧` button → Modal with dropdowns to override category + effectiveness

**Correct Modal:**
```
Category: [Dropdown: Code, Research, Analysis, Writing, Support, Other]
Effectiveness: [Dropdown: Success (0.9), Failed (0.1)]
[Save] [Cancel]
```

### New Dashboard Tabs

#### Tab 1: "By Category"

Shows pie/bar chart of usage by category (like current model breakdown):
```
Code         45 requests, $12.50, ⭐0.82 avg effectiveness
Research     23 requests, $5.20,  ⭐0.76 avg effectiveness
Analysis     18 requests, $4.10,  ⭐0.88 avg effectiveness
Writing      12 requests, $2.80,  ⭐0.91 avg effectiveness
Support       8 requests, $1.90,  ⭐0.70 avg effectiveness
Other         5 requests, $1.20,  ⭐0.60 avg effectiveness
```

#### Tab 2: "Model × Category Matrix"

Table view showing model + category intersection:
```
           Code    Research  Analysis  Writing  Support  Other
Sonnet     25,$5   10,$2     8,$2      7,$2     5,$1     2,$0.50
Haiku      15,$2   10,$1.5   8,$1.5    4,$0.50  2,$0.30  2,$0.40
Opus       5,$5    3,$3      2,$2      1,$1     1,$1     1,$1
```

#### Tab 3: "Effectiveness Analysis"

Shows which categories are most successful with success rate percentages.

---

## Error Handling

### Haiku Categorization Fails

Leave record with `category: 'Pending'`. Automatic retry every 30 minutes, max 3 attempts.

### Prompt/Response Too Long

Truncate to max 2000 chars (preserve start + end).

### Rate Limiting

Queue max 10 Haiku calls per minute to control costs.

### Model Detection Fails

Fallback to existing detection logic, store `model: 'Unknown'` if still undetectable.

---

## Testing Strategy

### Unit Tests
- `categorizationService.test.js` – Test with mock Haiku responses
- `ActivityTable.test.jsx` – Test category badge and effectiveness display

### Integration Tests
- E2E flow: Extension → Backend → Categorization → Dashboard
- Test error scenarios: timeout, long text, unknown model

### Manual Checklist
- [ ] Track a real conversation
- [ ] Verify model name captured
- [ ] Verify category appears (not "Pending")
- [ ] Verify effectiveness score is reasonable
- [ ] Confirm/correct in dashboard works
- [ ] Filter by category works
- [ ] New dashboard tabs show correct data

---

## Success Criteria

- [x] Model attribution works
- [x] Categorization is automatic and accurate
- [x] Effectiveness tracking shows actionable insights
- [x] User can correct suggestions
- [x] Dashboard shows new analytics
- [x] No performance regression
- [x] Pending items don't block user experience
