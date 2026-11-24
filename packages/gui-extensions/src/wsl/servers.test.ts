import { expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import type { WslServerConfig } from "./contract"
import { createWslRuntime, type WslRuntime } from "./runtime"
import { createWslServersController } from "./servers"
import { addServerViewModel, wslDistroReady } from "./model"

test("teardown during a pending start resolves only after the started process exited", async () => {
  const children: ChildProcess[] = []
  const saved: WslServerConfig[] = []

  const controller = createWslServersController({
    cli: { version: "1.0.0" },
    runtime: {} as WslRuntime,
    t: (key) => key,
    log: () => undefined,
    installCli: async () => undefined,
    readServers: () => saved,
    writeServers: (servers) => saved.splice(0, saved.length, ...servers),
    // A real server process that never turns healthy; an abort ends it and rejects once it exited.
    spawnSidecar: (_distro, signal) => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
      children.push(child)

      return new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            child.once("exit", () => reject(signal.reason))
            child.kill()
          },
          { once: true },
        ),
      )
    },
  })

  await controller.addServer("Debian")

  while (!children.length) await Bun.sleep(1)
  expect(children[0].exitCode).toBeNull()
  await controller.stopServers()
  expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
})

const readiness = ["discovers the installed CLI", "marks the distro ready", "offers the add server action"]

readiness.map((check) =>
  test(`WSL without curl ${check}`, async () => {
    // The WSL transport is unavailable on Linux. Supply its observed distro/tool/CLI
    // responses at the existing runtime boundary and exercise the real controller/model.
    const runtime = {
      ...createWslRuntime((key) => key),
      probeRuntime: async () => ({ available: true, version: "2.0.0", error: null }),
      listInstalled: async () => [{ name: "Debian", version: 2, isDefault: true }],
      listOnline: async () => [],
      probeDistro: async (name) => ({ name, canExecute: true, hasBash: true, error: null }),
      resolveCli: async () => "/home/wsl/.omnixa/bin/omnixa",
      readCliVersion: async () => "2.3.4",
    } satisfies WslRuntime
    const controller = createWslServersController({
      cli: { version: "2.3.4" },
      runtime,
      t: (key) => key,
      log: () => undefined,
      readServers: () => [],
      writeServers: () => undefined,
      installCli: async () => {
        throw new Error("Unexpected CLI installation")
      },
      spawnSidecar: async () => {
        throw new Error("Unexpected sidecar start")
      },
    })
    await controller.probeRuntime()
    await controller.refreshDistros()
    await controller.probeAddable(["Debian"])
    const state = controller.getState()
    if (check === "discovers the installed CLI") {
      expect(state.omnixaChecks.Debian?.matchesDesktop).toBe(true)
      expect(state.omnixaChecks.Debian?.resolvedPath).toBe("/home/wsl/.omnixa/bin/omnixa")
      return
    }
    if (check === "marks the distro ready") {
      expect(wslDistroReady(state, "Debian")).toBe(true)
      return
    }
    const view = addServerViewModel({
      state,
      view: "main",
      selectedDistro: "Debian",
      catalogSearch: "",
      catalogTarget: null,
      adding: false,
      probingAddable: false,
    })
    expect(view.distroStatuses.Debian.label.key).toBe("onboarding.distroStatus.ready")
    expect(view.primaryButton.action).toBe("add")
    expect(view.primaryButton.disabled).toBe(false)
  }),
)
