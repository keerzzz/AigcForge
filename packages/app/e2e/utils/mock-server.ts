import type { Page, Route } from "@playwright/test"

const emptyList = new Set([
  "/skill",
  "/command",
  "/lsp",
  "/formatter",
  "/permission",
  "/question",
  "/vcs/status",
  "/vcs/diff",
  "/vcs/log",
])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"])

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  vcsDiff?: unknown[]
  messageDelay?: number
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  events?: () => unknown[]
  eventRetry?: number
  /** Optional id-bearing task list served by GET /session/:id/task. PATCH
   * replaces it and returns the payload so the fold-over writeback round-trips.
   * Structured (not `unknown[]`) so the mock's own find/filter typechecks. */
  tasks?: Array<{ id: string } & Record<string, unknown>>
  /** Optional three-field todo projection served by GET /session/:id/todo
   * (reload-recovery source when task.updated is not re-delivered). */
  todoList?: unknown[]
  /** Optional response for the Agent Asset apply route used by browser regression tests. */
  agentAssetApply?: unknown
  agentAssetApplyStatus?: number
}

export async function mockAigcfrogeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  let nextCursor = 0
  let nextTaskID = 0
  const staticRoutes: Record<string, unknown> = {
    "/provider": config.provider,
    "/path": {
      state: config.directory,
      config: config.directory,
      worktree: config.directory,
      directory: config.directory,
      home: "C:/Aigcfroge",
    },
    "/project": [config.project],
    "/project/current": config.project,
    "/agent": [{ name: "build", mode: "primary" }],
    "/vcs": { branch: "main", default_branch: "main" },
    "/session": config.sessions,
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health") return json(route, { healthy: true })
    if (/^\/session\/[^/]+\/agent-asset\/apply$/.test(path) && route.request().method() === "POST") {
      return json(route, config.agentAssetApply ?? {}, undefined, config.agentAssetApplyStatus ?? 200)
    }
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])
    // M4 Agent Hub cross-session aggregation read (agent-task group).
    if (path === "/agent-task") return json(route, config.tasks ?? [])

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    const todoPath = path.match(/^\/session\/([^/]+)\/todo$/)
    if (todoPath) return json(route, config.todoList ?? [])
    if (/^\/session\/[^/]+\/(children|diff)$/.test(path)) return json(route, [])

    const taskMatch = path.match(/^\/session\/([^/]+)\/task$/)
    if (taskMatch) {
      const method = route.request().method()
      if (method === "POST") {
        // Atomic create (HIGH-2): append one task. Fidelity: the real server
        // mints the id and ignores a client-supplied one — mirror that.
        const body = route.request().postDataJSON()
        const created = { ...body, id: `tsk_mock_${++nextTaskID}` }
        config.tasks = [...(config.tasks ?? []), created]
        return json(route, created)
      }
      if (method === "PATCH") {
        const body = route.request().postDataJSON()
        config.tasks = body
        return json(route, body)
      }
      return json(route, config.tasks ?? [])
    }

    const taskItemMatch = path.match(/^\/session\/([^/]+)\/task\/([^/]+)$/)
    if (taskItemMatch) {
      const [, , taskID] = taskItemMatch
      const method = route.request().method()
      if (method === "PATCH") {
        // Atomic single-task patch (HIGH-2): only the named row changes.
        const body = route.request().postDataJSON()
        const patched = { ...(config.tasks ?? []).find((t) => t.id === taskID), ...body }
        config.tasks = (config.tasks ?? []).map((task) => (task.id === taskID ? patched : task))
        return json(route, patched)
      }
      if (method === "DELETE") {
        // Fidelity: the real endpoint 404s when the session doesn't own the id.
        const removed = (config.tasks ?? []).find((t) => t.id === taskID)
        if (!removed) return json(route, { error: "not found" }, undefined, 404)
        config.tasks = (config.tasks ?? []).filter((task) => task.id !== taskID)
        return json(route, removed)
      }
      return route.fallback()
    }

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("before") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      if (config.messageDelay) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageData = config.pageMessages(messagesMatch[1], limit, before)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "end" })
      if (!pageData.cursor) return json(route, pageData.items)
      const cursor = `cursor_${++nextCursor}`
      cursors.set(cursor, pageData.cursor)
      return json(route, pageData.items, { "x-next-cursor": cursor })
    }

    if (url.port === targetPort && targetPort !== appPort) return json(route, {})
    return route.fallback()
  })
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
