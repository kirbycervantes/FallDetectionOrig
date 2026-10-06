import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, MapPin, Activity, Bell, LogOut, User, Phone, AlertTriangle, CheckCircle, Battery, Wifi, TrendingUp, X, PhoneCall, XCircle, Clock, Volume2, VolumeX, Navigation, Calendar, BarChart3, AlertOctagon, Settings } from 'lucide-react';
import { UserSettings } from './UserSettings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { LocationMap } from './LocationMap';
import { FallHistory } from './FallHistory';
import { DeviceStatus } from './DeviceStatus';
import { EmergencyContacts } from './EmergencyContacts';
import { JoinRequests } from './JoinRequests';
import { CaregiverSchedule } from './CaregiverSchedule';
import { CaregiverAnalytics } from './CaregiverAnalytics';
import { DeviceAudio } from './DeviceAudio';
import { SkeletonPage } from './ui/skeleton';
import { db, ref, onValue, update, push, set } from '../../lib/db';
import { get } from 'firebase/database';

import type { User as FirebaseUser } from 'firebase/auth';

interface DashboardProps {
  user: FirebaseUser;
  impersonatedFamilyId?: string;
  onLogout: () => void;
}

type TabType = 'map' | 'history' | 'device' | 'audio' | 'contacts' | 'join_requests' | 'schedule' | 'analytics' | 'settings';

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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };
  const [activeTab, setActiveTab] = useState<TabType>('map');
  const [deviceData, setDeviceData] = useState<any>(fallbackDeviceData);
  const [hasAlert, setHasAlert] = useState(false);
  const [incidentsCount, setIncidentsCount] = useState(0);
  const [incidentOffset, setIncidentOffset] = useState(0);
  
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
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
        setIncidentOffset(famData?.incidentOffset || 0);
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
          setIncidentOffset(famData?.incidentOffset || 0);
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
        const count = Object.values(events).filter((e: any) => 
          e.status !== 'cancelled' && e.status !== 'emergency'
        ).length;
        setIncidentsCount(count);
      }
    });
    
    return () => {
      unsubscribeDevice();
      unsubscribeEvents();
    };
  }, [deviceId]);

  // Request FCM permissions and save token to the device node
  // This allows the ESP32 to simply read devices/{deviceId}/fcmTokens to get all targets
  useEffect(() => {
    if (deviceId && user) {
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
    if (hasAlert) {
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
  const isOffline = deviceData.lastUpdate ? (Date.now() - new Date(deviceData.lastUpdate).getTime() > 15 * 60 * 1000) : false;
  const isLowBattery = deviceData.battery < 15;


  
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
        
        setLinkSuccess('A request to join this family has been sent to the existing caregivers.');
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

  return (
    <div className="size-full flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="relative border-b border-border bg-card">
        <div className="relative px-4 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Left: Brand */}
          <div className="flex items-center gap-4">
            <div className="relative p-2.5 bg-primary/10 rounded-xl text-primary">
              <Activity className="size-5" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">CareBeacon</h1>
              <p className="text-xs text-muted-foreground">{deviceData.user?.name || fallbackDeviceData.user.name}, {deviceData.user?.age || fallbackDeviceData.user.age}</p>
            </div>
          </div>
          
          {/* Right: Status & Actions */}
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-4">
            {hasAlert && (
              <div className="flex items-center gap-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-xl">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-destructive animate-pulse" />
                  <span className="text-sm font-bold text-destructive uppercase">UNCONFIRMED FALL</span>
                </div>
                <button 
                  onClick={handleConfirmAlert}
                  className="flex items-center gap-1.5 px-3 py-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-medium rounded-lg transition"
                >
                  <CheckCircle className="size-3" />
                  Confirm Alert
                </button>
              </div>
            )}
            
            <div className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-xl shadow-sm">
              <div className={`size-2 rounded-full ${deviceData.status !== 'offline' ? 'bg-success' : 'bg-destructive'}`}></div>
              <span className="text-sm font-medium capitalize text-foreground">{deviceData.status}</span>
            </div>
            
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className={`flex items-center justify-center size-10 rounded-full font-medium cursor-pointer transition-colors ${impersonatedFamilyId ? 'bg-warning/20 text-warning hover:bg-warning/30' : 'bg-secondary text-primary hover:bg-secondary/80'}`}>
                    {impersonatedFamilyId ? 'ADMIN' : (user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U')}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {impersonatedFamilyId ? (
                    <>
                      <DropdownMenuLabel className="text-warning">Impersonation Mode</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Settings and sign-out are disabled while viewing as a family.
                      </div>
                    </>
                  ) : (
                    <>
                      <DropdownMenuLabel>My Account</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setActiveTab('settings')}
                        className="cursor-pointer"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Settings</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleLogoutClick}
                        className="text-destructive focus:text-destructive cursor-pointer"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Sign Out</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
          </div>
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation */}
        <nav className="w-56 border-r border-border bg-card px-4 py-6 space-y-6 overflow-y-auto shrink-0 hidden md:flex md:flex-col sticky top-0 h-[calc(100vh-73px)]">
            <div>
              <h3 className="px-2 text-xs font-medium text-muted-foreground mb-2">Monitoring</h3>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => setActiveTab('map')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'map' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <MapPin className="size-4" />
                    Live Map
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'history' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <Activity className="size-4" />
                    Fall History
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('analytics')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'analytics' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <BarChart3 className="size-4" />
                    Analytics
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="px-2 text-xs font-medium text-muted-foreground mb-2">Device & Family</h3>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => setActiveTab('device')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'device' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <Battery className="size-4" />
                    Device Status
                  </button>
                </li>
                <li>
                <button
                            onClick={() => setActiveTab('audio')}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              activeTab === 'audio'
                                ? 'bg-secondary text-primary'
                                : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                            }`}
                          >
                            <MessageSquare className="size-4" />
                            SMS Alerts
                          </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('schedule')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'schedule' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <Calendar className="size-4" />
                    Care Schedule
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('contacts')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'contacts' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <Phone className="size-4" />
                    Emergency Contacts
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('join_requests')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'join_requests' ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary/50 hover:text-primary'
                    }`}
                  >
                    <User className="size-4" />
                    Join Requests
                  </button>
                </li>
              </ul>
            </div>
          </nav>
          
          {/* Main Content Area */}
          <main className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Header */}
            <header className="h-16 flex items-center justify-between px-8 border-b border-border bg-card shrink-0">
              <h2 className="text-lg font-semibold text-foreground capitalize">
                {activeTab === 'join_requests' ? 'Join Requests' : activeTab}
              </h2>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground hidden sm:inline-block">
                  Monitoring {deviceData.user?.name || 'Unknown User'}
                </span>
              </div>
            </header>

            {/* Proactive Warnings */}
            {!hasAlert && isOffline && (
              <div className="bg-amber-500 text-amber-950 px-4 py-3 flex items-center justify-center gap-3 animate-in slide-in-from-top-2">
                <AlertOctagon className="size-5" />
                <p className="text-sm font-medium">Device is offline. It hasn't connected in over 15 minutes.</p>
              </div>
            )}
            {!hasAlert && !isOffline && isLowBattery && (
              <div className="bg-red-500 text-white px-4 py-3 flex items-center justify-center gap-3 animate-in slide-in-from-top-2">
                <Battery className="size-5" />
                <p className="text-sm font-medium">Device battery is critically low ({Math.round(deviceData.battery)}%). Please charge immediately.</p>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
              {/* Stats Overview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2.5 bg-success/10 rounded-xl">
                      <Wifi className="size-5 text-success" />
                    </div>
                    <TrendingUp className="size-4 text-success" />
                  </div>
                  <p className="text-muted-foreground text-sm mb-1">Connection</p>
                  <p className="text-2xl font-semibold text-foreground">Online</p>
                </div>
                
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                      <Battery className="size-5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground">Good</span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-1">Battery</p>
                  <p className="text-2xl font-semibold text-foreground">{Math.round(deviceData.battery)}%</p>
                </div>
                
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2.5 bg-destructive/10 rounded-xl">
                      <Bell className="size-5 text-destructive" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">Total Falls</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">{Math.max(0, incidentsCount + incidentOffset)}</p>
                </div>
                
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2.5 bg-warning/10 rounded-xl">
                      <Phone className="size-5 text-warning" />
                    </div>
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-1">Contacts</p>
                  <p className="text-2xl font-semibold text-foreground">3</p>
                </div>
              </div>

              {activeTab === 'map' && <LocationMap deviceId={deviceId!} />}
              {activeTab === 'history' && <FallHistory deviceId={deviceId!} />}
              {activeTab === 'analytics' && <CaregiverAnalytics deviceId={deviceId!} />}
              {activeTab === 'device' && <DeviceStatus deviceId={deviceId!} />}
              {activeTab === 'audio' && <DeviceAudio deviceId={deviceId!} />}
              {activeTab === 'schedule' && <CaregiverSchedule familyId={familyId!} />}
              {activeTab === 'contacts' && <EmergencyContacts familyId={familyId!} />}
              {activeTab === 'join_requests' && <JoinRequests familyId={familyId!} />}
              {activeTab === 'settings' && <UserSettings />}
            </div>
          </main>
      </div>



      {/* ===== FULL-SCREEN EMERGENCY ALERT OVERLAY ===== */}
      {hasAlert && (
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
