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

/**
 * AIGCFROGE_V2_RUNTIME — Flag to toggle V1→V2 runtime paths.
 * V2 services are always provided alongside V1 for bridge compatibility.
 * The flag controls which runtime path (V1 handler vs V2 handler) is used.
 *
 * @see docs/plan/meta-agent-v2-production-closure.md §4 P1.1
 */
export const AIGCFROGE_V2_RUNTIME = process.env.AIGCFROGE_V2_RUNTIME === "true"

// ── AppLayer: V1 + V2 ────────────────────────────────────────────
//
// V1 services (@aigcfroge/Session etc.) and V2 services (@aigcfroge/v2/Session
// etc.) coexist with different service tags. V1 bridge layers (SessionRevert,
// SessionSummary, MCP, etc.) remain on V1 services until Phase 2/3 migrates them.
// AIGCFROGE_V2_RUNTIME flag controls which handler path is active.

export const AppLayer = Layer.mergeAll(
  // ── V1 ─────────────────────────────────────────────────────────
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
  Skill.defaultLayer,
  Discovery.defaultLayer,
  Question.defaultLayer,
  Permission.defaultLayer,
  Todo.defaultLayer,
  Session.defaultLayer,
  SessionStatus.defaultLayer,
  BackgroundJob.defaultLayer,
  RuntimeFlags.defaultLayer,
  EventV2Bridge.defaultLayer,
  SessionRunState.defaultLayer,
  SessionProcessor.defaultLayer,
  SessionCompaction.defaultLayer,
  SessionRevert.defaultLayer,
  SessionSummary.defaultLayer,
  SessionPrompt.defaultLayer,
  Instruction.defaultLayer,
  LLM.defaultLayer,
  LSP.defaultLayer,
  MCP.defaultLayer,
  McpAuth.defaultLayer,
  Command.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Format.defaultLayer,
  Project.defaultLayer,
  Vcs.defaultLayer,
  Workspace.defaultLayer,
  Worktree.appLayer,
  Installation.defaultLayer,
  ShareNext.defaultLayer,
  SessionShare.defaultLayer,

  // ── V2 additions ───────────────────────────────────────────────
  CoreGit.defaultLayer,
  CoreProject.defaultLayer,
  SessionStore.defaultLayer,
  EventV2.defaultLayer,
  SessionProjector.defaultLayer,
  SessionV2.layer.pipe(
    Layer.provide(SessionExecutionLocal.defaultLayer),
    Layer.orDie,
  ),
  LocationServiceMap.layer,

  // V2 Snapshot bridge (wraps V1 Snapshot.Service into V2Snapshot tag)
  Layer.effect(
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
  ),

  // V2 revert + summary (depend on V2Snapshot + SessionStore)
  V2SessionRevert.defaultLayer,
  V2SessionSummary.defaultLayer,
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
