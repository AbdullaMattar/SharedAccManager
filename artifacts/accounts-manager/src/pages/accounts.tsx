import { useState } from "react";
import { useListAccounts, useDeleteProduct, getListAccountsQueryKey, AccountWithSlots, useListProducts, useDeleteAccount } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AccountFormDialog } from "@/components/account-form-dialog";
import { PasswordReveal } from "@/components/password-reveal";
import { Plus, Edit2, Trash2, Loader2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

const getStatusBadge = (status: string) => {
  switch (status) {
    case "active":
      return <Badge className="bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-500/20">{strings.accounts.statusActive}</Badge>;
    case "disabled":
      return <Badge variant="secondary" className="text-muted-foreground">{strings.accounts.statusDisabled}</Badge>;
    case "needs_attention":
      return <Badge variant="destructive" className="bg-red-500/10 text-red-700 hover:bg-red-500/20 border-red-500/20">{strings.accounts.statusNeedsAttention}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const renderSlots = (capacity: number, occupied: number) => {
  const dots = [];
  for (let i = 0; i < capacity; i++) {
    if (i < occupied) {
      dots.push(<span key={i} className="text-primary text-xl leading-none">●</span>);
    } else {
      dots.push(<span key={i} className="text-muted-foreground/30 text-xl leading-none">○</span>);
    }
  }
  return <div className="flex gap-0.5 tracking-tighter" dir="ltr">{dots}</div>;
};

export default function Accounts() {
  const { data: accounts, isLoading: accountsLoading } = useListAccounts();
  const { data: products, isLoading: productsLoading } = useListProducts();
  
  const [formOpen, setFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountWithSlots | null>(null);
  
  const deleteMutation = useDeleteAccount();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleEdit = (account: AccountWithSlots) => {
    setEditingAccount(account);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditingAccount(null);
    setFormOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          toast({ title: strings.accounts.deleteSuccess });
        },
      }
    );
  };

  if (accountsLoading || productsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{strings.accounts.title}</h1>
        <Button onClick={handleCreate} disabled={!products?.length} data-testid="btn-create-account">
          <Plus className="me-2 h-4 w-4" />
          {strings.accounts.add}
        </Button>
      </div>

      {!products?.length ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <CardTitle className="mb-2">لا توجد منتجات</CardTitle>
          <CardDescription>يجب إضافة منتج أولاً قبل إضافة الحسابات</CardDescription>
        </Card>
      ) : accounts?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center" data-testid="empty-accounts">
          <Users className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
          <CardTitle className="mb-2">{strings.app.noData}</CardTitle>
          <Button variant="outline" onClick={handleCreate} className="mt-4">
            {strings.accounts.add}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts?.map((account) => (
            <Card key={account.id} data-testid={`card-account-${account.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{account.label}</CardTitle>
                      {getStatusBadge(account.status)}
                    </div>
                    <CardDescription className="font-medium text-primary">
                      {account.productName}
                    </CardDescription>
                  </div>
                  <div className="flex space-x-2 space-x-reverse">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(account)} data-testid={`btn-edit-account-${account.id}`}>
                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`btn-delete-account-${account.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{strings.app.confirmDelete}</AlertDialogTitle>
                          <AlertDialogDescription>{strings.app.confirmDeleteDesc}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => handleDelete(account.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {strings.app.delete}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="text-muted-foreground font-mono text-xs" dir="ltr">{account.email}</span>
                  <PasswordReveal accountId={account.id} />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground text-xs">
                    {account.occupiedSlots} من {account.capacity} خانات
                  </div>
                  {renderSlots(account.capacity, account.occupiedSlots)}
                </div>
                
                {account.notes && (
                  <p className="pt-3 border-t border-border text-xs text-muted-foreground line-clamp-2">
                    {account.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <AccountFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          account={editingAccount}
          products={products || []}
        />
      )}
    </div>
  );
}
