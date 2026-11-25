import { NextResponse } from "next/server";

// Work Hub account access is delegated to Muxamil's shared account/session.
// These legacy endpoints are disabled to prevent a separate auth flow.
export async function POST() {
  return NextResponse.json(
    { error: "Use your Muxamil.co account to sign in or create an account." },
    { status: 410 },
  );
}
