// Network guard for server-side URL fetching (link attachments). Decides
// whether an IP address is a public, globally routable unicast address — the
// only kind the server may connect to on a user's behalf. Everything else
// (loopback, private, link-local incl. the cloud metadata endpoint
// 169.254.169.254, CGNAT, multicast, documentation/reserved ranges and their
// IPv6 equivalents, incl. IPv4-mapped forms) is rejected.
//
// `guardedLookup` is installed as the DNS lookup of the HTTP agent, so the
// check happens at CONNECT time on the exact addresses the socket uses —
// DNS rebinding (public on the first lookup, private on the second) can't
// bypass it.

import dns from "node:dns";
import net from "node:net";

// ---------------------------------------------------------------- IPv4

/** Parses a dotted-quad IPv4 string (strict, 4 decimal parts) into a 32-bit number, or null. */
export function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function v4(a: number, b: number, c: number, d: number): number {
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

/** [network, prefixLength] ranges that are NOT publicly routable. */
const BLOCKED_V4: [number, number][] = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // carrier-grade NAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local (cloud metadata 169.254.169.254)
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 31, 196, 0), 24], // AS112-v4
  [v4(192, 52, 193, 0), 24], // AMT
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast (deprecated)
  [v4(192, 168, 0, 0), 16], // private
  [v4(192, 175, 48, 0), 24], // direct delegation AS112
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved + broadcast 255.255.255.255
];

function inV4Range(ip: number, [net, bits]: [number, number]): boolean {
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === net;
}

export function isPublicIPv4(ip: string): boolean {
  const n = parseIPv4(ip);
  if (n === null) return false;
  return !BLOCKED_V4.some((r) => inV4Range(n, r));
}

// ---------------------------------------------------------------- IPv6

/** Expands an IPv6 string (incl. "::" and an embedded dotted IPv4 tail) into 8 16-bit groups, or null. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone); // fe80::1%eth0
  if (!ip.includes(":")) return null;

  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = parseIPv4(maybeV4);
    if (n === null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    ip = ip.slice(0, lastColon + 1) + "0:0"; // two placeholder groups, replaced below
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  return groups;
}

const v4FromGroups = (hi: number, lo: number) =>
  `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;

export function isPublicIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return false;

  // ::ffff:a.b.c.d — IPv4-mapped: judge the embedded IPv4 address.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isPublicIPv4(v4FromGroups(g[6], g[7]));
  }
  // 64:ff9b::/96 — NAT64 well-known prefix: judge the embedded IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isPublicIPv4(v4FromGroups(g[6], g[7]));
  }

  // Only global unicast 2000::/3 is allowed (this excludes ::, ::1, ::/96
  // IPv4-compatible, ::ffff:0:0:0/96 translated, 64:ff9b:1::/48, 100::/64,
  // fc00::/7 ULA, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast).
  if ((g[0] & 0xe000) !== 0x2000) return false;

  // ...minus special-purpose blocks inside 2000::/3:
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 IETF protocol assignments (incl. Teredo 2001::/32)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return false; // 2002::/16 6to4 (embeds arbitrary IPv4)
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/** True only for a public, globally routable unicast IP address (v4 or v6). */
export function isPublicAddress(ip: string): boolean {
  let s = ip.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const family = net.isIP(s.split("%")[0]);
  if (family === 4) return isPublicIPv4(s);
  if (family === 6) return isPublicIPv6(s);
  return false;
}

// ---------------------------------------------------------------- lookup

export class BlockedAddressError extends Error {
  code = "EBLOCKEDADDRESS";
  constructor(public readonly hostname: string) {
    super(`"${hostname}" points to a private or reserved network address, which can't be fetched.`);
    this.name = "BlockedAddressError";
  }
}

type LookupAddress = { address: string; family: number };
type Resolver = (
  hostname: string,
  options: { all: true; family?: number; hints?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

const systemResolver: Resolver = (hostname, options, callback) =>
  dns.lookup(hostname, options, (err, addresses) => callback(err, (addresses ?? []) as LookupAddress[]));

/**
 * Builds a `dns.lookup`-compatible function that resolves `hostname` and
 * fails with BlockedAddressError if ANY resolved address is not public.
 * Supports both `all: true` (Node's happy-eyeballs path) and single-address
 * callers. `resolver` and `isAllowed` are injectable for tests.
 */
export function createGuardedLookup(resolver: Resolver = systemResolver, isAllowed: (ip: string) => boolean = isPublicAddress) {
  return function guardedLookup(
    hostname: string,
    optionsOrCallback: unknown,
    maybeCallback?: unknown
  ): void {
    const options = (typeof optionsOrCallback === "object" && optionsOrCallback !== null ? optionsOrCallback : {}) as {
      all?: boolean;
      family?: number | string;
      hints?: number;
    };
    const callback = (typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number
    ) => void;
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : Number(options.family) || 0;

    resolver(hostname, { all: true, family, ...(options.hints ? { hints: options.hints } : {}) }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        const e: NodeJS.ErrnoException = new Error(`Could not resolve "${hostname}"`);
        e.code = "ENOTFOUND";
        return callback(e);
      }
      if (addresses.some((a) => !isAllowed(a.address))) return callback(new BlockedAddressError(hostname));
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/** Promise helper: resolves a hostname through the guard (used for a clear early error). */
export function resolveGuarded(hostname: string, lookup = createGuardedLookup()): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err: NodeJS.ErrnoException | null, addresses?: string | LookupAddress[]) => {
      if (err) reject(err);
      else resolve(addresses as LookupAddress[]);
    });
  });
}
