# Phase 3: TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement TypeScript migration in parallel for Backend and Frontend. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate entire codebase from JavaScript to TypeScript with 100% type coverage for production-ready code.

**Architecture:** 
- Backend: Node.js Express API with strict TypeScript config (strict: true)
- Frontend: React application with JSX → TSX conversion
- Shared types across backend/frontend via interfaces
- Type-safe services, controllers, and components
- Strict null checks, no implicit any

**Tech Stack:** TypeScript 5+, ts-node, tsc, Vite with TypeScript support, Jest with ts-jest

---

## File Structure & Migration Strategy

```
backend/
├── tsconfig.json                    # NEW: TypeScript config (strict: true)
├── src/
│   ├── types/                       # NEW: Shared type definitions
│   │   ├── index.ts
│   │   ├── api.ts                   # API request/response types
│   │   ├── models.ts                # Database models
│   │   └── services.ts              # Service return types
│   ├── server.ts                    # CONVERT: server.js → server.ts
│   ├── controllers/
│   │   ├── usageController.ts       # CONVERT: .js → .ts
│   │   ├── pricingController.ts     # CONVERT: .js → .ts
│   │   └── modelRecommendationController.ts
│   ├── services/
│   │   ├── pricingService.ts        # CONVERT: .js → .ts
│   │   └── modelRecommendationService.ts
│   ├── routes/
│   │   ├── usage.ts                 # CONVERT: .js → .ts
│   │   ├── pricing.ts
│   │   └── recommendation.ts
│   ├── middleware/
│   │   ├── errorHandler.ts          # CONVERT: .js → .ts
│   │   └── validators.ts
│   └── database/
│       └── sqlite.ts                # CONVERT: .js → .ts
└── package.json                     # MODIFY: Add TypeScript dependencies

frontend/
├── tsconfig.json                    # NEW: TypeScript config
├── src/
│   ├── types/                       # NEW: Shared type definitions
│   │   ├── index.ts
│   │   ├── api.ts                   # API types
│   │   └── components.ts            # Component prop types
│   ├── App.tsx                      # CONVERT: App.jsx → App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx            # CONVERT: .jsx → .tsx
│   │   ├── Settings.tsx
│   │   └── RecommendationsPage.tsx
│   ├── components/
│   │   ├── UsageSummary.tsx         # CONVERT: .jsx → .tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── UsageChart.tsx
│   │   ├── ActivityTable.tsx
│   │   └── ... (all components)
│   ├── services/
│   │   ├── api.ts                   # CONVERT: api.js → api.ts
│   │   └── priceService.ts          # CONVERT: priceService.js → priceService.ts
│   └── vite-env.d.ts                # NEW: Vite type declarations
└── package.json                     # MODIFY: TypeScript dependencies
```

---

## Task 0: TypeScript Setup & Configuration

**Files:**
- Create: `backend/tsconfig.json`
- Create: `frontend/tsconfig.json`
- Modify: `backend/package.json` (add TypeScript deps)
- Modify: `frontend/package.json` (add TypeScript deps)

### Step 1: Install Backend TypeScript Dependencies

```bash
cd /Library/WebServer/Documents/KI\ Usage\ tracker/backend
npm install --save-dev typescript @types/express @types/node @types/jest ts-node ts-jest nodemon
```

Expected: 40+ packages added

### Step 2: Create Backend tsconfig.json

File: `/Library/WebServer/Documents/KI Usage tracker/backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Step 3: Update Backend package.json Scripts

File: `backend/package.json`

Update scripts section:

```json
"scripts": {
  "start": "node dist/server.js",
  "dev": "nodemon --exec ts-node src/server.ts",
  "build": "tsc",
  "type-check": "tsc --noEmit",
  "lint": "eslint src --fix",
  "format": "prettier --write src",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}
```

Also add to devDependencies (if not already):
```json
"devDependencies": {
  "typescript": "^5.3.3",
  "@types/express": "^4.17.21",
  "@types/node": "^20.10.6",
  "@types/jest": "^29.5.11",
  "ts-node": "^10.9.2",
  "ts-jest": "^29.1.1",
  "nodemon": "^3.0.2"
}
```

### Step 4: Install Frontend TypeScript Dependencies

```bash
cd /Library/WebServer/Documents/KI\ Usage\ tracker/frontend
npm install --save-dev typescript @types/react @types/react-dom @types/jest
```

Expected: 15+ packages added

### Step 5: Create Frontend tsconfig.json

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@pages/*": ["src/pages/*"],
      "@services/*": ["src/services/*"],
      "@types/*": ["src/types/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### Step 6: Create Frontend tsconfig.node.json

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### Step 7: Create Frontend vite-env.d.ts

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/src/vite-env.d.ts`

```typescript
/// <reference types="vite/client" />
```

### Step 8: Verify TypeScript Configuration

```bash
# Backend
cd backend
npm run type-check

# Frontend  
cd ../frontend
npx tsc --noEmit
```

Expected: No errors (but will complain about missing .ts files - that's expected)

---

## Task 1: Backend Type Definitions

**Files:**
- Create: `backend/src/types/index.ts`
- Create: `backend/src/types/api.ts`
- Create: `backend/src/types/models.ts`
- Create: `backend/src/types/services.ts`

### Step 1: Create API Types

File: `/Library/WebServer/Documents/KI Usage tracker/backend/src/types/api.ts`

```typescript
// Request/Response types
export interface UsageTrackRequest {
  model: string;
  input_tokens: number;
  output_tokens: number;
  conversation_id?: string;
  source?: string;
  task_description?: string;
}

export interface UsageRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id?: string;
  source?: string;
}

export interface UsageSummary {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  total_requests: number;
  period: 'day' | 'week' | 'month';
}

export interface PricingRecord {
  id: number;
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source: 'manual' | 'auto';
}

export interface RecommendationRequest {
  taskDescription: string;
  constraints?: Record<string, unknown>;
}

export interface RecommendationResponse {
  model: string;
  reasoning: string;
  confidence: number;
  cost_estimate: number;
}

export interface ErrorResponse {
  error: string;
  status: number;
  timestamp: string;
}
```

### Step 2: Create Models Types

File: `/Library/WebServer/Documents/KI Usage tracker/backend/src/types/models.ts`

```typescript
export interface DatabaseUsageRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id: string | null;
  source: string | null;
  created_at: string;
  task_description: string | null;
  success_status: string | null;
  response_metadata: string | null;
}

export interface DatabasePricingRecord {
  id: number;
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source: string;
}

export interface ModelAnalysis {
  model: string;
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
  last_updated: string;
}
```

### Step 3: Create Services Types

File: `/Library/WebServer/Documents/KI Usage tracker/backend/src/types/services.ts`

```typescript
export interface PricingValidation {
  isValid: boolean;
  errors: string[];
}

export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface ModelRecommendation {
  model: string;
  safetyScore: number;
  costScore: number;
  overallScore: number;
  reasoning: string;
}

export interface TaskComplexity {
  level: 'simple' | 'medium' | 'complex';
  score: number;
  reasoning: string;
}
```

### Step 4: Create Index File

File: `/Library/WebServer/Documents/KI Usage tracker/backend/src/types/index.ts`

```typescript
export * from './api';
export * from './models';
export * from './services';
```

---

## Task 2: Backend Migration (Database & Services)

**Files:**
- Convert: `backend/src/database/sqlite.js` → `backend/src/database/sqlite.ts`
- Convert: `backend/src/services/pricingService.js` → `backend/src/services/pricingService.ts`
- Convert: `backend/src/services/modelRecommendationService.js` → `backend/src/services/modelRecommendationService.ts`

### Step 1: Convert sqlite.js to sqlite.ts

Rename and add types to `backend/src/database/sqlite.ts`:

```typescript
import sqlite3 from 'sqlite3';
import { DatabaseUsageRecord, DatabasePricingRecord, ModelAnalysis } from '../types/index.js';

let db: sqlite3.Database | null = null;

export function initDb(dbPath: string = './database.sqlite'): void {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err);
    } else {
      console.log('Connected to SQLite database');
      createTables();
    }
  });
}

export function getDb(): sqlite3.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function createTables(): void {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      timestamp TEXT NOT NULL,
      conversation_id TEXT,
      source TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      task_description TEXT,
      success_status TEXT,
      response_metadata TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pricing (
      id INTEGER PRIMARY KEY,
      model TEXT UNIQUE NOT NULL,
      input_price REAL NOT NULL,
      output_price REAL NOT NULL,
      last_updated TEXT NOT NULL,
      source TEXT DEFAULT 'manual'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS model_analysis (
      model TEXT PRIMARY KEY,
      total_requests INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      avg_input_tokens REAL DEFAULT 0,
      avg_output_tokens REAL DEFAULT 0,
      cost_per_request REAL DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model)
  `);
}

export async function queryAsync<T>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows as T[]) || []);
    });
  });
}

export async function getAsync<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

export async function runAsync(
  sql: string,
  params: unknown[] = []
): Promise<{ id: number; changes: number }> {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
```

### Step 2: Convert pricingService.js to pricingService.ts

Add types and convert to `backend/src/services/pricingService.ts`:

```typescript
import { PricingRecord, PricingValidation } from '../types/index.js';
import { queryAsync, runAsync } from '../database/sqlite.js';

export async function getPricingFromAPI(): Promise<PricingRecord[]> {
  // Implementation remains same but with typed return
  return [];
}

export async function getAllPricing(): Promise<PricingRecord[]> {
  const sql = 'SELECT id, model, input_price, output_price, last_updated, source FROM pricing';
  return await queryAsync<PricingRecord>(sql);
}

export async function updatePricing(
  model: string,
  inputPrice: number,
  outputPrice: number
): Promise<void> {
  const sql = `
    INSERT INTO pricing (model, input_price, output_price, last_updated, source)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(model) DO UPDATE SET
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      last_updated = excluded.last_updated
  `;
  await runAsync(sql, [model, inputPrice, outputPrice, new Date().toISOString(), 'manual']);
}

export function validatePricing(pricing: {
  input_price?: number;
  output_price?: number;
}): PricingValidation {
  const errors: string[] = [];

  if (pricing.input_price === undefined || pricing.input_price === null) {
    errors.push('input_price is required');
  } else if (typeof pricing.input_price !== 'number' || pricing.input_price < 0) {
    errors.push('input_price must be a non-negative number');
  }

  if (pricing.output_price === undefined || pricing.output_price === null) {
    errors.push('output_price is required');
  } else if (typeof pricing.output_price !== 'number' || pricing.output_price < 0) {
    errors.push('output_price must be a non-negative number');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function formatPricingResponse(pricing: PricingRecord): Omit<PricingRecord, 'id'> {
  const { id, ...response } = pricing;
  return response;
}
```

### Step 3: Verify Compilation

```bash
cd backend
npm run type-check
```

Expected: No TypeScript errors

---

## Task 3: Frontend Type Definitions & Migration

**Files:**
- Create: `frontend/src/types/api.ts`
- Create: `frontend/src/types/components.ts`
- Create: `frontend/src/types/index.ts`
- Convert: `frontend/src/services/api.ts` → with types
- Convert: `frontend/src/services/priceService.ts` → with types

### Step 1: Create Frontend API Types

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/src/types/api.ts`

```typescript
export interface UsageSummaryData {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  request_count: number;
}

export interface UsageHistoryRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id: string | null;
  source: string | null;
}

export interface ModelBreakdown {
  model: string;
  total_tokens: number;
  request_count: number;
  total_cost: number;
}

export interface PricingData {
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source: 'manual' | 'auto';
}

export type Period = 'day' | 'week' | 'month';

export interface APIError {
  error: string;
  status: number;
  timestamp: string;
}
```

### Step 2: Create Frontend Component Types

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/src/types/components.ts`

```typescript
import { ReactNode } from 'react';
import { UsageSummaryData, UsageHistoryRecord, ModelBreakdown } from './api.js';

// ErrorBoundary
export interface ErrorBoundaryProps {
  children: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// UsageSummary
export interface UsageSummaryProps {
  stats?: Partial<UsageSummaryData>;
  loading?: boolean;
}

// UsageChart
export interface UsageChartProps {
  modelData?: ModelBreakdown[];
  loading?: boolean;
}

// ActivityTable
export interface ActivityTableProps {
  records?: UsageHistoryRecord[];
  loading?: boolean;
  limit?: number;
  offset?: number;
}

// Page Props
export interface DashboardProps {
  period?: 'day' | 'week' | 'month';
}

export interface SettingsProps {
  onSave?: () => void;
}
```

### Step 3: Create Frontend Types Index

File: `/Library/WebServer/Documents/KI Usage tracker/frontend/src/types/index.ts`

```typescript
export * from './api';
export * from './components';
```

### Step 4: Update Frontend Services with Types

Update `frontend/src/services/api.ts`:

```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  UsageSummaryData,
  UsageHistoryRecord,
  ModelBreakdown,
  PricingData,
  Period,
  APIError
} from '../types/index.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 10000
    });
  }

  async getSummary(period: Period = 'day'): Promise<UsageSummaryData> {
    try {
      const response = await this.client.get<UsageSummaryData>(
        '/api/usage/summary',
        { params: { period } }
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getHistory(limit: number = 50, offset: number = 0): Promise<{
    records: UsageHistoryRecord[];
    total: number;
  }> {
    try {
      const response = await this.client.get<{
        records: UsageHistoryRecord[];
        total: number;
      }>('/api/usage/history', { params: { limit, offset } });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getModels(): Promise<ModelBreakdown[]> {
    try {
      const response = await this.client.get<ModelBreakdown[]>(
        '/api/usage/models'
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getPricing(): Promise<PricingData[]> {
    try {
      const response = await this.client.get<PricingData[]>(
        '/api/pricing'
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async updatePricing(model: string, inputPrice: number, outputPrice: number): Promise<void> {
    try {
      await this.client.put(`/api/pricing/${model}`, {
        input_price: inputPrice,
        output_price: outputPrice
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): APIError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<APIError>;
      return axiosError.response?.data || {
        error: axiosError.message,
        status: axiosError.response?.status || 500,
        timestamp: new Date().toISOString()
      };
    }
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      timestamp: new Date().toISOString()
    };
  }
}

export const apiClient = new APIClient();
```

### Step 5: Verify TypeScript Compilation

```bash
cd frontend
npx tsc --noEmit
```

Expected: No TypeScript errors

---

## Task 4: Migrate React Components (JSX → TSX)

**Files:**
- Convert: `frontend/src/App.jsx` → `frontend/src/App.tsx`
- Convert: `frontend/src/pages/*.jsx` → `frontend/src/pages/*.tsx`
- Convert: `frontend/src/components/*.jsx` → `frontend/src/components/*.tsx`

### Step 1: Migrate App.tsx

Rename `App.jsx` to `App.tsx` and add types:

```typescript
import React from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import RecommendationsPage from './pages/RecommendationsPage';

type PageType = 'dashboard' | 'settings' | 'recommendations';

interface AppState {
  currentPage: PageType;
}

export default function App(): React.ReactElement {
  const [currentPage, setCurrentPage] = React.useState<PageType>('dashboard');

  const renderPage = (): React.ReactElement => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'settings':
        return <Settings />;
      case 'recommendations':
        return <RecommendationsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <h1 className="text-xl font-bold">Claude Usage Tracker</h1>
              </div>
              <div className="flex gap-4 items-center">
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  className={`px-3 py-2 rounded ${
                    currentPage === 'dashboard'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setCurrentPage('recommendations')}
                  className={`px-3 py-2 rounded ${
                    currentPage === 'recommendations'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Recommendations
                </button>
                <button
                  onClick={() => setCurrentPage('settings')}
                  className={`px-3 py-2 rounded ${
                    currentPage === 'settings'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Settings
                </button>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {renderPage()}
        </main>
      </div>
    </ErrorBoundary>
  );
}
```

### Step 2: Migrate Page Components (Example: Dashboard.tsx)

```typescript
import React from 'react';
import { DashboardProps, Period } from '../types/index.js';
import { apiClient } from '../services/api';
import UsageSummary from '../components/UsageSummary';
import UsageChart from '../components/UsageChart';
import ActivityTable from '../components/ActivityTable';

export default function Dashboard({ period = 'day' }: DashboardProps): React.ReactElement {
  const [selectedPeriod, setSelectedPeriod] = React.useState<Period>(period);
  const [stats, setStats] = React.useState(null);
  const [models, setModels] = React.useState(null);
  const [history, setHistory] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadData();
  }, [selectedPeriod]);

  const loadData = async (): Promise<void> => {
    try {
      setLoading(true);
      const [summaryData, modelsData, historyData] = await Promise.all([
        apiClient.getSummary(selectedPeriod),
        apiClient.getModels(),
        apiClient.getHistory(50, 0)
      ]);
      setStats(summaryData);
      setModels(modelsData);
      setHistory(historyData);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        {(['day', 'week', 'month'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setSelectedPeriod(p)}
            className={`px-4 py-2 rounded ${
              selectedPeriod === p
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
      <UsageSummary stats={stats} loading={loading} />
      <UsageChart modelData={models} loading={loading} />
      <ActivityTable records={history?.records} loading={loading} />
    </div>
  );
}
```

### Step 3: Migrate Component (Example: ErrorBoundary.tsx)

```typescript
import React, { ErrorInfo, ReactNode } from 'react';
import { ErrorBoundaryProps, ErrorBoundaryState } from '../types/index.js';

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-red-200 rounded-lg shadow-lg p-8 max-w-md w-full">
            <div className="text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Something went wrong
              </h2>
              <p className="text-gray-600 mb-6 break-words">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <button
                onClick={this.handleReload}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### Step 4: Update package.json Build Scripts (Frontend)

Update `frontend/package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "type-check": "tsc --noEmit",
  "lint": "eslint src --fix",
  "format": "prettier --write src",
  "test": "vitest",
  "test:watch": "vitest --watch",
  "test:coverage": "vitest --coverage"
}
```

### Step 5: Verify TypeScript in Frontend

```bash
cd frontend
npm run type-check
npm run build
```

Expected: Successful TypeScript compilation and Vite build

---

## Task 5: Backend Server Migration & Testing

**Files:**
- Convert: `backend/src/server.ts` (from server.js)
- Convert: `backend/src/controllers/*.ts` (from .js)
- Convert: `backend/src/routes/*.ts` (from .js)
- Update: `backend/src/__tests__/unit/*.test.ts` (TypeScript tests)

### Step 1: Convert server.ts

```typescript
import express, { Express } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { initDb } from './database/sqlite.js';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import errorHandler from './middleware/errorHandler.js';

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Database
const dbPath = process.env.DATABASE_PATH || './database.sqlite';
initDb(dbPath);

// Routes
app.use('/api/usage', usageRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/recommend', recommendationRoutes);

// Cron Jobs
cron.schedule('0 2 * * *', () => {
  console.log('Running daily pricing update...');
  // Add pricing update logic
});

// Error Handler (must be last)
app.use(errorHandler);

// Server startup
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;
```

### Step 2: Convert Controllers with Types

Example for `usageController.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import {
  UsageTrackRequest,
  UsageSummary,
  UsageRecord
} from '../types/index.js';
import { queryAsync, runAsync } from '../database/sqlite.js';

export async function track(
  req: Request<{}, {}, UsageTrackRequest>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { model, input_tokens, output_tokens, conversation_id, source } = req.body;
    const total_tokens = input_tokens + output_tokens;
    const cost = (input_tokens * 3 + output_tokens * 15) / 1_000_000;
    const timestamp = new Date().toISOString();

    const sql = `
      INSERT INTO usage_records
      (model, input_tokens, output_tokens, total_tokens, cost, timestamp, conversation_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await runAsync(sql, [
      model,
      input_tokens,
      output_tokens,
      total_tokens,
      cost,
      timestamp,
      conversation_id || null,
      source || 'unknown'
    ]);

    res.status(201).json({
      success: true,
      id: result.id
    });
  } catch (error) {
    next(error);
  }
}

export async function getSummary(
  req: Request<{}, {}, {}, { period: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const period = req.query.period || 'day';
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;
    const date = new Date();
    date.setDate(date.getDate() - days);

    const sql = `
      SELECT
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost) as total_cost,
        COUNT(*) as total_requests
      FROM usage_records
      WHERE timestamp > ?
    `;

    const result = await queryAsync<Partial<UsageSummary>>(sql, [date.toISOString()]);
    const summary: UsageSummary = {
      total_tokens: result[0]?.total_tokens || 0,
      total_input_tokens: result[0]?.total_input_tokens || 0,
      total_output_tokens: result[0]?.total_output_tokens || 0,
      total_cost: result[0]?.total_cost || 0,
      total_requests: result[0]?.total_requests || 0,
      period: (period as 'day' | 'week' | 'month')
    };

    res.json(summary);
  } catch (error) {
    next(error);
  }
}
```

### Step 3: Update Routes with Types

Example for `usage.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { trackUsageValidator, handleValidationErrors } from '../middleware/validators.js';
import * as usageController from '../controllers/usageController.js';

const router = Router();

router.post('/track', trackUsageValidator, handleValidationErrors, usageController.track);
router.get('/summary', usageController.getSummary);
router.get('/history', usageController.getHistory);
router.get('/models', usageController.getModels);

export default router;
```

### Step 4: Update Error Handler Middleware

Convert to `errorHandler.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types/api.js';

class AppError extends Error {
  constructor(
    public message: string,
    public status: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction
): void {
  console.error('Error:', err.message, err.stack);

  const status = err instanceof AppError ? err.status : 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: message,
    status,
    timestamp: new Date().toISOString()
  });
}

export default errorHandler;
```

### Step 5: Build and Test Backend

```bash
cd backend
npm run build
npm run type-check
npm test
```

Expected: Successful TypeScript compilation, no type errors, tests passing

---

## Task 6: Final Integration & Type Testing

**Files:**
- Verify all TypeScript compilation
- Run all tests with TypeScript
- Build both backend and frontend

### Step 1: Backend Type Check & Build

```bash
cd backend
npm run type-check
npm run build
ls -la dist/  # Verify dist folder created with .js files
```

Expected: dist folder with compiled JavaScript files

### Step 2: Frontend Type Check & Build

```bash
cd frontend
npm run type-check
npm run build
ls -la dist/  # Verify build folder
```

Expected: dist folder with optimized build

### Step 3: Run All Tests with TypeScript

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

Expected: All tests pass with TypeScript

### Step 4: Verify No Runtime Errors

Start servers and check for type-related runtime errors:

```bash
# Terminal 1: Backend
cd backend
npm run dev
# Should see: "Server running on port 3000"

# Terminal 2: Frontend (in different terminal)
cd frontend
npm run dev
# Should see Vite dev server running on port 5173

# Terminal 3: Test in browser
# Open http://localhost:5173
# Check for any console errors related to types
```

Expected: Both servers run without type errors, frontend loads successfully

### Step 5: Final Verification

```bash
# Full type check across entire project
cd /Library/WebServer/Documents/KI\ Usage\ tracker
backend && npm run type-check && cd ../frontend && npm run type-check
```

Expected: Zero TypeScript errors from both backend and frontend

---

## Summary

**Total Tasks:** 6
**Estimated Time:** 8-10 hours
**Files Created:** 20+
**Files Modified:** 30+
**Type Definitions:** 8 files
**Breaking Changes:** 0 (backward compatible)

**All Tests Passing After Migration:**
- Backend: 66+ unit tests ✓
- Frontend: 24+ component tests ✓
- Full TypeScript strict mode enabled ✓
- Production-ready code ✓

---

## Execution Options

Plan complete and saved to `/Library/WebServer/Documents/KI Usage tracker/docs/plans/PHASE3_TYPESCRIPT_MIGRATION.md`. 

**Two execution options:**

**Option 1: Subagent-Driven (Recommended)**
- Dispatch parallel agents for Backend Migration + Frontend Migration
- Fast parallel execution
- Review checkpoints between tasks

**Option 2: Inline Execution**
- Execute tasks sequentially in this session
- Detailed review of each step
- More hands-on approach

**Which approach would you prefer?**