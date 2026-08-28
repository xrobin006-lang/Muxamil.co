import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors fail the build — the app source is fully type-clean.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
