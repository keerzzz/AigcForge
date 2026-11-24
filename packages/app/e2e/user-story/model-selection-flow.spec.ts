import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { provider, sessionHref } from "../utils/app"
import { mockOmnixaServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { openSession } from "../utils/workspace"
import { selectGlobalMode } from "../utils/home-mode"

const directory = "C:/Omnixa/NewProject"

test("creates a session in a new project and selects its model", async ({ page }) => {
  // An empty draft must remain usable when the file viewer is unavailable.
  await page.route(
    /(?:\/_assets\/file-(?!icon-)[^/]+\.js|\/session-ui\/src\/components\/file\.tsx)(?:\?|$)/,
    async (route) => {
      const url = new URL(route.request().url())

      if (url.pathname.endsWith("/session-ui/src/components/file.tsx")) return route.abort()
      // Startup modules can share the file-* chunk name; only the viewer must fail.
      url.pathname += ".map"
      const response = await route.fetch({ url: url.href })
      await expect(response).toBeOK()
      const map = Schema.decodeUnknownSync(Schema.Struct({ sources: Schema.Array(Schema.String) }))(
        await response.json(),
      )

      return map.sources.some((source) => source.endsWith("/session-ui/src/components/file.tsx"))
        ? route.abort()
        : route.continue()
    },
  )
  await mockOmnixaServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "omnixa",
          name: "Local gateway",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
            "custom-model": {
              id: "custom-model",
              name: "Custom Model",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["omnixa"],
      default: { providerID: "omnixa", modelID: "free-model" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    // Listings are requested by absolute path and returned relative to the stable Location.
    fileList: (path) => (path === "C:/Omnixa" ? [{ path: "./", type: "directory", ignored: false }] : []),
  })
  await page.addInitScript(() => {
    localStorage.setItem("omnixa.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    localStorage.setItem(
      "omnixa.global.dat:model",
      JSON.stringify({
        user: [
          { providerID: "omnixa", modelID: "free-model", visibility: "show" },
          { providerID: "omnixa", modelID: "custom-model", visibility: "show" },
        ],
        recent: [{ providerID: "omnixa", modelID: "custom-model" }],
        variant: {},
      }),
    )
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await expect(picker.getByRole("combobox")).toHaveValue("C:\\Omnixa\\NewProject")

  const listing = page.waitForRequest((request) => {
    const url = new URL(request.url())

    return url.pathname === "/api/fs/list" && url.searchParams.get("path") === "C:/Omnixa"
  })

  await picker.getByRole("button", { name: "Parent", exact: true }).click()
  expect(new URL((await listing).url()).searchParams.get("location[directory]")).toBe(directory)
  const directoryItem = picker.getByRole("treeitem", { name: "NewProject", exact: true })
  await expect(directoryItem).toBeVisible()
  await directoryItem.click()
  await expect(directoryItem).toHaveAttribute("aria-selected", "true")
  await expect(picker.getByText("C:\\Omnixa\\NewProject", { exact: true })).toBeVisible()
  const selectFolder = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(selectFolder).toBeEnabled()
  await selectFolder.click()
  await expect(picker).toBeHidden()

  await selectGlobalMode(page, "Coding")
  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="composer"]'))

  const modelControl = page.locator('[data-action="composer-model"]')
  await expect(modelControl).toContainText("Custom Model")
  await modelControl.click()
  const modelSearch = page.getByPlaceholder("Search models", { exact: true })
  await expect(modelSearch).toBeFocused()
  await modelSearch.press("ArrowDown")
  await modelSearch.press("Enter")
  await expect(modelControl).toContainText("Free Model")

  await modelControl.click()
  await expect(modelSearch).toBeFocused()
  await modelSearch.press("ArrowUp")
  await modelSearch.press("Enter")

  await expect(modelControl).toContainText("Custom Model")
})

test("restores each existing session's model and variant when switching tabs", async ({ page }) => {
  const sessions = ["A", "B"].map((name) => ({
    id: `ses_model_${name}`,
    title: `Model ${name}`,
    model: { id: `model-${name}`, providerID: "omnixa", variant: "balanced" },
  }))

  await openSession(page, {
    name: "ModelSelection",
    sessions,
    provider: provider(
      ...sessions.map((session) => ({
        id: session.model.id,
        name: session.title,
        variants: { balanced: {}, high: {} },
      })),
    ),
  })

  const hrefA = sessionHref(sessions[0]!.id)
  const hrefB = sessionHref(sessions[1]!.id)
  const composer = page.locator('[data-component="composer"]')
  const modelControl = composer.locator('[data-action="composer-model"]')
  const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).click()
  await expect(page).toHaveURL(hrefB)
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  // A new draft starts from the current session's non-default model and chosen variant.
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefA}"]`).click()
  await expect(page).toHaveURL(hrefA)
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("high")
})
