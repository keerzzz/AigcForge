/**
 * Test support scaffolding for persistent delegation tests.
 *
 * Provides:
 * 1. Observable fake CLI adapter and provider signals (prompts, resumeIds, control calls, invocation counts).
 * 2. Scoped temporary directory and git fixture helpers (reusing existing core fixtures).
 * 3. Minimal test layer composition for EventV2 and Database.
 * 4. Pure test data builders.
 *
 * @see docs/plan/meta-agent-persistent-delegation-closed-loop.md §16.4
 */

import { Effect, Layer, type Scope } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import type { CliAdapter, DelegationResult } from "@aigcfroge/core/tool/cli-adapter"
import { tmpdir } from "./fixture/tmpdir"
import { git } from "./fixture/git"

export interface FakeAdapterSignals {
  prompts: string[]
  resumeIds: (string | undefined)[]
  controlCalls: { method: string; args: unknown }[]
  executeCount: number
}

export function makeObservableSignals(): FakeAdapterSignals {
  return {
    prompts: [],
    resumeIds: [],
    controlCalls: [],
    executeCount: 0,
  }
}

export interface FakeAdapterOptions {
  name?: string
  result?: Partial<DelegationResult>
  onExecute?: (options: { prompt: string; resumeId?: string; cwd: string }) => void
}

export function makeObservableFakeAdapter(signals: FakeAdapterSignals, options?: FakeAdapterOptions): CliAdapter {
  const name = options?.name ?? "fake-cli"
  return {
    name,
    command: name,
    description: "Fake CLI for delegation testing",
    detect: () => Effect.succeed(true),
    buildArgs: (input) => Effect.succeed([name, input.prompt]),
    parseOutput: (_stdout, _stderr) =>
      Effect.succeed({
        status: "success",
        summary: "fake execution completed",
        ...options?.result,
      }),
    execute: (input) =>
      Effect.gen(function* () {
        signals.executeCount++
        signals.prompts.push(input.prompt)
        signals.resumeIds.push(input.resumeId)
        options?.onExecute?.(input)
        return {
          status: "success",
          summary: "fake execution completed",
          sessionId: input.resumeId ?? "fake_session_1",
          ...options?.result,
        }
      }),
    cancel: (cwd) =>
      Effect.sync(() => {
        signals.controlCalls.push({ method: "cancel", args: { cwd } })
      }),
  }
}

export function makeTestSessionId(id = "ses_delegation_test"): SessionV2.ID {
  return SessionV2.ID.make(id)
}

export function makeTestLocation(directory = "/project"): Location.Ref {
  return Location.Ref.make({ directory: AbsolutePath.make(directory) })
}

/**
 * Scoped temporary directory fixture for tests, supporting optional git initialization.
 * Reuses packages/core/test/fixture/tmpdir.ts and git.ts without swallowing errors.
 */
export function tmpdirScoped(options?: { git?: boolean }): Effect.Effect<string, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const handle = yield* Effect.promise(() => tmpdir())
    yield* Effect.addFinalizer(() => Effect.promise(() => handle[Symbol.asyncDispose]()))

    if (options?.git) {
      yield* Effect.promise(async () => {
        await git(handle.path, "init")
        await git(handle.path, "config", "core.fsmonitor", "false")
        await git(handle.path, "config", "commit.gpgsign", "false")
        await git(handle.path, "config", "user.email", "test@aigcfroge.test")
        await git(handle.path, "config", "user.name", "Test")
        await git(handle.path, "commit", "--allow-empty", "-m", "root commit")
      })
    }

    return handle.path
  })
}

/**
 * Minimal common test layer with in-memory database and EventV2.
 */
export const testDelegationBaseLayer = Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)
