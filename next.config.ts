import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // CSV imports go through a Server Action. Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
