import { handle, ok, requireUser } from "@/lib/wg/api";
import { getGmailDailyStatus } from "@/lib/wg/gmail-daily-limit";

// GET — the member's daily Gmail submission allowance.
//
// Every number the Submit Your Gmail page displays comes from HERE (never a
// client-side guess), computed from the actual submission records with the
// same rules the submission endpoint enforces:
//   limit            — the admin-configured daily limit (default 10)
//   submittedToday   — distinct eligible addresses accepted inside the
//                      current daily window
//   remaining        — max(0, limit - submittedToday)
//   resetsAt         — UTC ISO instant of the next local-midnight reset
//   windowStartAt    — UTC ISO instant the current window started
//   timezone         — the configured IANA timezone both are computed in
//   serverNow        — the server clock, so the client can synchronize the
//                      reset/deadline countdowns to backend time
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return ok({ dailyLimit: await getGmailDailyStatus(user.id), serverNow: new Date().toISOString() });
  });
}
