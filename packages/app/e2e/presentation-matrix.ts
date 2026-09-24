/**
 * Presentation matrix definition — the single source shared by
 * `playwright.config.ts` and the contract spec that validates it.
 *
 * `chromium` carries the business suite. The other three projects exist to prove
 * that the shell survives a different theme, locale or viewport, so they run only
 * specs that assert presentation or accessibility behaviour: the matrix contract
 * itself, the a11y/narrow spec, and (once its S7 unlock lands) the shell
 * presentation spec. Running the business suite five times produced ~940 instances
 * for ~188 scenarios with no project-specific assertion in most of them — recorded
 * in `docs/technical-debt.md` §8 — and it is also what multiplied Vite cold compiles
 * and artifact writes.
 *
 * The tag is the whole switch: a spec without `@presentation` / `@a11y` runs on
 * `chromium` only. Keep the definition here, not in the config, so the validator can
 * read the same value the runner uses instead of grepping the config text.
 */
export const PRESENTATION_TAGS = ["@presentation", "@a11y"] as const

/** Matched against the full test title; Playwright's own tag syntax. */
export const PRESENTATION_GREP = /@presentation|@a11y/

/** Project names that run `PRESENTATION_GREP` instead of the full suite. */
export const MATRIX_PROJECTS = ["chromium-dark", "chromium-zh", "chromium-narrow"] as const

/** What each project must actually change, asserted by `presentation-matrix.spec.ts`. */
export const PRESENTATION_EXPECTED: Record<
  string,
  { colorScheme: string; lang: string; viewport: { width: number; height: number } }
> = {
  chromium: { colorScheme: "light", lang: "en", viewport: { width: 1280, height: 720 } },
  "chromium-dark": { colorScheme: "dark", lang: "en", viewport: { width: 1280, height: 720 } },
  "chromium-zh": { colorScheme: "light", lang: "zh", viewport: { width: 1280, height: 720 } },
  "chromium-narrow": { colorScheme: "light", lang: "en", viewport: { width: 390, height: 844 } },
}
