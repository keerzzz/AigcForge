import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Aigcfroge/TitlebarHomeRegression"
const projectID = "proj_titlebar_home_regression"
const sessionID = "ses_titlebar_home_regression"
const title = "Titlebar home regression"

/**
 * The titlebar's Home button reads one flag: whether the current route
 * classifies as `home`. That flag drives both its pressed state and which branch
 * `tabs.toggleHome` takes — restore the recent tab, or navigate to `/`.
 *
 * ADR-16 §1 made `/` a real page and §4 kept `/mode/:mode` authoritative and
 * separate. Before ADR-16, `/` redirected to `/mode/<persistedMode>`, so every
 * unrecognized path folding into `home` was correct; afterwards it left the
 * button lit on all five mode routes and, because it took the "already home"
 * branch, refused to navigate there.
 */
async function mountApp(page: Page, href: string) {
  await mockAigcfrogeServer(page, {
    provider: {
      all: [
        {
          id: "aigcfroge",
          name: "Aigcfroge",
          models: { "titlebar-model": { id: "titlebar-model", name: "Titlebar Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["aigcfroge"],
      default: { providerID: "aigcfroge", modelID: "titlebar-model" },
    },
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "titlebar-home-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    sessions: [
      {
        id: sessionID,
        slug: "titlebar-home-regression",
        projectID,
        directory,
        title,
        mode: "chat",
        agent: "meta",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(href)
}

function homeButton(page: Page) {
  return page.getByRole("button", { name: "Home", exact: true })
}

// The session route is visited first because that is how a user reaches a mode
// workspace — open a session, then navigate back to the mode home.
async function openModeWorkspace(page: Page, mode: string) {
  await mountApp(page, `/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: title }))
  await page.goto(`/mode/${mode}`)
  await expectAppVisible(page.locator("[data-mode-workspace]"))
}

test.describe("regression: titlebar home affordance", () => {
  test("reports pressed only on the global home route", async ({ page }) => {
    await mountApp(page, "/")
    await expectAppVisible(page.locator('[data-component="home-overview"]'))

    await expect(homeButton(page)).toHaveAttribute("aria-pressed", "true")
  })

  for (const mode of ["custom", "chat"]) {
    test(`does not report pressed on the ${mode} mode route`, async ({ page }) => {
      await openModeWorkspace(page, mode)

      await expect(homeButton(page)).toHaveAttribute("aria-pressed", "false")
    })
  }

  test("navigates to the global home route from a mode workspace", async ({ page }) => {
    await openModeWorkspace(page, "custom")

    await homeButton(page).click()

    await expect(page).toHaveURL(/\/$/)
    await expectAppVisible(page.locator('[data-component="home-overview"]'))
  })
})
