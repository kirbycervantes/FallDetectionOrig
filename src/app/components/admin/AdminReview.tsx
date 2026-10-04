import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue, update, push, set } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { auth } from "../../../lib/firebase";
import { CheckCircle, XCircle, Clock } from "lucide-react";

interface ReviewRequest {
  id: string;
  familyId: string;
  caregiverUid: string;
  caregiverName: string;
  caregiverEmail: string;
  deviceSerialNumber: string;
  monitoredPersonName: string;
  createdAt: string;
  status: 'pending_review' | 'approved' | 'rejected';
}

export function AdminReview() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const queueRef = ref(db, 'admin/registrationQueue');
    const unsub = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const parsed = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        }));
        // Sort by pending first, then date descending
        parsed.sort((a, b) => {
          if (a.status === 'pending_review' && b.status !== 'pending_review') return -1;
          if (a.status !== 'pending_review' && b.status === 'pending_review') return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        setRequests(parsed);
      } else {
        setRequests([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleAction = async (request: ReviewRequest, action: 'approved' | 'rejected') => {
    if (!confirm(`Are you sure you want to mark this registration as ${action}?`)) return;

    try {
      console.log(`Processing ${action} for request:`, request);
      
      // We will perform an atomic multi-path update at the root level
      const updates: any = {};
      
      // 1. Always update the queue status
      updates[`admin/registrationQueue/${request.id}/status`] = action;
      
      if (action === 'approved') {
        // 2. Grant access and add to caregivers
        updates[`users/${request.caregiverUid}/accessStatus`] = 'active';
        updates[`families/${request.familyId}/caregivers/${request.caregiverUid}`] = {
          name: request.caregiverName,
          email: request.caregiverEmail,
          role: 'caregiver',
          joinedAt: new Date().toISOString()
        };
      } else if (action === 'rejected') {
        // 2. Suspend the family and user so they can't log in
        updates[`families/${request.familyId}/status`] = 'suspended';
        updates[`users/${request.caregiverUid}/accessStatus`] = 'suspended';
      }

      // Perform atomic update
      await update(ref(db), updates);
      console.log('Atomic update successful:', updates);

      // 3. Log the action separately (since it uses a push key, it's easier to do this after)
      const user = auth.currentUser;
      if (user) {
        const logRef = push(ref(db, 'admin/auditLog'));
        await set(logRef, {
          action: action === 'approved' ? 'Approved Registration' : 'Rejected Registration',
          adminId: user.uid,
          adminEmail: user.email,
          targetId: request.familyId,
          targetDevice: request.deviceSerialNumber,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to process review:', err);
      alert('Failed to process action due to permissions or database error. Check console for details.');
    }
  };

  return (
    <AdminLayout>
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and approve new caregiver accounts</p>
        </div>

        {loading ? (
          <div className="mt-8"><SkeletonTable rows={5} /></div>
        ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Caregiver</th>
                  <th className="font-medium px-6 py-4">Monitored Person</th>
                  <th className="font-medium px-6 py-4">Device Serial</th>
                  <th className="font-medium px-6 py-4">Date</th>
                  <th className="font-medium px-6 py-4">Status</th>
                  <th className="font-medium px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      No registrations in the queue
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{req.caregiverName}</div>
                        <div className="text-xs text-muted-foreground">{req.caregiverEmail}</div>
                      </td>
                      <td className="px-6 py-4 text-foreground font-medium">{req.monitoredPersonName}</td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{req.deviceSerialNumber}</td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(req.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          req.status === 'pending_review' ? 'bg-amber-500/10 text-amber-500' :
                          req.status === 'approved' ? 'bg-success/10 text-success' :
                          'bg-destructive/10 text-destructive'
                        }`}>
                          {req.status === 'pending_review' && <Clock className="size-3" />}
                          {req.status === 'approved' && <CheckCircle className="size-3" />}
                          {req.status === 'rejected' && <XCircle className="size-3" />}
                          {req.status.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {req.status === 'pending_review' && (
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleAction(req, 'approved')}
                              className="px-3 py-1.5 bg-success/10 hover:bg-success/20 text-success rounded-md font-medium text-xs transition-colors"
                            >
                              Approve
                            </button>
                            <button 
                              onClick={() => handleAction(req, 'rejected')}
                              className="px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md font-medium text-xs transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </AdminLayout>
  );
}
