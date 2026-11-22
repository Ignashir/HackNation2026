// Concept: "Najbliższy AED" as a feature of a citizen app (mObywatel-style).
// Home screen mock -> "Find My"-style finder guided by an offline AED cache.
import { useEffect, useMemo, useRef, useState } from 'react';
import useGeolocation from '../useGeolocation.js';
import { useCompass } from './compass.js';
import useOfflineAeds from './useOfflineAeds.js';
import { rankNearby } from './aedRules.js';
import { bearingDeg, distanceM, offsetPoint } from './geo.js';
import { loadDemo, saveDemo } from './demo.js';
import { flushOutbox } from './reports.js';
import Shell, { TABS } from './Shell.jsx';
import Finder from './Finder.jsx';
import Scanner from './Scanner.jsx';
import DemoPanel from './DemoPanel.jsx';

const WALK_TICK_MS = 250;
const WALK_MPS = 1.4;

// Screens: the four tabs, plus #aed (finder) and #skaner (scanner).
const SCREENS = new Set([...TABS.map((t) => t.id), 'aed', 'skaner']);
function useHashScreen() {
  const read = () => {
    const h = window.location.hash.slice(1);
    return SCREENS.has(h) ? h : 'dokumenty';
  };
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    const on = () => setScreen(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (s) => { window.location.hash = s === 'dokumenty' ? '' : s; };
  return [screen, go];
}

export default function MobileApp() {
  const [screen, go] = useHashScreen();
  const [demo, setDemoState] = useState(loadDemo);
  const [demoOpen, setDemoOpen] = useState(false);
  const setDemo = (patch) => setDemoState((d) => {
    const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
    saveDemo(next);
    return next;
  });

  const geo = useGeolocation();
  const compass = useCompass();

  const position = demo.simPos
    ? { lat: demo.lat, lon: demo.lon, accuracy: 8, heading: null }
    : geo.position;
  const heading = demo.simHeading ? demo.heading : (compass.heading ?? position?.heading ?? null);

  const aeds = useOfflineAeds(position, demo.offline);

  // Reports made without signal go out as soon as we are online again.
  useEffect(() => {
    const flush = () => flushOutbox({ offline: demo.offline }).catch(() => {});
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [demo.offline]);

  // Where "back" from the finder / scanner returns to.
  const lastTab = useRef('dokumenty');
  if (TABS.some((t) => t.id === screen)) lastTab.current = screen;

  // Pick the target: the nearest usable AED, unless the user chose another.
  const [chosenId, setChosenId] = useState(null);
  const ranked = useMemo(
    () => (position ? rankNearby(aeds.sites, position) : { usable: [], unusable: [] }),
    [aeds.sites, position?.lat, position?.lon], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Hysteresis: GPS jitter must not flip the arrow between two similar AEDs,
  // so the previous automatic pick stays unless another is clearly closer.
  const autoRef = useRef(null);
  const best = ranked.usable[0] ?? null;
  const prevAuto = ranked.usable.find((c) => c.site.id === autoRef.current);
  const auto = prevAuto && best && prevAuto.distance <= best.distance + Math.max(30, 0.2 * best.distance)
    ? prevAuto : best;
  autoRef.current = auto?.site.id ?? null;
  const target = ranked.usable.find((c) => c.site.id === chosenId) ?? auto;

  // Demo: simulated walk towards the target, with a gently wandering path and,
  // if the compass is simulated, a phone heading that sways around the route.
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!demo.walking || !demo.simPos) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => {
      const t = targetRef.current;
      if (!t) return;
      setDemo((d) => {
        const here = { lat: d.lat, lon: d.lon };
        const left = distanceM(here, t.site);
        if (left < 3) return { walking: false };
        const sec = (Date.now() - t0) / 1000;
        const dir = bearingDeg(here, t.site) + (left > 25 ? 15 * Math.sin(sec / 4) : 0);
        const step = Math.min(left, WALK_MPS * d.speed * (WALK_TICK_MS / 1000));
        const next = offsetPoint(here, dir, step);
        return {
          lat: next.lat, lon: next.lon,
          ...(d.simHeading ? { heading: (dir + 28 * Math.sin(sec / 1.7) + 360) % 360 } : {}),
        };
      });
    }, WALK_TICK_MS);
    return () => clearInterval(id);
  }, [demo.walking, demo.simPos]); // eslint-disable-line react-hooks/exhaustive-deps

  const shared = {
    position, geoStatus: demo.simPos ? 'ok' : geo.status, heading, compass,
    simHeading: demo.simHeading, aeds, offline: demo.offline, ranked, target,
    chooseTarget: setChosenId, openDemo: () => setDemoOpen(true),
  };

  return (
    <div className="m-shell">
      {screen === 'aed' && <Finder {...shared} onBack={() => go(lastTab.current)} />}
      {screen === 'skaner' && (
        <Scanner position={position} sites={aeds.sites} offline={demo.offline} onBack={() => go(lastTab.current)} />
      )}
      {screen !== 'aed' && screen !== 'skaner' && (
        <Shell
          tab={screen} setTab={go} target={target}
          onOpenFinder={() => go('aed')} onOpenScanner={() => go('skaner')} openDemo={() => setDemoOpen(true)}
        />
      )}
      {demoOpen && (
        <DemoPanel
          demo={demo} setDemo={setDemo} onClose={() => setDemoOpen(false)}
          realPosition={geo.position} position={position} target={target} aeds={aeds}
          compass={compass} chooseTarget={setChosenId}
        />
      )}
    </div>
  );
}
