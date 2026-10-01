import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../server.js";
import { getSessionByToken } from "../session.js";
import { renderVerifyPage, renderErrorPage } from "../templates/pages.js";
import { fetchMember } from "../../discord/memberActions.js";
import { client } from "../../discord/client.js";
import { env } from "../../config.js";

export const verifyRoute = new Hono<AppEnv>();

verifyRoute.get("/", async (c) => {
  const nonce = c.get("nonce");
  const token = getCookie(c, "__Host-vb_sess");
  if (!token) {
    return c.html(renderErrorPage({ nonce, code: "E008" }), 400);
  }

  const lookup = await getSessionByToken(token);
  if (!lookup.ok) {
    const code = lookup.reason === "locked" ? "E010" : "E008";
    return c.html(renderErrorPage({ nonce, code }), 400);
  }

  const { guildId, userId, publicId } = lookup.session;
  const guild = client.guilds.cache.get(guildId);
  const member = await fetchMember(guildId, userId);

  return c.html(
    renderVerifyPage({
      nonce,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      guildName: guild?.name ?? "このサーバー",
      discordUsername: member?.user.username ?? "unknown",
      discordAvatarUrl: member?.user.displayAvatarURL({ size: 64 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png",
      publicId,
    })
  );
});
