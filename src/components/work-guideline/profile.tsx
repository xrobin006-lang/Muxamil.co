"use client";

import { useState } from "react";
import {
  AlertTriangle, BadgeCheck, CalendarDays, KeyRound, Loader2, Mail, Save, ShieldAlert,
  ShieldCheck, User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { Separator } from "@/components/wg-ui/separator";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { navigate } from "@/components/work-guideline/router";
import { formatDate } from "@/components/work-guideline/ui-bits";
import { toast } from "sonner";

export function ProfileView() {
  const { user, refreshUser } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Name must be at least 2 characters.");
    setSavingName(true);
    try {
      await api("/api/profile", { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
      await refreshUser();
      toast.success("Profile updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return toast.error("New password must be 8+ characters with a letter and a number.");
    }
    setSavingPassword(true);
    try {
      await api("/api/profile/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed — signing you out for safety…");
      await refreshUser();
      navigate("/login");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">Profile &amp; Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage your Muxamil account details and Work Hub security.</p>
      </header>

      {user.isRestricted && (
        <Alert variant="destructive" className="rounded-2xl">
          <ShieldAlert className="h-4.5 w-4.5" />
          <AlertDescription>
            Your account is restricted. You can browse and track submissions, but cannot submit new gift cards. Contact
            support to resolve this.
          </AlertDescription>
        </Alert>
      )}

      {/* Account overview */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary font-display text-lg font-bold text-white" aria-hidden="true">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="font-display text-lg font-bold text-brand">{user.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {user.email}</p>
          </div>
        </div>
        <Separator className="my-5" />
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Member since</dt>
            <dd className="mt-1.5 text-sm font-medium">{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><UserIcon className="h-3.5 w-3.5" /> Role</dt>
            <dd className="mt-1.5 text-sm font-medium">{user.role === "ADMIN" ? "Administrator" : "Member"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><BadgeCheck className="h-3.5 w-3.5" /> Email status</dt>
            <dd className="mt-1.5 text-sm font-medium">{user.emailVerified ? "Active" : "Pending verification"}</dd>
          </div>
        </dl>
        {!user.emailVerified && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Email verification is not configured on this deployment, so accounts are activated directly. A verification
            email flow will be enabled once an email provider is set up.
          </p>
        )}
      </section>

      {/* Profile form */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <h2 className="font-display text-lg font-bold text-brand">Profile details</h2>
        <form onSubmit={saveName} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl"
              minLength={2} maxLength={80} required />
          </div>
          <Button type="submit" disabled={savingName} className="btn-gradient rounded-xl text-white">
            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save changes</>}
          </Button>
        </form>
      </section>

      {/* Password form */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand"><KeyRound className="h-5 w-5 text-primary" /> Change password</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changing your password signs you out of every session for your safety, including this one.
        </p>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-pw">Current password</Label>
            <Input id="current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              className="h-11 rounded-xl" autoComplete="current-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="h-11 rounded-xl" autoComplete="new-password" minLength={8} required />
            <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
          </div>
          <Button type="submit" disabled={savingPassword} className="btn-gradient rounded-xl text-white">
            {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
          </Button>
        </form>
      </section>

      {/* Security note */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Account security</p>
        <p className="mt-2">
          Muxamil staff will never ask for your Microsoft or Google account password, OTP codes, or recovery codes.
          Only your Muxamil account password is used to sign in to this platform.
        </p>
      </section>
    </div>
  );
}
