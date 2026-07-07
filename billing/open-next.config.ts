import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config: dynamic, per-request app. No ISR/data cache overrides needed
// for the first release (add an R2/KV incremental cache later if we introduce
// heavily-cached pages).
export default defineCloudflareConfig({});
