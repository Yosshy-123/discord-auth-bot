import { env } from "../config.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000; // §16

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * §4.3 #4, §13.1: verify a Turnstile token server-side. `idempotencyKey`
 * should be the session's public_id so a token can't be silently replayed
 * under a different idempotency key.
 */
export async function verifyTurnstile(
  token: string,
  remoteIp: string,
  idempotencyKey: string
): Promise<TurnstileResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
        idempotency_key: idempotencyKey,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { success: false, errorCodes: [`http_${res.status}`] };
    }

    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
      hostname?: string;
      action?: string;
      cdata?: string;
    };

    return {
      success: data.success === true,
      errorCodes: data["error-codes"] ?? [],
      hostname: data.hostname,
      action: data.action,
      cdata: data.cdata,
    };
  } catch (err) {
    return { success: false, errorCodes: ["network_error"] };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * §13.1: validate that the token was actually issued for THIS session
 * (hostname/action/cdata), not just that it's a valid token in general.
 */
export function turnstileMatchesSession(
  result: TurnstileResult,
  expectedHostname: string,
  expectedPublicId: string
): boolean {
  if (!result.success) return false;
  if (result.action !== "verify") return false;
  if (result.cdata !== expectedPublicId) return false;
  if (result.hostname && result.hostname !== expectedHostname) return false;
  return true;
}
