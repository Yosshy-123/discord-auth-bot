import "dotenv/config";

/**
 * §17: 必須7つ + 任意2つのみ。他の挙動分岐は環境変数にせず、コードで固定するか
 * /config パネル(guild_settings)で持つ。
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * DATA_ENC_KEYS format: "1:base64key32bytes,2:base64key32bytes"
 * The lowest-numbered... no — the LAST entry listed is treated as "current"
 * (used for new writes). All entries remain available for decrypting old data.
 * Simpler convention: first entry = current (§11.1 rotation).
 */
function parseDataEncKeys(raw: string): { current: number; keys: Map<number, Buffer> } {
  const keys = new Map<number, Buffer>();
  let current: number | null = null;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [idStr, b64] = trimmed.split(":");
    if (!idStr || !b64) {
      throw new Error(`Malformed DATA_ENC_KEYS entry: "${trimmed}"`);
    }
    const id = Number(idStr);
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`DATA_ENC_KEYS key_id must be an integer 0-255: "${idStr}"`);
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) {
      throw new Error(`DATA_ENC_KEYS key ${id} must decode to 32 bytes, got ${key.length}`);
    }
    keys.set(id, key);
    if (current === null) current = id; // first entry = current signing key
  }
  if (current === null || keys.size === 0) {
    throw new Error("DATA_ENC_KEYS must contain at least one key_id:base64key entry");
  }
  return { current, keys };
}

const dataEncKeys = parseDataEncKeys(required("DATA_ENC_KEYS"));

export const env = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  DISCORD_CLIENT_ID: required("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: required("DISCORD_CLIENT_SECRET"),
  BASE_URL: required("BASE_URL").replace(/\/+$/, ""),
  TURNSTILE_SITE_KEY: required("TURNSTILE_SITE_KEY"),
  TURNSTILE_SECRET_KEY: required("TURNSTILE_SECRET_KEY"),
  DATABASE_URL: required("DATABASE_URL"),
  STATE_HMAC_KEY: required("STATE_HMAC_KEY"),
  DATA_ENC_KEYS: dataEncKeys,
  PROXYCHECK_API_KEY: optional("PROXYCHECK_API_KEY"),
  PORT: Number(optional("PORT") ?? "3000"),
} as const;

if (env.STATE_HMAC_KEY.length < 32) {
  throw new Error("STATE_HMAC_KEY should be at least 32 bytes of random data");
}
if (!/^https:\/\//.test(env.BASE_URL)) {
  throw new Error("BASE_URL must start with https://");
}
