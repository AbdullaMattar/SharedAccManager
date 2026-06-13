import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformOrgs, useSuspendOrg, useUnsuspendOrg, useDeleteOrg, useResetOrgOwnerPassword, type PlatformOrg } from "@/lib/phase3-api";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
export default function PlatformPage() {
  const { data = [], isLoading } = usePlatformOrgs();
  const suspend = useSuspendOrg();
  const unsuspend = useUnsuspendOrg();
  const remove = useDeleteOrg();
  const resetOwnerPassword = useResetOrgOwnerPassword();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [resetOrg, setResetOrg] = useState<PlatformOrg | undefined>();
  const [newPassword, setNewPassword] = useState("");

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });
  };

  const updateStatus = (id: number, suspended: boolean) => {
    const mutation = suspended ? suspend : unsuspend;
    mutation.mutate({ id }, {
      onSuccess: reload,
      onError: () => toast({ title: "تعذر تحديث حالة النشاط", variant: "destructive" }),
    });
  };

  const deleteOrg = (id: number) => {
    remove.mutate({ id }, {
      onSuccess: reload,
      onError: () => toast({ title: "تعذر حذف النشاط", variant: "destructive" }),
    });
  };

  const doResetPassword = () => {
    if (!resetOrg) return;
    resetOwnerPassword.mutate({ id: resetOrg.id, password: newPassword }, {
      onSuccess: () => {
        setResetOrg(undefined);
        setNewPassword("");
        toast({ title: "تم إعادة تعيين كلمة المرور" });
      },
      onError: () => toast({ title: "تعذر إعادة تعيين كلمة المرور", variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <h1 className="text-2xl font-bold">إدارة المنصة</h1>
        <p className="mt-1 text-sm text-muted-foreground">عرض الأنشطة وتعليقها أو إعادة تفعيلها</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>الأنشطة</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم النشاط</TableHead>
                <TableHead>بريد المالك</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإحصاءات</TableHead>
                <TableHead>الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <div className="font-medium">{org.name}</div>
                    <div className="text-xs text-muted-foreground">#{org.id}</div>
                  </TableCell>
                  <TableCell>{org.ownerEmail ?? "-"}</TableCell>
                  <TableCell>{org.status === "active" ? "نشط" : "معلق"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {`المستخدمون: ${org.usersCount} | المنتجات: ${org.productsCount} | الحسابات: ${org.accountsCount} | العملاء: ${org.customersCount} | الاشتراكات: ${org.subscriptionsCount} | المدفوعات: ${org.paymentsCount}`}
                  </TableCell>
                  <TableCell>
                    {org.id === 1 ? (
                      <span className="text-xs text-muted-foreground">النشاط التجريبي محمي</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={org.status === "active" ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => updateStatus(org.id, org.status === "active")}
                          disabled={suspend.isPending || unsuspend.isPending}
                        >
                          {org.status === "active" ? "تعليق" : "إعادة تفعيل"}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => { setResetOrg(org); setNewPassword(""); }}
                          aria-label="إعادة تعيين كلمة المرور"
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={remove.isPending}>
                              حذف
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف النشاط نهائياً؟</AlertDialogTitle>
                              <AlertDialogDescription>
                                {`سيتم حذف "${org.name}" وكل بياناته (المستخدمون والمنتجات والحسابات والعملاء والاشتراكات والمدفوعات) نهائياً. لا يمكن التراجع عن هذا الإجراء.`}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteOrg(org.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!resetOrg} onOpenChange={(open) => { if (!open) { setResetOrg(undefined); setNewPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعادة تعيين كلمة مرور المالك — {resetOrg?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>كلمة المرور الجديدة</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8 أحرف على الأقل"
              dir="ltr"
            />
          </div>
          <DialogFooter>
            <Button onClick={doResetPassword} disabled={resetOwnerPassword.isPending || newPassword.length < 8}>
              {resetOwnerPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
