
import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, MapPin, Activity, Bell, LogOut, Phone, AlertTriangle, CheckCircle, Battery, Wifi, WifiOff, PhoneCall, XCircle, Clock, Volume2, VolumeX, Navigation, AlertOctagon, Settings, Cpu, Eye } from 'lucide-react';
import { LocationMap } from './LocationMap';
import { FallHistory } from './FallHistory';
import { DeviceStatus } from './DeviceStatus';
import { EmergencyContacts } from './EmergencyContacts';
import { useBatteryLevels } from './BatteryPanel';
import { isCountedFall } from '../../lib/events';
import { isDeviceOnline, lastSeen, timeAgo, useNow } from '../../lib/deviceStatus';
import { UserSettings } from './UserSettings';
import { SkeletonPage } from './ui/skeleton';
import { db, ref, onValue, update, push, set } from '../../lib/db';
import { get } from 'firebase/database';

import type { User as FirebaseUser } from 'firebase/auth';

interface DashboardProps {
  user: FirebaseUser;
  impersonatedFamilyId?: string;
  onLogout: () => void;
}

type TabType = 'map' | 'history' | 'device' | 'contacts' | 'settings';

const TAB_TITLES: Record<TabType, string> = {
  map: 'Live Map',
  history: 'Fall History',
  device: 'Device Status',
  contacts: 'Emergency Contacts',
  settings: 'Settings',
};

const NAV_ITEMS: { tab: TabType; label: string; short: string; icon: typeof MapPin; group: 'Monitoring' | 'Device & Family' }[] = [
  { tab: 'map', label: 'Live Map', short: 'Map', icon: MapPin, group: 'Monitoring' },
  { tab: 'history', label: 'Fall History', short: 'History', icon: Activity, group: 'Monitoring' },
  { tab: 'device', label: 'Device Status', short: 'Device', icon: Cpu, group: 'Device & Family' },
  { tab: 'contacts', label: 'Emergency Contacts', short: 'Contacts', icon: Phone, group: 'Device & Family' },
];

const fallbackDeviceData = {
  status: 'offline',
  battery: 0,
  lastUpdate: new Date().toISOString(),
  location: {
    lat: 14.6042,
    lng: 120.9822,
    address: 'Unknown',
  },
  user: {
    name: 'Unknown User',
    age: 0,
  },
};

export function Dashboard({ user, impersonatedFamilyId, onLogout }: DashboardProps) {
  // An administrator viewing a family is always read-only: no alarm, no alert actions, no edits.
  const readOnly = !!impersonatedFamilyId;
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };
  const [activeTab, setActiveTabState] = useState<TabType>('map');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);
  // Always jump back to the top when switching pages (also when re-clicking the same page)
  const setActiveTab = useCallback((tab: TabType) => {
    setActiveTabState(tab);
    scrollToTop();
  }, [scrollToTop]);
  useEffect(() => { scrollToTop(); }, [activeTab, scrollToTop]);
  const [deviceData, setDeviceData] = useState<any>(fallbackDeviceData);
  const [hasAlert, setHasAlert] = useState(false);
  const [incidentsCount, setIncidentsCount] = useState(0);
  const [contactsCount, setContactsCount] = useState(0);
  const now = useNow(5000);
  
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const batteryLevels = useBatteryLevels(deviceId);
  const [loadingContext, setLoadingContext] = useState(true);
  


  // Link Device Form State
  const [linkSerial, setLinkSerial] = useState('');
  const [linkPatient, setLinkPatient] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');

  // Emergency alert state
  const [alertTimestamp, setAlertTimestamp] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [alarmMuted, setAlarmMuted] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // Fetch user's family and linked device
  useEffect(() => {
    if (!user && !impersonatedFamilyId) return;

    if (impersonatedFamilyId) {
      setFamilyId(impersonatedFamilyId);
      const famRef = ref(db, `families/${impersonatedFamilyId}`);
      const unsubFam = onValue(famRef, (famSnap) => {
        const famData = famSnap.val();
        const resolvedDeviceId = famData?.deviceId || famData?.deviceSerialNumber;
        if (resolvedDeviceId) {
          setDeviceId(resolvedDeviceId);
        }
          setPatientName(famData?.monitoredPerson?.name || famData?.monitoredPersonName || famData?.patientName || '');
        setLoadingContext(false);
      });
      return () => unsubFam();
    }
    
    const userRef = ref(db, `users/${user.uid}`);
    const unsubUser = onValue(userRef, (snapshot) => {
      const userData = snapshot.val();
      if (userData?.familyId) {
        setFamilyId(userData.familyId);
        
        // Now fetch family to get deviceId
        const famRef = ref(db, `families/${userData.familyId}`);
        const unsubFam = onValue(famRef, (famSnap) => {
          const famData = famSnap.val();
          const resolvedDeviceId = famData?.deviceId || famData?.deviceSerialNumber;
          if (resolvedDeviceId) {
            setDeviceId(resolvedDeviceId);
          }
          setPatientName(famData?.monitoredPerson?.name || famData?.monitoredPersonName || famData?.patientName || '');
          setLoadingContext(false);
        }, (error) => {
          console.error("Error fetching family:", error);
          setLoadingContext(false);
        });
        return () => unsubFam();
      } else {
        setLoadingContext(false);
      }
    }, (error) => {
      console.error("Error fetching user data:", error);
      setLoadingContext(false);
    });
    
    return () => unsubUser();
  }, [user, impersonatedFamilyId]);
  
  useEffect(() => {
    if (!deviceId) return;
    
    const deviceRef = ref(db, `devices/${deviceId}`);
    const unsubscribeDevice = onValue(deviceRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setDeviceData((prev: any) => ({ ...prev, ...data }));
        if (data.status === 'FALL_DETECTED') {
          if (!hasAlert) {
            setAlertTimestamp(new Date());
            setElapsedTime(0);
            setAlarmMuted(false);
          }
          setHasAlert(true);
        } else {
          setHasAlert(false);
          setAlertTimestamp(null);
          stopAlarm();
        }
      }
    });

    const eventsRef = ref(db, `events/${deviceId}`);
    const unsubscribeEvents = onValue(eventsRef, (snapshot) => {
      if (snapshot.exists()) {
        const events = snapshot.val();
        // Total Falls = real falls only (not Manual SOS, not cancelled)
        const count = Object.values(events).filter((e: any) => isCountedFall(e)).length;
        setIncidentsCount(count);
      } else {
        setIncidentsCount(0);
      }
    });
    
    return () => {
      unsubscribeDevice();
      unsubscribeEvents();
    };
  }, [deviceId]);

  // Number of emergency contacts actually registered for this family
  useEffect(() => {
    if (!familyId) return;
    const unsub = onValue(ref(db, `families/${familyId}/contacts`), (snap) => {
      const v = snap.val();
      setContactsCount(v && typeof v === 'object' ? Object.keys(v).length : 0);
    });
    return () => unsub();
  }, [familyId]);

  // Request FCM permissions and save token to the device node
  // This allows the ESP32 to simply read devices/{deviceId}/fcmTokens to get all targets
  useEffect(() => {
    if (deviceId && user && !readOnly) {
      import('../../lib/messaging').then(({ requestNotificationPermission }) => {
        requestNotificationPermission().then(token => {
          if (token) {
            update(ref(db, `devices/${deviceId}/fcmTokens`), {
              [user.uid]: token
            }).catch(err => console.error("Error saving FCM token:", err));
          }
        });
      });
    }
  }, [deviceId, user]);

  // --- Alarm audio via Web Audio API ---
  const startAlarm = useCallback(() => {
    if (audioContextRef.current) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      // Create a pulsing siren effect
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      const duration = 60; // loop for 60 seconds
      for (let t = 0; t < duration; t += 1) {
        osc.frequency.setValueAtTime(880, ctx.currentTime + t);
        osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + t + 0.5);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + t + 1);
      }
      osc.start();
      audioContextRef.current = ctx;
      oscillatorRef.current = osc;
      gainRef.current = gain;
    } catch (e) {
      console.warn('Web Audio API not available:', e);
    }
  }, []);

  const stopAlarm = useCallback(() => {
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop(); } catch (e) { /* already stopped */ }
      oscillatorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    gainRef.current = null;
  }, []);

  const toggleMute = useCallback(() => {
    if (gainRef.current) {
      if (alarmMuted) {
        gainRef.current.gain.value = 0.15;
      } else {
        gainRef.current.gain.value = 0;
      }
    }
    setAlarmMuted(prev => !prev);
  }, [alarmMuted]);

  // Start alarm when alert appears
  useEffect(() => {
    if (hasAlert && !readOnly) {
      startAlarm();
    } else {
      stopAlarm();
    }
    return () => stopAlarm();
  }, [hasAlert, startAlarm, stopAlarm]);

  // Elapsed time counter
  useEffect(() => {
    if (!alertTimestamp) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - alertTimestamp.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [alertTimestamp]);

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  
  const handleConfirmAlert = async () => {
    try {
      const deviceRef = ref(db, `devices/${deviceId}`);
      await update(deviceRef, { status: 'CONFIRMED_FALL' });
      stopAlarm();
    } catch (error) {
      console.error('Failed to confirm alert:', error);
    }
  };

  const handleDismissAlert = async () => {
    try {
      const deviceRef = ref(db, `devices/${deviceId}`);
      await update(deviceRef, { status: 'FALSE_ALARM' });
      stopAlarm();
      setHasAlert(false);
      setAlertTimestamp(null);
    } catch (error) {
      console.error('Failed to dismiss alert:', error);
    }
  };

  // Determine proactive warnings
    const isLowBattery = typeof deviceData.battery === 'number' && deviceData.battery > 0 && deviceData.battery < 15;


  
  const simulateFall = () => {
    const deviceRef = ref(db, `devices/${deviceId}`);
    update(deviceRef, { status: 'FALL_DETECTED', lastUpdate: new Date().toISOString() });
    
    const eventsRef = ref(db, `events/${deviceId}`);
    const newEventRef = push(eventsRef);
    set(newEventRef, {
      timestamp: new Date().toISOString(),
      status: 'pending',
      location: deviceData.location?.address || 'Unknown'
    });
  };
  
  const simulateSOS = () => {
    const deviceRef = ref(db, `devices/${deviceId}`);
    update(deviceRef, { status: 'SOS_MANUAL', lastUpdate: new Date().toISOString() });
    
    const eventsRef = ref(db, `events/${deviceId}`);
    const newEventRef = push(eventsRef);
    set(newEventRef, {
      timestamp: new Date().toISOString(),
      status: 'emergency',
      location: deviceData.location?.address || 'Unknown'
    });
  };
  
  const simulateBatteryDrop = () => {
    const deviceRef = ref(db, `devices/${deviceId}`);
    update(deviceRef, { battery: Math.max(0, deviceData.battery - 10) });
  };
  
  const resetStatus = () => {
    if (!deviceId) return;
    const deviceRef = ref(db, `devices/${deviceId}`);
    update(deviceRef, { status: 'online' });
  };
  
  if (loadingContext) {
    return <SkeletonPage />;
  }

  const handleLinkDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError('');
    setLinkSuccess('');
    if (!linkSerial.trim()) return setLinkError('Device Serial is required');
    if (!linkPatient.trim()) return setLinkError('Patient Name is required');
    
    setLinkLoading(true);
    try {
      const trimmedSerial = linkSerial.trim().toUpperCase();
      
      // 1. Check if device exists (already linked to a family)
      const deviceRef = ref(db, `devices/${trimmedSerial}`);
      const deviceSnap = await get(deviceRef);
      
      if (deviceSnap.exists() && deviceSnap.val().familyId) {
        // Device is already linked to a family, request to join
        const familyId = deviceSnap.val().familyId;
        
        // Add to joinRequests
        const requestRef = push(ref(db, `families/${familyId}/joinRequests`));
        await set(requestRef, {
          uid: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Unknown',
          email: user.email,
          status: 'pending',
          timestamp: new Date().toISOString()
        });
        // Also push to admin review queue
        const queueRef = push(ref(db, 'admin/registrationQueue'));
        await set(queueRef, {
          familyId: familyId,
          caregiverUid: user.uid,
          caregiverName: user.displayName || user.email?.split('@')[0] || 'Unknown',
          caregiverEmail: user.email,
          deviceSerialNumber: trimmedSerial,
          monitoredPersonName: '(Joining existing family)',
          createdAt: new Date().toISOString(),
          status: 'pending_review',
        });
        
        setLinkSuccess('A request to join this family has been sent to the administrator for approval.');
        await set(ref(db, `users/${user.uid}/accessStatus`), 'pending');
        return;
      }
      
      // 2. Check admin inventory for a new provisioned device
      const invRef = ref(db, `admin/inventory/${trimmedSerial}`);
      const invSnap = await get(invRef);
      
      if (!invSnap.exists()) {
        throw new Error('Invalid Device Serial Number or device not provisioned.');
      }
      
      // 3. Create new family for this provisioned device
      const familiesRef = ref(db, 'families');
      const newFamilyRef = push(familiesRef);
      const newFamilyId = newFamilyRef.key;
      const now = new Date().toISOString();
      
      await set(newFamilyRef, {
        monitoredPerson: { name: linkPatient.trim() },
        deviceId: trimmedSerial,
        deviceSerialNumber: trimmedSerial,
        caregivers: {
          [user.uid]: {
            name: user.displayName || user.email?.split('@')[0] || 'Unknown',
            email: user.email,
            role: 'primary',
            joinedAt: now
          }
        },
        createdAt: now,
        status: 'active'
      });
      
      await set(ref(db, `devices/${trimmedSerial}/familyId`), newFamilyId);
      await set(ref(db, `users/${user.uid}/familyId`), newFamilyId);
      await set(ref(db, `users/${user.uid}/accessStatus`), 'active');

      // Push to admin registration review queue
      const queueRef = push(ref(db, 'admin/registrationQueue'));
      await set(queueRef, {
        familyId: newFamilyId,
        caregiverUid: user.uid,
        caregiverName: user.displayName || user.email?.split('@')[0] || 'Unknown',
        caregiverEmail: user.email,
        deviceSerialNumber: trimmedSerial,
        monitoredPersonName: linkPatient.trim(),
        createdAt: now,
        status: 'pending_review',
      });
      
      // The dashboard will automatically reload and fetch the new deviceId
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link device');
    } finally {
      setLinkLoading(false);
    }
  };

  if (!deviceId && readOnly) {
    return (
      <div className="size-full min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-sm text-center">
          <h2 className="text-xl font-semibold mb-2">No device linked</h2>
          <p className="text-sm text-muted-foreground">This family has no linked device. Linking a device is not available in the admin read-only view.</p>
        </div>
      </div>
    );
  }

  if (!deviceId) {
    return (
      <div className="size-full min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-sm">
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center justify-center size-16 bg-primary/10 rounded-xl text-primary">
              <Plus className="size-8" strokeWidth={1.5} />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold text-center mb-2">Link a Device</h2>
          <p className="text-muted-foreground text-center mb-8">
            Your account is not linked to an active CareBeacon device yet. Enter your device details below.
          </p>

          {linkError && (
            <div className="mb-6 p-4 bg-destructive/10 text-destructive text-sm rounded-xl border border-destructive/20 flex items-start gap-3">
              <AlertOctagon className="size-5 shrink-0" />
              <p>{linkError}</p>
            </div>
          )}

          {linkSuccess && (
            <div className="mb-6 p-4 bg-success/10 text-success text-sm rounded-xl border border-success/20 flex items-start gap-3">
              <CheckCircle className="size-5 shrink-0" />
              <p>{linkSuccess}</p>
            </div>
          )}

          {!linkSuccess && (
            <form onSubmit={handleLinkDevice} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Device Serial Number</label>
                <input 
                  type="text" 
                  value={linkSerial}
                  onChange={(e) => setLinkSerial(e.target.value)}
                  placeholder="e.g. CB-2026-0001" 
                  className="w-full px-4 py-2.5 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Patient / Monitored Person Name</label>
                <input 
                  type="text" 
                  value={linkPatient}
                  onChange={(e) => setLinkPatient(e.target.value)}
                  placeholder="e.g. John Doe" 
                  className="w-full px-4 py-2.5 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
              
              <button 
                type="submit" 
                disabled={linkLoading}
                className="w-full py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-70 mt-4"
              >
                {linkLoading ? 'Linking...' : 'Link Device'}
              </button>
            </form>
          )}

          <div className="mt-8 pt-6 border-t border-border flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">Or sign out to switch accounts</p>
            <button 
              onClick={handleLogoutClick} 
              className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 transition-colors font-medium"
            >
              <LogOut className="size-4" />
              Sign Out
            </button>
          </div>
        </div>
        
        {/* Logout Confirmation Modal */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
              <div className="flex items-center justify-center size-12 bg-destructive/10 rounded-xl mx-auto mb-4">
                <LogOut className="size-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground text-center mb-2">Sign Out</h3>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Are you sure you want to sign out?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="flex-1 py-2.5 px-4 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const online = isDeviceOnline(deviceData, now);
  const seen = lastSeen(deviceData);
  const displayName = patientName || deviceData.user?.name || 'your loved one';

  const statCards = [
    {
      label: 'Connection',
      icon: online ? Wifi : WifiOff,
      tint: online ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
      value: online ? 'Online' : 'Offline',
      note: online ? 'Live' : `Last seen ${timeAgo(seen, now)}`,
    },
    {
      label: 'Wearable Battery',
      icon: Battery,
      tint: 'bg-primary/10 text-primary',
      value: `${Math.round(batteryLevels.wearable)}%`,
      note: batteryLevels.wearable > 20 ? 'Good' : 'Low',
    },
    {
      label: 'Central Hub Battery',
      icon: Battery,
      tint: 'bg-primary/10 text-primary',
      value: `${Math.round(batteryLevels.hub)}%`,
      note: batteryLevels.hub > 20 ? 'Good' : 'Low',
    },
    {
      label: 'Total Falls',
      icon: Bell,
      tint: 'bg-destructive/10 text-destructive',
      value: String(incidentsCount),
      note: 'All time',
    },
    {
      label: 'Contacts',
      icon: Phone,
      tint: 'bg-warning/10 text-warning',
      value: String(contactsCount),
      note: contactsCount === 0 ? 'None added' : 'Registered',
    },
  ];

  return (
    <div className="size-full flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="relative border-b border-border bg-card shrink-0">
        <div className="px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          {/* Left: Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 p-2.5 bg-primary/10 rounded-xl text-primary">
              <Activity className="size-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="text-base md:text-lg font-semibold tracking-tight text-foreground">CareBeacon</h1>
              <p className="text-xs text-muted-foreground truncate">{patientName || deviceData.user?.name || 'Patient'}</p>
            </div>
          </div>

          {/* Right: Alert, Settings, Sign out */}
          <div className="flex items-center gap-2 shrink-0">
            {hasAlert && (
              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-destructive/10 border border-destructive/20 rounded-xl">
                <AlertTriangle className="size-4 text-destructive animate-pulse" />
                <span className="text-xs font-bold text-destructive uppercase">Unconfirmed fall</span>
                {!readOnly && (
                  <button
                    onClick={handleConfirmAlert}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-medium rounded-lg transition"
                  >
                    <CheckCircle className="size-3" />
                    Confirm
                  </button>
                )}
              </div>
            )}

            {readOnly ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warning/15 text-warning text-xs font-semibold">
                <Eye className="size-3.5" />
                Admin view
              </span>
            ) : (
              <>
                <button
                  onClick={() => setActiveTab('settings')}
                  aria-label="Settings"
                  title="Settings"
                  className={`flex items-center justify-center size-10 rounded-xl border transition-colors ${
                    activeTab === 'settings'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground border-border hover:bg-secondary'
                  }`}
                >
                  <Settings className="size-5" />
                </button>
                <button
                  onClick={handleLogoutClick}
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-card text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors text-sm font-medium"
                >
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation (tablet / desktop) */}
        <nav className="w-56 border-r border-border bg-card px-4 py-6 space-y-6 overflow-y-auto shrink-0 hidden md:flex md:flex-col">
          {(['Monitoring', 'Device & Family'] as const).map((group) => (
            <div key={group}>
              <h3 className="px-2 text-xs font-medium text-muted-foreground mb-2">{group}</h3>
              <ul className="space-y-1">
                {NAV_ITEMS.filter((item) => item.group === group).map(({ tab, label, icon: Icon }) => (
                  <li key={tab}>
                    <button
                      onClick={() => setActiveTab(tab)}
                      aria-current={activeTab === tab ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-left whitespace-nowrap transition-colors ${
                        activeTab === tab ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-background min-w-0">
          {/* Page title */}
          <div className="h-14 flex items-center justify-between gap-3 px-4 md:px-8 border-b border-border bg-card shrink-0">
            <h2 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
              {activeTab === 'settings' && <Settings className="size-4 text-primary" />}
              {TAB_TITLES[activeTab]}
            </h2>
            <span className="text-xs md:text-sm text-muted-foreground truncate">
              Monitoring {displayName}
            </span>
          </div>

          {/* Proactive Warnings */}
          {!hasAlert && isLowBattery && (
            <div className="bg-red-500 text-white px-4 py-3 flex items-center justify-center gap-3 animate-in slide-in-from-top-2">
              <Battery className="size-5" />
              <p className="text-sm font-medium">Device battery is critically low ({Math.round(deviceData.battery)}%). Please charge immediately.</p>
            </div>
          )}

          {/* Scrollable Content (extra bottom space on phones for the bottom bar) */}
          <div ref={contentRef} className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
            {/* Status cards - not on Settings, so it is clear you are on the Settings page */}
            {activeTab !== 'settings' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4 mb-6 md:mb-8">
                {statCards.map(({ label, icon: Icon, tint, value, note }, i) => (
                  <div
                    key={label}
                    className={`bg-card border border-border rounded-2xl p-3 sm:p-4 shadow-sm ${i === 0 ? 'col-span-2 sm:col-span-1' : ''}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`shrink-0 p-2 sm:p-2.5 rounded-xl ${tint}`}>
                        <Icon className="size-5" />
                      </div>
                      {/* label and value share the same left edge */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm text-muted-foreground leading-tight">{label}</p>
                        <div className="flex items-baseline justify-between gap-2 mt-1">
                          <p className="text-xl sm:text-2xl font-semibold text-foreground leading-none">{value}</p>
                          <span className="text-[11px] text-muted-foreground text-right leading-tight">{note}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* key = page: the page re-mounts (and fades in) every time you switch */}
            <div key={activeTab} className="animate-in fade-in duration-300">
              {activeTab === 'map' && <LocationMap deviceId={deviceId!} />}
              {activeTab === 'history' && <FallHistory deviceId={deviceId!} />}
              {activeTab === 'device' && <DeviceStatus deviceId={deviceId!} />}
              {activeTab === 'contacts' && <EmergencyContacts familyId={familyId!} readOnly={readOnly} />}
              {activeTab === 'settings' && !readOnly && <UserSettings />}
            </div>
          </div>
        </main>
      </div>

      {/* Bottom navigation (phones) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-card border-t border-border grid grid-cols-4">
        {NAV_ITEMS.map(({ tab, short, icon: Icon }) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              activeTab === tab ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="size-5" />
            {short}
          </button>
        ))}
      </nav>

      {/* ===== FULL-SCREEN EMERGENCY ALERT OVERLAY (never in the admin read-only view) ===== */}
      {hasAlert && !readOnly && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ animation: 'emergencyPulse 2s ease-in-out infinite' }}>
          {/* Backdrop with pulsing red */}
          <div className="absolute inset-0 bg-gradient-to-b from-red-950/95 via-red-900/95 to-red-950/95 backdrop-blur-md" />
          
          {/* Animated ring effect */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="size-[600px] rounded-full border-2 border-red-500/20" style={{ animation: 'pingRing 3s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
            <div className="absolute size-[400px] rounded-full border-2 border-red-500/30" style={{ animation: 'pingRing 3s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s' }} />
            <div className="absolute size-[200px] rounded-full border-2 border-red-500/40" style={{ animation: 'pingRing 3s cubic-bezier(0, 0, 0.2, 1) infinite 1s' }} />
          </div>

          {/* Content */}
          <div className="relative z-10 max-w-lg w-full mx-4 text-center space-y-8">
            {/* Emergency icon */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="size-24 rounded-full bg-red-500/20 flex items-center justify-center" style={{ animation: 'emergencyBounce 1s ease-in-out infinite' }}>
                  <AlertTriangle className="size-12 text-red-400" />
                </div>
                {/* Pulsing ring around icon */}
                <div className="absolute -inset-3 rounded-full border-2 border-red-400/50 animate-ping" />
              </div>
            </div>
            
            {/* Title */}
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
                FALL DETECTED
              </h1>
              <p className="text-red-200/80 text-lg">
                {deviceData.user?.name || 'Unknown'} may need immediate help
              </p>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Elapsed time */}
              <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="size-4 text-red-300" />
                  <span className="text-xs text-red-300 font-medium uppercase tracking-wider">Time Elapsed</span>
                </div>
                <p className="text-3xl font-mono font-bold text-white">{formatElapsed(elapsedTime)}</p>
              </div>
              
              {/* Location */}
              <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Navigation className="size-4 text-red-300" />
                  <span className="text-xs text-red-300 font-medium uppercase tracking-wider">Location</span>
                </div>
                <p className="text-sm text-white font-medium leading-snug truncate">
                  {deviceData.location?.address || 'Fetching...'}
                </p>
                <p className="text-xs text-red-300/70 mt-1">
                  {deviceData.location?.lat?.toFixed(4)}, {deviceData.location?.lng?.toFixed(4)}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <button
                onClick={handleConfirmAlert}
                className="w-full py-4 px-6 bg-red-500 hover:bg-red-400 text-white font-bold text-lg rounded-2xl transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-red-500/30 hover:shadow-red-400/40 hover:scale-[1.02] active:scale-[0.98]"
              >
                <PhoneCall className="size-6" />
                Confirm Fall — Send Emergency Alert
              </button>
              
              <button
                onClick={handleDismissAlert}
                className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white font-medium rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 border border-white/10"
              >
                <XCircle className="size-5" />
                Mark as False Alarm
              </button>
            </div>

            {/* Mute button */}
            <button
              onClick={toggleMute}
              className="mx-auto flex items-center gap-2 px-4 py-2 text-sm text-red-300/70 hover:text-red-200 transition-colors"
            >
              {alarmMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {alarmMuted ? 'Unmute Alarm' : 'Mute Alarm'}
            </button>
          </div>
        </div>
      )}

      {/* Emergency overlay animations */}
      <style>{`
        @keyframes emergencyPulse {
          0%, 100% { background-color: rgba(127, 29, 29, 0); }
          50% { background-color: rgba(127, 29, 29, 0.05); }
        }
        @keyframes pingRing {
          0% { transform: scale(0.5); opacity: 0.8; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes emergencyBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4 animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center justify-center size-12 bg-destructive/10 rounded-xl mx-auto mb-4">
              <LogOut className="size-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold text-foreground text-center mb-2">Sign Out</h3>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Are you sure you want to sign out? You will need to log in again to access the dashboard.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 py-2.5 px-4 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
