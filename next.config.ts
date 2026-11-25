import type { NextConfig } from "next";

/**
 * Static security headers. NOTE on CSP: the DOCUMENT at "/" receives a
 * stricter per-request NONCE-based CSP from src/proxy.ts (Next.js stamps its
 * bootstrap scripts with the nonce). The static CSP below remains as the
 * fallback for non-proxied responses (static assets, 404s) — when both are
 * present browsers enforce the intersection, which still requires the nonce
 * for inline scripts on the document.
 *
 *  - scripts/styles: 'self' + 'unsafe-inline' (legacy fallback only — see
 *    proxy.ts; Radix/shadcn position UI via inline style attributes).
 *    'unsafe-eval' is NOT needed in production and is omitted.
 *  - images: Supabase storage (avatars/banners/posts + signed chat media),
 *    Google S2 favicons (chat link cards), YouTube thumbnails (project videos),
 *    data:/blob: (inline placeholders + recorded voice playback art).
 *  - media: Supabase signed media + blob: (voice notes / recorded video).
 *  - connect: self + Supabase (direct signed-URL fetches) + websockets
 *    (socket.io rides the same origin; ws: kept for plain-HTTP dev).
 *  - frames: only the YouTube nocookie / Vimeo players may be embedded; the app itself
 *    may only be framed by itself or the *.space-z.ai sandbox preview panel.
 */
const isDev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' is DEV-ONLY: React's dev tools reconstruct callstacks via
  // eval(); React never uses eval in production, so prod stays strict.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co https://www.google.com https://i.ytimg.com",
  "media-src 'self' blob: https://*.supabase.co",
  `connect-src 'self' https://*.supabase.co wss:${isDev ? " ws:" : ""}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://*.space-z.ai",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy framing guard. Modern browsers use the CSP frame-ancestors above
  // (which also allows the *.space-z.ai preview panel) and IGNORE this
  // header when both are present; SAMEORIGIN only matters for legacy
  // engines — chosen over DENY so the sandbox preview keeps working there.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Our responses may only be embedded by same-site contexts (muxamil.co in
  // production, *.space-z.ai siblings in the sandbox) — stops other sites
  // from hot-linking private API JSON or assets in no-cors mode.
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera: not used anywhere; microphone: chat voice messages (self only).
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HTTPS-only production (muxamil.co). No includeSubDomains/preload until the
  // DNS layout is confirmed — see the security report for the rollout advice.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Never advertise the framework (reconnaissance hygiene).
  poweredByHeader: false,
  // Never emit browser source maps in production — they ship the full,
  // unminified source tree to every visitor.
  productionBrowserSourceMaps: false,
  // Strip debug logging (log/info/debug/warn) from PRODUCTION client bundles;
  // console.error is kept. Dev output is untouched.
  ...(isDev ? {} : { compiler: { removeConsole: { exclude: ["error"] } } }),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      // API responses carry private, per-user data — never cacheable.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
