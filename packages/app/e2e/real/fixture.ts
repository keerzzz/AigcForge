/**
 * Spec-side access to the E4 runtime: the orchestrator's manifest (ports, dirs,
 * real backend version) and the localStorage seeding that points the production
 * app at the real backend. The registry shape mirrors the E3 mock specs — the
 * difference is that here nothing intercepts the network.
 */
import { readManifest, type E4Manifest } from "./manifest"

export function e4(): E4Manifest {
  return readManifest(process.env.E4_RUN_DIR ?? "")
}

/**
 * Seed the localStorage server registry and default server URL with the real
 * backend. Sealed via addInitScript so it applies before any app code runs.
 */
export function seedRealBackend(page: import("@playwright/test").Page, backendUrl: string) {
  const registry = JSON.stringify({
    list: [{ type: "http", http: { url: backendUrl } }],
    projects: {},
    lastProject: {},
  })
  void page.addInitScript(
    ({ registry, defaultUrl }) => {
      localStorage.setItem("aigcfroge.global.dat:server", registry)
      localStorage.setItem("aigcfroge.settings.dat:defaultServerUrl", defaultUrl)
    },
    { registry, defaultUrl: backendUrl },
  )
}
