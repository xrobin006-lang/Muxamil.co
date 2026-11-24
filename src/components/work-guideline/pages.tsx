"use client";

import { useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { Compass, Headset, Loader2, Mail, MessageSquare, Send, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { navigate } from "@/components/work-guideline/router";
import { toast } from "sonner";

function PageShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">{title}</h1>
        <p className="mt-2 text-muted-foreground">{subtitle}</p>
      </header>
      <div className="space-y-6 rounded-2xl border border-border bg-white p-6 text-sm leading-relaxed text-muted-foreground sm:p-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-brand [&_h2]:mt-8 [&_h2]:first:mt-0 [&_strong]:text-foreground [&_a]:text-primary [&_a:hover]:text-primary/80">
        {children}
      </div>
    </div>
  );
}

export function PrivacyView() {
  return (
    <PageShell title="Privacy Policy" subtitle="How Muxamil Work Hub collects, uses, and protects your information.">
      <h2>Overview</h2>
      <p>
        This policy explains what information Muxamil Work Hub (&quot;we&quot;, &quot;the platform&quot;) collects when you use
        the platform, why we collect it, and the choices you have. By creating an account you accept this policy.
      </p>

      <h2>Information we collect</h2>
      <p>
        <strong>Account data:</strong> your name, email address, and a cryptographically hashed password (we never store
        plaintext passwords).
      </p>
      <p>
        <strong>Submission data:</strong> the gift card screenshot you upload, the redemption code when a program requires
        it, your chosen payout method and payout account identifier, and any notes you add. These are stored in private
        storage that is not exposed through public URLs.
      </p>
      <p>
        <strong>Operational data:</strong> server-generated timestamps, submission statuses and their history, and
        administrator audit records of review actions.
      </p>

      <h2>What we never collect</h2>
      <p>
        We never ask for and never store your Microsoft or Google account passwords, one-time-passcodes, recovery codes,
        session cookies, or any form of account access. Our forms reject and report attempts to submit such data.
      </p>

      <h2>How your data is used</h2>
      <p>
        Submission data is used solely to verify gift cards and issue payouts. Verification is performed by authorized
        administrators; sensitive codes and payout identifiers are masked in all list views and are never written to
        application logs.
      </p>

      <h2>Data sharing</h2>
      <p>
        We do not sell your personal data. Payout account details are used only to send your approved payment through the
        payment provider you selected. Aggregate, anonymized statistics may be used to improve the service.
      </p>

      <h2>Data retention &amp; your rights</h2>
      <p>
        Submissions and payment records are retained for dispute resolution and accounting. You may request deletion of
        your account and personal data by contacting{" "}
        <a href="mailto:support@muxamil.co">support@muxamil.co</a>, subject to legal retention duties.
      </p>

      <h2>Independent platform notice</h2>
      <p>
        Muxamil Work Hub is operated by Muxamil.co and is not affiliated with, endorsed by, or
        sponsored by Microsoft or Google. Trademarks belong to their respective owners.
      </p>
    </PageShell>
  );
}

export function TermsView() {
  const { settings } = useApp();
  return (
    <PageShell title="Terms of Service" subtitle="The rules that govern your use of Muxamil Work Hub.">
      <h2>1. The service</h2>
      <p>
        Muxamil Work Hub provides a verification and payout service for digital gift cards that you have legitimately earned
        or acquired. We are an independent platform operated by Muxamil.co, not affiliated with Microsoft or Google.
      </p>

      <h2>2. Eligibility &amp; accounts</h2>
      <p>
        You must provide accurate registration information and keep your credentials confidential. One person may hold
        one account. We may restrict accounts that violate these terms.
      </p>

      <h2>3. Legitimate submissions only</h2>
      <p>
        You may only submit gift cards redeemed through your own accounts, earned legitimately. Submitting fraudulent,
        stolen, duplicated, or otherwise invalid cards, or editing screenshots, results in rejection and possible
        permanent restriction. Fraudulent activity may be reported to the relevant reward program operator and
        authorities.
      </p>

      <h2>4. Verification &amp; payment</h2>
      <p>
        Every submission starts as &quot;Pending Verification&quot; with a {settings?.verification_window_hours ?? 24}-hour
        review target. This target is a service goal, not a guarantee; reaching the target time does not itself mean
        approval or payment. Payments are recorded manually with a transaction reference once they are actually sent.
        Payout values are quoted per gift card value and the method you select; processing may take additional time.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Do not attempt to access other users&apos; data, probe or overload the platform, submit automated requests, or
        misuse the contact system. Rate limits and audit logging apply to protect the service.
      </p>

      <h2>6. Liability</h2>
      <p>
        The platform is provided &quot;as is&quot;. We are not liable for reward points lost due to actions of third-party
        reward programs, nor for indirect damages. Our maximum aggregate liability is limited to the value of the
        submissions in dispute.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms; material changes will be announced on the platform. Continued use after changes means
        acceptance. Questions? <a href="mailto:support@muxamil.co">support@muxamil.co</a>.
      </p>
    </PageShell>
  );
}

export function ContactView() {
  const { settings, user } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 10) return toast.error("Message must be at least 10 characters.");
    setBusy(true);
    try {
      await api("/api/contact", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim() }),
      });
      setSent(true);
      setSubject("");
      setMessage("");
      toast.success("Message sent — our team will reply soon");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up mx-auto grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">Contact &amp; Support</h1>
          <p className="mt-2 text-muted-foreground">
            Questions about a submission, a payout, or getting started? We are here to help.
          </p>
        </div>
        <div className="space-y-4 rounded-2xl border border-border bg-white p-6">
          <div className="flex items-center gap-3.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-accent">
              <Mail className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-sm font-semibold">Email us</p>
              <a href={`mailto:${settings?.contact_email ?? "support@muxamil.co"}`} className="text-sm text-primary hover:text-primary/80">
                {settings?.contact_email ?? "support@muxamil.co"}
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-sky-200 bg-sky-50">
              <Headset className="h-5 w-5 text-sky-600" />
            </span>
            <div>
              <p className="text-sm font-semibold">Support hours</p>
              <p className="text-sm text-muted-foreground">{settings?.support_hours ?? "We reply within 24 hours, every day"}</p>
            </div>
          </div>
          <div className="flex items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-200 bg-emerald-50">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            </span>
            <div>
              <p className="text-sm font-semibold">Include your reference ID</p>
              <p className="text-sm text-muted-foreground">For submission questions, include your MXC reference for the fastest help.</p>
            </div>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground/70">
          Support will never ask for your rewards-program passwords or OTP codes. If anyone claiming to be from
          Muxamil will never ask for those details.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-white p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand">
          <MessageSquare className="h-5 w-5 text-primary" /> Send us a message
        </h2>
        {sent && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Your message was received — our team typically replies within 24 hours.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="c-name">Your name</Label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl pl-10"
                required minLength={2} maxLength={80} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl pl-10"
                required />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="c-subject">Subject <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11 rounded-xl"
            maxLength={140} placeholder="e.g. Question about my payout" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="c-message">Message</Label>
          <Textarea id="c-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="rounded-xl"
            required minLength={10} maxLength={3000} placeholder="How can we help?" />
        </div>
        <Button type="submit" disabled={busy} className="btn-gradient h-11 w-full rounded-xl text-white sm:w-auto sm:px-8">
          {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><Send className="mr-2 h-4.5 w-4.5" /> Send message</>}
        </Button>
      </form>
    </div>
  );
}

export function NotFoundView() {
  return (
    <div className="animate-fade-up mx-auto max-w-lg py-12 text-center">
      <div className="relative mx-auto h-28 w-28">
        <Compass className="h-28 w-28 text-muted-foreground/30" aria-hidden="true" />
        <span className="absolute inset-0 grid place-items-center font-display text-4xl font-bold text-gradient">404</span>
      </div>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-brand">Page not found</h1>
      <p className="mt-3 text-muted-foreground">
        The page you are looking for doesn&apos;t exist or may have moved. Let&apos;s get you back on track.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button className="btn-gradient rounded-xl px-6 text-white" onClick={() => navigate("/")}>Back to home</Button>
        <Button variant="outline" className="rounded-xl px-6" onClick={() => navigate("/programs")}>Browse Work &amp; Tutorials</Button>
      </div>
      <p className="mt-8 text-xs text-muted-foreground/60">
        Lost in a submission? Check <Link href="#/submissions" className="underline hover:text-foreground">My Submissions</Link> or{" "}
        <Link href="#/contact" className="underline hover:text-foreground">contact support</Link>.
      </p>
    </div>
  );
}
