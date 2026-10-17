import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AdminLayout } from "./AdminLayout";
import { StatusBadge } from "./StatusBadge";
import { BatteryBadge } from "../BatteryBadge";
import { SkeletonTable } from "../ui/skeleton";
import { db, ref, onValue, push, set, update } from "../../../lib/db";
import { auth } from "../../../lib/firebase";
import { useNow } from "../../../lib/deviceStatus";
import { familyDeviceId, personName, batteryLevels, deviceState } from "./adminData";
import { Search, Filter, CalendarDays, ShieldCheck, AlertTriangle, Users } from "lucide-react";

interface Family {
  id: string;
  name: string;
  deviceId: string;
  status: "online" | "offline" | "low_battery";
  accountStatus: "active" | "suspended";
  wearableBattery: number | null;
  hubBattery: number | null;
  createdAt: string;
  totalIncidents: number;
  caregiverUids: string[];
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

export function AdminFamilies() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterDate, setFilterDate] = useState("all");

  // Suspend family modal state
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendFamily, setSuspendFamily] = useState<Family | null>(null);

  // View as family modal state
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewFamily, setViewFamily] = useState<Family | null>(null);

  const navigate = useNavigate();
  const now = useNow(5000);
  const nowRef = useRef(now);
  nowRef.current = now;
  const recomputeRef = useRef<(() => void) | null>(null);
  // re-evaluate online/offline every few seconds WITHOUT re-subscribing to Firebase (re-subscribing made the page flicker)
  useEffect(() => { recomputeRef.current?.(); }, [now]);

  useEffect(() => {
    let currentFamilies: any = {};
    let currentDevices: any = {};
    let currentEvents: any = {};

    const updateFamiliesList = () => {
      const parsedFamilies: Family[] = [];

      Object.keys(currentFamilies).forEach(key => {
        const f = currentFamilies[key] || {};
        const deviceId = familyDeviceId(f);
        const device = deviceId ? currentDevices[deviceId] : undefined;
        const deviceEvents = (deviceId && currentEvents[deviceId]) || {};

        const levels = batteryLevels(device);
        const status = deviceId ? deviceState(device, nowRef.current) : "offline";

        const realIncidents = Object.values(deviceEvents).filter((e: any) =>
          e.status !== 'cancelled' && e.status !== 'emergency'
        ).length;
        const totalIncidents = Math.max(0, realIncidents + (f.incidentOffset || 0));

        parsedFamilies.push({
          id: key,
          name: personName(f, device),
          deviceId: deviceId || "Unlinked",
          status,
          accountStatus: f.status === 'suspended' ? 'suspended' : 'active',
          wearableBattery: deviceId ? Math.round(levels.wearable) : null,
          hubBattery: deviceId ? Math.round(levels.hub) : null,
          createdAt: f.createdAt,
          totalIncidents,
          caregiverUids: f.caregivers ? Object.keys(f.caregivers) : [],
        });
      });

      // Newest registrations first
      parsedFamilies.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      setFamilies(parsedFamilies);
      setLoading(false);
    };

    recomputeRef.current = updateFamiliesList;
    const unsubFamilies = onValue(ref(db, 'families'), (snapshot) => {
      currentFamilies = snapshot.val() || {};
      updateFamiliesList();
    });
    const unsubDevices = onValue(ref(db, 'devices'), (snapshot) => {
      currentDevices = snapshot.val() || {};
      updateFamiliesList();
    });
    const unsubEvents = onValue(ref(db, 'events'), (snapshot) => {
      currentEvents = snapshot.val() || {};
      updateFamiliesList();
    });

    return () => {
      unsubFamilies();
      unsubDevices();
      unsubEvents();
    };
  }, []);

  const filteredFamilies = families.filter(f => {
    const q = norm(search);
    const matchesSearch = !q || norm(f.name).includes(q) || norm(f.deviceId).includes(q);
    const matchesStatus = filterStatus === "all" || f.status === filterStatus;
    const matchesAccount = filterAccount === "all" || f.accountStatus === filterAccount;
    let matchesDate = true;
    if (filterDate !== "all") {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - (Number(filterDate) - 1));
      const registered = Date.parse(f.createdAt);
      matchesDate = Number.isFinite(registered) && registered >= cutoff.getTime();
    }
    return matchesSearch && matchesStatus && matchesAccount && matchesDate;
  });

  const handleToggleSuspend = (family: Family) => {
    setSuspendFamily(family);
    setShowSuspendModal(true);
  };

  const confirmToggleSuspend = async () => {
    if (!suspendFamily) return;

    const newStatus = suspendFamily.accountStatus === 'active' ? 'suspended' : 'active';

    try {
      await update(ref(db, `families/${suspendFamily.id}`), { status: newStatus });

      for (const uid of suspendFamily.caregiverUids) {
        await update(ref(db, `users/${uid}`), { accessStatus: newStatus });
      }

      const user = auth.currentUser;
      if (user) {
        const logRef = push(ref(db, 'admin/auditLog'));
        await set(logRef, {
          action: newStatus === 'suspended' ? 'Suspended Family' : 'Reactivated Family',
          adminId: user.uid,
          adminEmail: user.email,
          targetId: suspendFamily.id,
          targetDevice: suspendFamily.deviceId,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to toggle suspension:', err);
    } finally {
      setShowSuspendModal(false);
      setSuspendFamily(null);
    }
  };

  const handleConfirmViewFamily = async () => {
    if (!viewFamily) return;

    const user = auth.currentUser;
    if (user) {
      const logRef = push(ref(db, 'admin/auditLog'));
      await set(logRef, {
        action: "View as Family",
        adminId: user.uid,
        adminEmail: user.email,
        targetId: viewFamily.id,
        targetDevice: viewFamily.deviceId,
        timestamp: new Date().toISOString()
      });
    }

    setShowViewModal(false);
    navigate(`/admin/family/${viewFamily.id}`);
  };

  const selectCls = "pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary appearance-none cursor-pointer text-foreground h-[38px]";
  const filtersOn = search || filterStatus !== "all" || filterAccount !== "all" || filterDate !== "all";

  return (
    <AdminLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Families</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage registered families and their devices</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search families or devices..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary w-full md:w-64"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} aria-label="Account status" className={selectCls}>
                <option value="all">All Accounts</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="relative">
              <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} aria-label="Date registered" className={selectCls}>
                <option value="all">Any Date Registered</option>
                <option value="1">Today</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>
          </div>
        </div>

        {/* Families Table */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-center text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Person monitored</th>
                  <th className="font-medium px-6 py-4">MAC Address</th>
                  <th className="font-medium px-6 py-4">Total Falls</th>
                  <th className="font-medium px-6 py-4">Account</th>
                  <th className="font-medium px-6 py-4">Registered Date</th>
                  <th className="font-medium px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredFamilies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      {filtersOn ? "No families matched your filters" : "No families registered yet"}
                    </td>
                  </tr>
                ) : (
                  filteredFamilies.map((family) => (
                    <tr key={family.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-foreground font-medium">{family.name}</td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{family.deviceId}</td>
                      <td className="px-6 py-4 text-foreground font-medium">{family.totalIncidents}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          family.accountStatus === 'active'
                            ? 'bg-success/10 text-success'
                            : 'bg-destructive/10 text-destructive'
                        }`}>
                          {family.accountStatus === 'active' ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {family.createdAt ? new Date(family.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => handleToggleSuspend(family)}
                            className={`font-medium text-sm transition-colors ${
                              family.accountStatus === 'active'
                                ? 'text-destructive hover:text-destructive/80'
                                : 'text-success hover:text-success/80'
                            }`}
                          >
                            {family.accountStatus === 'active' ? 'Suspend' : 'Activate'}
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
        )}
      </div>

      {/* View as Family Confirmation Modal */}
      {showViewModal && viewFamily && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center p-6 pb-8">
              <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Users className="size-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Impersonate Family</h3>
              <p className="text-sm text-muted-foreground mb-6">
                You are about to view the dashboard for <strong className="text-foreground">{viewFamily.name}</strong>.
                This action will be recorded in the audit log for security purposes.
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    setViewFamily(null);
                  }}
                  className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmViewFamily}
                  className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Suspend/Activate Family Modal */}
      {showSuspendModal && suspendFamily && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center p-6 pb-8">
              <div className={`size-12 rounded-full flex items-center justify-center mb-4 ${suspendFamily.accountStatus === 'active' ? 'bg-destructive/10' : 'bg-success/10'}`}>
                {suspendFamily.accountStatus === 'active' ? (
                  <AlertTriangle className="size-6 text-destructive" />
                ) : (
                  <ShieldCheck className="size-6 text-success" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {suspendFamily.accountStatus === 'active' ? 'Suspend Family' : 'Reactivate Family'}
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                {suspendFamily.accountStatus === 'active' ? (
                  <>
                    Are you sure you want to suspend <strong className="text-foreground">{suspendFamily.name}</strong>?
                    All caregivers assigned to this family will immediately lose access to the application.
                  </>
                ) : (
                  <>
                    Are you sure you want to reactivate <strong className="text-foreground">{suspendFamily.name}</strong>?
                    All caregivers assigned to this family will regain full access to the application.
                  </>
                )}
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowSuspendModal(false);
                    setSuspendFamily(null);
                  }}
                  className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmToggleSuspend}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors ${
                    suspendFamily.accountStatus === 'active'
                      ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                      : 'bg-success hover:bg-success/90 text-success-foreground'
                  }`}
                >
                  {suspendFamily.accountStatus === 'active' ? 'Suspend Access' : 'Reactivate Access'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
