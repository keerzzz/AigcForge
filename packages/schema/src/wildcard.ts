export * as Wildcard from "./wildcard"

/**
 * Glob-style matcher shared by permission evaluation on every surface.
 *
 * Owned here rather than in `core` because the browser bundle needs it:
 * `@aigcfroge/schema` is the only workspace package the app may import without
 * risking the `process is not defined` blank screen (see
 * `packages/app/src/utils/browser-boundary.test.ts`). `core/util/wildcard`
 * re-exports this so its seven Node-side consumers keep their import path.
 *
 * The win32 case-insensitivity probe is guarded: `process` is absent in a
 * browser, and an unguarded `process.platform` read here would throw at call
 * time — a failure the boundary test cannot see, because it only detects reads
 * evaluated during module import.
 */
export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  const caseInsensitive = typeof process !== "undefined" && process.platform === "win32"
  return new RegExp("^" + escaped + "$", caseInsensitive ? "si" : "s").test(normalized)
}
