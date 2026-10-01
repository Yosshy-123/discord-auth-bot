import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ipReputationCache } from "../db/schema.js";
import { env } from "../config.js";
import { hmacIp } from "./crypto.js";

const TIMEOUT_MS = 3_000; // §7, §16
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // §7, §12

export type RiskFlag = "tor" | "vpn" | "proxy";

export interface IpReputationResult {
  flags: RiskFlag[];
  raw: unknown;
  /** true if the lookup itself failed (network/timeout/malformed response) */
  failed: boolean;
}

interface ProxycheckV3Entry {
  proxy?: "yes" | "no";
  type?: string; // "VPN" | "TOR" | "PUB" | ... (§7)
  risk?: number;
}

/** §7: maps a proxycheck.io response row to our tor/vpn/proxy flags. */
function mapToFlags(entry: ProxycheckV3Entry): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const type = (entry.type ?? "").toUpperCase();
  if (type === "TOR") {
    flags.push("tor");
  } else if (type === "VPN") {
    flags.push("vpn");
  } else if (entry.proxy === "yes") {
    flags.push("proxy");
  }
  return flags;
}

async function fetchFromProxycheck(ip: string): Promise<IpReputationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const url = new URL(`https://proxycheck.io/v3/${encodeURIComponent(ip)}`);
  url.searchParams.set("vpn", "3");
  url.searchParams.set("asn", "1");
  url.searchParams.set("risk", "1");
  if (env.PROXYCHECK_API_KEY) {
    url.searchParams.set("key", env.PROXYCHECK_API_KEY);
  }

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { flags: [], raw: { httpStatus: res.status }, failed: true };

    const data = (await res.json()) as Record<string, unknown>;
    if (data["status"] !== "ok" && data["status"] !== "warning") {
      return { flags: [], raw: data, failed: true };
    }
    const entry = data[ip] as ProxycheckV3Entry | undefined;
    if (!entry) return { flags: [], raw: data, failed: true };

    return { flags: mapToFlags(entry), raw: entry, failed: false };
  } catch {
    return { flags: [], raw: null, failed: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * §7: 24h-cached lookup keyed by HMAC(ip), never the raw IP. Cache is
 * only written on a *successful* lookup — a failed lookup should not
 * poison the cache with an empty "no risk" result.
 */
export async function lookupIpReputation(ip: string): Promise<IpReputationResult> {
  const ipHash = hmacIp(ip);

  const [cached] = await db
    .select()
    .from(ipReputationCache)
    .where(eq(ipReputationCache.ipHash, ipHash))
    .limit(1);

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    const raw = cached.result as { flags: RiskFlag[]; raw: unknown };
    return { flags: raw.flags, raw: raw.raw, failed: false };
  }

  const result = await fetchFromProxycheck(ip);
  if (!result.failed) {
    await db
      .insert(ipReputationCache)
      .values({ ipHash, result: { flags: result.flags, raw: result.raw } })
      .onConflictDoUpdate({
        target: ipReputationCache.ipHash,
        set: { result: { flags: result.flags, raw: result.raw }, fetchedAt: sql`now()` },
      });
  }
  return result;
}
