import { useEffect, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListAdminAuditLog } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const PAGE_SIZE = 100;

const ACTION_LABELS: Record<string, string> = {
  sale: "بيع جديد",
  renew: "تجديد اشتراك",
  credential_reveal: "كشف بيانات الدخول",
  settings_update: "تعديل الإعدادات",
  user_create: "إنشاء مستخدم",
  user_update: "تعديل مستخدم",
  user_password_reset: "إعادة تعيين كلمة مرور",
  subscription_cancel: "إلغاء اشتراك",
  subscription_refund: "إرجاع مبلغ اشتراك",
};

function formatDateTime(iso: string) {
  try {
    return format(new Date(iso), "yyyy/MM/dd HH:mm");
  } catch {
    return iso;
  }
}

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
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
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
              <Fact label={strings.phase3.action} value={ACTION_LABELS[entry.action] || entry.action} />
              <Fact
                label={strings.phase3.entity}
                value={`${entry.entityType}${entry.entityId ? ` #${entry.entityId}` : ""}`}
              />
              <Fact label={strings.phase3.when} value={formatDateTime(entry.createdAt)} />
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
            {strings.common.previous}
          </Button>
          <span className="text-sm text-muted-foreground">{strings.common.page} {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            {strings.common.next}
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
