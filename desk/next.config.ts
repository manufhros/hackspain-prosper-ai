import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// OpenNext detects desk/package-lock.json as its packaging root. Next 16 uses
// turbopack.root for standalone tracing too, so the Cloudflare build must match.
// Local Turbopack builds need the repo root to resolve the shared log parser.
const buildRoot = process.env.DESK_CLOUDFLARE_BUILD === "1" ? appRoot : path.resolve(appRoot, "..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: buildRoot,
  },
};

export default nextConfig;
