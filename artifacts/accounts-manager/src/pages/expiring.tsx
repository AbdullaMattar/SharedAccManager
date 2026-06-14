import { Link, useSearch } from "wouter";
import { CalendarClock, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RenewSubscriptionDialog } from "@/components/renew-subscription-dialog";
import { useListExpiringSubscriptions } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function Expiring() {
  const search = useSearch();
  const days = Number(new URLSearchParams(search).get("days")) || undefined;

  const subtitle =
    days === 1
      ? strings.phase3.withinOneDay
      : days === 3
        ? strings.phase3.withinThreeDays
        : days === 7
          ? strings.phase3.withinSevenDays
          : null;

  const { data = [], isLoading } = useListExpiringSubscriptions(days);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{strings.phase3.expiringSoon}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center text-muted-foreground">
            <CalendarClock className="mb-3 h-10 w-10 opacity-30" />
            <p>{strings.phase3.noExpiringSoon}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-3 p-4">
                <Link href={`/subscriptions/${item.id}`} className="block">
                  <div className="flex justify-between gap-2">
                    <div>
                      <strong>{item.customerName}</strong>
                      <p className="text-sm text-muted-foreground">
                        {item.productName} · {item.accountLabel}
                      </p>
                    </div>
                    <span
                      className={
                        item.daysRemaining < 0
                          ? "text-sm text-destructive"
                          : "text-sm text-amber-600"
                      }
                    >
                      {strings.phase3.daysRemaining(item.daysRemaining)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    {strings.subscriptions.expiryDate}: {item.expiryDate}
                  </p>
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={whatsappUrl(
                        item.whatsapp || item.phone,
                        strings.phase3.whatsappReminder(
                          item.customerName,
                          item.productName,
                          item.expiryDate,
                        ),
                      )}
                    >
                      <MessageCircle className="me-2 h-4 w-4" />
                      {strings.phase3.openWhatsapp}
                    </a>
                  </Button>
                  <RenewSubscriptionDialog
                    id={item.id}
                    durationDays={item.defaultDurationDays}
                    price={item.price}
                    trigger={
                      <Button>
                        <RefreshCw className="me-2 h-4 w-4" />
                        {strings.phase3.renew}
                      </Button>
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function whatsappUrl(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}`;
}
