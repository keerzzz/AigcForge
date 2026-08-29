import { expect, test } from "bun:test"
import { clearWslDistroState, requireWslIpcString, wslServerIdToRestart, wslTerminalArgs } from "./policy"
import {
  expectAigcfrogeVersion,
  pendingRestartAfterWslInstall,
  pollWslHealth,
  wslServerIdsToStartOnInitialize,
} from "./startup"
import { createWslServersController, type WslRuntimeCheck, type WslServerConfig } from "./servers"

let persistedServers: WslServerConfig[] = []
// 只在 mock 回调里赋值，CFA 看不到，直接用 let 会被收窄成 undefined 再 ?.() 得到 never。
// 放进对象里让 TS 用声明类型，比在调用点写断言诚实。
const pendingAigcfrogeCheck: { release?: () => void } = {}

test("starts every configured WSL server on initialization", () => {
  // 用真实的 WslServerConfig 而不是裁剪成 { id }：servers.ts:283 构造的就是 { id, distro }，
  // 裁掉 distro 只是为了绕过对象字面量的多余属性检查，会让 fixture 与生产形状脱钩。
  const configs: WslServerConfig[] = [
    { id: "wsl:Debian", distro: "Debian" },
    { id: "wsl:Ubuntu-24.04", distro: "Ubuntu-24.04" },
  ]
  expect(wslServerIdsToStartOnInitialize(configs)).toEqual(["wsl:Debian", "wsl:Ubuntu-24.04"])
})

test("rejects an update that did not install the desktop version", () => {
  expect(() => expectAigcfrogeVersion("1.16.2", "1.16.2")).not.toThrow()
  expect(() => expectAigcfrogeVersion("1.14.35", "1.16.2")).toThrow(
    "Aigcfroge update finished but Debian still reports 1.14.35; expected 1.16.2",
  )
})

test("restarts an existing distro server after updating Aigcfroge", () => {
  expect(
    wslServerIdToRestart(
      [
        {
          config: { id: "wsl:Debian", distro: "Debian" },
          runtime: { kind: "ready", url: "", username: null, password: null },
        },
      ],
      "Debian",
    ),
  ).toBe("wsl:Debian")
  expect(wslServerIdToRestart([], "Debian")).toBeUndefined()
})

test("clears cached distro probes when removing a WSL server", () => {
  expect(
    clearWslDistroState(
      { Debian: { name: "Debian", canExecute: true, hasBash: true, hasCurl: true, error: null } },
      {
        Debian: {
          distro: "Debian",
          resolvedPath: "/home/luke/.aigcfroge/bin/aigcfroge",
          version: "1.16.2",
          expectedVersion: "1.16.2",
          matchesDesktop: true,
          error: null,
        },
      },
      "Debian",
    ),
  ).toEqual({ distroProbes: {}, aigcfrogeChecks: {} })
})

test("opens terminals for distro names containing spaces", () => {
  expect(wslTerminalArgs("Ubuntu Preview")).toEqual(["/c", "start", "", "wsl", "-d", "Ubuntu Preview"])
})

test("stops health polling when sidecar startup settles", async () => {
  const abort = new AbortController()
  let checks = 0
  const polling = pollWslHealth(
    async () => {
      checks++
      return false
    },
    abort.signal,
    1,
  )

  await new Promise((resolve) => setTimeout(resolve, 5))
  abort.abort()
  await polling
  const settled = checks
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(checks).toBe(settled)
})

test("validates WSL IPC identifiers at the module boundary", () => {
  expect(requireWslIpcString("distro", "Debian")).toBe("Debian")
  expect(() => requireWslIpcString("distro", "")).toThrow("Invalid distro")
  expect(() => requireWslIpcString("server id", undefined)).toThrow("Invalid server id")
})

test("derives a required Windows restart from the post-install runtime probe", () => {
  // probeWslRuntime 返回的是完整的 WslRuntimeCheck，fixture 保持同形。
  const unavailable: WslRuntimeCheck = { available: false, version: null, error: "WSL unavailable" }
  const available: WslRuntimeCheck = { available: true, version: "WSL version: 2.6.1", error: null }
  expect(pendingRestartAfterWslInstall(unavailable)).toBe(true)
  expect(pendingRestartAfterWslInstall(available)).toBe(false)
})

test("ignores stale background Aigcfroge checks after removing a WSL server", async () => {
  persistedServers = []
  pendingAigcfrogeCheck.release = undefined
  const controller = createWslServersController(
    "1.16.2",
    async () => ({
      listener: {
        stop: () => undefined,
        onExit: () => undefined,
      },
      url: "http://127.0.0.1:4096",
      username: "aigcfroge",
      password: "secret",
    }),
    testControllerOptions(),
  )

  await controller.addServer("Debian")
  const release = await waitFor(() => pendingAigcfrogeCheck.release)
  await controller.removeServer("wsl:Debian")
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(controller.getState().servers).toEqual([])
  expect(controller.getState().aigcfrogeChecks).toEqual({})
})

test("ignores stale startup Aigcfroge checks after removing a WSL server", async () => {
  persistedServers = [{ id: "wsl:Debian", distro: "Debian" }]
  pendingAigcfrogeCheck.release = undefined
  const controller = createWslServersController(
    "1.16.2",
    async () => new Promise<never>(() => undefined),
    testControllerOptions(),
  )

  await controller.initialize()
  const release = await waitFor(() => pendingAigcfrogeCheck.release)
  await controller.removeServer("wsl:Debian")
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(controller.getState().servers).toEqual([])
  expect(controller.getState().aigcfrogeChecks).toEqual({})
})

// 返回等到的值而不是布尔：调用点因此拿到一个确定存在的函数，不需要 `?.()`
// （那个可选调用在时序变化后会静默什么都不做，等于把测试悄悄关掉）。
async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}

function testControllerOptions() {
  return {
    readServers: () => persistedServers,
    writeServers: (servers: WslServerConfig[]) => {
      persistedServers = servers
    },
    readCommandVersion: async () => "1.16.2",
    resolveAigcfroge: async () => {
      await new Promise<void>((resolve) => {
        pendingAigcfrogeCheck.release = resolve
      })
      return "/home/me/.aigcfroge/bin/aigcfroge"
    },
  }
}
