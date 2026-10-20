import { useState, useEffect } from 'react';
import { User, Mail, Lock, Phone, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { db, ref, update, onValue } from '../../lib/db';
import {
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { useConfirm } from './ui/confirm-dialog';
import { normalizePhone } from '../../lib/phone';
import { isPhoneTaken } from '../../lib/validation';

// "+63" is fixed; the user types the 10 digits after it (9XX XXX XXXX).
const PHONE_ERROR = 'Enter the 10 digits after +63, starting with 9 (e.g., +63 912 345 6789).';

/** keeps only the digits after +63, max 10 (also accepts a pasted 09... or +63... number) */
function phoneDigitsAfter63(value: string): string {
  let d = value.replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

/** "09123456789" -> "+63 912 345 6789" */
function displayPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (!n) return phone || '—';
  const d = n.slice(1);
  return `+63 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export function UserSettings() {
  // Email
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Phone
  const [newPhone, setNewPhone] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // Field-level inline validation errors
  const [inlineEmailError, setInlineEmailError] = useState('');
  const [inlinePhoneError, setInlinePhoneError] = useState('');
  const [inlinePasswordError, setInlinePasswordError] = useState('');
  const [inlineConfirmError, setInlineConfirmError] = useState('');

  const [currentPhone, setCurrentPhone] = useState<string>('');
  const [confirm, confirmDialog] = useConfirm();

  const user = auth.currentUser;

  useEffect(() => {
    if (user) {
      const userRef = ref(db, `users/${user.uid}`);
      const unsub = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
          setCurrentPhone(snapshot.val().phone || '');
        }
      });
      return () => unsub();
    }
  }, [user]);

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newEmail.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail.trim())) {
      setEmailMsg({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }

    const ok = await confirm({
      title: 'Change your email?',
      message: <>A verification link will be sent to <strong className="text-foreground">{newEmail.trim()}</strong>. Your login email changes only after you open that link.</>,
      confirmLabel: 'Send Link',
      icon: null,
    });
    if (!ok) return;

    setEmailLoading(true);
    setEmailMsg(null);
    try {
      await verifyBeforeUpdateEmail(user, newEmail.trim());
      // Only updating in database after they verify could be ideal, but Firebase Auth links 
      // the new email once verified. We just tell the user to verify it.
      setEmailMsg({ type: 'success', text: 'A verification link has been sent to your new email. Please verify the new email before the change is applied.' });
      setNewEmail('');
    } catch (err: any) {
      const msg = err.code === 'auth/requires-recent-login'
        ? 'This action requires re-authentication. Please sign out and sign in again.'
        : err.message || 'Failed to update email.';
      setEmailMsg({ type: 'error', text: msg });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleUpdatePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPhone.trim()) return;

    if (!/^9\d{9}$/.test(newPhone)) {
      setPhoneMsg({ type: 'error', text: PHONE_ERROR });
      return;
    }
    // saved as 09XXXXXXXXX, the same format used at sign-up
    const phoneToSave = '0' + newPhone;

    // one phone number = one account
    try {
      if (await isPhoneTaken(phoneToSave, user.uid)) {
        setPhoneMsg({ type: 'error', text: 'This phone number is already registered to another account.' });
        return;
      }
    } catch (checkErr: any) {
      console.error('[PHONE CHECK] failed:', checkErr);
      setPhoneMsg({
        type: 'error',
        text: 'Could not check the phone number. Please try again.' + (checkErr?.code ? ` (${checkErr.code})` : checkErr?.message ? ` (${checkErr.message})` : ''),
      });
      return;
    }

    const ok = await confirm({
      title: 'Change your phone number?',
      message: <>{currentPhone ? <>From <strong className="text-foreground">{displayPhone(currentPhone)}</strong> to </> : <>New number: </>}<strong className="text-foreground">{displayPhone(phoneToSave)}</strong></>,
      confirmLabel: 'Update Number',
      icon: null,
    });
    if (!ok) return;

    setPhoneLoading(true);
    setPhoneMsg(null);
    try {
      await update(ref(db, `users/${user.uid}`), { phone: phoneToSave });
      setPhoneMsg({ type: 'success', text: 'Phone number updated successfully.' });
      setNewPhone('');
    } catch (err: any) {
      setPhoneMsg({ type: 'error', text: err.message || 'Failed to update phone number.' });
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    
    const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;
    if (!passwordRegex.test(newPassword)) {
      setPasswordMsg({ type: 'error', text: 'Password must be at least 12 characters long, with at least 1 uppercase letter and 1 special character.' });
      return;
    }

    setShowPasswordConfirm(true);
  };

  const confirmUpdatePassword = async () => {
    if (!user) return;
    setShowPasswordConfirm(false);
    setPasswordLoading(true);
    setPasswordMsg(null);
    try {
      // Re-authenticate
      const credential = EmailAuthProvider.credential(user.email!, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, newPassword);
      setPasswordMsg({ type: 'success', text: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = err.code === 'auth/wrong-password'
        ? 'Current password is incorrect.'
        : err.code === 'auth/requires-recent-login'
        ? 'This action requires re-authentication. Please sign out and sign in again.'
        : err.message || 'Failed to update password.';
      setPasswordMsg({ type: 'error', text: msg });
    } finally {
      setPasswordLoading(false);
    }
  };

  const Feedback = ({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) => {
    if (!msg) return null;
    return (
      <div className={`flex items-start gap-2.5 p-3 rounded-xl text-sm border ${
        msg.type === 'success'
          ? 'bg-success/10 text-success border-success/20'
          : 'bg-destructive/10 text-destructive border-destructive/20'
      }`}>
        {msg.type === 'success'
          ? <CheckCircle className="size-4 mt-0.5 flex-shrink-0" />
          : <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />}
        {msg.text}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1 text-foreground">Account Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your email, phone number, and password</p>
      </div>

      {/* Account Info */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <User className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Account Info</h3>
            <p className="text-xs text-muted-foreground">Your current account details</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-4 bg-muted border border-border rounded-xl">
            <p className="text-xs text-muted-foreground mb-1">Email</p>
            <p className="text-sm font-medium text-foreground truncate">{user?.email || '—'}</p>
          </div>
          <div className="p-4 bg-muted border border-border rounded-xl">
            <p className="text-xs text-muted-foreground mb-1">Display Name</p>
            <p className="text-sm font-medium text-foreground">{user?.displayName || user?.email?.split('@')[0] || '—'}</p>
          </div>
          <div className="p-4 bg-muted border border-border rounded-xl">
            <p className="text-xs text-muted-foreground mb-1">Phone Number</p>
            <p className="text-sm font-medium text-foreground">{currentPhone ? displayPhone(currentPhone) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Update Email */}
      <form onSubmit={handleUpdateEmail} className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Mail className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Change Email</h3>
            <p className="text-xs text-muted-foreground">Update your login email address</p>
          </div>
        </div>

        <Feedback msg={emailMsg} />

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">New Email Address</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                const val = e.target.value;
                if (val.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
                  setInlineEmailError('Please enter a valid email address.');
                } else {
                  setInlineEmailError('');
                }
              }}
              placeholder="new-email@example.com"
              className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
              required
            />
            {inlineEmailError && <p className="text-xs text-destructive mt-1">{inlineEmailError}</p>}
          </div>
          <button
            type="submit"
            disabled={emailLoading || !newEmail.trim()}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {emailLoading ? 'Updating...' : 'Update Email'}
          </button>
        </div>
      </form>

      {/* Update Phone */}
      <form onSubmit={handleUpdatePhone} className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Phone className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Change Phone Number</h3>
            <p className="text-xs text-muted-foreground">Update your contact phone number</p>
          </div>
        </div>

        <Feedback msg={phoneMsg} />

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">New Phone Number</label>
            <div className="flex items-stretch w-full bg-input-background border border-border rounded-xl focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition overflow-hidden">
              <span className="flex items-center px-3 text-sm font-medium text-foreground bg-muted border-r border-border select-none">
                +63
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={newPhone}
                onChange={(e) => {
                  const digits = phoneDigitsAfter63(e.target.value);
                  setNewPhone(digits);
                  setInlinePhoneError(digits && !/^9\d{9}$/.test(digits) ? PHONE_ERROR : '');
                }}
                placeholder="9123456789"
                aria-label="New phone number, digits after +63"
                className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-foreground placeholder-muted-foreground focus:outline-none text-sm tracking-wide"
                required
              />
            </div>
            {inlinePhoneError && <p className="text-xs text-destructive mt-1">{inlinePhoneError}</p>}
          </div>
          <button
            type="submit"
            disabled={phoneLoading || !newPhone.trim()}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phoneLoading ? 'Updating...' : 'Update Phone Number'}
          </button>
        </div>
      </form>

      {/* Update Password */}
      <form onSubmit={handleUpdatePassword} className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Lock className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Change Password</h3>
            <p className="text-xs text-muted-foreground">Secure your account with a new password</p>
          </div>
        </div>

        <Feedback msg={passwordMsg} />

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Current Password</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-4 py-2.5 pr-10 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  const val = e.target.value;
                  if (val && !/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/.test(val)) {
                    setInlinePasswordError('Password must be at least 12 chars, with 1 uppercase and 1 special char.');
                  } else {
                    setInlinePasswordError('');
                  }
                }}
                placeholder="Enter new password"
                className="w-full px-4 py-2.5 pr-10 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {inlinePasswordError && <p className="text-xs text-destructive mt-1">{inlinePasswordError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
            <div className="relative">
            <input
              type={showConfirmNewPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (e.target.value && e.target.value !== newPassword) {
                  setInlineConfirmError('Passwords do not match.');
                } else {
                  setInlineConfirmError('');
                }
              }}
              placeholder="Confirm new password"
              className="w-full px-4 py-2.5 pr-10 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
              aria-label={showConfirmNewPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showConfirmNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            </div>
            {inlineConfirmError && <p className="text-xs text-destructive mt-1">{inlineConfirmError}</p>}
          </div>
          <button
            type="submit"
            disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {passwordLoading ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </form>

      {/* Password Confirmation Modal */}
      {showPasswordConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-foreground text-center mb-2">Change Password</h3>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Are you sure you want to change your password?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowPasswordConfirm(false)}
                className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmUpdatePassword}
                className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
