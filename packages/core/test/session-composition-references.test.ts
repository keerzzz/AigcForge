import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@omnixa/schema/agent"
import { Composition } from "@omnixa/schema/composition"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { Event } from "@omnixa/schema/event"
import { Location } from "@omnixa/schema/location"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { SessionEvent } from "@omnixa/schema/session-event"
import { SessionMessage } from "@omnixa/schema/session-message"
import { Workspace } from "@omnixa/schema/workspace"
import { Global } from "@omnixa/util/global"
import { Database } from "../src/database/database"
import { EventSequenceTable, EventTable } from "../src/event/sql"
import { ProjectTable } from "../src/project/sql"
import { SessionComposition } from "../src/session/composition"
import { SessionCompositionSnapshotTable, SessionTable } from "../src/session/sql"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })),
)
const layer = (filename = ":memory:") =>
  SessionComposition.layer.pipe(
    Layer.provideMerge(Database.layer({ path: filename }).pipe(Layer.provide(globalLayer))),
    Layer.fresh,
  )
const it = testEffect(layer())
const source = Location.Ref.make({ directory: AbsolutePath.make("/project#source") })
const destination = Location.Ref.make({ directory: AbsolutePath.make("/destination") })
const revision = Composition.Revision.make("a".repeat(64))
const digest = Composition.Digest.make("b".repeat(64))
const paths = {
  agent: "pool/coder.md",
  prompt: "shared/precise.md",
  skill: "review/SKILL.md",
  workflow: "review.yaml",
  command: "check.md",
  mcp: "probe.md",
} as const

function data(
  sourceLocation: Location.Ref | undefined = source,
  targets?: Readonly<Partial<Record<"prompt" | "skill" | "command", AssetPlacement.Target>>>,
) {
  const prompt = new Composition.SnapshotPromptData({
    relativePath: paths.prompt,
    revision,
    content: "Frozen prompt",
    target: targets?.prompt,
  })
  const skill = new Composition.SnapshotSkillData({
    relativePath: paths.skill,
    revision,
    name: "review",
    description: "Review",
    target: targets?.skill,
  })
  const command = new Composition.CommandInfo({
    relativePath: paths.command,
    revision,
    name: "check",
    description: "Check",
    invocation: "check",
    target: targets?.command,
  })
  const mcp = new Composition.McpRef({ kind: "mcp", relativePath: paths.mcp, revision })
  return new Composition.SnapshotDataV2({
    sourceLocation,
    agents: [
      new Composition.AgentInfo({
        id: "coder",
        name: "coder",
        description: "Coder",
        relativePath: paths.agent,
        revision,
      }),
    ],
    executors: [
      new Composition.SnapshotExecutorData({
        id: Agent.ID.make("coder"),
        relativePath: "executor.md",
        revision,
        info: Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("coder")), originRelativePath: "origin.md" }),
      }),
    ],
    workflow: new Composition.WorkflowInfo({
      relativePath: paths.workflow,
      revision,
      name: "review",
      description: "Review",
      steps: [],
    }),
    bindings: {
      orchestrator: new Composition.SnapshotBindingData({ prompts: [prompt], skills: [skill], commands: [command] }),
      "agents/coder": new Composition.SnapshotBindingData({ prompts: [prompt], skills: [skill], commands: [command] }),
    },
    commands: [command],
    prompts: [prompt],
    skills: [skill],
    instructions: [new Composition.Instruction({ source: "unrelated.md", content: "probe.md check.md" })],
    tools: new Composition.SnapshotToolInfo({ fingerprints: [], catalogDigest: digest, catalog: [] }),
    mcp: new Composition.SnapshotMcpInfo({
      bindings: [new Composition.SnapshotMcpBinding({ serverName: "probe", ref: mcp })],
      tools: [new Composition.SnapshotMcpTool({ canonicalName: "mcp_probe_run", serverName: "probe", ref: mcp })],
    }),
  })
}

const seed = Effect.fnUntraced(function* (ids: ReadonlyArray<string>) {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: source.directory, sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values(
      ids.map((id) => ({
        id: Session.ID.make(id),
        project_id: Project.ID.global,
        slug: id,
        mode: "custom" as const,
        directory: source.directory,
        title: id,
        version: "test",
      })),
    )
    .run()
    .pipe(Effect.orDie)
})
const attach = Effect.fnUntraced(function* (id: string, frozen = data()) {
  const composition = yield* SessionComposition.Service
  yield* composition.attach(
    Session.ID.make(id),
    new Composition.SnapshotV2({
      version: 2,
      sessionID: id,
      digest,
      profilePath: "profile.yaml",
      createdAt: 100,
      data: frozen,
    }),
  )
})
const query = Effect.fnUntraced(function* (
  kind: Composition.AllowedKind,
  relativePath: string = paths[kind],
  location = source,
  target?: AssetPlacement.Target,
) {
  const composition = yield* SessionComposition.Service
  return yield* composition.references({ location, kind, path: relativePath, target })
})
const lifecycle = Effect.fnUntraced(function* (
  id: string,
  definition: typeof SessionEvent.Created | typeof SessionEvent.Forked,
  payload: Record<string, unknown>,
) {
  const database = yield* Database.Service
  yield* database.db.insert(EventSequenceTable).values({ aggregate_id: id, seq: 0 }).run().pipe(Effect.orDie)
  yield* database.db
    .insert(EventTable)
    .values({
      id: Event.ID.create(),
      aggregate_id: id,
      seq: 0,
      created: 100,
      type: Event.versionedType(definition.type, definition.durable.version),
      data: payload,
    })
    .run()
    .pipe(Effect.orDie)
})

describe("Session composition reverse references", () => {
  it.effect("finds frozen asset-root references at their source Location with an empty executor pool", () =>
    Effect.gen(function* () {
      yield* seed([Session.ID.make("ses_asset_root_ref")])
      const root = new Composition.AssetRoot({
        source: "asset",
        id: Agent.ID.make("release-root"),
        kind: "agent",
        relativePath: "roots/release.md",
        revision,
      })
      yield* attach(
        Session.ID.make("ses_asset_root_ref"),
        new Composition.SnapshotDataV2({
          ...data(),
          root,
          agents: [],
          executors: [],
          orchestrator: Agent.Info.make({
            ...Agent.Info.empty(root.id),
            originRelativePath: root.relativePath,
            originRevision: root.revision,
          }),
        }),
      )
      const found = yield* query("agent", root.relativePath)
      expect(found.snapshotsComplete).toBe(true)
      expect(found.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make("ses_asset_root_ref")])
      expect((yield* query("agent", " roots\\release.md ")).snapshots).toEqual(found.snapshots)
      expect((yield* query("agent", root.relativePath, destination)).snapshots).toEqual([])
      expect((yield* query("agent", paths.agent)).snapshots).toEqual([])
    }),
  )

  it.effect(
    "matches all six kinds once per Session across top-level and scoped bindings without requiring live assets",
    () =>
      Effect.gen(function* () {
        yield* seed([Session.ID.make("ses_ref")])
        yield* attach(Session.ID.make("ses_ref"))
        for (const kind of Object.keys(paths)) {
          const result = yield* query(Schema.decodeUnknownSync(Composition.AllowedKind)(kind))
          expect(result.snapshotsComplete).toBe(true)
          expect(result.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make("ses_ref")])
        }
        expect((yield* query("agent", "executor.md")).snapshots).toHaveLength(1)
        expect((yield* query("agent", "origin.md")).snapshots).toHaveLength(1)
        expect((yield* query("prompt", " shared\\precise.md ")).snapshots).toHaveLength(1)
        expect((yield* query("prompt", ".omnixa/prompts/shared/precise.md")).snapshots).toEqual([])
        expect((yield* query("prompt", "unrelated.md")).snapshots).toEqual([])
        const composition = yield* SessionComposition.Service
        expect(
          (yield* composition.references({ location: source, kind: "prompt", path: "../precise.md" }).pipe(Effect.flip))
            .code,
        ).toBe("invalid_reference_path")
      }),
  )

  it.effect("finds binding-only paths and ignores invalid stored edges and revision changes", () =>
    Effect.gen(function* () {
      yield* seed([Session.ID.make("ses_ref")])
      const frozen = data()
      yield* attach(
        Session.ID.make("ses_ref"),
        new Composition.SnapshotDataV2({
          ...frozen,
          prompts: [],
          skills: [],
          commands: [],
          agents: [],
          executors: [],
          mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: frozen.mcp.tools }),
          bindings: {
            "agents/coder": new Composition.SnapshotBindingData({
              prompts: [
                new Composition.SnapshotPromptData({ relativePath: "../invalid.md", revision, content: "" }),
                new Composition.SnapshotPromptData({
                  ...frozen.prompts[0],
                  revision: Composition.Revision.make("c".repeat(64)),
                }),
              ],
              skills: frozen.skills,
              commands: frozen.commands,
            }),
          },
        }),
      )
      for (const kind of ["prompt", "skill", "command", "mcp"] as const)
        expect((yield* query(kind)).snapshots).toHaveLength(1)
    }),
  )

  it.effect("retains frozen source ownership after movement, archive and copy with strict workspace isolation", () =>
    Effect.gen(function* () {
      yield* seed([
        Session.ID.make("ses_ref"),
        Session.ID.make("ses_copy"),
        Session.ID.make("ses_workspace"),
        Session.ID.make("ses_global"),
        Session.ID.make("ses_project"),
        Session.ID.make("ses_global_workspace"),
      ])
      yield* attach(Session.ID.make("ses_ref"))
      const composition = yield* SessionComposition.Service
      yield* composition.copy(Session.ID.make("ses_ref"), Session.ID.make("ses_copy"))
      yield* attach(
        Session.ID.make("ses_workspace"),
        data(Location.Ref.make({ ...source, workspaceID: Workspace.ID.make("wrk_other") })),
      )
      const targetFor = (scope: "project" | "global", kind: "prompt" | "skill" | "command") =>
        new AssetPlacement.Target({
          scope,
          root: AbsolutePath.make(`/owners/${scope}/${kind}`),
        })
      const selected = (scope: "project" | "global") => ({
        prompt: targetFor(scope, "prompt"),
        skill: targetFor(scope, "skill"),
        command: targetFor(scope, "command"),
      })
      yield* attach(Session.ID.make("ses_global"), data(source, selected("global")))
      yield* attach(Session.ID.make("ses_project"), data(source, selected("project")))
      yield* attach(
        Session.ID.make("ses_global_workspace"),
        data(Location.Ref.make({ ...source, workspaceID: Workspace.ID.make("wrk_other") }), selected("global")),
      )
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ directory: destination.directory, time_archived: 200 })
        .where(eq(SessionTable.id, Session.ID.make("ses_ref")))
        .run()
        .pipe(Effect.orDie)
      expect((yield* query("prompt")).snapshots.map((snapshot) => snapshot.sessionID)).toEqual([
        Session.ID.make("ses_copy"),
        Session.ID.make("ses_ref"),
      ])
      expect(yield* query("prompt", paths.prompt, destination)).toEqual({ snapshots: [], snapshotsComplete: true })
      expect(
        (yield* query(
          "prompt",
          paths.prompt,
          Location.Ref.make({ ...source, workspaceID: Workspace.ID.make("wrk_other") }),
        )).snapshots.map((snapshot) => snapshot.sessionID),
      ).toEqual([Session.ID.make("ses_workspace")])
      expect(
        (yield* query(
          "prompt",
          paths.prompt,
          Location.Ref.make({ directory: AbsolutePath.make(`${source.directory}/.`) }),
        )).snapshots,
      ).toHaveLength(2)
      yield* Effect.forEach(["prompt", "skill", "command"] as const, (kind) =>
        Effect.gen(function* () {
          yield* Effect.forEach(["project", "global"] as const, (scope) =>
            Effect.gen(function* () {
              const target = targetFor(scope, kind)
              const result = yield* query(kind, paths[kind], destination, target)
              expect(result.snapshotsComplete).toBe(true)
              expect(result.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make(`ses_${scope}`)])
              expect(
                (yield* query(
                  kind,
                  paths[kind],
                  source,
                  new AssetPlacement.Target({
                    ...target,
                    root: AbsolutePath.make(`${target.root}-other`),
                  }),
                )).snapshots,
              ).toEqual([])
            }),
          )
          expect(
            (yield* query(
              kind,
              paths[kind],
              Location.Ref.make({ ...destination, workspaceID: Workspace.ID.make("wrk_other") }),
              targetFor("global", kind),
            )).snapshots.map((snapshot) => snapshot.sessionID),
          ).toEqual([Session.ID.make("ses_global_workspace")])
        }),
      )
      expect(
        yield* composition
          .references({
            location: source,
            kind: "agent",
            path: paths.agent,
            target: targetFor("global", "prompt"),
          })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "unsupported_reference_target" })
    }),
  )

  it.effect(
    "recovers historical root, child and fork sources from retained lifecycle facts without using current placement",
    () =>
      Effect.gen(function* () {
        yield* seed([Session.ID.make("ses_root"), Session.ID.make("ses_child"), Session.ID.make("ses_fork")])
        for (const id of [Session.ID.make("ses_root"), Session.ID.make("ses_child"), Session.ID.make("ses_fork")])
          yield* attach(id, new Composition.SnapshotDataV2({ ...data(), sourceLocation: undefined }))
        yield* lifecycle(
          Session.ID.make("ses_root"),
          SessionEvent.Created,
          Schema.encodeSync(SessionEvent.Created.data)({
            sessionID: Session.ID.make("ses_root"),
            projectID: Project.ID.global,
            location: source,
            mode: "custom",
            slug: "root",
            version: "test",
          }),
        )
        yield* lifecycle(
          Session.ID.make("ses_child"),
          SessionEvent.Created,
          Schema.encodeSync(SessionEvent.Created.data)({
            sessionID: Session.ID.make("ses_child"),
            projectID: Project.ID.global,
            location: destination,
            parentID: Session.ID.make("ses_root"),
            slug: "child",
            version: "test",
          }),
        )
        yield* lifecycle(
          Session.ID.make("ses_fork"),
          SessionEvent.Forked,
          Schema.encodeSync(SessionEvent.Forked.data)({
            sessionID: Session.ID.make("ses_fork"),
            parentID: Session.ID.make("ses_child"),
            boundary: { type: "through", messageID: SessionMessage.ID.make("msg_boundary") },
          }),
        )
        expect((yield* query("prompt")).snapshots.map((snapshot) => snapshot.sessionID)).toEqual([
          Session.ID.make("ses_child"),
          Session.ID.make("ses_fork"),
          Session.ID.make("ses_root"),
        ])
        expect((yield* query("prompt")).snapshotsComplete).toBe(true)
        expect((yield* query("prompt", paths.prompt, destination)).snapshots).toEqual([])
      }),
  )

  it.effect("reports incomplete results for unknown source, corrupt snapshots and historical Agent identity", () =>
    Effect.gen(function* () {
      yield* seed([Session.ID.make("ses_known"), "ses_unknown", "ses_corrupt", Session.ID.make("ses_v1")])
      yield* attach(Session.ID.make("ses_known"))
      const missingSource = data()
      yield* attach("ses_unknown", new Composition.SnapshotDataV2({ ...missingSource, sourceLocation: undefined }))
      yield* attach("ses_corrupt")
      const database = yield* Database.Service
      yield* database.db
        .update(SessionCompositionSnapshotTable)
        .set({ version: 99 })
        .where(eq(SessionCompositionSnapshotTable.session_id, Session.ID.make("ses_corrupt")))
        .run()
        .pipe(Effect.orDie)
      const composition = yield* SessionComposition.Service
      yield* composition.attach(
        Session.ID.make("ses_v1"),
        new Composition.SnapshotV1({
          version: 1,
          digest,
          createdAt: 100,
          data: new Composition.SnapshotDataV1({
            sourceLocation: source,
            agentID: paths.agent,
            instructions: [],
            prompts: missingSource.prompts,
            skills: missingSource.skills,
            tools: missingSource.tools,
          }),
        }),
      )
      expect((yield* query("prompt")).snapshots.map((snapshot) => snapshot.sessionID)).toEqual([
        Session.ID.make("ses_known"),
        Session.ID.make("ses_v1"),
      ])
      expect((yield* query("prompt")).snapshotsComplete).toBe(false)
      expect((yield* query("agent")).snapshots.map((snapshot) => snapshot.sessionID)).toEqual([
        Session.ID.make("ses_known"),
      ])
      expect((yield* query("agent")).snapshotsComplete).toBe(false)
      expect((yield* composition.get(Session.ID.make("ses_v1"))).version).toBe(1)
    }),
  )

  it.effect("preserves valid references and typed read errors for malformed snapshot JSON", () =>
    Effect.gen(function* () {
      yield* seed([Session.ID.make("ses_known"), Session.ID.make("ses_corrupt")])
      yield* attach(Session.ID.make("ses_known"))
      yield* attach(Session.ID.make("ses_corrupt"))
      const database = yield* Database.Service
      // Bypass the JSON column encoder so SQLite retains malformed text.
      yield* database.db
        .run(
          sql`
          update session_composition_snapshot
          set data = ${"{"}
          where session_id = ${Session.ID.make("ses_corrupt")}
        `,
        )
        .pipe(Effect.orDie)
      const composition = yield* SessionComposition.Service
      const error = yield* composition.get(Session.ID.make("ses_corrupt")).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SessionComposition.SnapshotDecodeError)
      expect(error.sessionID).toBe(Session.ID.make("ses_corrupt"))
      const result = yield* query("prompt")
      expect(result.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make("ses_known")])
      expect(result.snapshotsComplete).toBe(false)
    }),
  )

  it.effect("preserves valid references when retained Created and Forked event JSON is malformed", () =>
    Effect.gen(function* () {
      const historical = [Session.ID.make("ses_created"), Session.ID.make("ses_fork")]
      yield* seed([Session.ID.make("ses_known"), ...historical])
      yield* attach(Session.ID.make("ses_known"))
      yield* Effect.forEach(historical, (id) =>
        attach(id, new Composition.SnapshotDataV2({ ...data(), sourceLocation: undefined })),
      )
      yield* lifecycle(
        historical[0],
        SessionEvent.Created,
        Schema.encodeSync(SessionEvent.Created.data)({
          sessionID: historical[0],
          projectID: Project.ID.global,
          location: source,
          mode: "custom",
          slug: "created",
          version: "test",
        }),
      )
      yield* lifecycle(
        historical[1],
        SessionEvent.Forked,
        Schema.encodeSync(SessionEvent.Forked.data)({
          sessionID: historical[1],
          parentID: Session.ID.make("ses_known"),
          boundary: { type: "through", messageID: SessionMessage.ID.make("msg_boundary") },
        }),
      )
      const database = yield* Database.Service
      yield* Effect.forEach(historical, (id) =>
        database.db.run(sql`update event set data = ${"{"} where aggregate_id = ${id}`).pipe(Effect.orDie),
      )
      const result = yield* query("prompt")
      expect(result.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make("ses_known")])
      expect(result.snapshotsComplete).toBe(false)
    }),
  )

  it.live("preserves reference source and query results after database close and reopen", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const filename = `${tmp.path}/references.db`
      yield* Effect.gen(function* () {
        yield* seed([Session.ID.make("ses_ref")])
        yield* attach(Session.ID.make("ses_ref"))
      }).pipe(Effect.provide(layer(filename)), Effect.scoped)
      const result = yield* query("prompt").pipe(Effect.provide(layer(filename)), Effect.scoped)
      expect(result.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([Session.ID.make("ses_ref")])
      expect(result.snapshotsComplete).toBe(true)
    }),
  )
})
