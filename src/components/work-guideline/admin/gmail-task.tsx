"use client";

// Admin — Gmail Task Management (one integrated section of the Operations
// Center, not a separate administrative surface).
//
// Configures EVERYTHING the member-facing "Today's Gmail Task" notice shows
// and every rule the submission flow enforces — without touching source code:
//   • Task content      — title, description, instructions, eligibility
//                         requirements, processing estimate, extra notice.
//   • Rate & quantities — payout rate + currency + per-submission min/max
//                         (written to the gmail-account CardRate — the same
//                         single source of truth the Card Rates section
//                         edits) and the overall task target.
//   • Daily limit       — the dedicated "Daily Gmail Submission Limit"
//                         (default 10) + its reset timezone.
//   • Schedule          — start / submission deadline / end, display
//                         timezone, live countdown toggle and the
//                         stop-after-deadline policy.
//   • Status            — Active / Paused / Closed (gates new submissions
//                         server-side; existing records keep their pipeline).
//   • Gmail Checker     — the external checker URL opened by the wizard.
//
// The form always loads the CURRENT backend values, keeps a snapshot for the
// unsaved-changes indicator (nothing is silently lost), validates client-side
// for instant feedback and relies on the server-side zod schema (including
// cross-field rules) as the authority.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock, ExternalLink, Gauge, Info, Loader2, Mail, Megaphone, RotateCcw,
  Save, ShieldCheck, Target, Timer,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Separator } from "@/components/wg-ui/separator";
import { Checkbox } from "@/components/wg-ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { api } from "@/lib/wg/client";
import { LoadingBlock, ErrorState, formatDateTime } from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { STAGGER } from "@/lib/wg/motion";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";
import { utcToWallTime, wallTimeToUtcMs } from "@/lib/wg/tz";

/** Curated IANA timezones offered for the task display + daily reset settings. */
const TIMEZONE_OPTIONS = [
  "UTC",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

/** Current UTC offset of a timezone, e.g. "UTC+05:00" (best-effort). */
function tzCurrentOffset(tz: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const diffMin = Math.round((asUTC - now.getTime()) / 60000);
    const sign = diffMin >= 0 ? "+" : "−";
    const abs = Math.abs(diffMin);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

/** GET/PUT /api/admin/gmail-task payload. */
interface GmailTaskAdminPayload {
  task: {
    title: string;
    description: string;
    instructions: string;
    processingEstimate: string;
    extraNotice: string;
    target: string;
    startsAt: string;
    deadlineAt: string;
    endsAt: string;
    timezone: string;
    status: "active" | "paused" | "closed";
    countdownEnabled: boolean;
    stopAfterDeadline: boolean;
    lastUpdated: string | null;
  };
  rate: {
    available: boolean;
    cardName: string;
    rate: number | null;
    currency: string;
    minQuantity: number | null;
    maxQuantity: number | null;
    isActive: boolean;
  };
  checkerUrl: string;
  dailyLimit: string;
  dailyResetTimezone: string;
  requirements: string[];
  currencies: { code: string; name: string; symbol: string }[];
  defaultCheckerUrl: string;
  serverNow: string;
}

/** The editable form (strings everywhere; converted on save). */
interface TaskForm {
  title: string;
  description: string;
  instructions: string;
  processingEstimate: string;
  extraNotice: string;
  target: string;
  startsAt: string; // datetime-local WALL time interpreted in the display timezone
  deadlineAt: string;
  endsAt: string;
  timezone: string;
  status: "active" | "paused" | "closed";
  countdownEnabled: boolean;
  stopAfterDeadline: boolean;
  rate: string;
  currency: string;
  minQuantity: string;
  maxQuantity: string;
  checkerUrl: string;
  dailyLimit: string;
  dailyResetTimezone: string;
  requirements: string;
}

function payloadToForm(p: GmailTaskAdminPayload): TaskForm {
  const tz = p.task.timezone;
  const wall = (iso: string) => {
    if (!iso) return "";
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? utcToWallTime(ms, tz) : "";
  };
  return {
    title: p.task.title,
    description: p.task.description,
    instructions: p.task.instructions,
    processingEstimate: p.task.processingEstimate,
    extraNotice: p.task.extraNotice,
    target: p.task.target,
    startsAt: wall(p.task.startsAt),
    deadlineAt: wall(p.task.deadlineAt),
    endsAt: wall(p.task.endsAt),
    timezone: tz,
    status: p.task.status,
    countdownEnabled: p.task.countdownEnabled,
    stopAfterDeadline: p.task.stopAfterDeadline,
    rate: p.rate.rate != null ? String(p.rate.rate) : "",
    currency: p.rate.currency,
    minQuantity: p.rate.minQuantity != null ? String(p.rate.minQuantity) : "",
    maxQuantity: p.rate.maxQuantity != null ? String(p.rate.maxQuantity) : "",
    checkerUrl: p.checkerUrl,
    dailyLimit: p.dailyLimit,
    dailyResetTimezone: p.dailyResetTimezone,
    requirements: p.requirements.join("\n"),
  };
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active", hint: "Submissions are accepted." },
  { value: "paused", label: "Paused", hint: "Temporarily blocked — members see a clear paused notice." },
  { value: "closed", label: "Closed", hint: "No new submissions; existing records keep their review pipeline." },
] as const;

export function AdminGmailTask() {
  const [payload, setPayload] = useState<GmailTaskAdminPayload | null>(null);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<GmailTaskAdminPayload>("/api/admin/gmail-task");
      const next = payloadToForm(data);
      setPayload(data);
      setForm(next);
      setSavedSnapshot(JSON.stringify(next));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => Boolean(form && JSON.stringify(form) !== savedSnapshot),
    [form, savedSnapshot],
  );

  // Guard against accidental loss of unsaved edits (refresh / tab close).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!form || !payload) return <LoadingBlock label="Loading Gmail task configuration…" />;

  const set = (key: keyof TaskForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const setField = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const reset = () => {
    setForm(JSON.parse(savedSnapshot) as TaskForm);
    toast.info("Unsaved edits discarded — the saved configuration is restored.");
  };

  /** Wall-time (in the form's display timezone) → UTC ISO instant ("" passthrough). */
  const toIso = (wall: string): string => {
    if (!wall.trim()) return "";
    const ms = wallTimeToUtcMs(wall, form.timezone);
    return ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : "";
  };

  const validate = (): string | null => {
    if (form.rate.trim() === "" || !Number.isFinite(Number(form.rate)) || Number(form.rate) <= 0) {
      return "Enter the payout rate per eligible entry (a positive number).";
    }
    if (!/^[1-9][0-9]{0,4}$/.test(form.dailyLimit.trim())) {
      return "Daily Gmail submission limit must be a positive whole number (1–99999).";
    }
    if (form.target.trim() !== "" && !/^[0-9]{1,7}$/.test(form.target.trim())) {
      return "Task target must be a whole number, or empty to hide it from the notice.";
    }
    const min = form.minQuantity.trim() === "" ? null : Number(form.minQuantity);
    const max = form.maxQuantity.trim() === "" ? null : Number(form.maxQuantity);
    if (min != null && (!Number.isInteger(min) || min < 1)) return "Minimum per submission must be a positive whole number, or empty.";
    if (max != null && (!Number.isInteger(max) || max < 1)) return "Maximum per submission must be a positive whole number, or empty.";
    if (min != null && max != null && min > max) return "Minimum per submission cannot exceed the maximum.";
    if (form.checkerUrl.trim() !== "" && !/^https?:\/\/[^\s]+$/.test(form.checkerUrl.trim())) {
      return "The Gmail Checker URL must start with http:// or https:// — or stay empty to use the built-in default.";
    }
    const start = form.startsAt ? wallTimeToUtcMs(form.startsAt, form.timezone) : null;
    const deadline = form.deadlineAt ? wallTimeToUtcMs(form.deadlineAt, form.timezone) : null;
    const end = form.endsAt ? wallTimeToUtcMs(form.endsAt, form.timezone) : null;
    if (form.startsAt && start == null) return "Enter a valid task start date and time.";
    if (form.deadlineAt && deadline == null) return "Enter a valid submission deadline date and time.";
    if (form.endsAt && end == null) return "Enter a valid task end date and time.";
    if (start != null && end != null && end <= start) return "Task end must be after the task start.";
    if (start != null && deadline != null && deadline < start) return "The submission deadline cannot be before the task start.";
    if (end != null && deadline != null && deadline > end) return "The submission deadline cannot be after the task end.";
    const reqLines = form.requirements.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (reqLines.length > 12) return "Keep the eligibility requirements to at most 12 lines.";
    return null;
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const problem = validate();
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const data = await api<GmailTaskAdminPayload>("/api/admin/gmail-task", {
        method: "PUT",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          instructions: form.instructions,
          processingEstimate: form.processingEstimate,
          extraNotice: form.extraNotice,
          target: form.target.trim(),
          startsAt: toIso(form.startsAt),
          deadlineAt: toIso(form.deadlineAt),
          endsAt: toIso(form.endsAt),
          timezone: form.timezone,
          status: form.status,
          countdownEnabled: form.countdownEnabled,
          stopAfterDeadline: form.stopAfterDeadline,
          rate: Number(form.rate),
          currency: form.currency,
          minQuantity: form.minQuantity.trim() === "" ? null : Number(form.minQuantity),
          maxQuantity: form.maxQuantity.trim() === "" ? null : Number(form.maxQuantity),
          checkerUrl: form.checkerUrl.trim(),
          dailyLimit: form.dailyLimit.trim(),
          dailyResetTimezone: form.dailyResetTimezone,
          requirements: form.requirements.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        }),
      });
      const next = payloadToForm(data);
      setPayload(data);
      setForm(next);
      setSavedSnapshot(JSON.stringify(next));
      toast.success("Gmail task saved — the member page reflects it immediately.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactNode; id: string }) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );

  // The curated timezone list + any stored custom zones (never hide the
  // active configuration from the editor).
  const tzOptions = Array.from(
    new Set([...TIMEZONE_OPTIONS, form.timezone, form.dailyResetTimezone].filter(Boolean)),
  );
  const currencyOptions = payload.currencies.some((c) => c.code === form.currency)
    ? payload.currencies
    : [{ code: form.currency, name: form.currency, symbol: "" }, ...payload.currencies];

  const statusHint = STATUS_OPTIONS.find((s) => s.value === form.status)?.hint;

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Gmail Task Management</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Configure the member-facing{" "}
            <strong className="text-foreground">Today&apos;s Gmail Task</strong> notice — the rate, quantities,
            schedule, deadline and daily submission limit — plus the Gmail Checker link. Changes take effect
            immediately on the Submit Your Gmail page and are enforced server-side.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {payload.task.lastUpdated && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Last updated{" "}
                {formatDateTime(payload.task.lastUpdated)}
              </span>
            )}
            {dirty && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
                <Info className="h-3 w-3" aria-hidden="true" /> Unsaved changes
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {dirty && (
            <Button type="button" variant="outline" className="rounded-xl" onClick={reset} disabled={saving}>
              <RotateCcw className="mr-2 h-4 w-4" /> Discard edits
            </Button>
          )}
          <Button type="submit" className="btn-gradient rounded-xl text-white" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save task</>}
          </Button>
        </div>
      </div>

      {/* ---- Status & schedule ---- */}
      <Reveal as="section" delay={0} className="space-y-5 rounded-2xl border border-border bg-white p-6">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand">
          <ShieldCheck className="h-5 w-5 text-primary" /> Status &amp; schedule
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task status" id="gt-status" hint={statusHint}>
            <Select value={form.status} onValueChange={(v) => setField("status", v as TaskForm["status"])}>
              <SelectTrigger id="gt-status" className="rounded-lg w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Display timezone" id="gt-tz" hint="Task dates are shown to members in this timezone. It is independent of the daily-reset timezone below.">
            <Select value={form.timezone} onValueChange={(v) => setField("timezone", v)}>
              <SelectTrigger id="gt-tz" className="rounded-lg w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tzOptions.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz} — {tzCurrentOffset(tz)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Task start" id="gt-start" hint={`Entered as wall-clock time in ${form.timezone}. Leave empty for no start restriction.`}>
            <Input
              id="gt-start"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setField("startsAt", e.target.value)}
              className="rounded-lg w-full sm:w-64"
            />
          </Field>
          <Field label="Submission deadline" id="gt-deadline" hint="Shown on the task notice; with the countdown enabled it ticks live, server-synchronized.">
            <Input
              id="gt-deadline"
              type="datetime-local"
              value={form.deadlineAt}
              onChange={(e) => setField("deadlineAt", e.target.value)}
              className="rounded-lg w-full sm:w-64"
            />
          </Field>
          <Field label="Task end" id="gt-end" hint="After this moment the task is ended — leave empty for no end.">
            <Input
              id="gt-end"
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setField("endsAt", e.target.value)}
              className="rounded-lg w-full sm:w-64"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="gt-countdown" className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-3.5">
            <Checkbox
              id="gt-countdown"
              checked={form.countdownEnabled}
              onCheckedChange={(v) => setField("countdownEnabled", v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Timer className="h-4 w-4 text-primary" aria-hidden="true" /> Live deadline countdown
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Shows a server-synchronized countdown to the configured deadline on the task notice.
              </span>
            </span>
          </label>
          <label htmlFor="gt-stop" className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-3.5">
            <Checkbox
              id="gt-stop"
              checked={form.stopAfterDeadline}
              onCheckedChange={(v) => setField("stopAfterDeadline", v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Stop submissions after the deadline
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Only when enabled does a passed deadline actually block new submissions (server-enforced). Otherwise the
                deadline is display-only.
              </span>
            </span>
          </label>
        </div>
      </Reveal>

      {/* ---- Rate & quantities ---- */}
      <Reveal as="section" delay={STAGGER.base} className="space-y-5 rounded-2xl border border-border bg-white p-6">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand">
          <Target className="h-5 w-5 text-primary" /> Rate &amp; quantities
        </h3>
        {!payload.rate.available ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed text-amber-800">
            The Gmail rate card (<span className="font-mono text-xs">gmail-account</span>) has not been created yet —
            create it in the Card Rates section first, then reload this page to configure its rate here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rate per eligible entry" id="gt-rate" hint="Written to the gmail-account card — the single source of truth for reward math.">
              <Input
                id="gt-rate"
                value={form.rate}
                onChange={set("rate")}
                inputMode="decimal"
                className="rounded-lg w-40"
                placeholder="10"
                aria-describedby="gt-rate-hint"
              />
            </Field>
            <Field label="Currency" id="gt-currency" hint="Must be an enabled currency (managed in Currency settings).">
              <Select value={form.currency} onValueChange={(v) => setField("currency", v)}>
                <SelectTrigger id="gt-currency" className="rounded-lg w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Task target" id="gt-target" hint="The overall requested quantity shown on the notice — members are never required to submit it. Empty hides the field.">
              <Input
                id="gt-target"
                value={form.target}
                onChange={set("target")}
                inputMode="numeric"
                className="rounded-lg w-40"
                placeholder="e.g. 500"
              />
            </Field>
            <Field label="Minimum per submission" id="gt-min" hint="Smallest accepted quantity in one submission. Empty = no minimum (1 entry is always fine). Keep rate × minimum at or above your payout methods' minimum payout (Payout Methods section) so members can always complete their payout step.">
              <Input
                id="gt-min"
                value={form.minQuantity}
                onChange={set("minQuantity")}
                inputMode="numeric"
                className="rounded-lg w-40"
                placeholder="1"
              />
            </Field>
            <Field label="Maximum per submission" id="gt-max" hint="Largest accepted quantity in one submission. Empty = no maximum.">
              <Input
                id="gt-max"
                value={form.maxQuantity}
                onChange={set("maxQuantity")}
                inputMode="numeric"
                className="rounded-lg w-40"
                placeholder="e.g. 5000"
              />
            </Field>
          </div>
        )}
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Daily Gmail submission limit"
            id="gt-daily"
            hint="Maximum distinct eligible entries a member may have accepted per day (the DEFAULT is 10). Applies immediately to subsequent submissions — lowering it below a member's current total simply blocks their next submission until the reset."
          >
            <Input
              id="gt-daily"
              value={form.dailyLimit}
              onChange={set("dailyLimit")}
              inputMode="numeric"
              maxLength={5}
              className="rounded-lg w-32"
              placeholder="10"
              aria-describedby="gt-daily-hint"
            />
          </Field>
          <Field label="Daily reset timezone" id="gt-reset-tz" hint="The daily counter rolls over at LOCAL MIDNIGHT in this timezone (separate from the task deadline).">
            <Select value={form.dailyResetTimezone} onValueChange={(v) => setField("dailyResetTimezone", v)}>
              <SelectTrigger id="gt-reset-tz" className="rounded-lg w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tzOptions.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz} — {tzCurrentOffset(tz)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          Counted are distinct eligible entries accepted into submissions created inside the current daily window —
          duplicates never consume allowance and rejected submissions are excluded. Ten is the{" "}
          <strong className="text-foreground">maximum per day</strong>, never a required batch size: members may submit
          any quantity from the minimum up to their remaining allowance.
        </p>
      </Reveal>

      {/* ---- Task content ---- */}
      <Reveal as="section" delay={STAGGER.base * 2} className="space-y-5 rounded-2xl border border-border bg-white p-6">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand">
          <Megaphone className="h-5 w-5 text-primary" /> Task content
        </h3>
        <Field label="Task title" id="gt-title" hint="Shown as the notice heading. Empty falls back to “Today’s Gmail Task”.">
          <Input id="gt-title" value={form.title} onChange={set("title")} className="rounded-lg" maxLength={120} placeholder="Today's Gmail Task" />
        </Field>
        <Field label="Task description" id="gt-desc" hint="One or two sentences describing the current task. Empty hides the field.">
          <Textarea id="gt-desc" value={form.description} onChange={set("description")} rows={3} className="rounded-lg text-sm" maxLength={1500} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task instructions" id="gt-instr" hint="One step per line (max 12) — shown as a numbered list. Empty falls back to the platform's default guided steps.">
            <Textarea id="gt-instr" value={form.instructions} onChange={set("instructions")} rows={6} className="rounded-lg text-sm" maxLength={5000} placeholder={"Open the Gmail Checker.\nCheck the addresses you are authorized to submit.\n…"} />
          </Field>
          <Field label="Eligibility requirements" id="gt-reqs" hint="One requirement per line (max 12) — shown with check icons on the notice and program page.">
            <Textarea id="gt-reqs" value={form.requirements} onChange={set("requirements")} rows={6} className="rounded-lg text-sm" maxLength={3600} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Processing-time estimate" id="gt-proc" hint="e.g. “Reviewed within 24 hours of submitting payout details.” Empty falls back to the global verification-window copy.">
            <Input id="gt-proc" value={form.processingEstimate} onChange={set("processingEstimate")} className="rounded-lg" maxLength={300} />
          </Field>
          <Field label="Additional task notice" id="gt-extra" hint="Optional highlighted notice shown at the bottom of the task card.">
            <Textarea id="gt-extra" value={form.extraNotice} onChange={set("extraNotice")} rows={3} className="rounded-lg text-sm" maxLength={800} />
          </Field>
        </div>
      </Reveal>

      {/* ---- Gmail Checker ---- */}
      <Reveal as="section" delay={STAGGER.base * 3} className="space-y-5 rounded-2xl border border-border bg-white p-6">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand">
          <Mail className="h-5 w-5 text-primary" /> Gmail Checker
        </h3>
        <Field
          label="Gmail Checker URL"
          id="gt-checker"
          hint="Opened by the prominent “Open Gmail Checker” button at the top of the Submit Your Gmail page (new tab). Leave empty to use the built-in default."
        >
          <div className="flex max-w-xl items-center gap-2">
            <Input
              id="gt-checker"
              type="url"
              value={form.checkerUrl}
              onChange={set("checkerUrl")}
              className="rounded-lg"
              maxLength={300}
              placeholder={payload.defaultCheckerUrl}
              aria-describedby="gt-checker-hint"
            />
            {(form.checkerUrl.trim() || payload.defaultCheckerUrl) && (
              <a
                href={form.checkerUrl.trim() || payload.defaultCheckerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-primary transition-colors hover:bg-accent"
              >
                Test <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </Field>
        <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          The checker is an external tool with no authorized API — the platform opens it in a new tab and members paste
          their checked entries back into the guided workflow, where the server validates every line. No passwords or
          account credentials are ever requested or accepted.
        </p>
      </Reveal>

      <Separator />

      <div className={cn("flex items-center justify-between gap-3")}>
        <p className="text-xs text-muted-foreground">
          {dirty
            ? "You have unsaved changes — they apply only after saving."
            : "The form shows the currently active configuration."}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button type="button" variant="outline" className="rounded-xl" onClick={reset} disabled={saving}>
              <RotateCcw className="mr-2 h-4 w-4" /> Discard edits
            </Button>
          )}
          <Button type="submit" className="btn-gradient rounded-xl text-white" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save task</>}
          </Button>
        </div>
      </div>
    </form>
  );
}
