import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import { renderDonePage } from "../templates/pages.js";

export const doneRoute = new Hono<AppEnv>();

doneRoute.get("/", (c) => {
  const already = c.req.query("already") === "1";
  const nonce = c.get("nonce");
  return c.html(renderDonePage({ nonce, alreadyVerified: already }));
});
