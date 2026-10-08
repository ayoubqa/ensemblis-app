import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.definition,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#07111F",
    theme_color: "#07111F",
    icons: [
      { src: "/brand/ensemblis-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/ensemblis-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
