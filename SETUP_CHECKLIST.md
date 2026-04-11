# Claude Usage Tracker - Setup Checklist

Use this checklist to ensure successful installation and setup.

## Pre-Installation

- [ ] Node.js 16+ installed
  - Check: `node --version`
- [ ] npm installed
  - Check: `npm --version`
- [ ] Chrome or Firefox browser available
- [ ] Two terminal windows ready
- [ ] Port 3000 is available (not in use)
- [ ] Port 5173 is available (not in use)

## Installation Phase

### Backend Setup
- [ ] Navigate to backend folder: `cd backend`
- [ ] Install dependencies: `npm install`
- [ ] Start server: `npm run dev`
- [ ] See "Server running on http://localhost:3000" message
- [ ] Database created: `backend/database.sqlite`
- [ ] Pricing table initialized with default values

### Frontend Setup
- [ ] Navigate to frontend folder: `cd frontend`
- [ ] Install dependencies: `npm install`
- [ ] Start dev server: `npm run dev`
- [ ] See "http://localhost:5173" in terminal
- [ ] Dashboard loads in browser (may show "Loading...")

### Extension Installation

**Chrome:**
- [ ] Open `chrome://extensions`
- [ ] Toggle "Developer mode" (top right)
- [ ] Click "Load unpacked"
- [ ] Select the `extension` folder
- [ ] Extension icon appears in toolbar
- [ ] Extension shows as enabled (blue toggle)

**Firefox:**
- [ ] Open `about:debugging#/runtime/this-firefox`
- [ ] Click "Load Temporary Add-on..."
- [ ] Navigate to `extension/manifest.json`
- [ ] Click "Open"
- [ ] Extension appears in the list
- [ ] Icon appears in toolbar

## Verification Phase

### Backend Verification
- [ ] Terminal shows "Server running on http://localhost:3000"
- [ ] Run in another terminal: `curl http://localhost:3000/health`
- [ ] Get response: `{"status":"ok"}`
- [ ] Run: `curl http://localhost:3000/api/pricing`
- [ ] Get pricing data in response

### Frontend Verification
- [ ] Navigate to `http://localhost:5173` in browser
- [ ] Dashboard page loads
- [ ] Navigation buttons visible (Dashboard, Settings)
- [ ] "Loading..." message appears (normal on first load)
- [ ] No red error boxes visible
- [ ] Press F12 to check console - no errors

### Extension Verification
- [ ] Extension icon visible in toolbar
- [ ] Click extension icon - popup opens
- [ ] Popup shows title "📊 Usage Today"
- [ ] "Loading stats..." message appears
- [ ] No error messages in popup

## Functionality Test

### Test 1: Manual Tracking
- [ ] In another terminal, run:
  ```bash
  curl -X POST http://localhost:3000/api/usage/track \
    -H "Content-Type: application/json" \
    -d '{"model":"Claude 3.5 Sonnet","input_tokens":1000,"output_tokens":500}'
  ```
- [ ] Get response with cost calculated
- [ ] Extension popup updates with new stats
- [ ] Dashboard shows data (refresh if needed)

### Test 2: Real Usage Tracking
- [ ] Go to https://claude.ai
- [ ] Start a conversation
- [ ] Send message to Claude
- [ ] Wait for response (10+ seconds)
- [ ] Check extension popup - stats updated
- [ ] Go to dashboard - new entry in Activity table
- [ ] Verify model name, tokens, cost shown

### Test 3: Dashboard Features
- [ ] Dashboard page loads data (not "No data")
- [ ] 5 summary cards show numbers
- [ ] Click "Week" button - stats update
- [ ] Click "Month" button - stats update
- [ ] Click "Day" button - back to today
- [ ] Pie chart displays (if data exists)
- [ ] Recent activity table shows records
- [ ] Hover over table - rows highlight

### Test 4: Settings & Pricing
- [ ] Click "Settings" button
- [ ] Pricing table loads
- [ ] See all models listed (Sonnet, Haiku, Opus)
- [ ] Click "Edit" on a model
- [ ] Input fields become editable
- [ ] Change a number
- [ ] Click "Save"
- [ ] Success message appears
- [ ] Go back to Dashboard
- [ ] Verify costs updated with new pricing

## First Use

- [ ] Visit https://claude.ai
- [ ] Have a conversation with Claude
- [ ] Send 5+ messages
- [ ] Extension tracks each response
- [ ] Dashboard updates with new data
- [ ] View stats in extension popup
- [ ] View analytics in dashboard
- [ ] Check Settings page for pricing

## Troubleshooting Checklist

If something doesn't work:

### Backend Won't Start
- [ ] Check port 3000 is free: `lsof -i :3000`
- [ ] Kill existing process if needed: `kill -9 <PID>`
- [ ] Try different port: `PORT=3001 npm run dev`
- [ ] Check Node.js version: `node --version` (should be 16+)
- [ ] Delete node_modules and try again:
  ```bash
  rm -rf node_modules
  npm install
  npm run dev
  ```

### Frontend Won't Start
- [ ] Check port 5173 is free: `lsof -i :5173`
- [ ] Kill existing process if needed
- [ ] Check Node.js version: `node --version`
- [ ] Delete node_modules and try again:
  ```bash
  rm -rf node_modules
  npm install
  npm run dev
  ```

### Extension Not Tracking
- [ ] Verify backend is running: `curl http://localhost:3000/health`
- [ ] Reload extension: `chrome://extensions` → reload button
- [ ] Check console for errors: F12 → Console
- [ ] Verify you're on claude.ai (not claude.com)
- [ ] Try manually tracking via curl (see Test 1 above)
- [ ] Check extension popup (may show connection error)

### Dashboard Shows "No Data"
- [ ] Verify backend is running
- [ ] Check browser console (F12) for errors
- [ ] Make sure you've generated usage:
  - Visit claude.ai
  - Have a conversation
  - Wait 5 seconds for sync
- [ ] Refresh dashboard (F5 or refresh button)
- [ ] Check that extension is tracking (see popup)

### Pricing Won't Update
- [ ] Verify backend is running
- [ ] Check browser console (F12) for errors
- [ ] Ensure all 3 services are running
- [ ] Try refreshing the page
- [ ] Try submitting pricing again
- [ ] Check backend logs in terminal

### Browser Extension Icon Missing
- [ ] Go to `chrome://extensions` (Chrome) or `about:addons` (Firefox)
- [ ] Verify extension is listed and enabled
- [ ] Check that extension folder exists
- [ ] Verify `manifest.json` is in extension folder
- [ ] Try "Load unpacked" again
- [ ] Try restarting browser

### npm Command Not Found
- [ ] Install Node.js from https://nodejs.org
- [ ] Restart terminal after installation
- [ ] Verify: `npm --version`

## Final Verification

Once everything is working:

- [ ] All 3 services running without errors
- [ ] Backend responds to health check
- [ ] Frontend dashboard loads
- [ ] Extension icon visible and functional
- [ ] Extension tracks real Claude.ai usage
- [ ] Dashboard displays tracked data
- [ ] Settings page works
- [ ] Pricing can be edited and saved

## Ready to Use!

If all checkboxes are checked, your Claude Usage Tracker is fully operational.

### Next Steps
1. **Monitor Daily**: Check dashboard regularly
2. **Update Pricing**: Adjust rates in Settings as needed
3. **View Analytics**: Check charts and trends
4. **Export Data**: (Coming soon) Download usage history

## Support

If you get stuck:
1. Check the [Troubleshooting section in INSTALLATION.md](./INSTALLATION.md#troubleshooting)
2. Review [TESTING.md](./TESTING.md) for detailed test procedures
3. Check browser console (F12) for error messages
4. Verify all services are running
5. Check backend terminal for log messages

---

**Congratulations! You've set up Claude Usage Tracker!** 🎉

Start tracking your Claude usage today and monitor your spending in real-time.
