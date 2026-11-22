// Bottom-sheet contents of the finder.
import { bearingDeg, cardinal, formatDistance } from './geo.js';
import { StateChip } from './parts.jsx';

export function Alternatives({ ranked, position, currentId, onPick }) {
  const list = ranked.usable.slice(0, 6);
  const closed = ranked.unusable.filter((c) => c.distance < (list.at(-1)?.distance ?? 5000)).length;
  if (!list.length) return <p>Brak innych dostępnych AED w promieniu 5 km.</p>;
  return (
    <>
      <ul className="m-alt">
        {list.map((c) => (
          <li key={c.site.id}>
            <button type="button" className={c.site.id === currentId ? 'on' : ''} onClick={() => onPick(c.site.id)}>
              <span className="m-alt-dist">{formatDistance(c.distance)}</span>
              <span className="m-alt-main">
                {/* Most sources have no site name, the placement text is what identifies it. */}
                <span className="m-alt-name">{c.site.name ?? c.site.placement ?? 'Defibrylator AED'}</span>
                <span className="m-alt-sub">
                  <StateChip state={c.state} /> {cardinal(bearingDeg(position, c.site))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {closed > 0 && (
        <p className="m-alt-note">
          W tym zasięgu pominięto {closed} AED, które są teraz zamknięte, niesprawne lub niedostępne publicznie.
        </p>
      )}
    </>
  );
}

export function HowTo() {
  return (
    <ol className="m-howto">
      <li><b>Zadzwoń 112</b> (lub poproś kogoś) i włącz tryb głośnomówiący.</li>
      <li><b>Włącz AED</b> – otwórz pokrywę lub naciśnij zielony przycisk. Urządzenie mówi, co robić.</li>
      <li><b>Odsłoń klatkę piersiową</b> i naklej elektrody tak, jak na rysunku.</li>
      <li><b>Nie dotykaj poszkodowanego</b> podczas analizy. Gdy AED każe – naciśnij przycisk wyładowania.</li>
      <li><b>Uciskaj klatkę piersiową</b> (30 uciśnięć : 2 oddechy) do przyjazdu ratowników.</li>
    </ol>
  );
}

// Deliberately does NOT dial: this is a stage demo.
export function Call112() {
  return (
    <div className="m-112-info">
      <p><b>Wersja demonstracyjna – połączenie nie zostanie wykonane.</b></p>
      <p>W docelowej aplikacji ten przycisk dzwoni na 112 jednym dotknięciem, a telefon wysyła
        dyspozytorowi dokładną lokalizację (AML). Kolejny krok: dyspozytor widzi, do którego AED
        aplikacja prowadzi, i od razu podaje kod do szafki.</p>
    </div>
  );
}
