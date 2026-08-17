import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@axion/types", "@axion/mock-data", "@axion/db"],
};

export default nextConfig;
