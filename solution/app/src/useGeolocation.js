import { useEffect, useState } from 'react';

// Continuously tracks the browser position.
//   status: 'locating' | 'ok' | 'denied' | 'unavailable' | 'unsupported'
//   position: { lat, lon, accuracy (m), heading (deg|null) } once known
export default function useGeolocation() {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [state, setState] = useState({
    status: supported ? 'locating' : 'unsupported',
    position: null,
  });

  useEffect(() => {
    if (!supported) return undefined;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => setState({
        status: 'ok',
        position: {
          lat: coords.latitude,
          lon: coords.longitude,
          accuracy: coords.accuracy,
          heading: Number.isFinite(coords.heading) ? coords.heading : null,
        },
      }),
      (err) => setState((prev) => ({
        // Keep the last fix on a transient error (timeout / signal loss).
        position: err.code === err.PERMISSION_DENIED ? null : prev.position,
        status: err.code === err.PERMISSION_DENIED ? 'denied'
          : prev.position ? 'ok' : 'unavailable',
      })),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [supported]);

  return state;
}

export const GEO_MESSAGE = {
  locating: 'Ustalam Twoją lokalizację…',
  denied: 'Brak zgody na lokalizację. Włącz ją w ustawieniach przeglądarki.',
  unavailable: 'Lokalizacja jest teraz niedostępna.',
  unsupported: 'Ta przeglądarka nie udostępnia geolokalizacji.',
};
