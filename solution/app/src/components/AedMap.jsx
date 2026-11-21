import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { STATE } from '../labels.js';

// Poland, with some margin so edge pins are not glued to the frame.
const POLAND_BOUNDS = [[48.9, 14.0], [54.9, 24.2]];
const MAX_BOUNDS = [[47.0, 11.0], [56.5, 27.5]];

function pinIcon(color, selected) {
  const w = selected ? 36 : 28;
  const h = Math.round(w * 1.43);
  return L.divIcon({
    className: 'aed-pin',
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h + 6],
    html: `
      <svg viewBox="0 0 28 40" width="${w}" height="${h}" aria-hidden="true">
        <path d="M14 1C6.8 1 1 6.8 1 14c0 9.8 13 25 13 25s13-15.2 13-25C27 6.8 21.2 1 14 1z"
              fill="${color}" stroke="#fff" stroke-width="2"/>
        <path d="M15.6 6.5 9 16.2h4.6l-1.4 7.6 6.6-10h-4.6z" fill="#fff"/>
      </svg>`,
  });
}

function userIcon(heading) {
  const cone = heading == null ? ''
    : `<span class="me-heading" style="transform: rotate(${heading}deg)"></span>`;
  return L.divIcon({
    className: 'me-marker',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `${cone}<span class="me-pulse"></span><span class="me-dot"></span>`,
  });
}

function UserLocation({ position }) {
  // Rebuild the icon only when the heading changes, not on every fix.
  const heading = position.heading == null ? null : Math.round(position.heading / 5) * 5;
  const icon = useMemo(() => userIcon(heading), [heading]);
  const center = [position.lat, position.lon];
  return (
    <>
      <Circle
        center={center}
        radius={position.accuracy}
        interactive={false}
        pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.4, fillColor: '#2563eb', fillOpacity: 0.12 }}
      />
      <Marker position={center} icon={icon} zIndexOffset={2000} keyboard={false}>
        <Tooltip direction="top" offset={[0, -10]}>
          Tu jesteś (±{Math.round(position.accuracy)} m)
        </Tooltip>
      </Marker>
    </>
  );
}

const LOCATE_TITLE = {
  ok: 'Pokaż moją lokalizację',
  locating: 'Ustalam lokalizację…',
  denied: 'Brak zgody na lokalizację',
  unavailable: 'Lokalizacja niedostępna',
  unsupported: 'Geolokalizacja nieobsługiwana',
};

function LocateButton({ status, onLocate }) {
  return (
    <div className="leaflet-bar locate-control">
      <a
        href="#"
        role="button"
        title={LOCATE_TITLE[status]}
        aria-label={LOCATE_TITLE[status]}
        className={`locate-${status}`}
        onClick={(e) => { e.preventDefault(); onLocate(); }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </a>
    </div>
  );
}

function FocusController({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const zoom = focus.zoom ?? 14;
    let target = L.latLng(focus.lat, focus.lon);
    // On phones the card is a bottom sheet covering ~62% of the map:
    // shift the view so the pin sits in the visible top part.
    if (window.matchMedia('(max-width: 768px)').matches) {
      const shift = map.getContainer().clientHeight * 0.31;
      target = map.unproject(map.project(target, zoom).add([0, shift]), zoom);
    }
    map.flyTo(target, zoom, { duration: 0.8 });
  }, [focus, map]);
  return null;
}

// Leaflet caches the container size; tell it when the card opens/closes.
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function AedMap({ sites, selectedId, onSelect, focus, userLocation, geoStatus, onLocate }) {
  const icons = useMemo(() => {
    const out = {};
    Object.entries(STATE).forEach(([state, { color }]) => {
      out[state] = pinIcon(color, false);
      out[`${state}:selected`] = pinIcon(color, true);
    });
    return out;
  }, []);

  return (
    <div className="map-wrap">
      <MapContainer
        bounds={POLAND_BOUNDS}
        maxBounds={MAX_BOUNDS}
        maxBoundsViscosity={0.8}
        minZoom={5}
        className="map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {sites.map((site) => {
          const selected = site.site_id === selectedId;
          return (
            <Marker
              key={site.site_id}
              position={[site.lat, site.lon]}
              icon={icons[selected ? `${site.state}:selected` : site.state]}
              zIndexOffset={selected ? 1000 : 0}
              eventHandlers={{ click: () => onSelect(site) }}
              title={site.name}
            >
              <Tooltip direction="top">
                <strong>{site.name}</strong>
                <br />
                {site.city} · {STATE[site.state].label}
              </Tooltip>
            </Marker>
          );
        })}
        {userLocation && <UserLocation position={userLocation} />}
        <ResizeWatcher />
        <FocusController focus={focus} />
      </MapContainer>

      <LocateButton status={geoStatus} onLocate={onLocate} />

      <div className="legend" aria-label="Legenda">
        {Object.values(STATE).map(({ label, color }) => (
          <div key={label}><i style={{ background: color }} />{label}</div>
        ))}
      </div>
    </div>
  );
}
