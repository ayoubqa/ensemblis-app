import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/marketing.css";
import "./styles/workspace.css";
import "./styles/console.css";
import "./styles/operations.css";
import "./styles/auth.css";
import "./styles/site.css";
import { inter, newsreader } from "./fonts";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { Header, BottomNav } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PageTransition } from "@/components/PageTransition";
import { ShellProvider } from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import { DemoBanner } from "@/components/DemoBanner";
import { GuestBanner } from "@/components/GuestBanner";
import { ConfigProvider } from "@/lib/config";
import { demoInitScript } from "@/lib/demo-flags";
import { OG_IMAGE, SITE } from "@/lib/site";
import { visiblePosts } from "@/lib/blog/posts";
import { SiteAnalytics } from "@/components/site/SiteAnalytics";

// Favicons come from the official brand pack via the app/ file conventions
// (app/favicon.ico, app/icon.png, app/apple-icon.png); see public/brand/README.md.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.positioning.replace(/\.$/, "")}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.positioning.replace(/\.$/, "")}`,
    description: SITE.promise,
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.positioning.replace(/\.$/, "")}`,
    description: SITE.promise,
    images: [OG_IMAGE.url],
  },
  formatDetection: { telephone: false },
  // Search Console / Bing Webmaster Tools ownership (the tokens are public by design). Unset = no tag.
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: "#07111F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The Journal is promoted in the navigation only once it has a published article.
  const journal = visiblePosts().length > 0;
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Show the cached public-demo banner state before first paint (no layout jump). */}
        <script dangerouslySetInnerHTML={{ __html: demoInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ConfigProvider>
          <AuthProvider>
            <ToastProvider>
              <ShellProvider>
                <a className="skip" href="#main">
                  Skip to content
                </a>
                <DemoBanner />
                <Header journal={journal} />
                <GuestBanner />
                <PageTransition>{children}</PageTransition>
                <Footer journal={journal} />
                <BottomNav />
                <SiteAnalytics />
              </ShellProvider>
            </ToastProvider>
          </AuthProvider>
          </ConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
