#!/bin/bash
cd /var/www/wolfinisoftware/claudetracker/backend
export PORT=3001
export NODE_ENV=production
export DATABASE_PATH=./database.sqlite
export LOG_LEVEL=info
: "${SECRETS_KEY:?Set SECRETS_KEY from the protected deployment environment before starting the tracker}"

exec nohup node dist/server.js >> /var/log/claudetracker-backend.log 2>&1 &
