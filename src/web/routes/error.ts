import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import { renderErrorPage } from "../templates/pages.js";

export const errorRoute = new Hono<AppEnv>();

errorRoute.get("/", (c) => {
  const code = c.req.query("code") ?? "E013";
  const nonce = c.get("nonce");
  return c.html(renderErrorPage({ nonce, code }));
});
