import type { NextConfig } from "next";

/**
 * Versão deste deploy: o código do commit na Vercel (ou a hora do build, localmente). Vai
 * embutida no app e é comparada com /api/version para avisar quando há versão nova.
 */
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`).slice(0, 12);

const nextConfig: NextConfig = {
  transpilePackages: ["@mixpro/contracts"],
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async redirects() {
    return [{ source: "/app/:path*", destination: "/estudio", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
      // o service worker nunca pode ficar preso no cache (senão uma versão velha continua no celular)
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/api/version", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
