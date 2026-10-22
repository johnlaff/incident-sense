import type { NextConfig } from "next";

export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // "standalone" produces a self-contained server bundle for a small Docker image.
  // The Cloudflare build (OpenNext) reads the same output.
  output: "standalone",
  // Hide the on-screen Next.js indicator (the floating logo badge) — this is a
  // product UI, not a dev playground.
  devIndicators: false,
  // The menu calls the page Repetições: its address answers to that name too.
  async redirects() {
    return [{ source: "/repeticoes", destination: "/recorrencias", permanent: false }];
  },
  // The demo is public: no embedding in other sites, no sniffing, a short
  // Referer and no browser features the app does not use.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
