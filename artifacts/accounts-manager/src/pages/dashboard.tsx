import { Link } from "wouter";
import { CircleDollarSign, Layers3, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RenewSubscriptionDialog } from "@/components/renew-subscription-dialog";
import { useGetDashboard } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard();
  if (isLoading) return <DashboardSkeleton />;
  if (!data) return <p>{strings.app.noData}</p>;
  const currency = data.currency || strings.common.currency;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{data.businessName || strings.phase3.dashboard}</h1>
        <p className="text-sm text-muted-foreground">{strings.phase3.needsAction}</p>
      </div>

      {/* Renewal alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{strings.phase3.expiringSoon}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0 pb-2">
          {[
            { days: 1, label: strings.phase3.withinOneDay, count: data.expiringCounts.oneDay },
            { days: 3, label: strings.phase3.withinThreeDays, count: data.expiringCounts.threeDays },
            { days: 7, label: strings.phase3.withinSevenDays, count: data.expiringCounts.sevenDays },
          ].map(({ days, label, count }) => (
            <Link
              key={days}
              href={`/expiring?days=${days}`}
              className="flex items-center justify-between px-6 py-2.5 hover:bg-muted transition-colors"
            >
              <span className="text-sm">{label}</span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  count > 0 ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Quick totals */}
      <section>
        <h2 className="mb-3 font-bold">{strings.phase3.quickTotals}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/subscriptions" className="block">
            <TotalCard
              icon={UserCheck}
              label={strings.phase3.activeSubscriptions}
              value={data.totals.activeSubscriptions}
            />
          </Link>
          <Link href="/inventory" className="block">
            <TotalCard
              icon={Layers3}
              label={strings.phase3.totalAccounts}
              value={data.totals.totalAccounts}
            />
          </Link>
          <Link href="/reports/revenue" className="block">
            <TotalCard
              icon={CircleDollarSign}
              label={strings.phase3.monthlyRevenue}
              value={`${data.totals.monthlyRevenue} ${currency}`}
            />
          </Link>
        </div>
      </section>

      {/* Overdue + Free slots */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.overdue}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.overdue.length ? (
              data.overdue.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border p-3"
                >
                  <Link
                    href={`/subscriptions/${item.id}`}
                    className="flex-1 min-w-0"
                  >
                    <strong className="block truncate">{item.customerName}</strong>
                    <small className="text-muted-foreground">
                      {item.productName} · {item.expiryDate}
                    </small>
                  </Link>
                  <span className="shrink-0 text-sm text-destructive">
                    {strings.phase3.daysRemaining(item.daysRemaining)}
                  </span>
                  <RenewSubscriptionDialog
                    id={item.id}
                    durationDays={item.defaultDurationDays}
                    price={item.price}
                    trigger={
                      <button className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors">
                        {strings.phase3.renew}
                      </button>
                    }
                  />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{strings.phase3.noOverdue}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.freeSlots}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.freeSlots.map((item) => {
              const total = item.totalSlots ?? item.freeCount;
              const freePercent = total > 0 ? (item.freeCount / total) * 100 : 0;
              const barColor =
                freePercent > 50
                  ? "bg-green-500"
                  : freePercent > 20
                    ? "bg-amber-500"
                    : "bg-red-500";
              return (
                <Link
                  key={item.productId}
                  href="/inventory"
                  className="flex items-center gap-3 rounded-md bg-muted p-3 hover:bg-muted/70 transition-colors"
                >
                  <span className="flex-1 text-sm">{item.productName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", barColor)}
                        style={{ width: `${freePercent}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {item.freeCount} / {total}
                    </span>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TotalCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserCheck;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card className="hover:border-primary/50 transition-colors h-full">
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-6 w-6 text-primary shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <strong className="tabular-nums">{value}</strong>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <Card key={n}>
            <CardContent className="p-4">
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[1, 2].map((n) => (
          <Card key={n}>
            <CardContent className="space-y-2 p-6">
              {[1, 2, 3].map((m) => (
                <Skeleton key={m} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
