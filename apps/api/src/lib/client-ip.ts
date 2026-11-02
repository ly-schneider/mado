import type { Request } from "express";
import { isIP } from "node:net";
import { config } from "../config";

const unmapped = (ip: string) => (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

/**
 * The client's address. CLIENT_IP_HEADER (e.g. CF-Connecting-IP) wins, but only on a request that
 * arrives from a trusted proxy; anyone else could just send the header themselves.
 */
export function clientIp(req: Request): string | null {
  if (config.clientIpHeader) {
    const peer = req.socket.remoteAddress;
    const trusted = req.app.get("trust proxy fn") as (addr: string, hop: number) => boolean;
    const raw = req.headers[config.clientIpHeader];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
    if (peer && value && isIP(value) && trusted(peer, 0)) return unmapped(value);
  }
  return req.ip ? unmapped(req.ip) : null;
}
