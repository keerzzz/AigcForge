import type { Page } from "@playwright/test"
import type {
  AigcForgeEvent,
  AgentInfo,
  SessionMessageInfo,
  SessionForkInput,
  DelegationLegacyState,
  PersonalMemoryInfo,
  WorkflowAssetWorkflowStatusResponse,
  WorkflowAssetInfo,
  AgentAssetSummary,
  MetaAgentRead,
  MetaAgentMemoryRecord,
  SessionInstanceCacheDiagnostics,
  WorkArtifactApplyOutput,
  WorkArtifactApplyInput,
  DelegationResult,
  DelegationResultInput,
  SessionIdentityIdentity,
  SessionTaskOperationInfo,
  SessionGoalInfo,
  SessionCommunicationMessage,
  SessionCommunicationReceipt,
  SessionCommunicationCapability,
  ScheduleRule,
  ScheduleOccurrence,
} from "@aigcfroge/client/promise"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Permission } from "@aigcfroge/schema/permission"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Event } from "@aigcfroge/schema/event"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Session } from "@aigcfroge/schema/session"
import { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import { WorkContract } from "@aigcfroge/schema/work-contract"
import { Model } from "@aigcfroge/schema/model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { ProviderDiscovery } from "@aigcfroge/schema/provider-discovery"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { Worktree } from "@aigcfroge/schema/worktree"
import { ApiNotFoundError, ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import type { SessionInstanceGroup } from "@aigcfroge/protocol/groups/session-instance"
import { WorkspaceRoutingQuery } from "@aigcfroge/protocol/middleware/workspace-routing"
import { LegacyDelegationState } from "@aigcfroge/protocol/groups/delegation"
import {
  CustomProfileApplyPayload,
  CustomProfileContentQuery,
  CustomProfileListQuery,
} from "@aigcfroge/protocol/groups/custom-profile"
import { DateTime, Duration, Effect, Layer, Option, Predicate, Schema } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { SERVER } from "./app"
import {
  MockApi,
  MockBadRequest,
  MockInternal,
  MockNotFound,
  MockPtyNotFound,
  MockShellNotFound,
  MockUnauthorized,
  MockUnsupported,
} from "./mock-api"
import { installSseTransport } from "./sse-transport"

type Resolvable<T> = T | (() => T)

// A hook's replacement response.
export type MockAnswer = { status: number; body: unknown }

// The legacy `/provider` catalog: `all` lists providers with `id`, `name` and `models` keyed by model ID.
export type MockProviderCatalog = {
  all?: readonly unknown[]
  connected?: readonly string[]
  default?: { providerID?: string; modelID?: string }
}

// A session in any shape a scenario seeds, current or legacy (`directory`, `path`); `currentSession` reads it.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- scenarios seed arbitrary session fields
export type MockSession = { id: string } & Record<string, unknown>

type MockSessionLocation = { directory: string | undefined; workspaceID?: string }

export type MockMcpStatus = { status: string; error?: string }

type MockTaskScope = { sessionID: string; directory: string }

export type MockTaskMutation = MockTaskScope &
  (
    | {
        action: "create"
        body: Schema.Schema.Type<HttpApiEndpoint.Payload<typeof SessionInstanceGroup.endpoints.createTask>>
      }
    | {
        action: "patch"
        taskID: string
        body: Schema.Schema.Type<HttpApiEndpoint.Payload<typeof SessionInstanceGroup.endpoints.patchTask>>
      }
    | { action: "delete"; taskID: string }
  )

export type MockGoalMutation = { sessionID: string } & (
  | { action: "set"; body: typeof SessionGoal.CreateInput.Type }
  | { action: "edit"; goalID: string; body: typeof SessionGoal.EditInput.Type }
  | { action: "pause" | "resume" | "cancel"; goalID: string; body: typeof SessionGoal.RevisionInput.Type }
  | { action: "confirm"; goalID: string; body: typeof SessionGoal.ConfirmInput.Type }
)

export type MockCommunicationMutation = { sessionID: string; directory?: string; workspace?: string } & (
  | { action: "send"; body: SessionCommunication.Send }
  | { action: "reply"; communicationID: string; body: SessionCommunication.Reply }
)

export type MockScheduleMutation = (
  | { action: "create"; body: Schedule.Create }
  | { action: "edit"; id: string; body: Schedule.Edit }
  | { action: "pause" | "resume" | "cancel" | "run"; id: string; body: Schedule.Mutation }
  | { action: "cancelRun"; occurrenceID: string }
) & { directory?: string; workspace?: string }

export type MockFileContent =
  | string
  | { type?: string; content: string; encoding?: string; mimeType?: string }
  | undefined

export interface MockServerConfig {
  server?: string
  provider: Resolvable<MockProviderCatalog>
  agents?: Resolvable<AgentInfo[]>
  integrations?: unknown[]
  providerDefinitions?: Resolvable<Schema.Codec.Encoded<typeof ProviderDefinition.List>>
  modelGroups?: Resolvable<Schema.Codec.Encoded<typeof ModelGroup.Read>>
  onModelGroupSave?: (
    input: typeof ModelGroup.SaveInput.Type,
  ) => Schema.Codec.Encoded<typeof ModelGroup.SaveResult> | Promise<Schema.Codec.Encoded<typeof ModelGroup.SaveResult>>
  onModelGroupRemove?: (
    input: typeof ModelGroup.RemoveInput.Type,
  ) =>
    | Schema.Codec.Encoded<typeof ModelGroup.RemoveResult>
    | Promise<Schema.Codec.Encoded<typeof ModelGroup.RemoveResult>>
  providerDiscovery?: (
    input: typeof ProviderDiscovery.GetInput.Type,
  ) => Schema.Codec.Encoded<typeof ProviderDiscovery.Read>
  onProviderDiscoveryPreview?: (
    input: typeof ProviderDiscovery.PreviewInput.Type,
  ) =>
    | Schema.Codec.Encoded<typeof ProviderDiscovery.Read>
    | Promise<Schema.Codec.Encoded<typeof ProviderDiscovery.Read>>
  onProviderDiscoveryRefresh?: (
    input: typeof ProviderDiscovery.RefreshInput.Type,
  ) =>
    | Schema.Codec.Encoded<typeof ProviderDiscovery.Read>
    | Promise<Schema.Codec.Encoded<typeof ProviderDiscovery.Read>>
  onProviderDefinitionSave?: (
    input: typeof ProviderDefinition.SaveInput.Type,
  ) =>
    | Schema.Codec.Encoded<typeof ProviderDefinition.SaveResult>
    | Promise<Schema.Codec.Encoded<typeof ProviderDefinition.SaveResult>>
  onProviderDefinitionRemove?: (
    input: typeof ProviderDefinition.RemoveInput.Type,
  ) =>
    | Schema.Codec.Encoded<typeof ProviderDefinition.RemoveResult>
    | Promise<Schema.Codec.Encoded<typeof ProviderDefinition.RemoveResult>>
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  // Terminal shells the settings offer (`/api/config/shell`).
  shells?: unknown[]
  // Background shell commands (`GET /api/shell`).
  shellCommands?: Resolvable<unknown[]>
  // All output a shell command has captured so far in `directory`, or undefined for an unknown command (404
  // ShellNotFoundError). The mock pages it like the server: from the request's byte `cursor`, at most `limit` bytes
  // (default 65,536).
  shellOutput?: (input: { id: string; directory: string }) => string | undefined
  // Records `POST /api/experimental/fs/write` (attachment uploads), which answers the requested path.
  // Without it, writes answer 501 MockUnsupported.
  onFileWrite?: (input: { path: string; directory: string; body: string }) => void
  configEntries?: unknown[]
  directory: string
  project: unknown
  // Replaces the `/api/project` inventory, which defaults to `[project]`.
  projects?: Resolvable<unknown[]>
  sessions: MockSession[]
  pageMessages: (
    sessionId: string,
    limit: number,
    before?: string,
  ) => {
    items: SessionMessageInfo[]
    cursor?: string
  }
  vcs?: { current: string; default: string }
  // Initializes the mock project's VCS; without a handler this mutation answers 501.
  onVcsInit?: (input: { directory: string; provider?: string }) => void
  vcsDiff?: unknown[] | ((input: { mode?: string }) => unknown[])
  // Benchmark latency only. Tests hold message pages with `beforeMessagesResponse`.
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => SessionMessageInfo | undefined
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  onRevertStage?: (input: { sessionID: string; messageID: string }) => void
  onSession?: ((sessionID: string) => void) | ((sessionID: string) => Promise<void>)
  sessionReadError?: (sessionID: string) => MockNotFound | undefined
  compositions?: Record<string, Composition.Snapshot>
  profiles?: Resolvable<CustomProfile.Info[]>
  onProfileList?: (input: { directory: string; search?: string }) => MockAnswer | Promise<MockAnswer>
  onProfileContent?: (input: { directory: string; path: string }) => MockAnswer | Promise<MockAnswer>
  onProfileApply?: (input: {
    directory: string
    body: typeof CustomProfileApplyPayload.Type
  }) => (MockAnswer & { disconnect?: boolean }) | Promise<MockAnswer & { disconnect?: boolean }>
  onCompositionPlan?: (input: {
    directory: string
    body: Composition.CompositionInput
  }) => MockAnswer | Promise<MockAnswer>
  onCompositionStart?: (input: {
    directory: string
    body: Composition.StartInput
  }) => (MockAnswer & { disconnect?: boolean }) | Promise<MockAnswer & { disconnect?: boolean }>
  onSessionFork?: (input: SessionForkInput) => void | Promise<void>
  // Mutable persisted Task rows shared with the scenario; reads and single-row writes retain other Sessions' rows.
  tasks?: SessionTask.Info[]
  identities?: Record<string, SessionIdentityIdentity | undefined>
  onIdentityRead?: (sessionID: string) => void | Promise<void>
  operations?: SessionTaskOperationInfo[]
  onOperationRead?: (input: {
    sessionID: string
    operationID?: string
  }) => void | InvalidRequestError | Promise<void | InvalidRequestError>
  onTaskDispatch?: (input: {
    sessionID: string
    request: SessionTask.OperationRequest
  }) =>
    | SessionTaskOperationInfo
    | InvalidRequestError
    | ConflictError
    | Promise<SessionTaskOperationInfo | InvalidRequestError | ConflictError>
  onTaskCancelOperation?: (input: {
    sessionID: string
    operationID: string
  }) => SessionTaskOperationInfo | InvalidRequestError | Promise<SessionTaskOperationInfo | InvalidRequestError>
  communications?: SessionCommunicationMessage[]
  communicationCapabilities?: Record<string, SessionCommunicationCapability>
  onCommunicationRead?: (input: {
    sessionID: string
    communicationID?: string
    directory?: string
    workspace?: string
    cursor?: string
    limit?: number
  }) => void | InvalidRequestError | Promise<void | InvalidRequestError>
  onCommunicationMutation?: (
    input: MockCommunicationMutation,
  ) =>
    | SessionCommunicationReceipt
    | InvalidRequestError
    | ConflictError
    | Promise<SessionCommunicationReceipt | InvalidRequestError | ConflictError>
  goals?: SessionGoalInfo[]
  onGoalRead?: (input: { sessionID: string; goalID?: string }) => void | Promise<void>
  onGoalMutation?: (
    input: MockGoalMutation,
  ) =>
    | SessionGoalInfo
    | InvalidRequestError
    | ConflictError
    | Promise<SessionGoalInfo | InvalidRequestError | ConflictError>
  schedules?: ScheduleRule[]
  scheduleRuns?: ScheduleOccurrence[]
  onScheduleRead?: (input: {
    sessionID?: string
    id?: string
    directory?: string
    workspace?: string
  }) => void | Promise<void>
  onScheduleMutation?: (
    input: MockScheduleMutation,
  ) =>
    | ScheduleRule
    | ScheduleOccurrence
    | InvalidRequestError
    | Promise<ScheduleRule | ScheduleOccurrence | InvalidRequestError>
  delegations?: Resolvable<DelegationLegacyState[]>
  onDelegationResult?: (
    input: DelegationResultInput,
  ) => DelegationResult | InvalidRequestError | Promise<DelegationResult | InvalidRequestError>
  memory?: PersonalMemoryInfo[]
  onMemoryRead?: () => InvalidRequestError | undefined
  onMemoryAction?: (
    action: "confirm" | "reject" | "edit" | "remove",
    id: string,
    body:
      | Schema.Schema.Type<HttpApiEndpoint.Payload<(typeof MockApi.groups.mock.endpoints)["memory.edit"]>>
      | undefined,
  ) => PersonalMemoryInfo | InvalidRequestError | Promise<PersonalMemoryInfo | InvalidRequestError>
  meta?: Record<string, MetaAgentRead>
  projectMemory?: Record<string, MetaAgentMemoryRecord[]>
  cacheDiagnostics?: Record<string, SessionInstanceCacheDiagnostics>
  onCacheRead?: (input: { sessionID: string }) => void | InvalidRequestError | Promise<void | InvalidRequestError>
  workflows?: Record<string, WorkflowAssetWorkflowStatusResponse>
  workflowHistory?: WorkflowAssetWorkflowStatusResponse[]
  onWorkflowRead?: (input: { sessionID: string; runID?: string }) => InvalidRequestError | undefined
  workflowAssets?: Resolvable<WorkflowAssetInfo[]>
  agentAssets?: Resolvable<AgentAssetSummary[]>
  onWorkflowAction?: (
    action: "run" | "cancelRun" | "cancelStep" | "retryStep",
    input: {
      sessionID: string
      runID?: string
      stepRunID?: string
      body: Schema.Schema.Type<
        HttpApiEndpoint.Payload<
          (typeof MockApi.groups.mock.endpoints)[
            | "workflow.run"
            | "workflow.cancelRun"
            | "workflow.cancelStep"
            | "workflow.retryStep"]
        >
      >
    },
  ) =>
    | WorkflowAssetWorkflowStatusResponse
    | InvalidRequestError
    | ConflictError
    | Promise<WorkflowAssetWorkflowStatusResponse | InvalidRequestError | ConflictError>
  onArtifactApply?: (
    input: WorkArtifactApplyInput,
  ) =>
    | WorkArtifactApplyOutput
    | ConflictError
    | InvalidRequestError
    | Promise<WorkArtifactApplyOutput | ConflictError | InvalidRequestError>
  fileReadAnswer?: (path: string) => MockAnswer | undefined | Promise<MockAnswer | undefined>
  onDelegationRead?: () => void | InvalidRequestError | Promise<void | InvalidRequestError>
  onDelegationAction?: (input: {
    action: "interrupt" | "close" | "reconcile" | "retry"
    delegationID: string
    turnID?: string
    directory: string
    body: unknown
  }) => DelegationLegacyState | InvalidRequestError | Promise<DelegationLegacyState | InvalidRequestError>
  onTaskRead?: (input: MockTaskScope) => void | InvalidRequestError | Promise<void | InvalidRequestError>
  // Runs before a single-row mutation, so scenarios can observe or hold its request at the API boundary.
  onTaskMutation?: (input: MockTaskMutation) => void | Promise<void>
  events?: () => AigcForgeEvent[]
  eventRetry?: number
  // Idle event streams send a comment every 15 s like the real server. Set false only to test the client's stall watchdog.
  keepalive?: boolean
  permissions?: unknown[] | (() => unknown[])
  // Requests only listed by `/api/session/:id/permission`, keyed by session ID.
  sessionPermissions?: Record<string, unknown[]>
  // Returning true fails the next `/api/permission/request` listing with a 500.
  permissionListFailures?: () => boolean
  // Without it, permission replies answer 501 MockUnsupported.
  onPermissionReply?: (input: { sessionID: string; permissionID: string; body: unknown }) => void
  forms?: unknown[] | (() => unknown[])
  // MCP servers. A list serves every workspace; a function receives the requested directory.
  mcp?: unknown[] | ((directory: string) => unknown[])
  // Connect/disconnect record the server's new status in that workspace (`connected`/`disabled`); the hook may return
  // another status (for example `{ status: "failed", error }`). Unknown servers answer 404.
  onMcpAction?: (input: { server: string; action: "connect" | "disconnect"; directory: string }) => void | MockMcpStatus
  // Starts an OAuth attempt (POST .../connect/oauth) and returns its authorization URL; the attempt then stays pending.
  // Without it, OAuth connects answer 501 MockUnsupported.
  onIntegrationOAuth?: (input: { integrationID: string; directory: string; body: unknown }) => { url: string }
  plugins?: Resolvable<unknown[]>
  skills?: Resolvable<unknown[]>
  // Replaces the `/api/worktree` inventory, which defaults to the directory plus project sandboxes.
  worktrees?: Resolvable<unknown[]>
  // Without them, creating or removing a worktree answers 501 MockUnsupported. `onWorktreeCreate` may hold the request
  // and return the answer; by default it creates `<directory>/<name>`. A created directory joins the project's sandboxes.
  onWorktreeCreate?: (input: Schema.Json) => void | MockAnswer | Promise<void | MockAnswer>
  onWorktreeRemove?: (input: Worktree.RemoveInput) => void | Promise<void>
  // POST /api/session keeps the client-reserved `id` and `location`. Return an answer to fail the attempt (1-based).
  onSessionCreate?: (body: Schema.JsonObject, attempt: number) => void | MockAnswer
  // Controlled SC04 creation/first-question responses, including a held ACK or a stage-B failure.
  onConsultation?: (
    input: { sourceSessionID: string; body: Schema.Schema.Type<typeof SessionConsultation.Input> },
    attempt: number,
  ) => MockAnswer | Promise<MockAnswer>
  // Read-only saved reference/admission. Returning this never admits or wakes a prompt.
  onConsultationRead?: (sessionID: string) => MockAnswer | Promise<MockAnswer>
  // Records the actual target stop; without it an idle target answers interrupted=false.
  onInterrupt?: (sessionID: string) => { interrupted: boolean } | Promise<{ interrupted: boolean }>
  // Title of created sessions (default: the request's title, else "New session").
  createdSessionTitle?: string
  // Slash commands served by `/api/command`.
  commands?: Resolvable<unknown[]>
  // Records POST /api/session/:id/command (204). Without it, commands answer 501 MockUnsupported.
  onCommand?: (input: { sessionID: string; body: unknown }) => void
  fileList?: (path: string) => unknown[] | Promise<unknown[]>
  fileContent?: (path: string) => MockFileContent | Promise<MockFileContent>
  // Paths become directory entries.
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown[]
  sessionStatus?: Resolvable<Record<string, { type: string }>>
  inbox?: unknown[] | (() => unknown[])
  onPrompt?: (input: { sessionID: string; body: Schema.JsonObject }) => void
  onCompact?: (input: { sessionID: string; body: Schema.JsonObject }) => void
  generate?: (input: { sessionID: string; prompt: string }) => { text: string } | Promise<{ text: string }>
  onInboxChange?: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }) => void
  // Serves `/api/pty*` and mock PTY WebSockets. Created IDs are the first unused `${prefix}<n>` (prefix must start with "pty").
  // `directory` is the owning workspace (Location); `cwd` is the reported working directory (default: `directory`).
  pty?: { prefix?: string; initial?: { id: string; title: string; directory?: string; cwd?: string }[] }
  // Answers 500 InvalidDirectory when a request names a directory this server does not own.
  strictDirectory?: boolean
  // Answers 401 UnauthorizedError unless a request carries this password; a function may change it mid-test.
  password?: Resolvable<string>
  // Serves GET /auth/connect/:code: `code` redeems once for `token` (send it as the password); others answer 401.
  pairing?: { code: string; token: string }
}

export type MockPtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type MockPtySocket = {
  id: string
  url: URL
  input: string[]
  closed: boolean
  send(data: string): void
  close(code: number, reason: string): Promise<void>
}

export type MockPty = {
  list: MockPtyInfo[]
  created: MockPtyInfo[]
  removed: string[]
  updates: { id: string; body: unknown }[]
  tokens: { id: string; headers: Record<string, string>; ticket: string }[]
  sockets: MockPtySocket[]
  // WebSockets closed with 1008 because the PTY, its workspace, or an unused issued ticket did not match.
  rejected: { id: string; url: URL; reason: string }[]
  // Writes output to the newest open socket, optionally for one PTY.
  send(data: string, id?: string): void
}

// The page relays events as opaque values; benchmarks also push their own payloads.
type MockStream = { push: (payloads: readonly unknown[]) => void }

type MockStreamState = {
  controller?: ReadableStreamDefaultController<Uint8Array>
  buffer: string[]
  connections: number
}

// The `installSseTransport` command that delivers events.
type MockSendCommand = { type: "send"; deliveries: { payload: unknown }[]; burst: boolean }

type MockStreamWindow = Window & {
  // Set to any value by benchmarks that bring their own event stream.
  __testSseTransport?: unknown
  // `installSseTransport` registrations.
  __testSseTransports?: Record<string, { command: (input: MockSendCommand) => void }>
  // Per-origin mock event streams; in-page benchmark probes push through them directly.
  __mockServerStreams?: Record<string, MockStream>
}

export async function mockAigcForgeServer(page: Page, config: MockServerConfig) {
  const server = config.server ?? SERVER

  mockedOrigins(page).add(server)

  await page.addInitScript(
    ({ server, retry, keepalive: idle }) => {
      // SAFETY: only this script, `installSseTransport`, and benchmarks write these globals, in the declared shapes.
      const host = window as MockStreamWindow

      if (host.__testSseTransport || host.__testSseTransports?.[server] || host.__mockServerStreams?.[server]) return
      const originalFetch = window.fetch.bind(window)
      const encoder = new TextEncoder()
      const state: MockStreamState = { buffer: [], connections: 0 }
      const frame = (data: string) => `data: ${data}\n\n`

      const stream: MockStream = {
        push(payloads) {
          const frames = payloads.map((payload) => frame(JSON.stringify(payload)))
          const controller = state.controller

          if (!controller) {
            state.buffer.push(...frames)

            return
          }

          frames.forEach((item) => controller.enqueue(encoder.encode(item)))
        },
      }

      host.__mockServerStreams = { ...host.__mockServerStreams, [server]: stream }

      const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)

        if (url.origin !== server || url.pathname !== "/api/event") return originalFetch(request)
        state.connections += 1
        const id = state.connections
        let ended = false
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        let keepalive: ReturnType<typeof setInterval> | undefined

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            own = controller
            state.controller = controller

            if (retry !== undefined) controller.enqueue(encoder.encode(`retry: ${retry}\n\n`))
            controller.enqueue(
              encoder.encode(
                frame(JSON.stringify({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
              ),
            )
            state.buffer.splice(0).forEach((item) => controller.enqueue(encoder.encode(item)))

            // Match the real server's idle stream so long scenarios do not
            // trigger the client's 45-second stall watchdog and reload history.
            if (idle) keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
            request.signal.addEventListener(
              "abort",
              () => {
                if (ended) return
                ended = true
                clearInterval(keepalive)

                if (state.controller === controller) state.controller = undefined
                controller.error(request.signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
              },
              { once: true },
            )
          },
          cancel() {
            if (ended) return
            ended = true
            clearInterval(keepalive)

            if (state.controller === own) state.controller = undefined
          },
        })

        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
          }),
        )
      }

      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch })
    },
    { server, retry: config.eventRetry, keepalive: config.keepalive !== false },
  )

  // Delivers events on this server's mock stream; buffered until the app connects.
  // An origin served by an SSE transport receives the events as one burst on its active connection.
  const push = (payloads: readonly AigcForgeEvent[]) =>
    page.evaluate<void, { server: string; payloads: readonly unknown[] }>(
      ({ server, payloads }) => {
        // SAFETY: only the init script, `installSseTransport`, and benchmarks write these globals, in the declared shapes.
        const host = window as MockStreamWindow
        const stream = host.__mockServerStreams?.[server]

        if (stream) return stream.push(payloads)
        const transport = host.__testSseTransports?.[server]

        if (!transport) throw new Error(`No mock event stream for ${server}`)
        transport.command({ type: "send", deliveries: payloads.map((payload) => ({ payload })), burst: true })
      },
      { server, payloads },
    )

  // Server-side events the mock publishes itself; delivery failures other than a missing document fail the test.
  const emit = (events: AigcForgeEvent[]) =>
    void push(events).catch((cause: unknown) => {
      if (page.isClosed() || retryableDelivery(cause)) return
      throw cause
    })

  if (config.events) {
    // Batches stay queued until the page accepts them; failures other than a missing document fail the test.
    const pending: AigcForgeEvent[] = []
    const pump = { busy: false, pending }

    const timer = setInterval(() => {
      if (pump.busy) return
      pump.pending.push(...(config.events?.() ?? []))

      if (pump.pending.length === 0) return
      pump.busy = true
      const batch = pump.pending.slice()
      void push(batch)
        .then(
          () => {
            pump.pending.splice(0, batch.length)
          },
          (cause: unknown) => {
            if (page.isClosed()) return clearInterval(timer)

            if (retryableDelivery(cause)) return
            clearInterval(timer)
            throw cause
          },
        )
        .finally(() => {
          pump.busy = false
        })
    }, 50)

    page.on("close", () => clearInterval(timer))
  }

  const transport = createMockServerHandler(config, emit)
  page.on("close", () => void transport.dispose())

  await page.route(
    /\/api\/|\/(?:memory|agent-task|delegation|agent-asset|workflow-asset|custom-composition|custom-profile|schedule)(?:\/|\?|$)|\/session\/[^/?]+\/(?:task(?:\/[^?]*)?|identity|composition|meta|project-memory(?:\/[^/?]+)?|cache-diagnostics|workflow(?:\/[^?]*)?|work-artifact\/apply)(?:\?|$)/,
    async (route) => {
      const url = new URL(route.request().url())

      if (!answers(page, server, url)) return route.fallback()

      // Production serves the UI and API from one origin; leave app assets to Vite.
      if (
        !url.pathname.startsWith("/api/") &&
        !/^\/(?:memory|agent-task|delegation|agent-asset|workflow-asset|custom-composition|custom-profile|schedule)(?:\/|$)/.test(
          url.pathname,
        ) &&
        !/^\/session\/[^/]+\/(?:task(?:\/.*)?|identity|composition|meta|project-memory(?:\/[^/]+)?|cache-diagnostics|workflow(?:\/.*)?|work-artifact\/apply)$/.test(
          url.pathname,
        )
      )
        return route.fallback()

      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: corsHeaders })
      }

      const password = config.password === undefined ? undefined : resolve(config.password)

      if (
        password !== undefined &&
        (await route.request().headerValue("authorization")) !== `Basic ${btoa(`aigcfroge:${password}`)}`
      ) {
        return route.fulfill({
          status: 401,
          headers: corsHeaders,
          json: Schema.encodeSync(MockUnauthorized)(new MockUnauthorized({ message: "Authentication required" })),
        })
      }

      const directory = url.searchParams.get("directory") ?? url.searchParams.get("location[directory]")

      if (config.strictDirectory && directory && !ownedDirectories(config).has(directory)) {
        return route.fulfill({ status: 500, headers: corsHeaders, json: { name: "InvalidDirectory" } })
      }

      const body = route.request().postDataBuffer()

      const response = await transport.handler(
        new Request(url, {
          method: route.request().method(),
          headers: route.request().headers(),
          body: body ? Uint8Array.from(body) : undefined,
        }),
      )

      const payload = Buffer.from(await response.arrayBuffer())

      // The handler committed its normal state, but this scenario loses the HTTP reply.
      if (response.headers.get("x-aigcfroge-mock-disconnect") === "true") return route.abort("connectionclosed")

      // A handler's 404 carries a tagged error; a route the mock does not define must not reach the app server, whose
      // SPA fallback would answer HTML 200. Answer 501 and fail the test from the route handler.
      if (response.status === 404 && !payload.toString().includes('"_tag"')) {
        const request = `${route.request().method()} ${url.pathname}`
        await route.fulfill({
          status: 501,
          headers: corsHeaders,
          json: { name: "MockUnsupported", message: `The mock server has no route for ${request}` },
        })
        throw new Error(`Unmocked API request: ${request} (add it to e2e/utils/mock-server.ts)`)
      }

      return route.fulfill({
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
        body: payload,
      })
    },
  )

  if (config.pairing) {
    const pairing = { ...config.pairing, redeemed: false }

    await page.route(`${server}/auth/connect/*`, (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders })
      const code = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "")

      if (code !== pairing.code || pairing.redeemed) {
        return route.fulfill({
          status: 401,
          headers: corsHeaders,
          json: Schema.encodeSync(MockUnauthorized)(
            new MockUnauthorized({ message: "Pairing link expired or already used" }),
          ),
        })
      }

      pairing.redeemed = true

      return route.fulfill({ headers: corsHeaders, json: { token: pairing.token } })
    })
  }

  if (config.pty) {
    const host = new URL(server).host
    await page.routeWebSocket(
      (url) => url.host === host && /^\/api\/pty\/[^/]+\/connect$/.test(url.pathname),
      (ws) => {
        const url = new URL(ws.url())
        const id = decodeURIComponent(url.pathname.split("/")[3]!)
        const reason = transport.pty.admit(id, url)

        if (reason) {
          transport.pty.rejected.push({ id, url, reason })

          return ws.close({ code: 1008, reason })
        }

        const socket: MockPtySocket = {
          id,
          url,
          input: [],
          closed: false,
          send: (data) => ws.send(data),
          close: (code, reason) => ws.close({ code, reason }),
        }

        ws.onMessage((message) => socket.input.push(message.toString()))
        ws.onClose(() => {
          socket.closed = true
        })
        transport.pty.sockets.push(socket)
      },
    )
  }

  return { server, pty: transport.pty, push }
}

// Mocks several servers on one page. Each origin gets its own handler and its own SSE transport for events.
export async function mockServers(page: Page, servers: Record<string, Omit<MockServerConfig, "server" | "events">>) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(servers).map(async ([origin, config]) => {
        const transport = await installSseTransport(page, {
          server: origin,
          retry: config.eventRetry,
          keepalive: config.keepalive,
        })

        const mock = await mockAigcForgeServer(page, { ...config, server: origin })

        return [origin, { transport, pty: mock.pty }] as const
      }),
    ),
  )
}

// `emit` publishes the events a real server sends after a mutation (without a page, nothing is published).
export function createMockServerHandler(config: MockServerConfig, emit: (events: AigcForgeEvent[]) => void = () => {}) {
  const pty = createPty(config)

  const web = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(MockApi).pipe(
      Layer.provide(
        mockHandlers(config, {
          cursors: new Map<string, string>(),
          nextCursor: 0,
          sessionCreates: 0,
          consultationCreates: 0,
          tasks: config.tasks ?? [],
          pty,
          emit,
          mcp: new Map<string, MockMcpStatus>(),
          attempts: new Map<string, number>(),
        }),
      ),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )

  return { ...web, pty }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "x-next-cursor",
}

const APP_ORIGIN = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
).origin

const registeredOrigins = new WeakMap<Page, Set<string>>()

function mockedOrigins(page: Page) {
  const found = registeredOrigins.get(page)

  if (found) return found
  const created = new Set<string>()
  registeredOrigins.set(page, created)

  return created
}

// A server answers its own origin. Production builds call the API on the app origin, which the default server also
// answers unless a server was configured for the app origin explicitly.
function answers(page: Page, server: string, url: URL) {
  if (url.origin === server) return true

  return server === SERVER && url.origin === APP_ORIGIN && !mockedOrigins(page).has(APP_ORIGIN)
}

// The document is not loaded yet or is being replaced; the pump retries on its next tick.
function retryableDelivery(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)

  return [
    "No mock event stream",
    "Execution context was destroyed",
    "Target page, context or browser has been closed",
  ].some((text) => message.includes(text))
}

const PTY_TICKET = "e2e-ticket"

function createPty(config: MockServerConfig) {
  const info = (id: string, title: string, cwd = config.directory): MockPtyInfo => ({
    id,
    title,
    command: "cmd.exe",
    args: [],
    cwd,
    status: "running",
    pid: 1,
  })

  // Core scopes PTYs by Location, which can differ from the process cwd, so ownership is kept apart from `cwd`.
  const owners = new Map((config.pty?.initial ?? []).map((item) => [item.id, item.directory ?? config.directory]))
  // Issued, not yet used connect tickets, each bound to one PTY and workspace.
  const tickets: { id: string; directory: string; ticket: string }[] = []
  const issued = { count: 0 }
  const owns = (item: MockPtyInfo, directory: string) => owners.get(item.id) === directory

  const pty: MockPty = {
    list: (config.pty?.initial ?? []).map((item) => info(item.id, item.title, item.cwd ?? item.directory)),
    created: [],
    removed: [],
    updates: [],
    tokens: [],
    sockets: [],
    rejected: [],
    send(data, id) {
      const socket = pty.sockets.findLast((item) => !item.closed && (id === undefined || item.id === id))

      if (!socket) throw new Error(`No open PTY socket${id ? ` for ${id}` : ""}`)
      socket.send(data)
    },
  }

  return Object.assign(pty, {
    info,
    // The first `${prefix}<n>` no initial, created, or removed PTY has used.
    allocate() {
      const prefix = config.pty?.prefix ?? "pty_"
      const used = new Set([...pty.list, ...pty.created].map((item) => item.id).concat(pty.removed))

      const number = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find(
        (value) => !used.has(`${prefix}${value}`),
      )!

      return { id: `${prefix}${number}`, number }
    },
    add(created: MockPtyInfo, directory: string) {
      owners.set(created.id, directory)
      pty.created.push(created)
      pty.list.push(created)
    },
    find: (id: string, directory: string) => pty.list.find((item) => item.id === id && owns(item, directory)),
    owned: (directory: string) => pty.list.filter((item) => owns(item, directory)),
    // Unique per server; the first stays `e2e-ticket` so single-terminal specs can assert a fixed value.
    issue(id: string, directory: string) {
      issued.count += 1
      const ticket = issued.count === 1 ? PTY_TICKET : `${PTY_TICKET}-${issued.count}`
      tickets.push({ id, directory, ticket })

      return ticket
    },
    // Returns why a connect URL is refused: the PTY must exist, belong to the requested workspace, and carry the exact
    // unused ticket issued for that PTY and workspace. Admission consumes the ticket.
    admit(id: string, url: URL) {
      const found = pty.list.find((item) => item.id === id)

      if (!found) return "PTY not found"
      const directory = url.searchParams.get("location[directory]") || config.directory

      if (!owns(found, directory)) return "PTY belongs to another workspace"
      const ticket = url.searchParams.get("ticket")

      const index = tickets.findIndex(
        (item) => item.id === id && item.directory === directory && item.ticket === ticket,
      )

      if (index < 0) return "No unused ticket was issued for this PTY"
      tickets.splice(index, 1)
    },
  })
}

// Every directory this server's configuration names: its own, project and inventory worktrees, and session locations.
function ownedDirectories(config: MockServerConfig) {
  const projects = [config.project, ...(config.projects ? resolve(config.projects) : [])].flatMap((item) =>
    Option.toArray(decodeProject(item)),
  )

  return new Set(
    [
      config.directory,
      ...projects.flatMap((item) => [item.worktree, item.canonical, ...(item.sandboxes ?? [])]),
      ...(config.worktrees ? resolve(config.worktrees) : []).filter(Predicate.isObject).map((item) => item.directory),
      ...config.sessions.map((session) =>
        Predicate.isObject(session.location) ? session.location.directory : session.directory,
      ),
    ].filter(Predicate.isString),
  )
}

function addSandbox(config: MockServerConfig, directory: string) {
  // SAFETY: a scenario that creates worktrees seeds its project as an object whose `sandboxes` lists directories.
  const project = config.project as { sandboxes?: string[] }

  if (project.sandboxes?.includes(directory)) return
  project.sandboxes = [...(project.sandboxes ?? []), directory]
}

// The requested `location[directory]`; absent or empty (a server-level read) means the server directory.
function requestDirectory(config: MockServerConfig, request: { url: string }) {
  return new URL(request.url, "http://localhost").searchParams.get("location[directory]") || config.directory
}

function resolve<T>(value: Resolvable<T>) {
  // SAFETY: no resolvable scenario value is itself a function, so a function is the value's resolver.
  return Predicate.isFunction(value) ? (value as () => T)() : value
}

function mockHandlers(
  config: MockServerConfig,
  state: {
    cursors: Map<string, string>
    nextCursor: number
    sessionCreates: number
    consultationCreates: number
    tasks: SessionTask.Info[]
    pty: ReturnType<typeof createPty>
    emit: (events: AigcForgeEvent[]) => void
    // MCP status overrides by `<directory>\n<server>`, and OAuth attempt creation times by attempt ID.
    mcp: Map<string, MockMcpStatus>
    attempts: Map<string, number>
  },
) {
  const noContent = Effect.succeed(HttpApiSchema.NoContent.make())
  const delay = config.messageDelay === undefined ? Effect.void : Effect.sleep(Duration.millis(config.messageDelay))
  const configEntries = config.configEntries ?? []

  const taskSession = (sessionID: string, query: Schema.Schema.Type<typeof WorkspaceRoutingQuery>) => {
    const session = config.sessions.find((item) => item.id === sessionID)

    if (!session) return
    const owner = currentSession(session, config.directory).location

    if ((query.directory ?? config.directory) !== owner.directory || query.workspace !== owner.workspaceID) return

    return session
  }

  const taskMutation = (input: MockTaskMutation) => Effect.promise(async () => config.onTaskMutation?.(input))

  const publishTasks = (sessionID: string, directory: string, created: number) => {
    const tasks = state.tasks.filter((task) => task.sessionID === sessionID)
    state.emit([
      {
        id: Event.ID.create(),
        created,
        type: SessionTaskEvent.Updated.type,
        location: { directory },
        data: {
          sessionID,
          tasks: tasks.map((task) => ({ ...task, dependsOn: task.dependsOn && [...task.dependsOn] })),
        },
      },
      {
        id: Event.ID.create(),
        created,
        type: SessionTaskEvent.TodoUpdated.type,
        location: { directory },
        data: {
          sessionID,
          todos: tasks.map((task) => ({ content: task.content, status: task.status, priority: task.priority })),
        },
      },
    ])
  }

  const ptyEnabled = Effect.suspend(() =>
    config.pty ? Effect.void : Effect.fail(new MockNotFound({ message: "PTY is not enabled for this mock server" })),
  )

  // PTYs are scoped to the workspace (`location[directory]`) they were created in, like the real server.
  const findPty = (id: string, request: { url: string }) =>
    ptyEnabled.pipe(
      Effect.andThen(() =>
        Effect.suspend(() => {
          const directory = requestDirectory(config, request)
          const found = state.pty.find(id, directory)

          return found
            ? Effect.succeed(found)
            : Effect.fail(new MockPtyNotFound({ ptyID: id, message: `PTY not found: ${id}` }))
        }),
      ),
    )

  const mcpServers = (directory: string) =>
    (Predicate.isFunction(config.mcp) ? config.mcp(directory) : (config.mcp ?? [])).map((server) => {
      if (!Predicate.isObject(server)) return server
      const status = state.mcp.get(`${directory}\n${String(server.name)}`)

      return status ? { ...server, status } : server
    })

  const mcpAction = (server: string, action: "connect" | "disconnect", request: { url: string }) =>
    Effect.suspend(() => {
      const directory = requestDirectory(config, request)

      if (!mcpServers(directory).some((item) => Predicate.isObject(item) && item.name === server))
        return Effect.fail(new MockNotFound({ message: `MCP server ${server} not found` }))

      const status = config.onMcpAction?.({ server, action, directory }) ?? {
        status: action === "connect" ? "connected" : "disabled",
      }

      state.mcp.set(`${directory}\n${server}`, status)

      return noContent
    })

  const unsupported = (operation: string, handler: string) =>
    Effect.fail(
      new MockUnsupported({ message: `The mock server does not ${operation}; configure ${handler} for this scenario` }),
    )

  const delegationAction = (
    action: "interrupt" | "close" | "reconcile" | "retry",
    input: {
      params: { delegationID: string; turnID?: string }
      query: Schema.Schema.Type<typeof WorkspaceRoutingQuery>
      payload: unknown
    },
  ) =>
    Effect.gen(function* () {
      const value = resolve(config.delegations ?? []).find((item) => item.delegation.id === input.params.delegationID)

      if (!value || !taskSession(value.delegation.parentSessionID, input.query))
        return yield* new InvalidRequestError({ message: "Delegation does not belong to this Location" })

      if (!config.onDelegationAction)
        return yield* new InvalidRequestError({
          message: "Delegation action is not configured",
          kind: "not_implemented",
        })

      const result = yield* Effect.promise(() =>
        Promise.resolve(
          config.onDelegationAction?.({
            action,
            ...input.params,
            directory: input.query.directory ?? config.directory,
            body: input.payload,
          }),
        ),
      )

      if (result instanceof InvalidRequestError) return yield* result

      return Schema.decodeUnknownSync(LegacyDelegationState)(result ?? value)
    })

  const memoryRead = (pending = false) =>
    Effect.gen(function* () {
      const error = config.onMemoryRead?.()

      if (error) return yield* error

      return (config.memory ?? []).filter((item) => !pending || item.status === "pending")
    })

  const memoryAction = (
    action: "confirm" | "reject" | "edit" | "remove",
    id: string,
    body: Parameters<NonNullable<MockServerConfig["onMemoryAction"]>>[2],
  ) =>
    Effect.gen(function* () {
      if (!config.onMemoryAction) return yield* new InvalidRequestError({ message: "Memory action is not configured" })
      const result = yield* Effect.promise(() => Promise.resolve(config.onMemoryAction?.(action, id, body)))

      if (result instanceof InvalidRequestError) return yield* result

      if (!result) return yield* new InvalidRequestError({ message: "Memory not found" })
      const position = config.memory?.findIndex((item) => item.id === id) ?? -1

      if (config.memory && position >= 0) config.memory[position] = result

      return result
    })

  const workflowAction = (
    action: "run" | "cancelRun" | "cancelStep" | "retryStep",
    params: { sessionID: string; runID?: string; stepRunID?: string },
    body: Parameters<NonNullable<MockServerConfig["onWorkflowAction"]>>[1]["body"],
  ) =>
    Effect.gen(function* () {
      if (!config.onWorkflowAction)
        return yield* new InvalidRequestError({ message: "Workflow action is not configured" })

      const result = yield* Effect.promise(() =>
        Promise.resolve(config.onWorkflowAction?.(action, { ...params, body })),
      )

      if (result instanceof InvalidRequestError || result instanceof ConflictError) return yield* result

      return result ?? { steps: [] }
    })

  const goalMutation = (input: MockGoalMutation) =>
    Effect.gen(function* () {
      if (!config.onGoalMutation) return yield* new InvalidRequestError({ message: "Goal mutation is not configured" })
      const result = yield* Effect.promise(() => Promise.resolve(config.onGoalMutation?.(input)))

      if (result instanceof InvalidRequestError || result instanceof ConflictError) return yield* result

      if (!result) return yield* new InvalidRequestError({ message: "Goal mutation returned no acknowledgement" })

      return { data: result }
    })

  const scheduleMutation = (input: MockScheduleMutation) =>
    Effect.gen(function* () {
      if (!config.onScheduleMutation)
        return yield* new InvalidRequestError({ message: "Schedule mutation is not configured" })
      const result = yield* Effect.promise(() => Promise.resolve(config.onScheduleMutation?.(input)))

      if (result instanceof InvalidRequestError) return yield* result

      if (!result) return yield* new InvalidRequestError({ message: "Schedule mutation returned no acknowledgement" })

      return result
    })

  const communicationMutation = (input: MockCommunicationMutation) =>
    Effect.gen(function* () {
      if (!config.onCommunicationMutation)
        return yield* new InvalidRequestError({ message: "Communication mutation is not configured" })
      const result = yield* Effect.promise(() => Promise.resolve(config.onCommunicationMutation?.(input)))

      if (result instanceof InvalidRequestError || result instanceof ConflictError) return yield* result

      if (!result)
        return yield* new InvalidRequestError({ message: "Communication mutation returned no acknowledgement" })

      return { data: result }
    })

  const communicationRead = (
    input: { sessionID: string; communicationID?: string },
    query: typeof WorkspaceRoutingQuery.Type & { cursor?: string; limit?: number },
  ) =>
    Effect.gen(function* () {
      if (!taskSession(input.sessionID, query))
        return yield* new ApiNotFoundError({
          name: "NotFoundError",
          data: { message: "Communication Session not found" },
        })
      const error = yield* Effect.promise(() => Promise.resolve(config.onCommunicationRead?.({ ...input, ...query })))

      if (error instanceof InvalidRequestError) return yield* error

      return (config.communications ?? []).filter(
        (message) =>
          (message.actor.sessionID === input.sessionID || message.targetSessionID === input.sessionID) &&
          (!input.communicationID || message.id === input.communicationID),
      )
    })

  const operationRead = (
    input: { sessionID: string; operationID?: string },
    query: typeof WorkspaceRoutingQuery.Type,
  ) =>
    Effect.gen(function* () {
      if (!taskSession(input.sessionID, query))
        return yield* new ApiNotFoundError({
          name: "NotFoundError",
          data: { message: "Task source Session not found" },
        })
      const error = yield* Effect.promise(() => Promise.resolve(config.onOperationRead?.(input)))

      if (error instanceof InvalidRequestError) return yield* error

      return (config.operations ?? []).filter(
        (operation) =>
          operation.sourceSessionID === input.sessionID &&
          (!input.operationID || operation.operationID === input.operationID),
      )
    })

  return HttpApiBuilder.group(MockApi, "mock", (handlers) =>
    handlers
      .handleRaw("profileList", (ctx) =>
        Effect.gen(function* () {
          const query = yield* Effect.orDie(
            Schema.decodeUnknownEffect(CustomProfileListQuery)(
              Object.fromEntries(new URL(ctx.request.url, "http://localhost").searchParams),
            ),
          )

          const handler = config.onProfileList

          if (handler) {
            const answer = yield* Effect.promise(() =>
              Promise.resolve(handler({ directory: query.directory ?? config.directory, search: query.search })),
            )

            return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
          }

          return HttpServerResponse.jsonUnsafe({
            assets: resolve(config.profiles ?? [])
              .filter((profile) => !query.search || profile.name.toLowerCase().includes(query.search.toLowerCase()))
              .map((profile) => ({
                kind: profile.kind,
                name: profile.name,
                description: profile.description,
                relativePath: profile.relativePath,
                revision: profile.revision,
              })),
            invalid: [],
          })
        }),
      )
      .handleRaw("profileContent", (ctx) =>
        Effect.gen(function* () {
          const query = yield* Effect.orDie(
            Schema.decodeUnknownEffect(CustomProfileContentQuery)(
              Object.fromEntries(new URL(ctx.request.url, "http://localhost").searchParams),
            ),
          )

          const handler = config.onProfileContent

          if (handler) {
            const answer = yield* Effect.promise(() =>
              Promise.resolve(handler({ directory: query.directory ?? config.directory, path: query.path })),
            )

            return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
          }

          const profile = resolve(config.profiles ?? []).find((profile) => profile.relativePath === query.path)

          if (!profile)
            return HttpServerResponse.jsonUnsafe(
              Schema.encodeSync(ApiNotFoundError)(
                new ApiNotFoundError({ name: "NotFoundError", data: { message: "Profile not found" } }),
              ),
              { status: 404 },
            )

          return HttpServerResponse.jsonUnsafe(Schema.encodeSync(Schema.toCodecJson(CustomProfile.Info))(profile))
        }),
      )
      .handleRaw("profileApply", (ctx) =>
        Effect.gen(function* () {
          const handler = config.onProfileApply

          if (!handler)
            return HttpServerResponse.jsonUnsafe(
              { name: "MockUnsupported", message: "No profile save configured" },
              { status: 501 },
            )

          const body = yield* Effect.orDie(
            ctx.request.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(CustomProfileApplyPayload))),
            ),
          )

          const directory =
            new URL(ctx.request.url, "http://localhost").searchParams.get("directory") ?? config.directory

          const answer = yield* Effect.promise(() => Promise.resolve(handler({ directory, body })))

          return HttpServerResponse.jsonUnsafe(answer.body, {
            status: answer.status,
            headers: answer.disconnect ? { "x-aigcfroge-mock-disconnect": "true" } : undefined,
          })
        }),
      )
      .handle("agent-asset.list", () => Effect.succeed({ assets: resolve(config.agentAssets ?? []), invalid: [] }))
      .handle("workflow-asset.list", () =>
        Effect.succeed({
          assets: resolve(config.workflowAssets ?? []).map((asset) => ({
            kind: asset.kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: [],
        }),
      )
      .handle("workflow-asset.content", ({ query }) =>
        Effect.gen(function* () {
          const asset = resolve(config.workflowAssets ?? []).find((asset) => asset.relativePath === query.path)

          if (!asset) return yield* new InvalidRequestError({ message: "Workflow asset not found" })

          return asset
        }),
      )
      .handle("memory.list", () => memoryRead())
      .handle("memory.pending", () => memoryRead(true))
      .handle("memory.confirm", ({ params }) => memoryAction("confirm", params.id, undefined))
      .handle("memory.reject", ({ params }) => memoryAction("reject", params.id, undefined))
      .handle("memory.edit", ({ params, payload }) => memoryAction("edit", params.id, payload))
      .handle("memory.remove", ({ params }) => memoryAction("remove", params.id, undefined))
      .handle("hub.list", ({ query }) =>
        Effect.succeed((config.tasks ?? []).filter((task) => !!taskSession(task.sessionID, query))),
      )
      .handle("meta.get", ({ params }) => Effect.succeed(config.meta?.[params.sessionID] ?? { sessions: [] }))
      .handle("facts.get", ({ params, query }) =>
        Effect.succeed(
          (config.projectMemory?.[params.sessionID] ?? []).filter(
            (fact) =>
              (!query.keyword || fact.content.includes(query.keyword)) &&
              (!query.category || fact.factCategory === query.category),
          ),
        ),
      )
      .handle("facts.remove", ({ params }) =>
        Effect.sync(() => {
          if (config.projectMemory)
            config.projectMemory[params.sessionID] =
              config.projectMemory[params.sessionID]?.filter((fact) => fact.id !== params.id) ?? []
        }),
      )
      .handle("cache.get", ({ params }) =>
        Effect.gen(function* () {
          const error = yield* Effect.promise(async () => config.onCacheRead?.({ sessionID: params.sessionID }))

          if (error) return yield* error

          return (
            config.cacheDiagnostics?.[params.sessionID] ?? {
              sessionHitRate: 0,
              sessionCacheRead: 0,
              sessionCacheWrite: 0,
              sessionTotalInput: 0,
              confidence: "unavailable",
              perStep: [],
            }
          )
        }),
      )
      .handle("workflow.get", ({ params, query }) =>
        Effect.gen(function* () {
          const error = config.onWorkflowRead?.({ sessionID: params.sessionID, runID: query.runID })

          if (error) return yield* error

          const latest = config.workflows?.[params.sessionID]

          if (!query.runID) return latest ?? { steps: [] }

          const selected = [latest, ...(config.workflowHistory ?? [])].find(
            (value) => value?.run?.id === query.runID && value?.run?.sessionID === params.sessionID,
          )

          if (selected) return selected

          return yield* new ApiNotFoundError({ name: "NotFoundError", data: { message: "Workflow run not found" } })
        }),
      )
      .handle("workflow.run", ({ params, payload }) => workflowAction("run", params, payload))
      .handle("workflow.cancelRun", ({ params, payload }) => workflowAction("cancelRun", params, payload))
      .handle("workflow.cancelStep", ({ params, payload }) => workflowAction("cancelStep", params, payload))
      .handle("workflow.retryStep", ({ params, payload }) => workflowAction("retryStep", params, payload))
      .handle("artifact.apply", ({ params, query, payload }) =>
        Effect.gen(function* () {
          if (!config.onArtifactApply)
            return yield* new InvalidRequestError({ message: "Artifact action is not configured" })

          const body = Schema.decodeUnknownSync(
            Schema.Struct({
              title: Schema.String,
              relativePath: Schema.String,
              content: Schema.String,
              overwrite: Schema.Boolean,
            }),
          )(payload)

          const result = yield* Effect.promise(() =>
            Promise.resolve(config.onArtifactApply?.({ ...params, directory: query.directory, ...body })),
          )

          if (result instanceof ConflictError || result instanceof InvalidRequestError) return yield* result

          return result
        }),
      )
      .handle("delegation.result", ({ params, query }) =>
        Effect.gen(function* () {
          const result = yield* Effect.promise(() =>
            Promise.resolve(config.onDelegationResult?.({ ...params, ...query })),
          )

          if (result instanceof InvalidRequestError) return yield* result

          return result
        }),
      )
      .handle("delegation.list", ({ query }) =>
        Effect.gen(function* () {
          const error = yield* Effect.promise(() => Promise.resolve(config.onDelegationRead?.()))

          if (error instanceof InvalidRequestError) return yield* error

          if (query.parentSessionID && !taskSession(query.parentSessionID, query))
            return yield* new InvalidRequestError({ message: "Delegation does not belong to this Location" })

          return resolve(config.delegations ?? [])
            .filter((item) => !query.parentSessionID || item.delegation.parentSessionID === query.parentSessionID)
            .map((item) => Schema.decodeUnknownSync(LegacyDelegationState)(item))
        }),
      )
      .handle("delegation.interrupt", (input) => delegationAction("interrupt", input))
      .handle("delegation.close", (input) => delegationAction("close", input))
      .handle("delegation.reconcile", (input) => delegationAction("reconcile", input))
      .handle("delegation.retry", (input) => delegationAction("retry", input))
      .handleRaw("event", () => {
        const events = config.events?.()
        const retry = config.eventRetry === undefined ? "" : `retry: ${config.eventRetry}\n\n`

        const body = [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events ?? [])]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("")

        return Effect.succeed(HttpServerResponse.text(retry + body, { contentType: "text/event-stream" }))
      })
      .handleRaw("fsRead", (ctx) =>
        Effect.gen(function* () {
          const path = decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice(13))
          const answer = yield* Effect.promise(() => Promise.resolve(config.fileReadAnswer?.(path)))

          if (answer) return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
          const value = yield* Effect.promise(() => Promise.resolve(config.fileContent?.(path)))
          const content = Predicate.isString(value) ? value : (value?.content ?? "")

          return HttpServerResponse.uint8Array(new TextEncoder().encode(content))
        }),
      )
      // Raw, so a hook's answer can replace the status and body.
      .handleRaw("worktreeCreate", (ctx) =>
        Effect.gen(function* () {
          const create = config.onWorktreeCreate

          if (!create) return yield* unsupported("create worktrees", "onWorktreeCreate")

          const input = yield* Effect.orDie(
            ctx.request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json))),
          )

          const payload = Option.getOrUndefined(decodeWorktreeRequest(input))

          const answer = (yield* Effect.promise(async () => create(input))) || {
            status: 200,
            body: { directory: `${payload?.directory ?? config.directory}/${payload?.name ?? "copy"}` },
          }

          const created = answer.status === 200 ? decodeWorktreeAnswer(answer.body) : Option.none()

          if (Option.isSome(created)) addSandbox(config, created.value.directory)

          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleRaw("compositionPlan", (ctx) =>
        Effect.gen(function* () {
          const handler = config.onCompositionPlan

          if (!handler)
            return HttpServerResponse.jsonUnsafe(
              { name: "MockUnsupported", message: "No composition plan configured" },
              { status: 501 },
            )

          const body = yield* Effect.orDie(
            ctx.request.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(Composition.CompositionInput))),
            ),
          )

          const directory =
            new URL(ctx.request.url, "http://localhost").searchParams.get("directory") ?? config.directory

          const answer = yield* Effect.promise(() => Promise.resolve(handler({ directory, body })))

          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleRaw("compositionStart", (ctx) =>
        Effect.gen(function* () {
          const handler = config.onCompositionStart

          if (!handler)
            return HttpServerResponse.jsonUnsafe(
              { name: "MockUnsupported", message: "No composition start configured" },
              { status: 501 },
            )

          const body = yield* Effect.orDie(
            ctx.request.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(Composition.StartInput))),
            ),
          )

          const directory =
            new URL(ctx.request.url, "http://localhost").searchParams.get("directory") ?? config.directory

          const answer = yield* Effect.promise(() => Promise.resolve(handler({ directory, body })))

          if (answer.status === 200) {
            const started = Schema.decodeUnknownSync(Schema.toCodecJson(Composition.StartResponse))(answer.body)

            if (!config.sessions.some((session) => session.id === started.session.id))
              config.sessions.push(Schema.encodeSync(Composition.StartResponse)(started).session)

            config.compositions ??= {}
            config.compositions[started.session.id] = started.snapshot
          }

          return HttpServerResponse.jsonUnsafe(answer.body, {
            status: answer.status,
            headers: answer.disconnect ? { "x-aigcfroge-mock-disconnect": "true" } : undefined,
          })
        }),
      )
      .handleRaw("sessionCreate", (ctx) =>
        Effect.gen(function* () {
          const input = yield* Effect.orDie(ctx.request.json)
          const payload = Option.getOrElse(decodeJsonObject(input), (): Schema.JsonObject => ({}))
          const fields = Option.getOrUndefined(decodeSessionCreate(payload))
          state.sessionCreates += 1
          const answer = config.onSessionCreate?.(payload, state.sessionCreates)

          if (answer) return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })

          const id = fields?.id ?? "ses_mock_created"
          const existing = config.sessions.find((session) => session.id === id)

          if (existing) return HttpServerResponse.jsonUnsafe({ data: currentSession(existing, config.directory) })

          const parent = fields?.parentID
            ? config.sessions.find((session) => session.id === fields.parentID)
            : undefined

          if (
            parent &&
            Predicate.isObject(parent.controller) &&
            (parent.controller.kind === "child" || parent.agent === "meta")
          )
            return HttpServerResponse.jsonUnsafe(
              Schema.encodeSync(InvalidRequestError)(
                new InvalidRequestError({
                  field: "parentID",
                  kind: parent.controller.kind === "child" ? "meta_child_recursion" : "meta_child_source_required",
                  message: "Meta children require their saved source and binding",
                }),
              ),
              { status: 400 },
            )
          const agent = Predicate.isString(payload.agent) ? payload.agent : "build"
          const metaSelected = fields?.parentID === undefined && agent === "meta"
          const catalog = resolve(config.provider)
          const fallback = currentDefaultModel(catalog) ?? currentModels(catalog)[0]

          const modelInput =
            payload.model ??
            (metaSelected && fallback ? { id: fallback.id, providerID: fallback.providerID } : undefined)

          const model =
            modelInput === undefined
              ? undefined
              : Schema.decodeUnknownSync(Schema.toCodecJson(Model.Selection))(modelInput)

          const controller = metaSelected
            ? new Session.RootController({
                kind: "root",
                metaAgentID: MetaAgent.ID.descending(),
                rootSessionID: Session.ID.make(id),
              })
            : undefined

          const executorPreference =
            !metaSelected || payload.executorPreference === undefined
              ? undefined
              : Schema.decodeUnknownSync(Schema.toCodecJson(Session.ExecutorPreference))(payload.executorPreference)

          const created = currentSession(
            {
              ...payload,
              id,
              mode: payload.mode ?? parent?.mode ?? ProductMode.Default,
              agent,
              model,
              controller,
              executorPreference,
              projectID: projectSeed(config)?.id,
              title: config.createdSessionTitle ?? fields?.title ?? "New session",
              parentID: fields?.parentID,
            },
            config.directory,
          )

          config.sessions.push(created)

          return HttpServerResponse.jsonUnsafe({ data: created })
        }),
      )
      .handleRaw("sessionCreateConsultation", (ctx) =>
        Effect.gen(function* () {
          const create = config.onConsultation

          if (!create) return yield* unsupported("create consultations", "onConsultation")
          const payload = yield* Effect.orDie(ctx.request.json)
          const body = Schema.decodeUnknownSync(SessionConsultation.Input)(payload)
          state.consultationCreates += 1

          const answer = yield* Effect.promise(() =>
            Promise.resolve(create({ sourceSessionID: ctx.params.sourceSessionID, body }, state.consultationCreates)),
          )

          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleRaw("sessionConsultation", (ctx) =>
        Effect.gen(function* () {
          const read = config.onConsultationRead

          if (!read) return yield* unsupported("read consultation references", "onConsultationRead")
          const answer = yield* Effect.promise(() => Promise.resolve(read(ctx.params.sessionID)))

          return HttpServerResponse.jsonUnsafe(answer.body, { status: answer.status })
        }),
      )
      .handleAll({
        info: () =>
          Effect.succeed({
            version: "2.0.0",
            pid: 1,
            urls: config.server ? [config.server] : [],
            paths: { tmp: "/tmp/aigcfroge" },
          }),
        config: () => Effect.succeed(configEntries),
        reference: () => Effect.succeed({ location: location(config), data: [] }),
        agent: (ctx) =>
          Effect.succeed({
            location: location(config, requestDirectory(config, ctx.request)),
            data: resolve(
              config.agents ?? [
                {
                  id: "build",
                  name: "Build",
                  mode: "all",
                  hidden: false,
                  request: { settings: {}, headers: {}, body: {} },
                  permissions: [],
                  handoffs: [],
                  ordinaryModes: [...ProductMode.ID.literals],
                },
                {
                  id: "meta",
                  name: "Meta",
                  mode: "primary",
                  hidden: false,
                  request: { settings: {}, headers: {}, body: {} },
                  permissions: [],
                  handoffs: [],
                  ordinaryModes: [...ProductMode.ID.literals],
                },
                {
                  id: "plan",
                  name: "Plan",
                  mode: "primary",
                  hidden: false,
                  request: { settings: {}, headers: {}, body: {} },
                  permissions: [],
                  handoffs: [],
                  ordinaryModes: [...ProductMode.ID.literals],
                },
                {
                  id: "explore",
                  name: "Explore",
                  mode: "subagent",
                  hidden: false,
                  request: { settings: {}, headers: {}, body: {} },
                  permissions: [],
                  handoffs: [],
                  ordinaryModes: [...ProductMode.ID.literals],
                },
              ],
            ),
          }),
        provider: () =>
          Effect.succeed({ location: location(config), data: currentProviders(resolve(config.provider)) }),
        providerDefinition: () =>
          Effect.succeed({
            location: location(config),
            data: config.providerDefinitions ? resolve(config.providerDefinitions) : { targets: [], definitions: [] },
          }),
        providerDiscovery: (ctx) =>
          Effect.succeed({
            location: location(config),
            data: config.providerDiscovery?.(ctx.query) ?? {
              status: { providerID: ctx.query.providerID, phase: "idle", cachePersisted: false, generation: 0 },
              candidates: [],
              managed: [],
            },
          }),
        providerDiscoveryPreview: (ctx) => {
          const preview = config.onProviderDiscoveryPreview

          if (!preview) return unsupported("preview provider model lists", "onProviderDiscoveryPreview")

          return Effect.promise(() => Promise.resolve(preview(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        providerDiscoveryRefresh: (ctx) => {
          const refresh = config.onProviderDiscoveryRefresh

          if (!refresh) return unsupported("refresh provider model lists", "onProviderDiscoveryRefresh")

          return Effect.promise(() => Promise.resolve(refresh(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        providerDefinitionSave: (ctx) => {
          const save = config.onProviderDefinitionSave

          if (!save) return unsupported("save provider definitions", "onProviderDefinitionSave")

          return Effect.promise(() => Promise.resolve(save(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        providerDefinitionRemove: (ctx) => {
          const remove = config.onProviderDefinitionRemove

          if (!remove) return unsupported("remove provider definitions", "onProviderDefinitionRemove")

          return Effect.promise(() => Promise.resolve(remove(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        model: () => Effect.succeed({ location: location(config), data: currentModels(resolve(config.provider)) }),
        modelGroupDefinition: () =>
          Effect.succeed({
            location: location(config),
            data: config.modelGroups ? resolve(config.modelGroups) : { targets: [], definitions: [], effective: [] },
          }),
        modelGroupDefinitionSave: (ctx) => {
          const save = config.onModelGroupSave

          if (!save) return unsupported("save model groups", "onModelGroupSave")

          return Effect.promise(() => Promise.resolve(save(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        modelGroupDefinitionRemove: (ctx) => {
          const remove = config.onModelGroupRemove

          if (!remove) return unsupported("remove model groups", "onModelGroupRemove")

          return Effect.promise(() => Promise.resolve(remove(ctx.payload))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          )
        },
        modelDefault: () =>
          Effect.succeed({ location: location(config), data: currentDefaultModel(resolve(config.provider)) }),
        integrationList: () => Effect.succeed({ location: location(config), data: config.integrations ?? [] }),
        integrationGet: (ctx) =>
          Effect.succeed({
            location: location(config),
            data: config.integrations
              ?.filter(Predicate.isObject)
              .find((integration) => integration.id === ctx.params.integrationID) ?? {
              id: ctx.params.integrationID,
              name: ctx.params.integrationID,
              methods: [{ type: "key", label: "API key" }],
              connections: [],
            },
          }),
        integrationConnect: (ctx) =>
          Effect.sync(() => config.onConnectKey?.({ integrationID: ctx.params.integrationID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          ),
        integrationOAuthConnect: (ctx) => {
          const start = config.onIntegrationOAuth

          if (!start) return unsupported("start OAuth connections", "onIntegrationOAuth")

          return Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)
            const created = Date.now()
            const attemptID = `con_mock_${state.attempts.size + 1}`
            state.attempts.set(attemptID, created)
            const started = start({ integrationID: ctx.params.integrationID, directory, body: ctx.payload })

            return {
              location: location(config, directory),
              data: {
                attemptID,
                url: started.url,
                instructions: "",
                mode: "auto",
                time: { created, expires: created + 600_000 },
              },
            }
          })
        },
        integrationOAuthStatus: (ctx) =>
          Effect.suspend(() => {
            const created = state.attempts.get(ctx.params.attemptID)

            if (created === undefined) return Effect.fail(new MockNotFound({ message: "OAuth attempt not found" }))

            return Effect.succeed({
              location: location(config, requestDirectory(config, ctx.request)),
              data: { status: "pending", time: { created, expires: created + 600_000 } },
            })
          }),
        credentialRemove: () => noContent,
        command: (ctx) =>
          Effect.sync(() => ({
            location: location(config, requestDirectory(config, ctx.request)),
            data: resolve(config.commands ?? []),
          })),
        skill: () => Effect.sync(() => ({ location: location(config), data: resolve(config.skills ?? []) })),
        plugin: () => Effect.sync(() => ({ location: location(config), data: resolve(config.plugins ?? []) })),
        mcp: (ctx) =>
          Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)

            return { location: location(config, directory), data: mcpServers(directory) }
          }),
        mcpConnect: (ctx) => mcpAction(ctx.params.server, "connect", ctx.request),
        mcpDisconnect: (ctx) => mcpAction(ctx.params.server, "disconnect", ctx.request),
        mcpResource: (ctx) =>
          Effect.succeed({
            location: location(config, requestDirectory(config, ctx.request)),
            data: { resources: [], templates: [] },
          }),
        projectList: () =>
          Effect.sync(() => {
            if (config.projects) return resolve(config.projects)
            const seed = projectSeed(config)

            return [{ ...projectFields(config), canonical: seed?.canonical ?? seed?.worktree ?? config.directory }]
          }),
        projectUpdate: (ctx) =>
          Effect.succeed({
            ...projectFields(config),
            ...ctx.payload,
            id: ctx.params.projectID,
            canonical: projectSeed(config)?.canonical ?? config.directory,
          }),
        configShells: () => Effect.succeed(config.shells ?? []),
        configUpdate: () => noContent,
        websearchProviders: () => Effect.succeed({ location: location(config), data: [] }),
        worktreeList: () =>
          Effect.sync(() => {
            if (config.worktrees) return resolve(config.worktrees)

            return [
              { directory: config.directory },
              ...(projectSeed(config)?.sandboxes ?? []).map((directory) => ({
                directory,
                strategy: "git",
              })),
            ]
          }),
        worktreeRemove: (ctx) => {
          const remove = config.onWorktreeRemove

          if (!remove) return unsupported("remove worktrees", "onWorktreeRemove")

          return Effect.promise(async () => remove(ctx.payload)).pipe(Effect.andThen(noContent))
        },
        // Discovery against a static inventory changes nothing, and the app refreshes whenever worktree settings open.
        worktreeRefresh: () => noContent,
        location: (ctx) => Effect.sync(() => location(config, requestDirectory(config, ctx.request))),
        permissionRequests: () =>
          Effect.suspend(() =>
            config.permissionListFailures?.()
              ? Effect.fail(new MockInternal({ message: "Permission list failed" }))
              : Effect.succeed({
                  location: location(config),
                  data: currentPermissions(resolve(config.permissions ?? [])),
                }),
          ),
        formRequests: () => Effect.succeed({ location: location(config), data: resolve(config.forms ?? []) }),
        vcs: () =>
          Effect.succeed({
            location: location(config),
            data: { branch: config.vcs ?? { current: "main", default: "main" } },
          }),
        vcsInit: (ctx) => {
          if (!config.onVcsInit) return unsupported("initialize VCS", "onVcsInit")

          return Effect.sync(() => {
            const url = new URL(ctx.request.url, "http://localhost")
            const provider = url.searchParams.get("provider") ?? undefined
            config.onVcsInit?.({ directory: requestDirectory(config, ctx.request), provider })
            // SAFETY: a scenario that initializes VCS seeds its project as an object with an ID.
            const project = config.project as { id: string; vcs?: string }
            project.vcs = provider ?? "git"
            state.emit([
              {
                id: "evt_vcs_initialized",
                type: "worktree.updated",
                created: Date.now(),
                data: { projectID: project.id },
              },
            ])
          }).pipe(Effect.andThen(noContent))
        },
        vcsStatus: () => Effect.succeed({ location: location(config), data: [] }),
        vcsBranches: () => Effect.succeed({ location: location(config), data: ["main"] }),
        vcsDiff: (ctx) =>
          Effect.sync(() => ({
            location: location(config),
            data: Predicate.isFunction(config.vcsDiff)
              ? config.vcsDiff({ mode: ctx.query.mode })
              : (config.vcsDiff ?? []),
          })),
        fsList: (ctx) =>
          Effect.promise(() => Promise.resolve(config.fileList?.(ctx.query.path ?? "") ?? [])).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          ),
        fsFind: (ctx) =>
          Effect.promise(() =>
            Promise.resolve(
              config.findFiles?.({ query: ctx.query.query ?? "", dirs: ctx.query.type, limit: ctx.query.limit }) ?? [],
            ),
          ).pipe(
            Effect.map((entries) => ({
              location: location(config),
              data: Array.isArray(entries)
                ? entries.map((entry) =>
                    Predicate.isString(entry)
                      ? {
                          name: entry.split(/[\\/]/).at(-1) ?? entry,
                          path: entry,
                          absolute: `${config.directory}/${entry}`,
                          type: "directory",
                          ignored: false,
                        }
                      : entry,
                  )
                : entries,
            })),
          ),
        fsWrite: (ctx) => {
          const write = config.onFileWrite

          if (!write) return unsupported("write files", "onFileWrite")

          return Effect.sync(() => {
            const directory = requestDirectory(config, ctx.request)
            const path = new URL(ctx.request.url, "http://localhost").searchParams.get("path") ?? ""
            write({ path, directory, body: new TextDecoder().decode(ctx.payload) })

            return { location: location(config, directory), data: { path } }
          })
        },
        shell: (ctx) =>
          Effect.sync(() => ({
            location: location(config, requestDirectory(config, ctx.request)),
            data: resolve(config.shellCommands ?? []),
          })),
        shellOutput: (ctx) =>
          Effect.suspend(() => {
            const directory = requestDirectory(config, ctx.request)
            const output = config.shellOutput?.({ id: ctx.params.id, directory })

            if (output === undefined)
              return Effect.fail(
                new MockShellNotFound({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
              )
            const bytes = new TextEncoder().encode(output)
            const query = new URL(ctx.request.url, "http://localhost").searchParams
            const cursor = Math.min(Number(query.get("cursor") ?? 0), bytes.length)
            // The server answers at most one page (`Shell.output` defaults `limit` to 65,536 bytes).
            const end = Math.min(bytes.length, cursor + Number(query.get("limit") ?? 65_536))

            return Effect.succeed({
              location: location(config, directory),
              data: {
                output: new TextDecoder().decode(bytes.subarray(cursor, end)),
                cursor: end,
                size: bytes.length,
                truncated: false,
              },
            })
          }),
        // Like the server, which also answers 204 for a shell that already ended.
        shellRemove: () => noContent,
        ptyList: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const directory = requestDirectory(config, ctx.request)

              return { location: location(config, directory), data: state.pty.owned(directory) }
            }),
          ),
        ptyCreate: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const next = state.pty.allocate()
              const directory = requestDirectory(config, ctx.request)

              const created = state.pty.info(
                next.id,
                ctx.payload.title ?? `Terminal ${next.number}`,
                ctx.payload.cwd ?? directory,
              )

              state.pty.add(created, directory)

              return { location: location(config, directory), data: created }
            }),
          ),
        ptyGet: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((data) => ({ location: location(config, requestDirectory(config, ctx.request)), data })),
          ),
        ptyUpdate: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.updates.push({ id: found.id, body: ctx.payload })

              if (ctx.payload.title) found.title = ctx.payload.title

              return { location: location(config, requestDirectory(config, ctx.request)), data: found }
            }),
          ),
        ptyRemove: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.removed.push(found.id)
              state.pty.list.splice(state.pty.list.indexOf(found), 1)

              return HttpApiSchema.NoContent.make()
            }),
          ),
        ptyConnectToken: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              const directory = requestDirectory(config, ctx.request)
              const ticket = state.pty.issue(found.id, directory)
              state.pty.tokens.push({
                id: found.id,
                headers: Object.fromEntries(Object.entries(ctx.request.headers)),
                ticket,
              })

              return { location: location(config, directory), data: { ticket, expires_in: 60 } }
            }),
          ),
        sessionList: (ctx) => {
          const sessions = config.sessions
            .filter(
              (session) =>
                !ctx.query.directory ||
                (Predicate.isObject(session.location) && session.location.directory === ctx.query.directory) ||
                session.directory === ctx.query.directory,
            )
            .filter((session) => {
              if (ctx.query.parentID === undefined) return true

              if (ctx.query.parentID === "null") return session.parentID === undefined

              return session.parentID === ctx.query.parentID
            })
            .filter((session) =>
              ctx.query.search === undefined
                ? true
                : String(session.title ?? "")
                    .toLowerCase()
                    .includes(ctx.query.search.toLowerCase()),
            )

          const ordered = ctx.query.order === "asc" ? sessions : sessions.toReversed()
          const offset = Number(ctx.query.cursor ?? 0)
          const limit = ctx.query.limit ?? 50
          const data = ordered.slice(offset, offset + limit)

          return Effect.succeed({
            data: data.map((session) => currentSession(session, config.directory)),
            cursor: { next: offset + limit < ordered.length ? String(offset + limit) : undefined },
          })
        },
        sessionActive: () =>
          Effect.succeed({
            data: Object.fromEntries(
              Object.entries(resolve(config.sessionStatus ?? {})).flatMap(([id, status]) =>
                status.type === "idle" ? [] : [[id, { type: "running" }]],
              ),
            ),
          }),
        sessionGet: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(async () => config.onSession?.(ctx.params.sessionID))
            const error = config.sessionReadError?.(ctx.params.sessionID)

            if (error) return yield* error

            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)

            if (!session) return yield* new MockNotFound({ message: "Session not found" })

            return { data: currentSession(session, config.directory) }
          }),
        sessionRemove: () => noContent,
        sessionShell: () => noContent,
        sessionForm: (ctx) =>
          Effect.succeed({
            data: resolve(config.forms ?? []).filter(
              (form) => Predicate.isObject(form) && form.sessionID === ctx.params.sessionID,
            ),
          }),
        sessionFormReply: () => noContent,
        sessionFormCancel: () => noContent,
        sessionBackground: () => noContent,
        sessionInbox: (ctx) =>
          Effect.sync(() => ({
            data: resolve(config.inbox ?? []).filter(
              (item) => Predicate.isObject(item) && item.sessionID === ctx.params.sessionID,
            ),
          })),
        sessionIdentity: (ctx) =>
          Effect.gen(function* () {
            if (!taskSession(ctx.params.sessionID, ctx.query))
              return yield* new ApiNotFoundError({ name: "NotFoundError", data: { message: "Session not found" } })
            yield* Effect.promise(() => Promise.resolve(config.onIdentityRead?.(ctx.params.sessionID)))
            const selected = config.identities?.[ctx.params.sessionID]

            if (selected) return selected
            const source = config.sessions.find((session) => session.id === ctx.params.sessionID)

            if (!source)
              return yield* new ApiNotFoundError({ name: "NotFoundError", data: { message: "Session not found" } })
            const session = currentSession(source, config.directory)

            return {
              sessionID: session.id,
              location: session.location,
              projectID: session.projectID,
              mode: session.mode ?? "coding",
              agent: session.agent ?? "build",
              model: { status: "missing" },
              permission: { declaredTier: "propose", effect: "ask" },
              capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
              detail: { status: "missing", reason: "mode-detail-not-projected" },
            }
          }),
        taskOperations: (ctx) => operationRead(ctx.params, ctx.query),
        taskOperation: (ctx) =>
          Effect.gen(function* () {
            const operations = yield* operationRead(ctx.params, ctx.query)

            if (!operations[0])
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: "Task operation not found" },
              })

            return operations[0]
          }),
        taskDispatch: (ctx) =>
          Effect.gen(function* () {
            if (!config.onTaskDispatch)
              return yield* new InvalidRequestError({ message: "Task dispatch is not configured" })
            const result = yield* Effect.promise(() =>
              Promise.resolve(config.onTaskDispatch?.({ sessionID: ctx.params.sessionID, request: ctx.payload })),
            )

            if (result instanceof InvalidRequestError || result instanceof ConflictError) return yield* result

            if (!result) return yield* new InvalidRequestError({ message: "Task dispatch returned no acknowledgement" })

            return result
          }),
        taskCancelOperation: (ctx) =>
          Effect.gen(function* () {
            if (!config.onTaskCancelOperation)
              return yield* new InvalidRequestError({ message: "Task cancellation is not configured" })
            const result = yield* Effect.promise(() => Promise.resolve(config.onTaskCancelOperation?.(ctx.params)))

            if (result instanceof InvalidRequestError) return yield* result

            if (!result)
              return yield* new InvalidRequestError({ message: "Task cancellation returned no acknowledgement" })

            return result
          }),
        communicationList: (ctx) =>
          Effect.gen(function* () {
            const items = yield* communicationRead(ctx.params, ctx.query)

            return {
              data: {
                items,
                capability: config.communicationCapabilities?.[ctx.params.sessionID] ?? {
                  read: true,
                  list: true,
                  send: false,
                  reply: false,
                  reasons: ["fixture-read-only"],
                },
              },
            }
          }),
        communicationRead: (ctx) =>
          Effect.gen(function* () {
            const items = yield* communicationRead(ctx.params, ctx.query)

            return { data: items[0] ?? null }
          }),
        communicationSend: (ctx) =>
          communicationMutation({ action: "send", ...ctx.params, ...ctx.query, body: ctx.payload }),
        communicationReply: (ctx) =>
          communicationMutation({ action: "reply", ...ctx.params, ...ctx.query, body: ctx.payload }),
        goalList: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Promise.resolve(config.onGoalRead?.(ctx.params)))

            return { data: (config.goals ?? []).filter((goal) => goal.sessionID === ctx.params.sessionID) }
          }),
        goalGet: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Promise.resolve(config.onGoalRead?.(ctx.params)))

            return {
              data:
                config.goals?.find(
                  (goal) => goal.sessionID === ctx.params.sessionID && goal.id === ctx.params.goalID,
                ) ?? null,
            }
          }),
        goalSet: (ctx) => goalMutation({ ...ctx.params, action: "set", body: ctx.payload }),
        goalEdit: (ctx) => goalMutation({ ...ctx.params, action: "edit", body: ctx.payload }),
        goalPause: (ctx) => goalMutation({ ...ctx.params, action: "pause", body: ctx.payload }),
        goalResume: (ctx) => goalMutation({ ...ctx.params, action: "resume", body: ctx.payload }),
        goalCancel: (ctx) => goalMutation({ ...ctx.params, action: "cancel", body: ctx.payload }),
        goalConfirm: (ctx) => goalMutation({ ...ctx.params, action: "confirm", body: ctx.payload }),
        scheduleRules: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Promise.resolve(config.onScheduleRead?.({ ...ctx.params, ...ctx.query })))

            return (config.schedules ?? []).filter((rule) => rule.sessionID === ctx.params.sessionID)
          }),
        scheduleRule: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Promise.resolve(config.onScheduleRead?.({ ...ctx.params, ...ctx.query })))
            const rule = config.schedules?.find((rule) => rule.id === ctx.params.id)

            if (!rule) return yield* new InvalidRequestError({ message: "Schedule rule not found" })

            return rule
          }),
        scheduleRuns: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Promise.resolve(config.onScheduleRead?.({ ...ctx.params, ...ctx.query })))

            return (config.scheduleRuns ?? []).filter((run) => run.scheduleID === ctx.params.id)
          }),
        scheduleCreate: (ctx) => scheduleMutation({ action: "create", body: ctx.payload, ...ctx.query }),
        scheduleEdit: (ctx) => scheduleMutation({ action: "edit", ...ctx.params, body: ctx.payload, ...ctx.query }),
        schedulePause: (ctx) => scheduleMutation({ action: "pause", ...ctx.params, body: ctx.payload, ...ctx.query }),
        scheduleResume: (ctx) => scheduleMutation({ action: "resume", ...ctx.params, body: ctx.payload, ...ctx.query }),
        scheduleCancel: (ctx) => scheduleMutation({ action: "cancel", ...ctx.params, body: ctx.payload, ...ctx.query }),
        scheduleRun: (ctx) => scheduleMutation({ action: "run", ...ctx.params, body: ctx.payload, ...ctx.query }),
        scheduleCancelRun: (ctx) => scheduleMutation({ action: "cancelRun", ...ctx.params, ...ctx.query }),
        sessionTaskGet: (ctx) =>
          Effect.gen(function* () {
            if (!taskSession(ctx.params.sessionID, ctx.query))
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Session not found: ${ctx.params.sessionID}` },
              })

            const failure = yield* Effect.promise(async () =>
              config.onTaskRead?.({
                sessionID: ctx.params.sessionID,
                directory: ctx.query.directory ?? config.directory,
              }),
            )

            if (failure) return yield* failure

            return state.tasks.filter((task) => task.sessionID === ctx.params.sessionID)
          }),
        sessionTaskCreate: (ctx) =>
          Effect.gen(function* () {
            if (!taskSession(ctx.params.sessionID, ctx.query))
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Session not found: ${ctx.params.sessionID}` },
              })
            const directory = ctx.query.directory ?? config.directory
            yield* taskMutation({ action: "create", sessionID: ctx.params.sessionID, directory, body: ctx.payload })

            const id =
              ctx.payload.id ??
              Array.from({ length: state.tasks.length + 1 }, (_, index) => `tsk_mock_${index + 1}`).find(
                (id) => !state.tasks.some((task) => task.id === id),
              )

            if (!id) return yield* Effect.die(new Error("Mock Task identity was not allocated"))

            if (state.tasks.some((task) => task.id === id))
              return yield* new InvalidRequestError({ message: `Task id already exists: ${id}`, kind: "duplicate" })
            const now = (yield* DateTime.nowAsDate).getTime()

            const task = new SessionTask.Info({
              id,
              sessionID: ctx.params.sessionID,
              content: ctx.payload.content,
              status: ctx.payload.status,
              priority: ctx.payload.priority,
              parentID: ctx.payload.parentID,
              agentID: ctx.payload.agentID,
              scheduledAt: ctx.payload.scheduledAt,
              recurrence: ctx.payload.recurrence,
              spawnedFrom: ctx.payload.spawnedFrom,
              dependsOn: ctx.payload.dependsOn,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            })

            state.tasks.push(task)
            publishTasks(ctx.params.sessionID, directory, now)

            return task
          }),
        sessionTaskPatch: (ctx) =>
          Effect.gen(function* () {
            if (!taskSession(ctx.params.sessionID, ctx.query))
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Session not found: ${ctx.params.sessionID}` },
              })
            const directory = ctx.query.directory ?? config.directory
            yield* taskMutation({
              action: "patch",
              sessionID: ctx.params.sessionID,
              taskID: ctx.params.taskID,
              directory,
              body: ctx.payload,
            })

            const index = state.tasks.findIndex(
              (task) => task.sessionID === ctx.params.sessionID && task.id === ctx.params.taskID,
            )

            const prior = state.tasks[index]

            if (!prior)
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Task not found: ${ctx.params.taskID}` },
              })

            if (
              ctx.payload.content === undefined &&
              ctx.payload.status === undefined &&
              ctx.payload.priority === undefined
            )
              return yield* new InvalidRequestError({ message: "At least one task field is required" })

            if (ctx.payload.expectedRevision !== undefined && ctx.payload.expectedRevision !== prior.revision)
              return yield* new InvalidRequestError({
                message: "Task changed since the caller last read it",
                kind: "stale_revision",
              })
            const now = (yield* DateTime.nowAsDate).getTime()

            const task = new SessionTask.Info({
              // oxlint-disable-next-line no-misused-spread -- Task rows carry only schema fields across this fixture write.
              ...prior,
              content: ctx.payload.content ?? prior.content,
              status: ctx.payload.status ?? prior.status,
              priority: ctx.payload.priority ?? prior.priority,
              revision: prior.revision + 1,
              updatedAt: now,
            })

            state.tasks[index] = task
            publishTasks(ctx.params.sessionID, directory, now)

            return task
          }),
        sessionTaskDelete: (ctx) =>
          Effect.gen(function* () {
            if (!taskSession(ctx.params.sessionID, ctx.query))
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Session not found: ${ctx.params.sessionID}` },
              })
            const directory = ctx.query.directory ?? config.directory
            yield* taskMutation({
              action: "delete",
              sessionID: ctx.params.sessionID,
              taskID: ctx.params.taskID,
              directory,
            })

            const index = state.tasks.findIndex(
              (task) => task.sessionID === ctx.params.sessionID && task.id === ctx.params.taskID,
            )

            const task = state.tasks[index]

            if (!task)
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Task not found: ${ctx.params.taskID}` },
              })
            state.tasks.splice(index, 1)
            publishTasks(ctx.params.sessionID, directory, (yield* DateTime.nowAsDate).getTime())

            return task
          }),
        sessionPrompt: (ctx) =>
          Effect.sync(() => {
            const body = Option.getOrElse(decodeJsonObject(ctx.payload), () => ({}))
            config.onPrompt?.({ sessionID: ctx.params.sessionID, body })
            const prompt = Option.getOrUndefined(decodePromptRequest(body))

            return {
              data: {
                id: prompt?.id ?? `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "user",
                // Keys the request omits stay omitted.
                payload: { text: "", ...Option.getOrUndefined(decodePromptPayload(body)) },
                delivery: prompt?.delivery ?? "steer",
              },
            }
          }),
        // Like the server, a compaction is admitted as a steered inbox item under the proposed ID.
        sessionCompact: (ctx) =>
          Effect.sync(() => {
            const body = Option.getOrElse(decodeJsonObject(ctx.payload), (): Schema.JsonObject => ({}))
            config.onCompact?.({ sessionID: ctx.params.sessionID, body })

            return {
              data: {
                id: Predicate.isString(body.id) ? body.id : `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "compaction",
                payload: {},
                delivery: "steer",
              },
            }
          }),
        sessionGenerate: (ctx) =>
          Effect.promise(async () => ({
            data: (await config.generate?.({ sessionID: ctx.params.sessionID, prompt: ctx.payload.prompt })) ?? {
              text: "Side-question answer",
            },
          })),
        sessionInboxCancel: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({ sessionID: ctx.params.sessionID, inboxID: ctx.params.inboxID, action: "cancel" }),
          ).pipe(Effect.andThen(noContent)),
        sessionInboxUpdate: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({
              sessionID: ctx.params.sessionID,
              inboxID: ctx.params.inboxID,
              action: ctx.payload.delivery,
            }),
          ).pipe(Effect.andThen(noContent)),
        sessionSwitchAgent: (ctx) =>
          Effect.gen(function* () {
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)
            const controller = session?.controller

            if (
              Predicate.isObject(controller) &&
              controller.kind === "child" &&
              (ctx.payload.agent !== session?.agent ||
                (ctx.payload.model &&
                  (!session ||
                    !Schema.toEquivalence(Model.Selection)(
                      currentSession(session, config.directory).model,
                      ctx.payload.model,
                    ))))
            )
              return yield* new InvalidRequestError({
                field: "agent",
                kind: "meta_binding_conflict",
                message: "Delegated Agent is fixed",
              })

            if (!session) return HttpApiSchema.NoContent.make()

            if (Predicate.isObject(controller) && controller.kind === "child") return HttpApiSchema.NoContent.make()

            if (ctx.payload.agent === "meta" && !controller)
              session.controller = new Session.RootController({
                kind: "root",
                rootSessionID: Session.ID.make(session.id),
                metaAgentID: MetaAgent.ID.descending(),
              })
            session.agent = ctx.payload.agent

            if (ctx.payload.model) session.model = ctx.payload.model

            return HttpApiSchema.NoContent.make()
          }),
        sessionSwitchModel: (ctx) =>
          Effect.gen(function* () {
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)
            const controller = session?.controller
            const model = session ? currentSession(session, config.directory).model : undefined

            if (
              Predicate.isObject(controller) &&
              controller.kind === "child" &&
              (!model || !Schema.toEquivalence(Model.Selection)(model, ctx.payload.model))
            )
              return yield* new InvalidRequestError({
                field: "model",
                kind: "meta_binding_conflict",
                message: "Delegated model is fixed",
              })

            if (session) session.model = ctx.payload.model

            return HttpApiSchema.NoContent.make()
          }),
        sessionSelectExecutor: (ctx) =>
          Effect.gen(function* () {
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)

            if (!session) return yield* new MockNotFound({ message: "Session not found" })

            if (
              !Predicate.isObject(session.controller) ||
              session.controller.kind !== "root" ||
              session.agent !== "meta"
            )
              return yield* new InvalidRequestError({
                field: "executorPreference",
                kind: "executor_selection_unsupported",
                message: "Delegation preferences require a selected Meta root",
              })
            session.executorPreference = ctx.payload

            return { data: currentSession(session, config.directory) }
          }),
        sessionFork: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(async () =>
              config.onSessionFork?.({ sessionID: ctx.params.sessionID, ...ctx.payload }),
            )
            const source = config.sessions.find((item) => item.id === ctx.params.sessionID)

            if (!source) return yield* new MockNotFound({ message: "Session not found" })
            const current = currentSession(source, config.directory)
            const digest = current.mode === "custom" ? config.compositions?.[current.id]?.digest : undefined

            const expectedSource = {
              sourceSessionID: current.id,
              mode: current.mode,
            }

            if (current.agent !== undefined) Object.assign(expectedSource, { agent: current.agent })

            if (current.controller !== undefined) Object.assign(expectedSource, { controller: current.controller })

            if (current.model !== undefined) Object.assign(expectedSource, { model: current.model })

            if (digest !== undefined) Object.assign(expectedSource, { compositionDigest: digest })

            const expected = Schema.decodeUnknownSync(Session.ForkExpectedSource)(expectedSource)

            if (
              ctx.payload.expectedSource &&
              !Schema.toEquivalence(Session.ForkExpectedSource)(ctx.payload.expectedSource, expected)
            )
              return yield* new InvalidRequestError({
                field: "expectedSource",
                kind: "fork_source_conflict",
                message: "Fork source changed; preview again",
              })

            const metaControlled =
              (Predicate.isObject(source.controller) && source.controller.kind === "root" && source.agent === "meta") ||
              ctx.payload.control === "meta"

            if (Predicate.isObject(source.controller) && source.controller.kind === "child")
              return yield* new InvalidRequestError({
                field: "sessionID",
                kind: "meta_child_recursion",
                message: "Meta children cannot fork new work",
              })

            if (ctx.payload.control === "meta" && !source.controller && !ctx.payload.expectedSource)
              return yield* new InvalidRequestError({
                field: "expectedSource",
                kind: "fork_source_conflict",
                message: "Preview the source before adopting Meta orchestration",
              })
            const id = Session.ID.create()

            const messageID =
              ctx.payload.before ??
              ctx.payload.through ??
              config.pageMessages(source.id, Number.MAX_SAFE_INTEGER).items.at(-1)?.id

            const forked = currentSession(
              {
                ...source,
                id,
                parentID: undefined,
                fork: messageID
                  ? {
                      sessionID: source.id,
                      boundary: { type: ctx.payload.before ? "before" : "through", messageID },
                    }
                  : undefined,
                agent: metaControlled ? "meta" : source.agent,
                model: ctx.payload.model ?? source.model,
                executorPreference: metaControlled
                  ? (ctx.payload.executorPreference ?? source.executorPreference)
                  : undefined,
                controller: metaControlled
                  ? new Session.RootController({
                      kind: "root",
                      rootSessionID: id,
                      metaAgentID:
                        Predicate.isObject(source.controller) && Predicate.isString(source.controller.metaAgentID)
                          ? MetaAgent.ID.make(source.controller.metaAgentID)
                          : MetaAgent.ID.descending(),
                    })
                  : undefined,
              },
              config.directory,
            )

            config.sessions.push(forked)

            if (config.compositions?.[source.id]) config.compositions[id] = config.compositions[source.id]!

            return { data: forked }
          }),
        sessionComposition: (ctx) =>
          Effect.gen(function* () {
            const snapshot = config.compositions?.[ctx.params.sessionID]

            if (!snapshot)
              return yield* new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: "Session composition not found" },
              })

            return snapshot
          }),
        // Only the session's own list; location requests (`permissions`) come from `/api/permission/request`.
        sessionPermission: (ctx) =>
          Effect.sync(() => ({
            data: currentPermissions(config.sessionPermissions?.[ctx.params.sessionID] ?? []).filter(
              (permission) => permission.sessionID === ctx.params.sessionID,
            ),
          })),
        // Like the server, a reply publishes `permission.replied`, and later reads no longer list the request.
        sessionPermissionReply: (ctx) => {
          const reply = config.onPermissionReply

          if (!reply) return unsupported("record permission replies", "onPermissionReply")

          return Effect.sync(() => {
            const sessionID = ctx.params.sessionID
            const permissionID = ctx.params.permissionID
            reply({ sessionID, permissionID, body: ctx.payload })

            const pending = [config.sessionPermissions?.[sessionID] ?? [], resolve(config.permissions ?? [])]

            pending.forEach((list) => {
              const index = list.findIndex((item) => Predicate.isObject(item) && item.id === permissionID)

              if (index >= 0) list.splice(index, 1)
            })
            state.emit([
              {
                id: `evt_permission_replied_${permissionID}`,
                created: Date.now(),
                type: "permission.replied",
                location: { directory: requestDirectory(config, ctx.request) },
                data: {
                  sessionID,
                  requestID: permissionID,
                  reply: Option.getOrUndefined(decodePermissionReply(ctx.payload))?.decision ?? "once",
                },
              },
            ])
          }).pipe(Effect.andThen(noContent))
        },
        sessionRename: (ctx) =>
          Effect.sync(() => {
            const title = Option.getOrUndefined(decodeSessionRename(ctx.payload))?.title
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)

            if (session && title !== undefined) session.title = title
          }).pipe(Effect.andThen(noContent)),
        sessionCommand: (ctx) => {
          const recordCommand = config.onCommand

          if (!recordCommand) return unsupported("run session commands", "onCommand")

          return Effect.sync(() => recordCommand({ sessionID: ctx.params.sessionID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          )
        },
        // Like the server for an idle session: nothing was running to interrupt.
        sessionInterrupt: (ctx) =>
          Effect.promise(async () => config.onInterrupt?.(ctx.params.sessionID) ?? { interrupted: false }),
        // The mock runs no agent loop, so every session is already idle.
        sessionWait: () => noContent,
        sessionRevertStage: (ctx) => {
          const request = decodeRevertStage(ctx.payload)

          if (Option.isNone(request)) return Effect.fail(new MockBadRequest({ message: "Invalid revert request" }))
          const messageID = request.value.messageID

          return Effect.sync(() => config.onRevertStage?.({ sessionID: ctx.params.sessionID, messageID })).pipe(
            Effect.as({ data: { messageID } }),
          )
        },
        sessionRevertClear: () => noContent,
        sessionRevertCommit: () => noContent,
        messageGet: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.promise(async () =>
              config.onMessage?.({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
            )
            yield* delay

            const message =
              config.message?.(ctx.params.sessionID, ctx.params.messageID) ??
              config
                .pageMessages(ctx.params.sessionID, Number.MAX_SAFE_INTEGER)
                .items.find((item) => item.id === ctx.params.messageID)

            if (!message) return yield* new MockNotFound({ message: "Message not found" })

            return { data: message }
          }),
        messageList: (ctx) => {
          const token = ctx.query.cursor
          const before = token ? state.cursors.get(token) : undefined

          if (token && !before) return Effect.fail(new MockBadRequest({ message: "Invalid cursor" }))

          return Effect.gen(function* () {
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "start" })

            if (config.beforeMessagesResponse) {
              yield* Effect.promise(() => config.beforeMessagesResponse!({ sessionID: ctx.params.sessionID, before }))
            }

            yield* delay
            const pageData = config.pageMessages(ctx.params.sessionID, ctx.query.limit ?? 50, before)
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "end" })
            const cursor = pageData.cursor ? `cursor_${++state.nextCursor}` : undefined

            if (cursor) state.cursors.set(cursor, pageData.cursor!)

            return {
              data: ctx.query.order === "asc" ? pageData.items : pageData.items.toReversed(),
              cursor: { next: cursor },
            }
          })
        },
      }),
  )
}

// The requested workspace (directory) inside the configured project.
function location(config: MockServerConfig, directory = config.directory) {
  return {
    directory,
    project: { id: projectSeed(config)?.id, directory: config.directory, canonical: config.directory },
  }
}

// The project fields the mock reads.
function projectSeed(config: MockServerConfig) {
  return Option.getOrUndefined(decodeProject(config.project))
}

// Every field of the configured project, for answers that echo it.
function projectFields(config: MockServerConfig) {
  return Predicate.isObject(config.project) ? config.project : undefined
}

function currentProviders(catalog: MockProviderCatalog) {
  const connected = new Set(catalog.connected ?? [])

  return (catalog.all ?? [])
    .flatMap((item) => Option.toArray(decodeProvider(item)))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      integrationID: provider.integrationID,
      package: provider.id,
      activation: connected.has(provider.id) ? "enabled" : "auto",
    }))
}

function currentModels(catalog: MockProviderCatalog) {
  return (catalog.all ?? [])
    .flatMap((item) => Option.toArray(decodeModelProvider(item)))
    .flatMap((provider) =>
      Object.values(provider.models)
        .flatMap((item) => Option.toArray(decodeModel(item)))
        .map((model) => ({
          id: model.id,
          modelID: model.api?.id ?? model.id,
          providerID: provider.id,
          name: model.name,
          metadata: model.metadata,
          origins: model.origins,
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants: Object.entries(model.variants ?? {}).map(([id, settings]) =>
            Predicate.isObject(settings) ? { id, settings } : { id },
          ),
          time: { released: model.release_date ? Date.parse(model.release_date) : Date.now() },
          cost: [{ input: model.cost?.input ?? 0, output: model.cost?.output ?? 0, cache: { read: 0, write: 0 } }],
          status: "active",
          enabled: true,
          limit: { context: model.limit?.context ?? 200_000, output: model.limit?.output ?? 32_000 },
        })),
    )
}

function currentDefaultModel(catalog: MockProviderCatalog) {
  const selected = catalog.default

  if (!selected) return null

  return (
    currentModels(catalog).find((model) => model.providerID === selected.providerID && model.id === selected.modelID) ??
    null
  )
}

// Legacy requests (`permission`, `patterns`, `always`, `tool`) become current ones; current ones (`action`) pass as is.
function currentPermissions(values: readonly unknown[]) {
  return values.flatMap((permission) => {
    if (!Predicate.isObject(permission)) return []

    if (permission.action) return [permission]
    const tool = Predicate.isObject(permission.tool) ? permission.tool : undefined

    return [
      {
        id: permission.id,
        sessionID: permission.sessionID,
        action: permission.permission,
        resources: permission.patterns ?? [],
        save: permission.always,
        metadata: permission.metadata,
        source:
          tool?.messageID && (tool.id || tool.callID)
            ? { type: "tool", messageID: tool.messageID, id: tool.id ?? tool.callID }
            : undefined,
      },
    ]
  })
}

export function currentSession(session: MockSession, fallbackDirectory?: string) {
  const seed = decodeSession(session)

  const placement: MockSessionLocation = {
    directory: seed.location?.directory ?? seed.directory ?? fallbackDirectory,
  }

  if (seed.location?.workspaceID !== undefined) placement.workspaceID = seed.location.workspaceID

  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    mode: seed.mode,
    agent: session.agent ?? "build",
    model: Schema.decodeUnknownSync(Model.Selection)(
      session.model ?? { id: "mock-model", providerID: "mock-provider" },
    ),
    controller:
      session.controller === undefined ? undefined : Schema.decodeUnknownSync(Session.Controller)(session.controller),
    executorPreference:
      session.executorPreference === undefined
        ? undefined
        : Schema.decodeUnknownSync(Session.ExecutorPreference)(session.executorPreference),
    fork: session.fork,
    metadata: session.metadata === undefined ? undefined : Schema.decodeUnknownSync(Session.Metadata)(session.metadata),
    cost: session.cost ?? 0,
    ...Schema.decodeUnknownSync(
      Schema.Struct({
        unknownPriceAttempts: lenient(Session.Info.fields.unknownPriceAttempts),
        missingUsageAttempts: lenient(Session.Info.fields.missingUsageAttempts),
      }),
    )(session),
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...decodeSessionOutcome(session),
    time: { created: seed.time?.created ?? 0, updated: seed.time?.updated ?? 0, ...seed.time },
    title: session.title ?? session.id,
    location: placement,
    subpath: session.subpath ?? session.path,
    revert: session.revert,
    workContract:
      session.workContract === undefined
        ? undefined
        : Schema.decodeUnknownSync(WorkContract.Snapshot)(session.workContract),
  }
}

// An optional field that decodes as absent when its value is invalid, so one bad field does not discard the rest.
function lenient<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))
}

const decodeJsonObject = Schema.decodeUnknownOption(Schema.JsonObject)

const decodeProject = Schema.decodeUnknownOption(
  Schema.Struct({
    id: lenient(Schema.String),
    worktree: lenient(Schema.String),
    canonical: lenient(Schema.String),
    sandboxes: lenient(Schema.Array(Schema.String)),
  }),
)

const decodeWorktreeRequest = Schema.decodeUnknownOption(
  Schema.Struct({ directory: lenient(Schema.String), name: lenient(Schema.String) }),
)

const decodeWorktreeAnswer = Schema.decodeUnknownOption(Schema.Struct({ directory: Schema.String }))

const decodeSessionCreate = Schema.decodeUnknownOption(
  Schema.Struct({ id: lenient(Schema.String), title: lenient(Schema.String), parentID: lenient(Schema.String) }),
)

const decodeSessionRename = Schema.decodeUnknownOption(Schema.Struct({ title: Schema.String }))

const decodeRevertStage = Schema.decodeUnknownOption(Schema.Struct({ messageID: Schema.String }))

const decodePermissionReply = Schema.decodeUnknownOption(Schema.Struct({ decision: Permission.Reply }))

const decodePromptRequest = Schema.decodeUnknownOption(
  Schema.Struct({ id: lenient(Schema.String), delivery: lenient(Schema.Literal("queue")) }),
)

const decodePromptPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    text: lenient(Schema.String),
    files: Schema.optionalKey(Schema.Json),
    agents: Schema.optionalKey(Schema.Json),
    skills: Schema.optionalKey(Schema.Json),
    metadata: Schema.optionalKey(Schema.Json),
  }),
)

const decodeProvider = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    integrationID: Schema.optionalKey(Schema.String),
  }),
)

const decodeModelProvider = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, models: Schema.Record(Schema.String, Schema.Unknown) }),
)

const decodeModel = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    api: lenient(Schema.Struct({ id: Schema.String })),
    metadata: lenient(ModelSource.Metadata),
    origins: lenient(ModelSource.Origins),
    release_date: lenient(Schema.String),
    limit: lenient(Schema.Struct({ context: lenient(Schema.Number), output: lenient(Schema.Number) })),
    cost: lenient(Schema.Struct({ input: lenient(Schema.Number), output: lenient(Schema.Number) })),
    variants: lenient(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)

// Every field is lenient, so any session object decodes.
const decodeSession = Schema.decodeUnknownSync(
  Schema.Struct({
    mode: lenient(ProductMode.ID),
    time: lenient(
      Schema.Struct({
        created: lenient(Schema.Number),
        updated: lenient(Schema.Number),
        message: lenient(Schema.Number),
        idle: lenient(Schema.Number),
        viewed: lenient(Schema.Number),
        archived: Schema.optionalKey(Schema.Unknown),
      }),
    ),
    location: lenient(Schema.Struct({ directory: lenient(Schema.String), workspaceID: lenient(Schema.String) })),
    directory: lenient(Schema.String),
  }),
)

const decodeSessionOutcome = Schema.decodeUnknownSync(Schema.Struct({ outcome: lenient(Schema.String) }))
