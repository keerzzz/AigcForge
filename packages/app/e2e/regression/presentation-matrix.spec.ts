import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectDevServerReady } from "../utils/waits"

const directory = "C:/Aigcfroge/PresentationMatrix"
const projectID = "proj_presentation_matrix"
const created = 1700000000000

/**
 * Presentation matrix contract.
 *
 * The five projects in `playwright.config.ts` must actually change what the
 * user sees: `chromium-dark` forces the dark color scheme, `chromium-zh` /
 * `chromium-zht` force the stored locale, and `chromium-narrow` runs at
 * 390x844. Each assertion below keys on the project name, so a project whose
 * storage/device wiring stops applying turns exactly that case red. Keyboard
 * reachability is asserted here as an interaction (Tab) on the base project
 * instead of a sixth project.
 *
 * The attribute targets are the applied presentation state, not test hooks:
 * `data-color-scheme` / `data-theme` are set by `applyThemeCss`
 * (packages/ui/src/theme/context.tsx:153-154) and `documentElement.lang` by
 * the language provider (packages/app/src/context/language.tsx:227).
 */
type Presentation = {
  colorScheme: string
  lang: string
  viewport: { width: number; height: number }
}

const EXPECTED: Record<string, Presentation> = {
  chromium: { colorScheme: "light", lang: "en", viewport: { width: 1280, height: 720 } },
  "chromium-dark": { colorScheme: "dark", lang: "en", viewport: { width: 1280, height: 720 } },
  "chromium-zh": { colorScheme: "light", lang: "zh", viewport: { width: 1280, height: 720 } },
  "chromium-zht": { colorScheme: "light", lang: "zht", viewport: { width: 1280, height: 720 } },
  "chromium-narrow": { colorScheme: "light", lang: "en", viewport: { width: 390, height: 844 } },
}

async function mountApp(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "presentation-matrix",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
  await expectDevServerReady(page)
  await page.goto(`/${base64Encode(directory)}`)
  // The theme provider applying oc-2 means the app booted far enough that the
  // presentation providers (theme + language) have both mounted.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "oc-2", { timeout: APP_READY_TIMEOUT })
}

test.describe("regression: presentation matrix contract", () => {
  test("applies theme, locale and viewport per project", async ({ page }, testInfo) => {
    const want = EXPECTED[testInfo.project.name]
    if (!want) throw new Error(`unexpected project ${testInfo.project.name}`)

    await mountApp(page)

    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", want.colorScheme)
    const lang = await page.evaluate(() => document.documentElement.lang)
    expect(lang).toBe(want.lang)
    expect(page.viewportSize()).toEqual(want.viewport)
  })

  test("reaches an interactive control by keyboard on the base project", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "keyboard reachability is asserted once, on the base project")

    await mountApp(page)

    await page.keyboard.press("Tab")
    const active = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        tabIndex: el.getAttribute("tabindex"),
      }
    })
    expect(active, "Tab must land on a real control, not <body>").not.toBeNull()
    if (active === null) return
    const { tag, role } = active
    const interactive = ["a", "button", "input", "select", "textarea", "summary"].includes(tag) || role === "button"
    expect(interactive, `expected an interactive element, got <${tag}>${role ? ` role=${role}` : ""}`).toBe(true)
  })
})
