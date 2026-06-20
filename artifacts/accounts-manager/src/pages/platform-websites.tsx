import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { usePlatformWebsites, useUpdatePlatformWebsite } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function PlatformWebsitesPage() {
  const { data = [], isLoading } = usePlatformWebsites();
  const update = useUpdatePlatformWebsite();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const setAccess = (orgId: number, platformEnabled: boolean) => {
    update.mutate({ orgId, platformEnabled }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform", "websites"] }),
      onError: () => toast({ title: strings.website.updateAccessError, variant: "destructive" }),
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
        <h1 className="text-2xl font-bold">{strings.website.platformWebsites}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{strings.website.platformHint}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5" />
            {strings.website.platformWebsites}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النشاط</TableHead>
                <TableHead>حالة النشاط</TableHead>
                <TableHead>إتاحة الموقع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((org) => (
                <TableRow key={org.orgId}>
                  <TableCell>
                    <div className="font-medium">{org.orgName}</div>
                    <div className="text-xs text-muted-foreground">#{org.orgId}</div>
                  </TableCell>
                  <TableCell>{org.orgStatus === "active" ? "نشط" : "معلق"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={org.platformEnabled}
                        disabled={update.isPending}
                        onCheckedChange={(checked) => setAccess(org.orgId, checked)}
                      />
                      <span className="text-sm text-muted-foreground">
                        {org.platformEnabled ? strings.website.accessAllowed : strings.website.accessBlocked}
                      </span>
                    </div>
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
