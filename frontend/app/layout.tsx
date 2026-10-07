import type { Metadata, Viewport } from "next";
import "./globals.css";
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

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%2305080F'/%3E%3Crect x='5' y='5' width='3.2' height='14' rx='1.4' fill='%23fff'/%3E%3Crect x='10' y='5' width='9' height='3.2' rx='1.4' fill='%233D7BFF'/%3E%3Crect x='10' y='10.4' width='6' height='3.2' rx='1.4' fill='%233CD3EA'/%3E%3Crect x='10' y='15.8' width='9' height='3.2' rx='1.4' fill='%233D7BFF'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: {
    default: "Ensemblis — The AI operating layer for business",
    template: "%s · Ensemblis",
  },
  description:
    "Describe the outcome. We do the work. Ensemblis plans business objectives with a Chief of Staff, executes them with an AI Team, verifies the result against evidence and measures whether it was achieved.",
  applicationName: "Ensemblis",
  openGraph: {
    title: "Ensemblis — The AI operating layer for business",
    description: "Describe the outcome. We do the work.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#05080F" },
    { media: "(prefers-color-scheme: dark)", color: "#05080F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Show the cached public-demo banner state before first paint (no layout jump). */}
        <script dangerouslySetInnerHTML={{ __html: demoInitScript }} />
        <link rel="icon" href={FAVICON} type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
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
