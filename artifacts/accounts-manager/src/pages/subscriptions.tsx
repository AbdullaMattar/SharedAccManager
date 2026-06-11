import { Link } from "wouter";
import { Loader2, ReceiptText } from "lucide-react";
import { useState } from "react";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubscriptionSummary, useListSubscriptions } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";
import { daysRemaining } from "@/lib/dates";

export default function Subscriptions() {
  const [status, setStatus] = useState("all");
  const { data: subscriptions = [], isLoading } = useListSubscriptions(status === "all" ? undefined : { status: status as "active" | "expired" | "cancelled" });
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">{strings.subscriptions.title}</h1><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{strings.subscriptions.statusAll}</SelectItem><SelectItem value="active">{strings.subscriptions.statusActive}</SelectItem><SelectItem value="expired">{strings.subscriptions.statusExpired}</SelectItem><SelectItem value="cancelled">{strings.subscriptions.statusCancelled}</SelectItem></SelectContent></Select></div>
    {isLoading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : subscriptions.length === 0 ? <Card><CardContent className="flex flex-col items-center py-12 text-muted-foreground"><ReceiptText className="mb-3 h-10 w-10 opacity-30" />{strings.subscriptions.noResults}</CardContent></Card> : <div className="grid gap-3 md:grid-cols-2">{subscriptions.map((sub: SubscriptionSummary) => <Link key={sub.id} href={`/subscriptions/${sub.id}`}><Card className="hover:bg-muted/30"><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{sub.customerName}</p><p className="text-sm text-muted-foreground">{sub.productName} · {sub.accountLabel} · {strings.subscriptions.slot} {sub.slotIndex}</p></div><SubscriptionStatusBadge status={sub.status} /></div><div className="flex items-center justify-between text-sm"><span>{strings.subscriptions.expiryDate}: {sub.expiryDate}</span><strong>{sub.price} {strings.common.currency}</strong></div><p className="text-sm font-medium text-primary">{strings.phase3.daysRemaining(daysRemaining(sub.expiryDate))}</p></CardContent></Card></Link>)}</div>}
  </div>;
}
