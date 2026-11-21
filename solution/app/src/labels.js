// Polish UI labels for the enum values used in solution/sql.

export const STATE = {
  open: { label: 'Dostępny teraz', color: '#15803d' },
  closed: { label: 'Zamknięte teraz', color: '#b45309' },
  unknown: { label: 'Godziny nieznane', color: '#64748b' },
  down: { label: 'Niesprawny', color: '#b91c1c' },
};

export const ACCESS = {
  yes: 'Ogólnodostępny',
  customers: 'Dla klientów / gości',
  permit: 'Za zgodą / z przepustką',
  private: 'Prywatny',
  no: 'Niedostępny publicznie',
};

export const UNLOCK = {
  none: 'Bez zabezpieczeń',
  code_112: 'Kod od dyspozytora 112',
  key: 'Na klucz',
  staff: 'Przez personel',
};

export const DEVICE_STATUS = {
  active: 'Sprawny',
  out_of_service: 'Niesprawny',
  removed: 'Usunięty',
  unknown: 'Status nieznany',
};

export const INSPECTION = {
  ok: 'OK',
  battery_low: 'Słaba bateria',
  pads_expired: 'Elektrody przeterminowane',
  missing: 'Brak urządzenia',
  damaged: 'Uszkodzony',
};

export const ISSUE_TYPE = {
  missing: 'Brak AED',
  broken: 'Uszkodzony',
  moved: 'Przeniesiony',
  wrong_hours: 'Błędne godziny',
};

export const ISSUE_STATUS = {
  open: 'otwarte',
  confirmed: 'potwierdzone',
  resolved: 'rozwiązane',
  rejected: 'odrzucone',
};

export const GEOCODE = {
  survey: 'pomiar w terenie',
  osm: 'OpenStreetMap',
  address: 'z adresu',
  manual: 'ręcznie',
};

export const ORG_TYPE = {
  gmina: 'gmina',
  school: 'szkoła / uczelnia',
  ngo: 'organizacja pozarządowa',
  company: 'firma',
  osp: 'OSP',
  psp: 'PSP',
  hospital: 'szpital',
  religious: 'parafia / związek wyznaniowy',
};

export const WEEKDAY = ['', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

const EVENT_PREFIX = {
  aed_site: 'Lokalizacja',
  aed_device: 'Urządzenie',
  availability_rule: 'Godziny',
  media: 'Zdjęcie',
  field_provenance: 'Pochodzenie pola',
  issue_report: 'Zgłoszenie',
  source_record: 'Rekord źródłowy',
  source: 'Źródło',
  inspection: 'Przegląd',
  issue: 'Zgłoszenie',
};

const EVENT_ACTION = {
  insert: 'dodano',
  update: 'zmieniono',
  delete: 'usunięto',
  new: 'nowy rekord',
  changed: 'zmiana danych',
  ...INSPECTION,
  ...ISSUE_TYPE,
};

export function eventLabel(eventType) {
  const [prefix, action] = eventType.split('.');
  return `${EVENT_PREFIX[prefix] ?? prefix}: ${EVENT_ACTION[action] ?? action}`;
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pl-PL');
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}
