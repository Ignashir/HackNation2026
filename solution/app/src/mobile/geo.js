// Pure geo helpers shared by the mobile client and the API (server/index.js imports geohash*).

// --- geohash ---------------------------------------------------------------
// Offline cache cells are geohash precision-4 cells (~39 x 20 km in Poland).
export const CELL_PRECISION = 4;
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export const GEOHASH_RE = /^[0-9b-hjkmnp-z]{1,12}$/;

export function geohashEncode(lat, lon, precision = CELL_PRECISION) {
  let latMin = -90; let latMax = 90; let lonMin = -180; let lonMax = 180;
  let even = true; let bit = 0; let idx = 0; let out = '';
  while (out.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx *= 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx *= 2; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { out += B32[idx]; bit = 0; idx = 0; }
  }
  return out;
}

// { s, w, n, e } of a geohash cell.
export function geohashBounds(gh) {
  let latMin = -90; let latMax = 90; let lonMin = -180; let lonMax = 180;
  let even = true;
  for (const ch of gh) {
    const v = B32.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (on) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  return { s: latMin, w: lonMin, n: latMax, e: lonMax };
}

// The cell itself plus its 8 neighbours.
export function geohashAround(gh) {
  const b = geohashBounds(gh);
  const h = b.n - b.s; const w = b.e - b.w;
  const lat = (b.n + b.s) / 2; const lon = (b.e + b.w) / 2;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) out.push(geohashEncode(lat + dy * h, lon + dx * w, gh.length));
  }
  return out;
}

// --- distance / direction ----------------------------------------------------
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Initial bearing a -> b, degrees clockwise from true north.
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Point `dist` metres from `p` towards `bearing`.
export function offsetPoint(p, bearing, dist) {
  const d = dist / R; const br = rad(bearing);
  const lat1 = rad(p.lat); const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

// Signed difference target - current, in (-180, 180].
export function angleDiff(target, current) {
  let d = ((target - current) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// --- wording -------------------------------------------------------------------
// Rounded on purpose, like "Find My": GPS is +-10 m at best, the point is the order of magnitude.
export function formatDistance(m) {
  if (m < 10) return 'tutaj';
  if (m < 100) return `~${Math.round(m / 5) * 5} m`;
  if (m < 1000) return `~${Math.round(m / 10) * 10} m`;
  return `~${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatWalk(m) {
  const min = Math.max(1, Math.round(m / 1.3 / 60)); // 1.3 m/s, hurried walk
  return `ok. ${min} min pieszo`;
}

const CARDINAL = ['na północ', 'na północny wschód', 'na wschód', 'na południowy wschód',
  'na południe', 'na południowy zachód', 'na zachód', 'na północny zachód'];
export const cardinal = (bearing) => CARDINAL[Math.round(bearing / 45) % 8];

// Relative direction (target bearing minus phone heading) as an instruction.
export function turnHint(rel) {
  const a = Math.abs(rel);
  if (a <= 20) return 'Prosto przed Tobą';
  if (a >= 135) return 'Za Tobą – obróć się';
  const side = rel > 0 ? 'w prawo' : 'w lewo';
  return a <= 60 ? `Lekko ${side}` : `Skręć ${side}`;
}
