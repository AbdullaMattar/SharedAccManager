import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type AccountWithSlots,
  type Product,
  getListAccountsQueryKey,
  getListProductsQueryKey,
  useDeleteAccount,
  useDeleteProduct,
  useListAccounts,
  useListProducts,
} from "@workspace/api-client-react";
import { Edit2, KeyRound, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { AccountFormDialog } from "@/components/account-form-dialog";
import { PasswordReveal } from "@/components/password-reveal";
import { ProductFormDialog } from "@/components/product-form-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { strings } from "@/lib/strings";

export default function Inventory() {
  const { data: products = [], isLoading: productsLoading } = useListProducts();
  const { data: accounts = [], isLoading: accountsLoading } = useListAccounts();
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountWithSlots | null>(null);
  const [accountProducts, setAccountProducts] = useState<Product[]>([]);
  const deleteProduct = useDeleteProduct();
  const deleteAccount = useDeleteAccount();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const openProductForm = (product: Product | null = null) => {
    setEditingProduct(product);
    setProductFormOpen(true);
  };

  const openAccountForm = (account: AccountWithSlots | null = null, product?: Product) => {
    setEditingAccount(account);
    setAccountProducts(
      product
        ? [product, ...products.filter((item) => item.id !== product.id)]
        : products,
    );
    setAccountFormOpen(true);
  };

  const removeProduct = (id: number) => {
    deleteProduct.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: strings.products.deleteSuccess });
        },
        onError: () => toast({ variant: "destructive", title: strings.app.deleteError }),
      },
    );
  };

  const removeAccount = (id: number) => {
    deleteAccount.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          toast({ title: strings.accounts.deleteSuccess });
        },
        onError: () => toast({ variant: "destructive", title: strings.app.deleteError }),
      },
    );
  };

  if (productsLoading || accountsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{strings.inventory.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {strings.inventory.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openProductForm()}>
            <Plus className="me-2 h-4 w-4" />
            {strings.products.add}
          </Button>
          <Button onClick={() => openAccountForm()} disabled={!products.length}>
            <Plus className="me-2 h-4 w-4" />
            {strings.accounts.add}
          </Button>
        </div>
      </header>

      {!products.length ? (
        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <Package className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold">{strings.inventory.startTitle}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {strings.inventory.startDescription}
            </p>
            <Button className="mt-5" onClick={() => openProductForm()}>
              <Plus className="me-2 h-4 w-4" />
              {strings.products.add}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {products.map((product) => {
            const productAccounts = accounts.filter(
              (account) => account.productId === product.id,
            );
            return (
              <section key={product.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-col gap-4 border-b bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-bold">{product.name}</h2>
                      <Badge variant="secondary">{product.service}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>{strings.inventory.defaultPrice}: <strong className="text-foreground">{product.defaultPrice} {strings.common.currency}</strong></span>
                      <span>{strings.inventory.defaultCapacity}: <strong className="text-foreground">{product.defaultCapacity}</strong></span>
                      <span>{strings.inventory.defaultDuration}: <strong className="text-foreground">{product.defaultDurationDays} {strings.common.day}</strong></span>
                      <span>{strings.inventory.accountsCount}: <strong className="text-foreground">{productAccounts.length}</strong></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => openAccountForm(null, product)}>
                      <Plus className="me-2 h-4 w-4" />
                      {strings.inventory.addAccountToProduct}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openProductForm(product)}>
                      <Edit2 className="me-2 h-4 w-4" />
                      {strings.app.edit}
                    </Button>
                    <DeleteAction onDelete={() => removeProduct(product.id)} />
                  </div>
                </div>

                {productAccounts.length ? (
                  <div className="divide-y">
                    {productAccounts.map((account) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        onEdit={() => openAccountForm(account)}
                        onDelete={() => removeAccount(account.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{strings.inventory.noAccountsTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {strings.inventory.noAccountsDescription}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openAccountForm(null, product)}>
                      <Plus className="me-2 h-4 w-4" />
                      {strings.inventory.addFirstAccount}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {productFormOpen && (
        <ProductFormDialog
          open={productFormOpen}
          onOpenChange={setProductFormOpen}
          product={editingProduct}
        />
      )}
      {accountFormOpen && (
        <AccountFormDialog
          open={accountFormOpen}
          onOpenChange={setAccountFormOpen}
          account={editingAccount}
          products={accountProducts}
        />
      )}
    </div>
  );
}

function AccountRow({
  account,
  onEdit,
  onDelete,
}: {
  account: AccountWithSlots;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">{account.label}</h3>
          <StatusBadge status={account.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground" dir="ltr">
            {account.email}
          </span>
          <PasswordReveal accountId={account.id} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{strings.inventory.slotUsage}</span>
          <strong>{account.occupiedSlots} / {account.capacity}</strong>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${account.capacity ? (account.occupiedSlots / account.capacity) * 100 : 0}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {account.startDate} - {account.expiryDate}
        </p>
      </div>
      <div className="flex gap-1 md:justify-end">
        <Button variant="ghost" size="icon" aria-label={strings.app.edit} onClick={onEdit}>
          <Edit2 className="h-4 w-4" />
        </Button>
        <DeleteAction onDelete={onDelete} iconOnly />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return <Badge className="border-green-500/20 bg-green-500/10 text-green-700 hover:bg-green-500/10">{strings.accounts.statusActive}</Badge>;
  }
  if (status === "needs_attention") {
    return <Badge variant="destructive">{strings.accounts.statusNeedsAttention}</Badge>;
  }
  return <Badge variant="secondary">{strings.accounts.statusDisabled}</Badge>;
}

function DeleteAction({ onDelete, iconOnly = false }: { onDelete: () => void; iconOnly?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size={iconOnly ? "icon" : "sm"} className="text-destructive hover:text-destructive">
          <Trash2 className={iconOnly ? "h-4 w-4" : "me-2 h-4 w-4"} />
          {iconOnly ? <span className="sr-only">{strings.app.delete}</span> : strings.app.delete}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{strings.app.confirmDelete}</AlertDialogTitle>
          <AlertDialogDescription>{strings.app.confirmDeleteDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive" onClick={onDelete}>
            {strings.app.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
