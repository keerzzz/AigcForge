import fs from "fs/promises"
import path from "path"
import { beforeAll, afterAll, describe, expect } from "bun:test"
import { DateTime, Effect, Equal, Hash, Layer, Schema } from "effect"

const FLAG_KEY = "AIGCFROGE_EXPERIMENTAL_CHAT_ASSET"
const _origFlag = process.env[FLAG_KEY]
beforeAll(() => {
  // The ProposePromptAssetTool flags behind this env var.
  // These tests check that propose_prompt_asset appears in the tool list,
  // so enable the flag before the layout layer is evaluated.
  process.env[FLAG_KEY] = "true"
})
afterAll(() => {
  if (_origFlag === undefined) delete process.env[FLAG_KEY]
  else process.env[FLAG_KEY] = _origFlag
})
import { Tool } from "@aigcfroge/core/public"
import { define } from "@aigcfroge/plugin/v2/effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Catalog } from "@aigcfroge/core/catalog"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Location } from "@aigcfroge/core/location"
import { PluginV2 } from "@aigcfroge/core/plugin"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolDefinitions } from "./lib/tool"
import { FSUtil } from "../src/fs-util"
import { Credential } from "../src/credential"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Global } from "../src/global"
import { ModelsDev } from "../src/models-dev"
import { Npm } from "../src/npm"
import { Project } from "../src/project"
import { Reference } from "../src/reference"
import { ToolRegistry } from "../src/tool/registry"
import { ApplicationTools } from "../src/tool/application-tools"

const applicationTools = ApplicationTools.layer
const it = testEffect(
  Layer.merge(
    Layer.mergeAll(applicationTools, Database.defaultLayer, EventV2.defaultLayer),
    LocationServiceMap.layer.pipe(
      Layer.provide(applicationTools),
      Layer.provide(
        Layer.mergeAll(
          Project.defaultLayer,
          EventV2.defaultLayer,
          Credential.defaultLayer.pipe(Layer.fresh),
          Npm.defaultLayer,
          ModelsDev.defaultLayer,
          FSUtil.defaultLayer,
          Global.defaultLayer,
        ),
      ),
    ),
  ),
)

describe("LocationServiceMap", () => {
  it.live("reuses cached services for constructed and decoded location refs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap
            const directory = AbsolutePath.make(dir.path)
            const constructed = Location.Ref.make({ directory })
            const decoded = Schema.decodeUnknownSync(Location.Ref)({ directory })

            expect(constructed).toEqual({ directory, workspaceID: undefined })
            expect(decoded).toEqual(constructed)
            expect(Equal.equals(constructed, decoded)).toBe(true)
            expect(Hash.hash(constructed)).toBe(Hash.hash(decoded))
            expect(yield* locations.contextEffect(constructed)).toBe(yield* locations.contextEffect(decoded))
          }),
        ),
      ),
    ),
  )

  it.live("isolates location state while sharing location policy with catalog", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          yield* (yield* ApplicationTools.Service).register({
            application_context: Tool.make({
              description: "Read application context",
              input: Schema.Struct({}),
              output: Schema.Struct({ ok: Schema.Boolean }),
              execute: () => Effect.succeed({ ok: true }),
            }),
          })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(blocked.path, "aigcfroge.json"),
              JSON.stringify({
                experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "test" }] },
              }),
            ),
          )

          const update = (directory: string) =>
            Effect.gen(function* () {
              yield* Reference.Service
              const catalog = yield* Catalog.Service
              yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
              return {
                providers: yield* catalog.provider.all(),
                tools: yield* toolDefinitions(yield* ToolRegistry.Service),
              }
            }).pipe(
              Effect.scoped,
              Effect.provide(LocationServiceMap.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
            )

          const blockedState = yield* update(blocked.path)
          expect(blockedState.providers.some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(false)
          expect(blockedState.tools.map((tool) => tool.name).sort()).toEqual([
            "application_context",
            "apply_patch",
            "bash",
            "edit",
            "glob",
            "grep",
            "list_assets",
            "memory_record",
            "memory_search",
            "propose_agent_asset",
            "propose_command_asset",
            "propose_mcp_asset",
            "propose_plugin_asset",
            "propose_prompt_asset",
            "propose_skill_asset",
            "propose_workflow_asset",
            "question",
            "read",
            "reminder_cancel",
            "reminder_create",
            "reminder_update",
            "skill",
            "task",
            "task_create",
            "task_delete",
            "task_reorder",
            "task_schedule",
            "task_spawn",
            "task_update",
            "taskwrite",
            "todowrite",
            "webfetch",
            "websearch",
            "work-preset",
            "write",
          ])
          const allowedState = yield* update(allowed.path)
          expect(allowedState.providers.some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(true)
          expect(allowedState.tools.map((tool) => tool.name).sort()).toEqual([
            "application_context",
            "apply_patch",
            "bash",
            "edit",
            "glob",
            "grep",
            "list_assets",
            "memory_record",
            "memory_search",
            "propose_agent_asset",
            "propose_command_asset",
            "propose_mcp_asset",
            "propose_plugin_asset",
            "propose_prompt_asset",
            "propose_skill_asset",
            "propose_workflow_asset",
            "question",
            "read",
            "reminder_cancel",
            "reminder_create",
            "reminder_update",
            "skill",
            "task",
            "task_create",
            "task_delete",
            "task_reorder",
            "task_schedule",
            "task_spawn",
            "task_update",
            "taskwrite",
            "todowrite",
            "webfetch",
            "websearch",
            "work-preset",
            "write",
          ])
        }),
      ),
    ),
  )

  it.live("rejects an unavailable selected model during location model resolution", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir.path, "aigcfroge.json"),
              JSON.stringify({
                providers: {
                  unavailable: {
                    name: "Unavailable",
                    api: { type: "native", settings: {} },
                    models: { chat: { disabled: true } },
                  },
                },
              }),
            ),
          )
          const failure = yield* SessionRunnerModel.Service.use((models) =>
            models.resolve(
              SessionV2.Info.make({
                id: SessionV2.ID.make("ses_unavailable_model"),
                slug: "unavailable-model",
                version: "0.0.0",
                projectID: ProjectV2.ID.global,
                title: "test",
                model: {
                  id: ModelV2.ID.make("chat"),
                  providerID: ProviderV2.ID.make("unavailable"),
                },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
            ),
          ).pipe(Effect.provide(LocationServiceMap.get(location)), Effect.flip)

          expect(failure).toMatchObject({
            _tag: "SessionRunnerModel.ModelUnavailableError",
            providerID: "unavailable",
            modelID: "chat",
          })
        }),
      ),
    ),
  )

  it.live("installs public plugins into a location", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          const reviewer = define({
            id: "reviewer",
            effect: (ctx) =>
              ctx.agent
                .transform((agent) => {
                  agent.update("reviewer", (item) => {
                    item.description = "Reviews code"
                    item.mode = "subagent"
                  })
                })
                .pipe(Effect.asVoid),
          })
          yield* plugins.add(PluginV2.ID.make(reviewer.id), reviewer.effect)

          expect(yield* (yield* AgentV2.Service).get(AgentV2.ID.make("reviewer"))).toMatchObject({
            description: "Reviews code",
            mode: "subagent",
          })
        }).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))),
        ),
      ),
    ),
  )
})
