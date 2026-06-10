import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { strings } from "@/lib/strings";
import { Package, Users, BarChart3, LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const logout = useLogout();
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
      }
    });
  };

  const navItems = [
    { href: "/products", label: strings.nav.products, icon: Package },
    { href: "/accounts", label: strings.nav.accounts, icon: Users },
  ];

  const Sidebar = () => (
    <div className="flex h-full flex-col bg-card border-e border-border">
      <div className="p-4 flex items-center justify-center border-b border-border">
        <h1 className="font-bold text-lg text-primary">{strings.app.title}</h1>
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`} data-testid={`nav-${item.href}`}>
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
        <Button variant="outline" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleLogout} data-testid="btn-logout">
          <LogOut className="h-4 w-4 me-2 rtl:rotate-180" />
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
          <h1 className="font-bold text-lg text-primary">{strings.app.title}</h1>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0" data-testid="btn-mobile-menu">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
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
