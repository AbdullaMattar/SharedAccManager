import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Edit2, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { AdminUser, useCreateUser, useListUsers, useResetUserPassword, useUpdateUser } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

type Form = Omit<AdminUser, "id"> & { password: string };
const blank: Form = { name: "", email: "", role: "staff", enabled: true, password: "" };
export default function Users() {
  const { data = [] } = useListUsers(); const create = useCreateUser(); const update = useUpdateUser(); const reset = useResetUserPassword(); const qc = useQueryClient(); const { toast } = useToast();
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<AdminUser>(); const [form, setForm] = useState(blank); const [resetUser, setResetUser] = useState<AdminUser>(); const [password, setPassword] = useState("");
  const edit = (user?: AdminUser) => { setEditing(user); setForm(user ? { ...user, password: "" } : blank); setOpen(true); };
  const saved = () => { qc.invalidateQueries(); setOpen(false); toast({ title: strings.phase3.userSaved }); };
  const save = () => editing
    ? update.mutate({ id: editing.id, data: { name: form.name, email: form.email, role: form.role, enabled: form.enabled } }, { onSuccess: saved })
    : create.mutate(form, { onSuccess: saved });
  return <div className="space-y-5"><div className="flex justify-between"><h1 className="text-2xl font-bold">{strings.phase3.users}</h1><Button onClick={() => edit()}><Plus className="me-2 h-4 w-4" />{strings.phase3.addUser}</Button></div>
    <div className="grid gap-3 md:grid-cols-2">{data.map((user) => <Card key={user.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><strong>{user.name}</strong><p className="text-sm text-muted-foreground">{user.email}</p><small>{user.role === "admin" ? strings.phase3.roleAdmin : strings.phase3.roleStaff} · {user.enabled ? strings.phase3.enabled : strings.phase3.disabled}</small></div><div><Button size="icon" variant="ghost" aria-label={strings.app.edit} onClick={() => edit(user)}><Edit2 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label={strings.phase3.resetPassword} onClick={() => setResetUser(user)}><KeyRound className="h-4 w-4" /></Button></div></CardContent></Card>)}</div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? strings.phase3.editUser : strings.phase3.addUser}</DialogTitle></DialogHeader><div className="grid gap-4"><Field label={strings.phase3.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label={strings.phase3.email}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>{!editing && <Field label={strings.auth.password}><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}<Field label={strings.phase3.role}><Select value={form.role} onValueChange={(role: AdminUser["role"]) => setForm({ ...form, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staff">{strings.phase3.roleStaff}</SelectItem><SelectItem value="admin">{strings.phase3.roleAdmin}</SelectItem></SelectContent></Select></Field><div className="flex items-center justify-between"><Label>{strings.phase3.enabled}</Label><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></div></div><DialogFooter><Button onClick={save}>{strings.phase3.save}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!resetUser} onOpenChange={() => setResetUser(undefined)}><DialogContent><DialogHeader><DialogTitle>{strings.phase3.resetPassword}</DialogTitle></DialogHeader><Field label={strings.phase3.newPassword}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field><DialogFooter><Button onClick={() => resetUser && reset.mutate({ id: resetUser.id, password }, { onSuccess: () => { setResetUser(undefined); setPassword(""); toast({ title: strings.phase3.passwordReset }); } })}>{strings.phase3.save}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
