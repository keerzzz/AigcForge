import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    // Playwright writes its report, traces and webm videos under `e2e/`, which is
    // inside the dev server's watch root. A write mid-run makes Vite push a full
    // client reload, which detaches the frame a test is navigating in — observed as
    // `page.goto: net::ERR_ABORTED; maybe frame was detached?` plus a 120s
    // "dev server is not answering" predicate timeout in composer-submit. Test
    // artifacts are not app source, so they must not trigger HMR at all.
    watch: {
      ignored: ["**/e2e/test-results/**", "**/e2e/playwright-report/**", "**/e2e/real/**"],
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    // Chunks here are inherently large for a desktop app: ~1.8 MB vendor (solid+effect+ai+drizzle+hono+marked)
    // and ~1.15 MB index (app+shiki core), plus on-demand ghostty/Shiki grammar chunks. 2000 kB warns only
    // on genuinely unexpected bloat, not the expected sizes for this scope.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined
          // ghostty-web (terminal) and shiki (grammars/themes) are dynamically imported on-demand;
          // force-grouping them into a vendor chunk would defeat their lazy loading, so leave them
          // on Vite's default splitting.
          if (id.includes("ghostty-web") || id.includes("/shiki/") || id.includes("@shikijs/")) return undefined
          // All other vendors (solid-js, effect, marked, remeda, ...) into one cohesive vendor chunk.
          // solid-js + solid-js/web land together here; splitting them apart would break the reactive graph.
          return "vendor"
        },
      },
    },
  },
})
