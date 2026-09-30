/**
 * Connects component actions to boxd.
 *
 * The component runs in Convex's default JavaScript runtime, so it uses the
 * SDK's `@boxd-sh/sdk/web` entry: grpc-web over `fetch`, no Node built-ins.
 *
 * The API key comes from the component's own env (`BOXD_API_KEY`, bound by
 * the app in `app.use`), so it never travels as a function argument. The SDK
 * could exchange the key for a session token itself, but it would do so once
 * per action: an SDK client lives only as long as the action. boxd
 * rate-limits the exchange per source IP, and Convex deployments share their
 * egress IPs. So the component exchanges the key once, caches the token in
 * its `sessions` table, and hands the SDK the token.
 */

import { Boxd } from "@boxd-sh/sdk/web";
import { internal } from "./_generated/api.js";
import { env, type ActionCtx } from "./_generated/server.js";
import { boxdError, toConvexError } from "./errors.js";

/** boxd production. `BOXD_BASE_URL` points the component anywhere else. */
export const DEFAULT_BASE_URL = "https://boxd.sh:9443";

const EXCHANGE_PATH = "/api/v1/auth/token";

/** Exchange again this long before the cached token expires. */
const REFRESH_SKEW_MS = 5 * 60_000;

type Session = { token: string; expiresAt: number };

/**
 * The console origin that serves the key exchange: `https://app.<zone>` for a
 * cluster zone, or the endpoint's own origin for a local, IP or `app.` host.
 * Mirrors `consoleBaseUrl` in `@boxd-sh/sdk`, which the SDK doesn't export.
 */
export function exchangeUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  const scheme = /^https?:\/\//.exec(trimmed)?.[0];
  const local = /^(localhost|127\.)/.test(trimmed.slice(scheme?.length ?? 0));
  // No scheme: pick the one the SDK would dial, plain HTTP for a local host.
  const url = new URL(
    scheme ? trimmed : `${local ? "http" : "https"}://${trimmed}`,
  );
  const host = url.hostname;
  const sameOrigin =
    host === "localhost" ||
    host.startsWith("[") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("app.");
  const origin = sameOrigin ? url.origin : `https://app.${host}`;
  return `${origin}${EXCHANGE_PATH}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function exchange(apiKey: string, baseURL: string): Promise<Session> {
  const url = exchangeUrl(baseURL);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
  } catch (error) {
    throw boxdError(
      "UNAVAILABLE",
      `could not reach ${url} to exchange BOXD_API_KEY: ${String(error)}`,
    );
  }
  if (response.status === 401) {
    throw boxdError(
      "UNAUTHENTICATED",
      "boxd rejected BOXD_API_KEY: it is invalid, expired or revoked. " +
        "Create a new key with `boxd auth keys create <name>` and set it with " +
        "`npx convex env set BOXD_API_KEY <key>`.",
    );
  }
  if (response.status === 429) {
    throw boxdError(
      "RATE_LIMITED",
      "boxd rate-limited the API key exchange. Retry after a minute.",
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw boxdError(
      response.status >= 500 ? "UNAVAILABLE" : "BOXD_ERROR",
      `boxd API key exchange failed with ${response.status}: ${detail.slice(0, 500)}`,
    );
  }
  const body = (await response.json()) as {
    token?: unknown;
    expires_at?: unknown;
  };
  if (typeof body.token !== "string" || typeof body.expires_at !== "number") {
    throw boxdError(
      "BOXD_ERROR",
      "boxd API key exchange returned a malformed response",
    );
  }
  return { token: body.token, expiresAt: body.expires_at * 1000 };
}

function config(): { apiKey: string; baseURL: string } {
  // Read inside the handler: component env only exists at runtime.
  const apiKey = env.BOXD_API_KEY?.trim();
  if (!apiKey) {
    throw boxdError(
      "UNAUTHENTICATED",
      "BOXD_API_KEY is empty. Set it with `npx convex env set BOXD_API_KEY <key>` " +
        "and bind it in convex.config.ts: " +
        "`app.use(boxd, { env: { BOXD_API_KEY: app.env.BOXD_API_KEY } })`.",
    );
  }
  const baseURL = env.BOXD_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return { apiKey, baseURL };
}

async function session(
  ctx: ActionCtx,
  keyHash: string,
  apiKey: string,
  baseURL: string,
): Promise<{ session: Session; cached: boolean }> {
  const cached = await ctx.runQuery(internal.sessions.get, { keyHash });
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return { session: cached, cached: true };
  }
  let fresh: Session;
  try {
    fresh = await exchange(apiKey, baseURL);
  } catch (error) {
    // Many actions can reach the refresh margin at once, and boxd
    // rate-limits the exchange. A token that has not expired yet still
    // works, so fall back to it rather than fail the call.
    if (cached && cached.expiresAt > Date.now()) {
      return { session: cached, cached: true };
    }
    throw error;
  }
  await ctx.runMutation(internal.sessions.put, { keyHash, ...fresh });
  return { session: fresh, cached: false };
}

/**
 * Run `operation` with an authenticated SDK client, and turn whatever it
 * throws into a coded `ConvexError`.
 *
 * A cached token can be revoked before it expires. If boxd rejects a cached
 * token, the token is dropped, the key is exchanged again, and `operation`
 * runs once more. That retry is safe for every operation, including create:
 * boxd refuses an unauthenticated request before it does anything.
 */
export async function withBoxd<T>(
  ctx: ActionCtx,
  operation: (boxd: Boxd) => Promise<T>,
): Promise<T> {
  const { apiKey, baseURL } = config();
  const keyHash = await sha256Hex(`${baseURL}\n${apiKey}`);
  const first = await session(ctx, keyHash, apiKey, baseURL);
  try {
    return await operation(new Boxd({ token: first.session.token, baseURL }));
  } catch (error) {
    const converted = toConvexError(error);
    if (!first.cached || converted.data.code !== "UNAUTHENTICATED") {
      throw converted;
    }
    await ctx.runMutation(internal.sessions.drop, {
      keyHash,
      token: first.session.token,
    });
  }
  const retry = await session(ctx, keyHash, apiKey, baseURL);
  try {
    return await operation(new Boxd({ token: retry.session.token, baseURL }));
  } catch (error) {
    throw toConvexError(error);
  }
}
