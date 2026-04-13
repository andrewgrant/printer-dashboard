# printer-dashboard

A self-hostable web service that monitors network printers on your LAN and
reports their status, ink/toner levels, and page counts via both a dashboard
and a REST API.

- Auto-discovers printers via mDNS (no configuration needed on the LAN)
- Also accepts manually-entered IP addresses
- Three-adapter probe chain so heterogeneous printers all work:
  - **SNMP** — standard Printer MIB (RFC 3805)
  - **HP LEDM** — HP's XML endpoints (`/DevMgmt/*.xml`); catches consumer
    inkjets like the ENVY line where SNMP lies about levels
  - **IPP** — covers printers that speak nothing else (e.g. Canon SELPHY)
- Persists to SQLite on a Docker volume; history survives restarts
- Detects cartridge replacements to compute "pages since ink change"

## Stack

- **Backend**: Fastify + TypeScript (long-lived process with a background poller)
- **Frontend**: Vite + React + TypeScript
- **Persistence**: better-sqlite3
- **Deploy**: Docker + docker-compose (host networking)

## Quick start — local development

```bash
npm install
./scripts/dev.sh
```

Open `http://localhost:5173` (Vite dev server; proxies `/api` to the Fastify
backend on `:3101`). Printers on your LAN should auto-appear within the
discovery window (~10s after clicking "Scan mDNS").

## Quick start — Docker

```bash
./scripts/deploy.sh
```

The service runs with `network_mode: host` — **this is required** so that
mDNS multicast and SNMP broadcast can reach the LAN. On a Mac, Docker Desktop's
`host` mode has caveats; for a real deployment run this on a Linux machine on
the same LAN as your printers.

Dashboard: `http://<host>:3101`

## Testing

```bash
# unit tests only (no network, runs in CI)
npm test

# everything + real printer hits + HTTP smoke test
./scripts/test-local.sh
```

The live tests are gated by `PRINTER_DASHBOARD_LIVE=1` and target three specific
printers (`192.168.0.137`, `192.168.0.159`, `192.168.0.186`). Update those IPs
in `apps/server/src/adapters/*.live.test.ts` if you're adapting this to a
different network.

## Diagnostic scripts

- `npm run probe` — standalone SNMP + mDNS probe (no server required)
- `npm run probe -- 192.168.0.137` — probe a specific IP
- `npm run ipp-probe 192.168.0.186` — IPP Get-Printer-Attributes dump
- `npm run walk -- 192.168.0.159 1.3.6.1.2.1.43.11` — SNMP subtree walker

## Configuration

All runtime knobs are env vars, validated at startup (see `apps/server/src/config.ts`):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3101` | HTTP listen port |
| `POLL_INTERVAL_SEC` | `60` | How often to query known printers |
| `DISCOVERY_INTERVAL_SEC` | `300` | How often to run mDNS discovery |
| `SNMP_COMMUNITY` | `public` | Default SNMPv2c community string |
| `SNMP_TIMEOUT_MS` | `3000` | Per-query timeout |
| `HTTP_TIMEOUT_MS` | `5000` | LEDM/IPP HTTP timeout |
| `DATA_DIR` | `/data` | Where `printer-dashboard.db` lives |
| `LOG_LEVEL` | `info` | pino/Fastify log level |

**Persistence model**: stateful data lives in SQLite (`$DATA_DIR/printer-dashboard.db`)
on a Docker named volume (`printer-dashboard-data`); runtime knobs come from env vars;
no host config files. This is the standard pattern for single-node Docker
services. To inspect the DB from the host, swap the named volume for a bind
mount in `docker-compose.yml` (e.g. `- ./data:/data`).

## REST API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/printers` | List printers with latest snapshot merged in |
| `GET` | `/api/printers/:id` | Single printer |
| `GET` | `/api/printers/:id/snapshots?limit=N` | Snapshot history |
| `POST` | `/api/printers` | Manually add `{ ip, name?, community? }` |
| `POST` | `/api/printers/:id/poll` | Force a poll |
| `DELETE` | `/api/printers/:id` | Remove |
| `POST` | `/api/discover` | Trigger an mDNS scan now |

## Adapter precedence

When multiple adapters succeed for the same printer, the orchestrator merges
their snapshots with precedence: **LEDM > SNMP > IPP**. Empty supplies arrays
don't clobber non-empty ones. The HP ENVY 6000 is the motivating case: SNMP
returns `0%` for all its inks (consumer-model firmware quirk), but LEDM returns
the real numbers.

## Layout

```
apps/
  server/   Fastify backend, three adapters, poller, DB, routes
  web/      Vite + React dashboard
scripts/
  probe.ts        SNMP + mDNS diagnostic
  ipp-probe.ts    IPP Get-Printer-Attributes diagnostic
  walk.ts         Generic SNMP subtree walker
  dev.sh          Run backend + frontend concurrently
  test-local.sh   Full test suite + HTTP smoke test
  deploy.sh       docker compose build + up
Dockerfile
docker-compose.yml
```
