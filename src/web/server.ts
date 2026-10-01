import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { startRoute } from "./routes/start.js";
import { callbackRoute } from "./routes/callback.js";
import { verifyRoute } from "./routes/verify.js";
import { collectRoute } from "./routes/collect.js";
import { doneRoute } from "./routes/done.js";
import { errorRoute } from "./routes/error.js";
import { healthRoute } from "./routes/health.js";

export type AppEnv = { Variables: { nonce: string } };

export const app = new Hono<AppEnv>();

// §13.2: security headers on every response, CSP nonce generated per request.
app.use("*", async (c, next) => {
  const nonce = randomBytes(16).toString("base64");
  c.set("nonce", nonce);
  await next();

  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; ` +
      `frame-src https://challenges.cloudflare.com; connect-src 'self'; ` +
      `img-src 'self' https://cdn.discordapp.com data:; style-src 'nonce-${nonce}'; ` +
      `base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// §13.2: no caching on the verification pages / API.
app.use("/verify", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.route("/start", startRoute);
app.route("/auth", callbackRoute);
app.route("/verify", verifyRoute);
app.route("/api/verify", collectRoute);
app.route("/done", doneRoute);
app.route("/error", errorRoute);
app.route("/healthz", healthRoute);

app.notFound((c) => c.text("Not Found", 404));
