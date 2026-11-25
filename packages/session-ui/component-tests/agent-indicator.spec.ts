import { expect, story } from "../../storybook/playwright/story"

story(
  "agent indicator runs in normal state and freezes on tool-motion, visibility, hidden, and reduced-motion",
  async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const component = await mount("components-session-progress-indicator-v2--agent-lifecycle")
    const wrapper = component.locator('[data-test="agent-wrapper"]')
    const first = wrapper.locator('[data-component="session-progress-indicator-v2"][data-variant="agent"]').first()

    const activeCount = () =>
      first.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length)

    expect(await activeCount()).toBe(5)

    // Freeze via data-tool-motion="false" (waiting / disconnected)
    await component.locator('[data-test="toggle-motion"]').click()
    await expect(wrapper).toHaveAttribute("data-tool-motion", "false")
    expect(await activeCount()).toBe(0)

    // Resume motion
    await component.locator('[data-test="toggle-motion"]').click()
    expect(await activeCount()).toBe(5)

    // Freeze via data-visible="false"
    await component.locator('[data-test="toggle-visible"]').click()
    await expect(wrapper).toHaveAttribute("data-visible", "false")
    expect(await activeCount()).toBe(0)

    // Resume visibility
    await component.locator('[data-test="toggle-visible"]').click()
    expect(await activeCount()).toBe(5)

    // Freeze via hidden
    await component.locator('[data-test="toggle-hidden"]').click()
    await expect(wrapper).toBeHidden()
    expect(await activeCount()).toBe(0)
    await component.locator('[data-test="toggle-hidden"]').click()
    expect(await activeCount()).toBe(5)

    // Freeze via prefers-reduced-motion: reduce
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect.poll(activeCount).toBe(0)
  },
)

story(
  "agent sizes preserve the viewport and the same explicit identity core as the static icon",
  async ({ mount, page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const component = await mount("components-session-progress-indicator-v2--agent-sizes")

    for (const size of [12, 14, 16, 18, 20, 24, 64]) {
      const row = component.locator(`[data-size="${size}"]`)
      const indicator = row.locator('[data-variant="agent"]')
      await expect(indicator).toHaveCSS("width", `${size}px`)
      await expect(indicator).toHaveCSS("height", `${size}px`)
      await expect(indicator).toHaveAttribute("viewBox", "0 0 100 100")
      await expect(indicator.locator("[data-core]")).toHaveAttribute("width", size < 24 ? "17" : "12.4")
      await expect(indicator.locator("[data-core]")).toHaveCSS("fill", "rgb(168, 79, 189)")
      expect(
        await indicator.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return Array.from(element.querySelectorAll("[data-wing], [data-core]")).every((part) => {
            const shape = part.getBoundingClientRect()
            return (
              shape.left >= bounds.left &&
              shape.right <= bounds.right &&
              shape.top >= bounds.top &&
              shape.bottom <= bounds.bottom
            )
          })
        }),
      ).toBe(true)
      const staticCore = await page.evaluate(
        async (screenshot) => {
          const image = new Image()
          image.src = `data:image/png;base64,${screenshot}`
          await image.decode()
          const canvas = new OffscreenCanvas(image.width, image.height)
          const context = canvas.getContext("2d")
          if (!context) throw new Error("Cannot read static icon pixels")
          context.drawImage(image, 0, 0)
          return Array.from(context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data)
        },
        (await row.locator('[data-slot="icon-svg"]').screenshot()).toString("base64"),
      )
      expect(staticCore).toEqual([168, 79, 189, 255])
    }
    await component.screenshot({ path: testInfo.outputPath("agent-sizes.png") })
  },
)
