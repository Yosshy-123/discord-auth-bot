import { Hono } from "hono";
import { getCookie, deleteCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../server.js";
import { getClientIp } from "../ip.js";
import { callbackLimiter } from "../rateLimit.js";
import { verifyState } from "../state.js";
import { createSession, SESSION_COOKIE_MAX_AGE_SECONDS } from "../session.js";
import { exchangeCode, fetchUsersMe, revokeToken } from "../../lib/discordOAuth.js";
import { isGuildMember, fetchMember } from "../../discord/memberActions.js";
import {
  getGuildSettings,
  getVerification,
  upsertOauthDone,
  markRejectedNoCollection,
  recordAudit,
} from "../../db/repo.js";

export const callbackRoute = new Hono<AppEnv>();

callbackRoute.get("/callback", async (c) => {
  const ip = getClientIp(c) ?? "unknown";
  if (!callbackLimiter.consume(ip)) {
    return c.redirect("/error?code=E014", 302);
  }

  // §4.2 #4: OAuth denial
  if (c.req.query("error")) {
    return c.redirect("/error?code=E003", 302);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.redirect("/error?code=E001", 302);
  }

  // §4.2 #4: signature + expiry
  const verified = verifyState(state);
  if (!verified.ok) {
    return c.redirect("/error?code=E001", 302);
  }

  // §4.2 #4: Cookie nonce must match state's nonce
  const cookieNonce = getCookie(c, "__Host-vb_state");
  deleteCookie(c, "__Host-vb_state", { path: "/", secure: true });
  if (!cookieNonce || cookieNonce !== verified.payload.n) {
    return c.redirect("/error?code=E001", 302);
  }

  const guildId = verified.payload.g;
  const settings = await getGuildSettings(guildId);
  if (!settings?.verifyChannelId || !settings.verifiedRoleId) {
    return c.redirect("/error?code=E002", 302);
  }

  // §4.2 #5: token exchange -> users/@me -> revoke (best-effort). Access
  // token is never persisted.
  let userId: string;
  let discordUsername: string;
  let email: string | null;
  let emailVerified: boolean | null;
  try {
    const token = await exchangeCode(code);
    const user = await fetchUsersMe(token.access_token);
    await revokeToken(token.access_token);
    userId = user.id;
    discordUsername = user.global_name ?? user.username;
    email = user.email;
    emailVerified = user.verified;
  } catch {
    return c.redirect("/error?code=E004", 302);
  }

  // §4.2 #6: guild membership
  const isMember = await isGuildMember(guildId, userId);
  if (!isMember) {
    return c.redirect("/error?code=E005", 302);
  }

  // §4.2 #7: email required, no relaxation (§20)
  if (!email) {
    await upsertOauthDoneShell(guildId, userId, discordUsername, ip);
    await markRejectedNoCollection(guildId, userId, "EMAIL_MISSING");
    await recordAudit({ guildId, targetId: userId, action: "verify_rejected", detail: { code: "E006" } });
    return c.redirect("/error?code=E006", 302);
  }
  if (emailVerified === false) {
    await upsertOauthDoneShell(guildId, userId, discordUsername, ip, email, emailVerified);
    await markRejectedNoCollection(guildId, userId, "EMAIL_UNVERIFIED");
    await recordAudit({ guildId, targetId: userId, action: "verify_rejected", detail: { code: "E007" } });
    return c.redirect("/error?code=E007", 302);
  }

  // §4.2 #8: already verified AND currently holds the role -> short-circuit
  const existing = await getVerification(guildId, userId);
  if (existing?.status === "verified") {
    const member = await fetchMember(guildId, userId);
    if (member?.roles.cache.has(settings.verifiedRoleId)) {
      return c.redirect("/done?already=1", 302);
    }
  }

  // §4.2 #9: upsert oauth_done + create session
  await upsertOauthDone({
    guildId,
    userId,
    discordUsername,
    email,
    emailVerified,
    oauthIp: ip,
  });

  const session = await createSession(guildId, userId);
  setCookie(c, "__Host-vb_sess", session.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });

  return c.redirect("/verify", 302);
});

/** Helper so the E006/E007 paths still have a row to mark rejected against. */
async function upsertOauthDoneShell(
  guildId: string,
  userId: string,
  discordUsername: string,
  ip: string,
  email: string | null = null,
  emailVerified: boolean | null = null
): Promise<void> {
  await upsertOauthDone({ guildId, userId, discordUsername, email, emailVerified, oauthIp: ip });
}
