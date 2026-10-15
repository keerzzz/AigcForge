import type { Page, Route } from "@playwright/test"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import type {
  AppAgentsResponse,
  GlobalHealthResponse,
  InvalidCursorError,
  InvalidRequestError,
  PermissionOverrideGetResponse,
  ProjectNotFoundError,
  SchedulePendingResponse,
  SessionMessagesResponse,
  SessionNotFoundError,
  V2PermissionGrantListResponse,
  V2PermissionRequestListResponse,
  V2QuestionRequestListResponse,
  V2SessionMessagesData,
} from "@aigcfroge/sdk/v2/client"
import { pathKey } from "../../src/utils/path-key"

const isRecordOf = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
type MockSession = { id: string } & Record<string, unknown>

const emptyList = new Set([
  "/skill",
  "/command",
  "/lsp",
  "/formatter",
  "/permission",
  "/vcs/status",
  "/vcs/diff",
  "/vcs/log",
  "/file",
  "/pty/shells",
])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"])

export type MockCanonicalMessageQuery = V2SessionMessagesData["path"] &
  NonNullable<V2SessionMessagesData["query"]> & { limit: number }

export interface MockServerConfig {
  provider: unknown
  directory: string
  /** Server port this registration answers on. Defaults to
   * PLAYWRIGHT_SERVER_PORT (4096). A second registration with a different port
   * lets one page mock two physical servers — non-matching ports fall through
   * via route.fallback(). */
  port?: string
  project: unknown
  sessions: MockSession[]
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  /** GET /api/session/:id/message uses its own canonical message shape and body
   * cursors. Omitted means empty canonical history for the declared sessions;
   * populated canonical histories must supply this callback, never `pageMessages`.
   * It receives limit=50 and first-page order=desc when those parameters are absent.
   * Returned cursors are opaque fixture tokens. A known token whose anchor belongs
   * to another session returns an empty page, matching the canonical store. */
  canonicalMessages?: (input: MockCanonicalMessageQuery) => SessionMessagesResponse
  vcsDiff?: unknown[]
  messageDelay?: number
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  events?: () => unknown[]
  eventRetry?: number
  /** Optional id-bearing task list served by GET /session/:id/task. PATCH
   * replaces it and returns the payload so the fold-over writeback round-trips.
   * Structured (not `unknown[]`) so the mock's own find/filter typechecks. */
  tasks?: Array<{ id: string } & Record<string, unknown>>
  /** Optional response for the Agent Asset apply route used by browser regression tests. */
  agentAssetApply?: unknown
  agentAssetApplyStatus?: number
  /** Optional session status projection served by GET /session/status, keyed by session
   * id. The default `{}` leaves every session idle, which makes every busy-turn surface
   * (the timeline's Thinking row, and anything derived from a running turn) unreachable. */
  sessionStatus?: Record<string, unknown>
  delegations?: unknown[]
  delegationDelay?: number
  delegationStatus?: number
  /** Raw override for `/agent`, including deliberately malformed responses.
   * Defaults are complete synthetic agents with the real primary-mode policy. */
  agents?: unknown[]
  /** Optional project list served by GET /project. Defaults to `[config.project]`;
   * a second server or a multi-project case supplies its own list. */
  projects?: unknown[]
  /** Optional response for PATCH /project/:id, the write the colour auto-assign
   * (`context/layout.tsx`) and the edit dialog (`dialog-edit-project.tsx`) issue.
   * Absent, valid writes update registration-local projections. Explicit body
   * or status overrides bypass that state and preserve negative-response cases. */
  projectUpdate?: unknown
  projectUpdateStatus?: number
  /** Optional replacement for GET /path's projection. Absent, the default
   * `{ state, config, worktree, directory, home }` is served byte-for-byte, so
   * only a caller that needs an inaccessible or invalid directory sets it.
   * `pathStatus` defaults to 200. */
  pathResponse?: unknown
  pathStatus?: number
  /** Optional listing served by GET /file. Default [] (the `emptyList` set), which
   * leaves the directory picker's tree empty; a caller that drives a picker-driven
   * or file-dialog flow supplies a listing here. */
  files?: unknown[]
  /** Optional override for GET /vcs. Default `{ branch: "main", default_branch: "main" }`;
   * the real server answers `{}` (both fields undefined) for a non-git location. */
  vcs?: unknown
  /** Optional complete `/session/:id/identity` projection for second-source tests. */
  identity?: Record<string, unknown> | ((session: MockSession) => unknown)
  onIdentity?: (sessionID: string) => void
}

export async function mockAigcfrogeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  const canonicalCursors = new Map<string, Set<string>>()
  const projectSeeds = structuredClone({ current: config.project, list: config.projects ?? [config.project] })
  const projectUpdates = new Map<string, Record<string, unknown>>()
  const projectProjection = (seed: unknown) => {
    if (!isRecordOf(seed) || typeof seed.id !== "string") return seed
    const updated = projectUpdates.get(seed.id)
    if (!updated) return seed
    // Stored empty icon columns must survive, even when fromRow omits the wire icon.
    const icon = isRecordOf(updated.icon) ? updated.icon : undefined
    return { ...updated, icon: icon && (icon.url || icon.override || icon.color) ? icon : undefined }
  }
  let nextCursor = 0
  let nextTaskID = 0
  const pathProjection = {
    state: config.directory,
    config: config.directory,
    worktree: config.directory,
    directory: config.directory,
    home: "C:/Aigcfroge",
  }
  const staticRoutes: Record<string, unknown> = {
    "/experimental/capabilities": {
      backgroundSubagents: false,
      chatAsset: false,
      customMode: false,
      productModes: ["chat", "coding", "work", "assistant", "custom"],
      customCompositionVersion: 1,
      canonicalSessionModes: ["assistant", "custom"],
    },
    "/provider": config.provider,
    "/path": pathProjection,
    "/agent":
      config.agents ??
      (["build", ProductModeAgentPolicy.META, ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR].map((name) => ({
        name,
        mode: "primary",
        permission: [],
        options: {},
        primaryModes: [...ProductModeAgentPolicy.primaryModes(name)],
      })) satisfies AppAgentsResponse),
    "/vcs": config.vcs ?? { branch: "main", default_branch: "main" },
    "/session": config.sessions,
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = config.port ?? process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health" && route.request().method() === "GET") {
      return json(route, { healthy: true, version: "0.0.0-mock" } satisfies GlobalHealthResponse)
    }
    if (path === "/schedule/pending" && route.request().method() === "GET") {
      return json(route, [] satisfies SchedulePendingResponse)
    }
    if (/^\/session\/[^/]+\/agent-asset\/apply$/.test(path) && route.request().method() === "POST") {
      return json(route, config.agentAssetApply ?? {}, undefined, config.agentAssetApplyStatus ?? 200)
    }
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    // Checked before `emptyObject`, which would otherwise pin every session to idle.
    if (path === "/session/status") return json(route, config.sessionStatus ?? {})
    if (emptyObject.has(path)) return json(route, {})
    // Checked before `emptyList`, which would otherwise answer `[]`. Absent, the
    // route still falls through to that same `[]`.
    if (path === "/file" && config.files !== undefined) return json(route, config.files)
    if (emptyList.has(path)) return json(route, [])
    if (
      ["/api/question/request", "/api/permission/request", "/api/permission/grant"].includes(path) &&
      route.request().method() === "GET"
    ) {
      const directory = url.searchParams.get("location[directory]") || config.directory
      const key = pathKey(directory)
      // This fixture resolves only its seeded project and descendants, not a filesystem.
      const project = [projectSeeds.current, ...projectSeeds.list]
        .filter(
          (seed): seed is Record<string, unknown> & { worktree: string } =>
            isRecordOf(seed) &&
            typeof seed.worktree === "string" &&
            (key === pathKey(seed.worktree) || key.startsWith(`${pathKey(seed.worktree).replace(/\/$/, "")}/`)),
        )
        .sort((a, b) => b.worktree.length - a.worktree.length)[0]
      if (!isRecordOf(project) || typeof project.id !== "string" || typeof project.worktree !== "string") {
        throw new Error(`Mock Location requires a seeded project for directory: ${directory}`)
      }
      const workspaceID = url.searchParams.get("location[workspace]") || undefined
      return json(route, {
        location: {
          directory,
          project: { id: project.id, directory: project.worktree },
          ...(workspaceID && { workspaceID }),
        },
        data: [],
      } satisfies V2PermissionRequestListResponse & V2PermissionGrantListResponse & V2QuestionRequestListResponse)
    }
    // Checked before `staticRoutes` only when the knob asks for it; an absent pair
    // leaves the default projection and status untouched.
    if (path === "/path" && (config.pathResponse !== undefined || config.pathStatus !== undefined)) {
      return json(route, config.pathResponse ?? pathProjection, undefined, config.pathStatus ?? 200)
    }
    if (path === "/project" && route.request().method() === "GET") {
      return json(route, projectSeeds.list.map(projectProjection))
    }
    if (path === "/project/current" && route.request().method() === "GET") {
      return json(route, projectProjection(projectSeeds.current))
    }
    if (path in staticRoutes) return json(route, staticRoutes[path])
    const projectMatch = path.match(/^\/project\/([^/]+)$/)
    if (projectMatch && route.request().method() === "PATCH") {
      if (config.projectUpdate !== undefined || config.projectUpdateStatus !== undefined) {
        return json(route, config.projectUpdate ?? {}, undefined, config.projectUpdateStatus ?? 200)
      }
      const projectID = decodeURIComponent(projectMatch[1])
      const project =
        projectUpdates.get(projectID) ??
        [...projectSeeds.list, projectSeeds.current].find((seed) => isRecordOf(seed) && seed.id === projectID)
      if (!isRecordOf(project)) {
        return json(
          route,
          {
            _tag: "ProjectNotFoundError",
            projectID,
            message: `Project not found: ${projectID}`,
          } satisfies ProjectNotFoundError,
          undefined,
          404,
        )
      }
      const body: unknown = route.request().postDataJSON()
      if (!isRecordOf(body) || Array.isArray(body) || !isRecordOf(project.time)) {
        throw new Error("Default mock Project writes require a JSON object and a seeded Project time")
      }
      // Match Project.update's independent icon columns and whole commands column.
      const icon = {
        ...(isRecordOf(project.icon) ? project.icon : {}),
        ...Object.fromEntries(
          isRecordOf(body.icon)
            ? Object.entries(body.icon).filter(
                ([key, value]) => ["url", "override", "color"].includes(key) && typeof value === "string",
              )
            : [],
        ),
      }
      const updated = {
        ...project,
        ...(typeof body.name === "string" && { name: body.name }),
        icon,
        ...(isRecordOf(body.commands) && {
          commands: typeof body.commands.start === "string" ? { start: body.commands.start } : {},
        }),
        time: { ...project.time, updated: Date.now() },
      }
      projectUpdates.set(projectID, updated)
      return json(route, projectProjection(updated))
    }
    // M4 Agent Hub cross-session aggregation read (agent-task group).
    if (path === "/agent-task") return json(route, config.tasks ?? [])
    if (path === "/api/delegation" || path === "/delegation") {
      if (config.delegationDelay) await new Promise((resolve) => setTimeout(resolve, config.delegationDelay))
      return json(route, config.delegations ?? [], undefined, config.delegationStatus ?? 200)
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      // Real backend 404 shape (packages/aigcfroge/src/server/routes/instance/httpapi/errors.ts
      // ApiNotFoundError): `{ name: "NotFoundError", data: { message } }`. The mock
      // used to answer 200 `{}` here, which made the real error shape untestable.
      if (!session) return notFound(route, `Session not found: ${sessionMatch[1]}`)
      return json(route, session)
    }

    if (/^\/session\/[^/]+\/(children|diff)$/.test(path)) return json(route, [])

    const sessionProjectionMatch = path.match(/^\/session\/([^/]+)\/(composition|permission-override)$/)
    if (sessionProjectionMatch && route.request().method() === "GET") {
      const session = config.sessions.find((s) => s.id === sessionProjectionMatch[1])
      if (!session) return notFound(route, `Session not found: ${sessionProjectionMatch[1]}`)
      if (sessionProjectionMatch[2] === "composition")
        return notFound(route, `Snapshot not found for session ${session.id}`)
      return json(route, { enabled: false } satisfies PermissionOverrideGetResponse)
    }

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

    // Missing-file contract (S6 debt closure): a typed 404 with the real
    // NotFoundError shape. This mock owns no files, so every content read is a
    // miss — specs that need real content override the route locally.
    if (path === "/file/content") {
      return notFound(route, `File not found: ${url.searchParams.get("path") ?? ""}`)
    }

    // Identity projection (S6): the status bar reads this. It mirrors the real
    // service's shape — including the typed `model` datum and the mode-detail
    // availability — so E3 exercises the same contract the server produces.
    const identityMatch = path.match(/^\/session\/([^/]+)\/identity$/)
    if (identityMatch) {
      const session = config.sessions.find((s) => s.id === identityMatch[1])
      if (!session) return notFound(route, `Session not found: ${identityMatch[1]}`)
      config.onIdentity?.(session.id)
      if (config.identity !== undefined) {
        return json(route, typeof config.identity === "function" ? config.identity(session) : config.identity)
      }
      const tier = session.permissionTier === "full" ? "full" : "propose"
      const mode = typeof session.mode === "string" ? session.mode : "coding"
      const model = isRecordOf(session.model)
        ? { status: "ready" as const, value: session.model }
        : { status: "missing" as const }
      const codingDetail = {
        status: "ready" as const,
        detail: {
          source: "coding" as const,
          vcs: { branch: { status: "missing" as const }, worktree: { status: "missing" as const } },
        },
      }
      const missingDetail = { status: "missing" as const, reason: "mode-detail-not-projected" }
      return json(route, {
        sessionID: session.id,
        mode,
        location: { directory: session.directory },
        projectID: session.projectID,
        agent: typeof session.agent === "string" ? session.agent : "meta",
        model,
        permission: { declaredTier: tier, effect: "ask" },
        capability:
          mode === "coding"
            ? { health: "ready", reasons: [] }
            : { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
        detail: mode === "coding" ? codingDetail : missingDetail,
      })
    }

    const canonicalMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (canonicalMatch && route.request().method() === "GET") {
      const sessionID = canonicalMatch[1]
      if (!config.sessions.some((session) => session.id === sessionID)) {
        return json(
          route,
          {
            _tag: "SessionNotFoundError",
            sessionID,
            message: `Session not found: ${sessionID}`,
          } satisfies SessionNotFoundError,
          undefined,
          404,
        )
      }
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const order = url.searchParams.get("order")
      const cursor = url.searchParams.get("cursor")
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        (order !== null && order !== "asc" && order !== "desc")
      ) {
        return json(
          route,
          {
            _tag: "InvalidRequestError",
            message: "Invalid message pagination query",
            kind: "Query",
          } satisfies InvalidRequestError,
          undefined,
          400,
        )
      }
      if (cursor && order !== null) {
        return json(
          route,
          { _tag: "InvalidCursorError", message: "Cursor cannot be combined with order" } satisfies InvalidCursorError,
          undefined,
          400,
        )
      }
      if (cursor && !canonicalCursors.get(sessionID)?.has(cursor)) {
        if ([...canonicalCursors.values()].some((issued) => issued.has(cursor))) {
          return json(route, { data: [], cursor: {} } satisfies SessionMessagesResponse)
        }
        return json(
          route,
          { _tag: "InvalidCursorError", message: "Invalid cursor" } satisfies InvalidCursorError,
          undefined,
          400,
        )
      }
      const response: SessionMessagesResponse = config.canonicalMessages?.({
        sessionID,
        limit,
        ...(cursor ? { cursor } : { order: order ?? "desc" }),
      }) ?? { data: [], cursor: {} }
      const issued = canonicalCursors.get(sessionID) ?? new Set<string>()
      Object.values(response.cursor).forEach((token) => {
        if (token) issued.add(token)
      })
      canonicalCursors.set(sessionID, issued)
      return json(route, response)
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

    // Unmatched target-port requests keep answering 200 `{}` by default. A blanket
    // 404 here was tried and reverted: bootstrap paths the app tolerates
    // (`/api/permission/request`, …) turned into console-error floods that failed
    // every spec asserting "no unexpected browser errors" and stretched the suite
    // past its budget. The mock CAN express the real 404 shape (`notFound`) and
    // does so for unknown sessions, which is the surface §7.2 needs.
    //
    // Strict-mode verdict (S4 #4, plan §7.2 边界裁决): an opt-in "unmatched → 404"
    // mode is NOT added. The consumer it was reserved for — the mock/real
    // shape-consistency proof — is satisfied by E4's real backend
    // (e2e/real/session-not-found.spec.ts) plus the E3 shape assertion in
    // unknown-route.spec.ts; a second, stricter mock mode would have no caller.
    // Reopen only if a future spec needs unmatched-path 404s.
    // Same-origin previews still need SDK fallbacks, but navigations and frontend assets must pass through.
    // Directory-scoped SDK calls carry the directory query; global V2 calls use the /api/ prefix.
    if (shouldMockApiFallback({ url, targetPort, appPort, resourceType: route.request().resourceType() })) {
      return json(route, {})
    }
    return route.fallback()
  })
}

export function shouldMockApiFallback(input: { url: URL; targetPort: string; appPort: string; resourceType: string }) {
  if (input.url.port !== input.targetPort) return false
  if (input.targetPort !== input.appPort) return true
  if (input.resourceType !== "fetch" && input.resourceType !== "xhr") return false
  return input.url.searchParams.has("directory") || input.url.pathname.startsWith("/api/")
}

function notFound(route: Route, message: string) {
  return json(route, { name: "NotFoundError", data: { message } }, undefined, 404)
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
