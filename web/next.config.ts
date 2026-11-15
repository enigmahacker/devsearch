import type { NextConfig } from "next";

// /api/* is proxied to FastAPI by middleware.ts (it adds the server-only API_TOKEN). CSP is also set there (per-request nonce).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the root: a stray package-lock.json in a parent folder (e.g. ~) would otherwise be picked as the workspace.
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
