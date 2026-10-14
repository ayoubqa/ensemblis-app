const indexing = require("./lib/indexing.json");
const NOINDEX_PREFIXES = [...indexing.privatePrefixes, ...indexing.noindexOnly];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security headers on every page. No page is meant to be embedded: refusing
  // to be framed stops click-jacking (e.g. tricking a signed-in user into
  // "Join", "Share publicly" or "Approve plan" through an invisible iframe).
  // The marketplace era's public pages are retired (v4: outcome execution).
  // Old links land somewhere sensible instead of a 404.
  async redirects() {
    const toHome = ["/agents", "/agents/:path*", "/developers", "/developers/:path*", "/pricing", "/network", "/economics", "/workforce", "/examples", "/examples/:path*", "/changelog", "/brand", "/styleguide"];
    return [
      ...toHome.map((source) => ({ source, destination: "/", permanent: false })),
      { source: "/dashboard/developer", destination: "/dashboard", permanent: false },
    ];
  },
  async headers() {
    return [
      // Account pages, token pages and shared result links are never indexed (see lib/indexing.json).
      ...NOINDEX_PREFIXES.flatMap((p) => [p, `${p}/:path*`]).map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
