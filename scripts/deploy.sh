#!/usr/bin/env bash
# Build the Docker image and (re)start the service via docker compose.
# Designed to be copy-pasted onto any LAN machine with docker installed.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' plugin is not available" >&2
  exit 1
fi

echo "==> building image"
docker compose build

echo
echo "==> starting service (host networking, named volume)"
docker compose up -d

echo
echo "==> waiting for healthcheck"
TIMEOUT=60
while (( TIMEOUT > 0 )); do
  status=$(docker inspect --format '{{.State.Health.Status}}' printer-dashboard 2>/dev/null || echo "starting")
  if [[ "$status" == "healthy" ]]; then
    echo "==> healthy"
    break
  fi
  sleep 2
  TIMEOUT=$((TIMEOUT - 2))
done

if [[ "$status" != "healthy" ]]; then
  echo "warning: container did not report healthy within 60s (status=$status)" >&2
  echo "recent logs:" >&2
  docker compose logs --tail=30 printer-dashboard >&2 || true
fi

PORT="$(docker compose exec -T printer-dashboard printenv PORT 2>/dev/null || echo 3000)"
echo
echo "dashboard:  http://$(hostname):${PORT}"
echo "API:        http://$(hostname):${PORT}/api/printers"
echo
echo "logs:       docker compose logs -f printer-dashboard"
echo "stop:       docker compose down"
