// Small shared pieces of the mobile finder.
import { MAX_AGE_MS } from './aedCache.js';
import { IcClose } from './icons.jsx';

export const STATE_UI = {
  open: { label: 'Dostępny teraz', cls: 'ok' },
  unknown: { label: 'Godziny nieznane', cls: 'muted' },
  closed: { label: 'Zamknięte teraz', cls: 'warn' },
  down: { label: 'Niesprawny', cls: 'bad' },
  private: { label: 'Niedostępny publicznie', cls: 'bad' },
};

export function StateChip({ state }) {
  const s = STATE_UI[state];
  return <span className={`m-chip ${s.cls}`}>{s.label}</span>;
}

function ago(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} godz. temu` : `${Math.round(h / 24)} dni temu`;
}

// "AEDs stored on this phone" status line: the core of the offline story.
export function OfflineBadge({ aeds, offline, light = false, compact = false }) {
  const count = aeds.cells.reduce((n, c) => n + c.count, 0);
  const oldest = aeds.cells.length ? Math.min(...aeds.cells.map((c) => c.fetchedAt)) : null;
  let text;
  if (aeds.sync.state === 'syncing' && !aeds.cells.length) text = 'Pobieram mapę AED dla Twojej okolicy…';
  else if (!aeds.cells.length) text = offline ? 'Brak zapisanych danych AED (tryb offline)' : 'Brak zapisanych danych AED';
  else {
    text = compact
      ? `Działa offline · ${count.toLocaleString('pl-PL')} AED w telefonie · ${ago(oldest)}`
      : `${count.toLocaleString('pl-PL')} AED z Twojej okolicy zapisanych w telefonie · ${ago(oldest)}`;
  }
  const stale = oldest && Date.now() - oldest > MAX_AGE_MS;
  return (
    <div className={`m-offline ${light ? 'light' : ''} ${compact ? 'compact' : ''} ${stale ? 'stale' : ''}`}>
      <span className={`m-dot ${aeds.sync.state === 'syncing' ? 'busy' : offline ? 'off' : 'on'}`} />
      <span>{text}{offline && aeds.cells.length ? ' · bez internetu' : ''}</span>
    </div>
  );
}

export function Sheet({ title, onClose, children, dark = false }) {
  return (
    <div className="m-sheet-back" onClick={onClose}>
      <div className={`m-sheet ${dark ? 'dark' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="m-icon-btn" onClick={onClose} aria-label="Zamknij"><IcClose size={18} /></button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
}
