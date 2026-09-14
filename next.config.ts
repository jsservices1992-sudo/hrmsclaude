import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads are capped at 5MB by lib/storage/rules; the
      // framework default of 1MB would reject them before that check runs.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
