import { CircleDollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetRevenueReport } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
export default function RevenueReport() {
  const { data } = useGetRevenueReport(); const currency = data?.currency || strings.common.currency;
  return <div className="space-y-5"><h1 className="text-2xl font-bold">{strings.phase3.report}</h1><Card className="bg-primary text-primary-foreground"><CardContent className="flex items-center gap-4 p-6"><CircleDollarSign className="h-9 w-9" /><div><p>{strings.phase3.monthlyRevenue}</p><strong className="text-3xl">{data?.total || 0} {currency}</strong></div></CardContent></Card><Card><CardHeader><CardTitle>{strings.phase3.revenueByProduct}</CardTitle></CardHeader><CardContent className="space-y-3">{data?.products.map((item) => <div key={item.productId} className="flex items-center justify-between rounded-md border p-4"><span>{item.productName}<small className="block text-muted-foreground">{strings.phase3.paymentsCount}: {item.paymentsCount || 0}</small></span><strong>{item.revenue} {currency}</strong></div>)}</CardContent></Card></div>;
}
