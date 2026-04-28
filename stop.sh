#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found at $PID_FILE"
  echo "Trying to find processes by port..."

  BACKEND_PID=$(lsof -ti tcp:8998 2>/dev/null || true)
  FRONTEND_PID=$(lsof -ti tcp:5173 2>/dev/null || true)

  if [ -n "$BACKEND_PID" ]; then
    echo "Killing backend (PID $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
  else
    echo "No backend process found on port 8998."
  fi

  if [ -n "$FRONTEND_PID" ]; then
    echo "Killing frontend (PID $FRONTEND_PID)..."
    kill "$FRONTEND_PID" 2>/dev/null || true
  else
    echo "No frontend process found on port 5173."
  fi

  exit 0
fi

pids=()
while IFS= read -r pid; do
  pids+=("$pid")
done < "$PID_FILE"

# Kill in reverse order (frontend first, then backend)
for i in $(seq $((${#pids[@]} - 1)) -1 0); do
  pid="${pids[$i]}"
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping process (PID $pid)..."
    kill "$pid" 2>/dev/null || true
  fi
done

rm -f "$PID_FILE"
echo "All services stopped."
