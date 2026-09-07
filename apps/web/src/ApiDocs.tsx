interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  summary: string;
  params?: Array<{ name: string; where: 'path' | 'query' | 'body'; type: string; notes?: string }>;
  responses?: Array<{ code: number; notes: string }>;
  example?: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/health',
    summary: 'Liveness probe. Returns `{ ok, uptime }`.',
    responses: [{ code: 200, notes: '`{ "ok": true, "uptime": 12.34 }` (uptime in seconds)' }],
  },
  {
    method: 'GET',
    path: '/api/printers',
    summary: 'List all known printers with the latest snapshot merged in.',
    params: [{ name: 'includeArchived', where: 'query', type: 'boolean', notes: 'Default false. Set true to find archived printer IDs for export.' }],
    responses: [
      {
        code: 200,
        notes:
          'Array of `{ id, ip, name, model, source, adapters, lastSeenAt, createdAt, archivedAt, snapshot }`. `snapshot` is `null` if no reading has been recorded.',
      },
    ],
  },
  {
    method: 'GET',
    path: '/api/printers/:id',
    summary: 'Fetch one printer by ID.',
    params: [{ name: 'id', where: 'path', type: 'string', notes: 'UUID assigned at insertion' }],
    responses: [
      { code: 200, notes: 'Printer object with `snapshot` field' },
      { code: 404, notes: '`{ "error": "printer not found" }`' },
    ],
  },
  {
    method: 'GET',
    path: '/api/printers/:id/snapshots',
    summary: 'Recent snapshot history for an active or archived printer, newest first. Use POST /api/printers/export for complete history.',
    params: [
      { name: 'id', where: 'path', type: 'string' },
      {
        name: 'limit',
        where: 'query',
        type: 'number',
        notes: 'Clamped to [1, 500]; defaults to 50',
      },
    ],
    responses: [
      { code: 200, notes: 'Array of snapshot objects' },
      { code: 404, notes: '`{ "error": "printer not found" }`' },
    ],
  },
  {
    method: 'POST',
    path: '/api/printers/export',
    summary: 'Export all stored metadata, readings, and cartridge replacement events for selected active or archived printers. Append snapshots and supplyEvents from each page until nextCursor is null. History is retained indefinitely.',
    params: [
      { name: 'printerIds', where: 'body', type: 'string[]', notes: 'First request: 1–100 IDs from GET /api/printers?includeArchived=true. Duplicates are collapsed.' },
      { name: 'from / to', where: 'body', type: 'number?', notes: 'First request: optional Unix milliseconds, from inclusive and to exclusive; from must be less than to. Omit for all history.' },
      { name: 'limit', where: 'body', type: 'number?', notes: 'Integer 1–1000, default 500, per history array per page. No total history cap.' },
      { name: 'cursor', where: 'body', type: 'string?', notes: 'Subsequent requests: send only cursor and optional limit. Retains original filters and bounds; new polls are excluded until a fresh export.' },
    ],
    responses: [
      { code: 200, notes: '{ printers, snapshots, supplyEvents, nextCursor }. History arrays are ordered by ascending record ID and include printerId; one array may be empty before export completion. Printer metadata includes community and archivedAt and reflects current state on each page. Counters may be null. nextCursor is null when complete.' },
      { code: 400, notes: 'Invalid request, filters, limit, or cursor' },
      { code: 404, notes: '{ error, missingPrinterIds }; unknown IDs fail the entire request' },
    ],
    example: `curl -X POST http://localhost:3101/api/printers/export \\
  -H 'content-type: application/json' \\
  -d '{"printerIds":["printer-id-1","printer-id-2"],"limit":500}'

# Continue with nextCursor from the response until it is null:
curl -X POST http://localhost:3101/api/printers/export \\
  -H 'content-type: application/json' \\
  -d '{"cursor":"returned-nextCursor","limit":500}'`,
  },
  {
    method: 'POST',
    path: '/api/printers',
    summary: 'Manually add a printer by IP, or restore an archived printer at the same IP with its existing ID and history. Runs adapter detection before accepting.',
    params: [
      { name: 'ip', where: 'body', type: 'string', notes: 'IPv4 address (dotted quad)' },
      { name: 'name', where: 'body', type: 'string?', notes: 'Optional friendly name (≤100 chars)' },
      {
        name: 'community',
        where: 'body',
        type: 'string?',
        notes: 'Optional SNMPv2c community override',
      },
    ],
    responses: [
      { code: 200, notes: 'Restored archived printer object' },
      { code: 201, notes: 'Created printer object' },
      { code: 400, notes: 'Validation error' },
      { code: 409, notes: '`{ "error": "a printer with that IP already exists" }`' },
      {
        code: 422,
        notes:
          '`{ "error": "no adapter could reach this IP (SNMP, HP LEDM, and IPP all failed)" }`',
      },
    ],
    example: `curl -X POST http://localhost:3101/api/printers \\
  -H 'content-type: application/json' \\
  -d '{"ip":"192.168.0.137","name":"office"}'`,
  },
  {
    method: 'POST',
    path: '/api/printers/:id/poll',
    summary: 'Force an immediate poll. Returns the resulting snapshot.',
    params: [{ name: 'id', where: 'path', type: 'string' }],
    responses: [
      { code: 200, notes: '`{ "snapshot": { ... } }`' },
      { code: 404, notes: '`{ "error": "printer not found" }`' },
    ],
  },
  {
    method: 'DELETE',
    path: '/api/printers/:id',
    summary: 'Archive a printer and stop polling it. All metadata, snapshots, and cartridge replacement events are retained and remain exportable. Add the same IP manually to restore monitoring.',
    params: [{ name: 'id', where: 'path', type: 'string' }],
    responses: [
      { code: 204, notes: 'No content' },
      { code: 404, notes: '`{ "error": "printer not found" }`' },
    ],
  },
  {
    method: 'POST',
    path: '/api/discover',
    summary: 'Trigger an mDNS discovery scan now (instead of waiting for the background cycle).',
    responses: [{ code: 200, notes: '`{ "ok": true }` once the scan completes' }],
  },
];

function methodClass(m: Endpoint['method']): string {
  return `http-method http-${m.toLowerCase()}`;
}

export function ApiDocs(): JSX.Element {
  return (
    <div className="app docs">
      <header>
        <h1>API reference</h1>
        <a href="/" className="nav-link">
          ← back to dashboard
        </a>
      </header>

      <p className="muted">
        All endpoints return JSON. The base URL is the host serving this dashboard — in
        development that's <code>http://localhost:3101</code>.
      </p>

      <div className="endpoints">
        {ENDPOINTS.map((e) => (
          <section className="endpoint" key={`${e.method} ${e.path}`}>
            <div className="endpoint-header">
              <span className={methodClass(e.method)}>{e.method}</span>
              <code className="endpoint-path">{e.path}</code>
            </div>
            <p className="endpoint-summary">{e.summary}</p>

            {e.params && e.params.length > 0 && (
              <>
                <h4>Parameters</h4>
                <table className="params-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>In</th>
                      <th>Type</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.params.map((p) => (
                      <tr key={p.name}>
                        <td>
                          <code>{p.name}</code>
                        </td>
                        <td>{p.where}</td>
                        <td>
                          <code>{p.type}</code>
                        </td>
                        <td className="muted">{p.notes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {e.responses && e.responses.length > 0 && (
              <>
                <h4>Responses</h4>
                <ul className="responses">
                  {e.responses.map((r) => (
                    <li key={r.code}>
                      <span className={`status-code status-${Math.floor(r.code / 100)}xx`}>
                        {r.code}
                      </span>{' '}
                      <span className="muted">{r.notes}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {e.example && (
              <>
                <h4>Example</h4>
                <pre className="example">{e.example}</pre>
              </>
            )}
          </section>
        ))}
      </div>

      <footer className="muted small">
        Source: <code>apps/server/src/routes/</code>
      </footer>
    </div>
  );
}
