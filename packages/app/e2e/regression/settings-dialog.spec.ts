import { expect, test } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/SettingsDialog"
const projectID = "proj_settings_dialog"
const customProviderID = "settings-custom"
const visibleModelID = "settings-visible-model"
const hiddenModelID = "settings-hidden-model"

const provider = {
  all: [
    {
      id: customProviderID,
      name: "Settings Custom",
      source: "config",
      env: [],
      options: {},
      models: {
        [visibleModelID]: {
          id: visibleModelID,
          name: "Settings Visible Model",
          family: "settings",
          release_date: "2026-08-01",
          status: "active",
          options: {},
          headers: {},
          limit: { context: 200_000, output: 16_000 },
        },
        [hiddenModelID]: {
          id: hiddenModelID,
          name: "Settings Hidden Model",
          family: "settings",
          release_date: "2026-08-01",
          status: "active",
          options: {},
          headers: {},
          limit: { context: 200_000, output: 16_000 },
        },
      },
    },
  ],
  connected: [customProviderID],
  default: { [customProviderID]: visibleModelID },
}

async function openSettings(page: Parameters<typeof gotoWhenReady>[0]) {
  await gotoWhenReady(page, "/mode/coding")
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "settings-dialog",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

test("opens all five settings tabs without changing the route and returns focus on Escape", async ({ page }) => {
  await gotoWhenReady(page, "/mode/coding")

  const settings = page.getByRole("button", { name: "Settings" })
  await settings.focus()
  await settings.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/mode\/coding$/)

  for (const tab of ["General", "Shortcuts", "Servers", "Providers", "Models"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click()
    await expect(dialog.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/mode\/coding$/)
  }

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(settings).toBeFocused()
})

test("supports keyboard navigation across every settings tab", async ({ page }) => {
  const dialog = await openSettings(page)
  const tabs = ["General", "Shortcuts", "Servers", "Providers", "Models"]

  await dialog.getByRole("tab", { name: tabs[0], exact: true }).focus()
  for (const tab of tabs.slice(1)) {
    await page.keyboard.press("ArrowDown")
    await expect(dialog.getByRole("tab", { name: tab, exact: true })).toBeFocused()
    await expect(dialog.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible()
  }

  await page.keyboard.press("Home")
  await expect(dialog.getByRole("tab", { name: "General", exact: true })).toBeFocused()
  await expect(dialog.getByRole("tabpanel", { name: "General", exact: true })).toBeVisible()
})

test("persists a general setting after closing and reopening the dialog", async ({ page }) => {
  await gotoWhenReady(page, "/mode/coding")
  const settings = page.getByRole("button", { name: "Settings" })

  await settings.click()
  const dialog = page.getByRole("dialog")
  const uiFont = dialog.getByRole("textbox", { name: "UI font" })
  await uiFont.fill("Inter Test")
  await expect(uiFont).toHaveValue("Inter Test")

  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 4, y: 4 } })
  await expect(dialog).toHaveCount(0)
  await settings.click()
  await expect(dialog.getByRole("textbox", { name: "UI font" })).toHaveValue("Inter Test")
})

test("keeps a rejected server out of persisted state and shows the connection failure", async ({ page }) => {
  const rejectedServer = "http://127.0.0.1:4555"
  await page.route(`${rejectedServer}/global/health`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ healthy: false }) }),
  )

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Servers", exact: true }).click()
  await dialog.getByRole("button", { name: "Add server", exact: true }).click()

  const addServer = page.getByRole("dialog").last()
  await expect(addServer).toContainText("Add server")
  await addServer.locator('input[type="text"]').first().fill(rejectedServer)
  await addServer.getByRole("button", { name: "Add server", exact: true }).click()

  await expect(addServer.getByText("Could not connect to server", { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate((url) => {
        const state = localStorage.getItem("aigcfroge.global.dat:server")
        return state?.includes(url) ?? false
      }, rejectedServer),
    )
    .toBe(false)
})

test("shows a provider write failure and rolls the optimistic disconnect back", async ({ page }) => {
  const rejectedMessage = "provider write rejected"
  const config = {
    provider: {
      [customProviderID]: {
        npm: "@ai-sdk/openai-compatible",
        models: { [visibleModelID]: { name: "Settings Visible Model" } },
      },
    },
    disabled_providers: [],
  }

  await page.route("**/global/config", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: rejectedMessage }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) })
  })
  await page.route(`**/auth/${customProviderID}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Providers", exact: true }).click()
  const connected = dialog.locator('[data-component="connected-providers-section"]')
  const providerRow = connected.locator(".settings-v2-provider-row", { hasText: "Settings Custom" })
  await expect(providerRow).toBeVisible()
  await providerRow.getByRole("button", { name: "Disconnect", exact: true }).click()

  const toast = page.locator('[data-component="toast-v2"]')
  await expect(toast).toContainText("Request failed")
  await expect(toast).toContainText(rejectedMessage)
  await expect(providerRow).toBeVisible()
})


test("persists model visibility after closing, reopening, and reloading Settings", async ({ page }) => {
  await gotoWhenReady(page, "/mode/coding")
  const settings = page.getByRole("button", { name: "Settings" })

  await settings.click()
  let dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  const visibleModel = dialog.getByRole("switch", { name: "Settings Visible Model" })
  await expect(visibleModel).toBeChecked()
  await visibleModel.press("Space")
  await expect(visibleModel).not.toBeChecked()

  await page.keyboard.press("Escape")
  await settings.click()
  dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(dialog.getByRole("switch", { name: "Settings Visible Model" })).not.toBeChecked()
  await page.keyboard.press("Escape")

  await page.reload()
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible({ timeout: 120_000 })
  await page.getByRole("button", { name: "Settings" }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(dialog.getByRole("switch", { name: "Settings Visible Model" })).not.toBeChecked()
})

test("keeps every Settings tab reachable at 200 percent equivalent zoom", async ({ page }) => {
  // Browser zoom is represented by the equivalent 720x450 CSS viewport for a
  // 1440x900 window at 200%. This exercises the responsive dialog contract in Web;
  // native Electron zoom remains a separate integration boundary.
  await page.setViewportSize({ width: 720, height: 450 })
  const dialog = await openSettings(page)

  for (const tab of ["General", "Shortcuts", "Servers", "Providers", "Models"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click()
    await expect(dialog.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible()
  }

  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(720)
  expect(box!.y + box!.height).toBeLessThanOrEqual(450)

  await dialog.getByRole("tab", { name: "General", exact: true }).focus()
  await page.keyboard.press("End")
  await expect(dialog.getByRole("tab", { name: "Models", exact: true })).toBeFocused()
})
