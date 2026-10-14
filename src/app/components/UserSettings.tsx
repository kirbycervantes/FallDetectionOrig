import { useState, useEffect } from 'react';
import { User, Mail, Lock, Phone, CheckCircle, AlertCircle, Eye, EyeOff, HelpCircle, Trash2, Ticket, Send, X, AlertTriangle } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { db, ref, update, push, set, onValue } from '../../lib/db';
import {
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { useConfirm } from './ui/confirm-dialog';
import { removePhoneIndex, savePhoneIndex } from '../../lib/phoneIndex';

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

  // Field-level inline validation errors
  const [inlineEmailError, setInlineEmailError] = useState('');
  const [inlinePhoneError, setInlinePhoneError] = useState('');
  const [inlinePasswordError, setInlinePasswordError] = useState('');
  const [inlineConfirmError, setInlineConfirmError] = useState('');

  // Support Ticket
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Account Deletion Request
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountMsg, setDeleteAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [currentPhone, setCurrentPhone] = useState<string>('');
  const [confirm, confirmDialog] = useConfirm();

  const user = auth.currentUser;

  useEffect(() => {
    if (user) {
      const userRef = ref(db, `users/${user.uid}`);
      const unsub = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
          setFamilyId(snapshot.val().familyId || null);
          setCurrentPhone(snapshot.val().phone || '');
        }
      });
      return () => unsub();
    }
  }, [user]);

  const handleSubmitTicket = async (e: React.FormEvent, isDeletionRequest = false) => {
    e.preventDefault();
    if (!user) return;
    
    const subject = isDeletionRequest ? 'ACCOUNT DELETION REQUEST' : ticketSubject.trim();
    const description = isDeletionRequest ? deleteReason.trim() : ticketDescription.trim();

    if (!subject || (!description && !isDeletionRequest)) {
      if (isDeletionRequest) {
        setDeleteAccountMsg({ type: 'error', text: 'Please provide a reason.' });
      } else {
        setTicketMsg({ type: 'error', text: 'Please fill in all fields.' });
      }
      return;
    }

    const ok = await confirm(
      isDeletionRequest
        ? {
            title: 'Send deletion request?',
            message: 'The administrator will be asked to remove your caregiver account from this family. You will lose access to the dashboard once it is approved.',
            confirmLabel: 'Send Request',
            tone: 'danger',
          }
        : {
            title: 'Submit this ticket?',
            message: <>Subject: <strong className="text-foreground">{subject}</strong><br />The administrator will see your message and email address.</>,
            confirmLabel: 'Submit Ticket',
            icon: <Ticket className="size-6" />,
          }
    );
    if (!ok) return;

    if (isDeletionRequest) setDeleteAccountLoading(true);
    else setTicketLoading(true);

    try {
      const ticketRef = push(ref(db, 'admin/tickets'));
      const ticketDescription = isDeletionRequest
        ? `Reason: ${description || 'No reason provided'}\n\n⚠️ CAREGIVER REMOVAL REQUEST (not full family deletion)\nRemove ONLY this caregiver from the family.\nCaregiver: ${user.email} (UID: ${user.uid})\nFamily ID: ${familyId || 'Unknown'}\n\nUse "Manage Caregivers" in Admin Families to remove this individual caregiver.`
        : `${description}\n\nSubmitted by User: ${user.email} (UID: ${user.uid})`;
      await set(ticketRef, {
        title: subject,
        description: ticketDescription,
        familyId: familyId || user.uid,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      
      if (isDeletionRequest) {
        setDeleteAccountMsg({ type: 'success', text: 'Your account deletion request has been submitted to the admins.' });
        setDeleteReason('');
        setTimeout(() => { setShowDeleteAccountModal(false); setDeleteAccountMsg(null); }, 2000);
      } else {
        setTicketMsg({ type: 'success', text: 'Your support ticket has been submitted.' });
        setTicketSubject('');
        setTicketDescription('');
        setTimeout(() => { setShowSupportModal(false); setTicketMsg(null); }, 2000);
      }
    } catch (err: any) {
      if (isDeletionRequest) setDeleteAccountMsg({ type: 'error', text: 'Failed to submit request.' });
      else setTicketMsg({ type: 'error', text: 'Failed to submit ticket.' });
    } finally {
      if (isDeletionRequest) setDeleteAccountLoading(false);
      else setTicketLoading(false);
    }
  };

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
      icon: <Mail className="size-6" />,
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

    const phoneRegex = /^09\d{9}$/;
    if (!phoneRegex.test(newPhone.trim())) {
      setPhoneMsg({ type: 'error', text: 'Phone number must contain exactly 11 digits and start with 09 (e.g., 09123456789).' });
      return;
    }

    const ok = await confirm({
      title: 'Change your phone number?',
      message: <>{currentPhone ? <>From <strong className="text-foreground">{currentPhone}</strong> to </> : <>New number: </>}<strong className="text-foreground">{newPhone.trim()}</strong></>,
      confirmLabel: 'Update Number',
      icon: <Phone className="size-6" />,
    });
    if (!ok) return;

    setPhoneLoading(true);
    setPhoneMsg(null);
    try {
      await update(ref(db, `users/${user.uid}`), { phone: newPhone.trim() });
      // keep "Forgot password -> use phone number" pointing at this account
      if (currentPhone && currentPhone !== newPhone.trim()) await removePhoneIndex(currentPhone);
      await savePhoneIndex(newPhone.trim(), user.uid, user.email);
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
            <p className="text-sm font-medium text-foreground">{currentPhone || '—'}</p>
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
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => {
                setNewPhone(e.target.value);
                const val = e.target.value;
                if (val.trim() && !/^09\d{9}$/.test(val.trim())) {
                  setInlinePhoneError('Phone number must contain exactly 11 digits and start with 09.');
                } else {
                  setInlinePhoneError('');
                }
              }}
              placeholder="09123456789"
              className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
              required
            />
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
            <input
              type="password"
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
              className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
              required
            />
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

      {/* Support & Account Section */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <HelpCircle className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Support & Account</h3>
            <p className="text-xs text-muted-foreground">Get help or manage your account status</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border rounded-xl bg-muted/30">
            <div>
              <p className="font-medium text-sm text-foreground">Contact Support</p>
              <p className="text-xs text-muted-foreground mt-0.5">Submit a ticket to our administration team.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              Submit Ticket
            </button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-destructive/20 rounded-xl bg-destructive/5">
            <div>
              <p className="font-medium text-sm text-destructive">Delete Account</p>
              <p className="text-xs text-muted-foreground mt-0.5">Permanently remove your account and data.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteAccountModal(true)}
              className="px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              Request Deletion
            </button>
          </div>
        </div>
      </div>

      {/* Password Confirmation Modal */}
      {showPasswordConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <div className="flex items-center justify-center size-12 bg-primary/10 rounded-xl mx-auto mb-4">
              <Lock className="size-6 text-primary" />
            </div>
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

      {/* Support Ticket Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Ticket className="size-5" />
                </div>
                <h3 className="font-semibold text-foreground">Submit a Ticket</h3>
              </div>
              <button onClick={() => setShowSupportModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>
            <form onSubmit={(e) => handleSubmitTicket(e, false)} className="p-6 overflow-y-auto">
              <Feedback msg={ticketMsg} />
              <div className="space-y-4 mt-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Subject</label>
                  <input
                    type="text"
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Briefly describe the issue"
                    className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
                  <textarea
                    value={ticketDescription}
                    onChange={(e) => setTicketDescription(e.target.value)}
                    placeholder="Provide details about your request or issue..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition text-sm resize-none"
                    required
                  />
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ticketLoading}
                  className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {ticketLoading ? (
                     <span className="size-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    <><Send className="size-4" /> Submit</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Account Deletion Modal */}
      {showDeleteAccountModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center p-6 pb-8">
              <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle className="size-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Request Account Removal</h3>
              <p className="text-sm text-muted-foreground mb-1">
                This will submit a request to remove <strong className="text-foreground">your caregiver account</strong> from the family.
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Other caregivers assigned to the same monitored person will not be affected.
              </p>
              
              <Feedback msg={deleteAccountMsg} />
              
              <form onSubmit={(e) => handleSubmitTicket(e, true)} className="w-full text-left mt-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">Reason for leaving (optional)</label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Help us improve by telling us why..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-destructive focus:ring-1 focus:ring-destructive transition text-sm resize-none mb-6"
                />
                
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => { setShowDeleteAccountModal(false); setDeleteReason(''); setDeleteAccountMsg(null); }}
                    disabled={deleteAccountLoading}
                    className="flex-1 py-2.5 px-4 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-xl transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={deleteAccountLoading}
                    className="flex-1 py-2.5 px-4 text-sm font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center"
                  >
                    {deleteAccountLoading ? (
                      <span className="size-4 border-2 border-destructive-foreground/30 border-t-destructive-foreground rounded-full animate-spin" />
                    ) : (
                      "Submit Request"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
