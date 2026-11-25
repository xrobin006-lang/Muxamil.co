// Work Guideline identity adapter. Authentication and global account status
// are owned by Muxamil's existing Supabase Auth + mux_profiles system. The
// namespaced wg_users row stores only Work Guideline-specific role/restriction
// metadata and relational history; it never stores credentials or elevates a
// user to Muxamil-wide administrator.
import { getActiveUser, type AppUser } from "@/lib/auth";
import { db } from "@/lib/wg/db";
import type { User } from "@/generated/wg-prisma";

export async function ensureLocalUser(auth: AppUser): Promise<User | null> {
  const email = (auth.email || "").trim().toLowerCase();
  if (!auth.id || !email || auth.isBlocked) return null;
  const role = auth.role === "admin" ? "ADMIN" : "USER";
  const name = (auth.fullName || email.split("@")[0]).trim().slice(0, 80);

  const byAuthId = await db.user.findUnique({ where: { supabaseUserId: auth.id } });
  if (byAuthId) {
    return db.user.update({
      where: { id: byAuthId.id },
      data: { email, name, role, emailVerifiedAt: byAuthId.emailVerifiedAt ?? new Date() },
    });
  }

  const byEmail = await db.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.supabaseUserId && byEmail.supabaseUserId !== auth.id) return null;
    return db.user.update({
      where: { id: byEmail.id },
      data: { supabaseUserId: auth.id, name, role, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
    });
  }

  return db.user.create({
    data: { email, name, role, supabaseUserId: auth.id, isRestricted: false, emailVerifiedAt: new Date() },
  });
}

export async function getSessionUser(): Promise<User | null> {
  const auth = await getActiveUser();
  if (!auth) return null;
  try { return await ensureLocalUser(auth); } catch (error) {
    console.error("[work-guideline] unable to provision local identity:", error);
    return null;
  }
}

export function isInlineResetMode(): boolean {
  return process.env.PASSWORD_RESET_MODE !== "email";
}
