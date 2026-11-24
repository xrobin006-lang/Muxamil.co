"use client";

// Admin Currency manager — the centralized currency configuration.
//
// One row per supported currency. The DEFAULT (PKR) drives every new
// submission/payment; the per-currency decimals drive platform-wide display
// ("PKR 1,000"); the optional admin-managed rate powers DISPLAY-ONLY
// conversions on transaction detail pages. Changing any of this NEVER
// rewrites stored transactions — historical amounts keep their own currency
// and value forever (usage counts are shown per currency as proof).

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, Plus, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Switch } from "@/components/wg-ui/switch";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { ErrorState, LoadingBlock } from "@/components/work-guideline/ui-bits";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";
import type { CurrencyAdmin } from "@/lib/wg/types";

interface CurrencyResponse {
  currencies: CurrencyAdmin[];
  conversionEnabled: boolean;
  usage: Array<{ currency: string; _count: { _all: number } }>;
}

export function AdminCurrencies() {
  const { refreshSettings } = useApp();
  const [rows, setRows] = useState<CurrencyAdmin[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [conversionEnabled, setConversionEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDecimals, setNewDecimals] = useState("2");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<CurrencyResponse>("/api/admin/currencies");
      setRows(data.currencies);
      setConversionEnabled(data.conversionEnabled);
      const usageMap: Record<string, number> = {};
      for (const u of data.usage ?? []) usageMap[u.currency] = u._count._all;
      setUsage(usageMap);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <LoadingBlock label="Loading currency settings…" />;

  const update = (code: string, patch: Partial<CurrencyAdmin>) => {
    setRows((r) => (r ? r.map((c) => (c.code === code ? { ...c, ...patch } : c)) : r));
  };

  const saveRow = async (c: CurrencyAdmin) => {
    setBusyCode(c.code);
    try {
      await api("/api/admin/currencies", {
        method: "PATCH",
        body: JSON.stringify({
          code: c.code,
          name: c.name,
          symbol: c.symbol,
          decimals: c.decimals,
          isEnabled: c.isEnabled,
          isDefault: c.isDefault,
          displayOrder: c.displayOrder,
          rateToDefault: c.rateToDefault,
          conversionEnabled,
        }),
      });
      toast.success(`${c.code} settings saved`);
      await load();
      await refreshSettings();
    } catch (err) {
      toast.error((err as Error).message);
      await load();
    } finally {
      setBusyCode(null);
    }
  };

  const saveConversionToggle = async (enabled: boolean) => {
    setConversionEnabled(enabled);
    try {
      await api("/api/admin/currencies", {
        method: "PATCH",
        body: JSON.stringify({ conversionEnabled: enabled }),
      });
      await refreshSettings();
      toast.success(enabled ? "Managed-rate conversion display enabled" : "Conversion display disabled");
    } catch (err) {
      toast.error((err as Error).message);
      setConversionEnabled(!enabled);
    }
  };

  const addCurrency = async () => {
    const code = newCode.trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(code)) return toast.error("Code must be 2–10 letters, e.g. AED or USDT.");
    if (newName.trim().length < 2) return toast.error("Enter the currency name.");
    setAdding(true);
    try {
      await api("/api/admin/currencies", {
        method: "POST",
        body: JSON.stringify({ code, name: newName.trim(), decimals: Number(newDecimals) || 2 }),
      });
      toast.success(`${code} added`);
      setNewCode("");
      setNewName("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* How it works — the honesty contract */}
      <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-accent/50 p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="leading-relaxed text-muted-foreground">
          The <strong className="text-foreground">default currency</strong> applies to NEW submissions only — every
          stored transaction keeps its own currency and amount forever, so switching never rewrites payment history.
          Payout methods stay manual; the optional managed rate is for display only and never implies funds were converted.
        </p>
      </div>

      {/* Conversion display toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <p className="text-sm font-semibold">Show managed-rate conversions</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            When enabled, transaction details show an approximate converted amount using ONLY the admin rates below
            (clearly labelled). No rates are fetched or invented.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <Switch checked={conversionEnabled} onCheckedChange={(v) => void saveConversionToggle(v)} aria-label="Toggle conversion display" />
          <span className="text-sm font-medium">{conversionEnabled ? "On" : "Off"}</span>
        </label>
      </div>

      {/* Currency table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Default</th>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Decimals</th>
              <th className="px-4 py-3 font-semibold">Managed rate → default</th>
              <th className="px-4 py-3 font-semibold">Enabled</th>
              <th className="px-4 py-3 font-semibold">Stored usage</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code} className={cn("border-b border-border/60 last:border-0", !c.isEnabled && "bg-muted/30")}>
                <td className="px-4 py-3">
                  <input
                    type="radio"
                    name="default-currency"
                    checked={c.isDefault}
                    onChange={() => update(c.code, { isDefault: true })}
                    aria-label={`Set ${c.code} as default`}
                    className="h-4 w-4 accent-[#1455b8]"
                  />
                </td>
                <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-3">
                  <Input value={c.name} onChange={(e) => update(c.code, { name: e.target.value })} className="h-8 rounded-lg text-sm" maxLength={60} disabled={busyCode === c.code} />
                </td>
                <td className="px-4 py-3">
                  <Input
                    value={String(c.decimals)}
                    onChange={(e) => update(c.code, { decimals: Math.max(0, Math.min(4, Number(e.target.value.replace(/\D/g, "")) || 0)) })}
                    className="h-8 w-16 rounded-lg text-sm"
                    inputMode="numeric"
                    disabled={busyCode === c.code}
                  />
                </td>
                <td className="px-4 py-3">
                  <Input
                    value={c.rateToDefault != null ? String(c.rateToDefault) : ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      update(c.code, { rateToDefault: v === "" ? null : Number(v) });
                    }}
                    placeholder={c.isDefault ? "—" : "e.g. 280"}
                    className="h-8 w-28 rounded-lg text-sm"
                    inputMode="decimal"
                    disabled={busyCode === c.code || c.isDefault}
                  />
                </td>
                <td className="px-4 py-3">
                  <Switch
                    checked={c.isEnabled}
                    onCheckedChange={(v) => update(c.code, { isEnabled: v })}
                    disabled={busyCode === c.code || c.isDefault}
                    aria-label={`${c.isEnabled ? "Disable" : "Enable"} ${c.code}`}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {usage[c.code] ? `${usage[c.code]} transaction${usage[c.code] === 1 ? "" : "s"}` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="rounded-lg" disabled={busyCode === c.code} onClick={() => void saveRow(c)}>
                    {busyCode === c.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span className="sr-only">Save {c.code}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Rows save individually — switch the default with the radio and save that row; the previous default is cleared atomically.
        The default currency cannot be disabled. Usage counts come from live submissions.
      </p>

      {/* Add currency (future international expansion) */}
      <div className="rounded-2xl border border-border bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold"><Coins className="h-4 w-4 text-primary" /> Add a supported currency</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr_100px_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="cur-code" className="text-xs">Code</Label>
            <Input id="cur-code" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="AED" className="h-9 rounded-lg font-mono" maxLength={10} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-name" className="text-xs">Name</Label>
            <Input id="cur-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="UAE Dirham" className="h-9 rounded-lg" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-decimals" className="text-xs">Decimals</Label>
            <Input id="cur-decimals" value={newDecimals} onChange={(e) => setNewDecimals(e.target.value.replace(/\D/g, ""))} className="h-9 rounded-lg" inputMode="numeric" maxLength={1} />
          </div>
          <div className="flex items-end">
            <Button className="btn-gradient rounded-lg text-white" onClick={() => void addCurrency()} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="ml-1.5">Add</span>
            </Button>
          </div>
        </div>
        <p className="mt-2.5 text-xs text-muted-foreground">
          New currencies start enabled but never become the default implicitly.
        </p>
      </div>
    </div>
  );
}
