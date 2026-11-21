import { useEffect, useMemo, useState } from 'react';
import AedMap from './components/AedMap.jsx';
import AedCard from './components/AedCard.jsx';
import { STATE } from './labels.js';
import useGeolocation, { GEO_MESSAGE } from './useGeolocation.js';

export default function App() {
  const [sites, setSites] = useState([]);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null); // { lat, lon, zoom }
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState(null);
  const geo = useGeolocation();

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSites)
      .catch((e) => setError(`Nie udało się pobrać listy AED (${e.message}). Czy API i baza działają?`));
  }, []);

  const counts = useMemo(() => {
    const c = { open: 0, closed: 0, unknown: 0, down: 0 };
    sites.forEach((s) => { c[s.state] += 1; });
    return c;
  }, [sites]);

  const selectSite = (site) => {
    setSelectedId(site.site_id);
    setFocus({ lat: site.lat, lon: site.lon, zoom: 15 });
  };

  // Tracked position -> nearest available AED (nearest_available_aed()).
  const findNearest = async () => {
    const here = geo.position;
    if (!here) {
      setNotice(GEO_MESSAGE[geo.status] ?? GEO_MESSAGE.unavailable);
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/nearest?lat=${here.lat}&lon=${here.lon}&limit=1&max_m=50000`);
      const [nearest] = await r.json();
      const site = nearest && sites.find((s) => s.site_id === nearest.site_id);
      if (site) {
        selectSite(site);
        setNotice(`Najbliższy dostępny AED: ${Math.round(nearest.distance_m)} m`);
      } else {
        setFocus({ lat: here.lat, lon: here.lon, zoom: 12 });
        setNotice('Brak dostępnego AED w promieniu 50 km.');
      }
    } catch {
      setNotice('Nie udało się wyszukać najbliższego AED.');
    } finally {
      setSearching(false);
    }
  };

  const showMyLocation = () => {
    if (!geo.position) {
      setNotice(GEO_MESSAGE[geo.status] ?? GEO_MESSAGE.unavailable);
      return;
    }
    setFocus({ lat: geo.position.lat, lon: geo.position.lon, zoom: 16, at: Date.now() });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">⚡</span>
          <h1>Mapa AED</h1>
          <span className="demo-badge" title="Dane testowe z solution/sql/dev/seed_dummy.sql">dane testowe</span>
        </div>
        <div className="counts" aria-label="Podsumowanie">
          {Object.entries(counts).map(([state, n]) => (
            <span key={state} className="count">
              <i style={{ background: STATE[state].color }} />
              {STATE[state].label}: <b>{n}</b>
            </span>
          ))}
        </div>
        <button className="btn-primary" onClick={findNearest} disabled={searching || sites.length === 0}>
          {searching ? 'Szukam…' : 'Najbliższy AED'}
        </button>
      </header>

      <main className={`content ${selectedId ? 'has-card' : ''}`}>
        <AedMap
          sites={sites}
          selectedId={selectedId}
          onSelect={selectSite}
          focus={focus}
          userLocation={geo.position}
          geoStatus={geo.status}
          onLocate={showMyLocation}
        />
        {selectedId && <AedCard siteId={selectedId} onClose={() => setSelectedId(null)} />}
        {(error || notice) && (
          <div className={`toast ${error ? 'toast-error' : ''}`} role="status">
            {error ?? notice}
            {!error && <button onClick={() => setNotice(null)} aria-label="Zamknij">×</button>}
          </div>
        )}
      </main>
    </div>
  );
}
