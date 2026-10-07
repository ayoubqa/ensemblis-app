// The real client IP (rate limits, guest-trial limits, Turnstile).
//
// On Render, `req.ip` (with TRUST_PROXY=1) is the address of one of Render's
// own proxies, shared by every visitor — so per-IP limits would be shared by
// everybody (5 sign-ups/hour or 2 guest trials/day for the WHOLE site). When
// config.clientIpHeaders is set (default on Render), the first header holding
// a single valid IP wins; otherwise `req.ip` is used.

import net from "node:net";
import type { Request } from "express";
import { config } from "../config";
import { parseIPv6 } from "../research/netGuard";

export function clientIp(req: Request): string {
  for (const name of config.clientIpHeaders) {
    const raw = req.headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    // A single address only: a comma-separated list means it was forwarded/appended.
    if (value && net.isIP(value)) return value;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Key for per-network limits: the IPv4 address, or the /64 prefix of an IPv6
 * address (one household/phone usually owns a whole /64, so keying on the full
 * address would let a single visitor rotate through unlimited "IPs").
 */
export function ipKey(ip: string): string {
  if (net.isIP(ip) !== 6) return ip;
  const g = parseIPv6(ip);
  if (!g) return ip;
  // IPv4-mapped (::ffff:a.b.c.d) is really an IPv4 client.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

export function clientIpKey(req: Request): string {
  return ipKey(clientIp(req));
}
