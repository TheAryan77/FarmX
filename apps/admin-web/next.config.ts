import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Shared workspace packages ship raw TypeScript — Next compiles them. */
  transpilePackages: ["@fasalx/ui", "@fasalx/types", "@fasalx/validation"],
};

export default nextConfig;
