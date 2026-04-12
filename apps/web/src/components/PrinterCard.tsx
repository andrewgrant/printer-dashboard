import type { Printer } from '../api.js';
import { InkBar } from './InkBar.js';

function formatRelative(ts: number | null): string {
  if (ts === null) return 'never';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function PrinterCard({
  printer,
  onDelete,
  onPoll,
}: {
  printer: Printer;
  onDelete: (id: string) => void;
  onPoll: (id: string) => void;
}): JSX.Element {
  const s = printer.snapshot;
  const status = s?.status ?? 'unknown';
  const statusClass = `status status-${status}`;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{printer.name ?? printer.model ?? printer.ip}</div>
          <div className="muted small">
            {printer.ip} · {printer.model ?? 'unknown model'}
          </div>
        </div>
        <span className={statusClass}>{status}</span>
      </div>

      {s?.statusMessage && <div className="warn small">{s.statusMessage}</div>}

      <div className="supplies">
        {s?.supplies?.length ? (
          s.supplies.map((supply, i) => (
            <InkBar
              key={`${supply.label}-${i}`}
              label={supply.label}
              colorant={supply.colorant}
              levelPercent={supply.levelPercent}
              state={supply.state}
            />
          ))
        ) : (
          <div className="muted small">No supply data</div>
        )}
      </div>

      <div className="meta">
        {s?.pageCount !== null && s?.pageCount !== undefined && (
          <div>
            <strong>{s.pageCount.toLocaleString()}</strong> total pages
            {s.pageCountColor !== null && s.pageCountMono !== null && (
              <span className="muted small">
                {' '}
                ({s.pageCountColor} color / {s.pageCountMono} mono)
              </span>
            )}
          </div>
        )}
        <div className="muted small">Last seen: {formatRelative(printer.lastSeenAt)}</div>
        <div className="muted small">
          Source: {printer.source} · Adapters: {printer.adapters.join(', ') || '—'}
        </div>
      </div>

      <div className="card-actions">
        <button onClick={() => onPoll(printer.id)}>Poll now</button>
        <button className="danger" onClick={() => onDelete(printer.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}
