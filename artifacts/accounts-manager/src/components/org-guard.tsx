import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";

export function OrgGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "superadmin") {
    return <Redirect to="/platform" />;
  }
  return children;
}
