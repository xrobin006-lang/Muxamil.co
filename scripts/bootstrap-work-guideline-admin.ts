/**
 * Safely grants the Work Guideline ADMIN role to an existing active Muxamil
 * administrator. This changes wg_users only; mux_profiles is never modified.
 * Run after the chosen Muxamil admin has signed in to /work-guideline once.
 */
import { supabase } from "../src/lib/supabase";
import { db } from "../src/lib/wg/db";

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Usage: npx tsx scripts/bootstrap-work-guideline-admin.ts <active-muxamil-admin-email>");
  }

  const { data: profile, error } = await supabase
    .from("mux_profiles")
    .select("id,email,role,status")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new Error(`Could not verify Muxamil profile: ${error.message}`);
  if (!profile || profile.status !== "active" || profile.role !== "admin") {
    throw new Error("The email must belong to an existing active Muxamil administrator.");
  }

  const user = await db.user.findUnique({ where: { supabaseUserId: profile.id } });
  if (!user) {
    throw new Error("No linked Work Guideline user was found. Sign in to /work-guideline with this account first, then rerun the command.");
  }

  await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  console.log(`Granted Work Guideline ADMIN to ${email}. Muxamil's global role was not changed.`);
}

main()
  .catch((error) => {
    console.error("Work Guideline admin bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
