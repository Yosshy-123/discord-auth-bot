import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { verificationSessions } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";

const SESSION_TTL_SECONDS = 15 * 60; // 15分 (§4.2 #9, §1.3)
const MAX_ATTEMPTS = 5; // §4.3 #1, §13.3
const LOCK_MINUTES = 10; // §4.5 E010

export interface NewSession {
  token: string; // raw value — goes in the Cookie, never stored
  publicId: string; // sent to Turnstile as cdata, safe to expose to the client (§4.2 #11)
}

/** §4.2 #9: create a session right after OAuth succeeds. */
export async function createSession(guildId: string, userId: string): Promise<NewSession> {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const publicId = randomToken(16);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(verificationSessions).values({
    tokenHash,
    publicId,
    guildId,
    userId,
    expiresAt,
  });

  return { token, publicId };
}

export type SessionLookup =
  | { ok: true; session: typeof verificationSessions.$inferSelect }
  | { ok: false; reason: "not_found" | "expired" | "used" | "locked" };

/** §4.2 #10, §4.3 #1: resolve the Cookie token to a live session row. */
export async function getSessionByToken(token: string): Promise<SessionLookup> {
  const tokenHash = sha256(token);
  const [row] = await db
    .select()
    .from(verificationSessions)
    .where(eq(verificationSessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, reason: "locked" };
  }
  return { ok: true, session: row };
}

/** §4.3 #2: increment attempts; §4.5 E010: lock after MAX_ATTEMPTS. */
export async function bumpAttempts(sessionId: string): Promise<{ attempts: number; locked: boolean }> {
  const [row] = await db
    .update(verificationSessions)
    .set({ attempts: sql`${verificationSessions.attempts} + 1` })
    .where(eq(verificationSessions.id, sessionId))
    .returning({ attempts: verificationSessions.attempts });

  const attempts = row?.attempts ?? MAX_ATTEMPTS;
  if (attempts >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    await db
      .update(verificationSessions)
      .set({ lockedUntil })
      .where(eq(verificationSessions.id, sessionId));
    return { attempts, locked: true };
  }
  return { attempts, locked: false };
}

/** §4.2 #13, §4.3 #9-#11: close a session so it can't be replayed. */
export async function closeSession(sessionId: string): Promise<void> {
  await db
    .update(verificationSessions)
    .set({ usedAt: new Date() })
    .where(and(eq(verificationSessions.id, sessionId), sql`${verificationSessions.usedAt} IS NULL`));
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
export const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10分 (§4.2 #2)
