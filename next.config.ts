import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Single source of truth for the version the app reports (/api/health). Read at
// build time so a running container can be identified without guessing which
// image tag produced it.
const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    APP_VERSION: version,
  },
};

export default nextConfig;
