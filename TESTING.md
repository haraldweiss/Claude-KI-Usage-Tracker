# Testing Guide

Comprehensive testing procedures to ensure Claude Usage Tracker works correctly.

---

## Automated Testing (Phase 2)

### Overview
This section covers automated unit and integration tests for the Claude Usage Tracker. Both backend and frontend have comprehensive test suites with Jest and Vitest respectively.

### Test Types

#### Unit Tests
- **Backend:** Test individual functions and modules in isolation
- **Frontend:** Test React components in isolation with mocked props and API calls
- **Coverage:** 60%+ of codebase (Phase 2 goal: 75%+)

**Example Backend Unit Test:**
```bash
cd backend && npm test -- controllers/usageController.test.js
```

**Example Frontend Unit Test:**
```bash
cd frontend && npm test -- services/api.test.js
```

#### Integration Tests
- **Backend:** Test API endpoints with actual database
- **Frontend:** Test component interaction and page navigation
- **End-to-End:** Test full flow from extension → backend → dashboard

**Example Backend Integration Test:**
```bash
cd backend && npm run test:integration
```

#### Component Tests
- **Frontend:** Test React components with user interactions
- **Tools:** React Testing Library + Vitest
- **Focus:** User-visible behavior, not implementation details

**Example Component Test:**
```bash
cd frontend && npm test -- pages/Dashboard.test.jsx
```

### Running Tests

#### Run All Backend Tests
```bash
cd backend
npm test              # Run once
npm run test:watch   # Watch mode (re-run on file changes)
npm run test:coverage # Generate coverage report
```

#### Run All Frontend Tests
```bash
cd frontend
npm test              # Run once
npm run test:watch   # Watch mode (re-run on file changes)
npm run test:coverage # Generate coverage report
npm run test:ui       # Interactive test dashboard
```

#### Run Specific Tests
```bash
# Backend: single file
cd backend && npm test -- usageController.test.js

# Frontend: single component
cd frontend && npm test -- pages/Dashboard.test.jsx

# Backend: test matching pattern
cd backend && npm test -- --testNamePattern="track usage"

# Frontend: test matching pattern
cd frontend && npm test -- --testNamePattern="renders summary"
```

### Coverage Reports

#### Generate Backend Coverage
```bash
cd backend && npm run test:coverage
# Output: coverage/index.html
# Open in browser: open coverage/index.html
```

#### Generate Frontend Coverage
```bash
cd frontend && npm run test:coverage
# Output: coverage/index.html
# Open in browser: open coverage/index.html
```

#### Coverage Targets
- **Backend:** 60%+ line coverage (Phase 2: 75%+)
- **Frontend:** 55%+ line coverage (Phase 2: 80%+)
- **Overall:** 60%+ combined coverage

### Test Structure

#### Backend Tests (`backend/src/__tests__/`)
```
__tests__/
├── unit/
│   ├── controllers/
│   │   ├── usageController.test.js
│   │   └── pricingController.test.js
│   ├── services/
│   │   ├── modelRecommendationService.test.js
│   │   └── pricingService.test.js
│   └── middleware/
│       └── errorHandler.test.js
├── integration/
│   ├── routes/
│   │   ├── usage.test.js
│   │   ├── pricing.test.js
│   │   └── recommendation.test.js
│   └── database.test.js
└── setup.js (test environment configuration)
```

#### Frontend Tests (`frontend/src/__tests__/`)
```
__tests__/
├── components/
│   ├── UsageSummary.test.jsx
│   ├── UsageChart.test.jsx
│   └── ActivityTable.test.jsx
├── pages/
│   ├── Dashboard.test.jsx
│   └── Settings.test.jsx
├── services/
│   ├── api.test.js
│   └── priceService.test.js
└── setup.js (test environment configuration)
```

### Writing New Tests

#### Backend Unit Test Example
```javascript
// backend/src/__tests__/unit/controllers/usageController.test.js
import { trackUsage, getSummary } from '../../../controllers/usageController';
import * as db from '../../../database/sqlite';

jest.mock('../../../database/sqlite');

describe('usageController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should track usage and calculate cost', async () => {
    const record = {
      model: 'Claude 3.5 Sonnet',
      input_tokens: 1000,
      output_tokens: 500
    };

    db.addUsageRecord.mockResolvedValue({ id: 1 });

    const result = await trackUsage(record);

    expect(result.id).toBe(1);
    expect(db.addUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'Claude 3.5 Sonnet'
      })
    );
  });

  test('should return error for missing model', async () => {
    const record = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const result = await trackUsage(record);

    expect(result.error).toBeDefined();
  });
});
```

#### Frontend Component Test Example
```javascript
// frontend/src/__tests__/pages/Dashboard.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../../../pages/Dashboard';
import * as api from '../../../services/api';

jest.mock('../../../services/api');

describe('Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render summary cards', async () => {
    api.getSummary.mockResolvedValue({
      total_tokens: 1500,
      total_cost: 0.045,
      request_count: 1
    });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/1500/)).toBeInTheDocument();
    });
  });

  test('should update when period changes', async () => {
    api.getSummary.mockResolvedValue({ total_tokens: 1500 });

    render(<Dashboard />);

    const weekButton = screen.getByText('Week');
    weekButton.click();

    await waitFor(() => {
      expect(api.getSummary).toHaveBeenCalledWith('week');
    });
  });
});
```

### Debugging Tests

#### Backend Debugging
```bash
# Verbose output
cd backend && npm test -- --verbose

# Debug mode (inspect with chrome://inspect)
node --inspect-brk ./node_modules/.bin/jest

# Run single test with detailed error
cd backend && npm test -- usageController.test.js --verbose
```

#### Frontend Debugging
```bash
# Verbose output
cd frontend && npm test -- --reporter=verbose

# Interactive test dashboard
cd frontend && npm run test:ui

# Debug mode
npm test -- --inspect-brk
```

### Continuous Integration

For GitHub Actions (future implementation):
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: cd backend && npm install && npm run test:coverage
      - run: cd frontend && npm install && npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

---

## Quick Test (5 minutes)

### 1. Backend Tests

```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Test health endpoint
curl http://localhost:3000/health
# Expected: {"status":"ok"}

# Test usage tracking
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 500,
    "conversation_id": "test-123"
  }'
# Expected: {"success":true,"id":1,"cost":"0.0045"}

# Test summary
curl http://localhost:3000/api/usage/summary?period=day
# Expected: {"period":"day","request_count":1,"total_input_tokens":1000,"total_output_tokens":500,"total_tokens":1500,"total_cost":0.0045}

# Test pricing
curl http://localhost:3000/api/pricing
# Expected: Array of pricing models
```

### 2. Frontend Tests

1. Visit `http://localhost:5173`
2. Check that dashboard loads
3. Verify Summary cards are visible
4. Check that "No data" message appears (since we just started)
5. Click "Refresh" button
6. Verify no errors in console (F12)

### 3. Extension Tests

1. Go to `chrome://extensions` or `about:addons`
2. Verify extension is installed and enabled
3. Click extension icon
4. Verify popup shows stats (should show the test data we submitted)
5. Check "Backend running on localhost:3000" message

## Detailed Test Scenarios

### Test Scenario 1: Backend API Endpoints

**Purpose:** Verify all backend API endpoints work correctly

**Steps:**

1. **Test Health Check**
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok"}` with status 200

2. **Test Track Usage**
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 500,
    "conversation_id": "conv-abc123"
  }'
```
Expected: `{"success":true,"id":1,"cost":"0.0045"}` with status 201

3. **Test Summary (Day)**
```bash
curl http://localhost:3000/api/usage/summary?period=day
```
Expected: Stats for today with totals

4. **Test Summary (Week)**
```bash
curl http://localhost:3000/api/usage/summary?period=week
```
Expected: Stats for last 7 days

5. **Test Model Breakdown**
```bash
curl http://localhost:3000/api/usage/models
```
Expected: Array with model names and token counts

6. **Test History**
```bash
curl http://localhost:3000/api/usage/history?limit=10&offset=0
```
Expected: Array of recent usage records

7. **Test Pricing GET**
```bash
curl http://localhost:3000/api/pricing
```
Expected: Array of all pricing models

8. **Test Pricing UPDATE**
```bash
curl -X PUT http://localhost:3000/api/pricing/Claude%203.5%20Sonnet \
  -H "Content-Type: application/json" \
  -d '{
    "input_price": 5,
    "output_price": 20
  }'
```
Expected: `{"success":true,"message":"Pricing updated successfully"}`

### Test Scenario 2: Real Claude.ai Tracking

**Purpose:** Verify extension actually tracks real Claude.ai usage

**Steps:**

1. Ensure backend and extension are running
2. Go to https://claude.ai
3. Start a conversation with Claude
4. Send a message to Claude
5. Wait for response
6. Check extension popup - should show updated stats
7. Check dashboard - should show new usage within 10 seconds
8. Verify:
   - Token counts are non-zero
   - Cost is calculated
   - Model name is correct
   - Timestamp is recent

**Expected Results:**
- Extension popup shows: Total Tokens, Input/Output, Cost, Requests
- Dashboard displays summary cards with data
- Recent activity table shows the conversation
- Model breakdown chart updates

### Test Scenario 3: Dashboard Features

**Purpose:** Verify dashboard UI works correctly

**Steps:**

1. **Summary Cards**
   - Navigate to `http://localhost:5173`
   - Verify 5 cards appear: Total Tokens, Input, Output, Cost, Requests
   - Values should update when you add more data

2. **Period Filtering**
   - Click "Day" button - shows today's stats
   - Click "Week" button - shows last 7 days
   - Click "Month" button - shows last 30 days
   - Stats should change based on selected period

3. **Charts**
   - Pie chart should show model breakdown
   - Chart updates when new data is added
   - Hovering over chart shows percentages

4. **Activity Table**
   - Table shows recent usage records
   - Fields: Model, Input, Output, Cost, Time
   - Records are sorted by newest first
   - Table updates every 10 seconds

5. **Refresh Button**
   - Click refresh button
   - Dashboard should re-fetch data
   - Should not duplicate records

### Test Scenario 4: Settings & Pricing

**Purpose:** Verify pricing management works

**Steps:**

1. Go to Settings page
2. Verify pricing table loads with all models
3. Click "Edit" on a model
4. Change the input/output prices
5. Click "Save"
6. Verify "Success" message appears
7. Go back to Dashboard
8. Add new usage data
9. Verify costs are calculated with new pricing
10. Go back to Settings
11. Verify pricing changes were saved

**Expected Results:**
- Pricing updates are reflected immediately
- Cost calculations use new pricing
- Changes persist after reload

### Test Scenario 5: Data Persistence

**Purpose:** Verify data is saved correctly

**Steps:**

1. Add several usage records via API
2. Reload browser
3. Dashboard should still show all data
4. Restart backend server
5. Data should still exist in database
6. Add more records
7. Check database file exists: `backend/database.sqlite`

**Expected Results:**
- Data persists across reloads
- Database file is created
- All records are retained

## Performance Testing

### Test 1: High Volume Data

**Purpose:** Verify system handles lots of data

**Steps:**

1. Add 1000 usage records using loop:
```bash
for i in {1..1000}; do
  curl -X POST http://localhost:3000/api/usage/track \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"Claude 3.5 Sonnet\",
      \"input_tokens\": $((RANDOM * 10)),
      \"output_tokens\": $((RANDOM * 5))
    }" &
done
wait
```

2. Check dashboard loads without lag
3. Verify charts render quickly
4. Activity table still responsive

**Expected Results:**
- Dashboard loads in < 2 seconds
- Charts render smoothly
- No memory leaks

### Test 2: Browser Extension Performance

**Purpose:** Verify extension doesn't slow down Claude.ai

**Steps:**

1. Go to claude.ai
2. Send 10+ messages rapidly
3. Monitor:
   - Page responsiveness
   - CPU usage
   - Memory usage
4. Extension shouldn't noticeably slow down interactions

**Expected Results:**
- No noticeable lag in Claude.ai
- All messages are tracked
- Extension popup shows correct totals

## Edge Cases & Error Handling

### Test 1: Missing Fields

**Purpose:** Verify API rejects invalid requests

```bash
# Missing model
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"input_tokens": 100, "output_tokens": 50}'
# Expected: 400 error with message

# Missing tokens
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model": "Claude 3.5 Sonnet"}'
# Expected: 400 error with message
```

### Test 2: Backend Down

**Purpose:** Verify extension handles backend failures gracefully

**Steps:**

1. Stop backend server
2. Go to claude.ai
3. Send messages to Claude
4. Extension should queue data
5. Restart backend
6. Data should sync automatically
7. No error messages in console

**Expected Results:**
- Extension continues working
- Data is queued and synced when backend is back
- No crashes or errors

### Test 3: Concurrent Requests

**Purpose:** Verify system handles multiple simultaneous requests

```bash
# Send 10 concurrent requests
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/usage/track \
    -H "Content-Type: application/json" \
    -d '{"model": "Claude 3.5 Sonnet", "input_tokens": 100, "output_tokens": 50}' &
done
wait

# Verify all were recorded
curl http://localhost:3000/api/usage/summary?period=day
# Should show 10+ requests
```

## Debugging Checklist

If tests fail, check:

- [ ] Backend is running: `curl http://localhost:3000/health`
- [ ] Database file exists: `ls -la backend/database.sqlite`
- [ ] Frontend is running: `http://localhost:5173`
- [ ] Extension is loaded and enabled
- [ ] Browser console has no errors (F12)
- [ ] Backend terminal shows request logs
- [ ] All ports (3000, 5173) are available
- [ ] Node.js and npm are installed correctly
- [ ] npm dependencies are installed

## Browser DevTools Tips

### Check Network Requests:

1. Open DevTools (F12)
2. Go to Network tab
3. Refresh page
4. Look for requests to `/api/` endpoints
5. Check response bodies for errors

### Check Console Logs:

1. Open DevTools (F12)
2. Go to Console tab
3. Look for error messages
4. Check extension logs

### Check Extension Messages:

1. Go to `chrome://extensions`
2. Find Claude Usage Tracker
3. Click "Details"
4. Scroll down to "Errors"
5. View service worker or content script errors

## Test Results Template

Use this template to document test results:

```
Date: ___________
Tester: ___________

Backend Tests:
- Health check: PASS / FAIL
- Track usage: PASS / FAIL
- Get summary: PASS / FAIL
- Get models: PASS / FAIL
- Pricing GET: PASS / FAIL

Frontend Tests:
- Dashboard loads: PASS / FAIL
- Summary cards: PASS / FAIL
- Charts render: PASS / FAIL
- Activity table: PASS / FAIL
- Period filtering: PASS / FAIL

Extension Tests:
- Loads in toolbar: PASS / FAIL
- Popup displays: PASS / FAIL
- Tracks usage: PASS / FAIL
- Real Claude.ai tracking: PASS / FAIL

Overall: PASS / FAIL

Issues Found:
1. ___________
2. ___________

Notes:
___________
```

---

All tests passing? You're ready to use Claude Usage Tracker! 🎉
