import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Agent } from "@omnixa/core/agent"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Permission } from "@omnixa/core/permission"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { Composition } from "@omnixa/schema/composition"
import { CompositionDigest } from "@omnixa/core/composition/digest"
import { Database } from "@omnixa/core/database/database"
import { Location } from "@omnixa/core/location"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionCompositionSnapshotTable, SessionTable } from "@omnixa/core/session/sql"
import { SessionStore } from "@omnixa/core/session/store"
import { Skill } from "@omnixa/core/skill"
import { Config } from "@omnixa/core/config"
import { ManagedPolicy } from "@omnixa/core/managed-policy"
import { SkillTool } from "@omnixa/core/tool/plugin/skill"
import { Tool } from "@omnixa/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { Image } from "@omnixa/core/image"
import { it } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { FSUtil } from "@omnixa/util/fs-util"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"
import { registerIntegrationPolicy } from "./fixture/policy"

const skillToolNode = makeLocationNode({
  name: "test/skill-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(SkillTool.Plugin)),
  deps: [
    Tool.node,
    FSUtil.node,
    Skill.node,
    Permission.node,
    SessionStore.node,
    SessionComposition.node,
    Location.node,
  ],
})

const sessionID = Session.ID.make("ses_skill_tool_test")
const agentID = Agent.ID.make("asset_coder")
const revision = Composition.Revision.make("a".repeat(64))

describe("SkillTool", () => {
  it.effect("refuses a policy-blocked skill before authorization or content preparation", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const managed = yield* ManagedPolicy.Service
      const tools = yield* Tool.Service
      // This path does not exist; an attempted content scan would fail the test.
      yield* skills.transform((editor) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("private"),
            name: Skill.Name.make("Private"),
            path: AbsolutePath.make("/unavailable/private/SKILL.md"),
            content: "Private instructions",
          }),
        ),
      )
      yield* managed.set({ statements: [{ action: "integration.use", resource: "skill:private", effect: "deny" }] })
      yield* registerIntegrationPolicy({ skill: skills })
      expect(
        yield* executeTool(tools, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-policy-denied-skill", name: "skill", input: { id: "private" } },
        }),
      ).toEqual({ status: "error", error: { type: "tool.execution", message: "Unable to load skill private" } })
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Tool.node, skillToolNode, Skill.node, Config.node, ManagedPolicy.node]), [
          Config.node.replace(Config.testLayer()),
          Permission.node.replace(permissionLayer({ assert: () => Effect.die("Blocked skill reached authorization") })),
          Image.node.replace(imagePassthrough),
          Location.node.replace(
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
            ),
          ),
        ]),
      ),
    ),
  )

  it.live("lists available skills, authorizes the selected ID, and loads model-facing content", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "effect")
          const filepath = path.join(directory, "SKILL.md")
          const reference = path.join(directory, "reference.md")
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() =>
            Promise.all([fs.writeFile(filepath, "unused"), fs.writeFile(reference, "reference")]),
          )

          const info: Skill.Info = {
            id: Skill.ID.make("effect"),
            name: Skill.Name.make("Effect"),
            description: "Use Effect",
            path: AbsolutePath.make(filepath),
            content: "# Effect\n\nGuidance",
          }
          let current = [info]
          const assertions: Permission.AssertInput[] = []
          let deny = false
          const permission = permissionLayer({
            assert: (input) =>
              Effect.sync(() => assertions.push(input)).pipe(
                Effect.andThen(
                  deny
                    ? Effect.fail(
                        new Permission.BlockedError({
                          rules: [],
                          permission: input.action,
                          resources: input.resources,
                        }),
                      )
                    : Effect.void,
                ),
              ),
          })
          const skills = Layer.mock(Skill.Service, {
            get: (id) => Effect.succeed(current.find((skill) => skill.id === id)),
            list: () => Effect.succeed(current),
          })
          const skillToolLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, skillToolNode]), [
            Permission.node.replace(permission),
            Skill.node.replace(skills),
            Image.node.replace(imagePassthrough),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            ),
          ])

          return yield* Effect.gen(function* () {
            const registry = yield* Tool.Service
            expect((yield* toolDefinitions(registry))[0]).toMatchObject({
              name: "skill",
              description: SkillTool.description,
            })
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill", name: "skill", input: { id: "effect" } },
              }),
            ).toMatchObject({
              status: "completed",
              content: [{ type: "text", text: Skill.toModelOutput(info, [reference]) }],
            })
            expect(Skill.toModelOutput(info, [reference])).toContain(`Base directory for this skill: ${directory}`)
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill-overflow", name: "skill", input: { id: "effect" } },
              }),
            ).toEqual({
              status: "completed",
              output: { name: "Effect", directory, output: Skill.toModelOutput(info, [reference]) },
              content: [{ type: "text", text: Skill.toModelOutput(info, [reference]) }],
              metadata: { name: "Effect", directory },
            })
            expect(assertions).toMatchObject([
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
            ])
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-missing-skill", name: "skill", input: { id: "missing" } },
              }),
            ).toEqual({
              status: "error",
              error: { type: "tool.execution", message: "Unable to load skill missing" },
            })
            deny = true
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-denied-skill", name: "skill", input: { id: "effect" } },
              }),
            ).toEqual({
              status: "error",
              error: { type: "permission.rejected", message: "Permission denied: skill" },
            })
            deny = false
            const flat = Skill.Info.make({
              id: Skill.ID.make("public"),
              name: Skill.Name.make("Public"),
              description: "Public guidance",
              path: AbsolutePath.make(path.join(tmp.path, "public.md")),
              content: "Public",
            })
            yield* Effect.promise(() =>
              Promise.all([
                fs.writeFile(flat.path, "public"),
                fs.writeFile(path.join(tmp.path, "secret.md"), "secret"),
              ]),
            )
            current = [flat]
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-flat-skill", name: "skill", input: { id: "public" } },
              }),
            ).toMatchObject({
              status: "completed",
              content: [{ type: "text", text: Skill.toModelOutput(flat, []) }],
            })
          }).pipe(Effect.provide(skillToolLayer))
        }),
      ),
    ),
  )

  it.live("uses the invocation Agent's frozen skills and authorizes every invocation", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const directory = path.join(tmp.path, ".omnixa", "skills", "effect")
        const reference = path.join(directory, "reference.md")
        const assertions: Permission.AssertInput[] = []
        const authorization = { deny: false }
        const permission = permissionLayer({
          assert: (input) =>
            Effect.gen(function* () {
              assertions.push(input)
              if (authorization.deny)
                return yield* new Permission.BlockedError({
                  rules: [],
                  permission: input.action,
                  resources: input.resources,
                })
            }),
        })
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(path.join(directory, "SKILL.md"), "Changed instructions on disk"),
              fs.writeFile(reference, "Current reference"),
            ]),
          )
          const content = "# Frozen Effect\n\nUse the approved workflow."
          const frozen = new Composition.SnapshotSkillData({
            name: "Frozen Effect",
            description: "Frozen workflow",
            relativePath: "effect/SKILL.md",
            revision,
            content,
          })
          const empty = new Composition.SnapshotSkillData({
            name: "Empty",
            description: "Empty frozen workflow",
            relativePath: "empty.md",
            revision,
            content: "",
          })
          const privateSkill = new Composition.SnapshotSkillData({
            name: "Root private",
            description: "Root only",
            relativePath: "private.md",
            revision,
            content: "Only the orchestrator may use this workflow.",
          })
          const expected = Skill.Info.make({
            id: Skill.ID.make("effect"),
            name: Skill.Name.make(frozen.name),
            description: frozen.description,
            path: AbsolutePath.make(path.join(directory, "SKILL.md")),
            content,
          })
          const skills = yield* Skill.Service
          yield* skills.transform((editor) => {
            editor.add({ ...expected, name: Skill.Name.make("Live Effect"), content: "Live registry instructions" })
            editor.add(
              Skill.Info.make({
                id: Skill.ID.make("live-only"),
                name: Skill.Name.make("Frozen Effect"),
                description: "Same display name, no frozen binding",
                path: AbsolutePath.make("/unavailable/live-only/SKILL.md"),
                content: "Unbound live instructions",
              }),
            )
          })
          yield* createCustomSession(tmp.path, sessionID)
          const registry = yield* Tool.Service
          const composition = yield* SessionComposition.Service
          yield* composition.attach(
            sessionID,
            customSnapshot(tmp.path, sessionID, yield* registry.snapshot(), [frozen, empty], [privateSkill]),
          )
          const sessions = yield* SessionStore.Service
          expect((yield* sessions.get(sessionID))?.agent).toBe(Agent.ID.make("meta"))

          yield* Effect.forEach(["call-frozen-skill", "call-frozen-skill-again"], (id) =>
            Effect.gen(function* () {
              expect(
                yield* executeTool(registry, {
                  sessionID,
                  ...toolIdentity,
                  agent: agentID,
                  call: { type: "tool-call", id, name: "skill", input: { id: "effect" } },
                }),
              ).toMatchObject({
                status: "completed",
                content: [{ type: "text", text: Skill.toModelOutput(expected, [reference]) }],
              })
            }),
          )
          expect(assertions).toEqual(
            ["call-frozen-skill", "call-frozen-skill-again"].map((id) => ({
              sessionID,
              agent: agentID,
              action: "skill",
              resources: ["effect"],
              save: ["effect"],
              source: { type: "tool", messageID: toolIdentity.messageID, id },
            })),
          )

          yield* Effect.forEach(
            [
              { agent: agentID, id: "private" },
              { agent: agentID, id: "live-only" },
              { agent: agentID, id: "Frozen Effect" },
              { agent: Agent.ID.make("meta"), id: "effect" },
            ],
            (input) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(registry, {
                    sessionID,
                    ...toolIdentity,
                    agent: input.agent,
                    call: { type: "tool-call", id: `call-unbound-${input.id}`, name: "skill", input: { id: input.id } },
                  }),
                ).toEqual({
                  status: "error",
                  error: { type: "tool.execution", message: `Unable to load skill ${input.id}` },
                })
              }),
          )
          expect(assertions).toHaveLength(2)

          authorization.deny = true
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              agent: agentID,
              call: { type: "tool-call", id: "call-frozen-denied", name: "skill", input: { id: "effect" } },
            }),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: skill" },
          })
          expect(assertions).toHaveLength(3)
          authorization.deny = false
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              agent: agentID,
              call: { type: "tool-call", id: "call-frozen-empty", name: "skill", input: { id: "empty" } },
            }),
          ).toMatchObject({
            status: "completed",
            content: [
              {
                type: "text",
                text: Skill.toModelOutput(
                  Skill.Info.make({
                    id: Skill.ID.make("empty"),
                    name: Skill.Name.make(empty.name),
                    description: empty.description,
                    path: AbsolutePath.make(path.join(tmp.path, ".omnixa", "skills", "empty.md")),
                    content: "",
                  }),
                  [],
                ),
              },
            ],
          })
          expect(assertions).toHaveLength(4)

          const database = yield* Database.Service
          yield* database.db
            .update(SessionTable)
            .set({ directory: path.join(tmp.path, "moved") })
            .where(eq(SessionTable.id, sessionID))
            .run()
            .pipe(Effect.orDie)
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              agent: agentID,
              call: { type: "tool-call", id: "call-moved-skill", name: "skill", input: { id: "effect" } },
            }),
          ).toEqual({
            status: "error",
            error: { type: "tool.execution", message: "Unable to load skill effect" },
          })
          expect(assertions).toHaveLength(4)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                Tool.node,
                skillToolNode,
                Skill.node,
                SessionStore.node,
                SessionComposition.node,
                Database.node,
              ]),
              [
                Permission.node.replace(permission),
                Image.node.replace(imagePassthrough),
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
                  ),
                ),
              ],
            ),
          ),
        )
      }),
    ),
  )

  it.live("refuses historical missing Skill bodies before authorization or live fallback", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const skills = yield* Skill.Service
          yield* skills.transform((editor) =>
            editor.add(
              Skill.Info.make({
                id: Skill.ID.make("effect"),
                name: Skill.Name.make("Live Effect"),
                path: AbsolutePath.make("/unavailable/live-effect/SKILL.md"),
                content: "Live fallback must never load",
              }),
            ),
          )
          yield* createCustomSession(tmp.path, sessionID)
          const registry = yield* Tool.Service
          const frozen = new Composition.SnapshotSkillData({
            name: "Frozen Effect",
            description: "Frozen workflow",
            relativePath: "effect/SKILL.md",
            revision,
            content: "Top-level body does not replace a missing consumer body.",
          })
          const snapshot = customSnapshot(tmp.path, sessionID, yield* registry.snapshot(), [frozen])
          const missing = new Composition.SnapshotSkillData({
            name: frozen.name,
            description: frozen.description,
            relativePath: frozen.relativePath,
            revision,
          })
          const data = new Composition.SnapshotDataV2({
            ...snapshot.data,
            bindings: {
              ...snapshot.data.bindings,
              "agents/coder": new Composition.SnapshotBindingData({ prompts: [], skills: [missing], commands: [] }),
            },
          })
          const database = yield* Database.Service
          yield* database.db
            .insert(SessionCompositionSnapshotTable)
            .values({
              session_id: sessionID,
              version: snapshot.version,
              digest: snapshot.digest,
              data,
              time_created: snapshot.createdAt,
            })
            .run()
            .pipe(Effect.orDie)
          const composition = yield* SessionComposition.Service
          expect((yield* composition.get(sessionID)).data.skills[0].content).toBe(frozen.content)
          expect(yield* Effect.result(composition.selectAgent(sessionID, agentID))).toMatchObject({
            _tag: "Failure",
            failure: { reason: "missing_skill_content" },
          })
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              agent: agentID,
              call: { type: "tool-call", id: "call-historical-skill", name: "skill", input: { id: "effect" } },
            }),
          ).toEqual({
            status: "error",
            error: { type: "tool.execution", message: "Unable to load skill effect" },
          })
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([Tool.node, skillToolNode, Skill.node, SessionComposition.node, Database.node]),
              [
                Permission.node.replace(
                  permissionLayer({ assert: () => Effect.die("Missing body reached authorization") }),
                ),
                Image.node.replace(imagePassthrough),
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  )
})

const createCustomSession = Effect.fnUntraced(function* (directory: string, id: Session.ID) {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({
      id: Project.ID.global,
      worktree: AbsolutePath.make(directory),
      sandboxes: [],
    })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      slug: id,
      directory,
      mode: "custom",
      agent: "meta",
      title: "Frozen Skill tool",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

function customSnapshot(
  directory: string,
  id: Session.ID,
  toolSet: Tool.Snapshot,
  skills: ReadonlyArray<Composition.SnapshotSkillData>,
  rootSkills: ReadonlyArray<Composition.SnapshotSkillData> = [],
) {
  return new Composition.SnapshotV2({
    version: 2,
    digest: CompositionDigest.computeDigest("frozen-skill-tool"),
    sessionID: id,
    createdAt: 1_790_000_000_000,
    data: new Composition.SnapshotDataV2({
      orchestrator: Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("meta")), mode: "primary" }),
      agents: [
        new Composition.AgentInfo({
          id: agentID,
          name: "coder",
          description: "Frozen executor",
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
            originRelativePath: "coder.md",
            originRevision: revision,
          }),
        }),
      ],
      bindings: {
        orchestrator: new Composition.SnapshotBindingData({ prompts: [], skills: rootSkills, commands: [] }),
        "agents/coder": new Composition.SnapshotBindingData({ prompts: [], skills, commands: [] }),
      },
      instructions: [],
      prompts: [],
      skills: [...skills, ...rootSkills],
      tools: CompositionDigest.captureTools(toolSet.catalog, `${directory}#local`, "test-host"),
      mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
    }),
  })
}
