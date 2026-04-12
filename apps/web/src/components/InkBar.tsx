import type { SupplyState } from '../api.js';

const COLORANT_SWATCH: Record<string, string> = {
  cyan: '#00b8d9',
  magenta: '#d93ab4',
  yellow: '#e8c400',
  black: '#222',
  color: 'linear-gradient(90deg, #00b8d9 0 33%, #d93ab4 33% 66%, #e8c400 66%)',
  photo: '#606070',
  other: '#888',
};

export function InkBar({
  label,
  colorant,
  levelPercent,
  state,
}: {
  label: string;
  colorant: string;
  levelPercent: number | null;
  state: SupplyState;
}): JSX.Element {
  const swatch = COLORANT_SWATCH[colorant] ?? COLORANT_SWATCH.other!;
  const display = levelPercent === null ? 'unknown' : `${levelPercent}%`;
  const width = levelPercent === null ? 0 : Math.max(0, Math.min(100, levelPercent));
  const stateClass = `ink-state ink-state-${state}`;

  return (
    <div className="ink-row">
      <div className="ink-swatch" style={{ background: swatch }} aria-hidden />
      <div className="ink-label-col">
        <div className="ink-label">{label}</div>
        <div className="ink-bar-track">
          <div
            className="ink-bar-fill"
            style={{
              width: `${width}%`,
              background: levelPercent === null ? '#ccc' : swatch,
            }}
          />
        </div>
      </div>
      <div className="ink-pct">
        {display}
        <div className={stateClass}>{state}</div>
      </div>
    </div>
  );
}
