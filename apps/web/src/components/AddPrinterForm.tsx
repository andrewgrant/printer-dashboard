import { useState } from 'react';

export function AddPrinterForm({
  onAdd,
}: {
  onAdd: (body: { ip: string; name?: string; community?: string }) => Promise<void>;
}): JSX.Element {
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [community, setCommunity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        ip,
        name: name.trim() || undefined,
        community: community.trim() || undefined,
      });
      setIp('');
      setName('');
      setCommunity('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <input
        placeholder="IP address (e.g. 192.168.0.137)"
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        required
        pattern="\d{1,3}(\.\d{1,3}){3}"
      />
      <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Community (optional, default 'public')"
        value={community}
        onChange={(e) => setCommunity(e.target.value)}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add printer'}
      </button>
      {error && <div className="error small">{error}</div>}
    </form>
  );
}
