# Environment Configuration Setup

This project uses environment variables for configuration. Follow the steps below to set up your environment.

## Quick Start

### 1. Root Directory (.env)
```bash
cp .env.example .env
```

Edit `.env` and adjust values as needed:
- `BACKEND_PORT`: Backend server port (default: 3000)
- `FRONTEND_PORT`: Frontend dev server port (default: 5173)
- `VITE_API_URL`: Frontend API URL for axios/fetch calls (default: http://localhost:3000)
- `DATABASE_PATH`: Path to SQLite database (default: ./backend/database.sqlite)
- `NODE_ENV`: Environment mode (development/production)
- `ANTHROPIC_API_KEY`: API key for pricing service (if using auto-update)
- `PRICING_UPDATE_CRON`: Cron schedule for pricing updates (default: 0 2 * * * = 2 AM daily)
- `LOG_LEVEL`: Logging level (debug/info/warn/error)

### 2. Backend (.env in /backend)
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with backend-specific settings.

### 3. Frontend (.env in /frontend)
```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env` with frontend-specific settings.

## Configuration Hierarchy

The application follows this configuration priority:
1. Environment variables from `.env` files
2. Default values hardcoded in the application code

## Important Notes

- **Never commit `.env` files** - they may contain sensitive data
- **Commit `.env.example` files** - they document required variables
- `.env.local` files are also ignored (useful for local overrides)
- All environment files should be in the respective directory root

## Per-Directory Environment Variables

### Backend (/backend/.env)
```
PORT=3000
NODE_ENV=development
DATABASE_PATH=./database.sqlite
LOG_LEVEL=debug
ANTHROPIC_API_KEY=your-key-here
PRICING_UPDATE_CRON=0 2 * * *
```

### Frontend (/frontend/.env)
```
VITE_API_URL=http://localhost:3000
VITE_ENVIRONMENT=development
```

## Running with Custom Configuration

### Backend with custom port
```bash
cd backend
PORT=3001 npm run dev
```

### Frontend with custom port and API URL
```bash
cd frontend
FRONTEND_PORT=5174 VITE_API_URL=http://localhost:3001 npm run dev
```

## Vite Environment Variables

Frontend environment variables must be prefixed with `VITE_` to be accessible in the client code:
- `VITE_API_URL` - Available as `import.meta.env.VITE_API_URL` in frontend code
- `VITE_ENVIRONMENT` - Available as `import.meta.env.VITE_ENVIRONMENT`

Non-`VITE_` prefixed variables are server-side only (e.g., `FRONTEND_PORT` is used in vite.config.js but not exposed to the browser).

## Database Path Configuration

The DATABASE_PATH defaults to `./database.sqlite` relative to the backend directory.

To use an absolute path or custom location:
```bash
DATABASE_PATH=/absolute/path/to/my/database.sqlite npm run dev
```

## Troubleshooting

### Port already in use
Set a different port:
```bash
BACKEND_PORT=3001 npm run dev  # in backend dir
FRONTEND_PORT=5174 npm run dev # in frontend dir
```

### API calls failing
Check that `VITE_API_URL` in frontend matches the backend `BACKEND_PORT`.

### Database file not found
Ensure `DATABASE_PATH` points to a valid location and has write permissions.
