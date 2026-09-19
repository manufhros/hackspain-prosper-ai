import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// All mutable data lives in D1; the app does not use ISR or a shared fetch cache.
const config = defineCloudflareConfig();
// Webpack can compile shared source outside desk while keeping standalone output
// rooted here, as required by OpenNext's nearest-lockfile package detection.
config.buildCommand = "DESK_CLOUDFLARE_BUILD=1 npm run build -- --webpack";
export default config;
