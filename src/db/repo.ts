import { eq, and } from "drizzle-orm";
import { db } from "./client.js";
import { guildSettings, verifications, auditLogs } from "./schema.js";
import { encryptField, decryptField } from "../lib/crypto.js";
import type { RiskFlag } from "../lib/proxycheck.js";

export type GuildSettings = typeof guildSettings.$inferSelect;
export type Verification = typeof verifications.$inferSelect;

export async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const [row] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  return row ?? null;
}

/** §8.2: required fields present + bot still knows this guild. */
export function isConfigComplete(settings: GuildSettings | null): boolean {
  return !!settings && !!settings.verifyChannelId && !!settings.verifiedRoleId;
}

export interface GuildSettingsPatch {
  verifyChannelId?: string | null;
  verifiedRoleId?: string | null;
  unverifiedRoleId?: string | null;
  logChannelId?: string | null;
  blockTargets?: RiskFlag[];
  panelChannelId?: string | null;
  panelMessageId?: string | null;
  updatedBy?: string;
}

/** §8.2 保存: 一括upsert */
export async function upsertGuildSettings(guildId: string, patch: GuildSettingsPatch): Promise<void> {
  await db
    .insert(guildSettings)
    .values({ guildId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function getVerification(guildId: string, userId: string): Promise<Verification | null> {
  const [row] = await db
    .select()
    .from(verifications)
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface OauthDoneInput {
  guildId: string;
  userId: string;
  discordUsername: string;
  email: string | null;
  emailVerified: boolean | null;
  oauthIp: string;
}

/** §4.2 #9: upsert to oauth_done, clearing any previously collected data. */
export async function upsertOauthDone(input: OauthDoneInput): Promise<void> {
  const { guildId, userId } = input;
  const emailEnc = input.email
    ? encryptField(input.email, "verifications.email_enc", guildId, userId)
    : null;
  const oauthIpEnc = encryptField(input.oauthIp, "verifications.oauth_ip_enc", guildId, userId);

  const values = {
    guildId,
    userId,
    discordUsername: input.discordUsername,
    status: "oauth_done" as const,
    emailEnc,
    emailVerified: input.emailVerified,
    oauthIpEnc,
    // clear previously-collected data on a fresh OAuth run (§4.2 #9)
    ipEnc: null,
    webrtcIpsEnc: null,
    webrtcStatus: null,
    uaServer: null,
    uaClient: null,
    riskFlags: [],
    rejectReasons: [],
    lastError: null,
    updatedAt: new Date(),
  };

  await db
    .insert(verifications)
    .values(values)
    .onConflictDoUpdate({ target: [verifications.guildId, verifications.userId], set: values });
}

/** §4.2 #7 E006/E007: reject before any collection step (no email, or unverified email). */
export async function markRejectedNoCollection(
  guildId: string,
  userId: string,
  reason: "EMAIL_MISSING" | "EMAIL_UNVERIFIED"
): Promise<void> {
  await db
    .update(verifications)
    .set({ status: "rejected", rejectReasons: [reason], updatedAt: new Date() })
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

export interface CollectedData {
  ip: string;
  webrtcIps: string[];
  webrtcStatus: string;
  uaServer: string;
  uaClient: string;
  /** §6.2: tor/vpn/proxy plus reference-only flags (webrtc_mismatch, ua_mismatch, ipcheck_failed, ...). */
  riskFlags: string[];
}

/** §4.3 #8: persist collected IP/UA/WebRTC + risk flags (encrypted where applicable). */
export async function saveCollectedData(guildId: string, userId: string, data: CollectedData): Promise<void> {
  await db
    .update(verifications)
    .set({
      ipEnc: encryptField(data.ip, "verifications.ip_enc", guildId, userId),
      webrtcIpsEnc:
        data.webrtcIps.length > 0
          ? encryptField(JSON.stringify(data.webrtcIps), "verifications.webrtc_ips_enc", guildId, userId)
          : null,
      webrtcStatus: data.webrtcStatus,
      uaServer: data.uaServer.slice(0, 512),
      uaClient: data.uaClient.slice(0, 512),
      riskFlags: data.riskFlags,
      updatedAt: new Date(),
    })
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

/** §4.3 #9: blocked by VPN/Proxy/Tor policy. */
export async function markRejectedBlocked(guildId: string, userId: string, reasons: RiskFlag[]): Promise<void> {
  await db
    .update(verifications)
    .set({ status: "rejected", rejectReasons: reasons, updatedAt: new Date() })
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

/** §4.3 #11: role assignment succeeded — mark verified. */
export async function markVerified(guildId: string, userId: string): Promise<void> {
  await db
    .update(verifications)
    .set({ status: "verified", verifiedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

/** §4.3 #11: role assignment failed (E012) — stays oauth_done with an error note. */
export async function markRoleAssignFailed(guildId: string, userId: string): Promise<void> {
  await db
    .update(verifications)
    .set({ lastError: "ROLE_ASSIGN_FAILED", updatedAt: new Date() })
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

export async function deleteVerification(guildId: string, userId: string): Promise<void> {
  await db
    .delete(verifications)
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId)));
}

/** Decrypted view for /userinfo (§8.4) — call only from an authorized command handler. */
export interface DecryptedVerification {
  status: Verification["status"];
  discordUsername: string;
  email: string | null;
  emailVerified: boolean | null;
  oauthIp: string | null;
  ip: string | null;
  webrtcIps: string[] | null;
  webrtcStatus: string | null;
  uaServer: string | null;
  uaClient: string | null;
  riskFlags: string[];
  rejectReasons: string[];
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  verifiedAt: Date | null;
}

export function decryptVerification(v: Verification): DecryptedVerification {
  const { guildId, userId } = v;
  return {
    status: v.status,
    discordUsername: v.discordUsername,
    email: v.emailEnc ? decryptField(v.emailEnc, "verifications.email_enc", guildId, userId) : null,
    emailVerified: v.emailVerified,
    oauthIp: v.oauthIpEnc ? decryptField(v.oauthIpEnc, "verifications.oauth_ip_enc", guildId, userId) : null,
    ip: v.ipEnc ? decryptField(v.ipEnc, "verifications.ip_enc", guildId, userId) : null,
    webrtcIps: v.webrtcIpsEnc
      ? JSON.parse(decryptField(v.webrtcIpsEnc, "verifications.webrtc_ips_enc", guildId, userId))
      : null,
    webrtcStatus: v.webrtcStatus,
    uaServer: v.uaServer,
    uaClient: v.uaClient,
    riskFlags: v.riskFlags,
    rejectReasons: v.rejectReasons,
    lastError: v.lastError,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    verifiedAt: v.verifiedAt,
  };
}

export async function recordAudit(entry: {
  guildId: string;
  actorId?: string | null;
  action: string;
  targetId?: string | null;
  detail?: unknown;
}): Promise<void> {
  await db.insert(auditLogs).values({
    guildId: entry.guildId,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetId: entry.targetId ?? null,
    detail: entry.detail ?? null,
  });
}
