// "Skaner AED" reports: stored on the phone first (outbox), then sent.
// A report made without signal (basement, metro) is kept and sent later.
const DB_NAME = 'aed-reports';
const STORE = 'reports';

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'localId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
const put = (rec) => tx('readwrite', (s) => s.put(rec));

export async function listReports() {
  const all = (await tx('readonly', (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// Pseudonymous per-install reference (no identity), see citizen_report.client_ref.
function clientRef() {
  try {
    let ref = localStorage.getItem('aed-client-ref');
    if (!ref) { ref = crypto.randomUUID(); localStorage.setItem('aed-client-ref', ref); }
    return ref;
  } catch {
    return null;
  }
}

async function send(rec) {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rec.payload, client_ref: clientRef() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { ...rec, state: 'sent', serverId: body.report_id, sentAt: Date.now() };
}

// Save, then try to send right away. Returns the stored record.
export async function submitReport(payload, { offline = false } = {}) {
  let rec = { localId: crypto.randomUUID(), createdAt: Date.now(), state: 'queued', payload };
  await put(rec);
  if (!offline && navigator.onLine !== false) {
    try { rec = await send(rec); await put(rec); } catch { /* stays queued */ }
  }
  return rec;
}

// Retry everything still queued. Returns how many were sent.
export async function flushOutbox({ offline = false } = {}) {
  if (offline || navigator.onLine === false) return 0;
  let sent = 0;
  for (const rec of await listReports()) {
    if (rec.state !== 'queued') continue;
    try { await put(await send(rec)); sent++; } catch { break; }
  }
  return sent;
}

// Downscaled JPEG data URL (max 1280 px) from a <video>, File or canvas.
export async function toJpeg(source, max = 1280) {
  let img = source;
  let w; let h;
  if (source instanceof Blob) {
    img = await createImageBitmap(source);
  }
  if (img instanceof HTMLVideoElement) { w = img.videoWidth; h = img.videoHeight; } else { w = img.width; h = img.height; }
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// Demo stand-in when there is no camera (projector): a wall with an AED cabinet.
export function demoPhoto() {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 1280;
  const g = c.getContext('2d');
  const wall = g.createLinearGradient(0, 0, 0, c.height);
  wall.addColorStop(0, '#d9d4cb'); wall.addColorStop(1, '#b9b2a6');
  g.fillStyle = wall; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#8f877a'; g.fillRect(0, 1040, c.width, 240); // floor
  g.fillStyle = '#e9e6e0'; g.beginPath(); g.roundRect(250, 330, 460, 560, 26); g.fill(); // cabinet
  g.strokeStyle = '#a59d90'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#00843d'; g.beginPath(); g.roundRect(330, 130, 300, 170, 18); g.fill(); // sign
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(480, 270); g.bezierCurveTo(380, 210, 400, 150, 455, 160);
  g.bezierCurveTo(470, 162, 478, 172, 480, 182); g.bezierCurveTo(482, 172, 490, 162, 505, 160);
  g.bezierCurveTo(560, 150, 580, 210, 480, 270); g.fill();
  g.fillStyle = '#00843d'; g.beginPath();
  g.moveTo(488, 172); g.lineTo(462, 214); g.lineTo(480, 214); g.lineTo(472, 248); g.lineTo(500, 204);
  g.lineTo(482, 204); g.closePath(); g.fill();
  g.fillStyle = '#c8102e'; g.beginPath(); g.roundRect(330, 420, 300, 380, 20); g.fill(); // device
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText('AED', 480, 640);
  return c.toDataURL('image/jpeg', 0.8);
}
