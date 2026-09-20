import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { ElectronAPI, ServerReadyData } from "../src/preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __desktopSmokeDeepLinks?: string[]
  }
}

const execFileAsync = promisify(execFile)
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const deepLink = "aigcfroge://smoke/deep-link?source=desktop-launch"
const profileDirectory = "ai.aigcfroge.desktop.dev"
const restoredBounds = { x: 40, y: 60, width: 1024, height: 700 }

type PickerGlobal = typeof globalThis & { __desktopSmokePickerCalls?: number }

test("launches the real desktop stack with isolated state", async () => {
  const runRoot = await mkdtemp(join(tmpdir(), "aigcfroge-desktop-smoke-"))
  const configRoot = join(runRoot, "config")
  const dataRoot = join(runRoot, "data")
  const cacheRoot = join(runRoot, "cache")
  const stateRoot = join(runRoot, "state")
  const tempRoot = join(runRoot, "tmp")
  const userDataPath = join(configRoot, profileDirectory)

  await Promise.all(
    [configRoot, dataRoot, cacheRoot, stateRoot, tempRoot, userDataPath].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  await writeFile(join(userDataPath, "window-state.json"), JSON.stringify(restoredBounds))

  const port = await unusedLoopbackPort()
  const env = isolatedEnv({ configRoot, dataRoot, cacheRoot, stateRoot, tempRoot, port })
  let electronApp: ElectronApplication | undefined

  try {
    electronApp = await electron.launch({
      args: [desktopRoot],
      cwd: desktopRoot,
      env,
      artifactsDir: join(runRoot, "playwright-artifacts"),
      timeout: 60_000,
    })

    const page = await electronApp.firstWindow()
    await page.waitForLoadState("domcontentloaded")

    await test.step("renderer and preload load through the real owners", async () => {
      expect(page.url()).toBe("oc://renderer/index.html")
      expect(await electronApp!.evaluate(({ app }) => app.getPath("userData"))).toBe(userDataPath)
      await expect.poll(() => page.locator("#root").evaluate((root) => root.childElementCount)).toBeGreaterThan(0)

      const missingMethods = await page.evaluate(() => {
        const api = window.api
        const methods = [
          "awaitInitialization",
          "getWindowCount",
          "onDeepLink",
          "openFilePicker",
          "runDesktopMenuAction",
          "setZoomFactor",
          "getZoomFactor",
          "updater",
        ] as const
        return methods.filter((method) => !(method in api))
      })
      expect(missingMethods).toEqual([])
    })

    const ready = await page.evaluate(() => window.api.awaitInitialization())
    await test.step("sidecar binds an isolated port and reports healthy", async () => {
      expect(ready.username).toBe("aigcfroge")
      expect(ready.password).toMatch(/[0-9a-f-]{36}/)
      expect(new URL(ready.url).hostname).toBe("127.0.0.1")
      expect(Number(new URL(ready.url).port)).toBe(port)
      expect(port).not.toBe(3000)
      await expect.poll(() => healthStatus(ready), { timeout: 30_000 }).toBe(200)
    })

    await test.step("restores the window, reports DPI, and applies native zoom", async () => {
      await expect
        .poll(() =>
          electronApp!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((window) => window.isVisible()),
          ),
        )
        .toBe(true)

      const bounds = await electronApp!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
      expect(bounds).toMatchObject(restoredBounds)

      const scaleFactor = await electronApp!.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor)
      expect(scaleFactor).toBeGreaterThan(0)

      expect(await page.evaluate(() => window.api.getZoomFactor())).toBeCloseTo(1, 5)
      await page.keyboard.press("Control+Equal")
      await expect.poll(() => page.evaluate(() => window.api.getZoomFactor())).toBeCloseTo(1.2, 5)
      await page.keyboard.press("Control+Digit0")
      await expect.poll(() => page.evaluate(() => window.api.getZoomFactor())).toBeCloseTo(1, 5)
      await page.evaluate(() => window.api.setZoomFactor(1.25))
      await expect.poll(() => page.evaluate(() => window.api.getZoomFactor())).toBeCloseTo(1.25, 5)
    })

    await test.step("runs a menu-owned window action", async () => {
      const windowCount = await page.evaluate(() => window.api.getWindowCount())
      await page.evaluate(() => window.api.runDesktopMenuAction("window.new"))
      await expect.poll(() => page.evaluate(() => window.api.getWindowCount())).toBe(windowCount + 1)
      await electronApp!.evaluate(({ BrowserWindow }, keepCount) => {
        const windows = BrowserWindow.getAllWindows()
        for (const window of windows.slice(keepCount)) window.close()
      }, windowCount)
      await expect.poll(() => page.evaluate(() => window.api.getWindowCount())).toBe(windowCount)
    })

    await test.step("delivers a second-instance deep link to the renderer", async () => {
      await page.evaluate(() => {
        window.__desktopSmokeDeepLinks = []
        window.api.onDeepLink((urls) => {
          window.__desktopSmokeDeepLinks = [...(window.__desktopSmokeDeepLinks ?? []), ...urls]
        })
      })

      const electronExecutable = electronApp!.process().spawnfile
      await execFileAsync(
        electronExecutable,
        [...(process.platform === "linux" ? ["--no-sandbox"] : []), desktopRoot, deepLink],
        { cwd: desktopRoot, env, timeout: 30_000 },
      )

      await expect.poll(() => page.evaluate(() => window.__desktopSmokeDeepLinks ?? [])).toEqual([deepLink])
    })

    await test.step("handles picker cancellation and updater failure without crashing", async () => {
      await electronApp!.evaluate(({ dialog }) => {
        const target = globalThis as PickerGlobal
        target.__desktopSmokePickerCalls = 0
        Object.defineProperty(dialog, "showOpenDialog", {
          configurable: true,
          value: async () => {
            target.__desktopSmokePickerCalls = (target.__desktopSmokePickerCalls ?? 0) + 1
            return { canceled: true, filePaths: [] }
          },
        })
      })

      const pickerResult = await page.evaluate(() => window.api.openFilePicker({ title: "Desktop launch smoke" }))
      expect(pickerResult).toBeNull()
      expect(await electronApp!.evaluate(() => (globalThis as PickerGlobal).__desktopSmokePickerCalls)).toBe(1)

      const updater = await page.evaluate(async () => {
        const api = window.api
        const state = await api.updater.check()
        const installFailure = await api.updater.install().then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
        return { state, installFailure }
      })
      expect(updater.state).toEqual({ status: "disabled" })
      expect(updater.installFailure).toContain("Update is not ready to install")
      expect(await page.evaluate(() => window.api.getWindowCount())).toBe(1)
    })
  } finally {
    await electronApp?.close()
    await rm(runRoot, { recursive: true, force: true })
  }
})

async function unusedLoopbackPort() {
  const server = createServer()
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListening)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Failed to allocate loopback port")
  const port = address.port
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()))
  })
  if (port === 3000) return unusedLoopbackPort()
  return port
}

function isolatedEnv(input: {
  configRoot: string
  dataRoot: string
  cacheRoot: string
  stateRoot: string
  tempRoot: string
  port: number
}) {
  const env = Object.entries(process.env).reduce<Record<string, string>>((result, [key, value]) => {
    if (value === undefined || key.startsWith("AIGCFROGE_")) return result
    if (key === "ELECTRON_RUN_AS_NODE" || key === "NODE_OPTIONS") return result
    result[key] = value
    return result
  }, {})
  Object.assign(env, {
    SHELL: "/bin/sh",
    TMPDIR: input.tempRoot,
    XDG_CONFIG_HOME: input.configRoot,
    XDG_DATA_HOME: input.dataRoot,
    XDG_CACHE_HOME: input.cacheRoot,
    XDG_STATE_HOME: input.stateRoot,
    AIGCFROGE_DB: ":memory:",
    AIGCFROGE_PORT: String(input.port),
  })
  return env
}

async function healthStatus(ready: ServerReadyData) {
  const authorization = Buffer.from(`${ready.username ?? ""}:${ready.password ?? ""}`).toString("base64")
  const response = await fetch(new URL("/global/health", ready.url), {
    headers: { authorization: `Basic ${authorization}` },
  })
  return response.status
}
