// Demo-only helpers: persisted demo settings and test AEDs placed around you.
import { offsetPoint } from './geo.js';

const KEY = 'aed-demo-settings';
export const DEFAULT_START = { lat: 52.2318, lon: 21.0060 }; // Warsaw, pl. Defilad

export const DEFAULT_DEMO = {
  simPos: false, lat: DEFAULT_START.lat, lon: DEFAULT_START.lon,
  simHeading: false, heading: 0,
  walking: false, speed: 3,
  offline: false,
};

export function loadDemo() {
  try {
    return { ...DEFAULT_DEMO, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), walking: false };
  } catch {
    return DEFAULT_DEMO;
  }
}
export function saveDemo(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

// Three well-described AEDs around `p`, so the demo works anywhere (real data
// near the venue may be sparse or poorly described). Stored only on the phone.
const WEEKDAYS = (from, to) => [1, 2, 3, 4, 5].map((d) => [d, from, to]);
const TEMPLATES = [
  {
    bearing: 40, dist: 90,
    name: 'DEMO · Stacja metra, wejście północne', h24: true, indoor: true, floor: '-1',
    placement: 'Poziom -1, za bramkami po prawej, czerwona szafka z napisem AED obok windy',
    access: 'yes', unlock: 'none', locked: false, devices: 1, usable: 1, paed: true,
    operator: 'DEMO Operator Metra', phone: '+48 22 000 00 00', address: 'ul. Przykładowa 1',
  },
  {
    bearing: 160, dist: 230,
    name: 'DEMO · Biblioteka Publiczna', indoor: true, floor: '0',
    hours: [...WEEKDAYS('08:00', '20:00'), [6, '09:00', '15:00']],
    placement: 'Parter, na ścianie obok recepcji, biała szafka z zielonym znakiem AED',
    access: 'yes', unlock: 'none', devices: 1, usable: 1, paed: false,
    operator: 'DEMO Biblioteka', address: 'ul. Książkowa 12',
  },
  {
    bearing: 290, dist: 420,
    name: 'DEMO · Urząd Dzielnicy', indoor: true, floor: '1',
    hours: WEEKDAYS('08:00', '18:00'),
    placement: 'I piętro, korytarz przy sali obsługi mieszkańców, szafka z alarmem',
    access: 'yes', unlock: 'code_112', locked: true, devices: 1, usable: 1,
    operator: 'DEMO Urząd', address: 'pl. Urzędowy 3',
  },
];

export function demoSitesAround(p) {
  return TEMPLATES.map(({ bearing, dist, ...rest }, i) => ({
    id: `demo-${i}`, demo: true, pos_acc: 5, ...offsetPoint(p, bearing, dist), ...rest,
  }));
}
