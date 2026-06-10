import { Link } from "wouter";
import { ArrowRight, Edit2, Loader2, Mail, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { CustomerFormDialog } from "@/components/customer-form-dialog";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Customer, SubscriptionSummary, useGetCustomer } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";

export default function CustomerDetail({ id }: { id: number }) {
  const { data: customer, isLoading } = useGetCustomer(id);
  const [editOpen, setEditOpen] = useState(false);
  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!customer) return <p>{strings.app.noData}</p>;
  const value = customer as Customer;
  return <div className="space-y-5">
    <div className="flex items-center justify-between"><Button asChild variant="ghost"><Link href="/customers"><ArrowRight className="me-2 h-4 w-4" />{strings.common.back}</Link></Button><Button variant="outline" onClick={() => setEditOpen(true)}><Edit2 className="me-2 h-4 w-4" />{strings.app.edit}</Button></div>
    <Card><CardHeader><CardTitle>{value.name}</CardTitle></CardHeader><CardContent className="space-y-3"><Info icon={Phone} value={value.phone} ltr />{value.email && <Info icon={Mail} value={value.email} ltr />}{value.notes && <p className="rounded-md bg-muted p-3 text-sm">{value.notes}</p>}<div className="flex flex-wrap gap-2"><Button asChild><a href={`https://wa.me/${(value.whatsapp || value.phone).replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle className="me-2 h-4 w-4" />{strings.customers.openWhatsapp}</a></Button><div className="rounded-md border px-4 py-2 text-sm"><span className="text-muted-foreground">{strings.customers.totalSpent}: </span><strong>{value.totalSpent || 0} {strings.common.currency}</strong></div></div></CardContent></Card>
    <Card><CardHeader><CardTitle>{strings.customers.subscriptions}</CardTitle></CardHeader><CardContent>{!value.subscriptions?.length ? <p className="text-sm text-muted-foreground">{strings.app.noData}</p> : <div className="space-y-3">{value.subscriptions.map((sub) => <SubscriptionCard key={sub.id} sub={sub} />)}</div>}</CardContent></Card>
    <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={value} />
  </div>;
}
function Info({ icon: Icon, value, ltr }: { icon: typeof Phone; value: string; ltr?: boolean }) { return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /><span dir={ltr ? "ltr" : undefined} className={ltr ? "text-start" : ""}>{value}</span></div>; }
function SubscriptionCard({ sub }: { sub: SubscriptionSummary }) { return <Link href={`/subscriptions/${sub.id}`} className="block rounded-lg border p-3 hover:bg-muted/50"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{sub.productName}</p><p className="text-xs text-muted-foreground">{sub.accountLabel} · {strings.subscriptions.slot} {sub.slotIndex}</p></div><SubscriptionStatusBadge status={sub.status} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><span>{sub.startDate}</span><span>{sub.expiryDate}</span><strong>{sub.price} {strings.common.currency}</strong></div></Link>; }
