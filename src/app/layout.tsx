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
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "Muxamil.co — One Home for Your Entire Community",
    description: "Official announcements, private admin chat and verified creator communities.",
    siteName: "Muxamil.co",
    type: "website",
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
    // `suppressHydrationWarning` on <html>/<body> ONLY: browser extensions
    // (e.g. Bitdefender's `bis_skin_checked`) inject attributes onto these
    // elements before React hydrates. The app's own SSR output is fully
    // deterministic (verified in a clean browser — zero hydration warnings);
    // this flag is scoped to these two elements' attribute comparison only
    // and never affects children.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
