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
- Persists all readings and detected cartridge replacements to SQLite indefinitely
- Exports complete history for one or more printers using resumable pagination
- Archiving a printer stops monitoring while preserving its identity and history

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
backend on `:3000`). Printers on your LAN should auto-appear within the
discovery window (~10s after clicking "Scan mDNS").

## Quick start — Docker

```bash
./scripts/deploy.sh
```

The service runs with `network_mode: host` — **this is required** so that
mDNS multicast and SNMP broadcast can reach the LAN. On a Mac, Docker Desktop's
`host` mode has caveats; for a real deployment run this on a Linux machine on
the same LAN as your printers.

Dashboard: `http://<host>:3000`

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

Two env-var overrides are validated at startup (see `apps/server/src/config.ts`):

| Var | Default | Purpose |
|---|---|---|
| `SNMP_COMMUNITY` | `public` | Default SNMPv2c community string |
| `LOG_LEVEL` | `info` | pino/Fastify log level |

The listen port can be overridden with `PORT` (default `3000`). Other settings
(poll/discovery cadences, SNMP/HTTP timeouts, data dir) are constants in code — see `apps/server/src/server.ts` and
`apps/server/src/types.ts`.

The host directory bind-mounted into the container for SQLite/data lives in
`.env` (`PRINTER_DASHBOARD_HOST_DIR`); see `.env.example`.

**Persistence model**: stateful data lives in SQLite (`./data/printer-dashboard.db`,
relative to the server process working directory). Docker Compose bind-mounts
`${PRINTER_DASHBOARD_HOST_DIR}/data` on the host to `/app/data` in the container,
so container restarts, rebuilds, and replacement preserve the database. In local
development the npm workspace runs the server from `apps/server`, so its database
is `apps/server/data/printer-dashboard.db`.

Snapshots and cartridge replacement events have **no expiration or automatic
pruning**. Removing a printer now archives it rather than deleting data. Archived
printers are excluded from polling, the dashboard, and automatic rediscovery, but
remain readable and exportable. Manually adding the same IP restores the existing
ID and history. Existing databases migrate automatically on startup without
discarding records. Previously deleted history cannot be recovered by this migration.
Retention depends on keeping the database files/host directory; disk use grows with history.

## REST API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/printers?includeArchived=true` | List printers with latest snapshot; archived printers excluded by default |
| `GET` | `/api/printers/:id` | Single printer |
| `GET` | `/api/printers/:id/snapshots?limit=N` | Snapshot history |
| `POST` | `/api/printers/export` | Paginated full export for selected printers, including archived printers |
| `POST` | `/api/printers` | Manually add `{ ip, name?, community? }` |
| `POST` | `/api/printers/:id/poll` | Force a poll |
| `DELETE` | `/api/printers/:id` | Archive and stop monitoring; preserve all history |
| `POST` | `/api/discover` | Trigger an mDNS scan now |

## Exporting complete history

Find IDs with `GET /api/printers?includeArchived=true`, then call
`POST /api/printers/export` with JSON:

```json
{"printerIds": ["printer-id-1", "printer-id-2"], "limit": 500}
```

- `printerIds`: required on the first request, 1–100 IDs. Duplicates are collapsed.
  Unknown IDs return `404` with `missingPrinterIds`; no partial export is returned.
- `from` / `to`: optional nonnegative integer Unix timestamps in **milliseconds**.
  `from` is inclusive; `to` is exclusive. When both are supplied, `from < to`.
  Applied to snapshot `takenAt` and cartridge event `changedAt`. Omit both to
  retrieve the entire stored history.
- `limit`: optional integer 1–1000, default 500, **per history array per page**.
  This bounds each response, not the total export size.

Each response contains printer metadata and both history arrays. Example for a
single selected printer:

```json
{
  "printers": [{"id": "printer-id-1", "ip": "192.168.0.137", "name": "Office", "model": "HP ENVY 6000", "source": "manual", "community": "public", "adapters": ["ledm"], "createdAt": 1700000000000, "lastSeenAt": 1700000060000, "archivedAt": null}],
  "snapshots": [{"id": 1, "printerId": "printer-id-1", "takenAt": 1700000060000, "status": "online", "pageCount": 1336, "pageCountColor": null, "pageCountMono": null, "supplies": [{"colorant": "black", "label": "Black", "levelPercent": 80, "state": "ok"}], "statusMessage": null, "sources": ["ledm"]}],
  "supplyEvents": [{"id": 1, "printerId": "printer-id-1", "supplyLabel": "Black", "changedAt": 1700000060000, "pageCountAtChange": 1336}],
  "nextCursor": "opaque-continuation-token"
}
```

`printers` contains all stored printer metadata (including SNMP community and
archive timestamp). `snapshots` contains all stored reading fields. `supplyEvents`
contains all detected cartridge replacement records. Null counters mean the printer
did not supply that value; page counts are cumulative readings, not interval usage.

For subsequent pages, send **only** the returned cursor and optionally a page size:

```json
{"cursor": "opaque-continuation-token", "limit": 500}
```

Append both history arrays from every page until `nextCursor` is `null`. One array
may be empty while the other still has pages. Each array is ordered by ascending
record ID (insertion order), and every record includes its `printerId`. There is no
total-history cap. The cursor carries the selection, filters, and record ID bounds
captured on the first request, so new polls/replacement events cannot shift pages
or extend an in-progress export. Start a fresh export to include newer data. Cursors
survive server restarts against the same database and should be treated as opaque.
Printer metadata is repeated and reflects its current state on each request.
Invalid bodies, filters, limits, or cursors return `400`.

The older `GET /api/printers/:id/snapshots` endpoint remains compatible (newest
50 by default, maximum 500); use the export endpoint for complete history.

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
