import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { cn } from "../ui/utils";
import { Menu, X, LogOut, ArrowLeft, Settings } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "../../../lib/firebase";

const navigation = [
  { name: "Dashboard", href: "/admin", section: "Overview" },
  { name: "Analytics", href: "/admin/analytics", section: "Overview" },
  { name: "Families", href: "/admin/families", section: "People" },
  { name: "Review Queue", href: "/admin/review", section: "People" },
  { name: "Devices", href: "/admin/devices", section: "Monitoring" },
  { name: "Incidents", href: "/admin/incidents", section: "Monitoring" },
  { name: "Alert delivery", href: "/admin/alert-delivery", section: "Monitoring" },
];


export function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const isRootAdmin = location.pathname === "/admin";

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await signOut(auth);
  };

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0">
      <Link
        to="/admin/settings"
        aria-label="Settings"
        title="Settings"
        className={cn(
          "flex items-center justify-center size-10 rounded-xl border transition-colors",
          location.pathname === "/admin/settings"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card text-foreground border-border hover:bg-secondary"
        )}
      >
        <Settings className="size-5" />
      </Link>
      <button
        onClick={handleLogoutClick}
        aria-label="Sign out"
        title="Sign out"
        className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-card text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors text-sm font-medium"
      >
        <LogOut className="size-4" />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );

  const groupedNav = navigation.reduce((acc, item) => {
    if (!acc[item.section]) acc[item.section] = [];
    acc[item.section].push(item);
    return acc;
  }, {} as Record<string, any>);

  const sidebarContent = (
    <>
      <div className="flex flex-col">
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 mb-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-foreground">Admin</span>
          </div>
          {/* Close button for mobile */}
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-6">
          {Object.entries(groupedNav).map(([section, items]) => (
            <div key={section}>
              <h3 className="px-2 text-xs font-medium text-muted-foreground mb-2">
                {section}
              </h3>
              <ul className="space-y-1">
                {items.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <li key={item.name}>
                      <Link
                        to={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                          isActive
                            ? "bg-secondary text-primary"
                            : "text-foreground hover:bg-secondary/50 hover:text-primary"
                        )}
                      >
                        <span>{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden w-full bg-background">
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden flex items-center justify-between h-14 px-4 bg-card border-b border-border">
        <div className="flex items-center">
          <button
            className="p-2 rounded-lg hover:bg-muted text-foreground"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          {!isRootAdmin && (
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground ml-1"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <div className="flex items-center gap-2 ml-3">
            <span className="font-semibold text-foreground text-sm">Admin</span>
          </div>
        </div>
        {headerActions}
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - desktop: always visible, mobile: slide-in drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card flex flex-col justify-between overflow-y-auto transition-transform duration-300 md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {/* Desktop top bar with back button + avatar */}
        <div className="hidden md:flex items-center justify-between px-8 pt-6">
          <div>
            {!isRootAdmin && (
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
              >
                <ArrowLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
                Back
              </button>
            )}
          </div>
          {headerActions}
        </div>
        {children}
      </main>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4 animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center justify-center size-12 bg-destructive/10 rounded-xl mx-auto mb-4">
              <LogOut className="size-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold text-foreground text-center mb-2">Sign Out</h3>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Are you sure you want to sign out of the admin panel?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 py-2.5 px-4 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl text-sm font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
