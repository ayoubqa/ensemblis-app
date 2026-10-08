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
import { inter } from "./fonts";
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
import { SITE } from "@/lib/site";

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
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: `${SITE.name} — ${SITE.positioning} ${SITE.promise}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.positioning.replace(/\.$/, "")}`,
    description: SITE.promise,
    images: ["/brand/og-image.png"],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: "#07111F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
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
                <Header />
                <GuestBanner />
                <PageTransition>{children}</PageTransition>
                <Footer />
                <BottomNav />
              </ShellProvider>
            </ToastProvider>
          </AuthProvider>
          </ConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
