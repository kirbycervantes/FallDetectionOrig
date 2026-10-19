import { useState, useEffect } from 'react';
import { Plus, Phone, Mail, Edit2, Trash2, UserPlus, Save } from 'lucide-react';
import { formatPhoneNumber } from '../../lib/formatPhone';
import { db, ref, onValue, push, set, remove } from '../../lib/db';
import { useConfirm } from './ui/confirm-dialog';
import { validDate } from '../../lib/time';
import { timeAgo, useNow } from '../../lib/deviceStatus';

interface Contact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

interface EmergencyContactsProps {
  familyId: string;
  /** Admin read-only view: contacts can be seen but not added or removed. */
  readOnly?: boolean;
  /** the family's device: the hub reports how many contacts it has, shown under the title */
  deviceId?: string;
}

const inputClass =
  'w-full px-4 py-3 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';

export function EmergencyContacts({ familyId, readOnly = false, deviceId }: EmergencyContactsProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [hub, setHub] = useState<{ count: number | null; at: Date | null }>({ count: null, at: null });
  const now = useNow(5000);
  const [confirm, confirmDialog] = useConfirm();

  // Form: null = closed, 'new' = adding, otherwise the id of the contact being edited
  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, `families/${familyId}/contacts`), (snapshot) => {
      const data = snapshot.val() || {};
      setContacts(
        Object.keys(data).map((key) => ({
          id: key,
          name: data[key]?.name || '',
          relationship: data[key]?.relationship || '',
          phone: data[key]?.phone || '',
          email: data[key]?.email || '',
        }))
      );
    });
    return () => unsubscribe();
  }, [familyId]);

  // what the hub says it has (it writes contactCount / contactsSyncedAt every time it checks)
  useEffect(() => {
    if (!deviceId) return;
    const unsub = onValue(ref(db, `devices/${deviceId}`), (snap) => {
      const v = snap.val() || {};
      setHub({
        count: typeof v.contactCount === 'number' ? v.contactCount : null,
        at: validDate(v.contactsSyncedAt),
      });
    });
    return () => unsub();
  }, [deviceId]);

  const openAdd = () => {
    setFormMode('new');
    setName('');
    setRelationship('');
    setPhone('');
    setEmail('');
    setFormError('');
  };

  const openEdit = (c: Contact) => {
    setFormMode(c.id);
    setName(c.name);
    setRelationship(c.relationship);
    setPhone(c.phone ? formatPhoneNumber(c.phone) : '');
    setEmail(c.email);
    setFormError('');
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError('');
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const digits = phone.replace(/\D/g, '');
    if (!trimmedName) return setFormError('Please enter a name.');
    if (digits.length !== 12) return setFormError('Please enter a complete phone number (+63 9XX XXX XXXX).');
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setFormError('Please enter a valid email address or leave it empty.');
    }
    setFormError('');

    const isNew = formMode === 'new';
    const ok = await confirm({
      title: isNew ? 'Add this contact?' : 'Save changes?',
      message: (
        <>
          <strong className="text-foreground">{trimmedName}</strong>
          {relationship.trim() && <> ({relationship.trim()})</>}
          <br />
          {phone}
        </>
      ),
      confirmLabel: isNew ? 'Add Contact' : 'Save Changes',
      icon: isNew ? <UserPlus className="size-6" /> : <Save className="size-6" />,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const data = { name: trimmedName, relationship: relationship.trim(), phone, email: email.trim() };
      if (isNew) {
        await set(push(ref(db, `families/${familyId}/contacts`)), data);
      } else {
        await set(ref(db, `families/${familyId}/contacts/${formMode}`), data);
      }
      closeForm();
    } catch (err: any) {
      setFormError(err?.message || 'Could not save the contact.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (contact: Contact) => {
    const ok = await confirm({
      title: 'Delete this contact?',
      message: (
        <>
          <strong className="text-foreground">{contact.name}</strong> will be removed from your emergency contacts.
          This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
      icon: <Trash2 className="size-6" />,
    });
    if (!ok) return;
    await remove(ref(db, `families/${familyId}/contacts/${contact.id}`));
    if (formMode === contact.id) closeForm();
  };

  const getAvatarColor = (index: number) => {
    const colors = ['bg-primary', 'bg-warning', 'bg-success', 'bg-secondary'];
    return colors[index % colors.length];
  };

  const form = (
    <div className="bg-card border border-primary/30 rounded-2xl p-4 md:p-6 shadow-sm">
      <h3 className="font-semibold mb-4 text-foreground">
        {formMode === 'new' ? 'New Emergency Contact' : 'Edit Contact'}
      </h3>
      {formError && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
          {formError}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <input type="text" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <input type="text" placeholder="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} className={inputClass} />
        <input
          type="tel"
          placeholder="+63 917 123 4567"
          value={phone || '+63'}
          onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
          className={inputClass}
        />
        <input type="email" placeholder="Email Address (optional)" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </div>
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition disabled:opacity-60"
        >
          {saving ? 'Saving...' : formMode === 'new' ? 'Save Contact' : 'Save Changes'}
        </button>
        <button
          onClick={closeForm}
          className="px-6 py-2.5 bg-muted border border-border rounded-xl hover:bg-muted/80 text-muted-foreground transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // is the hub up to date? (you cannot see the hub's serial monitor, so the page tells you)
  let hubNote: { text: string; warn: boolean } | null = null;
  if (deviceId) {
    const plural = (n: number) => `${n} contact${n === 1 ? '' : 's'}`;
    if (hub.count === null) {
      hubNote = { text: 'Central hub: it has not reported its contact list yet. It checks for changes about every 15 seconds while it is online.', warn: false };
    } else if (hub.count !== contacts.length) {
      hubNote = {
        text: `Central hub has ${plural(hub.count)}, the website has ${plural(contacts.length)}. The hub checks about every 15 seconds while online, so wait a moment. If it stays different, the hub may be offline, or it skips invalid or duplicate numbers.`,
        warn: true,
      };
    } else {
      hubNote = { text: `Central hub has the latest list (${plural(hub.count)}), checked ${hub.at ? timeAgo(hub.at, now) : 'recently'}.`, warn: false };
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">Emergency Network</h2>
          <p className="text-sm text-muted-foreground">
            {contacts.length} contact{contacts.length === 1 ? '' : 's'} registered
          </p>
          {hubNote && (
            <p className={`mt-1 text-xs ${hubNote.warn ? 'text-warning' : 'text-muted-foreground'}`}>{hubNote.text}</p>
          )}
        </div>
        {!readOnly && formMode !== 'new' && (
          <button
            onClick={openAdd}
            className="self-start sm:self-auto flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition shadow-sm"
          >
            <Plus className="size-4" />
            <span>Add Contact</span>
          </button>
        )}
      </div>

      {formMode === 'new' && form}

      {/* Contact Cards */}
      <div className="space-y-4">
        {contacts.map((contact, index) =>
          formMode === contact.id ? (
            <div key={contact.id}>{form}</div>
          ) : (
            <div
              key={contact.id}
              className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-5">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`shrink-0 size-12 md:size-14 rounded-xl flex items-center justify-center font-bold text-lg text-white ${getAvatarColor(index)}`}>
                    {contact.name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg text-foreground truncate">{contact.name}</h3>
                    <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(contact)}
                      aria-label={`Edit ${contact.name}`}
                      title="Edit"
                      className="p-2.5 hover:bg-muted rounded-xl transition border border-transparent hover:border-border"
                    >
                      <Edit2 className="size-4 text-muted-foreground hover:text-foreground" />
                    </button>
                    <button
                      onClick={() => handleDelete(contact)}
                      aria-label={`Delete ${contact.name}`}
                      title="Delete"
                      className="p-2.5 hover:bg-destructive/10 rounded-xl transition border border-transparent hover:border-destructive/30"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-xl">
                  <Phone className="size-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                    <p className="text-sm font-medium text-foreground">{contact.phone}</p>
                  </div>
                </div>
                {contact.email && (
                  <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-xl min-w-0">
                    <Mail className="size-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                      <p className="text-sm font-medium text-foreground truncate">{contact.email}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {contacts.length === 0 && formMode !== 'new' && (
        <div className="bg-card border border-border rounded-2xl p-10 md:p-16 text-center shadow-sm">
          <div className="inline-flex p-6 bg-muted rounded-2xl mb-4">
            <Phone className="size-12 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground mb-6">No personal emergency contacts added yet</p>
          {!readOnly && (
            <button
              onClick={openAdd}
              className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition"
            >
              Add Your First Contact
            </button>
          )}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
