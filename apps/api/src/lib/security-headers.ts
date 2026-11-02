import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

// Styles stay 'unsafe-inline': React style props and CodeMirror set inline styles. Scripts don't need it.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HEADERS: [string, string][] = [
  ["Content-Security-Policy", CSP],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "same-origin"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
];
if (config.publicUrl.startsWith("https://")) HEADERS.push(["Strict-Transport-Security", "max-age=31536000"]);

/** Sent on every response, so a plain proxy in front is enough to expose mado safely. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  for (const [name, value] of HEADERS) res.setHeader(name, value);
  next();
}
