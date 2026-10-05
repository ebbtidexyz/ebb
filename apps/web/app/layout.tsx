import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Bathymetry } from "@/components/site/bathymetry";
import { themeScript } from "@/components/site/theme-script";
import { preloaderSeenScript } from "@/components/landing/bus";
import { Providers } from "./providers";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
  style: ["normal", "italic"],
  display: "swap",
});
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Ebb · Spend it, or the tide takes it", template: "%s · Ebb" },
  description:
    "Hold $EBB and trading fees pay for your AI every 30 minutes. Credits left on the shore for seven days are drawn into the Trench: they buy $EBB back and burn it.",
  applicationName: "Ebb",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07131F" },
    { media: "(prefers-color-scheme: light)", color: "#F3EEDF" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <head>
        {/* theme before paint; landing: skip the preloader on repeat visits in a session.
            (React dev logs a harmless notice about inline scripts; next/script beforeInteractive broke them.) */}
        <script dangerouslySetInnerHTML={{ __html: `${themeScript}\n${preloaderSeenScript}` }} />
      </head>
      <body className="min-h-dvh">
        <Bathymetry />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
