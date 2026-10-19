import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" produces a self-contained server bundle for a small Docker image.
  // Netlify packages the app with its own Next.js adapter, so skip it there.
  output: process.env.NETLIFY ? undefined : "standalone",
  // Hide the on-screen Next.js indicator (the floating logo badge) — this is a
  // product UI, not a dev playground.
  devIndicators: false,
};

export default nextConfig;
