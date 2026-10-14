import { useState } from 'react';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { useConfirm } from './ui/confirm-dialog';

interface ForgotPasswordProps {
  initialEmail?: string;
  onBack: () => void;
}

const inputClass =
  'w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm';

/** Forgot password: enter the account email -> Firebase sends a password reset link. */
export function ForgotPassword({ initialEmail = '', onBack }: ForgotPasswordProps) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const errorText = (err: any) => {
    switch (err?.code) {
      case 'auth/invalid-email': return 'Please enter a valid email address.';
      case 'auth/user-not-found': return 'No account uses this email. Please check it and try again.';
      case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes and try again.';
      case 'auth/network-request-failed': return 'Network error. Check your internet connection.';
      default: return err?.message || 'Something went wrong. Please try again.';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Please enter a valid email address.');
      return;
    }
    const ok = await confirm({
      title: 'Send reset link?',
      message: <>A password reset link will be sent to <strong className="text-foreground">{address}</strong>.</>,
      confirmLabel: 'Send Link',
      icon: <Mail className="size-6" />,
    });
    if (!ok) return;

    setLoading(true);
    try {
      const { auth } = await import('../../lib/firebase');
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, address);
      setSentTo(address);
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to sign in
      </button>

      {sentTo ? (
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center size-14 bg-success/10 text-success rounded-xl mb-4">
            <CheckCircle className="size-7" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Check your email</h3>
          <p className="text-sm text-muted-foreground mb-1">
            If an account exists, a password reset link was sent to <strong className="text-foreground">{sentTo}</strong>.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            Open the link to choose a new password, then sign in again. Check your Spam folder if you don't see it.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <>
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-foreground">Reset your password</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the email you use to sign in and we will send you a reset link.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Mail className="size-3.5" /> Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="caregiver@example.com"
                autoFocus
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors disabled:opacity-70"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        </>
      )}

      {confirmDialog}
    </div>
  );
}
