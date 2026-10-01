import type { Metadata, Viewport } from "next";
import { Inter, Montserrat, Sora } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { PwaSetup } from "@/components/pwa/pwa";
import { UpdateBanner } from "@/components/pwa/update-banner";
import { ErrorReporter } from "@/components/errors/error-reporter";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
/** Fonte das legendas (desenhadas em canvas). */
const montserrat = Montserrat({ variable: "--font-caption", subsets: ["latin"], weight: ["700", "800", "900"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Mix Pro — Mixagem e masterização online por presets",
    template: "%s · Mix Pro",
  },
  description:
    "Envie seu áudio, experimente sonoridades profissionais, compare antes e depois e baixe o resultado. Mixagem de voz, bateria, instrumentos e masterização online.",
  applicationName: "Mix Pro",
  appleWebApp: { capable: true, title: "Mix Pro", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#06061a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${sora.variable} ${montserrat.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <PwaSetup />
        <UpdateBanner />
        <ErrorReporter />
      </body>
    </html>
  );
}
