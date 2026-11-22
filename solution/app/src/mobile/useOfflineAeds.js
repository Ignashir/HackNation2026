import { useCallback, useEffect, useRef, useState } from 'react';
import { cellOf, loadAround, syncAround } from './aedCache.js';

const RESYNC_MS = 10 * 60_000; // re-check staleness while the app stays open

// Keeps the 3x3 cells around `position` on the phone and exposes what is stored.
//   data: { sites, cells: [{cell, fetchedAt, count}], storedCells, loaded }
//   sync: { state: 'idle'|'syncing'|'done'|'error', at, failed }
export default function useOfflineAeds(position, offline) {
  const [data, setData] = useState({ sites: [], cells: [], storedCells: 0, loaded: false });
  const [sync, setSync] = useState({ state: 'idle', at: null, failed: 0 });
  const posRef = useRef(position);
  posRef.current = position;
  const cell = position ? cellOf(position) : null;

  const reload = useCallback(async () => {
    if (!posRef.current) return;
    try {
      setData({ ...(await loadAround(posRef.current)), loaded: true });
    } catch {
      setData((d) => ({ ...d, loaded: true })); // IndexedDB blocked (private mode)
    }
  }, []);

  const runSync = useCallback(async () => {
    if (!posRef.current) return;
    setSync((s) => ({ ...s, state: 'syncing' }));
    try {
      const { failed } = await syncAround(posRef.current, { offline });
      setSync({ state: failed ? 'error' : 'done', at: Date.now(), failed });
    } catch {
      setSync({ state: 'error', at: Date.now(), failed: 1 });
    }
    await reload();
  }, [offline, reload]);

  // New cell (first fix, or the user travelled): show what we have, then refresh.
  useEffect(() => {
    if (!cell) return undefined;
    reload().then(runSync);
    const id = setInterval(runSync, RESYNC_MS);
    return () => clearInterval(id);
  }, [cell, reload, runSync]);

  return { ...data, sync, reload, resync: runSync };
}
