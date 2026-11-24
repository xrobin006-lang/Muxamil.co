/**
 * One-time import of a JSON export created by export-work-guideline-data.py.
 * It inserts into namespaced wg_* tables only and is safe to rerun because
 * duplicate primary/unique keys are skipped. It never writes to mux_* tables.
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/wg/db";

type Row = Record<string, unknown>;
type ExportData = Record<string, Row[]>;

const dateFields = new Set([
  "emailVerifiedAt", "createdAt", "updatedAt", "publishedAt", "openedAt",
  "completedAt", "paymentDetailsAt", "paidAt", "deadlineAt",
]);

function normalizeRow(source: Row, table: string): Row {
  const row: Row = { ...source };
  for (const [key, value] of Object.entries(row)) {
    if (!dateFields.has(key) || value == null) continue;
    const date = value instanceof Date ? value : new Date(value as string | number);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`Invalid date in ${table}.${key}: ${String(value)}`);
    }
    row[key] = date;
  }
  if (table === "User") {
    // Muxamil mux_profiles is authoritative. Legacy IDs/roles are never trusted.
    row.supabaseUserId = null;
    row.role = "USER";
    row.email = String(row.email ?? "").trim().toLowerCase();
  }
  return row;
}

async function insertMany(
  label: string,
  model: { createMany: (args: any) => Promise<{ count: number }> },
  rows: Row[],
): Promise<number> {
  if (!rows.length) return 0;
  const result = await model.createMany({
    data: rows.map((row) => normalizeRow(row, label)),
    skipDuplicates: true,
  });
  console.log(`${label}: inserted ${result.count} / ${rows.length}`);
  return result.count;
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npx tsx scripts/import-work-guideline-data.ts <export.json>");
  const file = path.resolve(input);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as ExportData;
  const get = (name: string) => Array.isArray(data[name]) ? data[name] : [];

  const summary = await db.$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    // Parent rows first; then children. Foreign keys are preserved from export.
    counts.User = await insertMany("User", tx.user, get("User"));
    counts.Currency = await insertMany("Currency", tx.currency, get("Currency"));
    counts.RewardsProgram = await insertMany("RewardsProgram", tx.rewardsProgram, get("RewardsProgram"));
    counts.ProgramGuide = await insertMany("ProgramGuide", tx.programGuide, get("ProgramGuide"));
    counts.CardRate = await insertMany("CardRate", tx.cardRate, get("CardRate"));
    counts.PaymentMethod = await insertMany("PaymentMethod", tx.paymentMethod, get("PaymentMethod"));
    counts.TutorialStep = await insertMany("TutorialStep", tx.tutorialStep, get("TutorialStep"));
    counts.TutorialProgress = await insertMany("TutorialProgress", tx.tutorialProgress, get("TutorialProgress"));
    counts.Submission = await insertMany("Submission", tx.submission, get("Submission"));
    counts.SubmissionStatusHistory = await insertMany("SubmissionStatusHistory", tx.submissionStatusHistory, get("SubmissionStatusHistory"));
    counts.PaymentRecord = await insertMany("PaymentRecord", tx.paymentRecord, get("PaymentRecord"));
    counts.Notification = await insertMany("Notification", tx.notification, get("Notification"));
    counts.SiteSetting = await insertMany("SiteSetting", tx.siteSetting, get("SiteSetting"));
    counts.AdminAuditLog = await insertMany("AdminAuditLog", tx.adminAuditLog, get("AdminAuditLog"));
    counts.ContactMessage = await insertMany("ContactMessage", tx.contactMessage, get("ContactMessage"));
    return counts;
  });

  console.log("Work Guideline data import complete:", summary);
  console.log("Note: legacy user IDs/password credentials were intentionally not imported.");
}

main()
  .catch((error) => {
    console.error("Work Guideline import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
