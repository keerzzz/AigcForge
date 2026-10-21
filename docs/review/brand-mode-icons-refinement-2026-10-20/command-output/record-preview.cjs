const { chromium } = require("/home/keer/workspace/aigcfroge/node_modules/@playwright/test")
const { mkdir, writeFile } = require("node:fs/promises")
const root = "/home/keer/workspace/aigcfroge/docs/review/brand-mode-icons-refinement-2026-10-20"
async function run() {
  await mkdir("/tmp/brand-refinement-video", { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1080 },
    recordVideo: { dir: "/tmp/brand-refinement-video", size: { width: 1200, height: 1080 } },
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(
      "http://127.0.0.1:3000/@fs/home/keer/workspace/aigcfroge/docs/review/brand-mode-icons-refinement-2026-10-20/preview.html",
    )
    await page.waitForFunction(() => window.previewReady)
    await page.locator("#replay").click()
    await page.evaluate(async () => {
      const animations = [...document.querySelectorAll('[data-component="logo-splash"]')].flatMap((svg) =>
        svg.getAnimations({ subtree: true }),
      )
      if (animations.length !== 16) throw new Error(`Expected 16 part animations, received ${animations.length}`)
      await Promise.all(animations.map((animation) => animation.finished))
    })
    await page.screenshot({ path: root + "/screenshots/wordmark-splash-matrix.png", fullPage: true })
    const frames = await page.evaluate(() =>
      [0, 150, 550, 1100].map((time) => {
        document.querySelectorAll('[data-component="logo-splash"]').forEach((svg) =>
          svg.getAnimations({ subtree: true }).forEach((animation) => {
            animation.pause()
            animation.currentTime = time
          }),
        )
        return {
          time,
          samples: [...document.querySelectorAll('[data-component="logo-splash"]')].map((svg) => ({
            tone: svg.closest("[data-tone]").dataset.tone,
            width: svg.getBoundingClientRect().width,
            height: svg.getBoundingClientRect().height,
            parts: [...svg.children].map((part) => ({
              slot: part.dataset.slot,
              transform: getComputedStyle(part).transform,
              opacity: getComputedStyle(part).opacity,
            })),
          })),
        }
      }),
    )
    const wordmark = page.locator('[data-tone="light"] [data-preview="wordmark"]')
    await wordmark.screenshot({ path: root + "/screenshots/wordmark-r-refined.png" })
    await context.close()
    const video = page.video()
    if (!video) throw new Error("Video recording was not enabled")
    await video.saveAs(root + "/screenshots/splash-assemble.webm")
    await writeFile(root + "/command-output/animation-frames.json", JSON.stringify({ errors, frames }, null, 2) + "\n")
    if (errors.length) throw new Error(errors.join("\n"))
    process.stdout.write("Recorded 16 production part animations; 0 page errors.\n")
  } finally {
    await browser.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
