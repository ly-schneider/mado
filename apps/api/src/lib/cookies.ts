import type { CookieOptions, Request } from "express";
import { config } from "../config";

/** Origins the Tauri desktop app serves its bundle from (macOS/Linux and Windows). */
export const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

export function isDesktopOrigin(origin: string | undefined | null) {
  return !!origin && DESKTOP_ORIGINS.includes(origin);
}

/**
 * Session cookie options for this request. The desktop app calls the API cross-site
 * (tauri://localhost → https://server), which browsers only allow with SameSite=None; Secure.
 * Web and PWA are same-origin and keep Lax.
 */
export function cookieOptionsFor(req: Request): CookieOptions {
  const desktop = isDesktopOrigin(req.headers.origin);
  return {
    httpOnly: true,
    sameSite: desktop ? "none" : "lax",
    secure: desktop || !config.dev,
    path: "/",
    maxAge: config.sessionDays * 86_400_000,
  };
}
