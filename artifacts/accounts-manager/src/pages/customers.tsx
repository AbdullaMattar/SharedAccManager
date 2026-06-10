import { useState } from "react";
import { Link } from "wouter";
import { Edit2, Loader2, MessageCircle, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { CustomerFormDialog } from "@/components/customer-form-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Customer, useDeleteCustomer, useListCustomers } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";

export default function Customers() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { data: customers = [], isLoading } = useListCustomers({ q: search || undefined });
  const deleteCustomer = useDeleteCustomer();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = (id: number) => deleteCustomer.mutate({ id }, {
    onSuccess: () => { queryClient.invalidateQueries(); toast({ title: strings.customers.deleteSuccess }); },
    onError: () => toast({ variant: "destructive", title: strings.customers.deleteBlocked }),
  });
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">{strings.customers.title}</h1><Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="me-2 h-4 w-4" />{strings.customers.add}</Button></div>
    <div className="relative"><Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={strings.customers.searchPlaceholder} className="pe-10" type="search" /></div>
    {isLoading ? <Loading /> : customers.length === 0 ? <Empty text={search ? strings.customers.noResults : strings.app.noData} /> :
      <div className="grid gap-3 md:grid-cols-2">{customers.map((customer: Customer) => <Card key={customer.id}><CardHeader className="pb-2"><div className="flex items-start justify-between gap-2"><Link href={`/customers/${customer.id}`}><CardTitle className="text-lg hover:text-primary">{customer.name}</CardTitle></Link><div className="flex">
        <Button variant="ghost" size="icon" aria-label={strings.app.edit} onClick={() => { setEditing(customer); setFormOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label={strings.app.delete}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{strings.customers.deleteConfirm}</AlertDialogTitle><AlertDialogDescription>{strings.app.confirmDeleteDesc}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={() => remove(customer.id)}>{strings.app.delete}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div></div></CardHeader><CardContent className="space-y-2 text-sm"><p dir="ltr" className="text-start text-muted-foreground">{customer.phone}</p>{customer.email && <p dir="ltr" className="text-start text-muted-foreground">{customer.email}</p>}<div className="flex gap-2 pt-2"><Button asChild size="sm" variant="outline"><a href={`https://wa.me/${cleanPhone(customer.whatsapp || customer.phone)}`} target="_blank" rel="noreferrer"><MessageCircle className="me-2 h-4 w-4" />{strings.customers.openWhatsapp}</a></Button><Button asChild size="sm"><Link href={`/customers/${customer.id}`}>{strings.common.details}</Link></Button></div></CardContent></Card>)}</div>}
    <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />
  </div>;
}
const cleanPhone = (phone: string) => phone.replace(/[^\d]/g, "");
function Loading() { return <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>; }
function Empty({ text }: { text: string }) { return <Card><CardContent className="flex flex-col items-center py-12 text-center text-muted-foreground"><UserRound className="mb-3 h-10 w-10 opacity-30" />{text}</CardContent></Card>; }
