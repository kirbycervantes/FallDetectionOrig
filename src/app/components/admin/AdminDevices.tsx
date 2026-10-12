import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { StatusBadge } from "./StatusBadge";
import { db, ref, onValue, set } from "../../../lib/db";
import { SkeletonTable } from "../ui/skeleton";
import { familyDeviceId, personName, batteryLevels, deviceState, flattenEvents } from "./adminData";
import { validDate } from "../../../lib/time";
import { Search, Filter, Battery, Wifi, WifiOff, X, Activity, HardDrive, Cpu, Radio, Plus, PackagePlus, Check, AlertCircle } from "lucide-react";

interface Device {
  id: string;
  status: "online" | "offline" | "low_battery";
  wearableBattery: number;
  hubBattery: number;
  lastUpdate: Date | null;
  familyId: string | null;
  patientName: string | null;
}

export function AdminDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // Provision modal state
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionSerial, setProvisionSerial] = useState("");
  const [provisionLabel, setProvisionLabel] = useState("");
  const [provisionNotes, setProvisionNotes] = useState("");
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const [provisionSuccess, setProvisionSuccess] = useState(false);

  useEffect(() => {
    let currentDevices: any = {};
    let currentFamilies: any = {};
    let currentEvents: any = {};
    const loaded = { devices: false, families: false };

    const updateDevicesList = () => {
      // Latest event per device (real time from the Firebase key)
      const lastEvent: Record<string, number> = {};
      flattenEvents(currentEvents).forEach(ev => {
        const t = ev.date.getTime();
        if (!lastEvent[ev.deviceId] || t > lastEvent[ev.deviceId]) lastEvent[ev.deviceId] = t;
      });

      // Every device in /devices plus any device linked to a family but not yet in /devices
      const ids = new Set<string>(Object.keys(currentDevices));
      Object.values(currentFamilies).forEach((f: any) => {
        const id = familyDeviceId(f);
        if (id) ids.add(id);
      });

      const parsedDevices: Device[] = [];
      ids.forEach(deviceId => {
        const d = currentDevices[deviceId] || {};

        const familyEntry = Object.entries(currentFamilies).find(([, f]: [string, any]) => familyDeviceId(f) === deviceId);
        const familyId = familyEntry ? familyEntry[0] : null;
        const fData = familyEntry ? (familyEntry[1] as any) : null;
        const name = fData ? personName(fData, d) : (d.user?.name || null);

        const levels = batteryLevels(d);

        // Last sync: device's lastUpdate if it is a real date, otherwise its latest event
        const reported = validDate(d.lastUpdate)?.getTime() ?? 0;
        const latest = Math.max(reported, lastEvent[deviceId] ?? 0);

        parsedDevices.push({
          id: deviceId,
          status: deviceState(d),
          wearableBattery: Math.round(levels.wearable),
          hubBattery: Math.round(levels.hub),
          lastUpdate: latest ? new Date(latest) : null,
          familyId,
          patientName: name === "Unknown" ? null : name,
        });
      });

      // Assigned devices first, then by serial
      parsedDevices.sort((a, b) => Number(!!b.familyId) - Number(!!a.familyId) || a.id.localeCompare(b.id));

      setDevices(parsedDevices);
      // keep the open Diagnostics window in sync too
      setSelectedDevice(prev => prev ? (parsedDevices.find(x => x.id === prev.id) ?? prev) : prev);
      if (loaded.devices && loaded.families) setLoading(false);
    };

    const unsubDevices = onValue(ref(db, 'devices'), (snapshot) => {
      currentDevices = snapshot.val() || {}; loaded.devices = true; updateDevicesList();
    });
    const unsubFamilies = onValue(ref(db, 'families'), (snapshot) => {
      currentFamilies = snapshot.val() || {}; loaded.families = true; updateDevicesList();
    });
    const unsubEvents = onValue(ref(db, 'events'), (snapshot) => {
      currentEvents = snapshot.val() || {}; updateDevicesList();
    });

    return () => {
      unsubDevices();
      unsubFamilies();
      unsubEvents();
    };
  }, []);

  const filteredDevices = devices.filter(d => {
    const matchesSearch = d.id.toLowerCase().includes(search.toLowerCase()) || 
                          (d.patientName && d.patientName.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = filterStatus === "all" || d.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleProvisionDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError('');
    setProvisionSuccess(false);

    const trimmedSerial = provisionSerial.trim();
    if (!trimmedSerial) {
      setProvisionError('Serial number is required.');
      return;
    }

    // Check if the serial already exists in the loaded devices list
    const alreadyExists = devices.some(d => d.id === trimmedSerial);
    if (alreadyExists) {
      setProvisionError('A device with this serial number already exists.');
      return;
    }

    setProvisionLoading(true);
    try {
      const now = new Date().toISOString();

      // Write to admin/inventory so signup can validate
      const inventoryRef = ref(db, `admin/inventory/${trimmedSerial}`);
      await set(inventoryRef, {
        provisionedAt: now,
        label: provisionLabel.trim() || null,
        notes: provisionNotes.trim() || null,
      });

      // Create the device record
      const deviceRef = ref(db, `devices/${trimmedSerial}`);
      await set(deviceRef, {
        status: 'offline',
        battery: 0,
        lastUpdate: now,
        location: { lat: 0, lng: 0 },
      });

      setProvisionSuccess(true);
      setProvisionSerial('');
      setProvisionLabel('');
      setProvisionNotes('');

      // Auto-close after a short delay
      setTimeout(() => {
        setShowProvisionModal(false);
        setProvisionSuccess(false);
      }, 1500);
    } catch (err: any) {
      console.error('Provision error:', err);
      setProvisionError(err.message || 'Failed to provision device. Please try again.');
    } finally {
      setProvisionLoading(false);
    }
  };

  const resetProvisionModal = () => {
    setShowProvisionModal(false);
    setProvisionSerial('');
    setProvisionLabel('');
    setProvisionNotes('');
    setProvisionError('');
    setProvisionSuccess(false);
  };

  return (
    <AdminLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Devices</h1>
            <p className="text-sm text-muted-foreground mt-1">Fleet-wide monitoring of all provisioned devices</p>
          </div>
          
          <button
            onClick={() => setShowProvisionModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="size-4" />
            Provision Device
          </button>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search serial or family..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary w-full md:w-64"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:border-primary appearance-none cursor-pointer text-foreground h-[38px]"
              >
                <option value="all">All Statuses</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="low_battery">Low Battery</option>
              </select>
            </div>
          </div>
        </div>

        {/* Devices Table */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground bg-muted/30">
                <tr>
                  <th className="font-medium px-6 py-4">Serial Number</th>
                  <th className="font-medium px-6 py-4">Status</th>
                  <th className="font-medium px-6 py-4">Batteries</th>
                  <th className="font-medium px-6 py-4">Assigned To</th>
                  <th className="font-medium px-6 py-4">Last Sync</th>
                  <th className="font-medium px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDevices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      {search ? "No devices matched your search" : "No devices provisioned"}
                    </td>
                  </tr>
                ) : (
                  filteredDevices.map((device) => (
                    <tr key={device.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-foreground font-mono font-medium text-xs">{device.id}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={device.status} />
                      </td>
                      <td className="px-6 py-4 text-foreground text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground w-16">Wearable</span>
                          <span className={device.wearableBattery < 20 ? "text-destructive font-medium" : ""}>{device.wearableBattery}%</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-muted-foreground w-16">Hub</span>
                          <span className={device.hubBattery < 20 ? "text-destructive font-medium" : ""}>{device.hubBattery}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {device.patientName ? (
                          <span className="text-foreground">{device.patientName}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        {device.lastUpdate ? device.lastUpdate.toLocaleString() : "No data yet"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setSelectedDevice(device)}
                          className="text-primary hover:text-primary/80 font-medium text-sm transition-colors"
                        >
                          Diagnostics
                        </button>
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

      {/* Diagnostics Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                  <Activity className="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Device Diagnostics</h3>
                  <p className="text-xs text-muted-foreground font-mono">{selectedDevice.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedDevice(null)}
                className="p-2 hover:bg-muted text-muted-foreground rounded-xl transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</p>
                  <div><StatusBadge status={selectedDevice.status} /></div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Battery Levels</p>
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Battery className={`size-4 ${selectedDevice.wearableBattery < 20 ? "text-destructive" : "text-success"}`} />
                    Wearable {selectedDevice.wearableBattery}%
                  </p>
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Battery className={`size-4 ${selectedDevice.hubBattery < 20 ? "text-destructive" : "text-success"}`} />
                    Hub {selectedDevice.hubBattery}%
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Assigned Patient</p>
                  <p className="text-sm text-foreground">{selectedDevice.patientName || <span className="italic text-muted-foreground">Unassigned</span>}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Last Sync</p>
                  <p className="text-sm text-foreground">{selectedDevice.lastUpdate ? selectedDevice.lastUpdate.toLocaleString() : "No data yet"}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">Hardware Modules</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 border border-border rounded-xl flex items-center gap-3">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <Cpu className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">ESP32 Core</p>
                      <p className="text-[10px] text-muted-foreground">Healthy</p>
                    </div>
                  </div>
                  <div className="p-3 border border-border rounded-xl flex items-center gap-3">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <Radio className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">SIM800L</p>
                      <p className="text-[10px] text-muted-foreground">Network OK</p>
                    </div>
                  </div>
                  <div className="p-3 border border-border rounded-xl flex items-center gap-3">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <HardDrive className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">Storage</p>
                      <p className="text-[10px] text-muted-foreground">23% Used</p>
                    </div>
                  </div>
                  <div className="p-3 border border-border rounded-xl flex items-center gap-3">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <Activity className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">Accelerometer</p>
                      <p className="text-[10px] text-muted-foreground">Calibrated</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2 italic">
                  * Hardware module statuses are simulated for this prototype.
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-border bg-muted/10 flex justify-between items-center">
              <button className="px-4 py-2 text-primary hover:bg-primary/10 rounded-xl text-sm font-medium transition-colors">
                Ping Device
              </button>
              <button 
                onClick={() => setSelectedDevice(null)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provision Device Modal */}
      {showProvisionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                  <PackagePlus className="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Provision Device</h3>
                  <p className="text-xs text-muted-foreground">Add a new CareBeacon to the inventory</p>
                </div>
              </div>
              <button
                onClick={resetProvisionModal}
                className="p-2 hover:bg-muted text-muted-foreground rounded-xl transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleProvisionDevice} className="p-6 overflow-y-auto space-y-5">
              {provisionError && (
                <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
                  <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                  {provisionError}
                </div>
              )}

              {provisionSuccess && (
                <div className="flex items-center gap-2.5 p-3 bg-success/10 border border-success/20 rounded-xl text-success text-sm">
                  <Check className="size-4 flex-shrink-0" />
                  Device provisioned successfully!
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Serial Number <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={provisionSerial}
                  onChange={(e) => setProvisionSerial(e.target.value)}
                  className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm font-mono tracking-wider"
                  placeholder="CB-XXXX-XXXX"
                  required
                  disabled={provisionLoading || provisionSuccess}
                />
                <p className="text-[10px] text-muted-foreground">The unique serial number printed on the CareBeacon device.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Device Label <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={provisionLabel}
                  onChange={(e) => setProvisionLabel(e.target.value)}
                  className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm"
                  placeholder="e.g. Batch 2 — Unit 14"
                  disabled={provisionLoading || provisionSuccess}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  value={provisionNotes}
                  onChange={(e) => setProvisionNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-input-background border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-sm resize-none"
                  placeholder="Any additional notes about this device..."
                  disabled={provisionLoading || provisionSuccess}
                />
              </div>

              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">What happens next:</strong> The device will be added to the inventory and marked as <span className="font-mono text-foreground">offline</span>. Caregivers can then register by entering this serial number during sign-up.
                </p>
              </div>
            </form>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border bg-muted/10 flex justify-end gap-3">
              <button
                type="button"
                onClick={resetProvisionModal}
                className="px-4 py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
                disabled={provisionLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={handleProvisionDevice}
                disabled={provisionLoading || provisionSuccess}
                className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors disabled:opacity-70 disabled:pointer-events-none flex items-center gap-2"
              >
                {provisionLoading ? (
                  <>
                    <span className="size-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Provisioning...
                  </>
                ) : provisionSuccess ? (
                  <>
                    <Check className="size-4" />
                    Done
                  </>
                ) : (
                  <>
                    <PackagePlus className="size-4" />
                    Provision Device
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
