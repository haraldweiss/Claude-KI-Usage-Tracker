# Claude Usage Tracker

A comprehensive web application to monitor and analyze Claude AI token usage, costs, and provide intelligent model recommendations for optimal API usage.

**Status**: ✅ Production Ready (Phase 3 Complete - Full TypeScript Migration)

---

## 🎯 Features

### Core Functionality
- **Real-time Usage Tracking**: Browser extension intercepts Claude.ai API calls and logs token usage automatically
- **Cost Analysis**: Automatic cost calculation with configurable pricing per model
- **Smart Model Recommendations**: AI-powered engine that recommends optimal Claude models based on task complexity
- **Optimization Insights**: Identifies opportunities to reduce costs and improve efficiency
- **Beautiful Dashboard**: React-based UI with charts, tables, and real-time statistics

### Smart Recommendation Engine
- **Task Complexity Analysis**: Evaluates task descriptions to determine required model capability
- **Safety Score Calculation**: Analyzes historical success rates for each model
- **Cost-Benefit Optimization**: Balances safety requirements with cost efficiency
- **Opportunity Detection**: Identifies where you used expensive models when cheaper ones would suffice
- **Model Analytics**: Daily aggregation of usage patterns, success rates, and cost-per-request metrics

### Architecture
- **Backend**: Node.js + Express.js + TypeScript
- **Frontend**: React + TypeScript + Vite
- **Database**: SQLite with typed queries
- **Extension**: Chrome extension for automatic API interception
- **Type Safety**: 100% TypeScript with strict mode enabled

---

## 📋 Prerequisites

- **Node.js**: 16+ (with npm or yarn)
- **Chrome/Chromium**: For the browser extension
- **SQLite**: Included in Node.js ecosystem (no external setup needed)

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

### 2. Install Dependencies

**Backend:**
```bash
cd backend
npm install
npm run type-check  # Verify TypeScript compilation
```

**Frontend:**
```bash
cd ../frontend
npm install
npm run type-check  # Verify TypeScript compilation
```

### 3. Run the Application

**Terminal 1 - Backend (Port 3000):**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend (Port 5173):**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Install Extension (Chrome):**
1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `/extension` directory
5. Extension should show as active

### 4. Start Using

1. Visit `http://localhost:5173` in your browser
2. Use Claude.ai normally in another tab
3. API calls are automatically logged and appear in the dashboard
4. View usage statistics, costs, and recommendations in real-time

---

## 📚 Documentation

### Core Guides
- **[Installation Guide](./INSTALLATION.md)** - Detailed setup instructions for each component
- **[Quick Start](./QUICKSTART.md)** - Get up and running in 5 minutes
- **[User Guide](./USER_GUIDE.md)** - Complete feature documentation and how-tos
- **[Architecture Guide](./ARCHITECTURE.md)** - System design and component overview

### Technical Reference
- **[API Documentation](./docs/API.md)** - TypeScript endpoint signatures and payloads
- **[TypeScript Migration](./PHASE3_STATUS.md)** - Phase 3 completion details
- **[Testing Summary](./TESTING.md)** - Test coverage and testing strategies
- **[Environment Setup](./ENV_SETUP.md)** - Configuration and environment variables

### Project Status
- **[Phase 3 Status](./PHASE3_STATUS.md)** - Complete migration to TypeScript (all 7 tasks ✅)
- **[Project Summary](./PROJECT_SUMMARY.txt)** - High-level overview
- **[Security Notes](./SECURITY.md)** - Security considerations and best practices

---

## 🏗️ Project Structure

```
Claude-KI-Usage-Tracker/
├── backend/
│   ├── src/
│   │   ├── server.ts           # Express app with middleware & cron jobs
│   │   ├── controllers/        # Request handlers (usage, pricing, recommendations)
│   │   ├── routes/             # API route definitions with validators
│   │   ├── services/           # Business logic (pricing, model recommendations)
│   │   ├── middleware/         # Error handling, validation middleware
│   │   ├── database/           # SQLite setup and typed query functions
│   │   ├── types/              # TypeScript type definitions (70+ interfaces)
│   │   └── utils/              # Helper functions
│   ├── dist/                   # Compiled JavaScript (created by `npm run build`)
│   ├── tsconfig.json           # TypeScript config (strict: true)
│   └── jest.config.js          # Test configuration
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main application component
│   │   ├── pages/              # Page components (Dashboard, Settings, Recommendations)
│   │   ├── components/         # Reusable UI components
│   │   ├── services/           # API client and utility functions
│   │   ├── types/              # TypeScript interfaces for components & API
│   │   └── index.tsx           # Entry point
│   ├── dist/                   # Built assets (created by `npm run build`)
│   ├── vite.config.ts          # Vite configuration
│   ├── tsconfig.json           # TypeScript config with path aliases
│   └── vitest.config.js        # Vitest configuration
│
├── extension/
│   ├── manifest.json           # Chrome extension config (MV3)
│   ├── background.js           # Service worker (API call interception)
│   ├── content.js              # Content script (fetch interception)
│   ├── popup.html/js           # Popup UI with real-time stats
│   └── icons/                  # Extension icons
│
├── docs/
│   ├── plans/                  # Implementation plans
│   └── API.md                  # API endpoint documentation
│
└── database.sqlite             # SQLite database (auto-created on first run)
```

---

## 🔌 API Endpoints

### Usage Tracking
- `POST /api/usage/track` - Log a token usage event
- `GET /api/usage/summary?period=day|week|month` - Get aggregated usage statistics
- `GET /api/usage/models` - Get breakdown by model
- `GET /api/usage/history?limit=50&offset=0` - Get recent usage records

### Pricing Management
- `GET /api/pricing` - Get all model pricing
- `PUT /api/pricing/:model` - Update pricing for a model
- `POST /api/pricing/check-update` - Check for pricing updates (Anthropic API)

### Model Recommendations
- `POST /api/recommend` - Get model recommendation for a task description
- `GET /api/recommend/analysis/models?period=day|week|month` - Model statistics & success rates
- `GET /api/recommend/analysis/opportunities?period=day|week|month` - Cost optimization opportunities

See [API Documentation](./docs/API.md) for complete request/response schemas with TypeScript types.

---

## 🧪 Testing

The project includes comprehensive test coverage:

**Backend Tests** (Jest):
```bash
cd backend
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Generate coverage report
```

**Frontend Tests** (Vitest):
```bash
cd frontend
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Generate coverage report
```

**Current Status**: 45/45 tests passing (21 backend + 24 frontend) ✅

---

## 🔧 Development

### Build for Production

**Backend:**
```bash
cd backend
npm run build              # Creates dist/ folder with compiled TypeScript
npm run type-check        # Verify type safety
```

**Frontend:**
```bash
cd frontend
npm run build             # Creates optimized bundle in dist/
npm run type-check        # Verify type safety
```

### Code Quality

Both backend and frontend use ESLint and Prettier:
```bash
# Backend
cd backend
npm run lint              # Check for linting issues
npm run lint:fix          # Auto-fix issues
npm run format            # Run Prettier

# Frontend
cd frontend
npm run lint
npm run lint:fix
npm run format
```

---

## 🌍 Configuration

### Environment Variables

Create `.env` files in both `backend/` and `frontend/` directories:

**Backend (.env)**:
```env
PORT=3000
DATABASE_PATH=./database.sqlite
NODE_ENV=development
ANTHROPIC_API_KEY=your_key_here  # For pricing updates
```

**Frontend (.env)**:
```env
VITE_API_URL=http://localhost:3000
```

See `.env.example` files in each directory for all available options.

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 3000 already in use | `PORT=3001 npm run dev` in backend |
| Extension not tracking data | Reload extension (chrome://extensions), ensure backend is running |
| "No data" in dashboard | Use Claude.ai first, wait 5s, refresh dashboard |
| TypeScript errors | Run `npm run type-check` to see all issues, then `npm run lint:fix` to auto-fix |
| Tests failing | Delete node_modules, run `npm install`, then `npm test` |
| Database locked | Close all connections and restart backend |

---

## 📊 Key Statistics

- **TypeScript Coverage**: 100% (65+ .ts/.tsx files, 3,000+ lines)
- **Type Definitions**: 70+ interfaces/types across API, models, and services
- **Test Coverage**: 45/45 tests passing (21 backend Jest, 24 frontend Vitest)
- **Components**: 14 fully typed React components
- **API Endpoints**: 10+ endpoints with full TypeScript signatures

---

## 🔐 Security

- **No sensitive data** is sent to external services beyond Anthropic
- **Pricing API calls** are made server-side only (backend)
- **Database** is local SQLite (not cloud-based)
- **Extension** communicates only with localhost backend
- **Type safety** prevents many common vulnerabilities

See [Security Notes](./SECURITY.md) for detailed security considerations.

---

## 🚀 Performance

- **Real-time Updates**: Dashboard refreshes every 10 seconds
- **Optimized Queries**: Indexed database queries for fast lookups
- **Frontend Bundle**: ~150 KB gzipped (Vite optimized)
- **Backend**: Sub-millisecond query responses

---

## 🤝 Contributing

This is a personal project, but feel free to fork and customize:

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and test: `npm test`
3. Commit with TypeScript validation: `npm run type-check && git commit -m "feat: description"`
4. Push: `git push origin feature/your-feature`

---

## 📝 License

MIT License - See [LICENSE](./LICENSE) for details.

---

## 🎓 Learning Resources

This project demonstrates:
- **TypeScript** with strict mode and generics
- **React** functional components with hooks and error boundaries
- **Express.js** with middleware and routing
- **Jest & Vitest** for unit testing
- **Vite** for fast builds
- **Chrome extension** development with MV3
- **SQLite** with type-safe queries
- **Clean Architecture** with separation of concerns

---

## 📬 Support

For issues or questions:
1. Check the [troubleshooting section](#-troubleshooting) above
2. Review relevant documentation in `/docs` or `/backend/docs`
3. Check GitHub issues if open to public

---

**Last Updated**: April 2026 (Phase 3 Complete)  
**Maintained by**: Harald Weiss  
**Repository**: [GitHub](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)
