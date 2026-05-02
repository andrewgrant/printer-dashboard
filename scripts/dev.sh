#!/usr/bin/env bash
# Run the server (with tsx watch) and the Vite dev server concurrently.
# Server listens on $PORT (default 3000); Vite serves :5173 and proxies /api there.
set -euo pipefail

cd "$(dirname "$0")/.."

export PORT="${PORT:-3000}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

mkdir -p ./data

cleanup() {
  echo
  echo "stopping dev processes…"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

npm --workspace apps/server run dev &
SERVER_PID=$!

# Wait a moment for the server to bind before starting Vite.
sleep 1

npm --workspace apps/web run dev &
WEB_PID=$!

echo
echo "  backend:  http://localhost:${PORT}"
echo "  frontend: http://localhost:5173  (proxies /api → :${PORT})"
echo
echo "  Ctrl-C to stop"

wait $SERVER_PID $WEB_PID
