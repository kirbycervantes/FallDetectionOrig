import { useState, useEffect, useMemo } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue, update, push, set } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { auth } from "../../../lib/firebase";
import { useConfirm } from "../ui/confirm-dialog";

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
  const [confirm, confirmDialog] = useConfirm();
  const [historyDays, setHistoryDays] = useState("all");
  const [historyPage, setHistoryPage] = useState(1);
  const PAGE_SIZE = 10;

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
    const approving = action === 'approved';
    const ok = await confirm({
      title: approving ? 'Approve registration?' : 'Reject registration?',
      message: approving
        ? <>{request.caregiverName} will get access to the dashboard for <strong className="text-foreground">{request.monitoredPersonName}</strong>.</>
        : <>The family of {request.caregiverName} will be suspended and they will not be able to sign in.</>,
      confirmLabel: approving ? 'Approve' : 'Reject',
      tone: approving ? 'primary' : 'danger',
      icon: null,
    });
    if (!ok) return;

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

  const pending = requests.filter(r => r.status === 'pending_review');

  const history = useMemo(() => {
    let cutoff = 0;
    if (historyDays !== "all") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (Number(historyDays) - 1));
      cutoff = d.getTime();
    }
    return requests.filter(r => r.status !== 'pending_review' && new Date(r.createdAt).getTime() >= cutoff);
  }, [requests, historyDays]);

  useEffect(() => { setHistoryPage(1); }, [historyDays]);
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const currentPage = Math.min(historyPage, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = history.slice(pageStart, pageStart + PAGE_SIZE);

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
        <>
        {/* Pending */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-medium text-foreground">Pending review</h2>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Caregiver</th>
                  <th className="font-medium px-6 py-4">Monitored Person</th>
                  <th className="font-medium px-6 py-4">MAC Address</th>
                  <th className="font-medium px-6 py-4">Date</th>
                  <th className="font-medium px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pending.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      No registrations waiting for review
                    </td>
                  </tr>
                ) : (
                  pending.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{req.caregiverName}</div>
                        <div className="text-xs text-muted-foreground">{req.caregiverEmail}</div>
                      </td>
                      <td className="px-6 py-4 text-foreground font-medium">{req.monitoredPersonName}</td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{req.deviceSerialNumber}</td>
                      <td className="px-6 py-4 text-muted-foreground">{new Date(req.createdAt).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Approved / rejected history */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-medium text-foreground">Reviewed registrations</h2>
            <select
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value)}
              aria-label="Filter by days"
              className="px-3 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary cursor-pointer text-foreground h-[38px]"
            >
              <option value="all">All time</option>
              <option value="1">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Caregiver</th>
                  <th className="font-medium px-6 py-4">Monitored Person</th>
                  <th className="font-medium px-6 py-4">MAC Address</th>
                  <th className="font-medium px-6 py-4">Date</th>
                  <th className="font-medium px-6 py-4">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      No reviewed registrations
                    </td>
                  </tr>
                ) : (
                  pageRows.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{req.caregiverName}</div>
                        <div className="text-xs text-muted-foreground">{req.caregiverEmail}</div>
                      </td>
                      <td className="px-6 py-4 text-foreground font-medium">{req.monitoredPersonName}</td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{req.deviceSerialNumber}</td>
                      <td className="px-6 py-4 text-muted-foreground">{new Date(req.createdAt).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          req.status === 'approved' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        }`}>
                          {req.status === 'approved' ? 'Approved' : 'Rejected'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {history.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border px-6 py-4">
              <span className="text-sm text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, history.length)} of {history.length}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setHistoryPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-3 text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                  <button
                    onClick={() => setHistoryPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}
      </div>
      {confirmDialog}
    </AdminLayout>
  );
}
