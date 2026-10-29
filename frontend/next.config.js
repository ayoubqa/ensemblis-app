const indexing = require("./lib/indexing.json");
const NOINDEX_PREFIXES = [...indexing.privatePrefixes, ...indexing.noindexOnly];

// Without a contact address the public site has no way to ask for access while sign-up is invite-only, and the
// legal pages show a placeholder. Not fatal (local and preview builds don't need it) — but loud in production.
if (process.env.VERCEL_ENV === "production" && !(process.env.NEXT_PUBLIC_CONTACT_EMAIL || "").trim()) {
  console.warn(
    "\n⚠  NEXT_PUBLIC_CONTACT_EMAIL is not set for this production build: /access cannot take access requests and the\n" +
      "   privacy and terms pages show a placeholder. Set it in Vercel → Settings → Environment Variables (Production) and redeploy.\n"
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The Journal reads content/blog at runtime too (hourly revalidation publishes scheduled articles
    // without a deploy), so the Markdown files must ship with every server function that renders it —
    // and the article images, whose intrinsic sizes the renderer reads (lib/blog/images.ts).
    outputFileTracingIncludes: { "/**/*": ["./content/blog/**/*", "./public/blog/**/*"] },
  },
  // Security headers on every page. No page is meant to be embedded: refusing
  // to be framed stops click-jacking (e.g. tricking a signed-in user into
  // "Join", "Share publicly" or "Approve plan" through an invisible iframe).
  // The marketplace era's public pages are retired (v4: outcome execution).
  // Old links land somewhere sensible instead of a 404.
  async redirects() {
    const toHome = ["/agents", "/agents/:path*", "/developers", "/developers/:path*", "/network", "/economics", "/workforce", "/examples", "/examples/:path*", "/changelog", "/brand", "/styleguide"];
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
