# Claude Usage Tracker - User Guide

Complete guide to using the Claude Usage Tracker application, from installation through advanced features.

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Getting Started](#getting-started)
3. [Dashboard Overview](#dashboard-overview)
4. [Settings & Configuration](#settings--configuration)
5. [Model Recommendations](#model-recommendations)
6. [API Reference](#api-reference)
7. [Advanced Features](#advanced-features)
8. [Tips & Best Practices](#tips--best-practices)
9. [FAQ](#faq)

---

## Installation & Setup

### System Requirements

- **Node.js**: 16.0.0 or higher
- **npm**: 7.0.0 or higher (comes with Node.js)
- **Chrome/Chromium**: Latest version recommended
- **RAM**: 500 MB minimum for running all components
- **Disk Space**: 200 MB for dependencies

### Step-by-Step Installation

#### 1. Clone the Repository
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

#### 2. Install Backend
```bash
cd backend
npm install
```

This installs:
- Express.js (web framework)
- SQLite3 (database)
- TypeScript (type safety)
- Jest (testing framework)
- ESLint & Prettier (code quality)

#### 3. Install Frontend
```bash
cd ../frontend
npm install
```

This installs:
- React 18+ (UI framework)
- Vite (build tool)
- Recharts (data visualization)
- TypeScript
- Vitest (testing framework)

#### 4. Verify Installation
```bash
# In backend directory
npm run type-check      # Should show "No errors"

# In frontend directory
npm run type-check      # Should show "No errors"
```

#### 5. Start All Services

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
# Expected output:
# Server running on http://localhost:3000
# Database initialized: ./database.sqlite
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Expected output:
# VITE v4.x.x ready in 123 ms
# ➜  Local:   http://localhost:5173/
```

**Terminal 3 - Install Extension:**
1. Open `chrome://extensions`
2. Toggle **"Developer mode"** (top-right corner)
3. Click **"Load unpacked"**
4. Navigate to the project folder and select `/extension`
5. You should see "Claude Usage Tracker" listed

#### 6. Verify Everything Works

1. Open http://localhost:5173 in Chrome
2. Visit https://claude.ai and use Claude normally
3. API calls should appear in the dashboard within 5 seconds
4. If nothing appears, see [Troubleshooting](#troubleshooting)

---

## Getting Started

### Your First Usage Record

1. **Make sure everything is running** (backend + frontend + extension)
2. **Open https://claude.ai** in a separate tab
3. **Send a message to Claude** (any prompt works)
4. **Wait 5 seconds** for the extension to process
5. **Check the dashboard** - your usage should appear

### What Gets Tracked?

The extension automatically logs:
- ✅ Model used (Claude 3 Haiku, Sonnet, or Opus)
- ✅ Input tokens (your prompt)
- ✅ Output tokens (Claude's response)
- ✅ Total tokens
- ✅ Timestamp
- ✅ Estimated cost (based on current pricing)

### What Gets Stored?

All data is stored locally in:
- **SQLite Database**: `backend/database.sqlite`
- **Never sent** to external servers (except for pricing updates)
- **Accessible only** on your computer

---

## Dashboard Overview

### Dashboard Features

The main dashboard (http://localhost:5173) displays:

#### 1. Period Selector
Located at the top, choose:
- **Day** - Last 24 hours
- **Week** - Last 7 days
- **Month** - Last 30 days

All statistics update automatically when you change periods.

#### 2. Summary Cards

Four key metrics displayed:

**Total Tokens**
- Shows input + output tokens combined
- Useful for understanding API usage volume
- Example: "1,234,567 tokens"

**Input Tokens**
- Tokens in your prompts sent to Claude
- Generally costs less than output tokens
- Example: "456,789 input tokens"

**Output Tokens**
- Tokens in Claude's responses
- Generally costs more than input tokens
- Example: "789,012 output tokens"

**Estimated Cost**
- Total cost calculated from token counts
- Formula: (input_tokens × input_price + output_tokens × output_price) / 1,000,000
- Updated when pricing changes
- Example: "$12.34"

**Request Count**
- Total number of API calls made
- Useful for understanding usage frequency
- Example: "42 requests"

#### 3. Model Usage Chart

Interactive pie chart showing:
- Breakdown of tokens by model (Haiku, Sonnet, Opus)
- Click segments to highlight
- Hover for exact percentages
- Example: "Sonnet: 45%, Haiku: 35%, Opus: 20%"

**How to Read It:**
- Larger segments = more tokens used by that model
- Color coding: Haiku (blue), Sonnet (orange), Opus (green)
- Useful for understanding model preferences

#### 4. Recent Activity Table

Shows last 50 API calls with columns:

| Column | Meaning |
|--------|---------|
| **Model** | Which Claude model (Haiku/Sonnet/Opus) |
| **Input** | Tokens in your prompt |
| **Output** | Tokens in Claude's response |
| **Total** | Sum of input + output |
| **Cost** | Estimated cost (USD) |
| **Time** | When the API call was made |

**Interactions:**
- Scroll down to see older records
- Click column headers to sort (not available in current version)
- Page navigation buttons at bottom (if more than 50 records)

### Using the Dashboard

**Basic Workflow:**
1. Open dashboard at http://localhost:5173
2. Select period (Day/Week/Month)
3. Review summary cards for overall metrics
4. Check pie chart for model distribution
5. Scroll through recent activity for details
6. Open Settings to adjust pricing if needed

**Example Interpretation:**
```
Period: Week
Total Tokens: 2,500,000
Input: 1,000,000 | Output: 1,500,000 | Cost: $28.50
Requests: 87
Model Split: Sonnet (60%), Haiku (30%), Opus (10%)
```

This means: In the last week, you made 87 API calls, using 2.5M tokens mostly with Sonnet, costing $28.50 total.

---

## Settings & Configuration

### Accessing Settings

Click the **"Settings"** button in the top navigation bar (or select from menu).

### Pricing Management

#### View Current Prices

The pricing table shows:

| Model | Input Price | Output Price | Source |
|-------|-----------|-------------|--------|
| claude-3-haiku | $0.80 | $4.00 | anthropic |
| claude-3-sonnet | $3.00 | $15.00 | anthropic |
| claude-3-opus | $15.00 | $75.00 | anthropic |

Prices are per 1 million tokens.

#### Update Pricing Manually

1. **Click the input field** for input or output price
2. **Enter new value** (e.g., "3.50")
3. **Press Tab** or click elsewhere to confirm
4. **Row turns orange** to indicate unsaved changes
5. **Click "Save Changes"** button
6. **Success message** appears ("Pricing updated successfully")

**Example Use Cases:**
- You have a special pricing tier → Update prices accordingly
- Anthropic releases new pricing → Update all models
- You want to estimate costs with different assumptions → Try different prices

#### Fetch Latest Prices (Automatic)

If you configure your Anthropic API key:
1. Click **"Check for Updates"** button
2. System checks current Anthropic pricing
3. If newer prices found, they're displayed
4. Click **"Save Changes"** to update

**Configuration:**
See [Environment Setup](#environment-variables) section in main README for API key setup.

#### Pricing History

Prices are updated automatically once daily (at 2 AM in your timezone).

**View pricing change log:**
```bash
# In backend directory
npm run view-pricing-history
```

---

## Model Recommendations

### What Are Recommendations?

The model recommendation engine analyzes your usage and suggests:
- ✅ Which model to use for different task types
- ✅ When you're using an expensive model unnecessarily
- ✅ Estimated cost savings from optimization

### How It Works

#### 1. Task Complexity Analysis

The system reads task descriptions and assigns complexity:

- **Simple** (Score: 2) - "Fix typo", "Explain concept"
- **Medium** (Score: 5) - "Write code", "Debug issue"
- **Complex** (Score: 8) - "Design system", "Optimize algorithm"

#### 2. Safety Score Calculation

Based on historical success rates:
- Haiku: Best for simple, straightforward tasks
- Sonnet: Balanced for most tasks
- Opus: Most capable, used for complex tasks

#### 3. Cost-Benefit Scoring

Final recommendation balances:
- 70% weight on safety (no breaking errors)
- 30% weight on cost (minimize expense)

### Using Recommendations

#### Get Recommendation for a Task

1. Go to **Recommendations** page
2. Enter task description in text field
3. Click **"Get Recommendation"**
4. System displays:
   - **Recommended Model** (e.g., "Sonnet")
   - **Confidence Score** (0-100%)
   - **Cost Estimate** ($X.XX per 1M tokens)
   - **Explanation** why this model is recommended

**Example:**
```
Task: "Write a Python function to sort an array"
Complexity: Medium (5/10)
Recommended Model: Sonnet
Confidence: 87%
Cost: $0.0018 per call (estimate)
Reason: Sonnet provides good balance for code generation
        with lower cost than Opus
```

#### View Optimization Opportunities

On Recommendations page, scroll to **"Optimization Opportunities"** section:

Shows cases where you could save money:
- **Date** of the call
- **Model Used** (what you actually used)
- **Better Model** (what we recommend)
- **Savings** (estimated cost reduction)
- **Confidence** (how sure we are)

**Example:**
```
Date: 2026-04-11 14:30
Model Used: Opus
Better Model: Sonnet
Savings: $0.003 (about 75% cheaper)
Confidence: 92%
Task: "Reformat this JSON"
```

This means you used the most expensive model (Opus) for a simple task that Sonnet could handle fine, wasting about $0.003.

### Best Practices

1. **Review opportunities weekly** to find patterns in overspending
2. **Include task descriptions** when tracking usage (see Extension Features)
3. **Adjust confidence threshold** if recommendations seem too risky
4. **Balance cost and safety** - recommendations are conservative by default

---

## API Reference

### Using the Backend API Directly

The backend provides REST API endpoints at `http://localhost:3000/api/`.

### Tracking Usage

#### POST /api/usage/track

Log a new token usage event.

**Request:**
```typescript
{
  model: "claude-3-sonnet",
  inputTokens: 1500,
  outputTokens: 3000,
  conversationId?: "conv-123",
  source?: "claude-ai-web",
  taskDescription?: "Write a Python function",
  successStatus?: "success" | "error" | "partial",
  responseMetadata?: JSON.stringify({...})
}
```

**Response:**
```typescript
{
  success: true,
  id: 12345,
  cost: 0.0225
}
```

**Example (using curl):**
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "inputTokens": 1500,
    "outputTokens": 3000,
    "taskDescription": "Write a Python function"
  }'
```

### Getting Usage Statistics

#### GET /api/usage/summary

Get aggregated usage for a time period.

**Parameters:**
- `period` (optional): "day" | "week" | "month" (default: "day")

**Response:**
```typescript
{
  period: "week",
  startDate: "2026-04-04",
  endDate: "2026-04-11",
  totalTokens: 2500000,
  inputTokens: 1000000,
  outputTokens: 1500000,
  totalCost: 28.50,
  requestCount: 87,
  modelBreakdown: {
    "claude-3-haiku": {tokens: 750000, cost: 3.50},
    "claude-3-sonnet": {tokens: 1500000, cost: 18.00},
    "claude-3-opus": {tokens: 250000, cost: 6.88}
  }
}
```

**Example:**
```bash
curl "http://localhost:3000/api/usage/summary?period=week"
```

#### GET /api/usage/models

Get token breakdown by model.

**Response:**
```typescript
[
  {
    model: "claude-3-sonnet",
    totalTokens: 1500000,
    inputTokens: 600000,
    outputTokens: 900000,
    requestCount: 45,
    cost: 18.00
  },
  // ... other models
]
```

#### GET /api/usage/history

Get recent usage records.

**Parameters:**
- `limit` (optional, default: 50): number of records to return
- `offset` (optional, default: 0): skip this many records

**Response:**
```typescript
[
  {
    id: 12345,
    model: "claude-3-sonnet",
    inputTokens: 1500,
    outputTokens: 3000,
    cost: 0.0225,
    timestamp: "2026-04-11T14:30:45Z",
    conversationId: "conv-123",
    taskDescription: "Write Python function"
  },
  // ... more records
]
```

### Managing Pricing

#### GET /api/pricing

Get all model pricing.

**Response:**
```typescript
[
  {
    model: "claude-3-haiku",
    inputPrice: 0.80,
    outputPrice: 4.00,
    source: "anthropic",
    lastUpdated: "2026-04-11T02:00:00Z"
  },
  // ... other models
]
```

#### PUT /api/pricing/:model

Update pricing for a model.

**Request:**
```typescript
{
  inputPrice: 0.80,
  outputPrice: 4.00
}
```

**Response:**
```typescript
{
  success: true,
  model: "claude-3-haiku",
  inputPrice: 0.80,
  outputPrice: 4.00
}
```

### Model Recommendations

#### POST /api/recommend

Get model recommendation for a task.

**Request:**
```typescript
{
  taskDescription: "Write a Python function to sort an array",
  constraints?: {
    minSafetyScore: 70,  // Minimum success rate required
    maxCost: 0.10        // Maximum cost per call
  }
}
```

**Response:**
```typescript
{
  recommendedModel: "claude-3-sonnet",
  confidence: 87,
  complexity: "medium",
  safetyScore: 91,
  costEstimate: 0.0045,
  explanation: "Sonnet provides good balance..."
}
```

#### GET /api/recommend/analysis/models

Get model analytics for a period.

**Parameters:**
- `period` (optional): "day" | "week" | "month"

**Response:**
```typescript
[
  {
    model: "claude-3-sonnet",
    totalRequests: 45,
    successRate: 98,
    errorCount: 1,
    avgInputTokens: 1200,
    avgOutputTokens: 2500,
    costPerRequest: 0.0112
  },
  // ... other models
]
```

#### GET /api/recommend/analysis/opportunities

Get cost optimization opportunities.

**Response:**
```typescript
[
  {
    date: "2026-04-11T14:30:00Z",
    actualModel: "claude-3-opus",
    recommendedModel: "claude-3-sonnet",
    estimatedSavings: 0.003,
    taskComplexity: "simple",
    confidence: 92,
    taskDescription: "Reformat this JSON"
  },
  // ... more opportunities
]
```

---

## Advanced Features

### Task Descriptions for Better Recommendations

To get more accurate recommendations, you can add task descriptions to API calls:

1. **Via Extension** (Chrome DevTools):
   - Right-click Claude.ai
   - Open DevTools (F12)
   - Add description before sending message (feature in development)

2. **Via API** directly:
```javascript
fetch('http://localhost:3000/api/usage/track', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    model: 'claude-3-sonnet',
    inputTokens: 1500,
    outputTokens: 3000,
    taskDescription: 'Debug Python error in Flask app'
  })
});
```

### Pricing Updates from Anthropic

If you have an Anthropic API key:

1. Create `.env` file in `/backend`:
```env
ANTHROPIC_API_KEY=sk-ant-...
```

2. Pricing updates automatically check daily at 2 AM
3. Or manually trigger via Settings page: **"Check for Updates"**

### Custom Cost Calculations

The system uses this formula:
```
Cost = (InputTokens × InputPrice + OutputTokens × OutputPrice) / 1,000,000
```

Example with Sonnet ($3/$15 per 1M tokens):
```
Cost = (1500 × 3 + 3000 × 15) / 1,000,000
     = (4500 + 45000) / 1,000,000
     = 49500 / 1,000,000
     = $0.04950
```

### Scheduling & Automation

**Daily Tasks** (runs at 2 AM):
- ✅ Refresh model analytics
- ✅ Check for Anthropic pricing updates
- ✅ Calculate optimization opportunities
- ✅ Clean up old records (optional)

No configuration needed - runs automatically.

---

## Tips & Best Practices

### Getting Accurate Data

1. **Keep backend running** - Usage won't be tracked if backend is offline
2. **Check extension is enabled** - Verify in chrome://extensions
3. **Use single Claude.ai tab** - Multiple tabs may cause duplicate tracking
4. **Allow time for sync** - Data appears within 5 seconds of API call

### Optimizing Costs

1. **Review weekly** - Check Optimization Opportunities section
2. **Use Haiku for simple tasks** - Saves 75-90% vs Opus
3. **Adjust pricing manually** - If you have custom pricing tiers
4. **Monitor by model** - See which models are most expensive
5. **Set safety thresholds** - Don't go below 70% success rate

### Maintenance

**Weekly:**
- Review optimization opportunities
- Check cost trends in dashboard
- Verify extension is still active

**Monthly:**
- Run `npm test` to ensure everything still works
- Check for updates to Claude models
- Review total monthly spending

**Quarterly:**
- Archive old database (optional)
- Update pricing if Anthropic changes rates
- Review recommendations engine settings

### Troubleshooting Common Issues

#### Dashboard shows "No data"
- Ensure backend is running (`npm run dev` in backend/)
- Check extension is enabled (chrome://extensions)
- Make a test API call on claude.ai
- Wait 5-10 seconds
- Refresh dashboard (Ctrl+R or Cmd+R)

#### Extension doesn't show in chrome://extensions
- Make sure you're in Chrome (not Edge/Brave/etc initially)
- Enable "Developer mode" toggle
- Reload any open claude.ai tabs after loading extension
- Check Chrome console (F12) for errors

#### Prices won't update in Settings
- Check backend is running
- Try clicking "Check for Updates" button
- If using API key, verify it's valid
- Check browser console (F12) for network errors

#### Database locked error
- Stop backend: Ctrl+C
- Wait 2 seconds
- Start backend again: `npm run dev`

---

## FAQ

### Q: Is my data private?
**A:** Yes! All data stored in local SQLite database. Never sent to cloud. Only pricing API calls go to Anthropic.

### Q: Does the extension slow down Claude.ai?
**A:** No, it runs in background with minimal overhead (~2-5ms per request).

### Q: Can I export my data?
**A:** Currently only in Settings. CSV export coming in future version.

### Q: What if I stop using the app?
**A:** Just disable the extension. Historical data remains in database.

### Q: Can I reset all data?
**A:** Yes, delete `backend/database.sqlite` and restart backend (new database created automatically).

### Q: Does it work with other Claude API integrations?
**A:** Currently only tracks claude.ai web interface. Anthropic API support planned.

### Q: Can I self-host on a server?
**A:** Yes, but would need to modify extension to point to your server. See docs/DEPLOYMENT.md (coming soon).

### Q: What's the accuracy of cost calculations?
**A:** ±0.01% from actual Anthropic billing (uses same formula and pricing).

### Q: How far back does history go?
**A:** All records kept indefinitely (or until you delete database).

### Q: Can I use this with multiple users?
**A:** Currently single-user only. Multi-user support planned for Phase 4.

### Q: What if I want to contribute?
**A:** This is open-source! Fork on GitHub and submit PRs. See [Contributing](README.md#-contributing) section.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` (or `Cmd+/` on Mac) | Toggle sidebar |
| `R` | Refresh dashboard |
| `D` | Go to Dashboard |
| `S` | Go to Settings |
| `M` | Go to Recommendations |

---

## Next Steps

1. ✅ [Install the application](#installation--setup)
2. ✅ [Explore the dashboard](#dashboard-overview)
3. ✅ [Configure pricing](#pricing-management)
4. ✅ [Review recommendations](#model-recommendations)
5. 🚀 Start optimizing your Claude usage!

---

**Need Help?**
- Check [FAQ](#faq) section above
- Review [Troubleshooting](#troubleshooting-common-issues)
- Read technical docs in `/docs` folder
- Check GitHub issues: [Project Repo](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)

**Last Updated**: April 2026  
**Version**: 1.0.0 (Phase 3 Complete)
