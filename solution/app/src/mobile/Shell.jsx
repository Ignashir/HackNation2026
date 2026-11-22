// Static look-alike of the current citizen app (tabs Dokumenty / Usługi /
// Kod QR / Więcej) with the proposed AED entry points:
//   - a small AED pill in the header, next to notifications (every tab)
//   - "Ratunek" section in Usługi: Najbliższy AED + Skaner AED
// Generic emblem and wording; not the official branding.
import { useState } from 'react';
import { requestCompass } from './compass.js';
import { formatDistance } from './geo.js';
import {
  Emblem, IcAed, IcBell, IcBriefcase, IcCamera, IcCar, IcChevron, IcClock, IcDoc, IcDocs, IcDocsFill,
  IcFolder, IcFolderFill, IcGear, IcGlobeShield, IcHeart, IcHelp, IcIdSearch, IcInfo, IcList, IcMore,
  IcPlay, IcQr, IcSearch, IcShieldUser,
} from './icons.jsx';

export const TABS = [
  { id: 'dokumenty', label: 'Dokumenty', Icon: IcDocs, IconOn: IcDocsFill },
  { id: 'uslugi', label: 'Usługi', Icon: IcFolder, IconOn: IcFolderFill },
  { id: 'qr', label: 'Kod QR', Icon: IcQr },
  { id: 'wiecej', label: 'Więcej', Icon: IcMore },
];

function Header({ target, onOpenFinder }) {
  const open = () => { requestCompass(); onOpenFinder(); }; // iOS: permission only inside a tap
  return (
    <header className="mo-head">
      <Emblem />
      <div className="mo-head-actions">
        <button type="button" className="mo-aed-pill" onClick={open} aria-label="Najbliższy defibrylator AED">
          <IcAed size={17} />
          <span>{!target ? 'AED' : target.distance < 10 ? '<10 m' : formatDistance(target.distance).replace('~', '')}</span>
        </button>
        <button type="button" className="mo-icon" aria-label="Powiadomienia"><IcBell /></button>
      </div>
    </header>
  );
}

const DOCS = [
  { name: 'mDowód', cls: 'blue' },
  { name: 'Legitymacja emeryta-rencisty', cls: 'teal' },
  { name: 'mPrawo jazdy', cls: 'purple' },
  { name: 'Moje pojazdy', cls: 'orange' },
];

function Documents({ toast }) {
  return (
    <>
      <h1 className="mo-title">Dokumenty</h1>
      <div className="mo-links">
        <button type="button" onClick={toast}>Dostosuj</button>
        <button type="button" onClick={toast}>Dodaj</button>
      </div>
      <div className="mo-wallet">
        {DOCS.map((d, i) => (
          <button
            type="button" key={d.name} className={`mo-card ${d.cls} ${i === DOCS.length - 1 ? 'last' : ''}`}
            style={{ zIndex: i }} onClick={toast}
          >
            <span>{d.name}</span>
            <span className="mo-card-badge"><Emblem /></span>
          </button>
        ))}
      </div>
    </>
  );
}

function Row({ icon, color, label, sub, badge, onClick }) {
  return (
    <button type="button" className="mo-row" onClick={onClick}>
      <span className={`mo-row-icon ${color}`}>{icon}</span>
      <span className="mo-row-text">
        <span className="mo-row-label">{label}{badge && <span className="mo-new">{badge}</span>}</span>
        {sub && <span className="mo-row-sub">{sub}</span>}
      </span>
      <IcChevron size={18} className="mo-row-chev" />
    </button>
  );
}

function Services({ toast, onOpenFinder, onOpenScanner, target }) {
  const [q, setQ] = useState('');
  const groups = [
    {
      title: 'Ulubione',
      rows: [
        { icon: <IcHeart />, color: 'red', label: 'Recepty' },
        { icon: <IcShieldUser />, color: 'violet', label: 'Zastrzeż PESEL' },
        { icon: <IcDoc />, color: 'gray', label: 'Złóż wniosek' },
      ],
    },
    {
      title: 'Ratunek',
      rows: [
        {
          icon: <IcAed size={22} bolt="#00a651" />, color: 'green', label: 'Najbliższy AED', badge: 'Nowość',
          sub: target ? `${formatDistance(target.distance)} · działa bez internetu` : 'Prowadzi do defibrylatora, działa bez internetu',
          onClick: () => { requestCompass(); onOpenFinder(); },
        },
        {
          icon: <IcCamera />, color: 'green', label: 'Skaner AED', badge: 'Nowość',
          sub: 'Zgłoś nowy AED lub potwierdź istniejący', onClick: onOpenScanner,
        },
      ],
    },
    {
      title: 'Ochrona danych',
      rows: [
        { icon: <IcGlobeShield />, color: 'violet', label: 'Bezpiecznie w sieci' },
        { icon: <IcIdSearch />, color: 'violet', label: 'Sprawdź PESEL' },
      ],
    },
    {
      title: 'Sprawy urzędowe',
      rows: [
        { icon: <IcBriefcase />, color: 'blue', label: 'Twoje sprawy' },
        { icon: <IcCar />, color: 'orange', label: 'Pojazdy i kierowcy' },
      ],
    },
  ];
  const needle = q.trim().toLowerCase();
  return (
    <>
      <h1 className="mo-title">Usługi</h1>
      <label className="mo-search">
        <IcSearch size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj" />
      </label>
      {groups.map((g) => {
        const rows = g.rows.filter((r) => !needle || `${r.label} ${r.sub ?? ''}`.toLowerCase().includes(needle));
        if (!rows.length) return null;
        return (
          <section key={g.title}>
            <h2 className="mo-group-title">{g.title}</h2>
            <div className="mo-group">
              {rows.map((r) => <Row key={r.label} {...r} onClick={r.onClick ?? toast} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

function QrTab({ toast }) {
  return (
    <>
      <h1 className="mo-title">Kod QR</h1>
      <div className="mo-qr-hero"><IcQr size={64} /></div>
      <p className="mo-muted mo-center">Zeskanuj kod, aby potwierdzić tożsamość lub zalogować się do serwisu.</p>
      <div className="mo-group">
        <Row icon={<IcQr />} color="blue" label="Zeskanuj kod QR" onClick={toast} />
        <Row icon={<IcDocs />} color="blue" label="Pokaż kod QR" onClick={toast} />
      </div>
    </>
  );
}

function More({ toast, openDemo, onOpenScanner }) {
  return (
    <>
      <h1 className="mo-title">Więcej</h1>
      <div className="mo-group">
        <Row icon={<IcClock />} color="gray" label="Historia" onClick={toast} />
        <Row icon={<IcGear />} color="gray" label="Ustawienia" onClick={toast} />
        <Row icon={<IcHelp />} color="gray" label="Pomoc techniczna" onClick={toast} />
        <Row icon={<IcInfo />} color="gray" label="Informacje prawne" onClick={toast} />
      </div>
      <h2 className="mo-group-title">Prototyp AED</h2>
      <div className="mo-group">
        <Row icon={<IcList />} color="green" label="Twoje zgłoszenia AED" onClick={onOpenScanner} />
        <Row icon={<IcPlay />} color="gray" label="Panel prezentacji" sub="Symulacja pozycji, kompasu i braku sieci" onClick={openDemo} />
      </div>
    </>
  );
}

export default function Shell({ tab, setTab, target, onOpenFinder, onOpenScanner, openDemo }) {
  const [msg, setMsg] = useState(null);
  const toast = () => {
    setMsg('Makieta – ta funkcja nie jest częścią prototypu');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => setMsg(null), 1800);
  };
  const props = { toast, target, onOpenFinder, onOpenScanner, openDemo };
  return (
    <div className="mo-app">
      <main className="mo-scroll">
        <Header target={target} onOpenFinder={onOpenFinder} />
        {tab === 'dokumenty' && <Documents {...props} />}
        {tab === 'uslugi' && <Services {...props} />}
        {tab === 'qr' && <QrTab {...props} />}
        {tab === 'wiecej' && <More {...props} />}
      </main>
      {msg && <div className="mo-toast">{msg}</div>}
      <nav className="mo-tabbar">
        {TABS.map(({ id, label, Icon, IconOn }) => (
          <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {tab === id && IconOn ? <IconOn /> : <Icon />}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
