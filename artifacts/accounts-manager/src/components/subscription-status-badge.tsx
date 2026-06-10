import { Badge } from "@/components/ui/badge";
import { strings } from "@/lib/strings";

export function SubscriptionStatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="border-green-500/20 bg-green-500/10 text-green-700">{strings.subscriptions.statusActive}</Badge>;
  if (status === "expired") return <Badge variant="secondary">{strings.subscriptions.statusExpired}</Badge>;
  return <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-red-700">{strings.subscriptions.statusCancelled}</Badge>;
}
