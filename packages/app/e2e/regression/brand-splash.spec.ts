import { expect, test } from "@playwright/test"

test.describe("shared loading brand", () => {
  for (const scenario of [
    { name: "light", colorScheme: "light", reducedMotion: "no-preference", width: 1280 },
    { name: "dark", colorScheme: "dark", reducedMotion: "no-preference", width: 1280 },
    { name: "narrow", colorScheme: "light", reducedMotion: "no-preference", width: 390 },
    { name: "reduced-motion", colorScheme: "dark", reducedMotion: "reduce", width: 1280 },
  ] as const) {
    test(`assembles the splash and respects motion preferences (${scenario.name})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: scenario.width, height: 844 })
      await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: scenario.reducedMotion })
      await page.addInitScript((tone) => localStorage.setItem("aigcfroge-color-scheme", tone), scenario.colorScheme)
      await page.goto("/e2e/fixtures/brand-splash.html", { waitUntil: "domcontentloaded" })
      const splash = page.locator('[data-component="logo-splash"]')
      await expect(splash).toBeVisible()
      await expect(splash).toHaveAttribute("data-motion", "assemble")
      await expect(splash).toHaveAttribute("aria-hidden", "true")
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scenario.colorScheme)
      await expect(splash).toHaveCSS("width", "64px")
      await expect(splash).toHaveCSS("height", "80px")
      await expect(splash).toHaveCSS("animation-name", "none")
      await expect(splash.locator(":scope > [data-slot]")).toHaveCount(4)

      if (scenario.reducedMotion === "no-preference") {
        const frames = await splash.evaluate((svg) => {
          const animations = svg.getAnimations({ subtree: true })
          return [0, 150].map((time) => {
            animations.forEach((animation) => {
              animation.pause()
              animation.currentTime = time
            })
            return Array.from(svg.children).map((part) => {
              const style = getComputedStyle(part)
              const matrix = new DOMMatrix(style.transform)
              return {
                x: matrix.e,
                y: matrix.f,
                opacity: Number(style.opacity),
                iterations: style.animationIterationCount,
              }
            })
          })
        })
        expect(frames[0][0].x).toBeLessThan(0)
        expect(frames[0][1].x).toBeGreaterThan(0)
        expect(frames[0][2].y).toBeLessThan(0)
        expect(frames[0][3].y).toBeGreaterThan(0)
        frames[0].forEach((part, index) => {
          expect(part.opacity).toBe(0)
          expect(part.iterations).toBe("1")
          expect(frames[1][index].opacity).toBeGreaterThan(0)
          expect(Math.hypot(frames[1][index].x, frames[1][index].y)).toBeLessThan(Math.hypot(part.x, part.y))
        })
        await page.screenshot({ path: testInfo.outputPath(`loading-${scenario.name}-enter.png`) })
        await splash.evaluate(async (svg) => {
          const animations = svg.getAnimations({ subtree: true })
          animations.forEach((animation) => animation.finish())
          await Promise.all(animations.map((animation) => animation.finished))
        })
      }

      const settled = await splash.evaluate((svg) =>
        Array.from(svg.children).map((part) => {
          const style = getComputedStyle(part)
          return {
            identity: new DOMMatrix(style.transform === "none" ? undefined : style.transform).isIdentity,
            opacity: style.opacity,
            animation: style.animationName,
          }
        }),
      )
      settled.forEach((part) => {
        expect(part.identity).toBe(true)
        expect(part.opacity).toBe("1")
        if (scenario.reducedMotion === "reduce") expect(part.animation).toBe("none")
      })
      await page.screenshot({ path: testInfo.outputPath(`loading-${scenario.name}-settled.png`) })
    })
  }
})
