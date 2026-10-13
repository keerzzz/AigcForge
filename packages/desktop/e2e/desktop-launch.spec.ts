import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Environment } from "../../app/e2e/real/environment"
import type { ElectronAPI, ServerReadyData } from "../src/preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __desktopSmokeDeepLinks?: string[]
  }
}

const execFileAsync = promisify(execFile)
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packagedExecutable = process.env.AIGCFROGE_DESKTOP_PACKAGED_EXECUTABLE
const launchArgs = packagedExecutable ? [] : [desktopRoot]
const deepLink = "aigcfroge://smoke/deep-link?source=desktop-launch"
const profileDirectory = "ai.aigcfroge.desktop.dev"
const restoredBounds = { x: 40, y: 60, width: 1024, height: 700 }

type PickerGlobal = typeof globalThis & { __desktopSmokePickerCalls?: number }

test("launches the real desktop stack with isolated state", async ({}, testInfo) => {
  const port = await unusedLoopbackPort()
  // Chromium's SingletonSocket must fit Linux's Unix-domain socket path limit.
  const runRoot = await mkdtemp(join(process.platform === "linux" ? "/tmp" : tmpdir(), "aigcfroge-desktop-smoke-"))
  let electronApp: ElectronApplication | undefined
  let tracingStarted = false

  try {
    Environment.prepare(runRoot)
    const env = isolatedEnv(runRoot, port)
    const workspaceDirectory = join(runRoot, "workspace")
    const userDataPath = join(env.XDG_CONFIG_HOME, profileDirectory)
    await Promise.all(
      [workspaceDirectory, userDataPath, env.AIGCFROGE_CONFIG_DIR, env.AIGCFROGE_TEST_MANAGED_CONFIG_DIR].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    )
    await writeFile(join(userDataPath, "window-state.json"), JSON.stringify(restoredBounds))
    // The launch smoke does not exercise terminals; its shell probe must not source login profiles.
    await writeFile(env.SHELL, "#!/bin/sh\nexec /usr/bin/env -0\n", { mode: 0o700 })

    electronApp = await electron.launch({
      executablePath: packagedExecutable,
      args: launchArgs,
      cwd: workspaceDirectory,
      env,
      artifactsDir: testInfo.outputPath("electron-artifacts"),
      timeout: 60_000,
    })
    // Electron contexts do not use Playwright's browser fixture trace lifecycle.
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
    tracingStarted = true

    const page = await electronApp.firstWindow()
    await page.waitForLoadState("domcontentloaded")

    await test.step("renderer and preload load through the real owners", async () => {
      expect(await electronApp!.evaluate(({ app }) => app.isPackaged)).toBe(Boolean(packagedExecutable))
      // Desktop updating is disabled by the compiled dev channel, independently of the backend flag.
      expect(await electronApp!.evaluate(({ app }) => app.getName())).toBe("Aigcfroge Dev")
      expect(await electronApp!.evaluate(({ app }) => app.getPath("home"))).toBe(env.HOME)
      expect(await electronApp!.evaluate(() => process.cwd())).toBe(env.HOME)
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
      const windowIDs = await electronApp!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.id),
      )
      expect(await page.evaluate(() => window.api.getWindowCount())).toBe(windowIDs.length)
      await page.evaluate(() => window.api.runDesktopMenuAction("window.new"))
      await expect.poll(() => page.evaluate(() => window.api.getWindowCount())).toBe(windowIDs.length + 1)
      await electronApp!.evaluate(({ BrowserWindow }, retained) => {
        BrowserWindow.getAllWindows()
          .filter((window) => !retained.includes(window.id))
          .forEach((window) => window.close())
      }, windowIDs)
      await expect.poll(() => page.evaluate(() => window.api.getWindowCount())).toBe(windowIDs.length)
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
        [...(process.platform === "linux" ? ["--no-sandbox"] : []), ...launchArgs, deepLink],
        { cwd: workspaceDirectory, env, timeout: 30_000 },
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
    try {
      if (electronApp && tracingStarted) {
        await electronApp.context().tracing.stop({ path: testInfo.outputPath("desktop-trace.zip") })
        await testInfo.attach("desktop-trace", {
          path: testInfo.outputPath("desktop-trace.zip"),
          contentType: "application/zip",
        })
      }
    } finally {
      try {
        await electronApp?.close()
        // Main-process exit alone does not certify that the sidecar released its listener.
        await expect
          .poll(
            () =>
              new Promise<boolean>((resolveClosed) => {
                const server = createServer()
                server.once("error", () => resolveClosed(false))
                server.listen(port, "127.0.0.1", () => server.close(() => resolveClosed(true)))
              }),
            { timeout: 10_000 },
          )
          .toBe(true)
      } finally {
        await rm(runRoot, { recursive: true, force: true })
      }
    }
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

function isolatedEnv(runRoot: string, port: number): Record<string, string> {
  return {
    ...Environment.create(runRoot, process.env),
    ...Object.fromEntries(
      ["DISPLAY", "XAUTHORITY"].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
    ),
    SHELL: join(runRoot, "shell"),
    AIGCFROGE_DB: ":memory:",
    AIGCFROGE_PORT: String(port),
    AIGCFROGE_CONFIG_DIR: join(runRoot, "config"),
    AIGCFROGE_TEST_MANAGED_CONFIG_DIR: join(runRoot, "managed-config"),
    AIGCFROGE_DISABLE_PROJECT_CONFIG: "true",
    AIGCFROGE_DISABLE_AUTOUPDATE: "true",
    AIGCFROGE_DISABLE_MODELS_FETCH: "true",
    AIGCFROGE_DISABLE_DEFAULT_PLUGINS: "true",
    AIGCFROGE_DISABLE_EXTERNAL_SKILLS: "true",
    AIGCFROGE_DISABLE_CLAUDE_CODE: "true",
    AIGCFROGE_DISABLE_LSP_DOWNLOAD: "true",
    npm_config_offline: "true",
  }
}

async function healthStatus(ready: ServerReadyData) {
  const authorization = Buffer.from(`${ready.username ?? ""}:${ready.password ?? ""}`).toString("base64")
  const response = await fetch(new URL("/global/health", ready.url), {
    headers: { authorization: `Basic ${authorization}` },
  })
  return response.status
}
