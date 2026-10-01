import type { Context } from "hono";
import { isIP } from "node:net";

/**
 * §5.2: connecting IP is always taken from CF-Connecting-IP. The Tunnel
 * deployment (§5.3) means the app has no reachable path that bypasses
 * Cloudflare, so this header cannot be spoofed by an external client.
 */
export function getClientIp(c: Context): string | null {
  const header = c.req.header("CF-Connecting-IP");
  if (!header) return null;
  const ip = header.trim();
  if (isIP(ip) === 0) return null;
  // Normalize IPv4-mapped IPv6 (::ffff:a.b.c.d) to plain IPv4 (§6 table).
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return mapped ? mapped[1]! : ip;
}
