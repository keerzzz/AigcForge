import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, LayerMap } from "effect"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Command } from "@aigcfroge/core/command"
import { Config } from "@aigcfroge/core/config"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import type { FileSystem } from "@aigcfroge/core/filesystem"
import { Image } from "@aigcfroge/core/image"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import type { LocationServices } from "@aigcfroge/core/location-services"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { Skill } from "@aigcfroge/core/skill"
import { Composition } from "@aigcfroge/schema/composition"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { withCustomMode } from "./lib/product-mode"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const commandNode = makeGlobalNode({ service: Command.Service, layer: Command.layer, deps: [Bus.node] })
const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const commands = yield* Command.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          // This virtual Location exposes the shared test registry and prompt preparation.
          // The production LocationServices type includes unrelated runtime services.
          Layer.mergeAll(
            Layer.succeed(Command.Service, commands),
            Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
            LayerNode.compile(LayerNode.group([Agent.node, PluginHooks.node, Image.node, Skill.node, Config.node]), {
              replacements: [Config.node.replace(Config.testLayer())],
            }),
          ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [commandNode],
})
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionComposition.node, commandNode, Database.node, Bus.node]), [
    LocationServiceMap.node.replace(locations),
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
  ]),
)

const frozen = (name: string, source: string, invocation = `/${name}`) =>
  new Composition.CommandInfo({
    name,
    description: "Frozen command",
    relativePath: `${name}.md`,
    revision: Composition.Revision.make("a".repeat(64)),
    invocation,
    source,
  })
const rootCommand = frozen("review", "Root $ARGUMENTS")
const childCommand = frozen("review", "Child $1 / $2")
const unbound = frozen("unbound", "Unbound")

const setup = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const database = yield* Database.Service
  const root = yield* sessions.create({ location })
  const worker = Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("coder")), mode: "subagent" })
  const child = yield* sessions.create({ parentID: root.id, agent: worker.id })
  const snapshot = yield* CompositionFixture.attach(root.id, worker)
  const data = new Composition.SnapshotDataV2({
    ...snapshot.data,
    commands: [rootCommand, childCommand, unbound],
    bindings: {
      orchestrator: new Composition.SnapshotBindingData({
        instructions: [],
        prompts: [],
        skills: [],
        commands: [rootCommand],
      }),
      "agents/coder": new Composition.SnapshotBindingData({
        instructions: [],
        prompts: [],
        skills: [],
        commands: [childCommand],
      }),
    },
  })
  yield* database.db
    .update(SessionCompositionSnapshotTable)
    .set({ data, digest: CompositionDigest.computeDigest(data) })
    .where(eq(SessionCompositionSnapshotTable.session_id, root.id))
    .run()
    .pipe(Effect.orDie)
  yield* compositions.copy(root.id, child.id)
  yield* database.db
    .update(SessionTable)
    .set({ mode: "custom", agent: "meta" })
    .where(eq(SessionTable.id, root.id))
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .update(SessionTable)
    .set({ mode: "custom" })
    .where(eq(SessionTable.id, child.id))
    .run()
    .pipe(Effect.orDie)
  return { sessions, database, root, child, data }
})

describe("Custom Session commands", () => {
  it.effect("uses only the consumer's frozen body after live commands change and disappear", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const commands = yield* Command.Service
        const registration = yield* commands.transform((editor) =>
          editor.add({
            name: "review",
            execute: () => Effect.die("Live callback must not execute"),
          }),
        )
        yield* f.sessions.command({ sessionID: f.root.id, command: "review", text: "$& $$" })
        yield* registration.dispose
        expect(yield* commands.get("review")).toBeUndefined()
        yield* f.sessions.command({ sessionID: f.root.id, command: "/review", text: "retained" })
        yield* f.sessions.command({
          sessionID: f.child.id,
          command: "review",
          text: '"alpha beta" gamma delta',
          delivery: "queue",
        })
        expect(yield* f.sessions.inbox(f.root.id)).toMatchObject([
          { payload: { text: "Root $& $$" }, delivery: "steer" },
          { payload: { text: "Root retained" }, delivery: "steer" },
        ])
        expect(yield* f.sessions.inbox(f.child.id)).toMatchObject([
          { payload: { text: "Child alpha beta / gamma delta" }, delivery: "queue" },
        ])
        expect((yield* f.sessions.get(f.root.id)).agent).toBe(Agent.ID.make("meta"))
        expect((yield* f.sessions.get(f.child.id)).agent).toBe(Agent.ID.make("coder"))
        expect((yield* f.sessions.list()).data).toHaveLength(2)
      }),
    ),
  )

  it.effect("does not expose commands from the flat snapshot catalog", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        expect(
          yield* f.sessions
            .command({
              sessionID: f.root.id,
              command: "unbound",
              text: "blocked",
            })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Command.NotFoundError" })
        expect(yield* f.sessions.inbox(f.root.id)).toEqual([])
      }),
    ),
  )

  for (const item of [
    { name: "missing body", commands: [new Composition.CommandInfo({ ...rootCommand, source: undefined })] },
    { name: "legacy invocation", commands: [new Composition.CommandInfo({ ...rootCommand, invocation: "" })] },
    { name: "ambiguous invocation", commands: [rootCommand, frozen("another", "Another", "review")] },
    { name: "duplicate name", commands: [rootCommand, frozen("review", "Another", "/another")] },
    { name: "shell interpolation", commands: [frozen("review", "Inspect !\`echo hidden\`")] },
  ]) {
    it.effect(`rejects ${item.name} before prompt admission`, () =>
      withCustomMode(
        "true",
        Effect.gen(function* () {
          const f = yield* setup
          const data = new Composition.SnapshotDataV2({
            ...f.data,
            commands: item.commands,
            bindings: {
              ...f.data.bindings,
              orchestrator: new Composition.SnapshotBindingData({
                instructions: [],
                prompts: [],
                skills: [],
                commands: item.commands,
              }),
            },
          })
          yield* f.database.db
            .update(SessionCompositionSnapshotTable)
            .set({ data })
            .where(eq(SessionCompositionSnapshotTable.session_id, f.root.id))
            .run()
            .pipe(Effect.orDie)
          expect(
            yield* f.sessions
              .command({
                sessionID: f.root.id,
                command: "review",
                text: "no admission",
              })
              .pipe(Effect.flip),
          ).toMatchObject({ _tag: "Command.ExecutionError" })
          expect(yield* f.sessions.inbox(f.root.id)).toEqual([])
          expect((yield* f.sessions.list()).data).toHaveLength(2)
        }),
      ),
    )
  }

  it.effect("accepts an explicitly frozen empty template and rejects unavailable attachments without admission", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const empty = frozen("empty", "")
        const data = new Composition.SnapshotDataV2({
          ...f.data,
          commands: [empty],
          bindings: {
            ...f.data.bindings,
            orchestrator: new Composition.SnapshotBindingData({
              instructions: [],
              prompts: [],
              skills: [],
              commands: [empty],
            }),
          },
        })
        yield* f.database.db
          .update(SessionCompositionSnapshotTable)
          .set({ data })
          .where(eq(SessionCompositionSnapshotTable.session_id, f.root.id))
          .run()
          .pipe(Effect.orDie)
        yield* f.sessions.command({
          sessionID: f.root.id,
          command: "empty",
          text: "Explicit arguments",
          delivery: "queue",
        })
        const admitted = yield* f.sessions.inbox(f.root.id)
        expect(admitted).toMatchObject([{ payload: { text: "Explicit arguments" }, delivery: "queue" }])
        const error = yield* f.sessions
          .command({
            sessionID: f.root.id,
            command: "empty",
            text: "Do not expose this argument",
            files: [{ uri: "data:text/plain;base64,invalid-body", name: "context.txt" }],
          })
          .pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Command.ExecutionError", message: "Command attachment is unavailable" })
        expect(error.message).not.toContain("invalid-body")
        expect(yield* f.sessions.inbox(f.root.id)).toEqual(admitted)
      }),
    ),
  )

  it.effect("preserves literal shell syntax supplied as an argument", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        yield* f.sessions.command({
          sessionID: f.root.id,
          command: "review",
          text: "!\`echo literal\`",
          delivery: "queue",
          files: [{ uri: "data:text/plain;base64,Y29udGV4dA==", name: "context.txt" }],
        })
        expect(yield* f.sessions.inbox(f.root.id)).toMatchObject([
          { payload: { text: "Root !\`echo literal\`", files: [{ name: "context.txt" }] }, delivery: "queue" },
        ])
      }),
    ),
  )

  it.effect("fails closed without a snapshot or while Custom mode is disabled", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        yield* withCustomMode(
          "false",
          Effect.gen(function* () {
            expect(
              yield* f.sessions
                .command({
                  sessionID: f.root.id,
                  command: "review",
                  text: "blocked",
                })
                .pipe(Effect.flip),
            ).toMatchObject({ _tag: "UnsupportedProductModeError" })
          }),
        )
        yield* f.database.db
          .delete(SessionCompositionSnapshotTable)
          .where(eq(SessionCompositionSnapshotTable.session_id, f.root.id))
          .run()
          .pipe(Effect.orDie)
        expect(
          yield* f.sessions
            .command({
              sessionID: f.root.id,
              command: "review",
              text: "blocked",
            })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Command.ExecutionError" })
        expect(yield* f.sessions.inbox(f.root.id)).toEqual([])
      }),
    ),
  )

  it.effect("retains ordinary registered callback execution", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      const commands = yield* Command.Service
      const calls: Command.Invocation[] = []
      yield* commands.transform((editor) =>
        editor.add({
          name: "review",
          execute: (input) => Effect.sync(() => void calls.push(input)),
        }),
      )
      yield* sessions.command({ sessionID: session.id, command: "review", text: "ordinary", delivery: "queue" })
      expect(calls).toMatchObject([{ sessionID: session.id, prompt: { text: "ordinary" }, delivery: "queue" }])
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )
})
