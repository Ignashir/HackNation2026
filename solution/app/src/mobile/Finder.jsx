// "Find My"-style guidance to the nearest usable AED, from the offline cache.
import { useEffect, useRef, useState } from 'react';
import { ACCESS } from '../labels.js';
import { GEO_MESSAGE } from '../useGeolocation.js';
import { requestCompass } from './compass.js';
import {
  angleDiff, bearingDeg, cardinal, formatDistance, formatWalk, turnHint,
} from './geo.js';
import { todayHours } from './aedRules.js';
import { OfflineBadge, Sheet, StateChip } from './parts.jsx';
import { Alternatives, Call112, HowTo } from './sheets.jsx';
import {
  IcBack, IcBuilding, IcChild, IcDoor, IcGear, IcLock, IcMap, IcPhone, IcStairs, IcTag, IcTree, IcUnlock,
} from './icons.jsx';

const ALIGNED_DEG = 15;

const UNLOCK_HINT = {
  none: 'Szafka otwarta – wyjmij AED',
  code_112: 'Szafka na kod – poda go dyspozytor 112',
  key: 'Szafka na klucz – zapytaj obsługę',
  staff: 'Wydaje personel obiektu',
};

const floorText = (f) => {
  if (f == null || f === '') return null;
  if (f === '0' || /parter/i.test(f)) return 'Parter';
  if (/^-\d+$/.test(f)) return `Poziom ${f}`;
  return /^\d+$/.test(f) ? `${f}. piętro` : `Piętro: ${f}`;
};

// Keep CSS rotation continuous across 359 -> 0 so the arrow never spins around.
function useUnwrapped(angle) {
  const ref = useRef(angle ?? 0);
  if (angle != null) ref.current += angleDiff(angle, ref.current);
  return ref.current;
}

function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const get = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    const onVis = () => { if (document.visibilityState === 'visible') get(); };
    get();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, []);
}

function mapsUrl(site) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios
    ? `https://maps.apple.com/?daddr=${site.lat},${site.lon}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lon}&travelmode=walking`;
}

export default function Finder({
  position, geoStatus, heading, compass, simHeading, aeds, offline, ranked, target,
  chooseTarget, onBack, openDemo,
}) {
  useWakeLock();
  const [sheet, setSheet] = useState(null); // 'alt' | 'howto' | '112'

  const site = target?.site;
  const bearing = site && position ? bearingDeg(position, site) : null;
  const hasHeading = heading != null;
  const rel = bearing != null && hasHeading ? angleDiff(bearing, heading) : null;
  const aligned = rel != null && Math.abs(rel) <= ALIGNED_DEG;
  const closeR = Math.min(50, Math.max(15, position?.accuracy ?? 0, site?.pos_acc ?? 0));
  const near = target && target.distance <= closeR;

  // Arrow: relative to the phone when we have a heading, else relative to north.
  const arrowRot = useUnwrapped(rel ?? bearing);
  const roseRot = useUnwrapped(hasHeading ? -heading : 0);

  // Small buzz when you turn to face the AED (Android; iOS Safari has no vibrate).
  const wasAligned = useRef(false);
  useEffect(() => {
    if (aligned && !wasAligned.current) navigator.vibrate?.(40);
    wasAligned.current = aligned;
  }, [aligned]);

  const mood = near ? 'near' : aligned ? 'aligned' : '';

  return (
    <div className={`m-finder ${mood}`}>
      <header className="m-f-top">
        <button type="button" className="m-icon-btn" onClick={onBack} aria-label="Wróć"><IcBack /></button>
        <div className="m-f-title">Najbliższy AED</div>
        <button type="button" className="m-icon-btn" onClick={openDemo} aria-label="Panel prezentacji"><IcGear size={20} /></button>
      </header>
      <OfflineBadge aeds={aeds} offline={offline} compact />

      <section className="m-f-guide">
        {!position && <div className="m-f-msg">{GEO_MESSAGE[geoStatus] ?? GEO_MESSAGE.locating}</div>}

        {position && !site && (
          <div className="m-f-msg">
            {aeds.loaded && !aeds.cells.length
              ? 'Brak zapisanych danych AED dla tej okolicy. Połącz się z internetem, aby je pobrać.'
              : aeds.loaded ? 'Brak dostępnego AED w promieniu 5 km.' : 'Wczytuję zapisane AED…'}
            <div className="m-f-msg-sub">Zadzwoń pod 112 – dyspozytor pomoże.</div>
          </div>
        )}

        {site && !near && (
          <>
            <div className="m-dial">
              <div className="m-rose" style={{ transform: `rotate(${roseRot}deg)` }}>
                <span className="n">N</span><span className="e">E</span><span className="s">S</span><span className="w">W</span>
              </div>
              <svg className="m-arrow" viewBox="0 0 100 100" style={{ transform: `rotate(${arrowRot}deg)` }} aria-hidden="true">
                <path d="M50 6 L80 78 Q50 62 20 78 Z" />
              </svg>
            </div>
            <div className="m-dist">{formatDistance(target.distance)}</div>
            <div className="m-hint">
              {rel != null ? turnHint(rel) : `AED jest ${cardinal(bearing)} od Ciebie`}
            </div>
            <div className="m-hint-sub">
              {formatWalk(target.distance)} · GPS ±{Math.round(position.accuracy)} m
            </div>
            {!hasHeading && compass.status === 'needs-permission' && (
              <button type="button" className="m-pill" onClick={requestCompass}>Włącz kompas</button>
            )}
            {!hasHeading && compass.status !== 'needs-permission' && (
              <div className="m-hint-sub">Bez kompasu: strzałka względem północy (N)</div>
            )}
            {simHeading && <div className="m-hint-sub">Kompas symulowany (demo)</div>}
          </>
        )}

        {site && near && (
          <div className="m-near">
            <div className="m-pulse"><span /><span /><span /></div>
            <div className="m-near-title">Jesteś blisko</div>
            <div className="m-near-sub">AED jest w promieniu ~{Math.round(closeR)} m. Rozejrzyj się:</div>
            {site.placement && <div className="m-near-place">„{site.placement}”</div>}
          </div>
        )}
      </section>

      {site && (
        <section className="m-card">
          <div className="m-card-row">
            <StateChip state={target.state} />
            {todayHours(site) && <span className="m-card-hours">{todayHours(site)}</span>}
          </div>
          <h2 className="m-card-title">{site.name ?? 'Defibrylator AED'}</h2>
          {site.address && <div className="m-card-addr">{site.address}</div>}
          {site.placement && !near && (
            <div className="m-card-place"><b>Gdzie dokładnie:</b> {site.placement}</div>
          )}
          <ul className="m-facts">
            {site.indoor != null && (
              <li>{site.indoor ? <><IcBuilding /> W budynku</> : <><IcTree /> Na zewnątrz</>}</li>
            )}
            {floorText(site.floor) && <li><IcStairs /> {floorText(site.floor)}</li>}
            {site.access && <li><IcDoor /> {ACCESS[site.access]}{site.access_note ? ` – ${site.access_note}` : ''}</li>}
            {site.unlock && <li>{site.unlock === 'none' ? <IcUnlock /> : <IcLock />} {UNLOCK_HINT[site.unlock]}</li>}
            {site.paed && <li><IcChild /> Elektrody dla dzieci</li>}
            {site.operator && <li><IcTag /> {site.operator}{site.phone ? ` · ${site.phone}` : ''}</li>}
          </ul>
          {site.photo && <img className="m-card-photo" src={site.photo} alt="Miejsce instalacji AED" />}
          <div className="m-card-actions">
            {near
              ? <button type="button" className="m-btn primary" onClick={() => setSheet('howto')}>Mam AED – jak użyć?</button>
              : <a className="m-btn" href={mapsUrl(site)} target="_blank" rel="noreferrer"><IcMap size={18} /> Trasa</a>}
            <button type="button" className="m-btn" onClick={() => setSheet('alt')}>Inne AED</button>
          </div>
          {site.demo && <div className="m-card-demo">Testowy AED dodany w panelu demo</div>}
        </section>
      )}

      <button type="button" className="m-112" onClick={() => setSheet('112')}>
        <IcPhone size={20} /> Zadzwoń 112
      </button>

      {sheet === 'alt' && (
        <Sheet title="AED w pobliżu" onClose={() => setSheet(null)}>
          <Alternatives
            ranked={ranked} position={position} currentId={site?.id}
            onPick={(id) => { chooseTarget(id); setSheet(null); }}
          />
        </Sheet>
      )}
      {sheet === 'howto' && <Sheet title="Jak użyć AED" onClose={() => setSheet(null)}><HowTo /></Sheet>}
      {sheet === '112' && <Sheet title="Połączenie alarmowe" onClose={() => setSheet(null)}><Call112 /></Sheet>}
    </div>
  );
}
