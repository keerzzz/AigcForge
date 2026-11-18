import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-collapse-state.spec.ts
story("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "streaming" } })
  const tool = timeline.locator('[data-timeline-part-id="tool_edit_status"]')
  const trigger = tool.locator('[data-scope="apply-patch"] button')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await tool.evaluate((element) => element.setAttribute("data-regression-marker", "before-stream"))
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.getByRole("button", { name: "Stream sibling content" }).click()
  await expect(timeline.getByText("Streaming added a later assistant text part.", { exact: true })).toBeVisible()
  await expect(tool).toHaveAttribute("data-regression-marker", "before-stream")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(tool.locator("xpath=ancestor::*[@data-timeline-row]")).toHaveAttribute(
    "data-timeline-row",
    "AssistantPart",
  )
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders interruption independently when the turn is not compacted", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  await expect(timeline.getByText("Interrupted", { exact: true })).toBeVisible()
  await expect(timeline.getByText("Before", { exact: true })).toBeVisible()
  await expect(timeline.getByText("After", { exact: true })).toBeVisible()

  const rows = await timeline
    .locator('[data-timeline-row="AssistantPart"], [data-timeline-row="TurnDivider"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))

  expect(rows).toEqual(["AssistantPart", "TurnDivider", "AssistantPart"])
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders aliased and long custom model notices", async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 700 })
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "models" } })
  const shortName = "GPT-5.4 nano"
  const longName = "Company Gateway Extra Long Context Model for Narrow Timeline Layouts"
  const short = timeline.locator('[data-slot="session-timeline-notice"]').filter({ hasText: shortName })
  const long = timeline.locator('[data-slot="session-timeline-notice"]').filter({ hasText: longName })
  await expect(short).toBeVisible()
  await expect(short.getByText(`Switched to ${shortName}`, { exact: true })).toBeVisible()
  await expect(short.locator('[data-slot="session-timeline-notice-variant"]')).toHaveText("xhigh")
  await expect(timeline.getByText("fast-nano", { exact: true })).toHaveCount(0)
  await expect(short.locator('[data-component="provider-icon"]')).toBeVisible()
  await expect(long).toBeVisible()
  await expect(long.locator('[data-component="provider-icon"]')).toBeVisible()
  await expect(long.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(long.locator("[title]")).toHaveAttribute("title", `Switched to ${longName}`)
  await expect.poll(() => long.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders user image, file attachment, file reference, and agent reference", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "attachments" } })
  await expect(timeline.getByAltText("pixel.png")).toBeVisible()
  await expect(timeline.getByText("tsconfig.json")).toBeVisible()
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(timeline.getByText("@explore", { exact: true })).toBeVisible()
})

story("mixed inline references retain exact server identity and follow deletion or disconnection", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "coordination" } })
  const first = timeline.getByRole("button", { name: "Session Newest title A on server-a", exact: true })
  const second = timeline.getByRole("button", { name: "Session Newest title B on server-b", exact: true })
  await expect(timeline.getByText("@build", { exact: true })).toBeVisible()
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(first).toBeEnabled()
  await expect(second).toBeEnabled()
  await second.click()
  await expect(timeline.getByLabel("Opened Session reference")).toHaveText('{"serverID":"server-b","sessionID":"ses_same","title":"Saved title","scope":{"kind":"through","messageID":"msg_saved_boundary"}}')
  await timeline.getByRole("button", { name: "Mark remote reference deleted", exact: true }).click()
  await expect(second).toBeDisabled()
  await expect(first).toBeEnabled()
  await first.click()
  await expect(timeline.getByLabel("Opened Session reference")).toHaveText('{"serverID":"server-a","sessionID":"ses_same","title":"Saved title","scope":{"kind":"identity"}}')
  await timeline.getByRole("button", { name: "Disconnect remote reference", exact: true }).click()
  await expect(second).toBeDisabled()
  await expect(first).toBeEnabled()
})
