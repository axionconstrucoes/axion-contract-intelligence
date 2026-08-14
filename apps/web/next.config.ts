import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@axion/types", "@axion/mock-data"],
};

export default nextConfig;
