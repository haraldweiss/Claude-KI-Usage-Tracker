# 🚀 Quick Startup Scripts

One-command startup for backend and frontend!

## macOS / Linux

### Quick Start

```bash
chmod +x start.sh
./start.sh
```

That's it! The script will:
1. ✅ Check Node.js is installed
2. ✅ Install dependencies if needed
3. ✅ Start backend on port 3000
4. ✅ Start frontend on port 5173
5. ✅ Show you all the next steps

Both services open in **new terminal windows** automatically.

### What It Does

The `start.sh` script:
- Detects your OS (macOS or Linux)
- Installs npm dependencies automatically
- Starts backend in a new terminal
- Starts frontend in a new terminal
- Shows helpful instructions

### Stopping Services

Just close the terminal windows, or press `Ctrl+C` in each window.

---

## Windows

### Quick Start

Just **double-click** `start.bat` in the project folder!

Or from Command Prompt:
```cmd
start.bat
```

The script will:
1. ✅ Check Node.js is installed
2. ✅ Install dependencies if needed
3. ✅ Start backend in one window
4. ✅ Start frontend in another window
5. ✅ Show you all the next steps

### Stopping Services

Close the terminal windows, or press `Ctrl+C` in each window.

---

## What Happens After Startup

### 1️⃣ Backend Starts (Port 3000)
```
Server running on http://localhost:3000
```

### 2️⃣ Frontend Starts (Port 5173)
```
VITE v5.0.0 ready in 456ms
  Local:   http://localhost:5173
```

### 3️⃣ Load the Browser Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle on top right)
3. Click **Load unpacked**
4. Select the `/extension` folder
5. Extension appears in toolbar ✅

### 4️⃣ Start Tracking!

1. Visit https://claude.ai
2. Chat with Claude normally
3. Extension tracks automatically
4. View stats at http://localhost:5173

---

## Troubleshooting

### Script Won't Run (macOS/Linux)

```bash
# Make it executable
chmod +x start.sh

# Then run
./start.sh
```

### Node.js Not Found

Install from https://nodejs.org, then restart your terminal.

### Port Already in Use

If port 3000 or 5173 is already in use:

```bash
# Linux/macOS: Find what's using the port
lsof -i :3000

# Kill the process
kill -9 <PID>

# Then run start.sh again
```

### npm install Takes Too Long

The script automatically installs dependencies. This takes 30-60 seconds the first time. Be patient! ⏳

---

## Manual Start (If Script Doesn't Work)

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## Advanced Options

### Run on Different Ports

**Backend** (default: 3000):
```bash
PORT=3001 npm run dev
```

**Frontend** (default: 5173):
Edit `frontend/vite.config.js` and change the port.

### Install Dependencies Manually

```bash
cd backend && npm install
cd ../frontend && npm install
```

---

## Tips

- 💡 Keep the terminal windows open while using the tracker
- 💡 Extension works best with both services running
- 💡 Check the README.md for more detailed instructions
- 💡 See TESTING.md for how to verify everything works

---

**Ready to track Claude usage? Just run `./start.sh` or `start.bat`!** 🎉
