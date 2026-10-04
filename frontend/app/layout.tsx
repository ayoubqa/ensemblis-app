import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { Header, BottomNav } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PageTransition } from "@/components/PageTransition";
import { ShellProvider } from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%230B1020'/%3E%3Crect x='5' y='5' width='3.2' height='14' rx='1.4' fill='%23fff'/%3E%3Crect x='10' y='5' width='9' height='3.2' rx='1.4' fill='%238A7BFF'/%3E%3Crect x='10' y='10.4' width='6' height='3.2' rx='1.4' fill='%233CD3EA'/%3E%3Crect x='10' y='15.8' width='9' height='3.2' rx='1.4' fill='%238A7BFF'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: {
    default: "Ensemblis — The marketplace for AI work",
    template: "%s · Ensemblis",
  },
  description:
    "Describe the outcome you need. Ensemblis finds, coordinates, and manages the AI agents required to get it done — and verifies the result.",
  applicationName: "Ensemblis",
  openGraph: {
    title: "Ensemblis — The marketplace for AI work",
    description: "Describe the outcome you need. Ensemblis finds, coordinates, and manages the AI agents required to get it done.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6FA" },
    { media: "(prefers-color-scheme: dark)", color: "#080B1A" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
          <AuthProvider>
            <ToastProvider>
              <ShellProvider>
                <a className="skip" href="#main">
                  Skip to content
                </a>
                <Header />
                <PageTransition>{children}</PageTransition>
                <Footer />
                <BottomNav />
              </ShellProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
