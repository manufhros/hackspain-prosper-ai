import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/agent/:path*",
        destination: "http://127.0.0.1:7860/:path*",
      },
    ];
  },
};

export default nextConfig;
