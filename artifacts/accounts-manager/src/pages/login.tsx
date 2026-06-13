import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldAlert,
  ReceiptText,
  CalendarClock,
  CircleDollarSign,
  Star,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import logoUrl from "@/assets/logo.png";

type Mode = "login" | "register";

/**
 * Brand palette (Tasheel):
 *   Oxford Navy   #0E2C51 / #00355E
 *   Pearl Aqua    #6ACDBD
 *   Papaya Whip   #FFF0D6 / #FFEFD6
 *
 * The form controls (Button/Input/Card) read their colours from CSS custom
 * properties, so we override those tokens on the login root only. This keeps
 * the auth screen fully on-brand without changing the theme of the rest of
 * the app.
 */
const loginTheme = {
  "--background": "38 100% 92%",
  "--foreground": "213 64% 16%",
  "--card": "0 0% 100%",
  "--card-foreground": "213 64% 16%",
  "--card-border": "38 46% 84%",
  "--border": "38 46% 84%",
  "--input": "38 44% 80%",
  "--primary": "206 100% 18%",
  "--primary-foreground": "38 100% 96%",
  "--primary-border": "hsl(206 100% 13%)",
  "--ring": "172 48% 46%",
  "--muted": "38 52% 90%",
  "--muted-foreground": "213 22% 42%",
  "--secondary": "38 56% 90%",
  "--secondary-foreground": "213 64% 16%",
  "--accent": "172 48% 92%",
  "--accent-foreground": "213 64% 16%",
  "--radius": "0.85rem",
} as React.CSSProperties;

/** The wave mark from the Tasheel logo, recreated as a stroked path. */
function BrandWave({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d="M4 24 C 20 24, 24 8, 42 9 C 60 10, 63 25, 82 24 C 98 23, 102 12, 116 13"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const features = [
  {
    icon: ReceiptText,
    title: strings.login.featureSubscriptions,
    desc: strings.login.featureSubscriptionsDesc,
  },
  {
    icon: CalendarClock,
    title: strings.login.featureExpiry,
    desc: strings.login.featureExpiryDesc,
  },
  {
    icon: CircleDollarSign,
    title: strings.login.featurePayments,
    desc: strings.login.featurePaymentsDesc,
  },
];

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
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
    const msg = err?.data?.error || err?.response?.data?.error || fallback;
    setError(msg);
    setErrorStatus(typeof err?.status === "number" ? err.status : null);
    toast({ title: msg, variant: "destructive" });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorStatus(null);

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
      { data: { name, businessName, email, password } as never },
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
    <div
      className="relative min-h-screen w-full lg:grid lg:grid-cols-[1.05fr_1fr]"
      style={loginTheme}
      data-testid="page-login"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Brand panel (desktop only) — deep Oxford Navy with the teal wave    */}
      {/* ------------------------------------------------------------------ */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-start lg:flex lg:min-h-screen xl:p-14"
        style={{ background: "linear-gradient(155deg, #0E2C51 0%, #00355E 100%)" }}
      >
        {/* atmospheric glows + oversized wave watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -end-24 h-72 w-72 rounded-full bg-[#6ACDBD]/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 start-0 h-72 w-72 rounded-full bg-[#6ACDBD]/10 blur-3xl"
        />
        <BrandWave
          className="pointer-events-none absolute inset-x-0 top-[38%] h-40 w-[150%] -translate-x-[14%] text-[#6ACDBD]/[0.07]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,240,214,0.06) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        {/* wordmark */}
        <div className="relative z-10 tasheel-rise">
          <BrandWave className="h-7 w-20 text-[#6ACDBD]" />
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[#FFF0D6] xl:text-5xl">
            {strings.login.brandNameLead}{" "}
            <span className="text-[#6ACDBD]">{strings.login.brandNameTrail}</span>
          </h1>
        </div>

        {/* value proposition + features */}
        <div className="relative z-10 max-w-md space-y-9">
          <div className="space-y-3 tasheel-rise" style={{ animationDelay: "90ms" }}>
            <p className="text-xl font-bold leading-snug text-[#FFF0D6]">
              {strings.login.tagline}
            </p>
            <p className="text-sm leading-relaxed text-[#FFF0D6]/60">
              {strings.login.intro}
            </p>
          </div>

          <ul className="space-y-5">
            {features.map((f, i) => (
              <li
                key={f.title}
                className="flex items-start gap-4 tasheel-rise"
                style={{ animationDelay: `${170 + i * 90}ms` }}
              >
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#6ACDBD]/15 text-[#6ACDBD] ring-1 ring-inset ring-[#6ACDBD]/25">
                  <f.icon className="h-5 w-5" />
                </span>
                <div className="space-y-0.5">
                  <p className="font-bold text-[#FFF0D6]">{f.title}</p>
                  <p className="text-sm text-[#FFF0D6]/55">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* social proof */}
        <div
          className="relative z-10 flex items-center gap-3 tasheel-rise"
          style={{ animationDelay: "460ms" }}
        >
          <div className="flex gap-0.5 text-[#6ACDBD]">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="h-4 w-4 fill-current" />
            ))}
          </div>
          <span className="text-sm font-medium text-[#FFF0D6]/75">
            {strings.login.socialProof}
          </span>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Form panel                                                          */}
      {/* ------------------------------------------------------------------ */}
      <main
        className="flex min-h-screen items-center justify-center p-5 sm:p-8 lg:min-h-screen"
        style={{ background: "linear-gradient(180deg, #FFF7E8 0%, #FFF0D6 100%)" }}
      >
        <div className="w-full max-w-md tasheel-rise">
          <div
            className="rounded-3xl border border-card-border bg-card p-7 shadow-[0_20px_60px_-25px_rgba(14,44,81,0.35)] sm:p-9"
            data-testid="card-login"
          >
            {/* header: real logo + heading */}
            <div className="mb-7 flex flex-col items-center text-center">
              <div className="inline-flex overflow-hidden rounded-2xl shadow-sm ring-1 ring-[#0E2C51]/10">
                <img
                  src={logoUrl}
                  alt={strings.login.brandName}
                  className="h-16 w-16 object-cover"
                  width={64}
                  height={64}
                />
              </div>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-foreground">
                {isRegister ? strings.auth.registerTitle : strings.auth.login}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {isRegister ? strings.login.registerLead : strings.login.formLead}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && errorStatus === 403 ? (
                <Alert className="border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>{strings.auth.suspendedTitle}</AlertTitle>
                  <AlertDescription>
                    <span className="block">{error}</span>
                    <a
                      href={strings.auth.suspendedContactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block font-semibold underline underline-offset-4"
                    >
                      {strings.auth.suspendedContactLabel}
                    </a>
                  </AlertDescription>
                </Alert>
              ) : error ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{strings.app.error}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
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
              {isRegister && (
                <div className="space-y-2">
                  <Label htmlFor="business-name">اسم النشاط</Label>
                  <Input
                    id="business-name"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                    data-testid="input-business-name"
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
              <div className="space-y-3 pt-1">
                <Button
                  type="submit"
                  className="min-h-11 w-full text-base font-bold"
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
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={switchMode}
                  data-testid="button-switch-mode"
                >
                  {isRegister ? strings.auth.switchToLogin : strings.auth.switchToRegister}
                </Button>
              </div>
            </form>

            {/* compact feature line — shown only where the brand panel is hidden */}
            <div className="mt-6 border-t border-card-border pt-4 lg:hidden">
              <p className="text-center text-xs tracking-wide text-muted-foreground">
                {strings.login.featureSubscriptions}
                <span className="mx-2 text-[#6ACDBD]">•</span>
                {strings.login.featureExpiry}
                <span className="mx-2 text-[#6ACDBD]">•</span>
                {strings.login.featurePayments}
              </p>
            </div>
          </div>

          <div className="mt-5 text-center">
            <Link
              href="/about"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {strings.about.poweredBy}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
