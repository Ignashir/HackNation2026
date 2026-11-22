// Client-side twin of the SQL site_open_at() / nearest_available_aed(), so the
// offline cache can answer "which AED can I use right now" with no server.
import { distanceM } from './geo.js';

const WARSAW = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function warsawNow(at) {
  const parts = Object.fromEntries(WARSAW.formatToParts(at).map((p) => [p.type, p.value]));
  const dow = DOW[parts.weekday];
  return { dow, prev: dow === 1 ? 7 : dow - 1, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

// true = open, false = closed, null = hours unknown. Rules: [weekday|null, 'HH:MM', 'HH:MM'];
// a window with to < from runs past midnight (same semantics as site_open_at()).
export function openNow(site, at = new Date()) {
  if (site.h24) return true;
  if (!site.hours?.length) return null;
  const { dow, prev, min } = warsawNow(at);
  return site.hours.some(([wd, from, to]) => {
    const f = toMin(from); const t = toMin(to); const overnight = t < f;
    if ((wd == null || wd === dow) && min >= f && (overnight || min < t)) return true;
    return overnight && (wd == null || wd === prev) && min < t;
  });
}

export function todayHours(site, at = new Date()) {
  if (site.h24) return 'Całodobowo';
  if (!site.hours?.length) return null;
  const { dow } = warsawNow(at);
  const today = site.hours.filter(([wd]) => wd == null || wd === dow);
  return today.length ? `Dziś ${today.map(([, f, t]) => `${f}–${t}`).join(', ')}` : 'Dziś nieczynne';
}

// A site with device rows where none is usable is known to be broken.
export const isDown = (s) => s.devices > 0 && !s.usable;

// 'open' | 'unknown' | 'closed' | 'down' | 'private'
export function availability(site, at) {
  if (isDown(site)) return 'down';
  if (site.access === 'private' || site.access === 'no') return 'private';
  const o = openNow(site, at);
  return o === true ? 'open' : o === false ? 'closed' : 'unknown';
}

// Candidates near `p`, nearest first, with distance and availability.
// Usable now = open, or hours unknown (better than nothing in an emergency).
export function rankNearby(sites, p, { maxM = 5000, at = new Date() } = {}) {
  const out = [];
  for (const s of sites) {
    // Cheap box prefilter before the haversine (~0.045 deg ~ 5 km).
    if (Math.abs(s.lat - p.lat) > maxM / 111000 || Math.abs(s.lon - p.lon) > maxM / 68000) continue;
    const d = distanceM(p, s);
    if (d <= maxM) out.push({ site: s, distance: d, state: availability(s, at) });
  }
  out.sort((a, b) => a.distance - b.distance);
  return {
    usable: out.filter((c) => c.state === 'open' || c.state === 'unknown'),
    unusable: out.filter((c) => c.state === 'closed' || c.state === 'down' || c.state === 'private'),
  };
}
