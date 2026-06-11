import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  // If we have a user in the cache, we are authenticated even if fetching
  const actuallyAuthenticated = isAuthenticated || !!user;

  if (isLoading && !actuallyAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!actuallyAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Layout>{children}</Layout>;
}
