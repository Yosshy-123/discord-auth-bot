import { env } from "../config.js";

const TIMEOUT_MS = 5_000; // §16
const TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const REVOKE_URL = "https://discord.com/api/v10/oauth2/token/revoke";
const USERS_ME_URL = "https://discord.com/api/v10/users/@me";

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  email: string | null;
  verified: boolean | null;
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(t) };
}

/** §4.2 #5: exchange the authorization code for an access token. */
export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${env.BASE_URL}/auth/callback`,
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`token exchange failed: HTTP ${res.status}`);
    }
    return (await res.json()) as DiscordTokenResponse;
  } finally {
    clear();
  }
}

/** §4.2 #5: fetch identity + email/email_verified using the scoped access token. */
export async function fetchUsersMe(accessToken: string): Promise<DiscordUser> {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(USERS_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!res.ok) {
      throw new Error(`users/@me failed: HTTP ${res.status}`);
    }
    return (await res.json()) as DiscordUser;
  } finally {
    clear();
  }
}

/** §4.2 #5: best-effort revoke — the token is never persisted regardless. */
export async function revokeToken(accessToken: string): Promise<void> {
  const { signal, clear } = withTimeout();
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        token: accessToken,
      }),
      signal,
    });
  } catch {
    // best-effort per §4.2 #5 — ignore failures
  } finally {
    clear();
  }
}
