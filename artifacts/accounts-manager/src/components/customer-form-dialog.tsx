import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Customer, CustomerInput, useCreateCustomer, useUpdateCustomer } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";

export function CustomerFormDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (open: boolean) => void; customer?: Customer | null }) {
  const [form, setForm] = useState<CustomerInput>({ name: "", phone: "", whatsapp: "", email: "", notes: "" });
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const isPending = createCustomer.isPending || updateCustomer.isPending;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => setForm({ name: customer?.name || "", phone: customer?.phone || "", whatsapp: customer?.whatsapp || customer?.phone || "", email: customer?.email || "", notes: customer?.notes || "" }), [customer, open]);
  const set = (key: keyof CustomerInput, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = { ...form, whatsapp: form.whatsapp || form.phone };
    const options = {
      onSuccess: () => { queryClient.invalidateQueries(); toast({ title: customer ? strings.customers.updateSuccess : strings.customers.createSuccess }); onOpenChange(false); },
      onError: (error: any) => toast({ variant: "destructive", title: error?.response?.status === 409 ? strings.customers.duplicatePhone : strings.app.error }),
    };
    if (customer) {
      updateCustomer.mutate({ id: customer.id, data }, options);
    } else {
      createCustomer.mutate({ data }, options);
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>{customer ? strings.customers.edit : strings.customers.add}</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-4">
    <Field label={strings.customers.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
    <Field label={strings.customers.phone}><Input dir="ltr" className="text-start" value={form.phone} onChange={(e) => { set("phone", e.target.value); if (!form.whatsapp || form.whatsapp === form.phone) set("whatsapp", e.target.value); }} required /></Field>
    <Field label={strings.customers.whatsapp}><Input dir="ltr" className="text-start" value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
    <Field label={strings.customers.email}><Input dir="ltr" className="text-start" type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
    <Field label={strings.customers.notes}><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field>
    <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{strings.app.cancel}</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{strings.app.save}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
