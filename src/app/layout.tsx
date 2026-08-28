import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Muxamil.co — One Home for Your Entire Community",
  description:
    "Stay connected, stay informed, and communicate directly with your community from one secure platform. Official announcements, private admin chat, and communities run by verified creators.",
  keywords: ["Muxamil", "community", "announcements", "verified creators", "Muxamil.co"],
  authors: [{ name: "Muxamil.co" }],
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Muxamil.co — One Home for Your Entire Community",
    description: "Official announcements, private admin chat and verified creator communities.",
    siteName: "Muxamil.co",
    type: "website",
    images: [{ url: "/branding/muxamil-logo.png", width: 1122, height: 1402, alt: "Muxamil.co" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // NOTE: no `suppressHydrationWarning` here, deliberately. Attributes such
    // as `bis_skin_checked` are injected by browser extensions (e.g. the
    // Urban VPN Proxy / Bitdefender family) BEFORE React hydrates — they are
    // not produced by this app, which renders fully deterministic markup
    // (verified in an extension-free headless browser: zero hydration
    // warnings). Per project policy we do NOT hide extension-induced
    // warnings with suppression flags; such warnings are external and benign.
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
