import { useState } from "react";
import { useRevealAccountPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { strings } from "@/lib/strings";

interface PasswordRevealProps {
  accountId: number;
}

export function PasswordReveal({ accountId }: PasswordRevealProps) {
  const [password, setPassword] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const revealMutation = useRevealAccountPassword();

  const handleToggle = () => {
    if (isVisible) {
      setIsVisible(false);
      return;
    }

    if (password) {
      setIsVisible(true);
      return;
    }

    revealMutation.mutate(
      { id: accountId },
      {
        onSuccess: (data) => {
          setPassword(data.password);
          setIsVisible(true);
        },
      }
    );
  };

  return (
    <div className="flex items-center gap-2" data-testid={`password-reveal-${accountId}`}>
      <div className="bg-muted px-3 py-1 rounded font-mono text-sm min-w-[120px] text-center" dir="ltr">
        {isVisible && password ? password : "••••••••"}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={revealMutation.isPending}
        className="h-8 text-xs"
        data-testid={`btn-toggle-password-${accountId}`}
      >
        {revealMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin me-1" />
        ) : isVisible ? (
          <EyeOff className="h-3 w-3 me-1" />
        ) : (
          <Eye className="h-3 w-3 me-1" />
        )}
        {isVisible ? strings.accounts.hide : strings.accounts.reveal}
      </Button>
    </div>
  );
}
