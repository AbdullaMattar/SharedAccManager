import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AccountWithSlots, AccountInput, AccountUpdate, Product } from "@workspace/api-client-react";
import { useCreateAccount, useUpdateAccount, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { strings } from "@/lib/strings";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { addDays, format } from "date-fns";

const today = () => format(new Date(), "yyyy-MM-dd");

const accountSchema = z.object({
  productId: z.coerce.number().min(1, { message: "مطلوب" }),
  label: z.string().min(1, { message: "مطلوب" }),
  email: z.string().min(1, { message: "مطلوب" }).email({ message: "بريد إلكتروني غير صالح" }),
  password: z.string().optional(),
  capacity: z.coerce.number().min(1, { message: "مطلوب" }),
  status: z.enum(["active", "disabled", "needs_attention"]),
  startDate: z.string().min(1, { message: "مطلوب" }),
  expiryDate: z.string().min(1, { message: "مطلوب" }),
  notes: z.string().optional(),
}).refine((value) => value.expiryDate >= value.startDate, {
  message: "تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية",
  path: ["expiryDate"],
});

type AccountFormValues = z.infer<typeof accountSchema>;

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: AccountWithSlots | null;
  products: Product[];
}

export function AccountFormDialog({ open, onOpenChange, account, products }: AccountFormDialogProps) {
  const isEditing = !!account;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      productId: account?.productId || (products[0]?.id || 0),
      label: account?.label || "",
      email: account?.email || "",
      password: "", // Password is required on create, optionally provided on update (but we keep it simple here by making it required or we adjust schema for edit)
      capacity: account?.capacity || (products[0]?.defaultCapacity || 1),
      status: account?.status || "active",
      startDate: account?.startDate || today(),
      expiryDate: account?.expiryDate || format(addDays(new Date(), products[0]?.defaultDurationDays || 30), "yyyy-MM-dd"),
      notes: account?.notes || "",
    },
  });

  // If editing, password is not strictly required by the API usually, but our schema makes it required.
  // Actually, AccountUpdate in the API has password as optional. Let's adjust validation dynamically.
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: AccountFormValues) => {
    if (!isEditing && !data.password) {
      form.setError("password", { message: strings.common.required });
      return;
    }
    if (isEditing && account) {
      const updateData: AccountUpdate = {
        label: data.label,
        email: data.email,
        capacity: data.capacity,
        status: data.status,
        startDate: data.startDate,
        expiryDate: data.expiryDate,
        notes: data.notes,
      };
      if (data.password) {
        updateData.password = data.password;
      }

      updateMutation.mutate(
        { id: account.id, data: updateData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
            toast({ title: strings.accounts.updateSuccess });
            onOpenChange(false);
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: data as AccountInput },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
            toast({ title: strings.accounts.createSuccess });
            onOpenChange(false);
          },
        }
      );
    }
  };

  const handleProductChange = (productIdStr: string) => {
    const pId = parseInt(productIdStr, 10);
    const product = products.find(p => p.id === pId);
    if (product && !isEditing) {
      form.setValue("capacity", product.defaultCapacity);
      form.setValue("expiryDate", format(addDays(new Date(`${form.getValues("startDate")}T00:00:00`), product.defaultDurationDays), "yyyy-MM-dd"));
    }
    form.setValue("productId", pId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="dialog-account-form">
        <DialogHeader>
          <DialogTitle>{isEditing ? strings.accounts.edit : strings.accounts.add}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!isEditing && (
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.accounts.product}</FormLabel>
                    <Select
                      onValueChange={handleProductChange}
                      defaultValue={field.value ? field.value.toString() : undefined}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-account-product">
                          <SelectValue placeholder={strings.accounts.selectProduct} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.accounts.label}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-account-label" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.accounts.email}</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" dir="ltr" className="text-start" data-testid="input-account-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.accounts.password} {isEditing && "(اتركه فارغاً للاحتفاظ بالحالي)"}</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" dir="ltr" className="text-start" data-testid="input-account-password" required={!isEditing} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.accounts.capacity}</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} data-testid="input-account-capacity" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.accounts.status}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-account-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">{strings.accounts.statusActive}</SelectItem>
                        <SelectItem value="disabled">{strings.accounts.statusDisabled}</SelectItem>
                        <SelectItem value="needs_attention">{strings.accounts.statusNeedsAttention}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.accounts.startDate}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-account-start-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.accounts.expiryDate}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-account-expiry-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.accounts.notes}</FormLabel>
                  <FormControl>
                    <Textarea {...field} data-testid="input-account-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel">
                {strings.app.cancel}
              </Button>
              <Button type="submit" disabled={isPending} data-testid="btn-submit-account">
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {strings.app.save}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
