#!/usr/bin/env bash
# End-to-end smoke test — runs unit + live tests, then curls the API.
# Assumes the service (or dev server) is running on :3000.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"

echo "[1/4] unit tests"
npm --workspace apps/server run test

echo
echo "[2/4] live tests (requires printers on LAN)"
PRINTER_DASHBOARD_LIVE=1 npm --workspace apps/server run test:live

echo
echo "[3/4] probe real printers via CLI"
npm run probe

echo
echo "[4/4] HTTP smoke test against ${BASE}"
set +e

check() {
  local name="$1"
  local code="$2"
  local expected="$3"
  if [[ "$code" == "$expected" ]]; then
    printf "  ok   %-40s %s\n" "$name" "$code"
  else
    printf "  FAIL %-40s got=%s want=%s\n" "$name" "$code" "$expected"
    EXIT=1
  fi
}
EXIT=0

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")
check "GET /api/health" "$code" "200"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/printers")
check "GET /api/printers" "$code" "200"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/discover")
check "POST /api/discover" "$code" "200"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"ip":"not-an-ip"}' "$BASE/api/printers")
check "POST /api/printers (bad ip)" "$code" "400"

echo
echo "listing current printers:"
curl -s "$BASE/api/printers" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/api/printers"
echo

exit $EXIT
