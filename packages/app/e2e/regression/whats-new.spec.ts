import { expect, test, type Page } from "@playwright/test"
import pkg from "../../package.json" with { type: "json" }
import { SERVER, type SeedInput } from "../utils/app"
import { expectAppVisible } from "../utils/waits"
import { mockWorkspace } from "../utils/workspace"

const current = pkg.version

const SEEN = "omnixa.global.dat:extension.updater.seen"

const RELEASE_NOTES = "omnixa.global.dat:extension.updater.releaseNotes"

for (const row of [
  { name: "first launch remembers the current version", seed: {}, disabled: false },
  {
    name: "reopening keeps the version already seen",
    seed: { storage: { [SEEN]: { version: current } } },
    disabled: false,
  },
  {
    name: "an upgrade records its version without a hosted highlights source",
    seed: { storage: { [SEEN]: { version: "0.0.1" } } },
    disabled: false,
  },
  {
    name: "an upgrade preserves the release notes preference",
    seed: { storage: { [SEEN]: { version: "0.0.1" }, [RELEASE_NOTES]: { enabled: false } } },
    disabled: true,
  },
]) {
  test(`What's New: ${row.name}`, async ({ page }) => {
    await start(page, row.seed)
    await expect.poll(() => stored(page, SEEN)).toEqual({ version: current })
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.reload()
    await expectAppVisible(page.getByRole("button", { name: "Settings", exact: true }))
    await expect.poll(() => stored(page, SEEN)).toEqual({ version: current })
    await expect(page.getByRole("dialog")).toHaveCount(0)

    if (row.disabled) expect(await stored(page, RELEASE_NOTES)).toEqual({ enabled: false })
  })
}

test("a rejected update check shows one failure title without repeating it as a description", async ({ page }) => {
  await mockWorkspace(page, { name: "UpdateCheck", sessions: [] })
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "stopped", updater: "" })}`,
  )
  const settings = page.getByTestId("settings-screen")
  const check = settings.getByRole("button", { name: "Check now", exact: true })
  await expect(check).toBeEnabled()
  await check.click()
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(1)
  await expect(page.getByText("You're up to date", { exact: true })).toHaveCount(0)
})

async function start(page: Page, seed: SeedInput) {
  await mockWorkspace(page, { name: "Whats New", sessions: [], seed })
  await page.goto("/")
  await expectAppVisible(page.getByRole("button", { name: "Settings", exact: true }))
}

function stored(page: Page, key: string) {
  return page.evaluate((name) => localStorage.getItem(name), key).then((raw) => JSON.parse(raw ?? "null"))
}
