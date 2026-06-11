import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, CheckCircle2, Loader2, Plus, Search, ShoppingCart } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  type AvailableProduct,
  type AvailableSlot,
  type Customer,
  useCreateCustomer,
  useCreateSale,
  useListAvailableProducts,
  useListAvailableSlots,
  useListCustomers,
} from "@/lib/phase2-api";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

const nowDt = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

export default function NewSale() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1 — Product
  const { data: products = [], isLoading } = useListAvailableProducts();
  const [product, setProduct] = useState<AvailableProduct>();

  // Step 2 — Customer
  const [customerSearch, setCustomerSearch] = useState("");
  const { data: customers = [] } = useListCustomers({ q: customerSearch || undefined });
  const [customer, setCustomer] = useState<Customer>();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const createCustomer = useCreateCustomer();

  // Step 3 — Slot assignment
  const { data: slots = [] } = useListAvailableSlots(product ? { productId: product.id } : undefined);
  const [slotAssignment, setSlotAssignment] = useState<"auto" | "manual">("auto");
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot>();
  const skipSlotStep = useMemo(() => {
    if (!slots.length) return true;
    const ids = new Set(slots.map((s) => s.accountId));
    return ids.size <= 1;
  }, [slots]);

  // Step 4 — Dates & price
  const [price, setPrice] = useState(0);
  const [method, setMethod] = useState<"cash" | "transfer" | "other">("cash");
  const [paidAt, setPaidAt] = useState(nowDt());
  const [notes, setNotes] = useState("");

  // Result
  const [subscriptionId, setSubscriptionId] = useState<number>();
  const createSale = useCreateSale();
  const { toast } = useToast();

  // Reset dependent state when product changes
  useEffect(() => {
    if (!product) return;
    setPrice(product.defaultPrice);
    setSelectedSlot(undefined);
    setSlotAssignment("auto");
  }, [product?.id]);

  const advance = () => {
    const next = step + 1;
    if (next === 3 && skipSlotStep) setStep(4);
    else setStep(next as 2 | 3 | 4 | 5);
  };

  const goBack = (target: 1 | 2 | 3 | 4 | 5) => {
    if (target === 3 && skipSlotStep) setStep(2);
    else setStep(target);
  };

  const handleCreateCustomer = () => {
    if (!newName.trim() || !newPhone.trim()) return;
    createCustomer.mutate(
      { data: { name: newName.trim(), phone: newPhone.trim(), whatsapp: newPhone.trim() } },
      {
        onSuccess: (c: Customer) => {
          setCustomer(c);
          advance();
        },
        onError: () => toast({ variant: "destructive", title: strings.sale.createCustomerError }),
      },
    );
  };

  const handleSubmit = () => {
    if (!product || !customer) return;
    createSale.mutate(
      {
        data: {
          productId: product.id,
          slotId: slotAssignment === "manual" ? selectedSlot?.id : undefined,
          customerId: customer.id,
          price,
          notes: notes.trim() || undefined,
          payment: {
            amount: price,
            method,
            paidAt: new Date(paidAt).toISOString(),
            notes: undefined,
          },
        },
      },
      {
        onSuccess: (result) => setSubscriptionId((result as any).subscription.id),
        onError: (err: any) => {
          const message = (() => {
            try { return JSON.parse(err.message)?.error; } catch { return undefined; }
          })();
          toast({ variant: "destructive", title: message || strings.app.error });
        },
      },
    );
  };

  if (subscriptionId) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle2 className="h-16 w-16 text-green-600" />
          <h1 className="text-2xl font-bold">{strings.sale.success}</h1>
          <p className="text-muted-foreground">{strings.sale.successDescription}</p>
          <Button asChild>
            <Link href={`/subscriptions/${subscriptionId}`}>{strings.sale.viewSubscription}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const completedSteps = [
    product && step > 1 ? 1 : null,
    customer && step > 2 ? 2 : null,
    !skipSlotStep && step > 3 ? 3 : null,
    step === 5 ? 4 : null,
  ].filter((n): n is number => n !== null);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{strings.sale.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.sale.intro}</p>
      </div>

      <WizardProgress current={step} completed={completedSteps} skipSlot={skipSlotStep} />

      {completedSteps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {product && step > 1 && (
            <SummaryChip label={`المنتج: ${product.name}`} onClick={() => goBack(1)} />
          )}
          {customer && step > 2 && (
            <SummaryChip label={`العميل: ${customer.name}`} onClick={() => goBack(2)} />
          )}
          {!skipSlotStep && step > 3 && (
            <SummaryChip
              label={
                slotAssignment === "auto"
                  ? "الخانة: تلقائي"
                  : `الخانة: ${selectedSlot?.accountLabel} · مقعد ${selectedSlot?.slotIndex}`
              }
              onClick={() => goBack(3)}
            />
          )}
          {step === 5 && (
            <SummaryChip
              label={`${strings.subscriptions.price}: ${price}`}
              onClick={() => goBack(4)}
            />
          )}
        </div>
      )}

      {/* Step 1 — Product */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.productStep}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : products.length === 0 ? (
              <p className="text-sm text-muted-foreground">{strings.sale.noAvailableProducts}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(products as AvailableProduct[]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={p.freeSlotCount === 0}
                    onClick={() => { setProduct(p); advance(); }}
                    className={cn(
                      "rounded-lg border p-4 text-start transition hover:border-primary hover:bg-primary/5",
                      p.freeSlotCount === 0 && "cursor-not-allowed opacity-50",
                      product?.id === p.id && "border-primary bg-primary/5 ring-1 ring-primary",
                    )}
                  >
                    <strong className="block">{p.name}</strong>
                    {p.freeSlotCount === 0 ? (
                      <span className="text-xs text-destructive">مباع بالكامل</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {p.freeSlotCount} {strings.sale.freeSlots}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Customer */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.customerStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowNewForm(false); }}
                placeholder={strings.customers.searchPlaceholder}
                className="pe-10"
                autoFocus
              />
            </div>

            {customerSearch && customers.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {(customers as Customer[]).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCustomer(c); advance(); }}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                  >
                    <span>{c.name}</span>
                    <span className="text-muted-foreground" dir="ltr">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}

            {customerSearch && customers.length === 0 && (
              <p className="text-sm text-muted-foreground">{strings.customers.noResults}</p>
            )}

            <button
              type="button"
              onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="h-4 w-4" />
              {strings.sale.newCustomer}
            </button>

            {showNewForm && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder={strings.customers.name}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Input
                    dir="ltr"
                    className="text-start"
                    placeholder={strings.customers.phone}
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!newName.trim() || !newPhone.trim() || createCustomer.isPending}
                  onClick={handleCreateCustomer}
                >
                  {createCustomer.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    strings.sale.createCustomerInline
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Slot assignment (skipped if single account) */}
      {step === 3 && !skipSlotStep && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.slotStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["auto", "manual"] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSlotAssignment(val)}
                  className={cn(
                    "rounded-md border p-3 text-start text-sm transition",
                    slotAssignment === val && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  <strong className="block">
                    {val === "auto" ? strings.sale.autoAssign : strings.sale.manualAssign}
                  </strong>
                  {val === "auto" && (
                    <span className="text-xs text-muted-foreground">
                      {strings.sale.autoAssignDescription}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {slotAssignment === "manual" && (
              <Select
                value={selectedSlot?.id.toString()}
                onValueChange={(v) =>
                  setSelectedSlot((slots as AvailableSlot[]).find((s) => s.id === Number(v)))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={strings.sale.selectSlot} />
                </SelectTrigger>
                <SelectContent>
                  {(slots as AvailableSlot[]).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.accountLabel} · {strings.subscriptions.slot} {s.slotIndex}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              className="w-full"
              disabled={slotAssignment === "manual" && !selectedSlot}
              onClick={advance}
            >
              التالي
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4 — Dates & price */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.datesStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {strings.sale.accountDatesHint}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{strings.subscriptions.price}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{strings.sale.paymentMethod}</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as "cash" | "transfer" | "other")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{strings.sale.methodCash}</SelectItem>
                    <SelectItem value="transfer">{strings.sale.methodTransfer}</SelectItem>
                    <SelectItem value="other">{strings.sale.methodOther}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{strings.sale.paidAt}</Label>
                <Input
                  type="datetime-local"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                {strings.subscriptions.notes}{" "}
                <span className="text-xs text-muted-foreground">({strings.common.optional})</span>
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <Button
              className="w-full"
              onClick={advance}
            >
              التالي
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 5 — Confirm */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.confirmStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ConfirmRow label="المنتج" value={product?.name ?? ""} />
              <ConfirmRow label="العميل" value={`${customer?.name} · ${customer?.phone}`} />
              <ConfirmRow
                label="الخانة"
                value={
                  skipSlotStep || slotAssignment === "auto"
                    ? "تلقائي"
                    : `${selectedSlot?.accountLabel} · مقعد ${selectedSlot?.slotIndex}`
                }
              />
              <ConfirmRow label={strings.subscriptions.price} value={String(price)} />
              <ConfirmRow
                label={strings.sale.paymentMethod}
                value={
                  method === "cash"
                    ? strings.sale.methodCash
                    : method === "transfer"
                      ? strings.sale.methodTransfer
                      : strings.sale.methodOther
                }
              />
            </dl>
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={createSale.isPending}
            >
              {createSale.isPending ? (
                <Loader2 className="me-2 h-5 w-5 animate-spin" />
              ) : (
                <ShoppingCart className="me-2 h-5 w-5" />
              )}
              {strings.sale.confirm}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WizardProgress({
  current,
  completed,
  skipSlot,
}: {
  current: number;
  completed: number[];
  skipSlot: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n, i) => {
        const isSkipped = n === 3 && skipSlot;
        const isDone = completed.includes(n);
        const isActive = current === n;
        return (
          <div key={n} className="flex flex-1 items-center gap-1">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
                isSkipped && "opacity-30 bg-muted text-muted-foreground",
                isDone && !isSkipped && "bg-primary/20 text-primary",
                isActive && "bg-primary text-primary-foreground",
                !isDone && !isActive && !isSkipped && "bg-muted text-muted-foreground",
              )}
            >
              {isDone && !isSkipped ? <Check className="h-3.5 w-3.5" /> : n}
            </div>
            {i < 4 && <div className="flex-1 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs hover:bg-muted/70 transition-colors"
    >
      <Check className="h-3 w-3 text-primary" />
      {label}
    </button>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
