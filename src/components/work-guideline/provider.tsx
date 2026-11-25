"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/wg/client";
import { configureCurrencyDisplay } from "@/components/work-guideline/ui-bits";
import type { BrandingPublic, CurrencyContextPublic, PublicUser } from "@/lib/wg/types";

export interface MuxamilPlatformIdentity {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  footerText: string | null;
}

export interface PublicSettings {
  brand_name: string;
  brand_byline: string;
  hero_title: string;
  hero_subtitle: string;
  contact_email: string;
  support_hours: string;
  verification_window_hours: string;
  /** Admin-configurable overdue explanation — shown by the countdown. */
  verification_window_note: string;
  announcement: string;
  disclaimer: string;
  payments_note: string;
  /** Title of the member-facing card-rates section (admin-editable). */
  card_rates_title: string;
  /** External Gmail checker URL opened by the Gmail Rewards wizard (admin-editable). */
  gmail_checker_url: string;
  /** Daily Gmail submission limit (admin-editable, positive integer as string).
   * Present on the admin settings payload; the member wizard reads its live
   * numbers from the authenticated /api/gmail/daily-limit endpoint instead. */
  gmail_daily_limit?: string;
  /** IANA timezone whose local midnight resets the daily Gmail counter. */
  gmail_daily_reset_timezone?: string;
  /** Centrally managed images (logo, banners, promo) from the Branding manager. */
  branding?: BrandingPublic | null;
  /** Centralized currency configuration (default + enabled set). */
  currency?: CurrencyContextPublic | null;
}

/** Serves a configured branding image through the public /api/files endpoint. */
export function brandingImageUrl(slotKey: string): string {
  return `/api/work-guideline/files?kind=branding&slot=${encodeURIComponent(slotKey)}`;
}

interface AppContextValue {
  user: PublicUser | null;
  unread: number;
  settings: PublicSettings | null;
  platform: MuxamilPlatformIdentity;
  loadingAuth: boolean;
  refreshUser: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [platform, setPlatform] = useState<MuxamilPlatformIdentity>({
    name: "Muxamil.co",
    logoUrl: null,
    tagline: "One home for your community and work",
    footerText: null,
  });
  const [loadingAuth, setLoadingAuth] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api<{ user: PublicUser | null; unreadNotifications: number }>("/api/auth/me");
      setUser(data.user);
      setUnread(data.unreadNotifications);
    } catch {
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await api<{ settings: PublicSettings; branding?: BrandingPublic; currency?: CurrencyContextPublic }>("/api/site-settings");
      // Older payloads may lack the branding map — normalize so consumers can
      // always rely on settings.branding being an object or null.
      setSettings({ ...data.settings, branding: data.branding ?? data.settings.branding ?? null, currency: data.currency ?? null });
      // Feed the centralized currency display config so every formatMoney()
      // call renders through the admin's currency settings.
      configureCurrencyDisplay(data.currency ?? null);
    } catch {
      /* fall back to defaults rendered inline */
    }
  }, []);

  const refreshPlatform = useCallback(async () => {
    try {
      // This is the existing public Muxamil endpoint, not the namespaced
      // Work Guideline API. It keeps the Work Hub on the same site identity.
      const response = await fetch("/api/settings", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json() as {
        settings?: {
          platform_name?: string;
          logo_url?: string | null;
          tagline?: string | null;
          footer_text?: string | null;
        };
      };
      const site = payload.settings;
      if (!site) return;
      setPlatform({
        name: site.platform_name?.trim() || "Muxamil.co",
        logoUrl: site.logo_url || null,
        tagline: site.tagline?.trim() || "One home for your community and work",
        footerText: site.footer_text?.trim() || null,
      });
    } catch {
      // The bundled Muxamil identity remains as a safe offline fallback.
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    void refreshSettings();
    void refreshPlatform();
  }, [refreshUser, refreshSettings, refreshPlatform]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setUnread(0);
  }, []);

  return (
    <AppContext.Provider value={{ user, unread, settings, platform, loadingAuth, refreshUser, refreshSettings, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
