import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export const MCP_RESOURCE = `${config.publicUrl}/mcp`;
export const RESOURCE_METADATA_URL = `${config.publicUrl}/.well-known/oauth-protected-resource`;

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Public clients may redirect to https anywhere, or to http on loopback only. */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

/**
 * Exact string match, except that loopback redirects may use any port (RFC 8252 §7.3), because
 * native clients like Claude Code bind an ephemeral port per login.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    if (a.protocol !== "http:" || !LOOPBACK.has(a.hostname)) return false;
    return a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** Accepts the MCP endpoint with or without a trailing slash, and the bare origin. */
export function isOurResource(resource: string | undefined | null): boolean {
  if (!resource) return true;
  const r = resource.replace(/\/$/, "");
  return r === MCP_RESOURCE || r === config.publicUrl;
}

export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const m = value?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? null;
}

export function wwwAuthenticate(error?: { code: string; description: string }) {
  const parts = [`Bearer resource_metadata="${RESOURCE_METADATA_URL}"`, `scope="mcp"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}
