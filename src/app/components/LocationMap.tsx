import { validDate } from '../../lib/time';
import { useState, useEffect } from 'react';
import { MapPin, Navigation, ExternalLink, Radio, History } from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface LocationMapProps {
  deviceId: string;
}

export function LocationMap({ deviceId }: LocationMapProps) {
  const [location, setLocation] = useState({
    lat: 14.6042,
    lng: 120.9822,
    address: 'Fetching location...',
  });
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [history, setHistory] = useState<{lat: number, lng: number}[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const locRef = ref(db, `devices/${deviceId}/location`);
    const timeRef = ref(db, `devices/${deviceId}/lastUpdate`);
    const historyRef = ref(db, `locationHistory/${deviceId}`);
    
    const unsubLoc = onValue(locRef, (snap) => {
      if (snap.val()) setLocation(snap.val());
    });
    const unsubTime = onValue(timeRef, (snap) => {
      if (snap.val()) setLastUpdate(snap.val());
    });
    const unsubHistory = onValue(historyRef, (snap) => {
      if (snap.val()) {
        const histData = snap.val();
        // Extract array of coordinates
        const points = Object.values(histData).map((p: any) => ({ lat: p.lat, lng: p.lng }));
        setHistory(points);
      }
    });
    
    return () => {
      unsubLoc();
      unsubTime();
      unsubHistory();
    };
  }, [deviceId]);

  const mapCenter: [number, number] = [location.lat, location.lng];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <MapPin className="size-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Live Tracking</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Radio className="size-3 text-emerald-500 animate-pulse" />
                GPS Active • Last update: {validDate(lastUpdate)?.toLocaleTimeString() ?? 'Just now'}
              </p>
            </div>
          </div>
          
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showHistory ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            <History className="size-4" />
            {showHistory ? 'Hide Breadcrumbs' : 'Show Breadcrumbs'}
          </button>
        </div>
        
        <div className="relative h-[500px] w-full z-0">
          <MapContainer center={mapCenter} zoom={15} className="h-full w-full" key={`${location.lat}-${location.lng}`}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={mapCenter}>
              <Popup>
                <strong>Current Location</strong><br/>
                {location.address}
              </Popup>
            </Marker>
            {showHistory && history.length > 1 && (
              <Polyline positions={history} pathOptions={{ color: 'hsl(var(--primary))', weight: 4, dashArray: '5, 10' }} />
            )}
          </MapContainer>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
            <a
              href={`https://maps.google.com/?q=${location.lat},${location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              <Navigation className="size-4" />
              Open in Google Maps
              <ExternalLink className="size-3 opacity-70" />
            </a>
          </div>
        </div>
        
        <div className="p-4 bg-muted/30 border-t border-border flex items-start gap-3">
          <MapPin className="size-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">{location.address}</p>
            <p className="text-xs text-muted-foreground mt-1">Coordinates: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
