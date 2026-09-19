import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// All mutable data lives in D1; the app does not use ISR or a shared fetch cache.
export default defineCloudflareConfig();
