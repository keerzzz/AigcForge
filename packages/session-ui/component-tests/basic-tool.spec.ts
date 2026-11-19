import { expect, sourceURL, story } from "../../storybook/playwright/story"

const fixture = sourceURL(new URL("./basic-tool.fixture.tsx", import.meta.url))

story("does not render completed reasoning until it is opened", async ({ mount, page }) => {
  const root = await mount("current-session-timeline-rows--conversation", {
    args: { scenario: "reasoning", mode: "compact", text: "Response after reasoning" },
  })

  const reasoning = root.locator('[data-timeline-part-id="msg_projection_assistant:reasoning:0"]')
  const trigger = reasoning.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(reasoning.locator('[data-component="markdown"]')).toHaveCount(0)

  const cached = () =>
    page.evaluate(async (fixture) => {
      const { getCachedMarkdown } = await import(fixture)

      return !!getCachedMarkdown("msg_projection_assistant:reasoning:0:0:full")
    }, fixture)

  expect(await cached()).toBe(false)
  await trigger.click()
  await expect(
    reasoning.getByText("I will inspect the timeline before changing its state.", { exact: true }),
  ).toBeVisible()
  expect(await cached()).toBe(true)
})

story("constructs declared tool details lazily and keeps trigger contracts reactive", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => {
    const { mountBasicTool } = await import(fixture)
    mountBasicTool()
  }, fixture)
  const root = page.getByTestId("basic-tool-fixture")
  await expect(root.getByRole("button", { name: "Initial title", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(root.getByTestId("detail-mounts")).toHaveText("0")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")

  await root.getByLabel("Trigger label").fill("Updated title")
  await expect(root.getByTitle("Updated title", { exact: true })).toHaveText("Updated title")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")
  await expect(root.getByRole("button", { name: /Tool subtitle/ })).toHaveAccessibleName(
    /Updated title\s*Tool subtitle\s*path=src/,
  )
  await root.getByRole("button", { name: "Updated title", exact: true }).click()
  await expect(root.getByText("Tool details", { exact: true })).toBeVisible()
  await expect(root.getByTestId("detail-mounts")).toHaveText("1")

  await root.getByRole("button", { name: "Function: closed", exact: true }).click()
  await expect(root.getByText("Function details", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Function: open", exact: true }).click()
  await expect(root.getByText("Function details", { exact: true })).toBeHidden()
  await expect(root.getByRole("button", { name: "Function: closed", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")
})

story(
  "keeps execution feedback singular, themed and static after completion or reduced motion",
  async ({ mount, page }) => {
    const root = await mount("components-session-progress-indicator-v2--lifecycle")
    const progress = root.locator('[data-component="session-progress-indicator-v2"]')
    const task = root.locator('[data-component="collapsible"].tool-collapsible')
    const trigger = task.getByRole("button", { name: "Running task src/index.ts", exact: true })
    await expect(progress).toHaveCount(2)
    await expect(task.locator('[data-component="text-shimmer"]')).toHaveCount(0)
    await trigger.focus()
    await page.keyboard.press("Enter")
    await expect(task.getByText("Task details: inspect the actual result before accepting completion.")).toBeVisible()

    for (const theme of ["oc-2", "nord", "catppuccin", "icon-fallback"]) {
      await root.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme)
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
      for (const scheme of ["Light", "Dark"]) {
        await root.getByRole("button", { name: scheme, exact: true }).click()
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme.toLowerCase())
        const colors = await progress.first().evaluate((element) => ({
          icon: getComputedStyle(element).color,
          expected: getComputedStyle(document.documentElement).getPropertyValue("--v2-icon-icon-base"),
        }))
        expect(colors.icon).not.toBe("rgba(0, 0, 0, 0)")
        expect(colors.expected).not.toBe("")
      }
    }

    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(progress.first().locator("[data-progress-arc]")).toHaveCSS("animation-name", "none")
    await trigger.press("Enter")
    await expect(task.locator('[data-slot="collapsible-content"]')).toHaveCSS("height", "0px")
    await trigger.press("Enter")
    await expect(task.getByText("Task details: inspect the actual result before accepting completion.")).toBeVisible()

    const titleX = (await task.locator('[data-slot="basic-tool-tool-title"]').boundingBox())?.x
    for (const status of ["waiting", "completed", "failed", "cancelled"]) {
      await root.getByRole("button", { name: status, exact: true }).click()
      await expect(progress).toHaveCount(0)
      await expect(root.getByRole("status")).toHaveText("Session " + status)
      expect((await task.locator('[data-slot="basic-tool-tool-title"]').boundingBox())?.x).toBe(titleX)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  },
)
