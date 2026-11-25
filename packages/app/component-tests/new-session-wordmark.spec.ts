import { expect, sourceURL, story } from "../../storybook/playwright/story"

const splashFixture = sourceURL(new URL("../../desktop/src/renderer/startup/splash.fixture.tsx", import.meta.url))

for (const theme of ["light", "dark"]) {
  for (const direction of ["ltr", "rtl"]) {
    story(`shimmers once over the visible wordmark (${theme}, ${direction})`, async ({ mount, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "no-preference" })
      const component = await mount("app-new-session-wordmark--reveal", { globals: { theme, direction } })
      const logo = component.locator('[data-component="new-session-wordmark"]')
      const reveal = logo.locator('[data-slot="wordmark-reveal"]')
      const shimmer = logo.locator(".wordmark-shimmer")
      const base = logo.locator("svg:not(.wordmark-shimmer)")
      await expect(base).toHaveCSS("opacity", "0.16")
      await expect(shimmer).toHaveCSS("animation-iteration-count", "1")
      await expect(logo.locator("g[mask]")).toHaveCount(0)
      await expect(shimmer).toHaveCSS("color", "rgb(255, 255, 255)")
      await expect(shimmer).toHaveCSS("mix-blend-mode", "screen")
      await expect(base).toHaveAttribute("aria-label", "Omnixa")
      await expect(base.locator('path[fill="currentColor"]')).toHaveCount(1)

      await logo.evaluate((element) => {
        element.getAnimations({ subtree: true }).forEach((animation) => {
          animation.pause()
          animation.currentTime = 0
        })
      })
      await expect(reveal).toHaveCSS("opacity", "1")
      await expect(reveal).toHaveCSS("animation-name", "none")
      await expect(shimmer).toHaveCSS("mask-position", "100% 0px")

      await logo.evaluate((element) => {
        element.getAnimations({ subtree: true }).forEach((animation) => (animation.currentTime = 400))
      })
      await expect(shimmer).toHaveCSS("mask-position", "50% 0px")
      await expect(shimmer).toHaveCSS("opacity", theme === "dark" ? "0.0672" : "0.45")
      const swept = await logo.screenshot({ path: testInfo.outputPath("wordmark-shimmer.png") })

      await logo.evaluate((element) => {
        element.getAnimations({ subtree: true }).forEach((animation) => animation.finish())
      })
      await expect(reveal).toHaveCSS("opacity", "1")
      await expect(shimmer).toHaveCSS("opacity", "0")
      await expect(shimmer).toHaveCSS("mask-position", "0% 0px")
      const settled = await logo.screenshot({ path: testInfo.outputPath("wordmark-settled.png") })

      const brightness = await page.evaluate(
        async (screenshots) => {
          const pixels = await Promise.all(
            screenshots.map(async (screenshot) => {
              const image = new Image()
              image.src = `data:image/png;base64,${screenshot}`
              await image.decode()
              const canvas = new OffscreenCanvas(image.width, image.height)
              const context = canvas.getContext("2d")

              if (!context) throw new Error("Cannot read screenshot pixels")
              context.drawImage(image, 0, 0)

              return context.getImageData(0, 0, image.width, image.height).data
            }),
          )

          return {
            min: pixels[0].reduce(
              (min, value, index) => (index % 4 === 3 ? min : Math.min(min, value - pixels[1][index])),
              0,
            ),
            max: pixels[0].reduce(
              (max, value, index) => (index % 4 === 3 ? max : Math.max(max, value - pixels[1][index])),
              0,
            ),
          }
        },
        [swept.toString("base64"), settled.toString("base64")],
      )

      expect(brightness.min).toBeGreaterThanOrEqual(0)
      expect(brightness.max).toBeGreaterThanOrEqual(5)
    })
  }

  story(`shows a static wordmark with reduced motion (${theme})`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.setViewportSize({ width: 360, height: 640 })
    const component = await mount("app-new-session-wordmark--reveal", { globals: { theme } })
    const logo = component.locator('[data-component="new-session-wordmark"]')
    await expect(logo.locator("svg:not(.wordmark-shimmer)")).toHaveCSS("opacity", "0.16")
    await expect(logo.locator('[data-slot="wordmark-reveal"]')).toHaveCSS("opacity", "1")
    await expect(logo.locator(".wordmark-shimmer")).toHaveCSS("opacity", "0")
    expect(await logo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
    expect(await logo.evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true)
  })
}

story("waits for an uncovered visible surface and does not replay after completion", async ({ mount }) => {
  const component = await mount("app-new-session-wordmark--startup-handoff")
  const logo = component.locator('[data-component="new-session-wordmark"]')
  expect(await logo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  await component.getByRole("button", { name: "Hide wordmark", exact: true }).click()
  await component.getByRole("button", { name: "Reveal work surface", exact: true }).click()
  expect(await logo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  await component.getByRole("button", { name: "Show wordmark", exact: true }).click()
  await expect(logo.locator(".wordmark-shimmer")).toHaveCSS("animation-name", "new-session-wordmark-shimmer")
  await logo.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    animations.forEach((animation) => animation.finish())
    await Promise.allSettled(animations.map((animation) => animation.finished))
  })
  await expect(logo).toHaveAttribute("data-complete", "true")
  await expect(logo.locator(".wordmark-shimmer")).toHaveCSS("mask-position", "0% 0px")
  await component.getByRole("button", { name: "Hide wordmark", exact: true }).click()
  await component.getByRole("button", { name: "Show wordmark", exact: true }).click()
  await component.getByRole("button", { name: "Cover work surface", exact: true }).click()
  await component.getByRole("button", { name: "Reveal work surface", exact: true }).click()
  expect(await logo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
})

story("first-launch drawing keeps four wings and reports one completion", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await mount("app-new-session-wordmark--reveal")
  await page.evaluate(async (fixture) => {
    const { mountStartupSplash } = await import(fixture)
    mountStartupSplash({ firstLaunch: true, preview: false })
  }, splashFixture)
  const splash = page.locator('[data-component="first-launch-splash"]')
  const wordmark = splash.getByRole("img", { name: "Omnixa", includeHidden: true })
  await expect(wordmark.locator("path")).toHaveCount(2)
  await expect(wordmark.locator('path[pathLength="1"]')).toHaveCount(2)
  await splash.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    animations.forEach((animation) => animation.finish())
    await Promise.allSettled(animations.map((animation) => animation.finished))
  })
  await expect(page.getByLabel("Drawing completions", { exact: true })).toHaveText("1")
  const wings = await splash.locator('[data-component="logo-splash"] [data-slot^="wing-"]').evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        slot: element.getAttribute("data-slot"),
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }
    }),
  )
  const top = wings.find((wing) => wing.slot === "wing-top")
  const right = wings.find((wing) => wing.slot === "wing-right")
  const bottom = wings.find((wing) => wing.slot === "wing-bottom")
  const left = wings.find((wing) => wing.slot === "wing-left")
  if (!top || !right || !bottom || !left) throw new Error("Expected all four startup wings")
  expect(top.y).toBeLessThan(bottom.y)
  expect(left.x).toBeLessThan(right.x)
  expect(top.x).toBeCloseTo(bottom.x, 1)
  expect(left.y).toBeCloseTo(right.y, 1)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.getByLabel("Drawing completions", { exact: true })).toHaveText("1")
})

story("reduced-motion first launch settles without animation events", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await mount("app-new-session-wordmark--reveal")
  await page.evaluate(async (fixture) => {
    const { mountStartupSplash } = await import(fixture)
    mountStartupSplash({ firstLaunch: true, preview: false })
  }, splashFixture)
  const splash = page.locator('[data-component="first-launch-splash"]')
  await expect(page.getByLabel("Drawing completions", { exact: true })).toHaveText("1")
  expect(await splash.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
})
