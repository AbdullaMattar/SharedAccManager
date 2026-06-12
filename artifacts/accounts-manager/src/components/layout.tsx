import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { strings } from "@/lib/strings";
import { Package, LogOut, Menu, UserRound, ReceiptText, ShoppingCart, LayoutDashboard, CalendarClock, Settings, ShieldCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetDashboard } from "@/lib/phase3-api";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const { data: dashboard } = useGetDashboard();
  const [location, setLocation] = useLocation();
  const orgName = (user as { orgName?: string | null } | undefined)?.orgName;
  const businessName = user?.role === "superadmin" ? "إدارة المنصة" : orgName || dashboard?.businessName || strings.app.title;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        // Explicitly nullify auth state
        queryClient.setQueryData(["/api/auth/me"], null);
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  const navItems = user?.role === "superadmin" ? [
    { href: "/platform", label: "إدارة المنصة", icon: ShieldCheck },
  ] : [
    { href: "/", label: strings.phase3.dashboard, icon: LayoutDashboard },
    { href: "/expiring", label: strings.phase3.expiringSoon, icon: CalendarClock },
    { href: "/sale/new", label: strings.nav.newSale, icon: ShoppingCart, prominent: true },
    { href: "/inventory", label: strings.nav.inventory, icon: Package },
    { href: "/customers", label: strings.nav.customers, icon: UserRound },
    { href: "/subscriptions", label: strings.nav.subscriptions, icon: ReceiptText },
    ...(user?.role === "admin" ? [
      { href: "/admin/settings", label: strings.phase3.settings, icon: Settings },
      { href: "/admin/users", label: strings.phase3.users, icon: ShieldCheck },
      { href: "/admin/audit", label: strings.phase3.audit, icon: ReceiptText },
    ] : []),
  ];

  const Sidebar = () => (
    <div className="flex h-full flex-col bg-card border-e border-border">
      <div className="p-4 flex items-center justify-center border-b border-border">
        <h1 className="font-bold text-lg text-primary">{businessName}</h1>
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="space-y-1 px-2">
          {navItems.map((item) => {
            const isInventoryRoute =
              item.href === "/inventory" &&
              ["/inventory", "/products", "/accounts"].some(
                (path) => location === path || location.startsWith(`${path}/`),
              );
            const isActive = item.href === "/" ? location === "/" : isInventoryRoute || location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 transition-colors ${isActive ? "bg-primary text-primary-foreground" : item.prominent ? "bg-green-600 text-white hover:bg-green-700" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"} ${item.prominent ? "mb-3 shadow-sm" : ""}`} data-testid={`nav-${item.href}`}>
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-border">
        <div className="mb-4">
          <p className="text-sm font-medium text-foreground">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <Button variant="outline" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleLogout} disabled={logout.isPending} data-testid="btn-logout">
          {logout.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin me-2" />
          ) : (
            <LogOut className="h-4 w-4 me-2 rtl:rotate-180" />
          )}
          {strings.app.logout}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background w-full overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-64 flex-col h-full border-e border-border shrink-0 z-10">
        <Sidebar />
      </div>

      {/* Mobile Header & Content */}
      <div className="flex flex-col flex-1 w-full overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border shrink-0">
          <h1 className="font-bold text-lg text-primary">{businessName}</h1>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0" data-testid="btn-mobile-menu">
                <Menu className="h-5 w-5" />
                <span className="sr-only">{strings.app.actions}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-64">
              <Sidebar />
            </SheetContent>
          </Sheet>
        </header>
        <main className="flex-1 overflow-auto bg-background p-4 md:p-6 w-full">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
