// Runs from the owning App package; the Playwright keeper supplies its local Vite base URL.
// Without a URL this probes native visibility; App mode also checks the actual window owner and indicator.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { scheduler } from "node:timers/promises"

if (process.platform === "linux" && !process.env.DISPLAY)
  throw new Error("A headed display is required; run with xvfb-run -a")
const require = createRequire(join(process.cwd(), "package.json"))
const executable = require("@playwright/test").chromium.executablePath()
const initialURL = process.argv[2] ?? "about:blank"
const app = initialURL !== "about:blank"
if (
  app &&
  (new URL(initialURL).protocol !== "http:" || !["127.0.0.1", "localhost"].includes(new URL(initialURL).hostname))
)
  throw new Error("App probe URL must be a local HTTP fixture")
const profile = mkdtempSync(join(tmpdir(), "omnxa-native-visibility-"))
const chrome = spawn(
  executable,
  [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-sandbox",
    "--window-size=900,700",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
)
let stderr = "",
  socket,
  id = 0
const pending = new Map()
chrome.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-3000)
})
function request(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const serial = ++id
    pending.set(serial, { resolve, reject })
    socket.send(JSON.stringify({ id: serial, method, params, sessionId }))
  })
}
async function probe() {
  const portFile = join(profile, "DevToolsActivePort")
  while (!existsSync(portFile)) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}: ${stderr}`)
    await scheduler.wait(50)
  }
  const [port, route] = readFileSync(portFile, "utf8").trim().split("\n")
  socket = new WebSocket(`ws://127.0.0.1:${port}${route}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data)),
      waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) {
      waiting.reject(new Error(JSON.stringify(message.error)))
      return
    }
    waiting.resolve(message.result)
  }
  socket.onclose = () => {
    for (const waiting of pending.values()) waiting.reject(new Error("Native CDP closed"))
    pending.clear()
  }
  const context = await request("Target.createBrowserContext", { disposeOnDetach: true })
  const first = await request("Target.createTarget", {
    url: initialURL,
    newWindow: true,
    browserContextId: context.browserContextId,
  })
  const attached = await request("Target.attachToTarget", { targetId: first.targetId, flatten: true })
  const second = await request("Target.createTarget", {
    url: "about:blank",
    newWindow: false,
    browserContextId: context.browserContextId,
  })
  const windows = await Promise.all(
    [first, second].map((target) => request("Browser.getWindowForTarget", { targetId: target.targetId })),
  )
  const evaluate = async (expression) => {
    const response = await request(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      attached.sessionId,
    )
    if (response.exceptionDetails)
      throw new Error(`App evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
    return response.result.value
  }
  const observe = () =>
    evaluate(
      "({ visibility: document.visibilityState, focus: document.hasFocus(), windowVisible: document.documentElement.dataset.windowVisible, running: document.querySelector('#omnxa-native-probe svg')?.getAnimations({subtree:true}).filter(a => a.playState === 'running').length, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })",
    )
  const waitFor = async (predicate, label) => {
    const end = Date.now() + 30000
    let state
    while (Date.now() < end) {
      state = await observe()
      if (predicate(state)) return state
      await scheduler.wait(100)
    }
    throw new Error(`${label} did not settle: ${JSON.stringify(state)}`)
  }
  if (app) {
    await request("Target.activateTarget", { targetId: first.targetId })
    await waitFor((state) => state.windowVisible === "true", "Actual App BodyTypography visibility owner")
    const solidDirectory = dirname(require.resolve("solid-js/package.json"))
    const solidPackage = JSON.parse(readFileSync(join(solidDirectory, "package.json"), "utf8"))
    const web = "/@fs" + join(solidDirectory, solidPackage.exports["./web"].browser.import)
    const indicator = "/@fs" + require.resolve("@omnixa/session-ui/v2/session-progress-indicator-v2")
    await evaluate(`(async () => {
      const { render } = await import(${JSON.stringify(web)})
      const { SessionProgressIndicatorV2 } = await import(${JSON.stringify(indicator)})
      const root = document.createElement('div'); root.id = 'omnxa-native-probe'; document.body.append(root)
      render(() => SessionProgressIndicatorV2({variant:'agent',width:16,height:16}), root)
      return !!root.querySelector('svg')
    })()`)
    await waitFor((state) => state.running === 5, "Actual SessionProgressIndicatorV2 running state")
  }
  await request("Target.activateTarget", { targetId: second.targetId })
  const hidden = app
    ? await waitFor(
        (state) => state.visibility === "hidden" && state.windowVisible === "false" && state.running === 0,
        "Actual App hidden stop",
      )
    : await waitFor((state) => state.visibility === "hidden", "Native background visibility")
  await request("Target.activateTarget", { targetId: first.targetId })
  const visible = app
    ? await waitFor(
        (state) => state.visibility === "visible" && state.windowVisible === "true" && state.running === 5,
        "Actual App foreground resume",
      )
    : await waitFor((state) => state.visibility === "visible", "Native foreground visibility")
  const result = {
    executable,
    browser: await request("Browser.getVersion"),
    windows,
    hidden,
    visible,
    pageFocusEmulationCommandsSent: 0,
    appIntegration: app ? "actual_owner_and_component_observed" : "not_tested",
  }
  console.log(JSON.stringify(result, null, 2))
  assert.equal(windows[0].windowId, windows[1].windowId, "Targets must belong to the same native window")
  assert.equal(hidden.visibility, "hidden", "Native background target must be hidden")
  assert.equal(visible.visibility, "visible", "Native foreground target must be visible")
}
let deadline
try {
  await Promise.race([
    probe(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`Native probe timed out: ${stderr}`)), app ? 60000 : 15000)
    }),
  ])
} finally {
  clearTimeout(deadline)
  socket?.close()
  if (chrome.exitCode === null) {
    const exited = once(chrome, "exit")
    chrome.kill("SIGTERM")
    await exited
  }
  rmSync(profile, { recursive: true, force: true })
}
