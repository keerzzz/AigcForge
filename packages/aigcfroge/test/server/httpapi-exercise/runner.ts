import { Flag } from "@aigcfroge/core/flag/flag"
import { ConfigV1 } from "@aigcfroge/core/v1/config/config"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { Hash } from "@aigcfroge/core/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionTask } from "@aigcfroge/core/session/task"
import { KBService } from "@aigcfroge/core/session/kb-service"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import { Cause, Duration, Effect, Layer, Scope, Schema } from "effect"
import { TestLLMServer } from "../../lib/llm-server"

import { MessageID, PartID } from "../../../src/session/schema"
import { call, callAuthProbe, disposeApps } from "./backend"
import { original } from "./environment"
import { runtime } from "./runtime"
import type { ActiveScenario, Options, ProjectOptions, Result, Scenario, ScenarioContext, SeededContext } from "./types"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"
import { WORKFLOWS_DIR } from "@aigcfroge/core/constants"

export function runScenario(options: Options) {
  return (scenario: Scenario) => {
    if (scenario.kind === "todo") return Effect.succeed({ status: "skip", scenario } as Result)
    return runActive(options, scenario).pipe(
      Effect.timeoutOrElse({
        duration: options.scenarioTimeout,
        orElse: () => Effect.die(new Error(`scenario timed out after ${Duration.format(options.scenarioTimeout)}`)),
      }),
      Effect.as({ status: "pass", scenario } as Result),
      Effect.catchCause((cause) => Effect.succeed({ status: "fail" as const, scenario, message: Cause.pretty(cause) })),
      Effect.scoped,
    )
  }
}

function runActive(options: Options, scenario: ActiveScenario) {
  if (options.mode === "auth") return runAuth(scenario)

  return withContext(options, scenario, "shared", (ctx) =>
    Effect.gen(function* () {
      yield* trace(options, scenario, "request start")
      const result = yield* call(scenario, ctx)
      yield* trace(options, scenario, `response ${result.status}`)
      yield* trace(options, scenario, "expect start")
      yield* scenario.expect(ctx, ctx.state, result)
      yield* trace(options, scenario, "expect done")
    }),
  )
}

function runAuth(scenario: ActiveScenario) {
  return Effect.gen(function* () {
    const result = yield* callAuthProbe(scenario, "missing")
    if (scenario.auth === "protected") {
      if (result.status !== 401) throw new Error(`auth expected 401, got ${result.status}`)
      const authed = yield* callAuthProbe(scenario, "valid")
      if (authed.status === 401) throw new Error("auth rejected valid credentials")
      return
    }

    if (result.status === 401) throw new Error("auth expected public access, got 401")
    if (result.timedOut) throw new Error("auth expected public access, probe timed out")
  })
}

function withContext<A, E>(
  options: Options,
  scenario: ActiveScenario,
  label: string,
  use: (ctx: SeededContext<unknown>) => Effect.Effect<A, E>,
) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      yield* trace(options, scenario, `${label} context acquire start`)
      const llm = scenario.project?.llm ? yield* TestLLMServer : undefined
      const project = scenario.project
      const dir = project
        ? yield* Effect.promise(async () => (await runtime()).tmpdir(projectOptions(project, llm?.url)))
        : undefined
      yield* trace(options, scenario, `${label} context acquire done`)
      return { dir, llm }
    }),
    (ctx) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} tmpdir cleanup start`)
        yield* Effect.promise(async () => {
          await ctx.dir?.[Symbol.asyncDispose]()
        }).pipe(Effect.ignore)
        yield* trace(options, scenario, `${label} tmpdir cleanup done`)
      }),
  ).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} runtime start`)
        const modules = yield* Effect.promise(() => runtime())
        const scope = yield* Scope.Scope
        const app = yield* Layer.buildWithMemoMap(modules.AppLayer, modules.memoMap, scope)
        yield* trace(options, scenario, `${label} runtime done`)
        const path = context.dir?.path
        const instance = path
          ? yield* trace(options, scenario, `${label} instance load start`).pipe(
              Effect.andThen(
                modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                  Effect.provide(app),
                  Effect.catchCause((cause) =>
                    Effect.sleep("100 millis").pipe(
                      Effect.andThen(
                        modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                          Effect.provide(app),
                        ),
                      ),
                      Effect.catchCause(() => Effect.failCause(cause)),
                    ),
                  ),
                ),
              ),
              Effect.tap(() => trace(options, scenario, `${label} instance load done`)),
            )
          : undefined
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provideService(modules.InstanceRef, instance), Effect.provide(app))
        const directory = () => {
          if (!context.dir?.path) throw new Error("scenario needs a project directory")
          return context.dir.path
        }
        const llm = () => {
          if (!context.llm) throw new Error("scenario needs fake LLM")
          return context.llm
        }
        const base: ScenarioContext = {
          directory: context.dir?.path,
          headers: (extra) => ({
            ...(context.dir?.path ? { "x-aigcfroge-directory": context.dir.path } : {}),
            ...extra,
          }),
          file: (name, content) =>
            Effect.promise(() => {
              return Bun.write(`${directory()}/${name}`, content)
            }).pipe(Effect.asVoid),
          session: (input) =>
            run(
              modules.Session.Service.use((svc) =>
                svc.create({ title: input?.title, parentID: input?.parentID }).pipe(Effect.orDie),
              ),
            ),
          sessionGet: (sessionID) =>
            run(modules.Session.Service.use((svc) => svc.get(sessionID))).pipe(
              Effect.catchCause(() => Effect.succeed(undefined)),
            ),
          customSession: (input) =>
            run(
              Effect.gen(function* () {
                // M1 requires exactly one agent, so seed a minimal agent asset
                // and reference it with its content hash before freezing.
                const agentPath = ".aigcfroge/agents/httpapi-seed.md"
                const agentContent = '---\nkind: agent\nname: httpapi-seed\ndescription: exerciser seed\nconfig: "{}"\n---\nSeed instructions'
                yield* Effect.promise(() => Bun.write(`${directory()}/${agentPath}`, agentContent))
                const revision = yield* Effect.sync(() =>
                  Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(agentContent))),
                )
                const workflow = input?.workflow
                  ? yield* Effect.gen(function* () {
                      const workflowContent =
                        'kind: workflow\nname: httpapi-workflow\ndescription: exerciser\nversion: "1.0.0"\ntriggers: []\nsteps:\n  - id: review\n    name: Review\n    agent: httpapi-seed\n    input: {}\n    next: END\n'
                      yield* Effect.promise(() => Bun.write(`${directory()}/${WORKFLOWS_DIR}/httpapi-workflow.yaml`, workflowContent))
                      return {
                        kind: "workflow" as const,
                        relativePath: "httpapi-workflow.yaml",
                        revision: Schema.decodeUnknownSync(Composition.Revision)(
                          Hash.sha256(Buffer.from(workflowContent)),
                        ),
                      }
                    })
                  : undefined
                // Decode through the schema (like the HTTP payload boundary) so the
                // resolver can re-encode the input when building its plan.
                const composition = yield* Effect.sync(() =>
                  Schema.decodeUnknownSync(Composition.CompositionInput)({
                    source: "temporary",
                    agents: [{ kind: "agent", relativePath: "httpapi-seed.md", revision }],
                    ...(workflow ? { workflow } : {}),
                    bindings: {},
                    presentation: "native",
                    requestedCapabilities: [],
                  }),
                )
                const v2session = yield* SessionV2.Service
                const created = yield* v2session
                  .createCustom({
                    location: Location.Ref.make({ directory: AbsolutePath.make(directory()) }),
                    composition,
                    title: input?.title,
                  })
                  .pipe(Effect.orDie)
                return created
              }),
            ),
          permissionV2: (input) =>
            run(
              Effect.gen(function* () {
                const locations = yield* LocationServiceMap
                const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory()) }))
                const service = yield* PermissionV2.Service.pipe(Effect.provide(layer), Effect.orDie)
                return yield* service.ask(input).pipe(Effect.orDie)
              }),
            ),
          pendingPermissionV2: () =>
            run(
              Effect.gen(function* () {
                const locations = yield* LocationServiceMap
                const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory()) }))
                const service = yield* PermissionV2.Service.pipe(Effect.provide(layer), Effect.orDie)
                return yield* service.list()
              }),
            ),
          project: () =>
            Effect.sync(() => {
              if (!instance) throw new Error("scenario needs a project directory")
              return instance.project
            }),
          message: (sessionID, input) =>
            Effect.gen(function* () {
              const info: SessionV1.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: {
                  providerID: ProviderV2.ID.aigcfroge,
                  modelID: ModelV2.ID.make("test"),
                },
              }
              const part: SessionV1.TextPart = {
                id: PartID.ascending(),
                sessionID,
                messageID: info.id,
                type: "text",
                text: input?.text ?? "hello",
              }
              yield* run(
                modules.Session.Service.use((svc) =>
                  Effect.gen(function* () {
                    yield* svc.updateMessage(info)
                    yield* svc.updatePart(part)
                  }),
                ),
              )
              return { info, part }
            }),
          messages: (sessionID) =>
            run(modules.Session.Service.use((svc) => svc.messages({ sessionID }).pipe(Effect.orDie))),
          todos: (sessionID, todos) =>
            run(modules.Todo.Service.use((svc) => svc.update({ sessionID, todos }).pipe(Effect.orDie, Effect.asVoid))),
          tasks: (sessionID, tasks) =>
            run(
              Effect.gen(function* () {
                // SessionTask is Location-scoped; resolve it through the same
                // LocationServiceMap path the HttpApi handlers use.
                const locations = yield* LocationServiceMap
                const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory()) }))
                const service = yield* SessionTask.Service.pipe(Effect.provide(layer), Effect.orDie)
                return yield* service.update({ sessionID, tasks }).pipe(Effect.orDie)
              }),
            ),
          kbNote: (input) =>
            run(
              Effect.gen(function* () {
                // KBService is not an output of the location layer (it is an
                // input to the builtInTools sub-layer), so build it from its own
                // LayerNode — Database.node resolves to the same isolated
                // exerciser DB (AIGCFROGE_DB) the HttpApi request uses.
                const service = yield* KBService.Service.pipe(
                  Effect.provide(LayerNode.buildLayer(KBService.node)),
                  Effect.orDie,
                )
                return yield* service.create({ ...input, tags: input.tags ?? [], baseDir: undefined }).pipe(Effect.orDie)
              }),
            ),
          memoryPropose: (input) =>
            run(
              Effect.gen(function* () {
                const service = yield* PersonalMemory.Service.pipe(
                  Effect.provide(LayerNode.buildLayer(PersonalMemory.node)),
                  Effect.orDie,
                )
                return yield* service.propose(input).pipe(Effect.orDie)
              }),
            ),
          memoryConfirm: (id) =>
            run(
              Effect.gen(function* () {
                const service = yield* PersonalMemory.Service.pipe(
                  Effect.provide(LayerNode.buildLayer(PersonalMemory.node)),
                  Effect.orDie,
                )
                return yield* service.confirm(id).pipe(Effect.orDie)
              }),
            ),
          scheduleCreate: (input) =>
            run(
              Effect.gen(function* () {
                const service = yield* ScheduleService.Service.pipe(
                  Effect.provide(LayerNode.buildLayer(ScheduleService.node)),
                  Effect.orDie,
                )
                return yield* service.create(input).pipe(Effect.orDie)
              }),
            ),
          deliveryDeliver: (input) =>
            run(
              Effect.gen(function* () {
                const service = yield* ScheduleService.DeliveryService.pipe(
                  Effect.provide(LayerNode.buildLayer(ScheduleService.deliveryNode)),
                  Effect.orDie,
                )
                return yield* service.deliver(input).pipe(Effect.orDie)
              }),
            ),
          worktree: (input) => run(modules.Worktree.Service.use((svc) => svc.create(input).pipe(Effect.orDie))),
          worktreeRemove: (directory) =>
            run(modules.Worktree.Service.use((svc) => svc.remove({ directory })).pipe(Effect.ignore)),
          llmText: (value) => Effect.suspend(() => llm().text(value)),
          llmWait: (count) => Effect.suspend(() => llm().wait(count)),
          tuiRequest: (request) => Effect.sync(() => modules.Tui.submitTuiRequest(request)),
        }
        yield* trace(options, scenario, `${label} seed start`)
        const state = yield* scenario.seed(base)
        yield* trace(options, scenario, `${label} seed done`)
        yield* trace(options, scenario, `${label} use start`)
        const result = yield* use({ ...base, state })
        yield* trace(options, scenario, `${label} use done`)
        return result
      }).pipe(Effect.ensuring(context.llm ? context.llm.reset : Effect.void)),
    ),
    Effect.ensuring(scenario.reset ? resetState : Effect.void),
  )
}

function trace(options: Options, scenario: ActiveScenario, phase: string) {
  return Effect.sync(() => {
    if (!options.trace) return
    console.log(`[trace] ${scenario.name}: ${phase}`)
  })
}

function projectOptions(
  project: ProjectOptions,
  llmUrl: string | undefined,
): { git?: boolean; config?: Partial<ConfigV1.Info> } {
  if (!project.llm || !llmUrl) return { git: project.git, config: project.config }
  const fake = fakeLlmConfig(llmUrl)
  return {
    git: project.git,
    config: {
      ...fake,
      ...project.config,
      provider: {
        ...fake.provider,
        ...project.config?.provider,
      },
    },
  }
}

function fakeLlmConfig(url: string): Partial<ConfigV1.Info> {
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

const resetState = Effect.promise(async () => {
  const modules = await runtime()
  Flag.AIGCFROGE_SERVER_PASSWORD = original.AIGCFROGE_SERVER_PASSWORD
  Flag.AIGCFROGE_SERVER_USERNAME = original.AIGCFROGE_SERVER_USERNAME
  await disposeApps()
  await modules.disposeAllInstances()
  await modules.resetDatabase()
  await Bun.sleep(25)
})
