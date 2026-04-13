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
    responses: [
      {
        code: 200,
        notes:
          'Array of `{ id, ip, name, model, source, adapters, lastSeenAt, createdAt, snapshot }`. `snapshot` is `null` if the printer has never been successfully polled.',
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
    summary: 'Snapshot history for a printer, newest first.',
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
    path: '/api/printers',
    summary: 'Manually add a printer by IP. Runs adapter detection synchronously before accepting.',
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
    summary: 'Remove a printer (and its snapshot history) from the database.',
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
