# Quick Start Guide

Get Claude Usage Tracker running in 5 minutes.

## Prerequisites

- Node.js 16+ ([download](https://nodejs.org))
- Chrome or Firefox browser
- Terminal access

## Three Simple Steps

### Step 1: Start Backend (Terminal 1)

```bash
cd backend
npm install
npm run dev
```

Wait for: `Server running on http://localhost:3000`

### Step 2: Start Frontend (Terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Wait for: `http://localhost:5173`

### Step 3: Install Extension

#### Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension` folder
5. Done! ✅

#### Firefox:
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `extension/manifest.json`
4. Done! ✅

## Start Tracking

1. Visit [claude.ai](https://claude.ai)
2. Have a conversation with Claude
3. Check your stats:
   - **Extension popup**: Click the extension icon
   - **Dashboard**: Open `http://localhost:5173`

That's it! 🎉

## Troubleshooting Quick Tips

| Issue | Solution |
|-------|----------|
| Port 3000 in use | `PORT=3001 npm run dev` |
| Extension not tracking | Reload extension, check backend running |
| Dashboard shows no data | Use Claude first, wait 5 seconds, refresh |
| npm not found | Install Node.js from nodejs.org |

## Next Steps

- 📊 **Monitor Usage**: Check dashboard daily
- ⚙️ **Adjust Pricing**: Go to Settings to update token costs
- 📈 **View Analytics**: Check charts for usage trends

## Full Documentation

- 📖 [Installation Guide](./INSTALLATION.md) - Detailed setup
- 🧪 [Testing Guide](./TESTING.md) - How to test
- 📚 [README](./README.md) - Full docs

---

Happy tracking! Questions? Check the troubleshooting in [INSTALLATION.md](./INSTALLATION.md)
