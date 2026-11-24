import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@omnixa/schema/agent"
import { Composition } from "@omnixa/schema/composition"
import { Model } from "@omnixa/schema/model"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { Global } from "@omnixa/util/global"
import { CompositionDigest } from "../src/composition/digest"
import { CompositionConsumerView } from "../src/composition/consumer-view"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionComposition } from "../src/session/composition"
import { SessionCompositionSnapshotTable, SessionTable } from "../src/session/sql"
import { testEffect } from "./lib/effect"

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })),
)
const databaseLayer = Database.layer({ path: ":memory:" }).pipe(Layer.provide(globalLayer))
const it = testEffect(SessionComposition.layer.pipe(Layer.provideMerge(databaseLayer)))
const sessionID = Session.ID.make("ses_composition_source")
const copySessionID = Session.ID.make("ses_composition_copy")
const revision = Composition.Revision.make("a".repeat(64))
const otherRevision = Composition.Revision.make("b".repeat(64))
const agentID = Agent.ID.make("asset_coder")
const catalog = [
  {
    type: "tool" as const,
    name: "read",
    description: "Read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    outputSchema: { type: "string" },
    placement: "direct" as const,
    options: { codemode: false, permission: "read" },
  },
  {
    type: "tool" as const,
    name: "execute",
    description: "A Code Mode child named execute",
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
    outputSchema: { type: "string" },
    placement: "codemode" as const,
    options: { permission: "child" },
  },
  {
    type: "tool" as const,
    name: "execute",
    description: "Run Code Mode",
    inputSchema: { type: "object", properties: { code: { type: "string" } } },
    placement: "direct" as const,
  },
  {
    type: "tool" as const,
    name: "mcp_git_list_files",
    description: "List repository files",
    inputSchema: { type: "object", properties: {} },
    placement: "codemode" as const,
    options: { codemode: true, permission: "mcp_git" },
  },
]

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values(
      [sessionID, copySessionID].map((id) => ({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "composition",
        version: "test",
      })),
    )
    .run()
    .pipe(Effect.orDie)
})

function frozenData() {
  const skill = new Composition.SnapshotSkillData({
    name: "git",
    description: "Repository workflow",
    relativePath: "git/SKILL.md",
    revision,
    content: "Inspect the diff before editing.",
  })
  const prompt = new Composition.SnapshotPromptData({
    relativePath: "review.md",
    revision,
    content: "Review the requested change.",
  })
  const command = new Composition.CommandInfo({
    name: "review",
    description: "Review changes",
    relativePath: "review.yaml",
    revision,
    invocation: "/review",
    args: "$ARGUMENTS",
    source: "Review $ARGUMENTS",
  })
  const instruction = new Composition.Instruction({ source: "AGENTS.md", content: "Run package tests." })
  const ref = new Composition.McpRef({ kind: "mcp", relativePath: "git.yaml", revision })
  return new Composition.SnapshotDataV2({
    orchestrator: Agent.Info.make({
      ...Agent.Info.empty(Agent.ID.make("meta")),
      mode: "primary",
      system: "Coordinate the frozen pool.",
      request: { settings: {}, headers: { "X-Root": "frozen" }, body: { root: true } },
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    }),
    agents: [
      new Composition.AgentInfo({
        id: agentID,
        name: "coder",
        description: "Implement changes",
        relativePath: "coder.md",
        revision,
        consumerKey: "agents/coder",
      }),
    ],
    executors: [
      new Composition.SnapshotExecutorData({
        id: agentID,
        relativePath: "coder.md",
        revision,
        info: Agent.Info.make({
          ...Agent.Info.empty(agentID),
          name: Agent.Name.make("coder"),
          model: Model.Ref.parse("openai/frozen-model#review"),
          system: "Implement the approved change.",
          steps: 4,
          request: {
            settings: { timeout: 15000 },
            headers: { "X-Agent": "coder" },
            body: { temperature: 0.2, metadata: { owner: "coder", tags: ["frozen"] } },
          },
          permissions: [{ action: "read", resource: "*", effect: "allow" }],
          originRelativePath: "coder.md",
          originRevision: revision,
        }),
      }),
    ],
    bindings: {
      orchestrator: new Composition.SnapshotBindingData({
        instructions: [instruction],
        prompts: [prompt],
        skills: [],
        commands: [command],
      }),
      "agents/coder": new Composition.SnapshotBindingData({
        instructions: [new Composition.Instruction({ source: "coder.md", content: "Implement the approved change." })],
        prompts: [prompt],
        skills: [skill],
        commands: [],
      }),
    },
    maxConcurrency: 2,
    commands: [command],
    instructions: [instruction],
    prompts: [prompt],
    skills: [skill],
    tools: CompositionDigest.captureTools(catalog, "/project#local", "test-host"),
    mcp: new Composition.SnapshotMcpInfo({
      bindings: [
        new Composition.SnapshotMcpBinding({
          serverName: "git",
          ref,
          credentialRef: "git-token",
          transportFingerprint: CompositionDigest.computeDigest({ command: "git-mcp", args: ["--stdio"] }),
        }),
      ],
      tools: [new Composition.SnapshotMcpTool({ canonicalName: "mcp_git_list_files", serverName: "git", ref })],
    }),
  })
}

function frozenSnapshot(data = frozenData()) {
  return new Composition.SnapshotV2({
    version: 2,
    digest: CompositionDigest.computeDigest("resolved-plan"),
    sessionID,
    profilePath: "dev.yaml",
    profileRevision: revision,
    createdAt: 1_790_000_000_000,
    data,
  })
}

describe("SessionComposition", () => {
  it.effect("selects and copies an explicit builtin root with a zero-member frozen pool", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const info = Agent.Info.make({
        ...Agent.Info.default(Agent.ID.make("build")),
        name: Agent.Name.make("Build"),
        mode: "all",
        system: "The frozen builtin root.",
      })
      const root = new Composition.BuiltinRoot({
        source: "builtin",
        id: "build",
        revision: Composition.Revision.make(CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(info))),
      })
      const data = new Composition.SnapshotDataV2({
        ...frozenData(),
        root,
        orchestrator: info,
        agents: [],
        executors: [],
        bindings: {
          orchestrator: new Composition.SnapshotBindingData({
            instructions: [],
            prompts: [],
            skills: [],
            commands: [],
          }),
        },
      })
      yield* composition.attach(sessionID, frozenSnapshot(data))
      const selected = yield* SessionComposition.selectSessionAgent(composition, { id: sessionID, agent: info.id })
      expect(selected.info).toEqual(info)
      expect(selected.scope).toEqual({ _tag: "scoped", key: "orchestrator" })
      expect(CompositionConsumerView.getSkills(selected.snapshot, selected.scope)).toEqual([])
      expect(yield* composition.assertAgentAllowed(sessionID, "build").pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.AgentDelegationForbiddenError",
      })
      expect(yield* composition.selectAgent(sessionID, "meta").pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.AgentDelegationForbiddenError",
      })
      const copied = yield* composition.copy(sessionID, copySessionID)
      expect(copied.data).toEqual(data)
      expect(
        yield* SessionComposition.selectSessionAgent(composition, { id: copySessionID, agent: info.id }),
      ).toMatchObject({ info, scope: { _tag: "scoped", key: "orchestrator" } })
    }),
  )

  it.effect("requires matching builtin source and definition evidence before accepting an empty pool", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const info = Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("build")), mode: "all" })
      const data = new Composition.SnapshotDataV2({
        ...frozenData(),
        root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
        orchestrator: info,
        agents: [],
        executors: [],
        bindings: {
          orchestrator: new Composition.SnapshotBindingData({
            instructions: [],
            prompts: [],
            skills: [],
            commands: [],
          }),
        },
      })
      expect(yield* composition.assertDependency(sessionID, frozenSnapshot(data)).pipe(Effect.flip)).toMatchObject({
        reason: "missing_builtin_root_revision",
      })
      expect(
        yield* composition
          .assertDependency(
            sessionID,
            frozenSnapshot(
              new Composition.SnapshotDataV2({
                ...data,
                root: new Composition.BuiltinRoot({ source: "builtin", id: "build", revision: otherRevision }),
              }),
            ),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "builtin_root_revision_mismatch" })
      expect(
        yield* composition
          .assertDependency(
            sessionID,
            frozenSnapshot(
              new Composition.SnapshotDataV2({
                ...data,
                root: undefined,
              }),
            ),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "empty_agents" })
    }),
  )

  it.effect("selects and copies asset roots by frozen source while isolating root and executors", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const root = new Composition.AssetRoot({
        source: "asset",
        id: Agent.ID.make("release-root"),
        kind: "agent",
        relativePath: "roots/release.md",
        revision: otherRevision,
      })
      const info = Agent.Info.make({
        ...Agent.Info.empty(root.id),
        mode: "all",
        system: "Frozen asset root.",
        originRelativePath: root.relativePath,
        originRevision: root.revision,
      })
      const data = new Composition.SnapshotDataV2({ ...frozenData(), root, orchestrator: info })
      yield* composition.attach(sessionID, frozenSnapshot(data))
      const selected = yield* SessionComposition.selectSessionAgent(composition, { id: sessionID, agent: info.id })
      expect(selected.info).toEqual(info)
      expect(selected.scope).toEqual({ _tag: "scoped", key: "orchestrator" })
      const executor = yield* composition.selectAgent(sessionID, agentID)
      expect(executor.scope).toEqual({ _tag: "scoped", key: "agents/coder" })
      expect(executor.info.id).toBe(agentID)
      expect(yield* composition.assertAgentAllowed(sessionID, info.id).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.AgentDelegationForbiddenError",
      })
      expect(
        yield* SessionComposition.selectSessionAgent(composition, { id: sessionID, agent: agentID }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError" })
      expect(
        yield* SessionComposition.selectSessionAgent(composition, {
          id: sessionID,
          parentID: copySessionID,
          agent: info.id,
        }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError" })
      const copied = yield* composition.copy(sessionID, copySessionID)
      expect(copied.data).toEqual(data)
      expect(
        yield* SessionComposition.selectSessionAgent(composition, { id: copySessionID, agent: info.id }),
      ).toMatchObject({ info, scope: { _tag: "scoped", key: "orchestrator" } })
    }),
  )

  it.effect("requires asset-root ID, origin and byte revision evidence without assigning Meta", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const root = new Composition.AssetRoot({
        source: "asset",
        id: Agent.ID.make("release-root"),
        kind: "agent",
        relativePath: "roots/release.md",
        revision,
      })
      const info = Agent.Info.make({
        ...Agent.Info.empty(root.id),
        mode: "primary",
        originRelativePath: root.relativePath,
        originRevision: root.revision,
      })
      const data = new Composition.SnapshotDataV2({
        ...frozenData(),
        root,
        orchestrator: info,
        agents: [],
        executors: [],
        bindings: {
          orchestrator: new Composition.SnapshotBindingData({
            instructions: [],
            prompts: [],
            skills: [],
            commands: [],
          }),
        },
      })
      expect((yield* composition.assertDependency(sessionID, frozenSnapshot(data))).data.orchestrator).toEqual(info)
      yield* Effect.forEach(
        [
          { id: Agent.ID.make("foreign") },
          { originRelativePath: undefined },
          { originRelativePath: "other.md" },
          { originRevision: undefined },
          { originRevision: otherRevision },
          { mode: "subagent" as const },
          { hidden: true },
        ],
        (update) =>
          Effect.gen(function* () {
            const invalid = frozenSnapshot(
              new Composition.SnapshotDataV2({ ...data, orchestrator: Agent.Info.make({ ...info, ...update }) }),
            )
            expect(yield* composition.assertDependency(sessionID, invalid).pipe(Effect.flip)).toMatchObject({
              reason: "asset_root_identity_mismatch",
            })
          }),
      )
      expect(
        yield* composition
          .assertDependency(
            sessionID,
            frozenSnapshot(
              new Composition.SnapshotDataV2({
                ...data,
                root: new Composition.AssetRoot({ ...root, id: Agent.ID.make("meta") }),
                orchestrator: Agent.Info.make({ ...info, id: Agent.ID.make("meta") }),
              }),
            ),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "asset_root_identity_mismatch" })
      expect(
        yield* composition
          .assertDependency(
            sessionID,
            frozenSnapshot(
              new Composition.SnapshotDataV2({
                ...frozenData(),
                root: new Composition.AssetRoot({ ...root, id: agentID }),
                orchestrator: Agent.Info.make({ ...info, id: agentID }),
              }),
            ),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "ambiguous_agent_identity" })
    }),
  )

  it.effect("persists, reads, and copies complete frozen executor and tool data", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const database = yield* Database.Service
      const snapshot = frozenSnapshot()
      expect(yield* composition.exists(sessionID)).toBe(false)
      yield* composition.attach(sessionID, snapshot)
      expect(yield* composition.exists(sessionID)).toBe(true)

      const loaded = yield* composition.assertDependency(sessionID)
      expect(loaded.version).toBe(2)
      if (loaded.version !== 2) throw new Error("Expected a V2 snapshot")
      expect(Schema.encodeSync(Composition.SnapshotV2)(loaded)).toEqual(
        Schema.encodeSync(Composition.SnapshotV2)(snapshot),
      )
      expect(loaded.data.executors?.[0].info.request).toEqual(snapshot.data.executors?.[0].info.request)
      expect(loaded.data.orchestrator).toEqual(snapshot.data.orchestrator)
      expect(loaded.data.tools.catalog.filter((name) => name === "execute")).toEqual(["execute", "execute"])
      expect(loaded.data.tools.capture).toEqual(snapshot.data.tools.capture)
      expect(loaded.data.bindings?.["agents/coder"].skills[0].content).toBe("Inspect the diff before editing.")
      expect(loaded.data.mcp.bindings[0].transportFingerprint).toBe(snapshot.data.mcp.bindings[0].transportFingerprint)

      const row = yield* database.db
        .select()
        .from(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect<unknown>(row?.data).toEqual(Schema.encodeSync(Composition.SnapshotDataV2)(snapshot.data))

      const copied = yield* composition.copy(sessionID, copySessionID)
      if (copied.version !== 2) throw new Error("Expected a copied V2 snapshot")
      expect(copied.sessionID).toBe(copySessionID)
      expect(copied.digest).toBe(snapshot.digest)
      expect(copied.profilePath).toBe(snapshot.profilePath)
      expect(copied.profileRevision).toBe(snapshot.profileRevision)
      expect(copied.createdAt).toBe(snapshot.createdAt)
      expect(Schema.encodeSync(Composition.SnapshotData)(copied.data)).toEqual(
        Schema.encodeSync(Composition.SnapshotDataV2)(snapshot.data),
      )
      expect(yield* composition.get(copySessionID)).toEqual(copied)
      expect(yield* composition.assertDependency(copySessionID)).toEqual(copied)
      yield* composition.assertAgentAllowed(copySessionID, agentID)
      yield* composition.assertAgentAllowed(copySessionID, "coder")
    }),
  )

  it.effect("selects frozen root and executor identities without exposing another consumer's assets", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const snapshot = frozenSnapshot()
      if (snapshot.data.orchestrator === undefined) throw new Error("Expected a frozen orchestrator")
      if (snapshot.data.executors?.[0] === undefined) throw new Error("Expected a frozen executor")
      yield* composition.attach(sessionID, snapshot)
      const root = yield* composition.selectAgent(sessionID, "meta")
      expect(root.info).toEqual(snapshot.data.orchestrator)
      expect(root.scope).toEqual({ _tag: "scoped", key: "orchestrator" })
      expect(CompositionConsumerView.getSkills(root.snapshot, root.scope)).toEqual([])
      expect(CompositionConsumerView.getCommands(root.snapshot, root.scope)).toEqual(snapshot.data.commands)

      const named = yield* composition.selectAgent(sessionID, "coder")
      const canonical = yield* composition.selectAgent(sessionID, agentID)
      expect(named).toEqual(canonical)
      expect(named.info).toEqual(snapshot.data.executors[0].info)
      expect(named.info.id).toBe(agentID)
      expect(named.scope).toEqual({ _tag: "scoped", key: "agents/coder" })
      expect(CompositionConsumerView.getCommands(named.snapshot, named.scope)).toEqual([])
      expect(CompositionConsumerView.getSkills(named.snapshot, named.scope)).toEqual(snapshot.data.skills)
      expect(yield* Effect.result(composition.selectAgent(sessionID, "absent"))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.AgentDelegationForbiddenError", agentID: "absent" },
      })
      expect(yield* Effect.result(composition.assertAgentAllowed(sessionID, "meta"))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.AgentDelegationForbiddenError", agentID: "meta" },
      })
    }),
  )

  it.effect("does not overwrite an attached snapshot and rejects unknown agents", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const snapshot = frozenSnapshot()
      expect(yield* composition.read(sessionID)).toBeUndefined()
      expect(yield* Effect.result(composition.get(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.SnapshotNotFoundError", sessionID },
      })
      yield* composition.attach(sessionID, snapshot)
      expect(yield* Effect.result(composition.attach(sessionID, snapshot))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.SnapshotAlreadyExistsError", sessionID },
      })
      expect(yield* Effect.result(composition.assertAgentAllowed(sessionID, "unbound"))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.AgentDelegationForbiddenError", sessionID, agentID: "unbound" },
      })
      expect(yield* composition.get(sessionID)).toEqual(snapshot)
    }),
  )

  it.effect("reads and copies historical V1 data but requires captured tools before execution", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const data = frozenData()
      const snapshot = new Composition.SnapshotV1({
        version: 1,
        digest: CompositionDigest.computeDigest("historical-plan"),
        sessionID,
        createdAt: 1_780_000_000_000,
        data: new Composition.SnapshotDataV1({
          agentID,
          instructions: data.instructions,
          prompts: data.prompts,
          skills: data.skills,
          tools: new Composition.SnapshotToolInfo({ ...data.tools, capture: undefined }),
        }),
      })
      yield* composition.attach(sessionID, snapshot)
      expect(yield* composition.read(sessionID)).toEqual(snapshot)
      const copied = yield* composition.copy(sessionID, copySessionID)
      expect(copied.version).toBe(1)
      expect(copied.sessionID).toBe(copySessionID)
      expect(copied.data).toEqual(snapshot.data)
      expect(yield* composition.get(copySessionID)).toEqual(copied)
      expect(yield* Effect.result(composition.assertDependency(copySessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.DependencyMissingError", reason: "missing_tool_capture" },
      })
    }),
  )

  it.effect("keeps V1 readable even with complete tool capture while rejecting absent executor configuration", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const data = frozenData()
      const snapshot = new Composition.SnapshotV1({
        version: 1,
        digest: CompositionDigest.computeDigest("historical-plan"),
        sessionID,
        createdAt: 1_780_000_000_000,
        data: new Composition.SnapshotDataV1({
          agentID,
          instructions: data.instructions,
          prompts: data.prompts,
          skills: data.skills,
          tools: data.tools,
        }),
      })
      yield* composition.attach(sessionID, snapshot)
      expect(yield* composition.get(sessionID)).toEqual(snapshot)
      expect(yield* Effect.result(composition.assertDependency(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "SessionComposition.DependencyMissingError", reason: "missing_executor_configuration" },
      })
    }),
  )

  it.effect("accepts an explicitly frozen empty Skill body", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const data = frozenData()
      const skill = new Composition.SnapshotSkillData({ ...data.skills[0], content: "" })
      const snapshot = frozenSnapshot(
        new Composition.SnapshotDataV2({
          ...data,
          skills: [skill],
          bindings: {
            ...data.bindings,
            "agents/coder": new Composition.SnapshotBindingData({
              ...data.bindings?.["agents/coder"],
              prompts: data.prompts,
              skills: [skill],
              commands: [],
            }),
          },
        }),
      )
      yield* composition.attach(sessionID, snapshot)
      expect(yield* composition.assertDependency(sessionID)).toEqual(snapshot)
    }),
  )

  const incomplete = [
    {
      name: "missing frozen orchestrator configuration",
      reason: "missing_orchestrator_configuration",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({ ...data, orchestrator: undefined }),
    },
    {
      name: "a user executor substituted for the root",
      reason: "orchestrator_identity_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({ ...data, orchestrator: data.executors?.[0].info }),
    },
    {
      name: "an asset-backed meta root",
      reason: "orchestrator_identity_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          orchestrator: Agent.Info.make({
            ...Agent.Info.empty(Agent.ID.make("meta")),
            mode: "primary",
            originRelativePath: "meta.md",
            originRevision: revision,
          }),
        }),
    },
    {
      name: "duplicate consumers mapped from separate agents",
      reason: "duplicate_consumer_key",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          agents: [
            ...data.agents,
            new Composition.AgentInfo({
              ...data.agents[0],
              id: "reviewer",
              name: "reviewer",
              relativePath: "reviewer.md",
            }),
          ],
        }),
    },
    {
      name: "an executor mapped to the orchestrator consumer",
      reason: "duplicate_consumer_key",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          agents: data.agents.map((agent) => new Composition.AgentInfo({ ...agent, consumerKey: "orchestrator" })),
        }),
    },
    {
      name: "an orphan consumer binding",
      reason: "orphan_consumer_binding",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          bindings: {
            ...data.bindings,
            "agents/unused": new Composition.SnapshotBindingData({
              instructions: [],
              prompts: [],
              skills: [],
              commands: [],
            }),
          },
        }),
    },
    {
      name: "a frozen Agent name matching another canonical identity",
      reason: "ambiguous_agent_identity",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          agents: [
            ...data.agents,
            new Composition.AgentInfo({
              ...data.agents[0],
              id: "reviewer",
              name: agentID,
              consumerKey: "agents/reviewer",
            }),
          ],
        }),
    },
    {
      name: "an empty top-level Command invocation",
      reason: "missing_command_invocation",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          commands: data.commands.map((command) => new Composition.CommandInfo({ ...command, invocation: "" })),
        }),
    },
    {
      name: "an empty scoped Command invocation",
      reason: "missing_command_invocation",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          bindings: {
            ...data.bindings,
            orchestrator: new Composition.SnapshotBindingData({
              ...data.bindings?.orchestrator,
              prompts: data.prompts,
              skills: [],
              commands: data.commands.map((command) => new Composition.CommandInfo({ ...command, invocation: "" })),
            }),
          },
        }),
    },
    {
      name: "a missing top-level Command body",
      reason: "missing_command_content",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          commands: data.commands.map((command) => new Composition.CommandInfo({ ...command, source: undefined })),
        }),
    },
    {
      name: "a missing scoped Command body",
      reason: "missing_command_content",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          bindings: {
            ...data.bindings,
            orchestrator: new Composition.SnapshotBindingData({
              ...data.bindings?.orchestrator,
              prompts: data.prompts,
              skills: [],
              commands: data.commands.map((command) => new Composition.CommandInfo({ ...command, source: undefined })),
            }),
          },
        }),
    },
    {
      name: "missing tool capture in historical V2 data",
      reason: "missing_tool_capture",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          executors: undefined,
          bindings: undefined,
          tools: new Composition.SnapshotToolInfo({ ...data.tools, capture: undefined }),
        }),
    },
    {
      name: "tampered tool description with unchanged fingerprints",
      reason: "tool_capture_digest_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          tools: new Composition.SnapshotToolInfo({
            ...data.tools,
            capture: data.tools.capture?.map((tool) =>
              tool !== null && typeof tool === "object" && "name" in tool && tool.name === "read"
                ? { ...tool, description: "A changed definition" }
                : tool,
            ),
          }),
        }),
    },
    {
      name: "tampered tool input schema with unchanged fingerprints",
      reason: "tool_capture_digest_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          tools: new Composition.SnapshotToolInfo({
            ...data.tools,
            capture: data.tools.capture?.map((tool) =>
              tool !== null && typeof tool === "object" && "name" in tool && tool.name === "read"
                ? { ...tool, inputSchema: { type: "object", properties: {} } }
                : tool,
            ),
          }),
        }),
    },
    {
      name: "missing executor configuration",
      reason: "missing_executor_configuration",
      update: (data: Composition.SnapshotDataV2) => new Composition.SnapshotDataV2({ ...data, executors: undefined }),
    },
    {
      name: "executor configuration count mismatch",
      reason: "missing_executor_configuration",
      update: (data: Composition.SnapshotDataV2) => new Composition.SnapshotDataV2({ ...data, executors: [] }),
    },
    {
      name: "executor Info identity mismatch",
      reason: "executor_identity_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          executors: data.executors?.map(
            (executor) =>
              new Composition.SnapshotExecutorData({
                ...executor,
                info: Agent.Info.make({ ...executor.info, id: Agent.ID.make("other") }),
              }),
          ),
        }),
    },
    {
      name: "executor asset path mismatch",
      reason: "executor_identity_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          executors: data.executors?.map(
            (executor) => new Composition.SnapshotExecutorData({ ...executor, relativePath: "other.md" }),
          ),
        }),
    },
    {
      name: "executor origin revision mismatch",
      reason: "executor_identity_mismatch",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          executors: data.executors?.map(
            (executor) =>
              new Composition.SnapshotExecutorData({
                ...executor,
                info: Agent.Info.make({ ...executor.info, originRevision: otherRevision }),
              }),
          ),
        }),
    },
    {
      name: "absent consumer binding graph",
      reason: "missing_consumer_bindings",
      update: (data: Composition.SnapshotDataV2) => new Composition.SnapshotDataV2({ ...data, bindings: undefined }),
    },
    {
      name: "missing top-level Skill body",
      reason: "missing_skill_content",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          skills: data.skills.map((skill) => new Composition.SnapshotSkillData({ ...skill, content: undefined })),
        }),
    },
    {
      name: "missing consumer Skill body",
      reason: "missing_skill_content",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          bindings: {
            ...data.bindings,
            "agents/coder": new Composition.SnapshotBindingData({
              ...data.bindings?.["agents/coder"],
              prompts: data.prompts,
              skills: data.skills.map((skill) => new Composition.SnapshotSkillData({ ...skill, content: undefined })),
              commands: [],
            }),
          },
        }),
    },
    {
      name: "missing MCP transport fingerprint",
      reason: "missing_mcp_transport_fingerprint",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          mcp: new Composition.SnapshotMcpInfo({
            ...data.mcp,
            bindings: data.mcp.bindings.map(
              (binding) => new Composition.SnapshotMcpBinding({ ...binding, transportFingerprint: undefined }),
            ),
          }),
        }),
    },
    {
      name: "invalid MCP transport fingerprint",
      reason: "missing_mcp_transport_fingerprint",
      update: (data: Composition.SnapshotDataV2) =>
        new Composition.SnapshotDataV2({
          ...data,
          mcp: new Composition.SnapshotMcpInfo({
            ...data.mcp,
            bindings: data.mcp.bindings.map(
              (binding) => new Composition.SnapshotMcpBinding({ ...binding, transportFingerprint: "invalid" }),
            ),
          }),
        }),
    },
  ]

  incomplete.forEach((scenario) => {
    it.effect(`reads but rejects ${scenario.name}`, () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        const snapshot = frozenSnapshot(scenario.update(frozenData()))
        yield* composition.attach(sessionID, snapshot)
        expect(Schema.encodeSync(Composition.Snapshot)(yield* composition.get(sessionID))).toEqual(
          Schema.encodeSync(Composition.SnapshotV2)(snapshot),
        )
        expect(yield* Effect.result(composition.assertDependency(sessionID))).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "SessionComposition.DependencyMissingError", sessionID, reason: scenario.reason },
        })
        expect(yield* Effect.result(composition.selectAgent(sessionID, "meta"))).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "SessionComposition.DependencyMissingError", sessionID, reason: scenario.reason },
        })
      }),
    )
  })
})
