import type { FileSystem } from "@aigcfroge/core/filesystem"
import path from "path"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { Bus } from "@aigcfroge/core/bus"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Config } from "@aigcfroge/core/config"
import { SkillFile } from "@aigcfroge/core/config/plugin/skill-file"
import { ManagedPolicy } from "@aigcfroge/core/managed-policy"
import { Image } from "@aigcfroge/core/image"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import type { LocationServices } from "@aigcfroge/core/location-services"
import { Project } from "@aigcfroge/core/project"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionSkill } from "@aigcfroge/core/session/skill"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { Skill } from "@aigcfroge/core/skill"
import { Composition } from "@aigcfroge/schema/composition"
import { Event } from "@aigcfroge/schema/event"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { withCustomMode } from "./lib/product-mode"
import { globalProjectNode } from "./lib/project"
import { registerIntegrationPolicy } from "./fixture/policy"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const info = Skill.Info.make({
  id: Skill.ID.make("effect"),
  name: Skill.Name.make("Effect"),
  description: "Effect guidance",
  path: AbsolutePath.make(path.resolve("/skills/effect.md")),
  content: "  Use Effect\n",
})
const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const managed = yield* ManagedPolicy.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          // These tests need skill activation and prompt preparation from the same location services.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          Layer.mergeAll(
            Layer.effectDiscard(
              Effect.gen(function* () {
                const skills = yield* Skill.Service
                yield* skills.transform((editor) => editor.add(info))
                yield* registerIntegrationPolicy({ skill: skills })
              }),
            ).pipe(
              Layer.provideMerge(
                LayerNode.compile(
                  LayerNode.group([
                    Agent.node,
                    PluginHooks.node,
                    Image.node,
                    Skill.node,
                    Config.node,
                    ManagedPolicy.node,
                  ]),
                  {
                    replacements: [
                      Config.node.replace(Config.testLayer()),
                      ManagedPolicy.node.replace(Layer.succeed(ManagedPolicy.Service, managed)),
                    ],
                  },
                ),
              ),
            ),
            Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
          ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
        { idleTimeToLive: Duration.infinity },
      )
    }),
  ),
  deps: [ManagedPolicy.node],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionComposition.node,
      Session.node,
      ManagedPolicy.node,
      LocationServiceMap.node,
    ]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const frozenSkill = (relativePath: string, content: string) =>
  new Composition.SnapshotSkillData({
    name: `Frozen ${relativePath}`,
    description: "Frozen guidance",
    relativePath,
    revision: Composition.Revision.make("a".repeat(64)),
    content,
  })
const rootSkill = frozenSkill("effect.md", "Frozen root instructions")
const childSkill = frozenSkill("child-effect.md", "Frozen child instructions")
const flatSkill = frozenSkill("unbound.md", "Flat instructions must remain outside the consumer")
const frozenInfo = (skill: Composition.SnapshotSkillData) => {
  const directory = path.join(location.directory, ".aigcfroge/skills")
  const filepath = path.join(directory, skill.relativePath)
  return Skill.Info.make({
    id: SkillFile.id(directory, filepath),
    name: Skill.Name.make(skill.name),
    description: skill.description,
    path: AbsolutePath.make(filepath),
    content: skill.content ?? "",
  })
}

const setupCustom = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const database = yield* Database.Service
  const root = yield* sessions.create({ location })
  const executor = Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("coder")), mode: "subagent" })
  const child = yield* sessions.create({ parentID: root.id, agent: executor.id })
  const snapshot = yield* CompositionFixture.attach(root.id, executor)
  const data = new Composition.SnapshotDataV2({
    ...snapshot.data,
    skills: [rootSkill, childSkill, flatSkill],
    bindings: {
      orchestrator: new Composition.SnapshotBindingData({
        instructions: [],
        prompts: [],
        skills: [rootSkill],
        commands: [],
      }),
      "agents/coder": new Composition.SnapshotBindingData({
        instructions: [],
        prompts: [],
        skills: [childSkill],
        commands: [],
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
  return { root: yield* sessions.get(root.id), child: yield* sessions.get(child.id), data }
})

describe("Session.skill", () => {
  it.effect("refuses blocked skill mentions and standalone activation without writing their content", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const managed = yield* ManagedPolicy.Service
      const session = yield* sessions.create({ location })
      yield* managed.set({ statements: [{ action: "integration.use", resource: "skill:effect", effect: "deny" }] })
      expect(
        yield* sessions.skill({ sessionID: session.id, skill: info.id, resume: false }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: info.id })
      expect(
        yield* sessions
          .prompt({
            sessionID: session.id,
            text: "@effect",
            skills: [{ id: info.id, mention: { start: 0, end: 7, text: "@effect" } }],
            resume: false,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: info.id })
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )

  it.effect("materializes mentioned skills on their owning prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_skill_attachment")

      yield* sessions.prompt({
        id,
        sessionID: session.id,
        text: "Apply @effect and @effect",
        skills: [
          { id: Skill.ID.make("effect"), mention: { start: 6, end: 13, text: "@effect" } },
          { id: Skill.ID.make("effect"), mention: { start: 18, end: 25, text: "@effect" } },
        ],
        resume: false,
      })
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")

      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([
        expect.objectContaining({
          id,
          type: "user",
          text: "Apply @effect and @effect",
          skills: [
            {
              id: "effect",
              name: "Effect",
              text: Skill.toModelOutput(info, []),
              mention: { start: 6, end: 13, text: "@effect" },
            },
            {
              id: "effect",
              name: "Effect",
              mention: { start: 18, end: 25, text: "@effect" },
            },
          ],
        }),
      ])
    }),
  )

  it.effect("excludes mentioned skills when forking before their prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const initial = SessionMessage.ID.make("msg_before_skill_attachment")
      const selected = SessionMessage.ID.make("msg_fork_skill_attachment")

      yield* sessions.prompt({ id: initial, sessionID: session.id, text: "Before the skill", resume: false })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      yield* sessions.prompt({
        id: selected,
        sessionID: session.id,
        text: "Apply @effect",
        skills: [{ id: info.id, mention: { start: 6, end: 13, text: "@effect" } }],
        resume: false,
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      const forked = yield* sessions.fork({ sessionID: session.id, before: selected })

      expect(yield* sessions.messages({ sessionID: forked.id })).toEqual([
        expect.objectContaining({ type: "user", text: "Before the skill" }),
      ])
    }),
  )

  it.effect("publishes raw standalone content under the caller-supplied ID without inbox admission", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_caller_skill")
      const locations = yield* LocationServiceMap.Service
      yield* Skill.Service.use((skills) => skills.list()).pipe(Effect.provide(locations.get(session.location)))
      const events: Event.Payload[] = []
      yield* bus.listen((event) =>
        Effect.sync(() => {
          events.push(event)
        }),
      )

      yield* sessions.skill({ messageID: id, sessionID: session.id, skill: Skill.ID.make("effect"), resume: false })

      expect(events).toEqual([
        expect.objectContaining({
          id: "evt_caller_skill",
          type: SessionEvent.Skill.Activated.type,
          data: { sessionID: session.id, id: info.id, name: info.name, text: info.content },
        }),
      ])
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([
        expect.objectContaining({ id, type: "skill", skill: "effect", name: "Effect", text: info.content }),
      ])
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )
})

describe("Custom explicit Skill selection", () => {
  it.effect("uses each consumer's frozen body for standalone activation and mentioned Skills after live edits", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const selected = yield* setupCustom
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const locations = yield* LocationServiceMap.Service
        yield* Skill.Service.use((skills) =>
          skills.transform((editor) => {
            editor.add(
              Skill.Info.make({ ...info, name: Skill.Name.make("Live changed"), content: "Live changed body" }),
            )
            editor.add(Skill.Info.make({ ...frozenInfo(childSkill), content: "Live changed child body" }))
          }),
        ).pipe(Effect.provide(locations.get(location)))

        yield* Effect.forEach(
          [
            { session: selected.root, skill: frozenInfo(rootSkill) },
            { session: selected.child, skill: frozenInfo(childSkill) },
          ],
          (consumer) =>
            Effect.gen(function* () {
              const activation = SessionMessage.ID.create()
              yield* sessions.skill({
                messageID: activation,
                sessionID: consumer.session.id,
                skill: consumer.skill.id,
                resume: false,
              })
              const prompt = yield* sessions.prompt({
                sessionID: consumer.session.id,
                text: "Apply the frozen Skill twice",
                skills: [{ id: consumer.skill.id }, { id: consumer.skill.id }],
                resume: false,
              })
              yield* SessionInbox.promote(database.db, bus, consumer.session.id, "steer")
              expect(yield* sessions.messages({ sessionID: consumer.session.id, order: "asc" })).toEqual([
                expect.objectContaining({
                  id: activation,
                  type: "skill",
                  skill: consumer.skill.id,
                  name: consumer.skill.name,
                  text: consumer.skill.content,
                }),
                expect.objectContaining({
                  id: prompt.id,
                  type: "user",
                  skills: [
                    { id: consumer.skill.id, name: consumer.skill.name, text: Skill.toModelOutput(consumer.skill, []) },
                    { id: consumer.skill.id, name: consumer.skill.name },
                  ],
                }),
              ])
            }),
        )
      }),
    ),
  )

  it.effect("keeps frozen activation and attachments usable after the live Skills are deleted", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const selected = yield* setupCustom
        const sessions = yield* Session.Service
        const locations = yield* LocationServiceMap.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        yield* Skill.Service.use((skills) =>
          skills.transform((editor) => {
            editor.add(frozenInfo(childSkill))
            editor.remove(info.id)
            editor.remove(frozenInfo(childSkill).id)
          }),
        ).pipe(Effect.provide(locations.get(location)))
        yield* sessions.skill({ sessionID: selected.root.id, skill: info.id, resume: false })
        yield* sessions.prompt({
          sessionID: selected.child.id,
          text: "Apply a deleted live Skill",
          skills: [{ id: frozenInfo(childSkill).id }],
          resume: false,
        })
        yield* SessionInbox.promote(database.db, bus, selected.child.id, "steer")
        expect(yield* sessions.messages({ sessionID: selected.root.id })).toEqual([
          expect.objectContaining({ type: "skill", text: rootSkill.content, name: rootSkill.name }),
        ])
        expect(yield* sessions.messages({ sessionID: selected.child.id })).toEqual([
          expect.objectContaining({
            type: "user",
            skills: [
              {
                id: frozenInfo(childSkill).id,
                name: childSkill.name,
                text: Skill.toModelOutput(frozenInfo(childSkill), []),
              },
            ],
          }),
        ])
      }),
    ),
  )

  it.effect(
    "rejects cross-consumer and unbound Skills without writing content or falling back from an empty binding",
    () =>
      withCustomMode(
        "true",
        Effect.gen(function* () {
          const selected = yield* setupCustom
          const sessions = yield* Session.Service
          const database = yield* Database.Service
          const locations = yield* LocationServiceMap.Service
          yield* Skill.Service.use((skills) =>
            skills.transform((editor) => {
              editor.add(frozenInfo(childSkill))
              editor.add(frozenInfo(flatSkill))
            }),
          ).pipe(Effect.provide(locations.get(location)))
          yield* Effect.forEach(
            [
              { session: selected.root, skill: frozenInfo(childSkill).id },
              { session: selected.child, skill: info.id },
              { session: selected.root, skill: frozenInfo(flatSkill).id },
            ],
            (request) =>
              Effect.gen(function* () {
                expect(
                  yield* sessions
                    .skill({ sessionID: request.session.id, skill: request.skill, resume: false })
                    .pipe(Effect.flip),
                ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: request.skill })
                expect(
                  yield* sessions
                    .prompt({
                      sessionID: request.session.id,
                      text: "Cannot use this Skill",
                      skills: [{ id: request.skill }],
                      resume: false,
                    })
                    .pipe(Effect.flip),
                ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: request.skill })
                expect(yield* sessions.messages({ sessionID: request.session.id })).toEqual([])
                expect(yield* sessions.inbox(request.session.id)).toEqual([])
              }),
          )
          yield* database.db
            .update(SessionCompositionSnapshotTable)
            .set({
              data: new Composition.SnapshotDataV2({
                ...selected.data,
                bindings: {
                  ...selected.data.bindings,
                  orchestrator: new Composition.SnapshotBindingData({
                    instructions: [],
                    prompts: [],
                    skills: [],
                    commands: [],
                  }),
                },
              }),
            })
            .where(eq(SessionCompositionSnapshotTable.session_id, selected.root.id))
            .run()
            .pipe(Effect.orDie)
          expect(
            yield* sessions.skill({ sessionID: selected.root.id, skill: info.id, resume: false }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: info.id })
          expect(yield* sessions.messages({ sessionID: selected.root.id })).toEqual([])
          yield* Effect.forEach(
            [
              { session: selected.root, agent: Agent.ID.make("coder"), skill: frozenInfo(childSkill).id },
              { session: selected.child, agent: Agent.ID.make("meta"), skill: info.id },
            ],
            (invalid) =>
              Effect.gen(function* () {
                yield* database.db
                  .update(SessionTable)
                  .set({ agent: invalid.agent })
                  .where(eq(SessionTable.id, invalid.session.id))
                  .run()
                  .pipe(Effect.orDie)
                expect(
                  yield* sessions
                    .skill({ sessionID: invalid.session.id, skill: invalid.skill, resume: false })
                    .pipe(Effect.flip),
                ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError" })
                expect(
                  yield* sessions
                    .prompt({
                      sessionID: invalid.session.id,
                      text: "The selected Agent is invalid for this Session",
                      skills: [{ id: invalid.skill }],
                      resume: false,
                    })
                    .pipe(Effect.flip),
                ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError" })
                expect(yield* sessions.messages({ sessionID: invalid.session.id })).toEqual([])
                expect(yield* sessions.inbox(invalid.session.id)).toEqual([])
              }),
          )
        }),
      ),
  )

  it.effect("rejects missing and incomplete snapshots before activating or admitting live Skill content", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const selected = yield* setupCustom
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        yield* database.db
          .delete(SessionCompositionSnapshotTable)
          .where(eq(SessionCompositionSnapshotTable.session_id, selected.root.id))
          .run()
          .pipe(Effect.orDie)
        const incomplete = new Composition.SnapshotSkillData({
          name: childSkill.name,
          description: childSkill.description,
          relativePath: childSkill.relativePath,
          revision: childSkill.revision,
        })
        yield* database.db
          .update(SessionCompositionSnapshotTable)
          .set({
            data: new Composition.SnapshotDataV2({
              ...selected.data,
              bindings: {
                ...selected.data.bindings,
                "agents/coder": new Composition.SnapshotBindingData({
                  instructions: [],
                  prompts: [],
                  skills: [incomplete],
                  commands: [],
                }),
              },
            }),
          })
          .where(eq(SessionCompositionSnapshotTable.session_id, selected.child.id))
          .run()
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          [
            { session: selected.root, skill: info.id, tag: "SessionComposition.SnapshotNotFoundError" },
            {
              session: selected.child,
              skill: frozenInfo(childSkill).id,
              tag: "SessionComposition.DependencyMissingError",
            },
          ],
          (request) =>
            Effect.gen(function* () {
              expect(
                yield* sessions
                  .skill({ sessionID: request.session.id, skill: request.skill, resume: false })
                  .pipe(Effect.flip),
              ).toMatchObject({ _tag: request.tag })
              expect(
                yield* sessions
                  .prompt({
                    sessionID: request.session.id,
                    text: "A frozen snapshot is required",
                    skills: [{ id: request.skill }],
                    resume: false,
                  })
                  .pipe(Effect.flip),
              ).toMatchObject({ _tag: request.tag })
              expect(yield* sessions.messages({ sessionID: request.session.id })).toEqual([])
              expect(yield* sessions.inbox(request.session.id)).toEqual([])
            }),
        )
      }),
    ),
  )

  it.effect("keeps selection without Session context on the live Skill owner", () =>
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      expect(yield* SessionSkill.select({ skill: info.id }).pipe(Effect.provide(locations.get(location)))).toEqual(info)
    }),
  )
})
