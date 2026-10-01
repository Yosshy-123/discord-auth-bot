import { lt, or, and, isNotNull } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { verificationSessions, ipReputationCache } from "../db/schema.js";

const ADVISORY_LOCK_KEY = 837_226_501; // arbitrary constant for this job

/** §12: only session/cache housekeeping — verifications/audit_logs are never auto-deleted. */
export async function runCleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY]
    );
    if (!rows[0]?.locked) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ level: "info", msg: "cleanup skipped: another instance holds the lock" }));
      return;
    }

    try {
      const now = new Date();
      const cacheExpiry = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sessionExpiry = new Date(now.getTime() - 24 * 60 * 60 * 1000); // §12: 期限切れから24時間

      await db
        .delete(verificationSessions)
        .where(
          or(
            and(isNotNull(verificationSessions.usedAt)),
            lt(verificationSessions.expiresAt, sessionExpiry)
          )
        );

      await db.delete(ipReputationCache).where(lt(ipReputationCache.fetchedAt, cacheExpiry));

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ level: "info", msg: "cleanup completed" }));
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

function msUntilNext0400JST(): number {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const next = new Date(jstNow);
  next.setHours(4, 0, 0, 0);
  if (next <= jstNow) next.setDate(next.getDate() + 1);
  return next.getTime() - jstNow.getTime();
}

/** §12: schedule the job for 04:00 JST daily. */
export function scheduleCleanupJob(): void {
  const delay = msUntilNext0400JST();
  setTimeout(function tick() {
    runCleanup().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ level: "error", msg: "cleanup job failed", error: String(err) }));
    });
    setInterval(() => {
      runCleanup().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({ level: "error", msg: "cleanup job failed", error: String(err) }));
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
}
