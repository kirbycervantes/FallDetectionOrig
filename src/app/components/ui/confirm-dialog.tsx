import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

/**
 * One confirmation dialog used everywhere on the caregiver website so that
 * no action happens from a single accidental click.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (await confirm({ title: 'Delete contact?', message: '…', tone: 'danger' })) { … }
 *   return <>{…}{confirmDialog}</>;
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = red confirm button (delete, sign out, …) */
  tone?: 'primary' | 'danger';
  /** null = no icon at all */
  icon?: ReactNode | null;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  icon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Focus "Cancel" first: pressing Enter by accident never confirms.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const danger = tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {icon !== null && (
          <div
            className={`flex items-center justify-center size-12 rounded-xl mx-auto mb-4 ${
              danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}
          >
            {icon ?? (danger ? <AlertTriangle className="size-6" /> : <HelpCircle className="size-6" />)}
          </div>
        )}
        <h3 id="confirm-title" className="text-lg font-semibold text-foreground text-center mb-2">
          {title}
        </h3>
        {message && <div className="text-sm text-muted-foreground text-center mb-6">{message}</div>}
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors ${
              danger
                ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Promise-based confirmation: `if (await confirm({...})) doIt();` */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    []
  );

  const close = useCallback(
    (result: boolean) => {
      setState((current) => {
        current?.resolve(result);
        return null;
      });
    },
    []
  );

  const dialog = (
    <ConfirmDialog
      open={!!state}
      title={state?.title ?? ''}
      message={state?.message}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.tone}
      icon={state?.icon}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return [confirm, dialog];
}
