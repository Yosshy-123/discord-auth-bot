import { createCipheriv, createDecipheriv, randomBytes, createHmac, createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config.js";

/**
 * §11.1 暗号化
 * 保存形式: key_id(1B) || nonce(12B) || ciphertext || tag(16B)
 * AAD: "table.column" + guild_id + user_id
 */
function buildAad(tableColumn: string, guildId: string, userId: string): Buffer {
  return Buffer.from(`${tableColumn}\u0000${guildId}\u0000${userId}`, "utf8");
}

export function encryptField(
  plaintext: string,
  tableColumn: string,
  guildId: string,
  userId: string
): Buffer {
  const keyId = env.DATA_ENC_KEYS.current;
  const key = env.DATA_ENC_KEYS.keys.get(keyId);
  if (!key) throw new Error(`Unknown current key_id ${keyId}`);

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(buildAad(tableColumn, guildId, userId));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return Buffer.concat([Buffer.from([keyId]), nonce, ciphertext, tag]);
}

export function decryptField(
  blob: Buffer,
  tableColumn: string,
  guildId: string,
  userId: string
): string {
  if (blob.length < 1 + 12 + 16) throw new Error("Encrypted blob too short");

  const keyId = blob[0]!;
  const nonce = blob.subarray(1, 13);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(13, blob.length - 16);

  const key = env.DATA_ENC_KEYS.keys.get(keyId);
  if (!key) throw new Error(`Unknown key_id ${keyId} — key not available for decryption`);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(buildAad(tableColumn, guildId, userId));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** §7, §12: HMAC-SHA256(IP) used as a cache key so raw IPs never sit in ip_reputation_cache. */
export function hmacIp(ip: string): Buffer {
  const keyId = env.DATA_ENC_KEYS.current;
  const key = env.DATA_ENC_KEYS.keys.get(keyId)!;
  return createHmac("sha256", key).update(ip, "utf8").digest();
}

/** Random URL-safe token, e.g. session tokens / nonces. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hash, used for storing only a hash of session tokens (§4.2 #9). */
export function sha256(input: string | Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

/** Constant-time byte comparison, e.g. for state-signature / nonce checks (§13.1). */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
