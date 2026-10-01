import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import type { AppEnv } from "../server.js";
import { getClientIp } from "../ip.js";
import { startLimiter } from "../rateLimit.js";
import { signState } from "../state.js";
import { STATE_COOKIE_MAX_AGE_SECONDS } from "../session.js";
import { getGuildSettings, isConfigComplete } from "../../db/repo.js";
import { client } from "../../discord/client.js";
import { env } from "../../config.js";

export const startRoute = new Hono<AppEnv>();

const GUILD_ID_RE = /^\d{17,20}$/;

startRoute.get("/:guildId", async (c) => {
  const guildId = c.req.param("guildId");
  const ip = getClientIp(c) ?? "unknown";

  if (!startLimiter.consume(ip)) {
    return c.redirect(`/error?code=E014`, 302);
  }

  // (a) guildId format
  if (!GUILD_ID_RE.test(guildId)) {
    return c.redirect(`/error?code=E002`, 302);
  }

  // (b) guild_settings exists, required fields set, bot still in the guild
  const settings = await getGuildSettings(guildId);
  if (!isConfigComplete(settings)) {
    return c.redirect(`/error?code=E002`, 302);
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return c.redirect(`/error?code=E002`, 302);
  }

  // (c) nonce
  const nonce = randomBytes(32).toString("base64url");

  // (d) state = base64url(payload).base64url(HMAC-SHA256)
  const now = Math.floor(Date.now() / 1000);
  const state = signState({ g: guildId, n: nonce, iat: now, exp: now + 600 });

  // (e) Cookie __Host-vb_state
  setCookie(c, "__Host-vb_state", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });

  // (f) 302 to Discord's authorize URL
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", `${env.BASE_URL}/auth/callback`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "none");

  return c.redirect(authorizeUrl.toString(), 302);
});
