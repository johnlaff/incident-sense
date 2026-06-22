import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" produces a self-contained server bundle for a small Docker image.
  output: "standalone",
};

export default nextConfig;
