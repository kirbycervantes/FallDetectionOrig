
import { useState, useEffect } from 'react';
import {
  Shield,
  Clock,
  Search,
  MapPin,
  ExternalLink,
  Filter,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Phone,
  Download
} from 'lucide-react';
import { db, ref, onValue } from '../../lib/db';
import { query, orderByChild } from 'firebase/database';
import { SkeletonList } from './ui/skeleton';

interface FallEvent {
  id: string;
  timestamp: Date;
  status: 'resolved' | 'pending' | 'emergency' | 'confirmed' | 'cancelled';
  location: string | { lat?: number; lng?: number } | null;
  responseTime?: string;
  contactNotified?: string;
}

interface FallHistoryProps {
  deviceId: string;
}

// Convert Firebase location data into text React can safely display.
function formatEventLocation(location: unknown): string {
  if (location == null) {
    return 'Location unavailable';
  }

  if (typeof location === 'string') {
    return location;
  }

  if (typeof location === 'object') {
    const coordinates = location as {
      lat?: unknown;
      lng?: unknown;
    };

    if (
      typeof coordinates.lat === 'number' &&
      typeof coordinates.lng === 'number'
    ) {
      return `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`;
    }
  }

  return 'Location unavailable';
}

export function FallHistory({ deviceId }: FallHistoryProps) {
  const [fallEvents, setFallEvents] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const eventsRef = ref(db, `events/${deviceId}`);

    const unsubscribe = onValue(
      eventsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const eventsData = snapshot.val();

          const parsedEvents: FallEvent[] = Object.keys(eventsData)
            .map((key) => {
              const eventData = eventsData[key];

              return {
                id: key,
                timestamp: new Date(eventData.timestamp),
                status: eventData.status || 'pending',
                location: eventData.location ?? null,
                responseTime: eventData.responseTime,
                contactNotified: eventData.contactNotified
              };
            })
            .sort(
              (a, b) =>
                b.timestamp.getTime() - a.timestamp.getTime()
            );

          setFallEvents(parsedEvents);
        } else {
          setFallEvents([]);
        }

        setLoading(false);
      },
      (error) => {
        console.error('Error loading fall history:', error);
        setFallEvents([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [deviceId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">
            Incident History
          </h2>
          <p className="text-sm text-muted-foreground">
            Historical log of all recorded events
          </p>
        </div>

        <SkeletonList items={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">
            Incident History
          </h2>
          <p className="text-sm text-muted-foreground">
            Comprehensive fall detection records
          </p>
        </div>

        <button
          onClick={() => {
            const csvRows = [
              [
                'ID',
                'Timestamp',
                'Status',
                'Location',
                'Response Time',
                'Contact Notified'
              ],
              ...fallEvents.map((event) => [
                event.id,
                event.timestamp.toISOString(),
                event.status,
                formatEventLocation(event.location),
                event.responseTime || '',
                event.contactNotified || ''
              ])
            ];

            const escapeCsv = (value: string) =>
              `"${value.replace(/"/g, '""')}"`;

            const csvContent =
              '\uFEFF' +
              csvRows.map((row) => row.map((value) =>
                escapeCsv(String(value))
              ).join(',')).join('\n');

            const blob = new Blob([csvContent], {
              type: 'text/csv;charset=utf-8;'
            });

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.href = url;
            link.download = `carebeacon_report_${new Date()
              .toISOString()
              .split('T')[0]}.csv`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-card border border-border hover:border-primary/50 hover:bg-muted rounded-xl transition text-foreground font-medium text-sm shadow-sm"
        >
          <Download className="size-4" />
          <span>Export Report</span>
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 bg-success/10 rounded-xl">
              <CheckCircle className="size-6 text-success" />
            </div>
            <span className="text-xs px-2 py-1 bg-success/10 text-success rounded-lg font-medium">
              All Time
            </span>
          </div>

          <p className="text-3xl font-bold mb-1 text-foreground">
            {fallEvents.filter(
              (event) =>
                event.status !== 'cancelled' &&
                event.status !== 'emergency'
            ).length}
          </p>
          <p className="text-sm text-muted-foreground">Total Falls</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 bg-primary/10 rounded-xl">
              <Clock className="size-6 text-primary" />
            </div>
            <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-lg font-medium">
              Average
            </span>
          </div>

          <p className="text-3xl font-bold mb-1 text-foreground">5 min</p>
          <p className="text-sm text-muted-foreground">Response Time</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 bg-destructive/10 rounded-xl">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <span className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded-lg font-medium">
              March 2026
            </span>
          </div>

          <p className="text-3xl font-bold mb-1 text-foreground">1</p>
          <p className="text-sm text-muted-foreground">This Month</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-6 text-foreground">
          Event Timeline
        </h3>

        <div className="space-y-4">
          {fallEvents.map((event, index) => (
            <div key={event.id} className="relative group">
              {/* Connector line */}
              {index < fallEvents.length - 1 && (
                <div className="absolute left-[22px] top-12 bottom-0 w-px bg-border" />
              )}

              <div className="relative bg-background border border-border rounded-xl p-5 hover:border-primary/30 transition-all duration-200 hover:shadow-sm">
                <div className="flex items-start gap-4">
                  {/* Status Icon */}
                  <div
                    className={`relative flex-shrink-0 p-2.5 rounded-lg ${
                      event.status === 'resolved'
                        ? 'bg-success/10'
                        : event.status === 'confirmed'
                        ? 'bg-primary/10'
                        : event.status === 'cancelled'
                        ? 'bg-muted'
                        : event.status === 'pending'
                        ? 'bg-warning/10'
                        : 'bg-destructive/10'
                    }`}
                  >
                    {event.status === 'resolved' ? (
                      <CheckCircle className="size-5 text-success" />
                    ) : event.status === 'confirmed' ? (
                      <CheckCircle className="size-5 text-primary" />
                    ) : event.status === 'cancelled' ? (
                      <AlertTriangle className="size-5 text-muted-foreground" />
                    ) : event.status === 'pending' ? (
                      <Clock className="size-5 text-warning" />
                    ) : (
                      <AlertTriangle className="size-5 text-destructive" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold mb-1 text-foreground">
                          Fall Detected
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {event.timestamp.toLocaleString()}
                        </p>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-lg text-xs font-medium ${
                          event.status === 'resolved'
                            ? 'bg-success/10 text-success'
                            : event.status === 'confirmed'
                            ? 'bg-primary/10 text-primary'
                            : event.status === 'cancelled'
                            ? 'bg-muted text-muted-foreground'
                            : event.status === 'pending'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {event.status.charAt(0).toUpperCase() +
                          event.status.slice(1)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                        <MapPin className="size-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-foreground truncate">
                          {formatEventLocation(event.location)}
                        </span>
                      </div>

                      {event.responseTime && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                          <Clock className="size-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-foreground">
                            {event.responseTime}
                          </span>
                        </div>
                      )}

                      {event.contactNotified && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                          <Phone className="size-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-foreground truncate">
                            {event.contactNotified}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {fallEvents.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex p-6 bg-muted rounded-2xl mb-4">
              <CheckCircle className="size-12 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium">
              No incidents recorded
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              All systems operational
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
