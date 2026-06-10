import { useEffect, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListAdminAuditLog } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const PAGE_SIZE = 100;

export default function Audit() {
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(0);

  useEffect(() => { setPage(0); }, [action]);

  const { data = [], isFetching } = useListAdminAuditLog(
    action === "all" ? undefined : action,
    page * PAGE_SIZE,
  );

  const hasNextPage = data.length === PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{strings.phase3.audit}</h1>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{strings.phase3.allActions}</SelectItem>
            {["sale", "renew", "credential_reveal", "settings_update", "user_create", "user_update", "user_password_reset", "subscription_cancel"].map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {data.length === 0 && !isFetching && (
          <p className="text-sm text-muted-foreground">{strings.app.noData}</p>
        )}
        {data.map((entry) => (
          <Card key={entry.id}>
            <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-4">
              <Fact label={strings.phase3.who} value={entry.userName || "-"} />
              <Fact label={strings.phase3.action} value={entry.action} />
              <Fact
                label={strings.phase3.entity}
                value={`${entry.entityType}${entry.entityId ? ` #${entry.entityId}` : ""}`}
              />
              <Fact label={strings.phase3.when} value={entry.createdAt} />
            </CardContent>
          </Card>
        ))}
      </div>

      {(hasPrevPage || hasNextPage) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrevPage || isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronRight className="h-4 w-4 me-1" />
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">صفحة {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
            <ChevronLeft className="h-4 w-4 ms-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
