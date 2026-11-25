import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

test("the actual window owner stops and resumes the indicator when a native tab is hidden", async ({
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000)
  test.skip(
    process.platform === "linux" && !process.env.DISPLAY,
    "Native window visibility requires a headed X display; run with xvfb-run -a",
  )
  test.skip(
    !!process.env.CI || process.env.PLAYWRIGHT_BUILD === "1",
    "This native source-component probe requires the App development Vite server; built preview has no /@fs modules",
  )
  if (!baseURL) throw new Error("Native window visibility requires the App Vite base URL")

  const probe = spawn(
    "node",
    [fileURLToPath(new URL("../fixtures/native-window-visibility.mjs", import.meta.url)), baseURL],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 75_000,
    },
  )
  const output = { stdout: "", stderr: "" }
  probe.stdout.setEncoding("utf8")
  probe.stderr.setEncoding("utf8")
  probe.stdout.on("data", (chunk) => {
    output.stdout += chunk
  })
  probe.stderr.on("data", (chunk) => {
    output.stderr += chunk
  })
  const completed = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    probe.once("error", reject)
    probe.once("close", (code, signal) => resolve({ code, signal }))
  })
  await testInfo.attach("native-window-visibility-stdout", {
    body: Buffer.from(output.stdout),
    contentType: "text/plain",
  })
  await testInfo.attach("native-window-visibility-stderr", {
    body: Buffer.from(output.stderr),
    contentType: "text/plain",
  })
  expect(completed.signal).toBeNull()
  expect(completed.code, output.stderr).toBe(0)
})
