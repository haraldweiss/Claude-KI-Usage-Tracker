#!/bin/bash
cd /var/www/wolfinisoftware/claudetracker/backend
export PORT=3001
export NODE_ENV=production
export DATABASE_PATH=./database.sqlite
export LOG_LEVEL=info
export SECRETS_KEY=X66S6ZmC2Sja3FqFerODYNJEE92Tm0RJPtFDlb+MWeo=

exec nohup node dist/server.js >> /var/log/claudetracker-backend.log 2>&1 &
