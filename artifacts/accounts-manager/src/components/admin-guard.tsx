import { useAuth } from "@/lib/auth";
import { strings } from "@/lib/strings";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === "admin" ? children : <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{strings.phase3.adminOnly}</div>;
}
