import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRenewSubscription } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export function RenewSubscriptionDialog({ id, durationDays = 30, price, trigger }: { id: number; durationDays?: number; price: number; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(durationDays);
  const [renewPrice, setRenewPrice] = useState(price);
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const renew = useRenewSubscription();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { setDuration(durationDays); setRenewPrice(price); }, [durationDays, price]);
  const submit = () => renew.mutate({ id, data: { durationDays: duration, price: renewPrice, paymentMethod: method, notes: notes || undefined } }, {
    onSuccess: () => { queryClient.invalidateQueries(); setOpen(false); toast({ title: strings.phase3.renewSuccess }); },
    onError: () => toast({ variant: "destructive", title: strings.phase3.renewError }),
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>{trigger || <Button>{strings.phase3.renew}</Button>}</DialogTrigger>
    <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{strings.phase3.renewTitle}</DialogTitle><DialogDescription>{strings.phase3.renewDescription}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Field label={strings.phase3.durationDays}><Input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
        <Field label={strings.phase3.previousPrice}><Input type="number" min={0} step="0.01" value={renewPrice} onChange={(e) => setRenewPrice(Number(e.target.value))} /></Field>
        <Field label={strings.sale.paymentMethod}><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{strings.sale.methodCash}</SelectItem><SelectItem value="transfer">{strings.sale.methodTransfer}</SelectItem><SelectItem value="other">{strings.sale.methodOther}</SelectItem></SelectContent></Select></Field>
        <Field label={strings.phase3.notes}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{strings.app.cancel}</Button><Button onClick={submit} disabled={renew.isPending || duration < 1}>{strings.phase3.renew}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
