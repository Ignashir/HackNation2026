import { useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import { STATE } from '../labels.js';

// Poland, with some margin so edge pins are not glued to the frame.
const POLAND_BOUNDS = [[48.9, 14.0], [54.9, 24.2]];
const MAX_BOUNDS = [[47.0, 11.0], [56.5, 27.5]];

// Clustering: groups split as you zoom in; from CLUSTER_MAX_ZOOM + 1 every
// AED is its own pin. App.jsx zooms to SITE_ZOOM when a site is selected.
const CLUSTER_RADIUS_PX = 80;
const CLUSTER_MAX_ZOOM = 15;
export const SITE_ZOOM = CLUSTER_MAX_ZOOM + 1;
const STATE_KEYS = Object.keys(STATE); // open, closed, unknown, down

// --- icons ------------------------------------------------------------
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

const PIN_ICONS = {};
STATE_KEYS.forEach((state) => {
  PIN_ICONS[state] = pinIcon(STATE[state].color, false);
  PIN_ICONS[`${state}:selected`] = pinIcon(STATE[state].color, true);
});

function formatCount(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

// Bubble with the count; the ring shows the share of each pin state inside.
const clusterIconCache = new Map();
function clusterIcon(props) {
  const n = props.point_count;
  const size = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56;
  let acc = 0;
  const stops = STATE_KEYS.filter((k) => props[k] > 0).map((k) => {
    const from = acc;
    acc += Math.round((props[k] / n) * 100);
    return `${STATE[k].color} ${from}% ${acc}%`;
  });
  const ring = `conic-gradient(${stops.join(',')}${acc < 100 ? `, ${STATE.unknown.color} ${acc}% 100%` : ''})`;
  const label = formatCount(n);
  const key = `${size}|${ring}|${label}`;
  if (!clusterIconCache.has(key)) {
    clusterIconCache.set(key, L.divIcon({
      className: 'aed-cluster',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<span class="aed-cluster-ring" style="background:${ring}"></span>
             <span class="aed-cluster-count" style="font-size:${size < 40 ? 12 : 13}px">${label}</span>`,
    }));
  }
  return clusterIconCache.get(key);
}

// --- clustered AED layer ---------------------------------------------
function ClusteredSites({ sites, selectedId, onSelect }) {
  const map = useMap();

  const index = useMemo(() => {
    const sc = new Supercluster({
      radius: CLUSTER_RADIUS_PX,
      maxZoom: CLUSTER_MAX_ZOOM,
      map: (p) => ({ [p.state]: 1 }),
      reduce: (acc, p) => { STATE_KEYS.forEach((k) => { acc[k] = (acc[k] ?? 0) + (p[k] ?? 0); }); },
    });
    sc.load(sites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: s,
    })));
    return sc;
  }, [sites]);

  // Recompute what is visible only when the map settles (pan or zoom end).
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }));
  useMapEvents({
    moveend: () => setView({ bounds: map.getBounds(), zoom: map.getZoom() }),
  });

  const items = useMemo(() => {
    const b = view.bounds.pad(0.1); // small margin so short pans do not show empty edges
    return index.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], Math.round(view.zoom));
  }, [index, view]);

  const selected = selectedId ? sites.find((s) => s.site_id === selectedId) : null;
  const selectedVisible = items.some((f) => !f.properties.cluster && f.properties.site_id === selectedId);

  const renderPin = (site, isSelected) => (
    <Marker
      key={`p:${site.site_id}`}
      position={[site.lat, site.lon]}
      icon={PIN_ICONS[isSelected ? `${site.state}:selected` : site.state]}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={{ click: () => onSelect(site) }}
      title={site.name}
    >
      <Tooltip direction="top">
        <strong>{site.name}</strong>
        <br />
        {STATE[site.state].label}
      </Tooltip>
    </Marker>
  );

  return (
    <>
      {items.map((f) => {
        const p = f.properties;
        if (!p.cluster) return renderPin(p, p.site_id === selectedId);
        const [lon, lat] = f.geometry.coordinates;
        return (
          <Marker
            key={`c:${p.cluster_id}`}
            position={[lat, lon]}
            icon={clusterIcon(p)}
            title={`${p.point_count} AED – kliknij, aby przybliżyć`}
            eventHandlers={{
              click: () => {
                const zoom = Math.min(index.getClusterExpansionZoom(p.cluster_id), SITE_ZOOM);
                map.flyTo([lat, lon], zoom, { duration: 0.6 });
              },
            }}
          />
        );
      })}
      {/* Keep the selected AED visible even while it sits inside a group. */}
      {selected && !selectedVisible && renderPin(selected, true)}
    </>
  );
}

// --- my location -------------------------------------------------------
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

// --- map plumbing ------------------------------------------------------
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
        <ClusteredSites sites={sites} selectedId={selectedId} onSelect={onSelect} />
        {userLocation && <UserLocation position={userLocation} />}
        <ResizeWatcher />
        <FocusController focus={focus} />
      </MapContainer>

      <LocateButton status={geoStatus} onLocate={onLocate} />

      <div className="legend" aria-label="Legenda">
        {Object.values(STATE).map(({ label, color }) => (
          <div key={label}><i style={{ background: color }} />{label}</div>
        ))}
        <div className="legend-cluster"><i />grupa AED – kliknij, aby przybliżyć</div>
      </div>
    </div>
  );
}
