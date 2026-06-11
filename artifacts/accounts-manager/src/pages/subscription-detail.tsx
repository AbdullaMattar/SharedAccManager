import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { SubscriptionSummary, useCancelSubscription, useGetSubscription, useRefundSubscription, useUpdateSubscription } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";
import { RenewSubscriptionDialog } from "@/components/renew-subscription-dialog";
import { daysRemaining } from "@/lib/dates";

type SubscriptionDetailData = SubscriptionSummary & { customerId: number; productDefaultDurationDays?: number; payments?: { id: number; amount: number; method: string; paidAt: string; notes?: string }[]; slotHistory?: SubscriptionSummary[] };

export default function SubscriptionDetail({ id }: { id: number }) {
  const { data, isLoading } = useGetSubscription(id);
  const value = data as SubscriptionDetailData | undefined;
  const [notes, setNotes] = useState("");
  const [refunded, setRefunded] = useState(false);
  const update = useUpdateSubscription();
  const cancel = useCancelSubscription();
  const refund = useRefundSubscription();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => setNotes(value?.notes || ""), [value?.notes]);
  const invalidate = () => { queryClient.invalidateQueries(); };
  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!value) return <p>{strings.app.noData}</p>;
  const saveNotes = () => update.mutate({ id, data: { notes } }, { onSuccess: () => { invalidate(); toast({ title: strings.subscriptions.updateSuccess }); } });
  const cancelSubscription = () => cancel.mutate({ id, data: { refunded } }, { onSuccess: () => { invalidate(); toast({ title: strings.subscriptions.cancelSuccess }); } });
  const refundSubscription = () => refund.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: strings.subscriptions.refundSuccess }); } });
  const refundableAmount = value.payments?.reduce((total, payment) => total + payment.amount, 0) ?? 0;
  return <div className="space-y-5">
    <Button asChild variant="ghost"><Link href="/subscriptions"><ArrowRight className="me-2 h-4 w-4" />{strings.common.back}</Link></Button>
    <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>{value.productName}</CardTitle><Link href={`/customers/${value.customerId}`} className="text-sm text-primary">{value.customerName}</Link></div><SubscriptionStatusBadge status={value.status} /></div></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5"><Fact label={strings.subscriptions.account} value={value.accountLabel} /><Fact label={strings.subscriptions.slot} value={String(value.slotIndex)} /><Fact label={strings.accounts.startDate} value={value.startDate} /><Fact label={strings.accounts.expiryDate} value={value.expiryDate} /><Fact label={strings.subscriptions.remainingDays} value={strings.phase3.daysRemaining(daysRemaining(value.expiryDate))} /><Fact label={strings.subscriptions.price} value={`${value.price} ${strings.common.currency}`} /></div>
      <div className="space-y-2"><label className="text-sm font-medium">{strings.subscriptions.notes}</label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /><Button variant="outline" onClick={saveNotes} disabled={update.isPending}>{strings.app.save}</Button></div>
      {value.status !== "cancelled" && <div className="flex flex-wrap gap-2"><RenewSubscriptionDialog id={id} durationDays={value.productDefaultDurationDays} price={value.price} /><AlertDialog onOpenChange={(open) => { if (!open) setRefunded(false); }}><AlertDialogTrigger asChild><Button variant="destructive">{strings.subscriptions.cancelAction}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{strings.subscriptions.cancelConfirm}</AlertDialogTitle><AlertDialogDescription>{strings.subscriptions.cancelDescription}</AlertDialogDescription></AlertDialogHeader><label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><Checkbox checked={refunded} onCheckedChange={(checked) => setRefunded(checked === true)} /><span><strong className="block text-sm">{strings.subscriptions.refundQuestion}</strong><span className="text-xs text-muted-foreground">{strings.subscriptions.refundDescription}</span></span></label><AlertDialogFooter><AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={cancelSubscription}>{strings.subscriptions.cancelAction}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
      {value.status === "cancelled" && refundableAmount > 0 && <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive">{strings.subscriptions.refundAction}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{strings.subscriptions.refundConfirm}</AlertDialogTitle><AlertDialogDescription>{strings.subscriptions.refundOldDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={refundSubscription} disabled={refund.isPending}>{strings.subscriptions.refundAction}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{strings.subscriptions.payments}</CardTitle></CardHeader><CardContent>{!value.payments?.length ? <p className="text-sm text-muted-foreground">{strings.app.noData}</p> : <div className="space-y-2">{value.payments.map((payment) => <div key={payment.id} className="flex justify-between rounded-md border p-3 text-sm"><span>{formatDateTime(payment.paidAt)} · {payment.amount < 0 ? strings.subscriptions.refund : paymentMethod(payment.method)}</span><strong className={payment.amount < 0 ? "text-destructive" : undefined}>{payment.amount} {strings.common.currency}</strong></div>)}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>{strings.subscriptions.slotHistory}</CardTitle></CardHeader><CardContent>{!value.slotHistory?.length ? <p className="text-sm text-muted-foreground">{strings.app.noData}</p> : <div className="space-y-2">{value.slotHistory.map((item) => <Link key={item.id} href={`/subscriptions/${item.id}`} className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"><span>{item.customerName} · {item.startDate} - {item.expiryDate}</span><SubscriptionStatusBadge status={item.status} /></Link>)}</div>}</CardContent></Card>
  </div>;
}
function Fact({ label, value }: { label: string; value?: string }) { return <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value || "-"}</p></div>; }
function paymentMethod(method: string) { return method === "cash" ? strings.sale.methodCash : method === "transfer" ? strings.sale.methodTransfer : strings.sale.methodOther; }
function formatDateTime(iso: string) { try { return format(new Date(iso), "yyyy/MM/dd HH:mm"); } catch { return iso; } }
