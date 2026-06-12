import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePlatformOrgs, useSuspendOrg, useUnsuspendOrg } from "@/lib/phase3-api";
import { useToast } from "@/hooks/use-toast";
export default function PlatformPage() {
  const { data = [], isLoading } = usePlatformOrgs();
  const suspend = useSuspendOrg();
  const unsuspend = useUnsuspendOrg();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
                      <Button
                        variant={org.status === "active" ? "destructive" : "outline"}
                        size="sm"
                        onClick={() => updateStatus(org.id, org.status === "active")}
                        disabled={suspend.isPending || unsuspend.isPending}
                      >
                        {org.status === "active" ? "تعليق" : "إعادة تفعيل"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
