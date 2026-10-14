import { useState, useEffect } from 'react';
import { MapPin, Navigation, ExternalLink, Radio, Crosshair } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { lastSeen, timeAgo, useNow } from '../../lib/deviceStatus';

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Zoom limits: the map can't be zoomed out past the area around the pin
const START_ZOOM = 16;
const MIN_ZOOM = 14;          // farthest zoom-out (about 2-3 km across)
const MAX_ZOOM = 19;          // closest zoom-in (street level)
const BOUNDS_DEGREES = 0.03;  // can't pan more than ~3 km away from the pin

function boundsAround(lat: number, lng: number) {
  return L.latLngBounds(
    [lat - BOUNDS_DEGREES, lng - BOUNDS_DEGREES],
    [lat + BOUNDS_DEGREES, lng + BOUNDS_DEGREES]
  );
}

/** Keeps the map on the pin when the location changes, without resetting the zoom. */
function FollowPin({ lat, lng, recenterToken }: { lat: number; lng: number; recenterToken: number }) {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(boundsAround(lat, lng));
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  useEffect(() => {
    if (recenterToken > 0) map.setView([lat, lng], START_ZOOM, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);
  return null;
}

interface LocationMapProps {
  deviceId: string;
}

export function LocationMap({ deviceId }: LocationMapProps) {
  const [device, setDevice] = useState<any>(null);
  const [recenterToken, setRecenterToken] = useState(0);
  const now = useNow(10000);

  useEffect(() => {
    const unsub = onValue(ref(db, `devices/${deviceId}`), (snap) => setDevice(snap.val()));
    return () => unsub();
  }, [deviceId]);

  const lat = Number(device?.location?.lat);
  const lng = Number(device?.location?.lng);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const gpsFix = device?.gpsFix === true;
  const updated = lastSeen(device);
  const address = typeof device?.location?.address === 'string' ? device.location.address : '';

  if (!hasLocation) {
    return (
      <div className="bg-card rounded-2xl border border-border shadow-sm p-10 text-center">
        <div className="inline-flex p-4 bg-muted rounded-2xl mb-4">
          <MapPin className="size-8 text-muted-foreground" />
        </div>
        <p className="font-medium text-foreground">No location yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          The map appears once the central hub gets its first GPS fix (outdoors works best).
        </p>
      </div>
    );
  }

  const center: [number, number] = [lat, lng];

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
              <MapPin className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-semibold text-foreground">Live Tracking</h2>
              <p className="text-xs md:text-sm text-muted-foreground flex items-center gap-2">
                <Radio className={`size-3 shrink-0 ${gpsFix ? 'text-emerald-500 animate-pulse' : 'text-warning'}`} />
                <span className="truncate">
                  {gpsFix ? 'GPS fix' : 'No GPS fix now - last known position'} • Updated {timeAgo(updated, now)}
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={() => setRecenterToken((t) => t + 1)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            <Crosshair className="size-4" />
            Re-center
          </button>
        </div>

        <div className="relative h-[60vh] min-h-[320px] max-h-[520px] w-full z-0">
          <MapContainer
            center={center}
            zoom={START_ZOOM}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            maxBounds={boundsAround(lat, lng)}
            maxBoundsViscosity={1}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={MAX_ZOOM}
            />
            <Marker position={center}>
              <Popup>
                <strong>{gpsFix ? 'Current location' : 'Last known location'}</strong>
                {address && (<><br />{address}</>)}
              </Popup>
            </Marker>
            <FollowPin lat={lat} lng={lng} recenterToken={recenterToken} />
          </MapContainer>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
            <a
              href={`https://maps.google.com/?q=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-foreground text-background px-5 py-3 rounded-full text-sm font-medium shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 whitespace-nowrap"
            >
              <Navigation className="size-4" />
              Open in Google Maps
              <ExternalLink className="size-3 opacity-70" />
            </a>
          </div>
        </div>

        <div className="p-4 bg-muted/30 border-t border-border flex items-start gap-3">
          <MapPin className="size-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0">
            {address && <p className="text-sm font-medium text-foreground">{address}</p>}
            <p className="text-xs text-muted-foreground mt-1">Coordinates: {lat.toFixed(6)}, {lng.toFixed(6)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
