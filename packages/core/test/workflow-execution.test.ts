import path from "node:path"
import { describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { LLMClient, LLMRequest } from "@omnixa/ai"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { Bus } from "@omnixa/core/bus"
import { Config } from "@omnixa/core/config"
import { CredentialScanner } from "@omnixa/core/credential-scanner"
import { Database } from "@omnixa/core/database/database"
import { DelegationExecution } from "@omnixa/core/delegation/execution"
import { DelegationService } from "@omnixa/core/delegation/service"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNodePlatform } from "@omnixa/core/effect/app-node-platform"
import { Job } from "@omnixa/core/job"
import { KV } from "@omnixa/core/kv"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { Permission } from "@omnixa/core/permission"
import { PermissionSaved } from "@omnixa/core/permission/saved"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { ScopedGrantStore } from "@omnixa/core/grant/store"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionSchema } from "@omnixa/core/session/schema"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionContext } from "@omnixa/core/session/context"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionRestart } from "@omnixa/core/session/execution/restart"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionMessage } from "@omnixa/core/session/message"
import { SessionModelTransport } from "@omnixa/core/session/model-transport"
import { SessionTable } from "@omnixa/core/session/sql"
import { SessionStore } from "@omnixa/core/session/store"
import { SessionTask } from "@omnixa/core/session/task"
import { Tool } from "@omnixa/core/tool"
import { WorkflowExecution } from "@omnixa/core/workflow/execution"
import { MetaAgentService } from "@omnixa/core/meta-agent/service"
import { WorkflowRun } from "@omnixa/core/workflow/workflow-run"
import { AssetYaml } from "@omnixa/core/util/asset-yaml"
import { Composition } from "@omnixa/schema/composition"
import { AbsolutePath } from "@omnixa/schema/schema"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Hash } from "@omnixa/util/hash"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { Socket } from "effect/socket"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { withCustomMode } from "./lib/product-mode"

const it = testEffect(Layer.empty)
const requestText = (request: LLMRequest) =>
  request.messages
    .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
    .join("\n")
const workflowHandoff = (request: LLMRequest) => {
  const text = request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
    .findLast((text) => text.startsWith("<workflow_result>\n"))
  if (!text) throw new Error("Missing parent user-role Workflow handoff")
  expect(Array.from(text).length).toBeLessThanOrEqual(12_000)
  const parsed: unknown = JSON.parse(text.slice("<workflow_result>\n".length, -"\n</workflow_result>".length))
  const payload = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(parsed)
  const steps = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(payload.steps)
  expect(steps.every((item) => Array.from(Schema.decodeUnknownSync(Schema.String)(item.detail)).length <= 2_000)).toBe(
    true,
  )
  console.info("MC08_W1_PARENT", JSON.stringify({ role: "user", text, payload }))
  return { text, payload, steps }
}
const seedLegacyRecoveryParent = Effect.fnUntraced(function* (
  sessions: Session.Interface,
  bus: Bus.Interface,
  base: Session.Info,
  title: string,
) {
  const id = Session.ID.create()
  yield* bus.publish(SessionEvent.Created, {
    sessionID: id,
    projectID: base.projectID,
    location: base.location,
    mode: "coding",
    slug: id,
    title,
    version: "test",
  })
  const parent = yield* sessions.get(id)
  expect(parent.controller).toBeUndefined()
  return parent
})
const step = (id: string, fields: Partial<WorkflowAsset.StepDef> = {}) =>
  new WorkflowAsset.StepDef({
    id,
    name: id,
    agent: "coder",
    input: { prompt: id },
    ...fields,
  })
type CancelStepInput = Parameters<WorkflowRun.Interface["cancelStep"]>[0]
type ForwardedRecoveryCause =
  | {
      boundary: "run"
      runID: WorkflowAsset.WorkflowRunID
      cause: Cause.Cause<WorkflowRun.WorkflowNotFoundError>
      forwarded: string[]
    }
  | {
      boundary: "scan"
      cause: Cause.Cause<never>
      forwarded: string[]
    }

const setup = Effect.fnUntraced(function* (
  steps: readonly WorkflowAsset.StepDef[],
  options: {
    directory?: string
    databasePath?: string
    sessionID?: Session.ID
    scope?: Scope.Scope
    pauseBeforeStart?: Deferred.Deferred<void>
    pauseBeforeCancel?: { entered: Deferred.Deferred<CancelStepInput>; release: Deferred.Deferred<void> }
    pauseInterruptedSettlement?: {
      entered: Deferred.Deferred<WorkflowAsset.StepRunID>
      release: Deferred.Deferred<void>
    }
    pauseDeletion?: { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }
    forwardRecoveryCause?: ForwardedRecoveryCause
    persist?: boolean
  } = {},
) {
  const directory = options.directory ?? (yield* tmpdirScoped("omnixa-workflow-core-")).path
  const agent = "---\nkind: agent\nname: coder\ndescription: Workflow executor\n---\nExecute the supplied JSON input.\n"
  const workflow = AssetYaml.stringify({
    kind: "workflow",
    name: "core",
    description: "Core workflow",
    version: "1",
    steps,
  })
  if (!options.sessionID) {
    yield* Effect.promise(() => Bun.write(path.join(directory, ".omnixa/agents/coder.md"), agent))
    yield* Effect.promise(() => Bun.write(path.join(directory, ".omnixa/workflows/core.yaml"), workflow))
  }
  const llm = Context.get(yield* Layer.build(TestLLM.testLayer()), TestLLM.Test)
  const pauseBeforeStart = options.pauseBeforeStart
  const pauseBeforeCancel = options.pauseBeforeCancel
  const pauseInterruptedSettlement = options.pauseInterruptedSettlement
  const pauseDeletion = options.pauseDeletion
  const forwardRecoveryCause = options.forwardRecoveryCause
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      WorkflowExecution.node,
      WorkflowRun.node,
      Session.node,
      SessionComposition.node,
      SessionTask.node,
      SessionStore.node,
      SessionInbox.node,
      SessionExecution.node,
      Database.node,
      Bus.node,
      Job.node,
      KV.node,
      LocationServiceMap.node,
      SessionRestart.node,
      DelegationExecution.node,
      DelegationService.node,
      MetaAgentService.node,
      PermissionSaved.node,
    ]),
    [
      Database.node.replace(Database.configured({ path: options.databasePath ?? ":memory:" })),
      Bus.node.replace(Bus.configured({ persist: options.persist ?? true })),
      ...(pauseBeforeStart || pauseBeforeCancel || pauseInterruptedSettlement || forwardRecoveryCause
        ? [
            WorkflowRun.node.replace(
              makeGlobalNode({
                service: WorkflowRun.Service,
                deps: [Database.node, Bus.node],
                layer: Layer.effect(
                  WorkflowRun.Service,
                  Effect.gen(function* () {
                    const database = yield* Database.Service
                    const bus = yield* Bus.Service
                    const owner = Context.get(
                      yield* Layer.build(
                        WorkflowRun.layer.pipe(
                          Layer.provide(
                            Layer.merge(Layer.succeed(Database.Service, database), Layer.succeed(Bus.Service, bus)),
                          ),
                        ),
                      ),
                      WorkflowRun.Service,
                    )
                    const get: WorkflowRun.Interface["get"] = (runID) =>
                      owner.get(runID).pipe(
                        Effect.tap(() => {
                          if (forwardRecoveryCause?.boundary !== "run" || forwardRecoveryCause.runID !== runID)
                            return Effect.void
                          return Effect.sync(() => void forwardRecoveryCause.forwarded.push("run")).pipe(
                            Effect.andThen(Effect.failCause(forwardRecoveryCause.cause)),
                          )
                        }),
                      )
                    const listForRecovery: WorkflowRun.Interface["listForRecovery"] = owner.listForRecovery.pipe(
                      Effect.tap(() => {
                        if (forwardRecoveryCause?.boundary !== "scan") return Effect.void
                        // The real scan is never-error: only defects and interruption may be forwarded here.
                        return Effect.sync(() => void forwardRecoveryCause.forwarded.push("scan")).pipe(
                          Effect.andThen(Effect.failCause(forwardRecoveryCause.cause)),
                        )
                      }),
                    )
                    const startStep: WorkflowRun.Interface["startStep"] = (input, revision) =>
                      Effect.gen(function* () {
                        if (!pauseBeforeStart) return yield* owner.startStep(input, revision)
                        yield* Deferred.succeed(pauseBeforeStart, undefined)
                        return yield* Effect.never
                      })
                    const cancelStep: WorkflowRun.Interface["cancelStep"] = (input) =>
                      Effect.gen(function* () {
                        // The execution caller has already captured both CAS revisions in this actual owner input.
                        if (pauseBeforeCancel && (yield* Deferred.succeed(pauseBeforeCancel.entered, input)))
                          yield* Deferred.await(pauseBeforeCancel.release)
                        return yield* owner.cancelStep(input)
                      })
                    const settleStep: WorkflowRun.Interface["settleStep"] = (input, result) =>
                      Effect.gen(function* () {
                        if (pauseInterruptedSettlement && typeof input !== "string" && input.status === "cancelled") {
                          // When the interrupted input wins the race, hold its Step write until real Job cancellation.
                          yield* Deferred.succeed(pauseInterruptedSettlement.entered, input.stepRunID)
                          yield* Deferred.await(pauseInterruptedSettlement.release)
                        }
                        return yield* owner.settleStep(input, result)
                      })
                    return WorkflowRun.Service.of({ ...owner, get, listForRecovery, startStep, cancelStep, settleStep })
                  }),
                ),
              }),
            ),
          ]
        : []),
      ...(pauseDeletion
        ? [
            SessionModelTransport.node.replace(
              makeGlobalNode({
                service: SessionModelTransport.Service,
                deps: [LayerNodePlatform.webSocketConstructor],
                layer: Layer.effect(
                  SessionModelTransport.Service,
                  Effect.gen(function* () {
                    const constructor = yield* Socket.WebSocketConstructor
                    const transport = Context.get(
                      yield* Layer.build(
                        SessionModelTransport.layer.pipe(
                          Layer.provide(Layer.succeed(Socket.WebSocketConstructor, constructor)),
                        ),
                      ),
                      SessionModelTransport.Service,
                    )
                    return SessionModelTransport.Service.of({
                      ...transport,
                      close: (sessionID) =>
                        Effect.gen(function* () {
                          yield* Deferred.succeed(pauseDeletion.entered, undefined)
                          yield* Deferred.await(pauseDeletion.release)
                          yield* transport.close(sessionID)
                        }),
                    })
                  }),
                ),
              }),
            ),
          ]
        : []),
      Config.node.replace(Config.configured({ project: false, global: false })),
      offlineModels,
      LayerNodePlatform.llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
    ],
  )
  const scope = options.scope ?? (yield* Scope.Scope)
  const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope))
  const sessions = Context.get(context, Session.Service)
  const compositions = Context.get(context, SessionComposition.Service)
  const execution = Context.get(context, WorkflowExecution.Service)
  const runs = Context.get(context, WorkflowRun.Service)
  const tasks = Context.get(context, SessionTask.Service)
  const jobs = Context.get(context, Job.Service)
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  const model = Model.Ref.make({ providerID: Provider.ID.make("workflow-keeper"), id: Model.ID.make("workflow") })
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provide(Context.get(context, LocationServiceMap.Service).get(location)))
  const created = options.sessionID
    ? {
        session: yield* sessions.get(options.sessionID),
        snapshot: yield* compositions.get(options.sessionID),
      }
    : yield* sessions.createCustom({
        location,
        model,
        title: "Workflow test",
        composition: new Composition.TemporaryInput({
          source: "temporary",
          agents: [
            new Composition.AgentRef({
              kind: "agent",
              relativePath: "coder.md",
              revision: Composition.Revision.make(Hash.sha256(Buffer.from(agent))),
            }),
          ],
          workflow: new Composition.WorkflowRef({
            kind: "workflow",
            relativePath: "core.yaml",
            revision: Composition.Revision.make(Hash.sha256(Buffer.from(workflow))),
          }),
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        }),
      })
  const snapshot = created.snapshot
  if (snapshot.version !== 2 || !snapshot.data.workflow)
    return yield* Effect.die(new Error("Missing V2 workflow fixture"))
  const start = (requestID = "start") =>
    execution.run({ sessionID: created.session.id, requestID, expectedSnapshotDigest: created.snapshot.digest })
  const current = () => runs.getBySession(created.session.id)
  const terminal = () =>
    pollWithTimeout(
      current().pipe(
        Effect.map((run) =>
          run && ["completed", "partial_success", "failed", "cancelled", "recovery_required"].includes(run.status)
            ? run
            : undefined,
        ),
      ),
      "Workflow did not settle",
      "10 seconds",
    )
  const wait = (runID: WorkflowAsset.WorkflowRunID) =>
    awaitWithTimeout(execution.wait(runID), "Workflow Job did not settle", "10 seconds")
  return {
    directory,
    context,
    llm,
    sessions,
    compositions,
    execution,
    runs,
    tasks,
    jobs,
    created: { session: created.session, snapshot },
    start,
    current,
    terminal,
    wait,
  }
})

const runInfo = (status: WorkflowAsset.WorkflowStatusResponse) => {
  if (!status.run) throw new Error("Missing run response")
  return status.run
}

it.live("filters a frozen Workflow child by the current parent permission ceiling", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })])
      yield* f.llm.push(TestLLM.text("Worker complete", "worker"), TestLLM.text("Root complete", "root"))
      const completed = yield* f.wait(runInfo(yield* f.start()).id)
      expect(completed.run?.status).toBe("completed")
      yield* awaitWithTimeout(f.llm.wait(2), "Root did not receive the Workflow handoff", "10 seconds")
      yield* awaitWithTimeout(
        Context.get(f.context, SessionExecution.Service).awaitIdle(f.created.session.id),
        "Root did not settle",
        "10 seconds",
      )
      const childID = completed.steps[0]?.childSessionId
      if (!childID) return yield* Effect.die(new Error("Missing Workflow child"))
      const child = yield* f.sessions.get(Session.ID.make(childID))
      expect(child.controller).toMatchObject({
        kind: "child",
        rootSessionID: f.created.session.id,
        source: { kind: "workflow" },
      })
      expect(child.attended).toBe(false)
      // An attended fixture exposes execution asks for the parent ceiling checks below.
      yield* Context.get(f.context, Database.Service)
        .db.update(SessionTable)
        .set({ attended: 1 })
        .where(eq(SessionTable.id, child.id))
        .run()
        .pipe(Effect.orDie)
      expect((yield* f.sessions.get(child.id)).attended).toBe(true)
      yield* f.sessions.setPermissions({ sessionID: f.created.session.id, permissions: [] })
      yield* f.sessions.setPermissions({
        sessionID: child.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
        ],
      })
      yield* Effect.gen(function* () {
        const context = yield* SessionContext.Service
        const permissions = yield* Permission.Service
        const registry = yield* Tool.Service
        const baseline = yield* context.select(child.id)
        expect(baseline.tools.catalog.find((tool) => tool.name === "omnixa_worktree_remove")).toMatchObject({
          placement: "codemode",
          options: { namespace: "omnixa", permission: "edit" },
        })
        expect(baseline.tools.definitions.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["read", "write", "execute"]),
        )
        expect(baseline.tools.catalog.some((tool) => tool.name === "task" || tool.name === "subagent")).toBe(false)

        yield* f.sessions.setPermissions({
          sessionID: f.created.session.id,
          permissions: [{ action: "edit", resource: "*", effect: "deny" }],
        })
        const editingDenied = yield* context.select(child.id)
        expect(editingDenied.tools.catalog.map((tool) => tool.name)).not.toContain("omnixa_worktree_remove")
        expect(editingDenied.tools.definitions.map((tool) => tool.name)).not.toContain("write")
        expect(editingDenied.tools.definitions.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["read", "execute"]),
        )
        expect(
          yield* permissions
            .assert({ sessionID: child.id, action: "edit", resources: [f.directory] })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Permission.BlockedError)

        yield* f.sessions.setPermissions({
          sessionID: f.created.session.id,
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
          ],
        })
        const readingOnly = yield* context.select(child.id)
        expect(readingOnly.tools.definitions.map((tool) => tool.name)).toContain("read")
        expect(readingOnly.tools.definitions.map((tool) => tool.name)).not.toContain("execute")
        expect(readingOnly.tools.catalog.map((tool) => tool.name)).not.toContain("omnixa_worktree_remove")
        yield* permissions.assert({ sessionID: child.id, action: "read", resources: [f.directory] })
        expect(
          yield* permissions
            .assert({ sessionID: child.id, action: "execute", resources: [f.directory] })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Permission.BlockedError)
        expect(yield* permissions.list()).toEqual([])

        const saved = yield* PermissionSaved.Service
        yield* saved.add({ projectID: f.created.session.projectID, action: "read", resources: ["*"] })
        expect(yield* saved.list({ projectID: f.created.session.projectID })).toMatchObject([
          { action: "read", resource: "*" },
        ])
        const grants = yield* ScopedGrantStore.Service
        const grant = yield* grants.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })
        const hooks = yield* PluginHooks.Service
        const effects: string[] = []
        const hook = yield* hooks.register("permission", "evaluate", (event) =>
          Effect.sync(() => {
            if (event.sessionID !== child.id || event.action !== "read") return
            effects.push(event.effect)
            event.effect = "allow"
          }),
        )
        yield* f.sessions.setPermissions({
          sessionID: f.created.session.id,
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "read", resource: "secrets/*", effect: "deny" },
          ],
        })
        yield* permissions.assert({ sessionID: child.id, action: "read", resources: ["src/index.ts"] })
        expect(effects).toEqual(["allow"])
        yield* Effect.forEach(
          [["secrets/token.txt"], ["src/index.ts", "secrets/token.txt"], ["secrets/token.txt", "src/index.ts"]],
          (resources) =>
            Effect.gen(function* () {
              const input = { sessionID: child.id, action: "read", resources }
              expect(yield* grants.findValid(input)).toEqual(grant)
              expect(yield* permissions.ask(input)).toMatchObject({ effect: "deny" })
              const denied = yield* permissions.assert(input).pipe(Effect.flip)
              expect(denied).toBeInstanceOf(Permission.BlockedError)
              expect(denied).toMatchObject({ permission: "read", resources })
            }),
          { discard: true },
        )
        expect(effects).toEqual(["allow"])
        expect(yield* grants.get(grant.grant.id)).toEqual(grant)
        expect(yield* permissions.list()).toEqual([])
        yield* hook.dispose

        yield* registry.transform((editor) => editor.remove("read"))
        expect(yield* context.select(child.id).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.DependencyMissingError",
          sessionID: child.id,
          reason: "tool_runtime_catalog_mismatch",
        })
      }).pipe(
        Effect.provide(Context.get(f.context, LocationServiceMap.Service).get(child.location)),
        Effect.provide(f.context),
      )
    }),
  ),
)

it.live("executes serial children from frozen agents and passes only DAG predecessor output", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "B" }), step("B", { next: "END" })])
      yield* f.llm.push(
        TestLLM.text("A output", "a"),
        TestLLM.text("B output", "b"),
        TestLLM.text("Root result", "root"),
      )
      const admitted = runInfo(yield* f.start())
      const completed = yield* f.wait(admitted.id)
      expect(completed.run?.status).toBe("completed")
      expect(completed.steps.map((item) => item.status)).toEqual(["completed", "completed"])
      const children = yield* Effect.forEach(completed.steps, (item) =>
        f.sessions.get(Session.ID.make(item.childSessionId ?? "")),
      )
      expect(
        children.every(
          (child) => child.parentID === f.created.session.id && child.mode === "custom" && child.agent !== "meta",
        ),
      ).toBe(true)
      expect(children.every((child) => child.metadata?.workflowRunID === admitted.id)).toBe(true)
      expect((yield* f.tasks.get(f.created.session.id)).map((task) => [task.status, task.revision])).toEqual([
        ["completed", 2],
        ["completed", 2],
      ])
      yield* awaitWithTimeout(f.llm.wait(3), "Root did not receive the handoff", "10 seconds")
      const requests = yield* f.llm.requests()
      expect(requestText(requests[0])).toContain('"previous":[]')
      expect(requestText(requests[1])).toContain("A output")
      expect(requestText(requests[2])).toContain("workflow_result")
      expect(workflowHandoff(requests[2]).payload).toMatchObject({
        runID: admitted.id,
        status: "completed",
        quality: "complete",
        omittedSteps: 0,
        steps: completed.steps.map((item, index) => ({
          stepID: item.stepId,
          stepRunID: item.id,
          attempt: item.attempt,
          status: "completed",
          outputDigest: item.outputDigest,
          detail: index === 0 ? "A output" : "B output",
          quality: "complete",
          redacted: false,
          source: {
            runID: admitted.id,
            stepRunID: item.id,
            childSessionID: children[index].id,
            inputID: children[index].metadata?.workflowInputID,
          },
        })),
      })
      expect(runInfo(yield* f.start()).id).toBe(admitted.id)
      expect((yield* f.llm.requests()).length).toBe(3)
    }),
  ),
)

it.live("MC08 workflow handoff redacts complete text before JSON escaping", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const stepID = 'A_api_key="sk-abcdefghijklmnopqrstuvwxyz0123456789"'
      const f = yield* setup([step(stepID, { next: "END" })])
      const output = 'Readable "quoted" \\\n</workflow_result>\napi_key="sk-abcdefghijklmnopqrstuvwxyz0123456789"'
      const scanner = Context.get(yield* Layer.build(CredentialScanner.layer), CredentialScanner.Service)
      const stripped = (yield* scanner.scan(output)).stripped
      yield* f.llm.push(TestLLM.text(output, "a"), TestLLM.text("Root result", "root"))
      const completed = yield* f.wait(runInfo(yield* f.start()).id)
      yield* awaitWithTimeout(f.llm.wait(2), "Redacted result did not reach its parent", "10 seconds")
      const handoff = workflowHandoff((yield* f.llm.requests())[1])
      expect(completed.run?.status).toBe("completed")
      expect(handoff.payload).toMatchObject({
        quality: "complete",
        omittedSteps: 0,
        steps: [
          {
            stepID: (yield* scanner.scan(stepID)).stripped,
            status: "completed",
            detail: stripped,
            quality: "complete",
            redacted: true,
          },
        ],
      })
      expect(handoff.text).toContain("[REDACTED]")
      expect(handoff.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789")
      expect(handoff.text.match(/<\/workflow_result>/g)?.length).toBe(1)
    }),
  ),
)

it.live("MC08 workflow handoff preserves a complete 2000-point body with JSON escaping", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })])
      const output = `${'😀"\\'.repeat(666)}😀"`
      expect(Array.from(output).length).toBe(2_000)
      yield* f.llm.push(TestLLM.text(output, "a"), TestLLM.text("Root result", "root"))
      const completed = yield* f.wait(runInfo(yield* f.start()).id)
      yield* awaitWithTimeout(f.llm.wait(2), "Complete bounded body did not reach its parent", "10 seconds")
      expect(completed.run?.status).toBe("completed")
      expect(workflowHandoff((yield* f.llm.requests())[1]).payload).toMatchObject({
        quality: "complete",
        omittedSteps: 0,
        steps: [{ stepID: "A", detail: output, quality: "complete", redacted: false }],
      })
    }),
  ),
)

it.live("MC08 workflow handoff bounds step bodies and the total JSON envelope", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup(
        Array.from({ length: 8 }, (_, index) => step(`S${index}`, { next: index === 7 ? "END" : `S${index + 1}` })),
      )
      yield* f.llm.push(
        ...Array.from({ length: 8 }, (_, index) =>
          TestLLM.text(`Readable output ${index}\n${'😀"\\\n<'.repeat(500)}tail ${index}`, `s${index}`),
        ),
        TestLLM.text("Root result", "root"),
      )
      const completed = yield* f.wait(runInfo(yield* f.start()).id)
      yield* awaitWithTimeout(f.llm.wait(9), "Bounded result did not reach its parent", "10 seconds")
      const handoff = workflowHandoff((yield* f.llm.requests())[8])
      expect(completed.run?.status).toBe("completed")
      expect(handoff.payload).toMatchObject({ quality: "truncated", omittedSteps: 0 })
      expect(handoff.steps.length).toBe(8)
      expect(handoff.steps[0].detail).toEqual(expect.stringContaining("Readable output 0"))
      expect(handoff.steps.every((item) => item.quality === "truncated")).toBe(true)
      expect(handoff.steps.some((item) => item.detail === "")).toBe(true)
      expect(handoff.steps).toMatchObject(
        completed.steps.map((item) => ({
          stepID: item.stepId,
          stepRunID: item.id,
          attempt: item.attempt,
          status: "completed",
          outputDigest: item.outputDigest,
          redacted: false,
          source: { runID: completed.run?.id, stepRunID: item.id, childSessionID: item.childSessionId },
        })),
      )
    }),
  ),
)

it.live("MC08 workflow handoff reports omitted identities without cutting JSON", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("X".repeat(12_000), { next: "END" })])
      yield* f.llm.push(TestLLM.text("Completed output", "a"), TestLLM.text("Root result", "root"))
      const completed = yield* f.wait(runInfo(yield* f.start()).id)
      yield* awaitWithTimeout(f.llm.wait(2), "Omission reference did not reach its parent", "10 seconds")
      expect(workflowHandoff((yield* f.llm.requests())[1]).payload).toMatchObject({
        runID: completed.run?.id,
        status: "completed",
        quality: "truncated",
        omittedSteps: 1,
        steps: [],
      })
    }),
  ),
)

it.live("runs a bounded parallel frontier and cancels all owned children", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([
        step("entry", { parallel: ["left", "right"] }),
        step("left", { next: "END" }),
        step("right", { next: "END" }),
      ])
      yield* f.llm.serve((request) =>
        requestText(request).includes('"step":"entry"') ? TestLLM.text("Ready", "entry") : TestLLM.hangAfter(),
      )
      const admitted = runInfo(yield* f.start())
      yield* awaitWithTimeout(f.llm.wait(3), "Parallel children did not both start", "10 seconds")
      const live = yield* f.runs.get(admitted.id)
      expect((yield* f.runs.getSteps(live.id)).filter((item) => item.status === "running").length).toBe(2)
      yield* f.llm.always(TestLLM.text("Cancelled", "root"))
      const cancelled = yield* f.execution.cancelRun({
        sessionID: f.created.session.id,
        runID: live.id,
        expectedRunRevision: live.revision,
      })
      expect(cancelled.run?.status).toBe("cancelled")
      expect(
        cancelled.steps.every((item) => !["ready", "dispatching", "running", "cancelling"].includes(item.status)),
      ).toBe(true)
      for (const item of cancelled.steps)
        if (item.childSessionId) expect(yield* f.sessions.inbox(Session.ID.make(item.childSessionId))).toEqual([])
    }),
  ),
)

it.live("strictly routes branch results and preserves source lineage on manual retry", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const steps = [
        step("A", { next: "branch" }),
        step("branch", { branches: { good: "accept", bad: "reject" } }),
        step("accept", { next: "END" }),
        step("reject", { next: "END" }),
      ]
      const f = yield* setup(steps)
      yield* f.llm.push(
        TestLLM.text("Prior output", "a"),
        TestLLM.text('{"branch":"good","extra":true}', "bad"),
        TestLLM.text("Failure acknowledged", "root1"),
      )
      const admitted = runInfo(yield* f.start())
      const failed = yield* f.wait(admitted.id)
      expect(failed.run?.status).toBe("failed")
      const target = failed.steps.find((item) => item.stepId === "branch")
      if (!target || !failed.run) return yield* Effect.die(new Error("Missing failed branch"))
      expect(target.errorCategory).toBe("invalid_branch_output")
      yield* awaitWithTimeout(f.llm.wait(3), "Failed handoff missing", "10 seconds")
      yield* f.sessions.wait(f.created.session.id)
      yield* f.llm.push(
        TestLLM.text('{"branch":"good","summary":"Accepted"}', "branch"),
        TestLLM.text("Accepted output", "accept"),
        TestLLM.text("Complete", "root2"),
      )
      const request = {
        sessionID: f.created.session.id,
        runID: failed.run.id,
        stepRunID: target.id,
        requestID: "retry",
        expectedRunRevision: failed.run.revision,
        expectedStepRevision: target.revision,
      }
      const retried = runInfo(yield* f.execution.retryStep(request))
      const completed = yield* f.wait(retried.id)
      expect(completed.run).toMatchObject({
        status: "completed",
        parentRunID: admitted.id,
        rootRunID: admitted.id,
        retryOfStepRunID: target.id,
      })
      expect(completed.steps.find((item) => item.stepId === "A")?.childSessionId).toBe(
        failed.steps.find((item) => item.stepId === "A")?.childSessionId,
      )
      expect(completed.steps.find((item) => item.stepId === "reject")?.status).toBe("skipped")
      expect(yield* f.runs.get(admitted.id)).toEqual(failed.run)
      expect(runInfo(yield* f.execution.retryStep(request)).id).toBe(retried.id)
      yield* awaitWithTimeout(f.llm.wait(6), "Retry handoff missing", "10 seconds")
      const requests = yield* f.llm.requests()
      expect(requests.filter((request) => requestText(request).includes('"step":"A"')).length).toBe(1)
      expect(requestText(requests[3])).toContain("Prior output")
      expect(workflowHandoff(requests[2]).steps.slice(0, 2)).toMatchObject([
        { stepID: "A", detail: "Prior output", quality: "complete" },
        {
          stepID: "branch",
          status: "failed",
          errorCategory: "invalid_branch_output",
          detail: '{"branch":"good","extra":true}',
          quality: "complete",
          source: { resultStatus: "completed" },
        },
      ])
      const original = failed.steps.find((item) => item.stepId === "A")
      const copied = completed.steps.find((item) => item.stepId === "A")
      if (!original?.childSessionId || !copied) return yield* Effect.die(new Error("Missing copied predecessor"))
      const child = yield* f.sessions.get(Session.ID.make(original.childSessionId))
      expect(copied.id).not.toBe(original.id)
      const parentRequest = requests.findLast((request) =>
        request.messages.some(
          (message) =>
            message.role === "user" &&
            message.content.some(
              (part) =>
                part.type === "text" &&
                part.text.startsWith("<workflow_result>\n") &&
                part.text.includes(`"runID":"${retried.id}"`),
            ),
        ),
      )
      if (!parentRequest) return yield* Effect.die(new Error("Missing parent request for the retried run"))
      const handoff = workflowHandoff(parentRequest)
      expect(handoff.payload).toMatchObject({ runID: retried.id, status: "completed" })
      expect(handoff.steps).toMatchObject([
        {
          stepID: "A",
          stepRunID: copied.id,
          attempt: copied.attempt,
          outputDigest: original.outputDigest,
          detail: "Prior output",
          quality: "complete",
          source: {
            runID: admitted.id,
            stepRunID: original.id,
            childSessionID: child.id,
            inputID: child.metadata?.workflowInputID,
          },
        },
        { stepID: "branch", detail: '{"branch":"good","summary":"Accepted"}', quality: "complete" },
        { stepID: "accept", detail: "Accepted output", quality: "complete" },
        { stepID: "reject", status: "skipped", quality: "unavailable" },
      ])
    }),
  ),
)

it.live("enforces retry attempt bounds without running unselected branches", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([
        step("branch", { branches: { good: "done" }, failurePolicy: "retry", maxAttempts: 2 }),
        step("done", { next: "END" }),
      ])
      yield* f.llm.push(
        TestLLM.text("not json", "first"),
        TestLLM.text("still not json", "second"),
        TestLLM.text("Failed", "root"),
      )
      const result = yield* f.wait(runInfo(yield* f.start()).id)
      expect(result.run).toMatchObject({ status: "failed", errorCategory: "max_attempts_exceeded" })
      expect(
        result.steps.filter((item) => item.stepId === "branch").map((item) => [item.attempt, item.status]),
      ).toEqual([
        [1, "failed"],
        [2, "failed"],
      ])
      expect(result.steps.find((item) => item.stepId === "done")?.status).toBe("skipped")
    }),
  ),
)

it.live("times out a child and protects a user-edited Task projection", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("slow", { timeoutSeconds: 1, next: "END" })])
      yield* f.llm.serve((request) =>
        requestText(request).includes("workflow_result")
          ? TestLLM.text("Timeout acknowledged", "root")
          : TestLLM.hangAfter(),
      )
      const admitted = runInfo(yield* f.start())
      yield* awaitWithTimeout(f.llm.wait(1), "Slow child never started", "10 seconds")
      const task = (yield* f.tasks.get(f.created.session.id))[0]
      if (!task) return yield* Effect.die(new Error("Task projection missing"))
      yield* f.tasks.updateTask({
        sessionID: f.created.session.id,
        id: task.id,
        content: "User edited",
        expectedRevision: task.revision,
      })
      const failed = yield* f.wait(admitted.id)
      expect(failed.run?.status).toBe("failed")
      expect(failed.steps[0]?.errorCategory).toBe("step_timeout")
      expect((yield* f.tasks.get(f.created.session.id))[0]).toMatchObject({
        content: "User edited",
        status: "in_progress",
        revision: 2,
      })
    }),
  ),
)

it.live("does not alias different active request IDs and rejects stale step cancellation", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("slow", { next: "END" })])
      yield* f.llm.push(TestLLM.hangAfter())
      const admitted = runInfo(yield* f.start("one"))
      yield* awaitWithTimeout(f.llm.wait(1), "Child did not start", "10 seconds")
      expect(yield* f.start("two").pipe(Effect.flip)).toBeInstanceOf(WorkflowRun.RequestConflictError)
      const run = yield* f.runs.get(admitted.id)
      const current = (yield* f.runs.getSteps(run.id))[0]
      if (!current) return yield* Effect.die(new Error("Missing step"))
      expect(
        yield* f.execution
          .cancelStep({
            sessionID: f.created.session.id,
            runID: run.id,
            stepRunID: current.id,
            expectedRunRevision: run.revision - 1,
            expectedStepRevision: current.revision,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowRun.InvalidStateTransitionError)
      expect((yield* f.runs.getSteps(run.id))[0]).toEqual(current)
      yield* f.llm.push(TestLLM.text("Cancelled", "root"))
      yield* f.execution.cancelStep({
        sessionID: f.created.session.id,
        runID: run.id,
        stepRunID: current.id,
        expectedRunRevision: run.revision,
        expectedStepRevision: current.revision,
      })
      expect((yield* f.terminal()).status).toBe("failed")
    }),
  ),
)

it.live("reconciles a crashed running child without replaying an unknown model call", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const databasePath = path.join(directory, "workflow.sqlite")
      const originalScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
      const definition = [step("slow", { next: "END" })]
      const original = yield* setup(definition, { directory, databasePath, scope: originalScope })
      yield* original.llm.push(TestLLM.hangAfter())
      const admitted = runInfo(yield* original.start())
      yield* awaitWithTimeout(original.llm.wait(1), "Original model call did not begin", "10 seconds")
      yield* Scope.close(originalScope, Exit.void)
      const reopened = yield* setup(definition, { directory, databasePath, sessionID: original.created.session.id })
      const parents = yield* reopened.execution.reconcilePending
      expect((yield* reopened.runs.get(admitted.id)).status).toBe("recovery_required")
      expect((yield* reopened.runs.getSteps(admitted.id))[0]?.status).toBe("execution_unknown")
      expect(parents).toEqual([original.created.session.id])
      expect(yield* reopened.llm.requests()).toEqual([])
      const pending = yield* reopened.sessions.inbox(original.created.session.id)
      expect(pending.length).toBe(1)
      expect(yield* reopened.execution.reconcilePending).toEqual([original.created.session.id])
      expect(yield* reopened.sessions.inbox(original.created.session.id)).toEqual(pending)
    }),
  ),
)

it.live("isolates Workflow conflicts and preserves user interruption after Delegation recovery", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const databasePath = path.join(directory, "multidomain.sqlite")
      const originalScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
      const definition = [step("A", { next: "END" })]
      const original = yield* setup(definition, {
        directory,
        databasePath,
        scope: originalScope,
      })
      const workflow = original.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing recovery Workflow"))
      const staleDigest = Hash.sha256(Buffer.from("stale multidomain Workflow snapshot"))
      expect(staleDigest).not.toBe(original.created.snapshot.digest)
      const admitted = yield* original.runs.getOrCreate({
        sessionID: original.created.session.id,
        workflow,
        snapshotDigest: staleDigest,
        requestID: "multidomain-recovery",
      })
      const bus = Context.get(original.context, Bus.Service)
      const store = Context.get(original.context, SessionStore.Service)
      const delegations = Context.get(original.context, DelegationService.Service)
      const parent = yield* seedLegacyRecoveryParent(
        original.sessions,
        bus,
        original.created.session,
        "Delegation recovery parent",
      )
      // Keep the reconciled Task notice pending so only the claimed Coding root calls the model substitute.
      yield* bus.publish(SessionEvent.Synthetic, { sessionID: parent.id, text: "Staged recovery boundary" })
      const boundary = (yield* original.sessions.context(parent.id)).find((message) => message.type === "synthetic")
      if (!boundary) return yield* Effect.die(new Error("Missing Delegation recovery boundary"))
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: parent.id,
        revert: { messageID: boundary.id, files: [] },
      })
      const task = (yield* original.tasks.append({
        sessionID: parent.id,
        tasks: [{ content: "Reconcile this retained Task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!task) return yield* Effect.die(new Error("Missing recovery Task"))
      const worker = Agent.ID.make("coder")
      const child = yield* original.sessions.create({ parentID: parent.id, agent: worker, title: "Retained child" })
      const delegation = yield* delegations.create({ parentSessionID: parent.id, title: "Mixed recovery" })
      const participant = yield* delegations.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: worker,
        role: "implementer",
        context: "fresh",
        childSessionID: child.id,
      })
      const turn = yield* delegations.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
      })
      const state = yield* delegations.foldState(delegation.id)
      const delivery = [...(state?.deliveries.values() ?? [])].find((entry) => entry.turnID === turn.id)
      if (!delivery) return yield* Effect.die(new Error("Missing recovery delivery"))
      const receipt = {
        delegationID: delegation.id,
        ...delivery,
        childSessionID: child.id,
        inputID: DelegationExecution.inputID(delegation.id, delivery),
      }
      yield* original.sessions.prompt({
        sessionID: child.id,
        id: receipt.inputID,
        text: "Retain this Task for cold reconciliation",
        delivery: "queue",
        resume: false,
        metadata: {
          delegation: receipt,
          task: {
            parentTaskID: task.id,
            parentTaskRevision: task.revision,
            description: "Mixed recovery",
            background: true,
          },
        },
      })
      yield* store.claim(child.id)
      yield* store.countResume(child.id)
      yield* store.countResume(child.id)
      const background = yield* original.jobs.start({
        id: `delegation:${participant.id}`,
        type: "delegation",
        notificationID: SessionMessage.ID.create(),
        recovery: {
          kind: "delegation",
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
          parentSessionID: parent.id,
          description: "Mixed recovery",
        },
        run: Effect.succeed("Retained Job outcome awaiting reconciliation"),
      })
      yield* original.jobs.wait({ id: background.id })
      yield* original.jobs.background(background.id)
      const root = yield* original.sessions.create({
        location: original.created.session.location,
        title: "Claimed Coding root",
      })
      expect(root.mode).toBe("coding")
      yield* original.sessions.prompt({ sessionID: root.id, text: "Recover this Coding root", resume: false })
      yield* store.claim(root.id)
      yield* store.countResume(root.id)
      yield* store.countResume(root.id)
      const claim = (database: Database.Interface, sessionID: Session.ID) =>
        database.db
          .select({ suspended: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
      const checkpoint = (fixture: typeof original) =>
        Effect.all({
          workflow: fixture.runs.get(admitted.id),
          steps: fixture.runs.getSteps(admitted.id),
          workflowInbox: fixture.sessions.inbox(original.created.session.id),
          delegation: Context.get(fixture.context, DelegationService.Service).foldState(delegation.id),
          tasks: fixture.tasks.get(parent.id),
          notice: fixture.sessions.inbox(parent.id),
          background: fixture.jobs.pendingBackground,
          child: claim(Context.get(fixture.context, Database.Service), child.id),
          root: claim(Context.get(fixture.context, Database.Service), root.id),
          rootHistory: fixture.sessions.context(root.id),
          rootEvents: Context.get(fixture.context, Bus.Service)
            .log({ aggregateID: root.id })
            .pipe(
              Stream.filter((event) => !Bus.isSynced(event)),
              Stream.runCollect,
            ),
        })
      const before = yield* checkpoint(original)
      if (before.root === undefined || before.root.suspended === null)
        return yield* Effect.die(new Error("Missing claimed Coding root"))
      expect(before.workflow.status).toBe("pending")
      expect(before.steps).toMatchObject([{ status: "ready" }])
      expect(before.background).toMatchObject([{ status: "completed", recovery: { kind: "delegation" } }])
      expect(before.child).toMatchObject({ suspended: expect.any(Number), attempts: 2 })
      expect(before.root).toMatchObject({ suspended: expect.any(Number), attempts: 2 })
      expect(yield* original.llm.requests()).toEqual([])
      yield* Scope.close(originalScope, Exit.void)

      const reopenedScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(reopenedScope, Exit.void))
      const reopened = yield* setup(definition, {
        directory,
        databasePath,
        sessionID: original.created.session.id,
        scope: reopenedScope,
      })
      expect(yield* checkpoint(reopened)).toEqual(before)
      const conflict = yield* reopened.execution
        .resume({ sessionID: original.created.session.id, runID: admitted.id })
        .pipe(Effect.flip)
      expect(conflict).toBeInstanceOf(WorkflowExecution.ConflictError)
      expect(conflict).toMatchObject({ reason: "workflow_snapshot_conflict" })
      expect(yield* checkpoint(reopened)).toEqual(before)
      const restart = Context.get(reopened.context, SessionRestart.Service)
      const execution = Context.get(reopened.context, SessionExecution.Service)
      // The fixture's TestLLM/resolver substitutes the model boundary; recovery owners and the Session runner are real.
      const gate = yield* reopened.llm.gate()
      yield* reopened.llm.push(TestLLM.hangAfter())
      yield* restart.resumeSuspendedSessions
      yield* awaitWithTimeout(
        gate.started,
        "Claimed Coding root did not start after the Workflow conflict",
        "10 seconds",
      )
      const reconciled = yield* checkpoint(reopened)
      expect(reconciled.workflow).toEqual(before.workflow)
      expect(reconciled.steps).toEqual(before.steps)
      expect(reconciled.workflowInbox).toEqual(before.workflowInbox)
      // Reconciliation succeeded; the unexecuted child Task remains failed/recovery_required.
      expect([...(reconciled.delegation?.deliveries.values() ?? [])]).toMatchObject([
        { status: "recovery_required", errorCode: "session_input_unverified" },
      ])
      expect(reconciled.tasks).toMatchObject([{ id: task.id, status: "failed", revision: task.revision + 1 }])
      expect(reconciled.child).toEqual({ suspended: null, attempts: 0 })
      expect(reconciled.background).toEqual([])
      expect(reconciled.notice).toMatchObject([
        { payload: { metadata: { source: "task", state: "recovery_required" } } },
      ])
      expect(reconciled.root).toEqual({ suspended: before.root.suspended, attempts: 3 })
      expect(yield* execution.isActive(root.id)).toBe(true)
      const requests = yield* reopened.llm.requests()
      expect(requests).toHaveLength(1)
      const request = requests.at(0)
      if (!request) return yield* Effect.die(new Error("Missing recovered Coding root request"))
      expect(requestText(request)).toContain("Recover this Coding root")
      expect(yield* execution.interrupt(root.id, { reason: "user", resume: false, awaitSettlement: true })).toBe(true)
      yield* awaitWithTimeout(
        execution.awaitIdle(root.id),
        "User interruption did not settle the recovered root",
        "10 seconds",
      )
      const stopped = yield* checkpoint(reopened)
      expect(stopped.root).toEqual({ suspended: null, attempts: 0 })
      expect(stopped.rootEvents.find((event) => event.type === SessionEvent.Execution.Interrupted.type)).toMatchObject({
        data: { sessionID: root.id, reason: "user" },
      })
      yield* restart.resumeSuspendedSessions
      expect(yield* checkpoint(reopened)).toEqual(stopped)
      expect(yield* reopened.llm.requests()).toEqual(requests)
      yield* Scope.close(reopenedScope, Exit.void)

      const cold = yield* setup(definition, {
        directory,
        databasePath,
        sessionID: original.created.session.id,
      })
      yield* Context.get(cold.context, SessionRestart.Service).resumeSuspendedSessions
      expect(yield* checkpoint(cold)).toEqual(stopped)
      expect(yield* cold.llm.requests()).toEqual([])
    }),
  ),
)

it.live("isolates Delegation Task marker failure while a healthy Workflow completes after restart", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const databasePath = path.join(directory, "reverse-multidomain.sqlite")
      const originalScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
      const definition = [step("healthy", { next: "END" })]
      const original = yield* setup(definition, { directory, databasePath, scope: originalScope })
      const workflow = original.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing healthy recovery Workflow"))
      const admitted = yield* original.runs.getOrCreate({
        sessionID: original.created.session.id,
        workflow,
        snapshotDigest: original.created.snapshot.digest,
        requestID: "reverse-multidomain-recovery",
      })
      const database = Context.get(original.context, Database.Service)
      const bus = Context.get(original.context, Bus.Service)
      const store = Context.get(original.context, SessionStore.Service)
      const delegations = Context.get(original.context, DelegationService.Service)
      const parent = yield* seedLegacyRecoveryParent(
        original.sessions,
        bus,
        original.created.session,
        "Deferred Delegation Task parent",
      )
      expect(parent.mode).toBe("coding")
      // Task recovery may admit a notice, but this parent must leave it pending rather than call the model.
      yield* bus.publish(SessionEvent.Synthetic, { sessionID: parent.id, text: "Deferred Task notice boundary" })
      const boundary = (yield* original.sessions.context(parent.id)).find((message) => message.type === "synthetic")
      if (!boundary) return yield* Effect.die(new Error("Missing deferred Task notice boundary"))
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: parent.id,
        revert: { messageID: boundary.id, files: [] },
      })
      const task = (yield* original.tasks.append({
        sessionID: parent.id,
        tasks: [{ content: "Retain this failed writeback", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!task) return yield* Effect.die(new Error("Missing deferred Delegation Task"))
      const child = yield* original.sessions.create({
        parentID: parent.id,
        agent: Agent.ID.make("coder"),
        title: "Queued child awaiting Task writeback",
      })
      const delegation = yield* delegations.create({ parentSessionID: parent.id, title: "Deferred Task recovery" })
      const participant = yield* delegations.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "coder",
        role: "implementer",
        context: "fresh",
        childSessionID: child.id,
      })
      const turn = yield* delegations.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
      })
      const state = yield* delegations.foldState(delegation.id)
      const delivery = [...(state?.deliveries.values() ?? [])].find((entry) => entry.turnID === turn.id)
      if (!delivery) return yield* Effect.die(new Error("Missing deferred Delegation delivery"))
      const receipt = {
        delegationID: delegation.id,
        ...delivery,
        childSessionID: child.id,
        inputID: DelegationExecution.inputID(delegation.id, delivery),
      }
      yield* original.sessions.prompt({
        sessionID: child.id,
        id: receipt.inputID,
        text: "Keep this queued child unexecuted while Task writeback fails",
        delivery: "queue",
        resume: false,
        metadata: {
          delegation: receipt,
          task: {
            parentTaskID: task.id,
            parentTaskRevision: task.revision,
            description: "Deferred Task recovery",
            background: true,
          },
        },
      })
      yield* store.claim(child.id)
      yield* store.countResume(child.id)
      yield* store.countResume(child.id)
      const recovery = {
        kind: "delegation" as const,
        delegationID: delegation.id,
        participantID: participant.id,
        childSessionID: child.id,
        parentSessionID: parent.id,
        description: "Deferred Task recovery",
      }
      const background = yield* original.jobs.start({
        id: `delegation:${participant.id}`,
        type: "delegation",
        notificationID: SessionMessage.ID.create(),
        recovery,
        run: Effect.succeed("Completed marker awaiting Task writeback"),
      })
      yield* original.jobs.wait({ id: background.id })
      yield* original.jobs.background(background.id)
      // Persist the selective fault across all three database owners; the notification hash stays opaque.
      yield* database.db
        .run(sql`CREATE TABLE blocked_recovery_task (task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)`)
        .pipe(Effect.orDie)
      yield* database.db
        .run(sql`INSERT INTO blocked_recovery_task (task_id, revision) VALUES (${task.id}, ${task.revision})`)
        .pipe(Effect.orDie)
      yield* database.db
        .run(
          sql`
          CREATE TRIGGER fail_recovery_task_marker BEFORE INSERT ON kv
          WHEN NEW.key LIKE 'delegation:task-settlement:%' AND EXISTS (
            SELECT 1 FROM task JOIN blocked_recovery_task ON task.id = blocked_recovery_task.task_id
            WHERE task.revision > blocked_recovery_task.revision
          )
          BEGIN SELECT RAISE(ABORT, 'Delegation Task marker failure'); END
        `,
        )
        .pipe(Effect.orDie)
      const checkpoint = (fixture: typeof original) =>
        Effect.all({
          fault: Effect.all({
            delegation: Context.get(fixture.context, DelegationService.Service).foldState(delegation.id),
            tasks: fixture.tasks.get(parent.id),
            input: fixture.sessions.inbox(child.id),
            result: SessionInputResult.read(Context.get(fixture.context, Database.Service).db, {
              sessionID: child.id,
              inputID: receipt.inputID,
            }),
            notice: fixture.sessions.inbox(parent.id),
            background: fixture.jobs.pendingBackground,
            child: Context.get(fixture.context, Database.Service)
              .db.select({ suspended: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
              .from(SessionTable)
              .where(eq(SessionTable.id, child.id))
              .get()
              .pipe(Effect.orDie),
            settlements: Context.get(fixture.context, KV.Service).scan({ prefix: "delegation:task-settlement:" }),
          }),
          healthy: Effect.all({
            run: fixture.runs.get(admitted.id),
            steps: fixture.runs.getSteps(admitted.id),
            tasks: fixture.tasks.get(original.created.session.id),
            history: fixture.sessions.context(original.created.session.id),
          }),
        })
      const before = yield* checkpoint(original)
      expect(before.healthy.run).toMatchObject({ status: "pending", snapshotDigest: original.created.snapshot.digest })
      expect(before.healthy.steps).toMatchObject([{ stepId: "healthy", status: "ready" }])
      expect(before.fault.child).toMatchObject({ suspended: expect.any(Number), attempts: 2 })
      expect(before.fault.tasks).toEqual([task])
      expect(before.fault.input).toMatchObject([{ id: receipt.inputID, delivery: "queue" }])
      expect(before.fault.result.status).toBe("pending")
      expect(before.fault.background).toMatchObject([{ status: "completed", recovery: { childSessionID: child.id } }])
      expect(before.fault.settlements.entries).toEqual([])
      expect(yield* original.llm.requests()).toEqual([])
      yield* Scope.close(originalScope, Exit.void)

      const reopenedScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(reopenedScope, Exit.void))
      const reopened = yield* setup(definition, {
        directory,
        databasePath,
        sessionID: original.created.session.id,
        scope: reopenedScope,
      })
      expect(yield* checkpoint(reopened)).toEqual(before)
      const restart = Context.get(reopened.context, SessionRestart.Service)
      const execution = Context.get(reopened.context, SessionExecution.Service)
      const gate = yield* reopened.llm.gate()
      yield* reopened.llm.push(
        TestLLM.text("Healthy Workflow step completed", "healthy-step"),
        TestLLM.text("Healthy Workflow handoff completed", "healthy-root"),
      )
      // Hold the actual healthy stream until the same Restart sweep has accounted for the writeback fault.
      yield* restart.resumeSuspendedSessions
      yield* awaitWithTimeout(
        gate.started,
        "Healthy Workflow did not start beside the deferred Delegation",
        "10 seconds",
      )
      const deferred = yield* checkpoint(reopened)
      expect(deferred.fault.child).toEqual(before.fault.child)
      expect(deferred.fault.tasks).toEqual(before.fault.tasks)
      expect(deferred.fault.input).toEqual(before.fault.input)
      expect(deferred.fault.result).toEqual(before.fault.result)
      expect(deferred.fault.background).toEqual(before.fault.background)
      expect(deferred.fault.notice).toEqual([])
      expect(deferred.fault.settlements.entries).toEqual([])
      expect([...(deferred.fault.delegation?.deliveries.values() ?? [])]).toMatchObject([
        { status: "recovery_required", errorCode: "session_input_unverified" },
      ])
      expect(yield* execution.isActive(child.id)).toBe(false)
      expect(yield* Context.get(reopened.context, DelegationExecution.Service).recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [child.id],
        scanAvailable: true,
      })
      expect((yield* checkpoint(reopened)).fault).toEqual(deferred.fault)
      const running = deferred.healthy.steps[0]
      if (!running?.childSessionId) return yield* Effect.die(new Error("Missing real healthy Workflow child"))
      expect(running).toMatchObject({ stepId: "healthy", status: "running" })
      const healthyChild = yield* reopened.sessions.get(Session.ID.make(running.childSessionId))
      const healthyInputID = healthyChild.metadata?.workflowInputID
      if (typeof healthyInputID !== "string")
        return yield* Effect.die(new Error("Missing exact healthy Workflow input"))
      expect(healthyChild).toMatchObject({ mode: "custom", parentID: original.created.session.id })
      expect(
        yield* SessionInputResult.read(Context.get(reopened.context, Database.Service).db, {
          sessionID: healthyChild.id,
          inputID: SessionMessage.ID.make(healthyInputID),
        }),
      ).toMatchObject({ status: "processing" })
      const started = yield* reopened.llm.requests()
      expect(started).toHaveLength(1)
      expect(requestText(started[0]!)).toContain('"step":"healthy"')
      yield* restart.resumeSuspendedSessions
      expect((yield* checkpoint(reopened)).fault).toEqual(deferred.fault)
      expect(yield* reopened.llm.requests()).toEqual(started)
      yield* gate.release

      const completed = yield* reopened.wait(admitted.id)
      expect(completed.run?.status).toBe("completed")
      expect(completed.steps).toMatchObject([{ id: running.id, status: "completed", attempt: 1 }])
      yield* awaitWithTimeout(reopened.llm.wait(2), "Healthy Workflow handoff did not reach its root", "10 seconds")
      yield* awaitWithTimeout(
        execution.awaitIdle(original.created.session.id),
        "Healthy root handoff did not complete",
        "10 seconds",
      )
      expect(
        yield* SessionInputResult.read(Context.get(reopened.context, Database.Service).db, {
          sessionID: healthyChild.id,
          inputID: SessionMessage.ID.make(healthyInputID),
        }),
      ).toMatchObject({
        status: "completed",
        assistant: { content: [{ type: "text", text: "Healthy Workflow step completed" }] },
      })
      const settled = yield* checkpoint(reopened)
      expect(settled.healthy.tasks).toMatchObject([{ id: running.taskId, status: "completed", revision: 2 }])
      const handoff = settled.healthy.history.find(
        (message) =>
          message.type === "synthetic" &&
          message.metadata?.source === "workflow_result" &&
          message.metadata.workflowRunID === admitted.id,
      )
      if (!handoff) return yield* Effect.die(new Error("Missing actual healthy root handoff"))
      expect(
        yield* SessionInputResult.read(Context.get(reopened.context, Database.Service).db, {
          sessionID: original.created.session.id,
          inputID: handoff.id,
        }),
      ).toMatchObject({
        status: "completed",
        assistant: { content: [{ type: "text", text: "Healthy Workflow handoff completed" }] },
      })
      expect(settled.fault).toEqual(deferred.fault)
      const requests = yield* reopened.llm.requests()
      expect(requests).toHaveLength(2)
      expect(requestText(requests[1]!)).toContain("workflow_result")
      expect(yield* reopened.sessions.inbox(original.created.session.id)).toEqual([])
      yield* restart.resumeSuspendedSessions
      expect(yield* checkpoint(reopened)).toEqual(settled)
      expect(yield* reopened.llm.requests()).toEqual(requests)
      yield* Scope.close(reopenedScope, Exit.void)

      const cold = yield* setup(definition, {
        directory,
        databasePath,
        sessionID: original.created.session.id,
      })
      const coldRestart = Context.get(cold.context, SessionRestart.Service)
      const coldRecovery = Context.get(cold.context, DelegationExecution.Service)
      expect(yield* checkpoint(cold)).toEqual(settled)
      yield* coldRestart.resumeSuspendedSessions
      expect(yield* coldRecovery.recoverPending).toMatchObject({ deferredChildren: [child.id], scanAvailable: true })
      expect(yield* checkpoint(cold)).toEqual(settled)
      expect(yield* cold.llm.requests()).toEqual([])
      yield* Context.get(cold.context, Database.Service)
        .db.run(sql`DROP TRIGGER fail_recovery_task_marker`)
        .pipe(Effect.orDie)
      yield* coldRestart.resumeSuspendedSessions
      const reconciled = yield* checkpoint(cold)
      expect(reconciled.healthy).toEqual(settled.healthy)
      expect(reconciled.fault.child).toEqual({ suspended: null, attempts: 0 })
      expect(reconciled.fault.tasks).toMatchObject([{ id: task.id, status: "failed", revision: task.revision + 1 }])
      expect(reconciled.fault.delegation).toEqual(settled.fault.delegation)
      expect(reconciled.fault.input).toEqual(before.fault.input)
      expect(reconciled.fault.result.status).toBe("pending")
      expect(reconciled.fault.background).toEqual([])
      expect(reconciled.fault.settlements.entries).toHaveLength(1)
      expect(reconciled.fault.notice).toMatchObject([
        {
          payload: {
            metadata: {
              source: "task",
              parentTaskID: task.id,
              inputID: receipt.inputID,
              state: "recovery_required",
            },
          },
        },
      ])
      expect(yield* coldRecovery.recover(recovery)).toMatchObject({ status: "reconciled", childSessionID: child.id })
      expect(yield* coldRecovery.recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [],
        scanAvailable: true,
      })
      yield* coldRestart.resumeSuspendedSessions
      expect(yield* checkpoint(cold)).toEqual(reconciled)
      expect(yield* Context.get(cold.context, SessionExecution.Service).isActive(child.id)).toBe(false)
      expect(yield* cold.llm.requests()).toEqual([])
      yield* Context.get(cold.context, Database.Service)
        .db.run(sql`DROP TABLE blocked_recovery_task`)
        .pipe(Effect.orDie)
    }),
  ),
)

for (const boundary of ["run", "scan"] as const) {
  for (const mixed of [false, true]) {
    it.live(
      `preserves ${mixed ? (boundary === "run" ? "typed failure plus interruption" : "defect plus interruption") : "pure interruption"} forwarded by WorkflowRun.${boundary === "run" ? "get" : "listForRecovery"} before later recovery domains`,
      () =>
        withCustomMode(
          "true",
          Effect.gen(function* () {
            const directory = (yield* tmpdirScoped()).path
            const databasePath = path.join(directory, "forwarded-recovery.sqlite")
            const originalScope = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
            const definition = [step("A", { next: "END" })]
            const original = yield* setup(definition, { directory, databasePath, scope: originalScope })
            const workflow = original.created.snapshot.data.workflow
            if (!workflow) return yield* Effect.die(new Error("Missing forwarded recovery Workflow"))
            const admitted = yield* original.runs.getOrCreate({
              sessionID: original.created.session.id,
              workflow,
              snapshotDigest: original.created.snapshot.digest,
              requestID: "forwarded-recovery",
            })
            // A terminal seed reaches the per-run get without earlier step recovery or its orDie boundaries.
            yield* original.runs.failRun(admitted.id)
            expect((yield* original.runs.listForRecovery).map((run) => run.id)).toContain(admitted.id)
            const typedError = yield* original.runs
              .get(WorkflowAsset.WorkflowRunID.make("run_missing_forwarded_recovery"))
              .pipe(Effect.flip)
            expect(typedError).toBeInstanceOf(WorkflowRun.WorkflowNotFoundError)
            const store = Context.get(original.context, SessionStore.Service)
            const delegations = Context.get(original.context, DelegationService.Service)
            const parent = yield* seedLegacyRecoveryParent(
              original.sessions,
              Context.get(original.context, Bus.Service),
              original.created.session,
              "Later Delegation recovery parent",
            )
            const child = yield* original.sessions.create({
              parentID: parent.id,
              agent: Agent.ID.make("coder"),
              title: "Later retained child",
            })
            const delegation = yield* delegations.create({ parentSessionID: parent.id, title: "Later recovery" })
            const participant = yield* delegations.addParticipant({
              delegationID: delegation.id,
              provider: "internal",
              target: "coder",
              role: "implementer",
              context: "fresh",
              childSessionID: child.id,
            })
            const turn = yield* delegations.appendTurn({
              delegationID: delegation.id,
              kind: "task",
              delivery: "queue",
              participantIDs: [participant.id],
              origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
            })
            const state = yield* delegations.foldState(delegation.id)
            const delivery = [...(state?.deliveries.values() ?? [])].find((entry) => entry.turnID === turn.id)
            if (!delivery) return yield* Effect.die(new Error("Missing later recovery delivery"))
            yield* original.sessions.prompt({
              sessionID: child.id,
              id: DelegationExecution.inputID(delegation.id, delivery),
              text: "Keep later Delegation work untouched by forwarded interruption",
              delivery: "queue",
              resume: false,
              metadata: { delegation: { delegationID: delegation.id, ...delivery } },
            })
            const background = yield* original.jobs.start({
              id: `delegation:${participant.id}`,
              type: "delegation",
              notificationID: SessionMessage.ID.create(),
              recovery: {
                kind: "delegation",
                delegationID: delegation.id,
                participantID: participant.id,
                childSessionID: child.id,
                parentSessionID: parent.id,
                description: "Later recovery",
              },
              run: Effect.succeed("Retained marker awaiting later recovery"),
            })
            yield* original.jobs.wait({ id: background.id })
            yield* original.jobs.background(background.id)
            const root = yield* original.sessions.create({
              location: original.created.session.location,
              title: "Later claimed Coding root",
            })
            expect(root.mode).toBe("coding")
            yield* original.sessions.prompt({ sessionID: root.id, text: "Keep this later root parked", resume: false })
            yield* Effect.forEach([child.id, root.id], store.claim, { discard: true })
            yield* store.countResume(child.id)
            yield* store.countResume(child.id)
            yield* store.countResume(root.id)
            yield* store.countResume(root.id)
            const checkpoint = (fixture: typeof original) =>
              Effect.all({
                workflow: fixture.runs.getBySession(original.created.session.id),
                steps: fixture.runs.getSteps(admitted.id),
                workflowInbox: fixture.sessions.inbox(original.created.session.id),
                delegation: Context.get(fixture.context, DelegationService.Service).foldState(delegation.id),
                childInbox: fixture.sessions.inbox(child.id),
                background: fixture.jobs.pendingBackground,
                claims: Context.get(fixture.context, Database.Service)
                  .db.select({
                    id: SessionTable.id,
                    suspended: SessionTable.time_suspended,
                    attempts: SessionTable.resume_attempts,
                  })
                  .from(SessionTable)
                  .orderBy(SessionTable.id)
                  .all()
                  .pipe(Effect.orDie),
                rootHistory: fixture.sessions.context(root.id),
              })
            const before = yield* checkpoint(original)
            expect(before.workflow).toMatchObject({
              status: "failed",
              snapshotDigest: original.created.snapshot.digest,
            })
            expect(before.background).toMatchObject([{ status: "completed" }])
            expect(before.claims.find((row) => row.id === child.id)).toMatchObject({
              suspended: expect.any(Number),
              attempts: 2,
            })
            expect(before.claims.find((row) => row.id === root.id)).toMatchObject({
              suspended: expect.any(Number),
              attempts: 2,
            })
            yield* Scope.close(originalScope, Exit.void)
            const forwarded: string[] = []
            const interruptions = Cause.combine(Cause.interrupt(101), Cause.interrupt(102))
            // These are lower-owner Cause forwarding tests, not user-stop or actual database failure tests.
            const forwardRecoveryCause: ForwardedRecoveryCause =
              boundary === "run"
                ? {
                    boundary,
                    runID: admitted.id,
                    cause: mixed ? Cause.combine(Cause.fail(typedError), interruptions) : interruptions,
                    forwarded,
                  }
                : {
                    boundary,
                    cause: mixed ? Cause.combine(Cause.die(typedError), interruptions) : interruptions,
                    forwarded,
                  }
            const reopened = yield* setup(definition, {
              directory,
              databasePath,
              sessionID: original.created.session.id,
              forwardRecoveryCause,
            })
            expect(yield* checkpoint(reopened)).toEqual(before)
            const direct = yield* reopened.execution.reconcilePending.pipe(Effect.exit)
            expect(forwarded).toEqual([boundary])
            expect(yield* checkpoint(reopened)).toEqual(before)
            expect(yield* reopened.llm.requests()).toEqual([])
            expect(Exit.isFailure(direct)).toBe(true)
            if (Exit.isFailure(direct)) {
              expect(Cause.hasInterrupts(direct.cause)).toBe(true)
              expect(direct.cause.reasons.filter(Cause.isInterruptReason).map((reason) => reason.fiberId)).toEqual([
                101, 102,
              ])
              expect(direct.cause.reasons).toHaveLength(mixed ? 3 : 2)
              expect(Cause.hasFails(direct.cause)).toBe(mixed && boundary === "run")
              expect(Cause.hasDies(direct.cause)).toBe(mixed && boundary === "scan")
              if (mixed && boundary === "run")
                expect(direct.cause.reasons.find(Cause.isFailReason)?.error).toBe(typedError)
              if (mixed && boundary === "scan")
                expect(direct.cause.reasons.find(Cause.isDieReason)?.defect).toBe(typedError)
            }
            // A preserved typed per-run Cause must also survive Restart's outer recovery boundary.
            yield* reopened.llm.push(TestLLM.hangAfter())
            const sweep = yield* Context.get(reopened.context, SessionRestart.Service).resumeSuspendedSessions.pipe(
              Effect.exit,
            )
            expect(forwarded).toEqual([boundary, boundary])
            expect(Exit.isFailure(sweep)).toBe(true)
            if (Exit.isFailure(sweep)) {
              expect(Cause.hasInterrupts(sweep.cause)).toBe(true)
              expect(sweep.cause.reasons.filter(Cause.isInterruptReason).map((reason) => reason.fiberId)).toEqual([
                101, 102,
              ])
              expect(sweep.cause.reasons).toHaveLength(mixed ? 3 : 2)
              // Restart's never-error boundary may map Fail to Die while retaining the same error object.
              expect(Cause.hasFails(sweep.cause)).toBe(false)
              expect(Cause.hasDies(sweep.cause)).toBe(mixed)
              if (mixed) expect(sweep.cause.reasons.find(Cause.isDieReason)?.defect).toBe(typedError)
            }
            expect(yield* checkpoint(reopened)).toEqual(before)
            expect(yield* Context.get(reopened.context, SessionExecution.Service).isActive(root.id)).toBe(false)
            expect(yield* reopened.llm.requests()).toEqual([])
          }),
        ),
    )
  }
}

it.live("resumes a durable pending admission left before its advisory wake", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })])
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const admitted = yield* f.runs.getOrCreate({
        sessionID: f.created.session.id,
        workflow,
        snapshotDigest: f.created.snapshot.digest,
        requestID: "before-wake",
      })
      yield* f.llm.push(TestLLM.text("A complete", "a"), TestLLM.text("Root complete", "root"))
      yield* f.execution.reconcilePending
      expect((yield* f.wait(admitted.id)).run?.status).toBe("completed")
      yield* awaitWithTimeout(f.llm.wait(2), "Recovered handoff was not executed", "10 seconds")
    }),
  ),
)

it.live("root deletion rejects restarting cancelled Workflow Jobs before the run FK cascade", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const pauseDeletion = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      }
      const f = yield* setup([step("slow", { next: "END" })], { pauseDeletion })
      yield* f.llm.push(TestLLM.hangAfter())
      const admitted = runInfo(yield* f.start())
      yield* awaitWithTimeout(f.llm.wait(1), "Child did not start", "10 seconds")
      const removal = yield* f.sessions.remove(f.created.session.id).pipe(Effect.forkIn(yield* Scope.Scope))
      yield* awaitWithTimeout(
        Deferred.await(pauseDeletion.entered),
        "Running Workflow deletion did not reach its transport boundary",
        "10 seconds",
      )
      expect((yield* f.jobs.get(`workflow/${admitted.id}`))?.status).toBe("cancelled")
      const before = yield* f.runs.get(admitted.id)
      const steps = yield* f.runs.getSteps(admitted.id)
      expect(yield* f.start().pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowExecution.ConflictError",
        reason: "workflow_session_deleting",
      })
      expect(yield* f.runs.get(admitted.id)).toEqual(before)
      expect(yield* f.runs.getSteps(admitted.id)).toEqual(steps)
      expect((yield* f.llm.requests()).length).toBe(1)
      yield* Deferred.succeed(pauseDeletion.release, undefined)
      yield* awaitWithTimeout(Fiber.join(removal), "Running Workflow deletion did not finish", "10 seconds")
      expect(yield* f.runs.get(admitted.id).pipe(Effect.flip)).toBeInstanceOf(WorkflowRun.WorkflowNotFoundError)
      expect((yield* f.jobs.get(`workflow/${admitted.id}`))?.status).toBe("cancelled")
      expect((yield* f.llm.requests()).length).toBe(1)
    }),
  ),
)

it.live("guards pending admission and resume while allowing cancellation under the deletion lease", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const pauseDeletion = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      }
      const f = yield* setup([step("A", { next: "END" })], { pauseDeletion })
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const admitted = yield* f.runs.getOrCreate({
        sessionID: f.created.session.id,
        workflow,
        snapshotDigest: f.created.snapshot.digest,
        requestID: "delete-before-wake",
      })
      const before = yield* f.runs.getSteps(admitted.id)
      const removal = yield* f.sessions.remove(f.created.session.id).pipe(Effect.forkIn(yield* Scope.Scope))
      yield* awaitWithTimeout(
        Deferred.await(pauseDeletion.entered),
        "Session deletion did not reach its transport boundary",
        "10 seconds",
      )
      expect(yield* f.jobs.isDeletingSession(f.created.session.id)).toBe(true)
      expect((yield* f.sessions.get(f.created.session.id)).id).toBe(f.created.session.id)
      expect(yield* f.start("delete-before-wake").pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowExecution.ConflictError",
        reason: "workflow_session_deleting",
      })
      expect(
        yield* f.execution.resume({ sessionID: f.created.session.id, runID: admitted.id }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowExecution.ConflictError", reason: "workflow_session_deleting" })
      expect(yield* f.execution.reconcilePending).toEqual([])
      expect(yield* f.runs.get(admitted.id)).toEqual(admitted)
      expect(yield* f.runs.getSteps(admitted.id)).toEqual(before)
      expect((yield* f.sessions.list({ parentID: f.created.session.id })).data).toEqual([])
      expect(yield* f.jobs.get(`workflow/${admitted.id}`)).toBeUndefined()
      expect(yield* f.llm.requests()).toEqual([])
      expect(
        (yield* f.execution.cancelRun({
          sessionID: f.created.session.id,
          runID: admitted.id,
          expectedRunRevision: admitted.revision,
        })).run?.status,
      ).toBe("cancelled")
      expect(yield* f.sessions.inbox(f.created.session.id)).toEqual([])
      expect(yield* f.llm.requests()).toEqual([])
      yield* Deferred.succeed(pauseDeletion.release, undefined)
      yield* awaitWithTimeout(Fiber.join(removal), "Session deletion did not finish", "10 seconds")
      expect(yield* f.jobs.isDeletingSession(f.created.session.id)).toBe(false)
      expect(yield* f.runs.get(admitted.id).pipe(Effect.flip)).toBeInstanceOf(WorkflowRun.WorkflowNotFoundError)
      expect(yield* f.jobs.get(`workflow/${admitted.id}`)).toBeUndefined()
      expect(yield* f.llm.requests()).toEqual([])
    }),
  ),
)

it.live("child deletion cancels its step Job and settles the owning Workflow", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("slow", { next: "END" })])
      yield* f.llm.push(TestLLM.hangAfter())
      const admitted = runInfo(yield* f.start())
      yield* awaitWithTimeout(f.llm.wait(1), "Child did not start", "10 seconds")
      const current = (yield* f.runs.getSteps(admitted.id))[0]
      if (!current?.childSessionId) return yield* Effect.die(new Error("Missing child"))
      yield* f.llm.push(TestLLM.text("Deleted child acknowledged", "root"))
      yield* f.sessions.remove(Session.ID.make(current.childSessionId))
      expect((yield* f.terminal()).status).toBe("failed")
      expect((yield* f.runs.getSteps(admitted.id))[0]?.status).toBe("cancelled")
    }),
  ),
)

for (const sibling of ["deleted", "completed"] as const) {
  it.live(`serializes an internal child cancellation with a ${sibling} parallel sibling`, () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const entered = yield* Deferred.make<CancelStepInput>()
        const release = yield* Deferred.make<void>()
        const completeRight = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<WorkflowAsset.StepRunID>()
        const releaseInterrupted = yield* Deferred.make<void>()
        const scope = yield* Scope.Scope
        const f = yield* setup(
          [
            step("entry", { parallel: ["left", "right"] }),
            step("left", { next: "END" }),
            step("right", { next: "END" }),
          ],
          {
            pauseBeforeCancel: { entered, release },
            pauseInterruptedSettlement: { entered: interrupted, release: releaseInterrupted },
          },
        )
        yield* f.llm.serve((request) => {
          const text = requestText(request)
          if (text.includes('"step":"entry"')) return TestLLM.text("Ready", "entry")
          if (text.includes("workflow_result")) return TestLLM.text("Cancellation acknowledged", "root")
          if (sibling === "completed" && text.includes('"step":"right"'))
            return Stream.fromEffect(Deferred.await(completeRight)).pipe(
              Stream.flatMap(() => Stream.fromIterable(TestLLM.text("Right completed", "right"))),
            )
          return TestLLM.hangAfter()
        })
        const admission = yield* f.start()
        const admitted = runInfo(admission)
        yield* awaitWithTimeout(f.llm.wait(3), "Parallel model calls did not begin", "10 seconds")
        const steps = yield* f.runs.getSteps(admitted.id)
        const left = steps.find((item) => item.stepId === "left")
        const right = steps.find((item) => item.stepId === "right")
        if (!left?.childSessionId || !right?.childSessionId)
          return yield* Effect.die(new Error("Missing parallel children"))
        const leftID = Session.ID.make(left.childSessionId)
        const rightID = Session.ID.make(right.childSessionId)
        const rightSession = yield* f.sessions.get(rightID)
        const rightInput = rightSession.metadata?.workflowInputID
        if (typeof rightInput !== "string") return yield* Effect.die(new Error("Missing exact right input"))
        const database = Context.get(f.context, Database.Service)
        const removal = yield* f.sessions.remove(leftID).pipe(Effect.forkIn(scope))
        const paused = yield* Deferred.await(entered).pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () =>
              Effect.gen(function* () {
                const rootJob = yield* f.jobs.get(`workflow/${admitted.id}`)
                const leftJob = yield* f.jobs.get(`workflow/step/${left.id}`)
                const latest = yield* f.runs.getSteps(admitted.id)
                const intercepted = yield* Deferred.isDone(interrupted)
                return yield* Effect.fail(
                  new Error(
                    `Cancelled Job did not reach owner CAS: ${JSON.stringify({
                      rootJob: rootJob?.status,
                      leftJob: leftJob?.status,
                      interruptedSettlement: intercepted,
                      steps: latest.map((item) => ({
                        step: item.stepId,
                        status: item.status,
                        revision: item.revision,
                      })),
                    })}`,
                  ),
                )
              }),
          }),
        )
        const before = yield* f.runs.get(admitted.id)
        const cancelledJob = yield* f.jobs.get(`workflow/step/${left.id}`)
        const unsettled = yield* f.runs.getSteps(admitted.id)
        expect(cancelledJob?.status).toBe("cancelled")
        expect(unsettled.find((item) => item.id === left.id)?.status).toBe("running")
        expect(paused).toMatchObject({
          stepRunID: left.id,
          expectedRevision: left.revision,
          expectedRunRevision: before.revision,
        })
        yield* Effect.gen(function* () {
          if (sibling === "deleted") {
            const other = yield* f.sessions.remove(rightID).pipe(Effect.forkIn(scope))
            yield* awaitWithTimeout(Fiber.join(other), "Second child deletion did not finish", "10 seconds")
            expect((yield* f.jobs.get(`workflow/step/${right.id}`))?.status).toBe("cancelled")
          }
          if (sibling === "completed") {
            yield* Deferred.succeed(completeRight, undefined)
            yield* awaitWithTimeout(f.sessions.wait(rightID), "Right input did not complete", "10 seconds")
            const result = yield* SessionInputResult.read(database.db, {
              sessionID: rightID,
              inputID: SessionMessage.ID.make(rightInput),
            })
            expect(result.status).toBe("completed")
            // Its Session result is known, but the Workflow owner must still wait for the held Session mutex.
            const settled = yield* f.jobs
              .wait({ id: `workflow/step/${right.id}` })
              .pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.succeed(undefined) }))
            expect(settled).toBeUndefined()
          }
          expect((yield* f.runs.get(admitted.id)).revision).toBe(before.revision)
          expect((yield* f.runs.getSteps(admitted.id)).find((item) => item.id === right.id)?.status).toBe("running")
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        yield* awaitWithTimeout(Fiber.join(removal), "First child deletion did not finish", "10 seconds")
        const failed = yield* f.wait(admitted.id)
        expect(failed.run).toMatchObject({ status: "failed", errorCategory: "step_cancelled" })
        expect(failed.steps.find((item) => item.id === left.id)?.status).toBe("cancelled")
        expect(failed.steps.some((item) => item.status === "execution_unknown")).toBe(false)
        if (sibling === "deleted") expect(failed.steps.find((item) => item.id === right.id)?.status).toBe("cancelled")
        if (sibling === "completed") {
          const result = yield* SessionInputResult.read(database.db, {
            sessionID: rightID,
            inputID: SessionMessage.ID.make(rightInput),
          })
          expect(result.status).toBe("completed")
        }
        yield* awaitWithTimeout(f.llm.wait(4), "Root did not receive the cancellation result", "10 seconds")
        yield* awaitWithTimeout(f.sessions.wait(f.created.session.id), "Root handoff did not finish", "10 seconds")
        yield* f.execution.resume({ sessionID: f.created.session.id, runID: admitted.id })
        yield* f.execution.reconcilePending
        const requests = yield* f.llm.requests()
        expect(requests.length).toBe(4)
        expect(requests.filter((request) => requestText(request).includes('"step":"left"')).length).toBe(1)
        expect(requests.filter((request) => requestText(request).includes('"step":"right"')).length).toBe(1)
        const handoff = workflowHandoff(requests[3])
        expect(handoff.steps).toMatchObject([
          { stepID: "entry", detail: "Ready", quality: "complete" },
          { stepID: "left", status: "cancelled", quality: "unavailable" },
          {
            stepID: "right",
            status: "cancelled",
            errorCategory: "step_cancelled",
            detail: sibling === "completed" ? "Right completed" : "step_cancelled",
            quality: sibling === "completed" ? "complete" : "unavailable",
          },
        ])
        if (sibling === "completed")
          expect(handoff.steps[2].source).toMatchObject({
            childSessionID: rightID,
            inputID: rightInput,
            resultStatus: "completed",
          })
      }),
    ),
  )
}

describe("Workflow branch output", () => {
  const definition = step("branch", { branches: { good: "END" } })
  test("accepts only the declared strict JSON contract", () => {
    expect(WorkflowExecution.branchOutput(definition, '{"branch":"good","summary":"ok"}')).toEqual({
      target: "END",
      summary: "ok",
    })
    expect(WorkflowExecution.branchOutput(definition, '{"branch":"good","extra":true}')).toBeUndefined()
    expect(WorkflowExecution.branchOutput(definition, '{"branch":"constructor"}')).toBeUndefined()
    expect(WorkflowExecution.branchOutput(definition, '```json\n{"branch":"good"}\n```')).toBeUndefined()
    expect(
      WorkflowExecution.branchOutput(definition, JSON.stringify({ branch: "good", summary: "😀".repeat(2000) })),
    ).toBeDefined()
    expect(
      WorkflowExecution.branchOutput(definition, JSON.stringify({ branch: "good", summary: "😀".repeat(2001) })),
    ).toBeUndefined()
  })
})

it.live("retains an adopted Workflow CPU binding after a preference change and database reopen", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const databasePath = path.join(directory, "dispatch.sqlite")
      const originalScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
      const paused = yield* Deferred.make<void>()
      const definitions = [step("A", { next: "END" })]
      const original = yield* setup(definitions, {
        directory,
        databasePath,
        scope: originalScope,
        pauseBeforeStart: paused,
      })
      const admitted = runInfo(yield* original.start())
      yield* awaitWithTimeout(Deferred.await(paused), "Dispatch never reached its durable input boundary", "10 seconds")
      const before = (yield* original.runs.getSteps(admitted.id))[0]
      if (!before?.childSessionId) return yield* Effect.die(new Error("Missing adopted Workflow child"))
      expect(before.status).toBe("dispatching")
      expect(yield* original.llm.requests()).toEqual([])
      const child = yield* original.sessions.get(Session.ID.make(before.childSessionId))
      if (child.controller?.kind !== "child") return yield* Effect.die(new Error("Missing Workflow CPU binding"))
      const executorModel = child.controller.executor.model
      if (Model.Selection.isGroup(executorModel))
        return yield* Effect.die(new Error("This Workflow fixture requires a physical model"))
      expect(child.controller).toMatchObject({
        rootSessionID: original.created.session.id,
        source: { kind: "workflow", runID: admitted.id, stepRunID: before.id },
      })
      expect(child.model).toEqual(child.controller.executor.model)
      const preferredModel = Model.Ref.make({
        providerID: executorModel.providerID,
        id: Model.ID.make("workflow-next"),
      })
      expect(preferredModel).not.toEqual(child.controller.executor.model)
      const catalog = [
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(preferredModel.providerID),
            activation: "enabled",
            package: "@omnixa/ai/providers/openai/responses",
          }),
          models: [executorModel, preferredModel].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]
      yield* useOfflineCatalog(catalog).pipe(
        Effect.provide(Context.get(original.context, LocationServiceMap.Service).get(child.location)),
      )
      const preference = new SessionSchema.ExecutorPreference({
        agent: child.controller.executor.agent,
        model: preferredModel,
      })
      expect(
        (yield* original.sessions.selectExecutor({
          sessionID: original.created.session.id,
          executorPreference: preference,
        })).executorPreference,
      ).toEqual(preference)
      expect((yield* original.sessions.get(child.id)).controller).toEqual(child.controller)
      yield* Scope.close(originalScope, Exit.void)
      const reopened = yield* setup(definitions, { directory, databasePath, sessionID: original.created.session.id })
      yield* useOfflineCatalog(catalog).pipe(
        Effect.provide(Context.get(reopened.context, LocationServiceMap.Service).get(child.location)),
      )
      expect(reopened.created.session.executorPreference).toEqual(preference)
      expect(reopened.created.session.model).toEqual(original.created.session.model)
      expect((yield* reopened.sessions.get(child.id)).controller).toEqual(child.controller)
      yield* reopened.llm.push(TestLLM.text("A complete", "a"), TestLLM.text("Root complete", "root"))
      yield* reopened.execution.reconcilePending
      const completed = yield* reopened.wait(admitted.id)
      expect(completed.run?.status).toBe("completed")
      expect(completed.steps[0]?.childSessionId).toBe(before?.childSessionId)
      expect(completed.steps[0]?.attempt).toBe(1)
      yield* awaitWithTimeout(reopened.llm.wait(2), "Reopened dispatch handoff missing", "10 seconds")
      yield* awaitWithTimeout(
        Context.get(reopened.context, SessionExecution.Service).awaitIdle(reopened.created.session.id),
        "Reopened root did not settle",
        "10 seconds",
      )
      const retained = yield* reopened.sessions.get(child.id)
      expect(retained.controller).toEqual(child.controller)
      expect(retained.model).toEqual(child.controller.executor.model)
      expect(retained.agent).toEqual(child.controller.executor.agent)
      expect((yield* reopened.sessions.get(reopened.created.session.id)).executorPreference).toEqual(preference)
      const rootModel = reopened.created.session.model
      if (!rootModel || Model.Selection.isGroup(rootModel))
        return yield* Effect.die(new Error("This Workflow root fixture requires a physical model"))
      expect((yield* reopened.llm.requests()).map((request) => String(request.model.id))).toEqual([
        String(executorModel.id),
        String(rootModel.id),
      ])
    }),
  ),
)

it.live("settles a refused recovery Job without recreating its deleting child", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const databasePath = path.join(directory, "deleting-child.sqlite")
      const originalScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
      const paused = yield* Deferred.make<void>()
      const definitions = [step("A", { next: "END" })]
      const original = yield* setup(definitions, {
        directory,
        databasePath,
        scope: originalScope,
        pauseBeforeStart: paused,
      })
      const admitted = runInfo(yield* original.start())
      yield* awaitWithTimeout(Deferred.await(paused), "Original dispatch did not reach its pending input", "10 seconds")
      const before = (yield* original.runs.getSteps(admitted.id))[0]
      if (!before?.childSessionId) return yield* Effect.die(new Error("Missing original child"))
      expect(before.status).toBe("dispatching")
      expect(yield* original.llm.requests()).toEqual([])
      yield* Scope.close(originalScope, Exit.void)
      const pauseDeletion = {
        entered: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      }
      const reopened = yield* setup(definitions, {
        directory,
        databasePath,
        sessionID: original.created.session.id,
        pauseDeletion,
      })
      yield* reopened.llm.push(TestLLM.text("Deleted child acknowledged", "root"))
      const childID = Session.ID.make(before.childSessionId)
      const removal = yield* reopened.sessions.remove(childID).pipe(Effect.forkIn(yield* Scope.Scope))
      yield* awaitWithTimeout(
        Deferred.await(pauseDeletion.entered),
        "Child deletion did not reach its transport boundary",
        "10 seconds",
      )
      yield* reopened.execution.reconcilePending
      const failed = yield* reopened.wait(admitted.id)
      expect(failed.run).toMatchObject({ status: "failed", errorCategory: "step_cancelled" })
      expect(failed.steps[0]).toMatchObject({ status: "cancelled", childSessionId: childID, attempt: 1 })
      expect(yield* reopened.jobs.get(`workflow/step/${before.id}`)).toMatchObject({
        status: "cancelled",
        error: "Session deletion in progress",
      })
      yield* awaitWithTimeout(reopened.llm.wait(1), "Root did not receive the refused-step result", "10 seconds")
      const requests = yield* reopened.llm.requests()
      expect(requests.length).toBe(1)
      expect(requestText(requests[0]!)).toContain("workflow_result")
      yield* Deferred.succeed(pauseDeletion.release, undefined)
      yield* awaitWithTimeout(Fiber.join(removal), "Child deletion did not finish", "10 seconds")
      expect(yield* reopened.sessions.get(childID).pipe(Effect.flip)).toBeInstanceOf(Session.NotFoundError)
      expect((yield* reopened.sessions.list({ parentID: original.created.session.id })).data).toEqual([])
      expect((yield* reopened.runs.getSteps(admitted.id))[0]?.status).toBe("cancelled")
      expect((yield* reopened.llm.requests()).length).toBe(1)
    }),
  ),
)

for (const output of ["available", "missing"] as const) {
  it.live(
    output === "available"
      ? "makes handoff admission failure observable and repairs it with the same durable identity"
      : "MC08 workflow handoff reports unavailable when a completed child is missing",
    () =>
      withCustomMode(
        "true",
        Effect.gen(function* () {
          const f = yield* setup([step("A", { next: "END" })])
          const context = Context.merge(f.context, yield* Layer.build(CredentialScanner.layer))
          const faulty = yield* WorkflowExecution.make.pipe(
            Effect.provideContext(
              Context.add(
                context,
                Session.Service,
                Session.Service.of({
                  ...f.sessions,
                  synthetic: () => Effect.die(new Error("Simulated admission failure")),
                }),
              ),
            ),
          )
          yield* f.llm.push(TestLLM.text("A complete", "a"), TestLLM.text("Root complete", "root"))
          const admitted = runInfo(
            yield* faulty.run({
              sessionID: f.created.session.id,
              requestID: "handoff",
              expectedSnapshotDigest: f.created.snapshot.digest,
            }),
          )
          expect(
            yield* awaitWithTimeout(
              faulty.wait(admitted.id).pipe(Effect.flip),
              "Failed handoff was hidden",
              "10 seconds",
            ),
          ).toMatchObject({ _tag: "WorkflowExecution.InvalidError", reason: "workflow_root_handoff_failed" })
          expect((yield* f.runs.get(admitted.id)).status).toBe("completed")
          expect((yield* f.jobs.get(`workflow/${admitted.id}`))?.status).toBe("error")
          expect(yield* f.sessions.inbox(f.created.session.id)).toEqual([])
          const completedStep = (yield* f.runs.getSteps(admitted.id))[0]
          if (!completedStep?.childSessionId) return yield* Effect.die(new Error("Missing completed child"))
          if (output === "missing") yield* f.sessions.remove(Session.ID.make(completedStep.childSessionId))
          yield* f.execution.resume({ sessionID: f.created.session.id, runID: admitted.id })
          yield* awaitWithTimeout(f.llm.wait(2), "Repaired handoff did not wake root", "10 seconds")
          expect((yield* f.execution.wait(admitted.id)).run?.status).toBe("completed")
          expect((yield* f.llm.requests()).length).toBe(2)
          const handoff = workflowHandoff((yield* f.llm.requests())[1])
          expect(handoff.steps).toMatchObject([
            {
              stepID: "A",
              stepRunID: completedStep.id,
              status: "completed",
              outputDigest: completedStep.outputDigest,
              detail: output === "available" ? "A complete" : "no_output",
              quality: output === "available" ? "complete" : "unavailable",
            },
          ])
          if (output === "missing") expect(handoff.steps[0].source).toBeUndefined()
        }),
      ),
  )
}

it.live("retains a pending handoff wake across a fresh process-local owner", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([])
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const admitted = yield* f.runs.getOrCreate({
        sessionID: f.created.session.id,
        workflow,
        snapshotDigest: f.created.snapshot.digest,
        requestID: "terminal",
      })
      yield* f.runs.completeRun({ runID: admitted.id, expectedRevision: admitted.revision })
      expect(yield* f.execution.reconcilePending).toEqual([f.created.session.id])
      const before = yield* f.sessions.inbox(f.created.session.id)
      expect(before.length).toBe(1)
      expect(yield* f.llm.requests()).toEqual([])
      const context = Context.merge(f.context, yield* Layer.build(CredentialScanner.layer))
      const reopened = yield* WorkflowExecution.make.pipe(Effect.provideContext(context))
      expect(yield* reopened.reconcilePending).toEqual([f.created.session.id])
      expect(yield* f.sessions.inbox(f.created.session.id)).toEqual(before)
      yield* f.llm.push(TestLLM.text("Root result", "root"))
      yield* reopened.resume({ sessionID: f.created.session.id, runID: admitted.id })
      yield* awaitWithTimeout(f.llm.wait(1), "Pending handoff was not woken", "10 seconds")
      expect((yield* f.llm.requests()).length).toBe(1)
    }),
  ),
)

for (const action of ["cancel", "revert"] as const) {
  it.live(`does not resurrect a ${action}ed Workflow handoff`, () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup([])
        const workflow = f.created.snapshot.data.workflow
        if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
        const admitted = yield* f.runs.getOrCreate({
          sessionID: f.created.session.id,
          workflow,
          snapshotDigest: f.created.snapshot.digest,
          requestID: "terminal",
        })
        yield* f.runs.completeRun({ runID: admitted.id, expectedRevision: admitted.revision })
        yield* f.execution.reconcilePending
        const marker = (yield* f.sessions.inbox(f.created.session.id))[0]
        if (!marker) return yield* Effect.die(new Error("Missing handoff marker"))
        if (action === "cancel") yield* f.sessions.cancelInbox({ sessionID: f.created.session.id, inboxID: marker.id })
        if (action === "revert") {
          yield* SessionInbox.promote(
            Context.get(f.context, Database.Service).db,
            Context.get(f.context, Bus.Service),
            f.created.session.id,
            "steer",
          )
          yield* f.sessions.revert.stage({ sessionID: f.created.session.id, messageID: marker.id, files: false })
          yield* f.sessions.revert.commit(f.created.session.id)
        }
        const context = Context.merge(f.context, yield* Layer.build(CredentialScanner.layer))
        const reopened = yield* WorkflowExecution.make.pipe(Effect.provideContext(context))
        expect(yield* reopened.reconcilePending).toEqual([])
        expect(yield* f.sessions.inbox(f.created.session.id)).toEqual([])
        expect(yield* f.llm.requests()).toEqual([])
      }),
    ),
  )
}

it.live("requires retained events for execution while preserving cancellation and history reads", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })], { persist: false })
      expect(yield* f.start().pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowExecution.InvalidError",
        reason: "workflow_requires_retained_events",
      })
      expect(yield* f.current()).toBeUndefined()
      expect(yield* f.llm.requests()).toEqual([])
      expect(yield* f.execution.reconcilePending).toEqual([])
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const seeded = yield* f.runs.getOrCreate({
        sessionID: f.created.session.id,
        workflow,
        snapshotDigest: f.created.snapshot.digest,
        requestID: "history",
      })
      const cancelled = yield* f.execution.cancelRun({
        sessionID: f.created.session.id,
        runID: seeded.id,
        expectedRunRevision: seeded.revision,
      })
      expect(cancelled.run?.status).toBe("cancelled")
      expect(yield* f.sessions.inbox(f.created.session.id)).toEqual([])
    }),
  ),
)

it.live("owns explicit request keys durably under concurrent admission", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })])
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const exits = yield* Effect.all(
        ["one", "two"].map((requestID) =>
          f.runs
            .getOrCreate({
              sessionID: f.created.session.id,
              workflow,
              snapshotDigest: f.created.snapshot.digest,
              requestID,
            })
            .pipe(Effect.exit),
        ),
        { concurrency: 2 },
      )
      const winners = exits.filter(Exit.isSuccess)
      const rejected = exits.filter(Exit.isFailure)
      expect(winners.length).toBe(1)
      expect(rejected.length).toBe(1)
      const winner = winners[0]
      if (!winner) return yield* Effect.die(new Error("Missing admission winner"))
      expect(
        (yield* f.runs.getOrCreate({
          sessionID: f.created.session.id,
          workflow,
          snapshotDigest: f.created.snapshot.digest,
        })).id,
      ).toBe(winner.value.id)
      const cancelling = yield* f.runs.cancelRun({ runID: winner.value.id, expectedRevision: winner.value.revision })
      yield* f.runs.finalizeCancelRun({ runID: cancelling.id, expectedRevision: cancelling.revision })
      const key = Exit.isSuccess(exits[0]) ? "one" : "two"
      expect(
        (yield* f.runs.getOrCreate({
          sessionID: f.created.session.id,
          workflow,
          snapshotDigest: f.created.snapshot.digest,
          requestID: key,
        })).id,
      ).toBe(winner.value.id)
    }),
  ),
)

it.live("rejects automatic retry after cancelling intent without leaving a ready attempt", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const f = yield* setup([step("A", { next: "END" })])
      const workflow = f.created.snapshot.data.workflow
      if (!workflow) return yield* Effect.die(new Error("Missing workflow"))
      const admitted = yield* f.runs.getOrCreate({
        sessionID: f.created.session.id,
        workflow,
        snapshotDigest: f.created.snapshot.digest,
        requestID: "seed",
      })
      const current = (yield* f.runs.getSteps(admitted.id))[0]
      if (!current) return yield* Effect.die(new Error("Missing step"))
      const running = yield* f.runs.startStep(current.id)
      const failed = yield* f.runs.settleStep({
        stepRunID: running.id,
        expectedRevision: running.revision,
        status: "failed",
        errorCategory: "step_failed",
      })
      const live = yield* f.runs.get(admitted.id)
      const cancelling = yield* f.runs.cancelRun({ runID: live.id, expectedRevision: live.revision })
      expect(
        yield* f.runs.retryStep({ stepRunID: failed.id, expectedRevision: failed.revision }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowRun.InvalidStateTransitionError)
      yield* f.runs.finalizeCancelRun({ runID: live.id, expectedRevision: cancelling.revision })
      expect((yield* f.runs.getSteps(live.id)).some((item) => item.status === "ready")).toBe(false)
    }),
  ),
)
