#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

# Clean up stale PID file
rm -f "$PID_FILE"

echo "Starting backend (port 8998)..."
cd "$ROOT_DIR"
WORK_SCHEDULE_CORS_ORIGINS=http://localhost:5173 node server.js &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"

echo "Starting frontend (port 5173)..."
cd "$ROOT_DIR/frontend"
npx vite --port 5173 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PID_FILE"

echo ""
echo "========================================"
echo "  Backend:  http://localhost:8998"
echo "  Frontend: http://localhost:5173"
echo "  PID file: $PID_FILE"
echo "========================================"
echo ""
echo "Run ./stop.sh to stop all services."

wait
