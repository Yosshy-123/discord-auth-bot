import {
  pgTable,
  text,
  timestamp,
  boolean,
  smallint,
  bigserial,
  jsonb,
  customType,
  primaryKey,
  index,
  check,
  uuid,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// bytea custom type (Drizzle has no first-class bytea helper)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * §11 guild_settings
 */
export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  verifyChannelId: text("verify_channel_id"),
  verifiedRoleId: text("verified_role_id"),
  unverifiedRoleId: text("unverified_role_id"),
  logChannelId: text("log_channel_id"),
  // block_targets TEXT[] CHECK (block_targets <@ ARRAY['tor','vpn','proxy'])
  blockTargets: text("block_targets")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  panelChannelId: text("panel_channel_id"),
  panelMessageId: text("panel_message_id"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "block_targets_valid",
    sql`${t.blockTargets} <@ ARRAY['tor','vpn','proxy']::text[]`
  ),
]);

/**
 * §11 verifications — status: oauth_done | rejected | verified
 */
export const verifications = pgTable("verifications", {
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  discordUsername: text("discord_username").notNull(),
  status: text("status").notNull().$type<"oauth_done" | "rejected" | "verified">(),
  emailEnc: bytea("email_enc"),
  emailVerified: boolean("email_verified"),
  oauthIpEnc: bytea("oauth_ip_enc"),
  ipEnc: bytea("ip_enc"),
  webrtcIpsEnc: bytea("webrtc_ips_enc"),
  webrtcStatus: text("webrtc_status"),
  uaServer: text("ua_server"),
  uaClient: text("ua_client"),
  riskFlags: text("risk_flags").array().notNull().default(sql`'{}'::text[]`),
  rejectReasons: text("reject_reasons").array().notNull().default(sql`'{}'::text[]`),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.guildId, t.userId] }),
  index("verifications_status_updated").on(t.status, t.updatedAt),
  check(
    "verifications_status_valid",
    sql`${t.status} IN ('oauth_done','rejected','verified')`
  ),
]);

/**
 * §11 verification_sessions
 */
export const verificationSessions = pgTable("verification_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: bytea("token_hash").notNull(),
  publicId: text("public_id").notNull(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  attempts: smallint("attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [
  index("verification_sessions_expires").on(t.expiresAt),
  index("verification_sessions_token_hash").on(t.tokenHash),
  index("verification_sessions_public_id").on(t.publicId),
  foreignKey({
    columns: [t.guildId, t.userId],
    foreignColumns: [verifications.guildId, verifications.userId],
    name: "verification_sessions_guild_user_fk",
  }).onDelete("cascade"),
]);

/**
 * §11 audit_logs
 */
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  guildId: text("guild_id").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  targetId: text("target_id"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_guild_created").on(t.guildId, t.createdAt),
]);

/**
 * §11 ip_reputation_cache — ip_hash = HMAC-SHA256(IP); raw IP never stored
 */
export const ipReputationCache = pgTable("ip_reputation_cache", {
  ipHash: bytea("ip_hash").primaryKey(),
  result: jsonb("result").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
