// Offline AED cache: geohash cells (see geo.js) stored in IndexedDB.
//
// While the app is open we know roughly where the user is, so we keep the
// cell they are in plus its 8 neighbours (~120 x 60 km) on the phone and
// refresh them in the background. Finding the nearest AED never touches the
// network: it runs over what is already stored. The server only ever learns
// which ~40 km cell the phone is in, never the exact position.
import { CELL_PRECISION, geohashAround, geohashEncode } from './geo.js';

const DB_NAME = 'aed-offline';
const STORE = 'cells';
export const DEMO_CELL = 'demo'; // locally injected test AEDs (demo panel)
export const MAX_AGE_MS = 24 * 3600_000; // refresh a cell once a day
const EVICT_AFTER_MS = 7 * 24 * 3600_000; // drop far-away cells after a week

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'cell' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const getAll = () => tx('readonly', (s) => s.getAll());
const put = (rec) => tx('readwrite', (s) => s.put(rec));
const del = (cell) => tx('readwrite', (s) => s.delete(cell));
export const clearCache = () => tx('readwrite', (s) => s.clear());

export const cellOf = (p) => geohashEncode(p.lat, p.lon, CELL_PRECISION);

// Download missing or stale cells around `p`. Returns { fetched, failed }.
export async function syncAround(p, { offline = false } = {}) {
  const wanted = new Set(geohashAround(cellOf(p)));
  const have = new Map((await getAll()).map((r) => [r.cell, r]));
  let fetched = 0; let failed = 0;

  if (!offline && navigator.onLine !== false) {
    for (const cell of wanted) {
      const rec = have.get(cell);
      if (rec && Date.now() - rec.fetchedAt < MAX_AGE_MS) continue;
      try {
        const res = await fetch(`/api/cells/${cell}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        await put({ cell, fetchedAt: Date.now(), generatedAt: body.generated_at, sites: body.sites });
        fetched++;
      } catch {
        failed++; // keep the stale copy, if any
      }
    }
  }

  for (const [cell, rec] of have) {
    if (cell !== DEMO_CELL && !wanted.has(cell) && Date.now() - rec.fetchedAt > EVICT_AFTER_MS) await del(cell);
  }
  return { fetched, failed };
}

// Everything stored for the 3x3 around `p` (plus demo sites), and per-cell stats.
export async function loadAround(p) {
  const wanted = new Set(geohashAround(cellOf(p)));
  const recs = await getAll();
  const sites = [];
  const cells = [];
  for (const r of recs) {
    if (r.cell === DEMO_CELL || wanted.has(r.cell)) {
      sites.push(...r.sites);
      if (r.cell !== DEMO_CELL) cells.push({ cell: r.cell, fetchedAt: r.fetchedAt, count: r.sites.length });
    }
  }
  return { sites, cells, storedCells: recs.filter((r) => r.cell !== DEMO_CELL).length };
}

export const saveDemoSites = (sites) => put({ cell: DEMO_CELL, fetchedAt: Date.now(), sites });
export const removeDemoSites = () => del(DEMO_CELL);
