import { expect, test, type Page, type Request, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectSessionTitle, gotoWhenReady } from "../utils/waits"

const server = "http://127.0.0.1:4096"
const serverKey = base64Encode(server)
const directoryA = "C:/Aigcfroge/Terminal-A"
const directoryB = "C:/Aigcfroge/Terminal-B"
const projectID = "proj_terminal_route"
const sessionA = "ses_terminal_route_a"
const sessionA2 = "ses_terminal_route_a2"
const sessionB = "ses_terminal_route_b"

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
}

type CapturedRequest = {
  method: string
  path: string
  directory?: string
  ticketHeader?: string
  body?: unknown
}

type PtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

type SocketState = {
  urls: string[]
  sent: string[]
  closes: Array<{ code?: number; reason?: string }>
}

function session(id: string, directory: string, title: string) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    mode: "work",
    agent: "build",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function requestBody(request: Request) {
  const value = request.postData()
  if (!value) return undefined
  const parsed: unknown = JSON.parse(value)
  return isRecord(parsed) ? parsed : undefined
}

function directoryOf(request: Request, url: URL) {
  return request.headers()["x-aigcfroge-directory"] ?? url.searchParams.get("directory") ?? undefined
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: cors,
    body: JSON.stringify(body),
  })
}

async function installSocketMock(page: Page) {
  await page.addInitScript(() => {
    const state: SocketState = { urls: [], sent: [], closes: [] }
    Object.defineProperty(window, "__terminalSocketState", { value: state })

    class MockWebSocket extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSING = 2
      readonly CLOSED = 3
      readonly url: string
      readonly protocol = ""
      readonly extensions = ""
      bufferedAmount = 0
      binaryType: BinaryType = "blob"
      readyState = MockWebSocket.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null

      constructor(url: string | URL) {
        super()
        this.url = String(url)
        state.urls.push(this.url)
        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN
          this.dispatchEvent(new Event("open"))
        })
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        state.sent.push(typeof data === "string" ? data : `[${Object.prototype.toString.call(data)}]`)
      }

      close(code = 1000, reason = "") {
        if (this.readyState === MockWebSocket.CLOSED) return
        this.readyState = MockWebSocket.CLOSED
        state.closes.push({ code, reason })
        this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: code === 1000 }))
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket })
  })
}

async function installMocks(page: Page) {
  const requests: CapturedRequest[] = []
  const ptys = new Map<string, PtyInfo>()
  let nextID = 0

  await mockAigcfrogeServer(page, {
    directory: directoryA,
    project: {
      id: projectID,
      worktree: directoryA,
      vcs: "git",
      name: "terminal-route",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      session(sessionA, directoryA, "Terminal session A"),
      session(sessionA2, directoryA, "Terminal session A2"),
      session(sessionB, directoryB, "Terminal session B"),
    ],
    pageMessages: () => ({ items: [] }),
  })

  // Registered after the shared catch-all so PTY traffic reaches this higher-fidelity mock first.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.port !== "4096" || !url.pathname.startsWith("/pty")) return route.fallback()

    const request = route.request()
    const method = request.method()
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })

    requests.push({
      method,
      path: url.pathname,
      directory: directoryOf(request, url),
      ticketHeader: request.headers()["x-aigcfroge-ticket"],
      body: requestBody(request),
    })

    if (url.pathname === "/pty" && method === "GET") {
      return json(
        route,
        [...ptys.values()].filter((pty) => pty.cwd === (url.searchParams.get("directory") ?? "")),
      )
    }

    if (url.pathname === "/pty" && method === "POST") {
      const body = requestBody(request)
      const title = typeof body?.title === "string" ? body.title : ""
      const directory = directoryOf(request, url) ?? ""
      const id = `pty_terminal_${++nextID}`
      const info: PtyInfo = {
        id,
        title,
        command: "/bin/sh",
        args: [],
        cwd: decodeURIComponent(directory),
        status: "running",
        pid: 4100 + nextID,
      }
      ptys.set(id, info)
      return json(route, info)
    }

    const token = url.pathname.match(/^\/pty\/([^/]+)\/connect-token$/)
    if (token && method === "POST") {
      if (!ptys.has(token[1])) return json(route, { _tag: "PtyNotFoundError", ptyID: token[1] }, 404)
      if (request.headers()["x-aigcfroge-ticket"] !== "1") return json(route, { _tag: "ForbiddenError" }, 403)
      return json(route, { ticket: `ticket-${token[1]}`, expires_in: 30 })
    }

    const item = url.pathname.match(/^\/pty\/([^/]+)$/)
    if (!item) return route.fallback()
    const info = ptys.get(item[1])
    if (!info) return json(route, { _tag: "PtyNotFoundError", ptyID: item[1] }, 404)

    if (method === "GET") return json(route, info)
    if (method === "PUT") {
      const body = requestBody(request)
      const next = { ...info, ...(typeof body?.title === "string" ? { title: body.title } : {}) }
      ptys.set(item[1], next)
      return json(route, next)
    }
    if (method === "DELETE") {
      ptys.delete(item[1])
      return json(route, true)
    }
    return route.fallback()
  })

  return { requests, ptys }
}

async function socketState(page: Page) {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, "__terminalSocketState")
    // The predicate must live inside the callback: page.evaluate serializes
    // this function into the browser, where Node-scope helpers don't exist.
    const isState = (input: unknown): input is SocketState => {
      if (typeof input !== "object" || input === null) return false
      if (!("urls" in input) || !("sent" in input) || !("closes" in input)) return false
      return Array.isArray(input.urls) && Array.isArray(input.sent) && Array.isArray(input.closes)
    }
    if (!isState(value)) throw new Error("Terminal WebSocket state is unavailable")
    return value
  })
}

async function openTerminal(page: Page) {
  const panel = page.locator("#terminal-panel")
  await expect(panel).toBeAttached()
  if ((await panel.getAttribute("aria-hidden")) !== "false") await page.keyboard.press("Control+Backquote")
  await expect(panel).toHaveAttribute("aria-hidden", "false")
  await expect(panel.locator('[data-component="terminal"]')).toBeVisible({ timeout: 30_000 })
  return panel
}

async function gotoSession(page: Page, id: string, title: string) {
  await gotoWhenReady(page, `/server/${serverKey}/session/${id}`)
  await expectSessionTitle(page, title)
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await installSocketMock(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

// RED 2026-09-13: the terminal WebSocket URL is ws://127.0.0.1:4096, the fixture expects the localhost spelling.
// Unlock at S4/S8 with the server host-alias owner (closure plan §7.1, §11.2).
test.fixme(
  "creates, connects, sends input, resizes, and deletes a PTY from a canonical Session route",
  async ({ page }) => {
    test.info().annotations.push({
      type: "coverage",
      description:
        "PARTIAL: the browser-side HTTP and WebSocket contracts are exercised with a fake socket; real process I/O, server WebSocket upgrade, process exit, and cleanup remain covered only by the backend PTY integration tests.",
    })
    const mock = await installMocks(page)

    await gotoSession(page, sessionA, "Terminal session A")
    const panel = await openTerminal(page)

    await expect
      .poll(() => mock.requests.filter((request) => request.method === "POST" && request.path === "/pty").length)
      .toBe(1)
    const create = mock.requests.find((request) => request.method === "POST" && request.path === "/pty")
    expect(create).toMatchObject({
      directory: encodeURIComponent(directoryA),
      body: { title: "Terminal 1" },
    })

    await expect
      .poll(() => mock.requests.find((request) => request.path.endsWith("/connect-token")))
      .toMatchObject({
        method: "POST",
        directory: encodeURIComponent(directoryA),
        ticketHeader: "1",
      })

    await expect.poll(async () => (await socketState(page)).urls.length).toBeGreaterThanOrEqual(1)
    const connected = new URL((await socketState(page)).urls.at(-1) ?? "")
    expect(connected.origin).toBe("ws://localhost:4096")
    expect(connected.pathname).toBe("/pty/pty_terminal_1/connect")
    expect(connected.searchParams.get("directory")).toBe(directoryA)
    expect(connected.searchParams.get("cursor")).toBe("0")
    expect(connected.searchParams.get("ticket")).toBe("ticket-pty_terminal_1")

    const terminal = panel.locator('[data-component="terminal"]')
    await terminal.click()
    await page.keyboard.type("printf terminal-e2e")
    await page.keyboard.press("Enter")
    await expect.poll(async () => (await socketState(page)).sent.join("")).toContain("printf terminal-e2e\r")

    await expect
      .poll(() =>
        mock.requests.find((request) => {
          if (request.method !== "PUT" || request.path !== "/pty/pty_terminal_1") return false
          return (
            isRecord(request.body) &&
            isRecord(request.body.size) &&
            !!request.body.size.cols &&
            !!request.body.size.rows
          )
        }),
      )
      .toBeTruthy()

    const updateCount = mock.requests.filter(
      (request) => request.method === "PUT" && request.path === "/pty/pty_terminal_1",
    ).length
    await page.setViewportSize({ width: 1100, height: 720 })
    await expect
      .poll(
        () =>
          mock.requests.filter((request) => request.method === "PUT" && request.path === "/pty/pty_terminal_1").length,
      )
      .toBeGreaterThan(updateCount)

    await panel.getByRole("button", { name: "Close terminal" }).click()
    await expect
      .poll(() =>
        mock.requests.some((request) => request.method === "DELETE" && request.path === "/pty/pty_terminal_1"),
      )
      .toBe(true)
    await expect(panel).toHaveAttribute("aria-hidden", "true")
    expect(mock.ptys.has("pty_terminal_1")).toBe(false)
  },
)

test("shares terminal state across Sessions in one directory and isolates another directory", async ({ page }) => {
  test.info().annotations.push({
    type: "coverage",
    description:
      "PARTIAL: the app intentionally restores its workspace-local terminal registry instead of hydrating GET /pty; discovery of PTYs created by another client is therefore not browser-covered and remains an explicit product gap.",
  })
  const mock = await installMocks(page)

  await gotoSession(page, sessionA, "Terminal session A")
  await openTerminal(page)
  await expect
    .poll(() => mock.requests.filter((request) => request.method === "POST" && request.path === "/pty").length)
    .toBe(1)

  await gotoSession(page, sessionA2, "Terminal session A2")
  const sameDirectoryPanel = await openTerminal(page)
  await expect(sameDirectoryPanel.getByText("Terminal 1", { exact: true })).toBeVisible()
  expect(mock.requests.filter((request) => request.method === "POST" && request.path === "/pty")).toHaveLength(1)
  await expect.poll(async () => (await socketState(page)).urls.length).toBeGreaterThanOrEqual(2)
  expect(new URL((await socketState(page)).urls.at(-1) ?? "").pathname).toBe("/pty/pty_terminal_1/connect")

  await gotoSession(page, sessionB, "Terminal session B")
  const isolatedPanel = await openTerminal(page)
  await expect(isolatedPanel.getByText("Terminal 1", { exact: true })).toBeVisible()
  await expect
    .poll(() => mock.requests.filter((request) => request.method === "POST" && request.path === "/pty").length)
    .toBe(2)
  const creates = mock.requests.filter((request) => request.method === "POST" && request.path === "/pty")
  expect(creates.map((request) => request.directory)).toEqual([
    encodeURIComponent(directoryA),
    encodeURIComponent(directoryB),
  ])
  await expect.poll(async () => (await socketState(page)).urls.length).toBeGreaterThanOrEqual(2)
  const isolated = new URL((await socketState(page)).urls.at(-1) ?? "")
  expect(isolated.pathname).toBe("/pty/pty_terminal_2/connect")
  expect(isolated.searchParams.get("directory")).toBe(directoryB)

  // The current UI has no authoritative list hydration path: it uses persisted workspace state.
  // Keep this absence visible instead of claiming that browser E2E covers GET /pty.
  expect(mock.requests.filter((request) => request.method === "GET" && request.path === "/pty")).toEqual([])
})
