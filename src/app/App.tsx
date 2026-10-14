import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { AdminRouter } from './components/admin/AdminRouter';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { db, ref, onValue, update } from '../lib/db';
import { Shield, Clock, LogOut, AlertOctagon } from 'lucide-react';
import { requestNotificationPermission } from '../lib/messaging';
import { SkeletonPage } from './components/ui/skeleton';
import { savePhoneIndex } from '../lib/phoneIndex';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState<'active' | 'pending' | 'suspended' | 'loading'>('loading');
  const [userRole, setUserRole] = useState<'caregiver' | 'admin' | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setUserRole(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for user's access status and role in the database
  useEffect(() => {
    if (!user) {
      setAccessStatus('loading');
      return;
    }

    let statusUnsubscribe: Function | undefined;
    let roleUnsubscribe: Function | undefined;

    // Fetch Role
    const userRoleRef = ref(db, `users/${user.uid}/role`);
    roleUnsubscribe = onValue(userRoleRef, (snapshot: any) => {
      if (snapshot.exists()) {
        setUserRole(snapshot.val());
      } else {
        // Default to caregiver if no role is set
        setUserRole('caregiver');
      }
    }, (error: any) => {
      console.error("Error fetching user role:", error);
      setUserRole('caregiver');
    });

    // Fetch Access Status
    const userStatusRef = ref(db, `users/${user.uid}/accessStatus`);
    statusUnsubscribe = onValue(userStatusRef, (snapshot: any) => {
      if (snapshot.exists()) {
        const status = snapshot.val();
        setAccessStatus(status === 'active' ? 'active' : (status === 'suspended' ? 'suspended' : 'pending'));
      } else {
        // No status record — default to active
        setAccessStatus('active');
      }
      setLoading(false);
    }, (error: any) => {
      console.error("Error fetching access status:", error);
      setAccessStatus('active'); // fallback
      setLoading(false);
    });

    return () => {
      if (typeof statusUnsubscribe === 'function') statusUnsubscribe();
      if (typeof roleUnsubscribe === 'function') roleUnsubscribe();
    };
  }, [user]);

  // Keep phoneIndex/{phone} -> this account up to date, so "Forgot password ->
  // use my phone number" can find the account (also fills it in for older accounts).
  useEffect(() => {
    if (!user) return;
    let lastSaved = '';
    const unsub = onValue(ref(db, `users/${user.uid}/phone`), (snap: any) => {
      const phone = snap.val();
      if (phone && phone !== lastSaved) {
        lastSaved = phone;
        savePhoneIndex(phone, user.uid, user.email);
      }
    }, () => { /* no access yet - ignore */ });
    return () => unsub();
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };
  const handleSignUpComplete = (status: 'active' | 'pending') => {
    setAccessStatus(status);
    setUserRole('caregiver');
  };

  // FCM Token registration has been moved to Dashboard.tsx
  // so we can save tokens directly to devices/{deviceId}/fcmTokens

  if (loading) {
    return <SkeletonPage />;
  }

  // Pending join request — waiting for approval from the administrator (Admin → Review Queue)
  const PendingApprovalScreen = () => (
    <div className="size-full flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center size-20 bg-primary/10 rounded-2xl mb-4 text-primary">
          <Shield className="size-10" strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2 tracking-tight">CareBeacon</h1>
        <p className="text-muted-foreground mb-8">Fall Detection System</p>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <div className="inline-flex items-center justify-center size-14 bg-warning/10 rounded-xl mb-4 text-warning">
            <Clock className="size-7" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Awaiting Approval</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Your request to join this family has been sent to the administrator.
            You will gain access to the dashboard once the administrator approves your request.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            This page will update automatically when your request is approved.
          </p>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full py-2 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl transition"
          >
            <LogOut className="size-4" />
            Sign out
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
                onClick={() => { setShowLogoutConfirm(false); signOut(auth); }}
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

  function SuspendedScreen() {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center shadow-lg">
          <div className="size-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertOctagon className="size-8 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-3">Account Suspended</h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Your access to CareBeacon has been suspended by an administrator. Please contact support if you believe this is a mistake.
          </p>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full py-2 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl transition"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="size-full">
      <Routes>
        {/* If not logged in, show Login on all paths */}
        {!user && (
          <Route path="*" element={<Login onSignUpComplete={handleSignUpComplete} />} />
        )}

        {/* If logged in, route based on role */}
        {user && (
          <>
            {userRole === 'admin' ? (
              <>
                <Route path="/admin/*" element={<AdminRouter />} />
                {/* Redirect any other path to admin */}
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </>
            ) : (
              <>
                {/* Admin paths are inaccessible to caregivers */}
                <Route path="/admin/*" element={<Navigate to="/" replace />} />
                {/* Show dashboard or pending screen for caregiver */}
                <Route path="*" element={
                  accessStatus === 'suspended' ? (
                    <SuspendedScreen />
                  ) : accessStatus === 'pending' ? (
                    <PendingApprovalScreen />
                  ) : (
                    <Dashboard user={user} onLogout={() => signOut(auth)} />
                  )
                } />
              </>
            )}
          </>
        )}
      </Routes>
    </div>
  );
}
