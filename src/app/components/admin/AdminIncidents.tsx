import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue, update } from "../../../lib/db";
import { query, orderByChild } from "firebase/database";
import { SkeletonTable } from "../ui/skeleton";
import { familyDeviceId, personName } from "./adminData";
import { resolveEventTime } from "../../../lib/time";

// The device stores location as { lat, lng } (or latitude/longitude); older data may be plain text.
function formatLocation(loc: any): { text: string; mapUrl: string | null } {
  if (loc === undefined || loc === null || loc === '') return { text: "Unknown", mapUrl: null };
  if (typeof loc === 'string' || typeof loc === 'number') return { text: String(loc), mapUrl: null };
  if (typeof loc === 'object') {
    const lat = Number(loc.lat ?? loc.latitude);
    const lng = Number(loc.lng ?? loc.lon ?? loc.longitude);
    if (loc.address) return { text: String(loc.address), mapUrl: Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps?q=${lat},${lng}` : null };
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (lat === 0 && lng === 0) return { text: "No GPS fix", mapUrl: null };
      return { text: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, mapUrl: `https://www.google.com/maps?q=${lat},${lng}` };
    }
  }
  return { text: "Unknown", mapUrl: null };
}

function toText(v: any, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'object') return Object.values(v).filter(x => typeof x === 'string' || typeof x === 'number').join(', ') || fallback;
  return String(v);
}
import { Search, Filter, AlertTriangle, CheckCircle, Clock, X, MapPin } from "lucide-react";

interface Incident {
  id: string;
  deviceId: string;
  patientName: string;
  type: string;
  time: string;
  timestamp: Date;
  status: string;
  contactNotified: string;
  location: string;
  mapUrl: string | null;
  typeColor: string;
  icon: any;
}

export function AdminIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  useEffect(() => {
    const eventsRef = ref(db, 'events');
    const familiesRef = ref(db, 'families');
    
    let currentEvents: any = {};
    let currentFamilies: any = {};
    
    const updateIncidentsList = () => {
      const parsedIncidents: Incident[] = [];
      
      Object.keys(currentEvents).forEach(deviceId => {
        const deviceEvents = currentEvents[deviceId];
        if (!deviceEvents || typeof deviceEvents !== 'object') return;
        const family = Object.values(currentFamilies).find((f: any) => familyDeviceId(f) === deviceId) as any;
        const patientName = family ? personName(family) : "Unassigned device";
        
        Object.keys(deviceEvents).forEach(eventId => {
          const ev = deviceEvents[eventId];
          if (!ev || typeof ev !== 'object') return;
          
          let typeColor = "bg-primary/10 text-primary";
          let typeText = "Event";
          let icon = <CheckCircle className="size-4" />;
          
          if (ev.status === 'pending' || ev.status === 'unconfirmed') {
            typeColor = "bg-destructive/10 text-destructive";
            typeText = "Fall detected (Unconfirmed)";
            icon = <AlertTriangle className="size-4" />;
          } else if (ev.status === 'emergency') {
            typeColor = "bg-warning/10 text-warning";
            typeText = "SOS Button Pressed";
            icon = <Clock className="size-4" />;
          } else if (ev.status === 'confirmed') {
            typeColor = "bg-destructive/10 text-destructive";
            typeText = "Fall Confirmed";
            icon = <AlertTriangle className="size-4" />;
          } else if (ev.status === 'resolved') {
            typeColor = "bg-success/10 text-success";
            typeText = "Resolved";
            icon = <CheckCircle className="size-4" />;
          } else if (ev.status === 'cancelled') {
            typeColor = "bg-muted text-muted-foreground";
            typeText = "Cancelled";
            icon = <AlertTriangle className="size-4" />;
          }

          // Device writes millis() uptime as timestamp -> real time comes from the Firebase key
          const when = resolveEventTime(eventId, ev.timestamp);
          const loc = formatLocation(ev.location);

          parsedIncidents.push({
            id: eventId,
            deviceId,
            patientName,
            type: typeText,
            time: when.toLocaleString(),
            timestamp: when,
            status: ev.status,
            contactNotified: toText(ev.contactNotified, "None"),
            location: loc.text,
            mapUrl: loc.mapUrl,
            typeColor,
            icon
          });
        });
      });
      
      parsedIncidents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      setIncidents(parsedIncidents);
      setLoading(false);
    };

    const unsubEvents = onValue(eventsRef, (snapshot) => {
      currentEvents = snapshot.val() || {};
      updateIncidentsList();
    }, (err) => { console.error('Failed to load events', err); setLoading(false); });

    const unsubFamilies = onValue(familiesRef, (snapshot) => {
      currentFamilies = snapshot.val() || {};
      updateIncidentsList();
    }, (err) => { console.error('Failed to load families', err); });

    return () => {
      unsubEvents();
      unsubFamilies();
    };
  }, []);

  const filteredIncidents = incidents.filter(i => {
    const matchesSearch = (i.patientName || '').toLowerCase().includes(search.toLowerCase()) || 
                          (i.deviceId || '').toLowerCase().includes(search.toLowerCase()) ||
                          (i.type || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || i.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <AdminLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>
            <p className="text-sm text-muted-foreground mt-1">System-wide log of all falls and emergencies</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search person or type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary w-full md:w-64"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary appearance-none cursor-pointer text-foreground h-[38px]"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="unconfirmed">Unconfirmed</option>
                <option value="emergency">Emergency</option>
                <option value="confirmed">Confirmed</option>
                <option value="resolved">Resolved</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Event Type</th>
                  <th className="font-medium px-6 py-4">Time</th>
                  <th className="font-medium px-6 py-4">Person / Device</th>
                  <th className="font-medium px-6 py-4">Location</th>
                  <th className="font-medium px-6 py-4">Alert Delivery</th>
                  <th className="font-medium px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredIncidents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      {search ? "No incidents matched your search" : "No incidents recorded"}
                    </td>
                  </tr>
                ) : (
                  filteredIncidents.map((incident) => (
                    <tr key={`${incident.deviceId}-${incident.id}`} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg ${incident.typeColor} font-medium text-xs`}>
                          {incident.icon}
                          {incident.type}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-foreground">{incident.time}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-foreground font-medium">{incident.patientName}</span>
                          <span className="text-muted-foreground font-mono text-xs">{incident.deviceId}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs truncate max-w-[200px]" title={incident.location}>
                        {incident.mapUrl ? (
                          <a href={incident.mapUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{incident.location}</a>
                        ) : incident.location}
                      </td>
                      <td className="px-6 py-4 text-foreground text-xs">
                        {incident.contactNotified}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setSelectedIncident(incident)}
                          className="text-primary hover:text-primary/80 font-medium text-sm transition-colors"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* Incident Details Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`inline-flex items-center justify-center size-10 rounded-xl ${selectedIncident.typeColor}`}>
                  {selectedIncident.icon}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Incident Details</h3>
                  <p className="text-xs text-muted-foreground font-mono">{selectedIncident.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedIncident(null)}
                className="p-2 hover:bg-muted text-muted-foreground rounded-xl transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Patient</p>
                  <p className="text-sm font-medium text-foreground">{selectedIncident.patientName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Device Serial</p>
                  <p className="text-sm font-mono text-foreground">{selectedIncident.deviceId}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Time</p>
                  <p className="text-sm text-foreground">{selectedIncident.time}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</p>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${selectedIncident.typeColor} font-medium text-xs`}>
                    {selectedIncident.type}
                  </span>
                </div>
              </div>

              <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Location</p>
                    <p className="text-sm text-foreground">{selectedIncident.location}</p>
                    {selectedIncident.mapUrl && (
                      <a href={selectedIncident.mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Open in Google Maps</a>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Alert Delivery Log</h4>
                <div className="p-3 border border-border rounded-xl bg-card text-sm">
                  {selectedIncident.contactNotified !== "None" && selectedIncident.contactNotified !== "None (False Alarm)" ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Sent to <strong className="text-foreground">{selectedIncident.contactNotified}</strong></span>
                      <span className="text-success text-xs font-medium flex items-center gap-1">
                        <CheckCircle className="size-3" /> Delivered
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">No alerts delivered ({selectedIncident.contactNotified})</span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border bg-muted/10 flex justify-end">
              <button 
                onClick={() => setSelectedIncident(null)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
