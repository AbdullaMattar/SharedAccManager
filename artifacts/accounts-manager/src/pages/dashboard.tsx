import { useState } from "react";
import { Link } from "wouter";
import { CircleDollarSign, Layers3, UserCheck, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RenewSubscriptionDialog } from "@/components/renew-subscription-dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { useGetDashboard, useGetRevenueReport } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

function formatMonthLabel(yyyyMM: string): string {
  const [year, month] = yyyyMM.split("-");
  return `${strings.phase3.monthNames[parseInt(month) - 1]} ${year}`;
}

function getLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard();
  const last12 = getLast12Months();
  const [selectedMonth, setSelectedMonth] = useState(last12[0]);
  const { data: revenue } = useGetRevenueReport(selectedMonth);

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return <p>{strings.app.noData}</p>;

  const currency = data.currency || strings.common.currency;
  const revCurrency = revenue?.currency || currency;

  const formatRevenue = (rev: number, hasPayments: boolean) =>
    rev === 0 && hasPayments ? strings.phase3.refunded : `${rev} ${revCurrency}`;

  const currRev = revenue?.total ?? 0;
  const prevRev = revenue?.prevMonthRevenue ?? 0;
  const pctChange = prevRev !== 0 ? ((currRev - prevRev) / Math.abs(prevRev)) * 100 : null;

  const trendConfig = { revenue: { label: strings.phase3.monthlyRevenue, color: "hsl(var(--primary))" } };
  const productConfig = { revenue: { label: strings.phase3.revenueByProduct, color: "hsl(var(--primary))" } };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{data.businessName || strings.phase3.dashboard}</h1>
        <p className="text-sm text-muted-foreground">{strings.phase3.needsAction}</p>
      </div>

      {/* Quick totals */}
      <section>
        <h2 className="mb-3 font-bold">{strings.phase3.quickTotals}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/subscriptions" className="block">
            <TotalCard icon={UserCheck} label={strings.phase3.activeSubscriptions} value={data.totals.activeSubscriptions} />
          </Link>
          <Link href="/inventory" className="block">
            <TotalCard icon={Layers3} label={strings.phase3.totalAccounts} value={data.totals.totalAccounts} />
          </Link>
          <TotalCard icon={CircleDollarSign} label={strings.phase3.monthlyRevenue} value={`${data.totals.monthlyRevenue} ${currency}`} />
        </div>
      </section>

      {/* Revenue analytics */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-bold">{strings.phase3.report}</h2>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {last12.map((m) => (
                <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="flex items-center gap-4 p-6">
              <CircleDollarSign className="h-9 w-9" />
              <div>
                <p>{strings.phase3.monthlyRevenue}</p>
                <strong className="text-3xl">{formatRevenue(currRev, (revenue?.paymentsCount ?? 0) > 0)}</strong>
              </div>
            </CardContent>
          </Card>

          <Card className={pctChange !== null && pctChange >= 0 ? "bg-green-500 text-white" : "bg-red-500 text-white"}>
            <CardContent className="flex items-center gap-4 p-6">
              {pctChange !== null && pctChange >= 0
                ? <TrendingUp className="h-9 w-9" />
                : <TrendingDown className="h-9 w-9" />
              }
              <div>
                <p>{strings.phase3.changeVsPrevMonth}</p>
                <strong className="text-2xl">
                  {pctChange === null ? "—" : `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`}
                </strong>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-5">
          <CardHeader>
            <CardTitle>{strings.phase3.revenueTrend}</CardTitle>
          </CardHeader>
          <CardContent>
            <div dir="ltr">
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <BarChart data={revenue?.monthly ?? []}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(v: string) => strings.phase3.monthNames[parseInt(v.split("-")[1]) - 1]}
                  />
                  <YAxis />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_label, payload) => {
                          if (!payload?.length) return "";
                          return formatMonthLabel((payload[0] as { payload: { month: string } }).payload.month);
                        }}
                        formatter={(value) => [`${value} ${revCurrency}`, strings.phase3.monthlyRevenue]}
                      />
                    }
                  />
                  <Bar dataKey="revenue">
                    {(revenue?.monthly ?? []).map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={entry.month === selectedMonth ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.35)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.revenueByProduct}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(revenue?.products.length ?? 0) > 0 && (
              <div dir="ltr">
                <ChartContainer config={productConfig} className="h-40 w-full">
                  <BarChart layout="vertical" data={revenue?.products ?? []}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="productName" width={90} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${value} ${revCurrency}`, strings.phase3.monthlyRevenue]}
                        />
                      }
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
            <div className="space-y-3">
              {revenue?.products.map((item) => (
                <div key={item.productId} className="flex items-center justify-between rounded-md border p-4">
                  <span>{item.productName}</span>
                  <strong>{formatRevenue(item.revenue, (item.paymentsCount ?? 0) > 0)}</strong>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Expiring soon */}
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
              <span className={cn("font-bold tabular-nums", count > 0 ? "text-amber-600" : "text-muted-foreground")}>
                {count}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Overdue + Free slots */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.overdue}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.overdue.length ? (
              data.overdue.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md border p-3">
                  <Link href={`/subscriptions/${item.id}`} className="flex-1 min-w-0">
                    <strong className="block truncate">{item.customerName}</strong>
                    <small className="text-muted-foreground">{item.productName} · {item.expiryDate}</small>
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
              const barColor = freePercent > 50 ? "bg-green-500" : freePercent > 20 ? "bg-amber-500" : "bg-red-500";
              return (
                <Link
                  key={item.productId}
                  href="/inventory"
                  className="flex items-center gap-3 rounded-md bg-muted p-3 hover:bg-muted/70 transition-colors"
                >
                  <span className="flex-1 text-sm">{item.productName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
                      <div className={cn("h-full rounded-full", barColor)} style={{ width: `${freePercent}%` }} />
                    </div>
                    <span className="text-sm font-medium tabular-nums">{item.freeCount} / {total}</span>
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
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <Card key={n}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[1, 2].map((n) => (
          <Card key={n}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="h-56 w-full" /></CardContent></Card>
    </div>
  );
}
