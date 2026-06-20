import { useEffect } from "react";
import { MessageCircle, Package, Loader2 } from "lucide-react";
import { useGetPublicStore, type PublicStoreProduct } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function whatsappUrl(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function ProductCard({
  product,
  whatsappNumber,
  currency,
}: {
  product: PublicStoreProduct;
  whatsappNumber: string;
  currency: string;
}) {
  const price = `${product.price} ${currency}`;
  const message = product.available
    ? strings.store.orderMessage(product.name, price, product.durationDays)
    : strings.store.availabilityMessage(product.name);

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg leading-7">{product.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{product.service}</p>
          </div>
          <Badge variant={product.available ? "default" : "secondary"}>
            {product.available ? strings.store.available : strings.store.unavailable}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <span>{price}</span>
          <span>{strings.store.durationDays(product.durationDays)}</span>
        </div>
        <Button asChild className="w-full min-h-11" variant={product.available ? "default" : "outline"}>
          <a href={whatsappUrl(whatsappNumber, message)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="me-2 h-4 w-4" />
            {product.available ? strings.store.orderNow : strings.store.askAvailability}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function StorePage({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useGetPublicStore(slug);

  useEffect(() => {
    if (!data) return;
    document.title = data.name;
    const description = data.description || strings.app.description;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [data]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background px-4 py-10" dir="rtl">
        <div className="mx-auto flex max-w-5xl items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="me-2 h-5 w-5 animate-spin" />
          {strings.store.loading}
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-background px-4 py-10" dir="rtl">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-lg border bg-card p-8 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-bold">{strings.store.notFound}</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-normal">{data.name}</h1>
          {data.description ? (
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{data.description}</p>
          ) : null}
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              whatsappNumber={data.whatsappNumber}
              currency={data.currency}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
