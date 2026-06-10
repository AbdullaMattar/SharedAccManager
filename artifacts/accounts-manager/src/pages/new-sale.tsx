import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Loader2, Search, ShoppingCart } from "lucide-react";
import { addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AvailableProduct, AvailableSlot, Customer, useCreateCustomer, useCreateSale, useListAvailableProducts, useListAvailableSlots, useListCustomers } from "@/lib/phase2-api";
import { strings } from "@/lib/strings";

const today = () => format(new Date(), "yyyy-MM-dd");
const now = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

export default function NewSale() {
  const { data: products = [], isLoading } = useListAvailableProducts();
  const [productId, setProductId] = useState<number>();
  const product = products.find((item: AvailableProduct) => item.id === productId) as AvailableProduct | undefined;
  const [assignment, setAssignment] = useState("auto");
  const [slotId, setSlotId] = useState<number>();
  const { data: slots = [] } = useListAvailableSlots(productId ? { productId } : undefined, { query: { enabled: !!productId } });
  const [customerSearch, setCustomerSearch] = useState("");
  const { data: customers = [] } = useListCustomers({ q: customerSearch || undefined });
  const [customerId, setCustomerId] = useState<number>();
  const selectedCustomer = customers.find((item: Customer) => item.id === customerId) as Customer | undefined;
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [startDate, setStartDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState(today());
  const [price, setPrice] = useState(0);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [paidAt, setPaidAt] = useState(now());
  const [notes, setNotes] = useState("");
  const [subscriptionId, setSubscriptionId] = useState<number>();
  const createCustomer = useCreateCustomer();
  const createSale = useCreateSale();
  const { toast } = useToast();
  useEffect(() => { if (product) { const nextPrice = Number(product.defaultPrice); setPrice(nextPrice); setAmount(nextPrice); setExpiryDate(format(addDays(new Date(`${startDate}T00:00:00`), product.defaultDurationDays), "yyyy-MM-dd")); } }, [productId]);
  useEffect(() => { if (product) setExpiryDate(format(addDays(new Date(`${startDate}T00:00:00`), product.defaultDurationDays), "yyyy-MM-dd")); }, [startDate]);
  const chosenSlot = useMemo(() => assignment === "manual" ? slotId : undefined, [assignment, slotId]);
  const addCustomer = () => createCustomer.mutate({ data: { ...newCustomer, whatsapp: newCustomer.phone } }, { onSuccess: (customer: Customer) => { setCustomerId(customer.id); setCustomerSearch(customer.name); }, onError: () => toast({ variant: "destructive", title: strings.sale.createCustomerError }) });
  const submit = () => {
    if (!productId) { toast({ variant: "destructive", title: strings.sale.selectProductFirst }); return; }
    if (!customerId) { toast({ variant: "destructive", title: strings.sale.missingCustomer }); return; }
    if (expiryDate < startDate) { toast({ variant: "destructive", title: strings.sale.invalidDates }); return; }
    createSale.mutate({ data: { productId, slotId: chosenSlot, customerId, startDate, expiryDate, price, notes, payment: { amount, method: method as "cash" | "transfer" | "other", paidAt: new Date(paidAt).toISOString() } } }, { onSuccess: (result) => setSubscriptionId(result.subscription.id) });
  };
  if (subscriptionId) return <Card className="mx-auto max-w-lg text-center"><CardContent className="flex flex-col items-center gap-4 py-12"><CheckCircle2 className="h-16 w-16 text-green-600" /><h1 className="text-2xl font-bold">{strings.sale.success}</h1><p className="text-muted-foreground">{strings.sale.successDescription}</p><Button asChild><Link href={`/subscriptions/${subscriptionId}`}>{strings.sale.viewSubscription}</Link></Button></CardContent></Card>;
  return <div className="mx-auto max-w-3xl space-y-4"><div><h1 className="text-2xl font-bold">{strings.sale.title}</h1><p className="text-sm text-muted-foreground">{strings.sale.intro}</p></div>
    <Step title={strings.sale.productStep} description={strings.sale.productHint}>{isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : products.length === 0 ? <p className="text-sm text-muted-foreground">{strings.sale.noAvailableProducts}</p> : <div className="grid gap-2 sm:grid-cols-2">{products.map((item: AvailableProduct) => <button type="button" key={item.id} onClick={() => { setProductId(item.id); setSlotId(undefined); }} className={`rounded-lg border p-3 text-start ${productId === item.id ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}><strong>{item.name}</strong><p className="text-xs text-muted-foreground">{item.freeSlotCount} {strings.sale.freeSlots}</p></button>)}</div>}</Step>
    <Step title={strings.sale.slotStep}><RadioGroup value={assignment} onValueChange={setAssignment} className="grid grid-cols-2"><RadioChoice value="auto" title={strings.sale.autoAssign} description={strings.sale.autoAssignDescription} /><RadioChoice value="manual" title={strings.sale.manualAssign} /></RadioGroup>{assignment === "manual" && <Select value={slotId?.toString()} onValueChange={(value) => setSlotId(Number(value))} disabled={!productId}><SelectTrigger><SelectValue placeholder={productId ? strings.sale.selectSlot : strings.sale.selectProductFirst} /></SelectTrigger><SelectContent>{slots.map((slot: AvailableSlot) => <SelectItem key={slot.id} value={String(slot.id)}>{slot.accountLabel} · {strings.subscriptions.slot} {slot.slotIndex}</SelectItem>)}</SelectContent></Select>}</Step>
    <Step title={strings.sale.customerStep}><div className="relative"><Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder={strings.customers.searchPlaceholder} className="pe-10" /></div>{customerSearch && <div className="max-h-40 space-y-1 overflow-auto">{customers.map((customer: Customer) => <button type="button" key={customer.id} onClick={() => setCustomerId(customer.id)} className={`flex w-full justify-between rounded-md border p-2 text-sm ${customerId === customer.id ? "border-primary bg-primary/5" : ""}`}><span>{customer.name}</span><span dir="ltr">{customer.phone}</span></button>)}</div>}<div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">{strings.sale.newCustomer}</p><div className="grid gap-2 sm:grid-cols-2"><Input placeholder={strings.customers.name} value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} /><Input dir="ltr" className="text-start" placeholder={strings.customers.phone} value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} /></div><Button type="button" variant="outline" className="mt-2" disabled={!newCustomer.name || !newCustomer.phone || createCustomer.isPending} onClick={addCustomer}>{strings.sale.createCustomerInline}</Button></div>{selectedCustomer && <p className="text-sm text-green-700">{strings.sale.selectedCustomer}: {selectedCustomer.name}</p>}</Step>
    <Step title={strings.sale.datesStep}><div className="grid gap-3 sm:grid-cols-3"><Field label={strings.subscriptions.startDate}><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field><Field label={strings.subscriptions.expiryDate}><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field><Field label={strings.subscriptions.price}><Input type="number" min="0" step="0.01" value={price} onChange={(e) => { setPrice(Number(e.target.value)); setAmount(Number(e.target.value)); }} /></Field></div><Field label={strings.subscriptions.notes}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></Step>
    <Step title={strings.sale.paymentStep}><div className="grid gap-3 sm:grid-cols-3"><Field label={strings.sale.paymentAmount}><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field><Field label={strings.sale.paymentMethod}><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{strings.sale.methodCash}</SelectItem><SelectItem value="transfer">{strings.sale.methodTransfer}</SelectItem><SelectItem value="other">{strings.sale.methodOther}</SelectItem></SelectContent></Select></Field><Field label={strings.sale.paidAt}><Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field></div></Step>
    <Step title={strings.sale.confirmStep}><Button className="w-full" size="lg" onClick={submit} disabled={!productId || !customerId || createSale.isPending}><ShoppingCart className="me-2 h-5 w-5" />{strings.sale.confirm}</Button></Step>
  </div>;
}
function Step({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <Card><CardHeader className="pb-3"><CardTitle className="text-lg">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="space-y-3">{children}</CardContent></Card>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function RadioChoice({ value, title, description }: { value: string; title: string; description?: string }) { return <Label className="flex cursor-pointer gap-2 rounded-md border p-3"><RadioGroupItem value={value} /><span><strong className="block text-sm">{title}</strong>{description && <span className="text-xs text-muted-foreground">{description}</span>}</span></Label>; }
