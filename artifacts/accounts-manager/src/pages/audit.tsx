import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListAdminAuditLog } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
export default function Audit() {
  const [action, setAction] = useState("all"); const { data = [] } = useListAdminAuditLog(action === "all" ? undefined : action);
  return <div className="space-y-5"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{strings.phase3.audit}</h1><Select value={action} onValueChange={setAction}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{strings.phase3.allActions}</SelectItem>{["sale", "renew", "reveal", "settings_update", "user_update"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2">{data.map((entry) => <Card key={entry.id}><CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-4"><Fact label={strings.phase3.who} value={entry.userName || "-"} /><Fact label={strings.phase3.action} value={entry.action} /><Fact label={strings.phase3.entity} value={`${entry.entityType}${entry.entityId ? ` #${entry.entityId}` : ""}`} /><Fact label={strings.phase3.when} value={entry.createdAt} /></CardContent></Card>)}</div></div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><span className="block text-xs text-muted-foreground">{label}</span>{value}</div>; }
