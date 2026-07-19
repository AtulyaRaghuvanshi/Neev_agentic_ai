import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const d1DatabaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME ?? "site-creator-d1";
const d1DatabaseId =
  process.env.CLOUDFLARE_D1_DATABASE_ID ??
  SITE_CREATOR_PLACEHOLDER_DATABASE_ID;
const r2BucketName =
  process.env.CLOUDFLARE_R2_BUCKET_NAME ?? "site-creator-r2";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  name: "neev-identity",
  main: "./worker/index.ts",
  compatibility_date: "2026-07-19",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    GROQ_MODEL: process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: d1DatabaseName,
          database_id: d1DatabaseId,
          // The generated config lives in dist/server.
          migrations_dir: "../../drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: r2BucketName,
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
