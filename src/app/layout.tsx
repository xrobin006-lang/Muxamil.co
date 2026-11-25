import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { Geist, Geist_Mono, Inter, Nunito } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { getLayoutBranding } from "@/lib/site-branding";
import { brandColorCss } from "@/lib/brand-colors";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Inter — the storefront's cyberpunk typography (scoped to Store views via
// the --font-inter variable; the rest of the app keeps Geist).
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://muxamil.co";

/** Static fallbacks — used whenever the admin hasn't customized a field.
 *  These exactly match the pre-upgrade site, so the default look is the
 *  same one that has always shipped. */
const FALLBACK_DESCRIPTION =
  "Stay connected, stay informed, and communicate directly with your community from one secure platform. Official announcements, private admin chat, and communities run by verified creators.";
const FALLBACK_OG_DESCRIPTION =
  "Official announcements, private admin chat and verified creator communities.";

/** Admin-managed website identity (mux_site_settings + site_branding) —
 *  powers the browser title, meta description, favicon and social-share
 *  image. Falls back to the static defaults above on any datastore error. */
export async function generateMetadata(): Promise<Metadata> {
  const { siteName, siteDescription, faviconUrl, branding } = await getLayoutBranding();
  const shortName = branding.shortName?.trim() || siteName;
  const title = branding.browserTitle?.trim() || `${siteName} — ${branding.tagline?.trim() || "One Home for Your Entire Community"}`;
  const description = branding.metaDescription?.trim() || siteDescription || FALLBACK_DESCRIPTION;
  const ogImage = branding.ogImageAsset?.url || "/og-image.png";
  const icons = {
    icon: [
      { url: faviconUrl || "/favicon-32.png" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  };
  return {
    metadataBase: new URL(siteUrl),
    title: { default: title, template: `%s · ${shortName}` },
    description,
    applicationName: siteName,
    keywords: [
      "Muxamil",
      "Muxamil.co",
      "community",
      "announcements",
      "verified creators",
      "creator communities",
      "private chat",
    ],
    authors: [{ name: siteName }],
    creator: siteName,
    icons,
    manifest: "/site.webmanifest",
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description: branding.metaDescription?.trim() || siteDescription || FALLBACK_OG_DESCRIPTION,
      siteName,
      type: "website",
      url: "/",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: branding.metaDescription?.trim() || siteDescription || FALLBACK_OG_DESCRIPTION,
      images: [ogImage],
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce (set by src/proxy.ts). Reading headers() also
  // guarantees the document renders per-request, so the nonce stamped into
  // the HTML always matches the one in the CSP response header.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Admin-managed brand colors (null when unset → the built-in theme is used
  // untouched). Rendered inline so there is no flash of the default palette.
  const brandCss = brandColorCss((await getLayoutBranding()).branding.colors);
  return (
    // `suppressHydrationWarning` on <html>/<body> ONLY: browser extensions
    // (e.g. Bitdefender's `bis_skin_checked`) inject attributes onto these
    // elements before React hydrates. The app's own SSR output is fully
    // deterministic (verified in a clean browser — zero hydration warnings);
    // this flag is scoped to these two elements' attribute comparison only
    // and never affects children.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${nunito.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/*
          Pre-paint theme restore: settings-view persists the user's choice in
          localStorage('commhub-theme'); without this script the class was only
          re-applied when Settings remounted, so a reload flashed light mode.
          Runs synchronously before any visible content is parsed → no flash.
          The class lands on <html>, whose attribute comparison is already
          suppressed above (same mechanism the settings toggle relies on).
        */}
        <Script
          id="commhub-theme-restore"
          strategy="beforeInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('commhub-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        {brandCss && (
          <style
            nonce={nonce}
            dangerouslySetInnerHTML={{ __html: brandCss }}
          />
        )}
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
