import { Hono } from "hono";
import type { AppEnv } from "../server.js";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/", (c) => c.json({ ok: true }));
