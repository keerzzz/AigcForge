import { expect, type Page } from "@playwright/test"

export async function openSidePanel(page: Page, title: string) {
  if ((page.viewportSize()?.width ?? (await page.evaluate(() => window.innerWidth))) < 768) {
    await page
      .getByRole("tablist", { name: "Session view", exact: true })
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    const drawer = page.getByRole("dialog")
    await drawer.getByRole("button", { name: title, exact: true }).click()
    await expect(drawer).toBeHidden()

    return
  }

  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  await expect(toggle).toBeVisible()

  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()

  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const tab = page.locator("#review-panel").getByRole("tab", { name: title, exact: true })

  if (await tab.count()) {
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")

    return
  }

  await page.locator("#review-panel").getByRole("button", { name: "Add tab", exact: true }).click()
  const launcher = page.locator('#review-panel [data-component="session-panel-launcher"]')

  await expect(launcher).toBeVisible()
  await launcher.getByRole("button", { name: title, exact: true }).click()
  await expect(page.locator("#review-panel").getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0)
  await expect(tab).toHaveAttribute("aria-selected", "true")
}

export async function attachSession(page: Page, input: { server: string; sessionID: string; title: string }) {
  await openSidePanel(page, "Task delegation")

  const panel = page.locator("#session-side-panel-collaborations-tabpanel")
  const back = panel.getByRole("button", { name: "Back to collaborations", exact: true })

  if (await back.count()) await back.click()

  const attach = panel
    .getByRole("region", { name: "Task delegation", exact: true })
    .locator('[data-slot="session-content-sources"]')
    .getByRole("button", { name: "Attach session", exact: true })

  await expect(attach).toBeEnabled()
  await attach.click()

  const picker = page.getByRole("dialog", { name: "Open sessions", exact: true })
  const candidate = picker.getByRole("button", { name: input.title, exact: true })

  await expect(candidate).toHaveCount(1)
  await expect(candidate).toHaveText(input.title)
  await expect(candidate).toHaveAttribute("data-key", `${input.server}\n${input.sessionID}`)
  await expect(candidate).toBeEnabled()
  await candidate.click()
  await expect(picker).toHaveCount(0)
  await expect(
    page
      .getByRole("region", { name: "Session views", exact: true })
      .locator('[data-slot="session-content-heading"]')
      .getByRole("heading", { name: input.title, exact: true }),
  ).toBeVisible()
}

export async function openAdvanced(page: Page) {
  await openSidePanel(page, "Task delegation")

  const advanced = page.getByRole("region", { name: "Advanced management", exact: true })

  if (await advanced.count()) {
    await expect(advanced).toBeVisible()

    return
  }

  const back = page.getByRole("button", { name: "Back to collaborations", exact: true })

  if (await back.count()) await back.click()

  await page
    .getByRole("region", { name: "Task delegation", exact: true })
    .getByRole("button", { name: "Advanced management", exact: true })
    .click()
  await expect(advanced).toBeVisible()
}
