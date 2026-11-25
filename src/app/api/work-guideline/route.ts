import { NextResponse } from "next/server";
import { sbConfigStatus, sbPing } from "@/lib/wg/supabase";

// Health check: confirms the API server is up, whether the project's Supabase
// instance (authentication + file storage) is reachable, and — without ever
// exposing values — exactly WHICH required environment variables are present
// and whether their formats are plausible. Safe to expose publicly: it
// contains only booleans, the (public) project host, the bucket name and the
// key's format classification. No secrets, no tokens, no headers.
export async function GET() {
  const config = sbConfigStatus();
  let supabase: "reachable" | "unreachable" | "unconfigured" = "unconfigured";
  if (config.configured) {
    supabase = (await sbPing()) ? "reachable" : "unreachable";
  }
  return NextResponse.json({ status: "ok", supabase, supabaseConfig: config });
}
