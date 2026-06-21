import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Globe2, ImagePlus, Loader2, Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useDeleteProductImage,
  useGetWebsiteSettings,
  useUpdateProductMeta,
  useUpdateWebsiteSettings,
  useUploadProductImage,
  type ProductStoreMeta,
  type WebsiteSettings,
} from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const emptyForm: WebsiteSettings = {
  platformEnabled: true,
  enabled: false,
  slug: "",
  whatsapp: "",
  name: "",
  description: "",
  publicUrl: null,
  products: [],
};

function publicUrl(slug: string): string {
  return slug ? `${window.location.origin}/store/${slug}` : "";
}

const storeSlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeWhatsapp(value: string): string {
  return value.trim().replace(/[\s-]/g, "").replace(/^\+/, "");
}

function hasRequiredLiveInfo(form: Pick<WebsiteSettings, "slug" | "whatsapp">): boolean {
  return storeSlugRegex.test(form.slug.trim().toLowerCase()) && /^\d{8,15}$/.test(normalizeWhatsapp(form.whatsapp));
}

export default function WebsitePage() {
  const { data, isLoading } = useGetWebsiteSettings();
  const update = useUpdateWebsiteSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<WebsiteSettings>(emptyForm);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = () => {
    if (form.enabled && !hasRequiredLiveInfo(form)) {
      toast({ title: strings.website.missingLiveInfo, variant: "destructive" });
      return;
    }

    update.mutate({
      enabled: form.enabled,
      slug: form.slug,
      whatsapp: form.whatsapp,
      name: form.name,
      description: form.description,
    }, {
      onSuccess: (next) => {
        setForm(next);
        queryClient.invalidateQueries({ queryKey: ["website"] });
        toast({ title: strings.website.saved });
      },
      onError: (error) => {
        const message = error instanceof Error && error.message.includes("مستخدم")
          ? strings.website.duplicateSlug
          : strings.website.saveError;
        toast({ title: message, variant: "destructive" });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!form.platformEnabled) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {strings.website.lockedTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-7 text-muted-foreground">{strings.website.lockedDescription}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5" />
            {strings.website.title}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{strings.website.hint}</p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label>{form.enabled ? strings.website.live : strings.website.offline}</Label>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
          </div>

          <Field label={strings.website.slug} hint={strings.website.slugHint}>
            <Input
              value={form.slug}
              dir="ltr"
              onChange={(event) => setForm({ ...form, slug: event.target.value.trim().toLowerCase() })}
              placeholder="ahmad-subs"
            />
          </Field>

          {form.slug ? (
            <div className="rounded-md bg-muted px-3 py-2 text-sm" dir="ltr">
              {publicUrl(form.slug)}
            </div>
          ) : null}

          <Field label={strings.website.whatsapp} hint={strings.website.whatsappHint}>
            <Input
              value={form.whatsapp}
              dir="ltr"
              onChange={(event) => setForm({ ...form, whatsapp: event.target.value })}
              placeholder="96279XXXXXXX"
            />
          </Field>

          <Field label={strings.website.name}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>

          <Field label={strings.website.description}>
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={4}
            />
          </Field>

          <Button className="min-h-11" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {strings.website.save}
          </Button>
        </CardContent>
      </Card>

      {form.products.length > 0 && (
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{strings.website.productsSection}</h2>
            <p className="text-sm text-muted-foreground">{strings.website.productsSectionHint}</p>
          </div>
          {form.products.map((product) => (
            <ProductMetaEditor
              key={product.id}
              product={product}
              onSaved={(updated) =>
                setForm((f) => ({
                  ...f,
                  products: f.products.map((p) => (p.id === updated.id ? updated : p)),
                }))
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProductMetaEditor({
  product,
  onSaved,
}: {
  product: ProductStoreMeta;
  onSaved: (updated: ProductStoreMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(product.displayName === product.productName ? "" : product.displayName);
  const [description, setDescription] = useState(product.description);
  const [imageUrl, setImageUrl] = useState(product.imageUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMeta = useUpdateProductMeta();
  const uploadImage = useUploadProductImage();
  const deleteImage = useDeleteProductImage();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["website"] });

  const save = () => {
    updateMeta.mutate(
      { productId: product.id, name: displayName, description },
      {
        onSuccess: (updated) => {
          onSaved(updated);
          toast({ title: strings.website.productSaved });
          invalidate();
        },
        onError: () => toast({ title: strings.website.productSaveError, variant: "destructive" }),
      },
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: strings.website.productImageTooLarge, variant: "destructive" });
      e.target.value = "";
      return;
    }
    uploadImage.mutate(
      { productId: product.id, file },
      {
        onSuccess: (res) => {
          setImageUrl(res.imageUrl);
          onSaved({ ...product, imageUrl: res.imageUrl });
          toast({ title: strings.website.productImageUploaded });
          invalidate();
        },
        onError: () => toast({ title: strings.website.productImageUploadError, variant: "destructive" }),
      },
    );
    e.target.value = "";
  };

  const handleDeleteImage = () => {
    deleteImage.mutate(product.id, {
      onSuccess: () => {
        setImageUrl(null);
        onSaved({ ...product, imageUrl: null });
        toast({ title: strings.website.productImageDeleted });
        invalidate();
      },
      onError: () => toast({ title: strings.website.productImageDeleteError, variant: "destructive" }),
    });
  };

  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-start"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <span className="font-medium">{product.productName}</span>
          <span className="ms-2 text-xs text-muted-foreground">{product.service}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <CardContent className="grid gap-4 pt-0">
          {imageUrl ? (
            <div className="relative overflow-hidden rounded-md border">
              <img src={imageUrl} alt={product.productName} className="aspect-video w-full object-cover" />
              <Button
                size="sm"
                variant="destructive"
                className="absolute end-2 top-2"
                onClick={handleDeleteImage}
                disabled={deleteImage.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex aspect-video w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              onClick={() => fileRef.current?.click()}
              disabled={uploadImage.isPending}
            >
              {uploadImage.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  {strings.website.uploadImage}
                </>
              )}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />
          <p className="text-xs text-muted-foreground">{strings.website.productImageHint}</p>

          <Field label={strings.website.productDisplayName}>
            <Input
              value={displayName}
              placeholder={product.productName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>

          <Field label={strings.website.productDescription}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>

          <Button className="min-h-11" onClick={save} disabled={updateMeta.isPending}>
            {updateMeta.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {strings.website.saveProduct}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
