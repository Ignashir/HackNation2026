// Phone compass as a tiny external store (one listener for the whole app).
//   status: 'idle' | 'needs-permission' | 'active' | 'denied' | 'unsupported'
//   heading: degrees clockwise from TRUE north, smoothed, or null
//
// iOS: DeviceOrientationEvent.requestPermission() must be called from a tap,
//      then 'deviceorientation' carries webkitCompassHeading (magnetic north).
// Android/Chrome: 'deviceorientationabsolute', heading = 360 - alpha.
import { useSyncExternalStore } from 'react';

// Magnetic declination in Poland is ~+6..7 deg E (2026). Compass APIs report
// magnetic north, the bearing to the AED is from true north.
const DECLINATION = 6.5;
const SMOOTH = 0.25; // EMA factor on the unit circle

const needsPermission = typeof DeviceOrientationEvent !== 'undefined'
  && typeof DeviceOrientationEvent.requestPermission === 'function';

let state = {
  status: typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined' ? 'unsupported'
    : needsPermission ? 'needs-permission' : 'idle',
  heading: null,
  accuracy: null,
};
const subs = new Set();
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };

let sx = null; let sy = null;
function feed(raw, accuracy = null) {
  const r = (raw * Math.PI) / 180;
  if (sx == null) { sx = Math.cos(r); sy = Math.sin(r); } else {
    sx += SMOOTH * (Math.cos(r) - sx); sy += SMOOTH * (Math.sin(r) - sy);
  }
  const h = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  set({ status: 'active', heading: h, accuracy });
}

const screenAngle = () => (screen.orientation?.angle ?? window.orientation ?? 0);

function onIos(e) {
  if (e.webkitCompassHeading == null) return;
  feed((e.webkitCompassHeading + DECLINATION + screenAngle()) % 360, e.webkitCompassAccuracy ?? null);
}
function onAbsolute(e) {
  if (e.alpha == null) return;
  feed((360 - e.alpha + DECLINATION + screenAngle()) % 360);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onAbsolute);
  else window.addEventListener('deviceorientation', onIos);
  // Laptops expose the API but never send a heading.
  setTimeout(() => { if (state.status !== 'active') set({ status: 'unsupported' }); }, 3000);
}

if (state.status === 'idle') start();

// Call from a click/tap handler (iOS requirement). Safe to call repeatedly.
export async function requestCompass() {
  if (!needsPermission) return;
  try {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res === 'granted') start(); else set({ status: 'denied' });
  } catch {
    // Not called from a gesture; leave it as needs-permission.
  }
}

export function useCompass() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
