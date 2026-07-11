import { Effect, Layer, ManagedRuntime } from "effect"
import { attach } from "./run-service"
import * as Observability from "@aigcfroge/core/observability"

import { FSUtil } from "@aigcfroge/core/fs-util"
import { Database } from "@aigcfroge/core/database/database"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { Storage } from "@/storage/storage"
import { Snapshot } from "@/snapshot"
import { Plugin } from "@/plugin"
import { ModelsDev } from "@aigcfroge/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Todo } from "@/session/todo"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Command } from "@/command"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { CliAdapterRegistry } from "@/agent/meta/adapters/registry"
import { MetaPromptFiller } from "@/agent/meta/meta-prompt-filler"
import { Format } from "@/format"
import { InstanceLayer } from "@/project/instance-layer"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Workspace } from "@/control-plane/workspace"
import { Worktree } from "@/worktree"
import { Installation } from "@/installation"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { Npm } from "@aigcfroge/core/npm"
import { memoMap } from "@aigcfroge/core/effect/memo-map"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"

// V2 imports
import { SessionV2 } from "@aigcfroge/core/session"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Git as CoreGit } from "@aigcfroge/core/git"
import { ProjectV2 as CoreProject } from "@aigcfroge/core/project"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { EventV2 } from "@aigcfroge/core/event"
import * as SessionExecutionLocal from "@aigcfroge/core/session/execution/local"
import { V2Snapshot } from "@aigcfroge/core/session/v2-snapshot"
import { SessionRevert as V2SessionRevert } from "@aigcfroge/core/session/revert"
import { SessionSummary as V2SessionSummary } from "@aigcfroge/core/session/summary"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { McpV2Bridge } from "@/mcp/v2-bridge"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"

/**
 * AIGCFROGE_V2_RUNTIME - Flag to toggle V1->V2 runtime paths.
 * Default is false - V2 runtime has unresolved bugs (LLM auth not passed to
 * LLMClient causing 401; V2 handler paths return V2 shapes mismatching V1 API
 * schemas). Set to "true" to opt into V2 once fixed.
 *
 * @see docs/plan/meta-agent-v2-production-closure.md §4 P1.1
 */
export const AIGCFROGE_V2_RUNTIME = process.env.AIGCFROGE_V2_RUNTIME === "true"

// ── AppLayer: V1 + V2 ────────────────────────────────────────────
//
// V2 services (@aigcfroge/v2/Session etc.) are always provided.
// V1 services with V2 equivalents are only provided when
// AIGCFROGE_V2_RUNTIME is false (opt-in V1 fallback mode).
// V1 layers without V2 equivalents (Session, SessionStatus, etc.)
// remain always-provided until their consumers are also migrated.

const V1_ONLY_LAYERS = AIGCFROGE_V2_RUNTIME
  ? []
  : [
      SessionProcessor.defaultLayer,
      SessionCompaction.defaultLayer,
      SessionRevert.defaultLayer,
      SessionSummary.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionRunState.defaultLayer,
      Instruction.defaultLayer,
      LLM.defaultLayer,
      EventV2Bridge.defaultLayer,
      MCP.defaultLayer,
      McpAuth.defaultLayer,
      Truncate.defaultLayer,
      Format.defaultLayer,
      ShareNext.defaultLayer,
      SessionShare.defaultLayer,
      RuntimeFlags.defaultLayer,
    ]

const v2SessionStoreLayer = SessionStore.layer.pipe(Layer.provide(Database.defaultLayer))

const v2SessionExecutionLayer = SessionExecutionLocal.layer.pipe(
  Layer.provide(Layer.mergeAll(v2SessionStoreLayer, LocationServiceMap.layer)),
)

const v2SessionLayer = SessionV2.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      v2SessionExecutionLayer,
      v2SessionStoreLayer,
      SessionProjector.defaultLayer,
      EventV2.defaultLayer,
      CoreProject.defaultLayer,
    ),
  ),
)

const v2SnapshotBridgeLayer = Layer.effect(
  V2Snapshot.Service,
  Effect.gen(function* () {
    const v1 = yield* Snapshot.Service
    return V2Snapshot.Service.of({
      track: () => v1.track(),
      restore: (snap) => v1.restore(snap),
      revert: (patches) => v1.revert(patches),
      diffFull: (from, to) => v1.diffFull(from, to),
    })
  }),
).pipe(Layer.provide(Snapshot.defaultLayer))

const v2SessionRevertLayer = V2SessionRevert.layer.pipe(
  Layer.provide(Layer.mergeAll(v2SessionStoreLayer, v2SnapshotBridgeLayer)),
)

const v2SessionSummaryLayer = V2SessionSummary.layer.pipe(
  Layer.provide(Layer.mergeAll(v2SessionStoreLayer, v2SnapshotBridgeLayer)),
)

const v2SessionShareLayer = SessionShareV2.layer.pipe(
  Layer.provide(v2SessionLayer),
  Layer.provide(EventV2.defaultLayer),
)

const v2TaskDriverFillLayer = TaskDriverFill.layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const V2_LAYERS = Layer.mergeAll(
  CoreGit.defaultLayer,
  CoreProject.defaultLayer,
  EventV2.defaultLayer,
  SessionProjector.defaultLayer,
  v2SessionStoreLayer,
  LocationServiceMap.layer,
  v2SessionExecutionLayer,
  v2SessionLayer,
  v2SnapshotBridgeLayer,
  v2SessionRevertLayer,
  v2SessionSummaryLayer,
  MetaAgentService.defaultLayer,
  MetaPromptFiller.layer,
  v2SessionShareLayer,
  v2TaskDriverFillLayer,
  // McpV2Bridge depends on location-scoped ConfigV2; globalLayer
  // falls back to noop when no Location context is available.
  McpV2Bridge.globalLayer,
)

export const AppLayer = Layer.mergeAll(
  // ── Shared (always provided) ────────────────────────────────────
  Npm.defaultLayer,
  FSUtil.defaultLayer,
  Database.defaultLayer,
  Auth.defaultLayer,
  Account.defaultLayer,
  Config.defaultLayer,
  Git.defaultLayer,
  Storage.defaultLayer,
  Snapshot.defaultLayer,
  Plugin.defaultLayer,
  ModelsDev.defaultLayer,
  Provider.defaultLayer,
  ProviderAuth.defaultLayer,
  Agent.defaultLayer,
  CliAdapterRegistry.defaultLayer,
  Skill.defaultLayer,
  Discovery.defaultLayer,
  Question.defaultLayer,
  Permission.defaultLayer,
  Todo.defaultLayer,
  Session.defaultLayer,
  SessionStatus.defaultLayer,
  BackgroundJob.defaultLayer,
  Command.defaultLayer,
  LSP.defaultLayer,
  ToolRegistry.defaultLayer,
  Project.defaultLayer,
  Vcs.defaultLayer,
  Workspace.defaultLayer,
  Worktree.appLayer,
  Installation.defaultLayer,

  // ── V1 only (when flag is false) ────────────────────────────────
  ...V1_ONLY_LAYERS,

  // ── V2 always ───────────────────────────────────────────────────
  V2_LAYERS,
).pipe(
  Layer.provideMerge(Ripgrep.defaultLayer),
  Layer.provideMerge(InstanceLayer.layer),
  Layer.provideMerge(Observability.layer),
)

const rt = ManagedRuntime.make(AppLayer as never, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">

/** Services provided by AppRuntime — i.e. what an Effect run via AppRuntime.runPromise can yield. */
export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof rt>
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}
