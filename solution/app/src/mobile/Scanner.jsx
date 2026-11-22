// "Skaner AED": photograph an AED, then either confirm / flag a known one
// (matched by position against the offline cache) or report a new one.
// The report goes to the data provider for review; nothing changes the map
// directly. No image recognition: the photo is evidence for the reviewer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { rankNearby } from './aedRules.js';
import { formatDistance } from './geo.js';
import { demoPhoto, listReports, submitReport, toJpeg } from './reports.js';
import { IcBack, IcCamera, IcCheck, IcClose, IcImage, IcPin } from './icons.jsx';
import { STATE_UI } from './parts.jsx';

const CONFIRM_OPTIONS = [
  { id: 'ok', label: 'Jest na miejscu i wygląda na sprawny' },
  { id: 'locked', label: 'Szafka zamknięta, nie da się wyjąć' },
  { id: 'broken', label: 'Uszkodzony lub sygnalizuje błąd' },
  { id: 'missing', label: 'Nie ma go tutaj' },
  { id: 'moved', label: 'Wisi w innym miejscu niż w opisie' },
];
const ACCESS_OPTIONS = [
  ['yes', 'Ogólnodostępny'], ['customers', 'Dla klientów'], ['permit', 'Za zgodą'], ['private', 'Prywatny'],
];
const STATUS_TEXT = { queued: 'Czeka na internet', sent: 'W weryfikacji' };
const KIND_TEXT = { new: 'Nowy AED', confirm: 'Potwierdzenie', issue: 'Problem z AED' };

function Camera({ onShot, onCancel }) {
  const video = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); } })
      .catch((e) => setErr(e?.name === 'NotAllowedError' ? 'Brak zgody na aparat.' : 'Aparat jest niedostępny.'));
    if (!navigator.mediaDevices) setErr('Aparat jest niedostępny (wymagane HTTPS).');
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <div className="sc-cam">
      <video ref={video} playsInline muted autoPlay />
      <div className="sc-cam-top">
        <button type="button" className="sc-round" onClick={onCancel} aria-label="Zamknij"><IcClose /></button>
        <span>Skaner AED</span>
        <span className="sc-round ghost" />
      </div>
      <div className="sc-frame"><i /><i /><i /><i /><b /></div>
      <p className="sc-cam-hint">{err ?? 'Uchwyć AED razem z otoczeniem – to pomoże innym go znaleźć'}</p>
      <div className="sc-cam-bottom">
        {err
          ? (
            <div className="sc-cam-fallback">
              <FilePick onPick={onShot} label="Wybierz zdjęcie" />
              <button type="button" className="sc-btn ghost" onClick={() => onShot(demoPhoto())}>Zdjęcie przykładowe (demo)</button>
            </div>
          )
          : (
            <button
              type="button" className="sc-shutter" aria-label="Zrób zdjęcie"
              onClick={async () => onShot(await toJpeg(video.current))}
            />
          )}
      </div>
    </div>
  );
}

function FilePick({ onPick, label, className = 'sc-btn ghost' }) {
  return (
    <label className={className}>
      <IcImage size={18} /> {label}
      <input
        type="file" accept="image/*" hidden
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) onPick(await toJpeg(f)); e.target.value = ''; }}
      />
    </label>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div className="sc-field-row">
      <span>{label}</span>
      <div className="sc-seg">
        <button type="button" className={value === true ? 'on' : ''} onClick={() => onChange(true)}>Tak</button>
        <button type="button" className={value === false ? 'on' : ''} onClick={() => onChange(false)}>Nie</button>
      </div>
    </div>
  );
}

function NewForm({ form, setForm }) {
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="sc-form">
      <label className="sc-label" htmlFor="sc-place">Gdzie dokładnie jest AED? *</label>
      <textarea
        id="sc-place" rows={3} value={form.placement} onChange={(e) => set('placement')(e.target.value)}
        placeholder="np. parter, przy recepcji, na lewo od wind"
      />
      <div className="sc-group">
        <Toggle label="W budynku" value={form.indoor} onChange={set('indoor')} />
        <div className="sc-field-row">
          <span>Piętro</span>
          <input className="sc-small" value={form.floor} onChange={(e) => set('floor')(e.target.value)} placeholder="0" inputMode="numeric" />
        </div>
        <Toggle label="Dostępny całą dobę" value={form.h24} onChange={set('h24')} />
        <Toggle label="Szafka zamknięta" value={form.locked} onChange={set('locked')} />
      </div>
      <span className="sc-label">Kto może z niego skorzystać?</span>
      <div className="sc-chips">
        {ACCESS_OPTIONS.map(([id, label]) => (
          <button type="button" key={id} className={form.access === id ? 'on' : ''} onClick={() => set('access')(id)}>{label}</button>
        ))}
      </div>
      <label className="sc-label" htmlFor="sc-note">Uwagi (opcjonalnie)</label>
      <input id="sc-note" value={form.note} onChange={(e) => set('note')(e.target.value)} placeholder="np. godziny otwarcia budynku" />
    </div>
  );
}

const EMPTY_FORM = { placement: '', indoor: null, floor: '', h24: null, locked: null, access: null, note: '' };

export default function Scanner({ position, sites, offline, onBack }) {
  const [step, setStep] = useState('intro'); // intro | camera | review | done
  const [photo, setPhoto] = useState(null);
  const [mode, setMode] = useState(null); // 'match' | 'new'
  const [choice, setChoice] = useState('ok');
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const refresh = () => listReports().then(setHistory).catch(() => {});
  useEffect(() => { refresh(); }, [step]);

  // Known AED right here? Search radius grows with GPS inaccuracy.
  const radius = Math.min(60, Math.max(25, position?.accuracy ?? 0));
  const match = useMemo(() => {
    if (!position) return null;
    const { usable, unusable } = rankNearby(sites, position, { maxM: radius });
    return [...usable, ...unusable].sort((a, b) => a.distance - b.distance)[0] ?? null;
  }, [sites, position?.lat, position?.lon, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  const shot = (dataUrl) => {
    setPhoto(dataUrl);
    setMode(match ? 'match' : 'new');
    setChoice('ok');
    setForm(EMPTY_FORM);
    setStep('review');
  };

  const canSend = position && (mode === 'match' || form.placement.trim().length >= 5);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const base = { lat: position.lat, lon: position.lon, accuracy: position.accuracy, photo };
    const payload = mode === 'match'
      ? {
        ...base,
        kind: choice === 'ok' ? 'confirm' : 'issue',
        issue_type: choice === 'ok' ? undefined : choice,
        site_id: match.site.id,
        placement_text: match.site.placement,
      }
      : {
        ...base, kind: 'new', placement: form.placement, indoor: form.indoor, floor: form.floor,
        h24: form.h24, locked: form.locked, access: form.access, note: form.note,
      };
    try {
      setResult(await submitReport(payload, { offline }));
      setStep('done');
    } finally {
      setSending(false);
    }
  };

  if (step === 'camera') return <Camera onShot={shot} onCancel={() => setStep('intro')} />;

  return (
    <div className="sc">
      <header className="sc-head">
        <button type="button" className="mo-icon" onClick={step === 'review' ? () => setStep('intro') : onBack} aria-label="Wróć">
          <IcBack />
        </button>
        <span>Skaner AED</span>
        <span className="mo-icon" />
      </header>

      {step === 'intro' && (
        <div className="sc-body">
          <div className="sc-hero"><IcCamera size={40} /></div>
          <h1 className="sc-h1">Pomóż uzupełnić mapę AED</h1>
          <p className="sc-p">
            Zrób zdjęcie defibrylatora. Jeśli jest już w bazie – potwierdzisz, że jest na miejscu.
            Jeśli go nie ma – zgłosisz nowy. Zgłoszenie sprawdzi zarządca danych (gmina lub właściciel AED).
          </p>
          <button type="button" className="sc-btn primary" onClick={() => setStep('camera')}>
            <IcCamera size={20} /> Zeskanuj AED
          </button>
          <FilePick onPick={shot} label="Wybierz z galerii" />
          {!position && <p className="sc-warn">Czekam na lokalizację – jest potrzebna do zgłoszenia.</p>}

          {history.length > 0 && (
            <>
              <h2 className="mo-group-title">Twoje zgłoszenia</h2>
              <div className="mo-group">
                {history.map((r) => (
                  <div key={r.localId} className="sc-hist">
                    {r.payload.photo ? <img src={r.payload.photo} alt="" /> : <span className="sc-hist-ph" />}
                    <span className="sc-hist-text">
                      <b>{KIND_TEXT[r.payload.kind]}</b>
                      <span>{r.payload.placement ?? r.payload.placement_text ?? 'AED'}</span>
                      <span className="mo-muted">{new Date(r.createdAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </span>
                    <span className={`sc-status ${r.state}`}>{STATUS_TEXT[r.state]}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="sc-body">
          <img className="sc-photo" src={photo} alt="Zdjęcie AED" />
          <div className="sc-loc">
            <IcPin size={16} />
            {position
              ? <span>Twoja lokalizacja ±{Math.round(position.accuracy)} m zostanie dołączona</span>
              : <span>Brak lokalizacji – nie można wysłać</span>}
          </div>

          {mode === 'match' && (
            <>
              <div className="sc-match">
                <span className="sc-match-tag">Ten AED jest już w bazie · {formatDistance(match.distance)}</span>
                <b>{match.site.name ?? 'Defibrylator AED'}</b>
                {match.site.placement && <span>{match.site.placement}</span>}
                <span className={`m-chip ${STATE_UI[match.state].cls}`}>{STATE_UI[match.state].label}</span>
              </div>
              <span className="sc-label">Co widzisz?</span>
              <div className="sc-radio">
                {CONFIRM_OPTIONS.map((o) => (
                  <button type="button" key={o.id} className={choice === o.id ? 'on' : ''} onClick={() => setChoice(o.id)}>
                    <span className="sc-dot" />{o.label}
                  </button>
                ))}
              </div>
              <button type="button" className="sc-link" onClick={() => setMode('new')}>To inny AED – zgłoś jako nowy</button>
            </>
          )}

          {mode === 'new' && (
            <>
              <div className="sc-match new">
                <span className="sc-match-tag">Nowy AED</span>
                <span>W promieniu {Math.round(radius)} m nie ma AED w bazie. Opisz, jak go znaleźć.</span>
              </div>
              <NewForm form={form} setForm={setForm} />
              {match && <button type="button" className="sc-link" onClick={() => setMode('match')}>To jednak AED z bazy</button>}
            </>
          )}

          <button type="button" className="sc-btn primary" disabled={!canSend || sending} onClick={send}>
            {sending ? 'Wysyłam…' : 'Wyślij zgłoszenie'}
          </button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="sc-body sc-done">
          <div className={`sc-done-icon ${result.state}`}><IcCheck size={44} /></div>
          <h1 className="sc-h1">{result.state === 'sent' ? 'Dziękujemy!' : 'Zapisano w telefonie'}</h1>
          <p className="sc-p">
            {result.state === 'sent'
              ? 'Zgłoszenie trafiło do weryfikacji. Po zatwierdzeniu przez zarządcę danych pojawi się na mapie AED i w aplikacji.'
              : 'Nie ma teraz internetu. Wyślemy zgłoszenie automatycznie, gdy telefon połączy się z siecią.'}
          </p>
          {result.serverId && <p className="mo-muted sc-center">Nr zgłoszenia: {result.serverId.slice(0, 8).toUpperCase()}</p>}
          <button type="button" className="sc-btn primary" onClick={() => setStep('intro')}>Gotowe</button>
        </div>
      )}
    </div>
  );
}
