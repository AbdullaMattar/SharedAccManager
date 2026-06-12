import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Mode = "login" | "register";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) return null;

  const isRegister = mode === "register";
  const isPending = loginMutation.isPending || registerMutation.isPending;

  const onAuthSuccess = (data: unknown, successTitle: string) => {
    queryClient.setQueryData(["/api/auth/me"], data);
    queryClient.invalidateQueries();
    toast({ title: successTitle });
    // Redirection is handled by the useEffect above when isAuthenticated changes
  };

  const onAuthError = (err: any, fallback: string) => {
    const msg = err?.response?.data?.error || fallback;
    setError(msg);
    toast({ title: msg, variant: "destructive" });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isRegister) {
      loginMutation.mutate(
        { data: { email, password } },
        {
          onSuccess: (data) => onAuthSuccess(data, strings.auth.loginSuccess),
          onError: (err: any) => onAuthError(err, strings.auth.loginError),
        }
      );
      return;
    }

    if (password.length < 8) {
      setError(strings.auth.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(strings.auth.passwordMismatch);
      return;
    }
    registerMutation.mutate(
      { data: { name, email, password } },
      {
        onSuccess: (data) => onAuthSuccess(data, strings.auth.registerSuccess),
        onError: (err: any) => onAuthError(err, strings.auth.registerError),
      }
    );
  };

  const fillDemo = () => {
    setMode("login");
    setEmail("admin@example.com");
    setPassword("admin123");
    setError(null);
  };

  const switchMode = () => {
    setMode(isRegister ? "login" : "register");
    setError(null);
    setConfirmPassword("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" data-testid="card-login">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-bold">{strings.app.title}</CardTitle>
          <CardDescription>
            {isRegister ? strings.auth.registerTitle : strings.app.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{strings.app.error}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="name">{strings.auth.name}</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={strings.auth.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  data-testid="input-name"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{strings.auth.email}</Label>
              <Input
                id="email"
                type="email"
                placeholder={strings.auth.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="text-start"
                autoComplete="email"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{strings.auth.password}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={strings.auth.passwordPlaceholder}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  dir="ltr"
                  className="text-start pe-10"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute end-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? strings.accounts.hide : strings.accounts.reveal}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{strings.auth.confirmPassword}</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={strings.auth.confirmPasswordPlaceholder}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  dir="ltr"
                  className="text-start"
                  autoComplete="new-password"
                  data-testid="input-confirm-password"
                />
              </div>
            )}
            <div className="space-y-3">
              <Button
                type="submit"
                className="w-full"
                disabled={isPending}
                data-testid="button-submit-login"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isRegister ? (
                  strings.auth.register
                ) : (
                  strings.auth.login
                )}
              </Button>
              {!isRegister && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={fillDemo}
                  data-testid="button-demo-login"
                >
                  استخدم حساب تجريبي
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={switchMode}
                data-testid="button-switch-mode"
              >
                {isRegister ? strings.auth.switchToLogin : strings.auth.switchToRegister}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
