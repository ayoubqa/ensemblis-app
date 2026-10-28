// Why a browser can't call this API. CORS is an exact-match allow-list (CORS_ORIGIN): a site served from an
// origin that isn't on it gets no Access-Control-Allow-Origin header, so the browser refuses the response
// and the page only sees a failed fetch ("Can't reach the Ensemblis server"). Nothing reaches the route
// handlers, so without this the server's logs say nothing. Each refused origin is logged once per process.
//
// The Origin header is sent by the browser and can be set by anyone: it is cut to a short length, logged as a
// JSON field (never interpolated into text), and only a bounded number of distinct origins are ever remembered.

import { config } from "../config";
import { log } from "./log";

const MAX_REMEMBERED = 50;
const MAX_LENGTH = 200;
const seen = new Set<string>();

/** Tests only. */
export function resetRejectedOriginsForTests(): void {
  seen.clear();
}

export function noteRejectedOrigin(origin: string): void {
  const shown = origin.slice(0, MAX_LENGTH);
  if (seen.has(shown)) return;
  if (seen.size >= MAX_REMEMBERED) return;
  seen.add(shown);
  log.warn("cors.origin_rejected", {
    origin: shown,
    allowedOrigins: config.corsOrigins,
    hint: "A site served from this origin cannot call the API. If it is yours, add the exact origin (scheme and host, no path) to CORS_ORIGIN, comma-separated; www and the bare domain are different origins.",
  });
}
