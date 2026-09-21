/**
 * The Chrome profile seed that turns a Playwright-launched Chromium into a genuinely
 * zoomed browser.
 *
 * This is NOT emulation. A real page zoom (Ctrl+=) shrinks the layout viewport,
 * reflows media queries and doubles `devicePixelRatio`, while the OS window stays the
 * same size. Chrome persists that state per host in `Default/Preferences` under
 * `partition.per_host_zoom_levels.<partition>.<host>.zoom_level`, so seeding the file
 * before launch makes the browser start zoomed — no CDP override, no pinned viewport.
 *
 * Measured recipe (Chrome for Testing 147.0.7727.15, playwright 1.59.1). All four
 * details are load-bearing; the probe below is what proved each one:
 *
 * 1. The `"x"` wrapper is Chrome's default storage-partition name. A dict without it
 *    is ignored.
 * 2. `zoom_level` is log_1.2(factor), stored as an OBJECT (`{ zoom_level }`). A bare
 *    double in that slot does not work.
 * 3. The host key is the BARE host with NO port (`127.0.0.1`, not `127.0.0.1:3000`),
 *    and it is the exact host string: `localhost` is a DIFFERENT key that stays
 *    unzoomed. This is why the config refuses a non-`127.0.0.1` baseURL instead of
 *    letting the suite silently measure an unzoomed window.
 * 4. `last_modified` is optional and is not read by the zoom subsystem.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/** The host the seed is keyed by — bare, no port, and not `localhost`. */
export const ZOOM_HOST = "127.0.0.1"

/** `1.2 ** 3.8017840169239308 === 2.0` — i.e. 200% page zoom. */
export const ZOOM_LEVEL_200 = Math.log(2) / Math.log(1.2)

/** The OS window every measurement in this suite is pinned to (`--window-size`). */
export const WINDOW_SIZE = { width: 1440, height: 900 } as const

/** Measured certificate for a clean profile at {@link WINDOW_SIZE}: no zoom applied. */
export const CLEAN_WINDOW = {
  innerWidth: 1440,
  innerHeight: 813,
  outerWidth: 1440,
  outerHeight: 900,
  devicePixelRatio: 1,
} as const

/** Measured certificate for the same window at 200% page zoom: layout viewport halved. */
export const ZOOMED_WINDOW = {
  innerWidth: 720,
  innerHeight: 406,
  outerWidth: 1440,
  outerHeight: 900,
  devicePixelRatio: 2,
} as const

/** The app's desktop gate, `createMediaQuery("(min-width: 768px)")`. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)"

/** The 768px gate (`pages/session/session-side-panel.tsx`) as a viewport width. */
export const DESKTOP_BREAKPOINT = 768

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key]
    merged[key] = isJsonObject(current) && isJsonObject(value) ? deepMerge(current, value) : value
  }
  return merged
}

/** The exact `Preferences` shape Chrome persists a 200% zoom as. */
export function zoomPreferences(host = ZOOM_HOST, zoomLevel = ZOOM_LEVEL_200) {
  return {
    partition: {
      // `"x"` is the default storage partition; without this wrapper the dict is ignored.
      per_host_zoom_levels: {
        x: {
          // Bare host, no port. `last_modified` is optional (microseconds, Unix epoch here).
          [host]: { last_modified: String(Date.now() * 1000), zoom_level: zoomLevel },
        },
      },
    },
  }
}

/**
 * Seed `<profile>/Default/Preferences` BEFORE the browser launches.
 *
 * Deep-merged into whatever is already there (Playwright never writes this file for a
 * fresh temp profile, so the merge is against `{}` in practice — but a clobber here
 * would delete every unrelated pref the day that changes).
 */
export function seedZoomProfile(profileDir: string, host = ZOOM_HOST, zoomLevel = ZOOM_LEVEL_200) {
  const defaultDir = path.join(profileDir, "Default")
  mkdirSync(defaultDir, { recursive: true })
  const preferences = path.join(defaultDir, "Preferences")
  writeFileSync(preferences, JSON.stringify(deepMerge(readPreferences(preferences), zoomPreferences(host, zoomLevel))))
  return preferences
}

function readPreferences(file: string): JsonObject {
  // The only expected miss is a fresh profile: the file does not exist yet. A file
  // that exists but is unreadable/not JSON is equally "start from empty" — the seed
  // written below is what the measurement depends on.
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return isJsonObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
