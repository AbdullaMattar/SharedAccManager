import { useState } from "react";
import { useListProducts, useDeleteProduct, getListProductsQueryKey, Product } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { Plus, Edit2, Trash2, Loader2, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function Products() {
  const { data: products, isLoading } = useListProducts();
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  const deleteMutation = useDeleteProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditingProduct(null);
    setFormOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: strings.products.deleteSuccess });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{strings.products.title}</h1>
        <Button onClick={handleCreate} data-testid="btn-create-product">
          <Plus className="me-2 h-4 w-4" />
          {strings.products.add}
        </Button>
      </div>

      {products?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center" data-testid="empty-products">
          <Package className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
          <CardTitle className="mb-2">{strings.app.noData}</CardTitle>
          <Button variant="outline" onClick={handleCreate} className="mt-4">
            {strings.products.add}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products?.map((product) => (
            <Card key={product.id} data-testid={`card-product-${product.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{product.name}</CardTitle>
                    <CardDescription>{product.service}</CardDescription>
                  </div>
                  <div className="flex space-x-2 space-x-reverse">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(product)} data-testid={`btn-edit-product-${product.id}`}>
                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`btn-delete-product-${product.id}`}>
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
                            onClick={() => handleDelete(product.id)}
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
              <CardContent className="text-sm">
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <div>
                    <span className="block font-medium text-foreground">{product.defaultPrice}</span>
                    <span>السعر</span>
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">{product.defaultCapacity}</span>
                    <span>السعة</span>
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">{product.defaultDurationDays} يوم</span>
                    <span>المدة</span>
                  </div>
                </div>
                {product.notes && (
                  <p className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground line-clamp-2">
                    {product.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <ProductFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          product={editingProduct}
        />
      )}
    </div>
  );
}
