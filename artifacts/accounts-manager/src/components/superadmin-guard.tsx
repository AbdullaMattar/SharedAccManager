import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";

export function SuperadminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") {
    return <Redirect to="/" />;
  }
  return children;
}
