// Presenter controls: simulate position / compass / walking / no network, so
// the concept can be shown on a projector (no GPS, no compass) or indoors.
import { clearCache, removeDemoSites, saveDemoSites } from './aedCache.js';
import { bearingDeg, offsetPoint } from './geo.js';
import { DEFAULT_START, demoSitesAround } from './demo.js';
import { Sheet } from './parts.jsx';

export default function DemoPanel({
  demo, setDemo, onClose, realPosition, position, target, aeds, compass, chooseTarget,
}) {
  const here = position ?? realPosition ?? DEFAULT_START;

  const toggleSimPos = (on) => setDemo(on
    ? { simPos: true, lat: here.lat, lon: here.lon }
    : { simPos: false, walking: false });

  const placeNearTarget = () => {
    if (!target) return;
    const p = offsetPoint(target.site, Math.random() * 360, 250);
    chooseTarget(target.site.id); // walk to THIS one, even if another is nearer to the new spot
    setDemo({ simPos: true, walking: false, lat: p.lat, lon: p.lon });
  };

  const aimAtTarget = () => {
    if (!target || !position) return;
    setDemo({ simHeading: true, heading: Math.round(bearingDeg(position, target.site)) });
  };

  const addDemoSites = async () => {
    await saveDemoSites(demoSitesAround(here));
    await aeds.reload();
    chooseTarget('demo-0');
  };
  const dropDemoSites = async () => { await removeDemoSites(); await aeds.reload(); chooseTarget(null); };
  const wipe = async () => { await clearCache(); await aeds.reload(); };

  return (
    <Sheet title="Panel prezentacji (demo)" onClose={onClose}>
      <div className="m-demo">
        <fieldset>
          <legend>Lokalizacja</legend>
          <label className="m-switch">
            <input type="checkbox" checked={demo.simPos} onChange={(e) => toggleSimPos(e.target.checked)} />
            Symulowana pozycja {realPosition ? '' : '(brak GPS)'}
          </label>
          <div className="m-demo-row">
            <button type="button" onClick={placeNearTarget} disabled={!target}>Ustaw ~250 m od AED</button>
            <button type="button" disabled={!demo.simPos || !target} onClick={() => setDemo({ walking: !demo.walking })}>
              {demo.walking ? '⏸ Zatrzymaj' : '▶ Idź do AED'}
            </button>
          </div>
          <label className="m-demo-range">
            Tempo ×{demo.speed}
            <input type="range" min="1" max="10" value={demo.speed} onChange={(e) => setDemo({ speed: Number(e.target.value) })} />
          </label>
          {!demo.simPos && <p className="m-demo-note">Start symulacji: Twoja pozycja GPS albo Warszawa, pl. Defilad.</p>}
        </fieldset>

        <fieldset>
          <legend>Kompas</legend>
          <label className="m-switch">
            <input type="checkbox" checked={demo.simHeading} onChange={(e) => setDemo({ simHeading: e.target.checked })} />
            Symulowany kompas (prawdziwy: {compass.status === 'active' ? 'działa' : compass.status})
          </label>
          <label className="m-demo-range">
            Telefon skierowany na {Math.round(demo.heading)}°
            <input
              type="range" min="0" max="359" value={Math.round(demo.heading)}
              onChange={(e) => setDemo({ simHeading: true, heading: Number(e.target.value) })}
            />
          </label>
          <div className="m-demo-row">
            <button type="button" onClick={aimAtTarget} disabled={!target}>Obróć w stronę AED</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Dane offline</legend>
          <label className="m-switch">
            <input type="checkbox" checked={demo.offline} onChange={(e) => setDemo({ offline: e.target.checked })} />
            Brak internetu (blokuj pobieranie)
          </label>
          <p className="m-demo-note">
            {aeds.cells.length} z 9 obszarów wokół Ciebie w pamięci telefonu
            ({aeds.storedCells} łącznie) · ostatnia synchronizacja: {aeds.sync.at ? new Date(aeds.sync.at).toLocaleTimeString('pl-PL') : '—'}
            {aeds.sync.failed ? ` · błędy: ${aeds.sync.failed}` : ''}
          </p>
          <div className="m-demo-row">
            <button type="button" onClick={aeds.resync} disabled={demo.offline}>Synchronizuj teraz</button>
            <button type="button" onClick={wipe}>Wyczyść pamięć</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Testowe AED</legend>
          <p className="m-demo-note">3 dobrze opisane AED w odległości 90 / 230 / 420 m od bieżącej pozycji (tylko w tym telefonie).</p>
          <div className="m-demo-row">
            <button type="button" onClick={addDemoSites}>Dodaj wokół mnie</button>
            <button type="button" onClick={dropDemoSites}>Usuń</button>
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}
