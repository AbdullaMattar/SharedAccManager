import { useState } from "react";
import { CircleDollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { useGetRevenueReport } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const PRODUCT_COLORS = [
  "hsl(221 83% 53%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(280 65% 60%)",
  "hsl(0 72% 51%)",
  "hsl(199 89% 48%)",
];

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

export default function RevenueReport() {
  const last12 = getLast12Months();
  const [selectedMonth, setSelectedMonth] = useState(last12[0]);

  const { data } = useGetRevenueReport(selectedMonth);
  const currency = data?.currency || strings.common.currency;

  const formatRevenue = (revenue: number, hasPayments: boolean) =>
    revenue === 0 && hasPayments ? strings.phase3.refunded : `${revenue} ${currency}`;

  const currRev = data?.total ?? 0;
  const prevRev = data?.prevMonthRevenue ?? 0;
  const pctChange = prevRev !== 0 ? ((currRev - prevRev) / Math.abs(prevRev)) * 100 : null;

  const trendConfig = { revenue: { label: strings.phase3.monthlyRevenue, color: "hsl(var(--primary))" } };
  const productConfig = { revenue: { label: strings.phase3.revenueByProduct, color: "hsl(var(--primary))" } };

  return (
    <div className="space-y-5">
      {/* Header + month selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{strings.phase3.report}</h1>
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="flex items-center gap-4 p-6">
            <CircleDollarSign className="h-9 w-9" />
            <div>
              <p>{strings.phase3.monthlyRevenue}</p>
              <strong className="text-3xl">{formatRevenue(currRev, (data?.paymentsCount ?? 0) > 0)}</strong>
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

      {/* 12-month trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>{strings.phase3.revenueTrend}</CardTitle>
        </CardHeader>
        <CardContent>
          <div dir="ltr">
            <ChartContainer config={trendConfig} className="h-56 w-full">
              <BarChart data={data?.monthly ?? []}>
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
                      formatter={(value) => [`${value} ${currency}`, strings.phase3.monthlyRevenue]}
                    />
                  }
                />
                <Bar dataKey="revenue">
                  {(data?.monthly ?? []).map((entry) => (
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

      {/* Revenue by product */}
      <Card>
        <CardHeader>
          <CardTitle>{strings.phase3.revenueByProduct}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(data?.products.length ?? 0) > 0 && (
            <div dir="ltr">
              <ChartContainer config={productConfig} className="h-40 w-full">
                <BarChart
                  layout="vertical"
                  data={data?.products ?? []}
                  margin={{ left: 12, right: 12 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="productName" width={120} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [`${value} ${currency}`, strings.phase3.monthlyRevenue]}
                      />
                    }
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {(data?.products ?? []).map((entry, index) => (
                      <Cell key={entry.productId} fill={PRODUCT_COLORS[index % PRODUCT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          )}

          <div className="space-y-3">
            {data?.products.map((item) => (
              <div key={item.productId} className="flex items-center justify-between rounded-md border p-4">
                <span>{item.productName}</span>
                <strong>{formatRevenue(item.revenue, (item.paymentsCount ?? 0) > 0)}</strong>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
