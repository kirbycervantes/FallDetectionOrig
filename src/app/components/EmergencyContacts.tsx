import { useState, useEffect } from 'react';
import { Plus, User, Phone, Mail, Clock, AlertCircle, Edit2, Trash2, Shield } from 'lucide-react';
import { formatPhoneNumber } from '../../lib/formatPhone';
import { db, ref, onValue, push, set, remove } from '../../lib/db';

interface Contact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  isDefault?: boolean;
}

interface EmergencyContactsProps {
  familyId: string;
}

// Default emergency contacts available for all users
const DEFAULT_EMERGENCY_CONTACTS: Omit<Contact, 'id'>[] = [];

export function EmergencyContacts({ familyId }: EmergencyContactsProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form State
  const [newName, setNewName] = useState('');
  const [newRelationship, setNewRelationship] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  
  useEffect(() => {
    const contactsRef = ref(db, `families/${familyId}/contacts`);
    const unsubscribe = onValue(contactsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const parsedContacts: Contact[] = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        }));
        setContacts(parsedContacts);
      } else {
        setContacts([]);
      }
    });
    
    return () => unsubscribe();
  }, [familyId]);

  const handleAddContact = async () => {
    if (!newName || !newPhone) return;
    
    const contactsRef = ref(db, `families/${familyId}/contacts`);
    const newContactRef = push(contactsRef);
    
    const newContact = {
      name: newName,
      relationship: newRelationship,
      phone: newPhone,
      email: newEmail,
    };
    
    await set(newContactRef, newContact);
    
    // Reset form
    setNewName('');
    setNewRelationship('');
    setNewPhone('');
    setNewEmail('');
    setShowAddForm(false);
  };
  
  const handleDeleteContact = async (id: string) => {
    const contactRef = ref(db, `families/${familyId}/contacts/${id}`);
    await remove(contactRef);
  };

  // Combine default emergency contacts with user-added contacts
  const defaultContacts: Contact[] = DEFAULT_EMERGENCY_CONTACTS.map((c, i) => ({
    ...c,
    id: `default-${i}`,
  }));

  const allContacts = [...contacts];

  const getAvatarColor = (index: number) => {
    const colors = ['bg-primary', 'bg-warning', 'bg-success', 'bg-secondary'];
    return colors[index % colors.length];
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-foreground">Emergency Network</h2>
          <p className="text-sm text-muted-foreground">All contacts are notified simultaneously when a fall is detected</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition shadow-sm"
        >
          <Plus className="size-4" />
          <span>Add Contact</span>
        </button>
      </div>
      
      {/* Add Contact Form */}
      {showAddForm && (
        <div className="bg-card border border-primary/30 rounded-2xl p-6 shadow-sm">
          <h3 className="font-semibold mb-6 text-foreground">New Emergency Contact</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Full Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-4 py-3 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
            />
            <input
              type="text"
              placeholder="Relationship"
              value={newRelationship}
              onChange={(e) => setNewRelationship(e.target.value)}
              className="px-4 py-3 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
            />
            <input
              type="tel"
              placeholder="+63 917 123 4567"
              value={newPhone || '+63'}
              onChange={(e) => setNewPhone(formatPhoneNumber(e.target.value))}
              className="px-4 py-3 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
            />
            <input
              type="email"
              placeholder="Email Address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-4 py-3 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
            />
          </div>
          <div className="flex gap-3 mt-6">
            <button 
              onClick={handleAddContact}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition"
            >
              Save Contact
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-6 py-2.5 bg-muted border border-border rounded-xl hover:bg-muted/80 text-muted-foreground transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}


      
      {/* Contact Cards */}
      <div className="space-y-4">
        {/* User-Added Contacts */}
        {contacts.map((contact, index) => (
          <div key={contact.id} className="relative group">
            <div className="relative bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/30 transition-all">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className={`relative size-14 rounded-xl flex items-center justify-center font-bold text-lg text-white ${getAvatarColor(index)}`}>
                    {contact.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-lg text-foreground">{contact.name}</h3>
                    <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button className="p-2.5 hover:bg-muted rounded-xl transition border border-transparent hover:border-border">
                    <Edit2 className="size-4 text-muted-foreground hover:text-foreground" />
                  </button>
                  <button 
                    onClick={() => handleDeleteContact(contact.id)}
                    className="p-2.5 hover:bg-destructive/10 rounded-xl transition border border-transparent hover:border-destructive/30"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                </div>
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
                  <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-xl">
                    <Mail className="size-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                      <p className="text-sm font-medium text-foreground truncate">{contact.email}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {contacts.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-16 text-center shadow-sm">
          <div className="inline-flex p-6 bg-muted rounded-2xl mb-4">
            <Phone className="size-12 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground mb-6">No personal emergency contacts added yet</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition"
          >
            Add Your First Contact
          </button>
        </div>
      )}
    </div>
  );
}
