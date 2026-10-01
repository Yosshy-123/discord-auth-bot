import { createHmac } from "node:crypto";
import { env } from "../config.js";
import { constantTimeEqual } from "../lib/crypto.js";

export interface StatePayload {
  g: string; // guildId
  n: string; // nonce (matches the __Host-vb_state cookie value)
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds (+10 min, §4.2 #2)
}

function sign(data: string): string {
  return createHmac("sha256", env.STATE_HMAC_KEY).update(data).digest("base64url");
}

/** §4.2 #2: state = base64url(payload).base64url(HMAC-SHA256) */
export function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export type StateVerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/** §4.2 #4: signature (constant-time), then expiry. Cookie-nonce match happens in the caller. */
export function verifyState(state: string): StateVerifyResult {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;

  const expectedSig = sign(body);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (!constantTimeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.g !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
