import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { db, ref, onValue, set } from "../../../lib/db";
import { Shield, Database, Check, Save } from "lucide-react";
import { useConfirm } from "../ui/confirm-dialog";

export function AdminSettings() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  
  const [settings, setSettings] = useState({
    sessionTimeout: "30",
    dataRetentionLocation: "90",
    dataRetentionIncidents: "365",
  });

  useEffect(() => {
    const settingsRef = ref(db, 'admin/settings');
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setSettings(data);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    if (!(await confirm({ title: 'Save settings?', message: 'These changes will apply to the whole system.', confirmLabel: 'Save changes', icon: null }))) return;
    setSaving(true);
    try {
      await set(ref(db, 'admin/settings'), settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure security and retention policies</p>
        </div>

        <div className="space-y-6">
          {/* Security Settings */}
          <section className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
              <Shield className="size-5 text-primary" />
              <h2 className="text-lg font-medium text-foreground">Security</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Admin Session Timeout (Minutes)</label>
                <select 
                  value={settings.sessionTimeout}
                  onChange={(e) => setSettings({...settings, sessionTimeout: e.target.value})}
                  className="w-full md:w-64 px-4 py-2 bg-input-background border border-border rounded-xl text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="15">15 Minutes</option>
                  <option value="30">30 Minutes</option>
                  <option value="60">1 Hour</option>
                  <option value="240">4 Hours</option>
                </select>
              </div>
            </div>
          </section>

          {/* Data Retention */}
          <section className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
              <Database className="size-5 text-primary" />
              <h2 className="text-lg font-medium text-foreground">Data Retention</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Location History (Days)</label>
                  <select 
                    value={settings.dataRetentionLocation}
                    onChange={(e) => setSettings({...settings, dataRetentionLocation: e.target.value})}
                    className="w-full px-4 py-2 bg-input-background border border-border rounded-xl text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="30">30 Days</option>
                    <option value="90">90 Days</option>
                    <option value="180">6 Months</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Incident History (Days)</label>
                  <select 
                    value={settings.dataRetentionIncidents}
                    onChange={(e) => setSettings({...settings, dataRetentionIncidents: e.target.value})}
                    className="w-full px-4 py-2 bg-input-background border border-border rounded-xl text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="90">90 Days</option>
                    <option value="365">1 Year</option>
                    <option value="730">2 Years</option>
                    <option value="9999">Indefinitely</option>
                  </select>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-4 pt-4">
          {saved && (
            <span className="flex items-center gap-1.5 text-success text-sm font-medium animate-in fade-in slide-in-from-right-4">
              <Check className="size-4" />
              Settings saved
            </span>
          )}
          <button 
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-sm"
          >
            {saving ? (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <Save className="size-4" />
            )}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
      {confirmDialog}
    </AdminLayout>
  );
}
