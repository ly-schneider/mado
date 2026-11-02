function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

const dev = process.env.NODE_ENV !== "production";

/** Express "trust proxy": a hop count, true/false, or a comma-separated list of addresses, CIDRs and presets. */
function trustProxy(value: string): boolean | number | string {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

export const config = {
  dev,
  port: Number(env("PORT", "4100")),
  /** Interface to listen on. 127.0.0.1 keeps a non-container install reachable only through a local proxy. */
  host: env("HOST", "0.0.0.0"),
  /** Public origin of the app, e.g. https://mado.example.ch. Used for OAuth metadata, share and invite links. */
  publicUrl: env("PUBLIC_URL", dev ? `http://localhost:${process.env.PORT ?? "4100"}` : undefined).replace(/\/$/, ""),
  /** Vite dev server; the API redirects SPA routes there in dev. */
  webDevUrl: process.env.WEB_DEV_URL ?? (dev ? "http://localhost:5173" : null),
  databaseUrl: env("DATABASE_URL", dev ? "postgres://mado_app:mado@localhost:5442/mado" : undefined),
  /** Separate role with DELETE rights. Only the purge path uses it. */
  purgeDatabaseUrl: env("DATABASE_PURGE_URL", dev ? "postgres://mado_purge:mado@localhost:5442/mado" : undefined),
  /** 32+ chars. Encrypts secrets at rest (OpenRouter key, webhook secrets, share tokens). */
  secretKey: env("MADO_SECRET_KEY", dev ? "dev-only-secret-key-change-me-0123456789" : undefined),
  webDist: process.env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname,
  /** Set at image build time by the release workflow. */
  version: process.env.APP_VERSION || "dev",
  sessionDays: 60,
  /** Which peers may set X-Forwarded-For. The default fits a proxy on the same host or Docker network. */
  trustProxy: trustProxy(process.env.TRUST_PROXY || "loopback, uniquelocal"),
  /** Header a trusted proxy puts the real client IP in, e.g. CF-Connecting-IP. Lowercased for lookup. */
  clientIpHeader: process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || null,
  /** Fixed first-run setup token for automated installs. Without it a random one is printed to the log. */
  setupToken: process.env.MADO_SETUP_TOKEN || null,
};
