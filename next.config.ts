import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MetaApi SDK uses websockets and dynamic requires; load it from node_modules at runtime.
  serverExternalPackages: ["metaapi.cloud-sdk"],
  experimental: {
    // CSV imports go through a Server Action. Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
