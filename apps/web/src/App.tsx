import { useCallback, useEffect, useState } from 'react';
import { api, type Printer } from './api.js';
import { PrinterCard } from './components/PrinterCard.js';
import { AddPrinterForm } from './components/AddPrinterForm.js';

const REFRESH_MS = 15_000;

export function App(): JSX.Element {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listPrinters();
      setPrinters(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const onDiscover = async (): Promise<void> => {
    setDiscovering(true);
    try {
      await api.discover();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const onDelete = async (id: string): Promise<void> => {
    if (!confirm('Remove this printer from the list?')) return;
    await api.deletePrinter(id);
    await refresh();
  };

  const onPoll = async (id: string): Promise<void> => {
    await api.pollNow(id);
    await refresh();
  };

  const onAdd = async (body: { ip: string; name?: string; community?: string }): Promise<void> => {
    await api.addPrinter(body);
    await refresh();
  };

  return (
    <div className="app">
      <header>
        <h1>printer-dashboard</h1>
        <div className="actions">
          <button onClick={onDiscover} disabled={discovering}>
            {discovering ? 'Scanning…' : 'Scan mDNS'}
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <AddPrinterForm onAdd={onAdd} />

      {loading && printers.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : printers.length === 0 ? (
        <p className="muted">
          No printers yet. Click <strong>Scan mDNS</strong> to auto-discover on your LAN, or add
          one manually above.
        </p>
      ) : (
        <div className="grid">
          {printers.map((p) => (
            <PrinterCard key={p.id} printer={p} onDelete={onDelete} onPoll={onPoll} />
          ))}
        </div>
      )}

      <footer className="muted small">
        Auto-refresh every {REFRESH_MS / 1000}s · {printers.length} printer
        {printers.length === 1 ? '' : 's'}
      </footer>
    </div>
  );
}
