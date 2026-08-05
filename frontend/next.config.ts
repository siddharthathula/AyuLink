import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow all common LAN subnets + localhost for dev access from phones/tablets
  allowedDevOrigins: [
    "localhost:3000",
    "localhost:3001",
    "127.0.0.1:3000",
    "10.*.*.*:3000",
    "10.*.*.*:3001",
    "172.16.*.*:3000",
    "172.16.*.*:3001",
    "192.168.*.*:3000",
    "192.168.*.*:3001",
  ],
  async rewrites() {
    return [
      {
        // Proxy all /api/* calls to FastAPI backend on port 8000
        source: '/api/:path((?!cam-proxy).*)',
        destination: 'http://127.0.0.1:8000/api/:path*',
      },
    ]
  },
};

export default nextConfig;
