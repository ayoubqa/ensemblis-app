import type { MetadataRoute } from "next";
import indexing from "@/lib/indexing.json";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: indexing.privatePrefixes }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
