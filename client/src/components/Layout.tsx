import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { Moon, Sun, LayoutDashboard, FileText, RefreshCw, Image, Wrench, Clock, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/bulk-update", label: "Bulk Update", icon: RefreshCw },
  { href: "/photos", label: "Photos", icon: Image },
  { href: "/ezcare", label: "EZCare", icon: Wrench },
  { href: "/jobs", label: "Activity", icon: Clock },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col w-60 shrink-0 bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] transition-transform duration-200 z-40",
          "fixed inset-y-0 left-0 md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[hsl(var(--sidebar-border))]">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="Atomic Stays">
            <circle cx="14" cy="14" r="4" fill="hsl(var(--sidebar-primary))" />
            <ellipse cx="14" cy="14" rx="13" ry="5.5" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.5" fill="none" />
            <ellipse cx="14" cy="14" rx="13" ry="5.5" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.5" fill="none" transform="rotate(60 14 14)" />
            <ellipse cx="14" cy="14" rx="13" ry="5.5" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.5" fill="none" transform="rotate(120 14 14)" />
          </svg>
          <div>
            <div className="font-display font-800 text-[hsl(var(--sidebar-foreground))] text-[15px] leading-tight">Atomic Stays</div>
            <div className="text-[11px] text-[hsl(var(--sidebar-primary))] font-medium tracking-wide uppercase">Listing Manager</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))] "
                    : "text-[hsl(var(--sidebar-foreground))/70] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"
                )}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon size={16} className={active ? "text-[hsl(var(--sidebar-primary))]" : ""} />
                {label}
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme toggle */}
        <div className="px-4 py-4 border-t border-[hsl(var(--sidebar-border))]">
          <button
            onClick={toggle}
            className="flex items-center gap-2 text-xs text-[hsl(var(--sidebar-foreground))/60] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Mobile header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border md:hidden bg-card">
          <button onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-mobile-menu">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="font-display font-700 text-sm">Listing Manager</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
