import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsData, useGetSettings, useUpdateSettings } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const defaults: SettingsData = { reminderLeadDays: 3, reminderRecipient: "staff", graceDays: 3, businessName: "", currency: "" };
export default function Settings() {
  const { data } = useGetSettings();
  const [form, setForm] = useState(defaults);
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { if (data) setForm(data); }, [data]);
  const save = () => update.mutate(form, { onSuccess: () => { qc.invalidateQueries(); toast({ title: strings.phase3.settingsSaved }); } });
  return <Card className="mx-auto max-w-2xl"><CardHeader><CardTitle>{strings.phase3.settings}</CardTitle><p className="text-sm text-muted-foreground">{strings.phase3.settingsHint}</p></CardHeader><CardContent className="grid gap-5">
    <Field label={strings.phase3.businessName}><Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label={strings.phase3.currency}><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field><Field label={strings.phase3.reminderLeadDays}><Input type="number" min={0} value={form.reminderLeadDays} onChange={(e) => setForm({ ...form, reminderLeadDays: Number(e.target.value) })} /></Field></div>
    {/* graceDays and reminderRecipient hidden until implemented */}
    <Button className="min-h-11" onClick={save} disabled={update.isPending}>{strings.phase3.save}</Button>
  </CardContent></Card>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
