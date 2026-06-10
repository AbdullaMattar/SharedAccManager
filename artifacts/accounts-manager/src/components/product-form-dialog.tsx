import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Product, ProductInput, ProductUpdate } from "@workspace/api-client-react";
import { useCreateProduct, useUpdateProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/strings";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const productSchema = z.object({
  name: z.string().min(1, { message: "مطلوب" }),
  service: z.string().min(1, { message: "مطلوب" }),
  defaultCapacity: z.coerce.number().min(1, { message: "مطلوب" }),
  defaultDurationDays: z.coerce.number().min(1, { message: "مطلوب" }),
  defaultPrice: z.coerce.number().min(0, { message: "مطلوب" }),
  notes: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
}

export function ProductFormDialog({ open, onOpenChange, product }: ProductFormDialogProps) {
  const isEditing = !!product;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || "",
      service: product?.service || "",
      defaultCapacity: product?.defaultCapacity || 1,
      defaultDurationDays: product?.defaultDurationDays || 30,
      defaultPrice: product?.defaultPrice || 0,
      notes: product?.notes || "",
    },
  });

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: ProductFormValues) => {
    if (isEditing && product) {
      updateMutation.mutate(
        { id: product.id, data: data as ProductUpdate },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: strings.products.updateSuccess });
            onOpenChange(false);
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: data as ProductInput },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: strings.products.createSuccess });
            onOpenChange(false);
          },
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="dialog-product-form">
        <DialogHeader>
          <DialogTitle>{isEditing ? strings.products.edit : strings.products.add}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.products.name}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-product-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="service"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.products.service}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-product-service" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="defaultCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.products.defaultCapacity}</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} data-testid="input-product-capacity" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="defaultDurationDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{strings.products.defaultDurationDays}</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} data-testid="input-product-duration" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="defaultPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.products.defaultPrice}</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} step="0.01" {...field} data-testid="input-product-price" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{strings.products.notes}</FormLabel>
                  <FormControl>
                    <Textarea {...field} data-testid="input-product-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel">
                {strings.app.cancel}
              </Button>
              <Button type="submit" disabled={isPending} data-testid="btn-submit-product">
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
