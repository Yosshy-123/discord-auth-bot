import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { isIP } from "node:net";
import type { AppEnv } from "../server.js";
import { getClientIp } from "../ip.js";
import { collectLimiter } from "../rateLimit.js";
import { getSessionByToken, bumpAttempts, closeSession } from "../session.js";
import { turnstileMatchesSession, verifyTurnstile } from "../../lib/turnstile.js";
import { lookupIpReputation, type RiskFlag } from "../../lib/proxycheck.js";
import {
  getGuildSettings,
  saveCollectedData,
  markRejectedBlocked,
  markVerified,
  markRoleAssignFailed,
  recordAudit,
} from "../../db/repo.js";
import { assignRole, removeRoleBestEffort } from "../../discord/memberActions.js";
import { logVerifySuccess, logVerifyRejected, logVerifyError } from "../../discord/logChannel.js";
import { env } from "../../config.js";

export const collectRoute = new Hono<AppEnv>();

const WEBRTC_STATUSES = new Set(["ok", "mdns_only", "blocked", "timeout", "unsupported"]);

collectRoute.post("/collect", async (c) => {
  // §4.3 #1: Origin check
  const origin = c.req.header("Origin");
  if (origin && origin !== env.BASE_URL) {
    return c.json({ ok: false, code: "E008" }, 403);
  }

  const ip = getClientIp(c) ?? "unknown";
  if (!collectLimiter.consume(ip)) {
    return c.json({ ok: false, code: "E014" }, 429);
  }

  const token = getCookie(c, "__Host-vb_sess");
  if (!token) return c.json({ ok: false, code: "E008" }, 400);

  const lookup = await getSessionByToken(token);
  if (!lookup.ok) {
    const code = lookup.reason === "locked" ? "E010" : "E008";
    return c.json({ ok: false, code }, 400);
  }
  const session = lookup.session;
  const { guildId, userId, publicId } = session;

  // §4.3 #2
  const { locked } = await bumpAttempts(session.id);
  if (locked) {
    return c.json({ ok: false, code: "E010" }, 400);
  }

  const settings = await getGuildSettings(guildId);
  if (!settings?.verifyChannelId || !settings.verifiedRoleId) {
    return c.json({ ok: false, code: "E002" }, 400);
  }

  // §4.3 #3
  const connIp = getClientIp(c);
  if (!connIp) {
    return c.json({ ok: false, code: "E013" }, 400);
  }

  // request body
  let body: {
    turnstileToken?: unknown;
    webrtcIps?: unknown;
    webrtcStatus?: unknown;
    uaClient?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: "E013" }, 400);
  }

  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : null;
  if (!turnstileToken) {
    return c.json({ ok: false, code: "E009" }, 400);
  }

  // §4.3 #4: Turnstile verification (BASE_URL host used as the expected hostname)
  const expectedHostname = new URL(env.BASE_URL).hostname;
  const tsResult = await verifyTurnstile(turnstileToken, connIp, publicId);
  if (!turnstileMatchesSession(tsResult, expectedHostname, publicId)) {
    return c.json({ ok: false, code: "E009" }, 400);
  }

  // §4.3 #5: normalize UA / WebRTC IPs
  const uaServer = (c.req.header("User-Agent") ?? "").slice(0, 512);
  const uaClient = (typeof body.uaClient === "string" ? body.uaClient : "").slice(0, 512);

  const rawWebrtcIps = Array.isArray(body.webrtcIps) ? body.webrtcIps : [];
  const webrtcIps = rawWebrtcIps
    .filter((v): v is string => typeof v === "string")
    .filter((v) => isIP(v) !== 0)
    .slice(0, 8);

  const webrtcStatus =
    typeof body.webrtcStatus === "string" && WEBRTC_STATUSES.has(body.webrtcStatus)
      ? body.webrtcStatus
      : webrtcIps.length > 0
        ? "ok"
        : "unsupported";

  // §4.3 #6: proxycheck.io lookup (Tor/VPN/Proxy in one call)
  const reputation = await lookupIpReputation(connIp);

  // §6.2 risk flags — only tor/vpn/proxy participate in the block decision;
  // the rest (webrtc_mismatch, ua_mismatch, ip_changed, ipcheck_failed) are
  // reference-only and never cause a rejection by themselves.
  const riskFlags: string[] = [...reputation.flags];
  if (reputation.failed) riskFlags.push("ipcheck_failed");
  if (webrtcIps.length > 0 && !webrtcIps.includes(connIp)) riskFlags.push("webrtc_mismatch");
  if (session.userId && uaServer && uaClient && uaServer !== uaClient) riskFlags.push("ua_mismatch");

  // §4.3 #7: decide block based on block_targets ∩ detected flags
  // fail-open (§7, §20): a failed reputation lookup never blocks.
  const blockTargets = settings.blockTargets as RiskFlag[];
  const matchedBlocks = reputation.failed
    ? []
    : reputation.flags.filter((f) => blockTargets.includes(f));

  // §4.3 #8: persist collected data regardless of the outcome
  await saveCollectedData(guildId, userId, {
    ip: connIp,
    webrtcIps,
    webrtcStatus,
    uaServer,
    uaClient,
    riskFlags,
  });

  if (matchedBlocks.length > 0) {
    // §4.3 #9
    await markRejectedBlocked(guildId, userId, matchedBlocks);
    await closeSession(session.id);
    await recordAudit({ guildId, targetId: userId, action: "verify_rejected", detail: { blocked: matchedBlocks } });
    await logVerifyRejected(guildId, userId, matchedBlocks);
    return c.json({ ok: false, code: "E011" }, 400);
  }

  // §4.3 #10: allow — assign verified role, best-effort remove unverified role
  const assigned = await assignRole(guildId, userId, settings.verifiedRoleId);
  if (settings.unverifiedRoleId) {
    await removeRoleBestEffort(guildId, userId, settings.unverifiedRoleId);
  }

  if (!assigned) {
    // §4.3 #11 failure path
    await markRoleAssignFailed(guildId, userId);
    await recordAudit({ guildId, targetId: userId, action: "verify_error", detail: { code: "E012" } });
    await logVerifyError(guildId, userId, "E012", "role assign failed");
    return c.json({ ok: false, code: "E012" }, 500);
  }

  // §4.3 #11 success path
  await markVerified(guildId, userId);
  await closeSession(session.id);
  deleteCookie(c, "__Host-vb_sess", { path: "/", secure: true });

  // §4.3 #12
  await recordAudit({ guildId, targetId: userId, action: "verify_success", detail: { riskFlags } });
  await logVerifySuccess(guildId, userId, riskFlags);

  return c.json({ ok: true, next: "/done" });
});
