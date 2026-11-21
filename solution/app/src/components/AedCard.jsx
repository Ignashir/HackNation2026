import { useEffect, useState } from 'react';
import {
  ACCESS, DEVICE_STATUS, GEOCODE, INSPECTION, ISSUE_STATUS, ISSUE_TYPE, ORG_TYPE, STATE,
  UNLOCK, WEEKDAY, eventLabel, formatDate, formatDateTime,
} from '../labels.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function siteState(site) {
  const usable = site.devices.filter((d) => ['active', 'unknown'].includes(d.status)).length;
  if (site.devices.length > 0 && usable === 0) return 'down';
  if (site.open_now === true) return 'open';
  if (site.open_now === false) return 'closed';
  return 'unknown';
}

function ExpiryChip({ label, date }) {
  if (!date) return <span className="chip chip-muted">{label}: brak danych</span>;
  const days = Math.round((new Date(date) - new Date()) / DAY_MS);
  const cls = days < 0 ? 'chip-bad' : days <= 60 ? 'chip-warn' : 'chip-ok';
  const note = days < 0 ? ' (po terminie)' : days <= 60 ? ` (za ${days} dni)` : '';
  return <span className={`chip ${cls}`}>{label}: {formatDate(date)}{note}</span>;
}

function hoursRows(rules) {
  return rules.map((r) => ({
    day: r.weekday ? WEEKDAY[r.weekday] : 'Codziennie',
    hours: `${r.open_from}–${r.open_to === '00:00' ? '24:00' : r.open_to}`,
    ph: r.public_holiday,
  }));
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const yesNo = (v) => (v === true ? 'tak' : v === false ? 'nie' : null);

export default function AedCard({ siteId, onClose }) {
  const [site, setSite] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSite(null);
    setError(null);
    fetch(`/api/sites/${siteId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setSite(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [siteId]);

  return (
    <aside className="card" aria-label="Szczegóły AED">
      <button className="card-close" onClick={onClose} aria-label="Zamknij">×</button>
      {error && <p className="card-error">Nie udało się wczytać danych ({error}).</p>}
      {!site && !error && <p className="card-loading">Wczytywanie…</p>}
      {site && <CardBody site={site} />}
    </aside>
  );
}

function CardBody({ site }) {
  const state = siteState(site);
  const a = site.address;
  const addressLine = [a.street, a.house_number].filter(Boolean).join(' ');
  const cityLine = [a.postcode, a.city].filter(Boolean).join(' ');
  const openIssues = site.issues.filter((i) => i.status === 'open' || i.status === 'confirmed');
  const navUrl = `https://www.openstreetmap.org/directions?to=${site.lat}%2C${site.lon}`;

  return (
    <>
      <header className="card-head">
        <span className="state-badge" style={{ background: STATE[state].color }}>
          {STATE[state].label}
        </span>
        {site.is_24_7 && <span className="chip chip-ok">24/7</span>}
        <h2>{site.name}</h2>
        <p className="address">
          {addressLine}{addressLine && cityLine ? ', ' : ''}{cityLine}
          {site.voivodeship && <span className="muted"> · woj. {site.voivodeship}</span>}
        </p>
        <a className="btn-secondary" href={navUrl} target="_blank" rel="noreferrer">Prowadź do AED ↗</a>
      </header>

      {openIssues.length > 0 && (
        <div className="alert">
          {openIssues.map((i, idx) => (
            <div key={idx}>
              ⚠ {ISSUE_TYPE[i.issue_type]} – zgłoszenie {ISSUE_STATUS[i.status]}
              {i.reported_via && ` (${i.reported_via})`}, {formatDate(i.reported_at)}
            </div>
          ))}
        </div>
      )}

      <section>
        <h3>Gdzie dokładnie</h3>
        <dl>
          <Row label="Miejsce">{site.placement_pl}</Row>
          <Row label="W budynku">{yesNo(site.indoor)}</Row>
          <Row label="Piętro">{site.floor_level}</Row>
          <Row label="Szafka">
            {[site.cabinet_type, site.cabinet_locked === true ? '(zamknięta)' : null]
              .filter(Boolean).join(' ') || null}
          </Row>
          <Row label="Odblokowanie">{UNLOCK[site.unlock_method]}</Row>
        </dl>
      </section>

      <section>
        <h3>Dostęp i godziny</h3>
        <dl>
          <Row label="Dostępność">{ACCESS[site.access_type]}</Row>
          <Row label="Uwagi">{site.access_note}</Row>
          <Row label="Dla wózków">{yesNo(site.wheelchair_accessible)}</Row>
        </dl>
        {site.is_24_7 ? (
          <p className="muted">Dostępny całą dobę.</p>
        ) : site.availability.length > 0 ? (
          <table className="hours">
            <tbody>
              {hoursRows(site.availability).map((r, i) => (
                <tr key={i}><th>{r.day}{r.ph ? ' (święta)' : ''}</th><td>{r.hours}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Godziny nieznane{site.opening_hours_raw ? `: ${site.opening_hours_raw}` : '.'}</p>
        )}
      </section>

      <section>
        <h3>Urządzenia ({site.devices.length || site.device_count_reported || 0})</h3>
        {site.devices.length === 0 && <p className="muted">Brak szczegółowych danych o urządzeniach.</p>}
        {site.devices.map((d) => (
          <div key={d.device_id} className={`device device-${d.status}`}>
            <div className="device-head">
              <strong>{[d.manufacturer, d.model].filter(Boolean).join(' ') || 'Model nieznany'}</strong>
              <span className={`chip ${d.status === 'active' ? 'chip-ok' : d.status === 'unknown' ? 'chip-muted' : 'chip-bad'}`}>
                {DEVICE_STATUS[d.status]}
              </span>
            </div>
            <div className="device-meta">
              {d.fully_automatic === true && 'w pełni automatyczny · '}
              {d.fully_automatic === false && 'półautomatyczny · '}
              {d.paediatric_capable === true && 'tryb dziecięcy · '}
              {d.serial_number ? `S/N ${d.serial_number}` : 'S/N nieznany'}
            </div>
            <div className="chips">
              <ExpiryChip label="Bateria" date={d.battery_expiry} />
              <ExpiryChip label="Elektrody" date={d.pads_expiry} />
            </div>
            <div className="device-meta">
              {d.last_inspected_at
                ? `Ostatni przegląd: ${formatDate(d.last_inspected_at)} – ${INSPECTION[d.last_inspection_result]}`
                : 'Brak zapisanych przeglądów'}
              {d.owner && <><br />Właściciel: {d.owner}</>}
              {d.funding_programme && <><br />Finansowanie: {d.funding_programme}</>}
            </div>
          </div>
        ))}
      </section>

      {site.operator && (
        <section>
          <h3>Opiekun</h3>
          <dl>
            <Row label="Nazwa">{site.operator.name}</Row>
            <Row label="Typ">{ORG_TYPE[site.operator.org_type]}</Row>
            <Row label="Telefon">{site.operator.phone && <a href={`tel:${site.operator.phone.replace(/\s/g, '')}`}>{site.operator.phone}</a>}</Row>
            <Row label="E-mail">{site.operator.email && <a href={`mailto:${site.operator.email}`}>{site.operator.email}</a>}</Row>
            <Row label="WWW">{site.operator.website && <a href={site.operator.website} target="_blank" rel="noreferrer">{site.operator.website}</a>}</Row>
          </dl>
        </section>
      )}

      {site.media.length > 0 && (
        <section>
          <h3>Zdjęcia</h3>
          <div className="media">
            {site.media.map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
                <img src={m.url} alt={`Zdjęcie AED (${m.license})`} loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>Jakość danych</h3>
        <dl>
          <Row label="Wiarygodność">
            {site.confidence_score != null ? (
              <span className="meter" title={site.confidence_score.toFixed(2)}>
                <span style={{ width: `${Math.round(site.confidence_score * 100)}%` }} />
              </span>
            ) : null}
          </Row>
          <Row label="Zweryfikowano">{formatDate(site.last_verified_at)}</Row>
          <Row label="Współrzędne">
            {site.lat.toFixed(5)}, {site.lon.toFixed(5)}
            {site.geocode_method && ` (${GEOCODE[site.geocode_method]}`}
            {site.position_accuracy_m != null && ` ±${site.position_accuracy_m} m`}
            {site.geocode_method && ')'}
          </Row>
          <Row label="Źródła">
            {site.sources.map((s) => `${s.source} (${s.external_id})`).join(', ') || null}
          </Row>
        </dl>
      </section>

      {site.timeline.length > 0 && (
        <details className="timeline">
          <summary>Historia zmian ({site.timeline.length})</summary>
          <ol>
            {site.timeline.map((e, i) => (
              <li key={i}>
                <time>{formatDateTime(e.event_at)}</time> {eventLabel(e.event_type)}
                {e.actor && <span className="muted"> · {e.actor}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
