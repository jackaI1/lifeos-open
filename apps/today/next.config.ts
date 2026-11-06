import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { cpus: 2 },
  turbopack: { root: path.resolve("../..") },
  outputFileTracingRoot: path.resolve("../.."),
};
export default config;
