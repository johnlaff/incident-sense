import type { NextConfig } from "next";

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
};

export default nextConfig;
