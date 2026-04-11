# Installation Guide

Complete step-by-step guide to get Claude Usage Tracker up and running.

## Requirements

- **Node.js**: v16 or higher ([download](https://nodejs.org))
- **npm**: Usually comes with Node.js
- **Chrome or Firefox**: Browser to run the extension
- **Terminal/Command Prompt**: To run commands

## Quick Start (5 minutes)

### 1. Clone/Download the Project

```bash
# Navigate to the project directory
cd /path/to/KI\ Usage\ tracker
```

### 2. Start Backend Server

Open a terminal and run:

```bash
cd backend
npm install
npm run dev
```

You should see:
```
Server running on http://localhost:3000
```

✅ **Backend is ready!**

### 3. Start Frontend Dashboard

Open a **new terminal** and run:

```bash
cd frontend
npm install
npm run dev
```

You should see:
```
VITE v5.0.0  ready in 123 ms
➜  Local:   http://localhost:5173/
```

✅ **Frontend is ready!**

### 4. Install Browser Extension

#### For Chrome:

1. Open `chrome://extensions` in Chrome
2. Enable **"Developer mode"** (toggle in top-right)
3. Click **"Load unpacked"**
4. Navigate to `/path/to/extension` folder and select it
5. The extension should appear in your extensions list

#### For Firefox:

1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click **"Load Temporary Add-on..."**
3. Navigate to `/path/to/extension/manifest.json` and open it
4. The extension will be temporarily loaded

✅ **Extension is installed!**

### 5. Start Tracking

1. Visit [claude.ai](https://claude.ai)
2. Have a normal conversation with Claude
3. Check the extension popup or dashboard to see your stats
4. Data will appear in your dashboard at `http://localhost:5173`

## Detailed Setup by Component

### Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Start in development mode (watches for changes)
npm run dev

# OR start in production mode
npm start
```

**What it does:**
- Creates SQLite database at `backend/database.sqlite`
- Initializes tables for usage records and pricing
- Starts API server on port 3000
- Loads default pricing for Claude models

**Verify it works:**
```bash
# In another terminal
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

### Frontend Setup

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start dev server (with hot reload)
npm run dev

# OR build for production
npm run build
```

**What it does:**
- Starts Vite development server on port 5173
- Dashboard syncs with backend every 10 seconds
- React components auto-reload on file changes

**Access it:**
- Open `http://localhost:5173` in your browser

### Extension Setup (Detailed)

#### Chrome:

1. **Enable Developer Mode:**
   - Go to `chrome://extensions`
   - Toggle "Developer mode" (top right)

2. **Load the Extension:**
   - Click "Load unpacked"
   - Select your `extension` folder
   - The extension will appear in your list

3. **Grant Permissions:**
   - Click the extension icon
   - It will ask for permissions to access claude.ai
   - Click "Allow"

4. **Verify Installation:**
   - You should see the extension icon in your toolbar
   - Click it to see the popup with usage stats

#### Firefox:

1. **Open Debug Page:**
   - Type `about:debugging#/runtime/this-firefox` in address bar

2. **Load Temporary Add-on:**
   - Click "Load Temporary Add-on..."
   - Navigate to `extension/manifest.json`
   - Select and open it

3. **Verify Installation:**
   - Extension appears in the installed add-ons list
   - Icon appears in toolbar

**Note:** Firefox's temporary add-ons unload when you restart. To make it permanent, use Firefox Developer Edition or consider submitting to Mozilla Add-ons store.

## Port Configuration

If ports are already in use, you can change them:

### Backend (Port 3000):

```bash
# macOS/Linux
PORT=3001 npm run dev

# Windows
set PORT=3001 && npm run dev
```

Then update extension and frontend to use the new port.

### Frontend (Port 5173):

```bash
# vite.config.js
export default defineConfig({
  server: {
    port: 5174  // Change this
  }
})
```

## Troubleshooting

### Issue: "Port 3000 already in use"

**Solution:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Issue: "Extension not tracking usage"

**Check these:**
1. Backend is running (`http://localhost:3000/health`)
2. Extension is installed and enabled
3. Open `chrome://extensions` and reload the extension
4. Check Console tab for errors (F12)
5. Make sure you're on `claude.ai` (not a different Claude URL)

### Issue: "Dashboard shows 'No data available'"

**Check these:**
1. Have a conversation on claude.ai
2. Wait 5 seconds for sync
3. Click Refresh button on dashboard
4. Check backend logs for errors
5. Verify backend database exists: `backend/database.sqlite`

### Issue: "Pricing won't update"

**Check these:**
1. Backend is running
2. You have internet connection
3. Check backend logs for pricing fetch errors
4. You can manually edit pricing in Settings page

### Issue: "npm: command not found"

**Solution:**
1. Install Node.js from [nodejs.org](https://nodejs.org)
2. Verify installation: `node --version` and `npm --version`
3. Restart terminal after installation

### Issue: "Chrome can't load extension"

**Check these:**
1. You've enabled "Developer mode"
2. Extension folder exists at the path
3. `manifest.json` is in the root of the extension folder
4. Try reloading: go to `chrome://extensions` and click reload button

## Starting All Services at Once

### macOS/Linux Script:

Create `start.sh`:
```bash
#!/bin/bash
echo "Starting Claude Usage Tracker..."
echo ""
echo "Terminal 1: Backend"
cd backend && npm run dev &
sleep 2
echo ""
echo "Terminal 2: Frontend"
cd ../frontend && npm run dev &
sleep 2
echo ""
echo "✅ All services started!"
echo "Backend: http://localhost:3000"
echo "Frontend: http://localhost:5173"
echo "Load extension from: ./extension"
```

Run it:
```bash
chmod +x start.sh
./start.sh
```

### Windows Script:

Create `start.bat`:
```batch
@echo off
echo Starting Claude Usage Tracker...
echo.
start cmd /k "cd backend && npm run dev"
timeout /t 2 /nobreak
start cmd /k "cd frontend && npm run dev"
echo.
echo All services started!
echo Backend: http://localhost:3000
echo Frontend: http://localhost:5173
pause
```

Run it by double-clicking `start.bat`

## Verification Checklist

After installation, verify everything works:

- [ ] Backend starts without errors
- [ ] Frontend loads at `http://localhost:5173`
- [ ] Extension installed and visible in toolbar
- [ ] Extension popup shows stats
- [ ] Visit `claude.ai` and have a conversation
- [ ] Wait 5 seconds
- [ ] Refresh dashboard, see new usage
- [ ] Dashboard shows tokens and cost
- [ ] Settings page loads pricing table
- [ ] Can edit pricing and save

## Next Steps

Once everything is running:

1. **Use Claude Normally** - Just visit claude.ai and chat
2. **Monitor Usage** - Check dashboard whenever you want
3. **Adjust Pricing** - Go to Settings to update token costs
4. **Export Data** - (Coming soon) Export usage history as CSV

## Getting Help

- Check browser console for errors (F12)
- Check backend terminal for log messages
- Verify all services are running:
  - Backend: `http://localhost:3000/health`
  - Frontend: `http://localhost:5173`
  - Extension: Icon visible in toolbar

## Uninstalling

### Extension:

**Chrome:**
- Go to `chrome://extensions`
- Click "Remove" on the Claude Usage Tracker

**Firefox:**
- Go to `about:addons`
- Click "Remove" on the extension

### Backend & Frontend:

Simply delete the `backend` and `frontend` folders. Your data is in `backend/database.sqlite`.

---

**All set! Happy tracking!** 🎉
