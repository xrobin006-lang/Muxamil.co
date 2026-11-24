"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, LogIn, Mail, User, UserPlus } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { useApp } from "@/components/work-guideline/provider";
import { navigate, useRoute } from "@/components/work-guideline/router";
import { api } from "@/lib/wg/client";
import { Link } from "@/components/work-guideline/router";
import { toast } from "sonner";

function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const { platform } = useApp();
  return (
    <div className="animate-fade-up">
      <div className="bg-app-glow relative overflow-hidden rounded-3xl border border-border/60 px-4 py-10 sm:px-8 sm:py-14">
        <div className="bg-grid-fade absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-border bg-white p-7 shadow-sm sm:p-8">
            <div className="flex flex-col items-center text-center">
              {platform.logoUrl ? (
                <img src={platform.logoUrl} alt={`${platform.name} logo`} className="h-16 w-16 rounded-2xl object-contain" />
              ) : (
                <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-2xl bg-primary text-3xl font-black text-white shadow-sm">M</span>
              )}
              <p className="mt-2 text-sm font-bold tracking-tight text-brand">{platform.name}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Work Hub</p>
              <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-brand">{title}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={label.toLowerCase().replace(/\s+/g, "-")}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, placeholder, autoComplete }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-11 rounded-xl pr-11"
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function LoginView() {
  const { refreshUser } = useApp();
  const { query } = useRoute();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ user: { role: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await refreshUser();
      toast.success("Welcome back!");
      const next = query.get("next");
      navigate(next && next.startsWith("/") ? next : data.user.role === "ADMIN" ? "/admin" : "/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back to Muxamil — continue where you left off.">
      <form onSubmit={submit} className="space-y-5">
        {error && (
          <Alert variant="destructive" className="rounded-xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Email">
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email" className="h-11 rounded-xl pl-10" required />
          </div>
        </Field>
        <Field label="Password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <div className="flex justify-end">
          <Link href="#/forgot-password" className="text-xs font-semibold text-primary hover:text-primary/80">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" disabled={busy} className="btn-gradient h-11 w-full rounded-xl text-white">
          {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><LogIn className="mr-2 h-4.5 w-4.5" /> Sign in</>}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New to Muxamil?{" "}
          <Link href="#/signup" className="font-semibold text-primary hover:text-primary/80">Create a free account</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function SignupView() {
  const { refreshUser } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must be at least 8 characters and include a letter and a number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
      await refreshUser();
      toast.success("Account created — welcome to Muxamil Work Hub!");
      navigate("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Use your Muxamil account to access work, tutorials, submissions and payouts.">
      <form onSubmit={submit} className="space-y-5">
        {error && (
          <Alert variant="destructive" className="rounded-xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Full name">
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="full-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              autoComplete="name" className="h-11 rounded-xl pl-10" required minLength={2} />
          </div>
        </Field>
        <Field label="Email">
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email" className="h-11 rounded-xl pl-10" required />
          </div>
        </Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number.">
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <Button type="submit" disabled={busy} className="btn-gradient h-11 w-full rounded-xl text-white">
          {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><UserPlus className="mr-2 h-4.5 w-4.5" /> Create account</>}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="#/login" className="font-semibold text-primary hover:text-primary/80">Sign in</Link>
        </p>
        <p className="text-center text-xs leading-relaxed text-muted-foreground/70">
          By creating an account you agree to our{" "}
          <Link href="#/terms" className="underline hover:text-foreground">Terms of Service</Link> and{" "}
          <Link href="#/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}

function ResetForm({ initialEmail, initialCode, notice }: { initialEmail: string; initialCode?: string; notice?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(initialCode ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must be at least 8 characters and include a letter and a number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), token: code.trim(), password }),
      });
      toast.success("Password updated — sign in with your new password.");
      navigate("/login");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {notice && (
        <Alert className="rounded-xl border-primary/25 bg-accent text-accent-foreground [&>svg]:text-primary">
          <KeyRound className="h-4 w-4" />
          <AlertDescription className="text-accent-foreground/90">{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="rounded-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field label="Email">
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            autoComplete="email" className="h-11 rounded-xl pl-10" required />
        </div>
      </Field>
      <Field label="Reset code" hint="The one-time code from your password reset request.">
        <Input id="reset-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="00000000"
          className="h-11 rounded-xl font-mono tracking-[0.2em]" required inputMode="numeric" autoComplete="one-time-code" />
      </Field>
      <Field label="New password" hint="At least 8 characters, with a letter and a number.">
        <PasswordInput id="reset-new-password" value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <PasswordInput id="reset-confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
      <Button type="submit" disabled={busy} className="btn-gradient h-11 w-full rounded-xl text-white">
        {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><KeyRound className="mr-2 h-4.5 w-4.5" /> Set new password</>}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it? <Link href="#/login" className="font-semibold text-primary hover:text-primary/80">Back to sign in</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ mode: string; resetCode?: string; message: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api<{ mode: string; resetCode?: string; message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setResult(data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your account email and we will help you recover access.">
      {!result ? (
        <form onSubmit={submit} className="space-y-5">
          <Field label="Email">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="h-11 rounded-xl pl-10" required />
            </div>
          </Field>
          <Button type="submit" disabled={busy} className="btn-gradient h-11 w-full rounded-xl text-white">
            {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <>Request reset code</>}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Remembered it? <Link href="#/login" className="font-semibold text-primary hover:text-primary/80">Back to sign in</Link>
          </p>
          <p className="text-center text-xs leading-relaxed text-muted-foreground/70">
            We never ask for your rewards-program passwords — only your Muxamil account password.
          </p>
        </form>
      ) : result.resetCode ? (
        <ResetForm initialEmail={email.trim()} initialCode={result.resetCode} notice={result.message} />
      ) : (
        <div className="space-y-5">
          <Alert className="rounded-xl border-primary/25 bg-accent text-accent-foreground [&>svg]:text-primary">
            <KeyRound className="h-4 w-4" />
            <AlertDescription className="text-accent-foreground/90">{result.message}</AlertDescription>
          </Alert>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="#/login" className="font-semibold text-primary hover:text-primary/80">Back to sign in</Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordView() {
  const { query } = useRoute();
  return (
    <AuthLayout title="Choose a new password" subtitle="Enter your email and the one-time reset code you received.">
      <ResetForm initialEmail={query.get("email") ?? ""} />
    </AuthLayout>
  );
}
