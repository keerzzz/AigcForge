import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, gotoWhenReady } from "../utils/waits"
import { PRESENTATION_EXPECTED as EXPECTED } from "../presentation-matrix"

const directory = "C:/Aigcfroge/PresentationMatrix"
const projectID = "proj_presentation_matrix"
const sessionID = "ses_presentation_modes"
const created = 1700000000000
const modes = ["chat", "coding", "work", "assistant", "custom"] as const

/**
 * Presentation matrix contract.
 *
 * The four projects in `playwright.config.ts` must actually change what the
 * user sees: `chromium-dark` forces the dark color scheme, `chromium-zh`
 * forces the stored locale, and `chromium-narrow` runs at 390x844. Each
 * assertion below keys on the project name, so a project whose storage/device
 * wiring stops applying turns exactly that case red. Keyboard reachability is
 * asserted here as an interaction (Tab) on the base project instead of a fifth
 * project.
 *
 * The attribute targets are the applied presentation state, not test hooks:
 * `data-color-scheme` / `data-theme` are set by `applyThemeCss`
 * (packages/ui/src/theme/context.tsx:153-154) and `documentElement.lang` by
 * the language provider (packages/app/src/context/language.tsx:227).
 */
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
  await gotoWhenReady(page, `/${base64Encode(directory)}`)
  // The theme provider applying oc-2 means the app booted far enough that the
  // presentation providers (theme + language) have both mounted.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "oc-2", { timeout: APP_READY_TIMEOUT })
}

async function mountModeWorkspace(page: Page) {
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
    sessions: [
      {
        id: sessionID,
        slug: "presentation-modes",
        projectID,
        directory,
        title: "Presentation modes",
        mode: "chat",
        agent: "meta",
        version: "dev",
        time: { created, updated: created },
      },
    ],
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
  await gotoWhenReady(page, `/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "oc-2", { timeout: APP_READY_TIMEOUT })
}

test.describe("regression: presentation matrix contract", { tag: "@presentation" }, () => {
  test("applies theme, locale, viewport and base keyboard focus", async ({ page }, testInfo) => {
    const want = EXPECTED[testInfo.project.name]
    if (!want) throw new Error(`unexpected project ${testInfo.project.name}`)

    await mountApp(page)

    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", want.colorScheme)
    const lang = await page.evaluate(() => document.documentElement.lang)
    expect(lang).toBe(want.lang)
    expect(page.viewportSize()).toEqual(want.viewport)

    if (testInfo.project.name !== "chromium") return
    // The titlebar Home button is the first control in tab order, so keyboard
    // reachability is asserted against it on the base project.
    const home = page.getByRole("button", { name: "Home", exact: true })
    await expect(home).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(home).toBeFocused()
    const outline = await home.evaluate((node) => {
      const style = getComputedStyle(node)
      return { style: style.outlineStyle, width: style.outlineWidth }
    })
    expect(outline.style).not.toBe("none")
    expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)
  })

  test("keeps the selected chat/coding/work/assistant/custom surfaces visible in every presentation project", async ({
    page,
  }) => {
    await mountModeWorkspace(page)

    for (const mode of modes) {
      await page.goto(`/mode/${mode}`)
      await expect(page.locator(`[data-mode-sidebar="${mode}"]`)).toBeVisible()
      await expect(page.locator(`[data-mode-main="${mode}"]`)).toBeVisible()
      for (const other of modes.filter((candidate) => candidate !== mode)) {
        await expect(page.locator(`[data-mode-sidebar="${other}"]`)).toBeHidden()
        await expect(page.locator(`[data-mode-main="${other}"]`)).toBeHidden()
      }
    }
  })
})
