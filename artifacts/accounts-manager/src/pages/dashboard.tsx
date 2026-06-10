import { Link } from "wouter";
import { CalendarClock, CircleDollarSign, Layers3, Loader2, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetDashboard } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard();
  if (isLoading) return <Loading />;
  if (!data) return <p>{strings.app.noData}</p>;
  const currency = data.currency || strings.common.currency;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{data.businessName || strings.phase3.dashboard}</h1><p className="text-sm text-muted-foreground">{strings.phase3.needsAction}</p></div>
    <div className="grid grid-cols-3 gap-2 md:gap-4">{[[1, strings.phase3.withinOneDay, data.expiringCounts.oneDay], [3, strings.phase3.withinThreeDays, data.expiringCounts.threeDays], [7, strings.phase3.withinSevenDays, data.expiringCounts.sevenDays]].map(([days, label, count]) => <Link key={days} href={`/expiring?days=${days}`}><Card className="h-full border-amber-200 bg-amber-50/60 hover:bg-amber-100/70"><CardContent className="p-3 text-center md:p-5"><CalendarClock className="mx-auto mb-2 h-5 w-5 text-amber-600" /><strong className="block text-2xl">{count}</strong><span className="text-xs text-muted-foreground md:text-sm">{label}</span></CardContent></Card></Link>)}</div>
    <section><h2 className="mb-3 font-bold">{strings.phase3.quickTotals}</h2><div className="grid gap-3 sm:grid-cols-3"><Total icon={UserCheck} label={strings.phase3.activeSubscriptions} value={data.totals.activeSubscriptions} /><Total icon={Layers3} label={strings.phase3.totalAccounts} value={data.totals.totalAccounts} /><Total icon={CircleDollarSign} label={strings.phase3.monthlyRevenue} value={`${data.totals.monthlyRevenue} ${currency}`} /></div></section>
    <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>{strings.phase3.overdue}</CardTitle></CardHeader><CardContent className="space-y-2">{data.overdue.length ? data.overdue.map((item) => <Link key={item.id} href={`/subscriptions/${item.id}`} className="flex min-h-11 items-center justify-between rounded-md border p-3 hover:bg-muted"><span><strong className="block">{item.customerName}</strong><small>{item.productName} · {item.expiryDate}</small></span><span className="text-sm text-destructive">{strings.phase3.daysRemaining(item.daysRemaining)}</span></Link>) : <p className="text-sm text-muted-foreground">{strings.phase3.noOverdue}</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>{strings.phase3.freeSlots}</CardTitle></CardHeader><CardContent className="space-y-2">{data.freeSlots.map((item) => <div key={item.productId} className="flex min-h-11 items-center justify-between rounded-md bg-muted p-3"><span>{item.productName}</span><strong>{item.freeCount}</strong></div>)}</CardContent></Card></div>
  </div>;
}
function Total({ icon: Icon, label, value }: { icon: typeof UserCheck; label: string; value: React.ReactNode }) { return <Card><CardContent className="flex items-center gap-3 p-4"><Icon className="h-6 w-6 text-primary" /><div><p className="text-xs text-muted-foreground">{label}</p><strong>{value}</strong></div></CardContent></Card>; }
function Loading() { return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>; }
