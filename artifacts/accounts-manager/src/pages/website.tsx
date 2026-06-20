import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useGetWebsiteSettings, useUpdateWebsiteSettings, type WebsiteSettings } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const emptyForm: WebsiteSettings = {
  platformEnabled: true,
  enabled: false,
  slug: "",
  whatsapp: "",
  name: "",
  description: "",
  publicUrl: null,
};

function publicUrl(slug: string): string {
  return slug ? `${window.location.origin}/store/${slug}` : "";
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
