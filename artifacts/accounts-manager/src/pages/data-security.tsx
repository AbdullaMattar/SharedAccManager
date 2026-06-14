import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { downloadBackup } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function DataSecurity() {
  const s = strings.dataSecurity;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = passphrase.length < 8;
  const mismatch = confirm.length > 0 && passphrase !== confirm;
  const canSubmit = !tooShort && passphrase === confirm && !busy;

  const handleDownload = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await downloadBackup(passphrase);
      toast({ title: s.success });
      setOpen(false);
      setPassphrase("");
      setConfirm("");
    } catch {
      toast({ title: s.error, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{s.title}</h1>
        <p className="text-muted-foreground mt-1">{s.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            {s.downloadButton}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{s.warning}</p>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="btn-open-backup">
                <DatabaseBackup className="h-4 w-4 me-2" />
                {s.downloadButton}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{s.modalTitle}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{s.warning}</p>
                <div className="space-y-2">
                  <Label htmlFor="bk-pass">{s.passphraseLabel}</Label>
                  <Input id="bk-pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} data-testid="input-passphrase" />
                  {passphrase.length > 0 && tooShort && <p className="text-xs text-destructive">{s.tooShort}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bk-confirm">{s.confirmLabel}</Label>
                  <Input id="bk-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-confirm" />
                  {mismatch && <p className="text-xs text-destructive">{s.mismatch}</p>}
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleDownload} disabled={!canSubmit} data-testid="btn-download-backup">
                  {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <DatabaseBackup className="h-4 w-4 me-2" />}
                  {busy ? s.generating : s.downloadButton}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
