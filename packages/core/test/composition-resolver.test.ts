import { describe, expect } from "bun:test"
import path from "path"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Composition } from "@omnixa/schema/composition"
import { Model } from "@omnixa/schema/model"
import { CrossSpawnSpawner } from "@omnixa/util/cross-spawn-spawner"
import { FSUtil } from "@omnixa/util/fs-util"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Agent } from "../src/agent"
import { AgentAsset } from "../src/agent-asset"
import { App } from "../src/app"
import { AssetPlacement } from "../src/asset-placement"
import { Bus } from "../src/bus"
import { CommandAsset } from "../src/command-asset"
import { CompositionDigest } from "../src/composition/digest"
import { CompositionResolver } from "../src/composition-resolver"
import { Config } from "../src/config"
import { ModelGroup } from "../src/model-group"
import { CustomProfile } from "../src/custom-profile"
import { Credential } from "../src/credential"
import { CredentialScanner } from "../src/credential-scanner"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Image } from "../src/image"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { MCPAsset } from "../src/mcp-asset"
import { McpConnection } from "../src/mcp/connection"
import { McpCredentialBindingStore } from "../src/mcp/binding/store"
import { PromptAsset } from "../src/prompt-asset"
import { AgentPlugin } from "../src/plugin/agent"
import { PlanPlugin } from "../src/plugin/plan"
import { AbsolutePath } from "../src/schema"
import { SkillAsset } from "../src/skill-asset"
import { Tool } from "../src/tool"
import { McpRegistration } from "../src/tool/mcp-registration"
import { AssetYaml } from "../src/util/asset-yaml"
import { WorkflowAsset } from "../src/workflow-asset"
import { location } from "./fixture/location"
import { tempGlobalLayer } from "./fixture/global"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { withCustomMode } from "./lib/product-mode"
import { agentHost, host } from "./plugin/host"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const it = testEffect(fsLayer)
const toolLayer = AppNodeBuilder.build(LayerNode.group([Tool.node]), [
  Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
])
const runtimeAgentLayer = AppNodeBuilder.build(LayerNode.group([Agent.node])).pipe(
  Layer.tap((context) => AgentPlugin.Plugin.effect(host({ agent: agentHost(Context.get(context, Agent.Service)) }))),
)
const catalogLayer = Layer.mergeAll(
  PromptAsset.layer,
  SkillAsset.layer,
  CommandAsset.layer,
  WorkflowAsset.layer,
  MCPAsset.layer,
)

function fullLayer(
  directory: string,
  options: {
    readonly facts?: readonly McpConnection.Fact[]
    readonly readFacts?: McpConnection.Interface["facts"]
    readonly tools?: Tool.Interface
    readonly agentLayer?: typeof AgentAsset.layer
    readonly profileLayer?: typeof CustomProfile.layer
    readonly catalogLayer?: typeof catalogLayer
    readonly runtimeAgentLayer?: Layer.Layer<Agent.Service>
    readonly location?: Location.Interface
    readonly global?: Global.Interface
  } = {},
) {
  return CompositionResolver.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        options.profileLayer ?? CustomProfile.layer,
        options.agentLayer ?? AgentAsset.layer,
        options.catalogLayer ?? catalogLayer,
        options.runtimeAgentLayer ?? runtimeAgentLayer,
        ModelGroup.layer.pipe(Layer.provide(Config.testLayer([]))),
        options.tools ? Layer.succeed(Tool.Service, options.tools) : toolLayer,
        // Only the read-only owner facts boundary is synthetic. Every omitted
        // connection method dies, so preview cannot silently connect or execute.
        Layer.mock(McpConnection.Service, { facts: options.readFacts ?? (() => Effect.succeed(options.facts ?? [])) }),
      ),
    ),
    Layer.provide(LocationMutation.layer),
    Layer.provide(
      Layer.succeed(
        Location.Service,
        options.location ?? Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
      ),
    ),
    Layer.provide(fsLayer),
    Layer.provide(options.global === undefined ? tempGlobalLayer : Layer.succeed(Global.Service, options.global)),
    Layer.fresh,
  )
}

const readCounts = () => ({ agent: 0, prompt: 0, skill: 0, workflow: 0, command: 0, mcp: 0, profiles: 0 })

function trackedAssetLayers(reads: ReturnType<typeof readCounts>, sourceReads?: Map<string, number>) {
  const track = <A>(kind: Composition.AllowedKind, value: Effect.Effect<A>) =>
    value.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          reads[kind] += 1
        }),
      ),
    )
  const source = <A, E>(kind: Composition.AllowedKind, scope: string, operation: string, value: Effect.Effect<A, E>) =>
    value.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (sourceReads === undefined) return
          const key = `${kind}/${scope}/${operation}`
          sourceReads.set(key, (sourceReads.get(key) ?? 0) + 1)
        }),
      ),
    )
  const agentLayer = Layer.effect(
    AgentAsset.Service,
    Effect.gen(function* () {
      const real = yield* AgentAsset.Service
      return AgentAsset.Service.of({ ...real, list: () => track("agent", real.list()) })
    }),
  ).pipe(Layer.provide(AgentAsset.layer))
  const assets = Layer.effectContext(
    Effect.gen(function* () {
      const prompts = yield* PromptAsset.Service
      const skills = yield* SkillAsset.Service
      const workflows = yield* WorkflowAsset.Service
      const commands = yield* CommandAsset.Service
      const mcps = yield* MCPAsset.Service
      return Context.make(
        PromptAsset.Service,
        PromptAsset.Service.of({
          ...prompts,
          list: () => track("prompt", prompts.list()),
          select: (scope) =>
            source("prompt", scope, "select", prompts.select(scope)).pipe(
              Effect.map((selected) => ({
                ...selected,
                list: () => source("prompt", scope, "list", selected.list()),
                getByPath: (relativePath: string) =>
                  source("prompt", scope, "getByPath", selected.getByPath(relativePath)),
              })),
            ),
        }),
      ).pipe(
        Context.add(
          SkillAsset.Service,
          SkillAsset.Service.of({
            ...skills,
            list: () => track("skill", skills.list()),
            select: (scope) =>
              source("skill", scope, "select", skills.select(scope)).pipe(
                Effect.map((selected) => ({
                  ...selected,
                  list: () => source("skill", scope, "list", selected.list()),
                  getByPath: (relativePath: string) =>
                    source("skill", scope, "getByPath", selected.getByPath(relativePath)),
                })),
              ),
          }),
        ),
        Context.add(
          WorkflowAsset.Service,
          WorkflowAsset.Service.of({ ...workflows, list: () => track("workflow", workflows.list()) }),
        ),
        Context.add(
          CommandAsset.Service,
          CommandAsset.Service.of({
            ...commands,
            list: () => track("command", commands.list()),
            select: (scope) =>
              source("command", scope, "select", commands.select(scope)).pipe(
                Effect.map((selected) => ({
                  ...selected,
                  list: () => source("command", scope, "list", selected.list()),
                  getByPath: (relativePath: string) =>
                    source("command", scope, "getByPath", selected.getByPath(relativePath)),
                })),
              ),
          }),
        ),
        Context.add(MCPAsset.Service, MCPAsset.Service.of({ ...mcps, list: () => track("mcp", mcps.list()) })),
      )
    }),
  ).pipe(Layer.provide(catalogLayer))
  const profileLayer = Layer.effect(
    CustomProfile.Service,
    Effect.gen(function* () {
      const real = yield* CustomProfile.Service
      return CustomProfile.Service.of({
        ...real,
        getByPath: (relativePath) =>
          real.getByPath(relativePath).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                reads.profiles += 1
              }),
            ),
          ),
      })
    }),
  ).pipe(Layer.provide(CustomProfile.layer))
  return { agentLayer, profileLayer, catalogLayer: assets }
}

const markdown = (value: unknown, body = "") => `---\n${AssetYaml.stringify(value)}---\n${body}\n`
const workflow = (
  steps = [
    { id: "entry", name: "Entry", agent: "coder", input: {}, parallel: ["left", "right"] },
    { id: "left", name: "Left", agent: "coder", input: {}, next: "END" },
    { id: "right", name: "Right", agent: "reviewer", input: {}, next: "END" },
  ],
) => AssetYaml.stringify({ kind: "workflow", name: "review", description: "Review flow", version: "1.0.0", steps })

const writeFixture = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.forEach(
      Object.entries({
        ".omnixa/agents/coder.md": markdown({ kind: "agent", name: "coder", description: "Coder" }, "Coder body"),
        ".omnixa/agents/reviewer.md": markdown(
          { kind: "agent", name: "reviewer", description: "Reviewer" },
          "Reviewer body",
        ),
        ".omnixa/prompts/system.md": markdown(
          { kind: "prompt", name: "system", description: "System prompt" },
          "Prompt body",
        ),
        ".omnixa/skills/git/SKILL.md": markdown({ kind: "skill", name: "git", description: "Git skill" }, "Skill body"),
        ".omnixa/commands/check.md": markdown(
          { kind: "command", name: "check", description: "Check files", invocation: "/check", args: "<files>" },
          "Command body",
        ),
        ".omnixa/workflows/review.yaml": workflow(),
        ".omnixa/mcps/servers/probe.md": markdown(
          { kind: "mcp", name: "probe", description: "Probe server", command: "node", args: ["server.js"] },
          '{"material":"must stay out of plan"}',
        ),
      }),
      ([relativePath, content]) => fs.writeWithDirs(path.join(directory, relativePath), content),
      { discard: true },
    )
  })

const currentInput = Effect.gen(function* () {
  const agents = yield* AgentAsset.Service
  const prompts = yield* PromptAsset.Service
  const skills = yield* SkillAsset.Service
  const commands = yield* CommandAsset.Service
  const workflows = yield* WorkflowAsset.Service
  return new Composition.TemporaryInput({
    source: "temporary",
    agents: yield* Effect.forEach(["coder.md", "reviewer.md"], (relativePath) =>
      agents.getByPath(relativePath).pipe(
        Effect.map(
          (asset) =>
            new Composition.AgentRef({
              kind: "agent",
              relativePath,
              revision: Composition.Revision.make(asset.revision),
            }),
        ),
      ),
    ),
    workflow: new Composition.WorkflowRef({
      kind: "workflow",
      relativePath: "review.yaml",
      revision: Composition.Revision.make((yield* workflows.getByPath("review.yaml")).revision),
    }),
    bindings: {
      "agents/coder": new Composition.Binding({
        prompts: [
          new Composition.PromptRef({
            kind: "prompt",
            relativePath: "system.md",
            revision: Composition.Revision.make((yield* prompts.getByPath("system.md")).revision),
          }),
        ],
        skills: [
          new Composition.SkillRef({
            kind: "skill",
            relativePath: "git/SKILL.md",
            revision: Composition.Revision.make((yield* skills.getByPath("git/SKILL.md")).revision),
          }),
        ],
        commands: [
          new Composition.CommandRef({
            kind: "command",
            relativePath: "check.md",
            revision: Composition.Revision.make((yield* commands.getByPath("check.md")).revision),
          }),
        ],
      }),
    },
    presentation: "native",
    requestedCapabilities: [
      "workspace.read",
      "workspace.write",
      "terminal.exec",
      "browser.navigate",
      "unknown.capability",
    ],
  })
})

const saveProfile = (directory: string, input: Composition.TemporaryInput, mcpBindings: readonly unknown[] = []) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const profiles = yield* CustomProfile.Service
    yield* fs.writeWithDirs(
      path.join(directory, CustomProfile.CUSTOM_PROFILES_DIR, "dev.yaml"),
      AssetYaml.stringify({
        kind: "custom-profile",
        name: "Development",
        description: "Development profile",
        ...(input.root === undefined ? {} : { root: Schema.encodeSync(Composition.Root)(input.root) }),
        agents: input.agents,
        workflow: input.workflow,
        bindings: input.bindings,
        presentation: input.presentation,
        requestedCapabilities: input.requestedCapabilities,
        mcpBindings,
      }),
    )
    yield* profiles.reload()
    return yield* profiles.getByPath("dev.yaml")
  })

const sourceFixture = Effect.gen(function* () {
  const directory = yield* tmpdirScoped()
  const fs = yield* FSUtil.Service
  const project = path.join(directory.path, "repo")
  const child = path.join(project, "packages/app")
  yield* fs.makeDirectory(child, { recursive: true })
  yield* Effect.promise(() => initRepo(project))
  const services = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Location.node, Global.node]), [
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(child) })),
      Global.node.replace(tempGlobalLayer),
      FSUtil.node.replace(Layer.succeed(FSUtil.Service, fs)),
    ]),
  )
  const actualLocation = Context.get(services, Location.Service)
  const global = Context.get(services, Global.Service)
  expect(actualLocation.project.directory).toBe(AbsolutePath.make(project))
  expect(actualLocation.vcs?.type).toBe("git")
  yield* writeFixture(child)
  yield* Effect.forEach(
    [
      { scope: "location", directory: child },
      { scope: "project", directory: project },
      { scope: "global", directory: global.config },
    ] as const,
    (owner) =>
      Effect.forEach(
        [
          {
            family: "prompts",
            value: { kind: "prompt", name: `${owner.scope}-policy`, description: "Source prompt" },
            body: `${owner.scope} prompt body`,
          },
          {
            family: "skills",
            value: { kind: "skill", name: `${owner.scope}-skill`, description: "Source skill" },
            body: `${owner.scope} skill body`,
          },
          {
            family: "commands",
            value: {
              kind: "command",
              name: `${owner.scope}-check`,
              description: "Source command",
              invocation: `/${owner.scope}-check`,
            },
            body: `${owner.scope} command body`,
          },
        ],
        (asset) =>
          fs.writeWithDirs(
            path.join(
              owner.directory,
              owner.scope === "global" ? asset.family : `.omnixa/${asset.family}`,
              "shared.md",
            ),
            markdown(asset.value, asset.body),
          ),
      ),
  )
  return { child, project, location: actualLocation, global }
})

const sourceRefs = Effect.gen(function* () {
  const prompts = yield* PromptAsset.Service
  const skills = yield* SkillAsset.Service
  const commands = yield* CommandAsset.Service
  return yield* Effect.forEach(["location", "project", "global"] as const, (scope) =>
    Effect.gen(function* () {
      const promptOwner = yield* prompts.select(scope)
      const skillOwner = yield* skills.select(scope)
      const commandOwner = yield* commands.select(scope)
      const prompt = yield* promptOwner.getByPath("shared.md")
      const skill = yield* skillOwner.getByPath("shared.md")
      const command = yield* commandOwner.getByPath("shared.md")
      return {
        scope,
        prompt,
        skill,
        command,
        promptTarget: promptOwner.target,
        skillTarget: skillOwner.target,
        commandTarget: commandOwner.target,
        promptRef: new Composition.PromptRef({
          kind: "prompt",
          relativePath: prompt.relativePath,
          revision: Composition.Revision.make(prompt.revision),
          target: promptOwner.target,
        }),
        skillRef: new Composition.SkillRef({
          kind: "skill",
          relativePath: skill.relativePath,
          revision: Composition.Revision.make(skill.revision),
          target: skillOwner.target,
        }),
        commandRef: new Composition.CommandRef({
          kind: "command",
          relativePath: command.relativePath,
          revision: Composition.Revision.make(command.revision),
          target: commandOwner.target,
        }),
      }
    }),
  )
})

describe("CompositionResolver selected sources", () => {
  it.live("freezes same-path sources separately and reads each selected family and scope once", () =>
    Effect.gen(function* () {
      const fixture = yield* sourceFixture
      const reads = readCounts()
      const sourceReads = new Map<string, number>()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const declared = yield* currentInput
        const refs = yield* sourceRefs
        const input = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [
                new Composition.PromptRef({
                  kind: "prompt",
                  relativePath: " shared.md ",
                  revision: refs[0].promptRef.revision,
                }),
                refs[1].promptRef,
                refs[2].promptRef,
              ],
              skills: [
                new Composition.SkillRef({
                  kind: "skill",
                  relativePath: "shared.md",
                  revision: refs[0].skillRef.revision,
                }),
              ],
              commands: [
                new Composition.CommandRef({
                  kind: "command",
                  relativePath: "shared.md",
                  revision: refs[0].commandRef.revision,
                }),
              ],
            }),
            "agents/coder": new Composition.Binding({
              prompts: [refs[1].promptRef],
              skills: [refs[1].skillRef],
              commands: [refs[1].commandRef],
            }),
            "agents/reviewer": new Composition.Binding({
              prompts: [refs[2].promptRef],
              skills: [refs[2].skillRef],
              commands: [refs[2].commandRef],
            }),
          },
        })
        const assertReads = () => {
          expect(reads).toEqual({ agent: 1, prompt: 1, skill: 1, workflow: 1, command: 1, mcp: 1, profiles: 0 })
          ;["prompt", "skill", "command"].forEach((kind) => {
            ;["location", "project", "global"].forEach((scope) => {
              expect(sourceReads.get(`${kind}/${scope}/select`)).toBe(1)
              expect(sourceReads.get(`${kind}/${scope}/list`) ?? 0).toBe(scope === "location" ? 0 : 1)
              expect(sourceReads.get(`${kind}/${scope}/getByPath`) ?? 0).toBe(0)
            })
          })
          expect(sourceReads.size).toBe(15)
        }
        Object.assign(reads, readCounts())
        sourceReads.clear()
        const plan = yield* resolver.resolve(input)
        expect(plan.valid).toBe(true)
        expect(plan.input).toBe(input)
        expect(plan.digest).toBe(CompositionDigest.computeCompositionDigest(input))
        expect(plan.skills.map((skill) => skill.target?.scope)).toEqual(["location", "project", "global"])
        expect(plan.commands.map((command) => command.target?.scope)).toEqual(["location", "project", "global"])
        assertReads()
        Object.assign(reads, readCounts())
        sourceReads.clear()
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: plan.input }))
        assertReads()
        expect(frozen.digest).toBe(plan.digest)
        expect(frozen.data.prompts.map((prompt) => prompt.relativePath)).toEqual([
          "shared.md",
          "shared.md",
          "shared.md",
        ])
        expect(frozen.data.prompts.map((prompt) => prompt.target)).toEqual(refs.map((ref) => ref.promptRef.target))
        expect(frozen.data.skills.map((skill) => skill.target)).toEqual(refs.map((ref) => ref.skillRef.target))
        expect(frozen.data.commands.map((command) => command.target)).toEqual(refs.map((ref) => ref.commandRef.target))
        expect(frozen.data.prompts.map((prompt) => prompt.content)).toEqual(refs.map((ref) => ref.prompt.template))
        expect(frozen.data.skills.map((skill) => skill.content)).toEqual(refs.map((ref) => ref.skill.content))
        expect(frozen.data.commands.map((command) => command.source)).toEqual(refs.map((ref) => ref.command.source))
        expect(frozen.data.prompts.map((prompt) => prompt.revision)).toEqual(refs.map((ref) => ref.promptRef.revision))
        expect(frozen.data.skills.map((skill) => skill.revision)).toEqual(refs.map((ref) => ref.skillRef.revision))
        expect(frozen.data.commands.map((command) => command.revision)).toEqual(
          refs.map((ref) => ref.commandRef.revision),
        )
        refs.forEach((ref, index) => {
          const consumer = ["orchestrator", "agents/coder", "agents/reviewer"][index]
          expect(frozen.data.bindings?.[consumer].skills[0].target).toEqual(ref.skillRef.target)
          expect(frozen.data.bindings?.[consumer].commands[0].target).toEqual(ref.commandRef.target)
          expect(frozen.data.orchestrator?.system).toContain(ref.prompt.name)
        })
        expect(input.bindings.orchestrator.prompts[0].target).toBeUndefined()
        expect(input.bindings.orchestrator.prompts[0].relativePath).toBe(" shared.md ")
        const profile = yield* saveProfile(fixture.child, input)
        expect(profile.profile.bindings.orchestrator.prompts[0].target).toBeUndefined()
        expect(profile.profile.bindings.orchestrator.prompts[1].target).toEqual(refs[1].promptRef.target)
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        const saved = yield* resolver.freeze(new Composition.FreezeInput({ input: profileInput }))
        expect(saved.data).toEqual(frozen.data)
        expect(saved.digest).toBe(CompositionDigest.computeCompositionDigest(profileInput))
      }).pipe(
        Effect.provide(
          fullLayer(fixture.child, {
            location: fixture.location,
            global: fixture.global,
            ...trackedAssetLayers(reads, sourceReads),
          }),
        ),
      )
    }),
  )

  it.live("rejects wrong roots and missing selected assets without falling back to Location", () =>
    Effect.gen(function* () {
      const fixture = yield* sourceFixture
      const reads = readCounts()
      const sourceReads = new Map<string, number>()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const declared = yield* currentInput
        const refs = yield* sourceRefs
        const wrong = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: refs.map(
                (ref) =>
                  new Composition.PromptRef({
                    ...ref.promptRef,
                    target: new AssetPlacement.Target({
                      ...ref.promptTarget,
                      root: AbsolutePath.make(path.join(ref.promptTarget.root, "other")),
                    }),
                  }),
              ),
              skills: refs.map(
                (ref) =>
                  new Composition.SkillRef({
                    ...ref.skillRef,
                    target: new AssetPlacement.Target({
                      ...ref.skillTarget,
                      root: AbsolutePath.make(path.join(ref.skillTarget.root, "other")),
                    }),
                  }),
              ),
              commands: refs.map(
                (ref) =>
                  new Composition.CommandRef({
                    ...ref.commandRef,
                    target: new AssetPlacement.Target({
                      ...ref.commandTarget,
                      root: AbsolutePath.make(path.join(ref.commandTarget.root, "other")),
                    }),
                  }),
              ),
            }),
          },
        })
        const assertWrongReads = () => {
          expect(reads).toEqual({ agent: 1, prompt: 0, skill: 0, workflow: 1, command: 0, mcp: 1, profiles: 0 })
          ;["prompt", "skill", "command"].forEach((kind) => {
            ;["location", "project", "global"].forEach((scope) => {
              expect(sourceReads.get(`${kind}/${scope}/select`)).toBe(1)
              expect(sourceReads.get(`${kind}/${scope}/list`) ?? 0).toBe(0)
              expect(sourceReads.get(`${kind}/${scope}/getByPath`) ?? 0).toBe(0)
            })
          })
          expect(sourceReads.size).toBe(9)
        }
        Object.assign(reads, readCounts())
        sourceReads.clear()
        const wrongPlan = yield* resolver.resolve(wrong)
        expect(wrongPlan.valid).toBe(false)
        expect(wrongPlan.input).toBe(wrong)
        expect(wrongPlan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
          Array.from({ length: 9 }, () => "asset_target_mismatch"),
        )
        expect(wrongPlan.skills).toEqual([])
        expect(wrongPlan.commands).toEqual([])
        assertWrongReads()
        Object.assign(reads, readCounts())
        sourceReads.clear()
        expect(yield* resolver.freeze(new Composition.FreezeInput({ input: wrong })).pipe(Effect.flip)).toMatchObject({
          code: "invalid_composition_plan",
        })
        assertWrongReads()
        yield* Effect.forEach(refs, (ref, index) =>
          Effect.gen(function* () {
            const mixed = new Composition.TemporaryInput({
              ...declared,
              bindings: {
                orchestrator: new Composition.Binding({
                  prompts: [
                    ref.scope === "location"
                      ? new Composition.PromptRef({ ...ref.promptRef, target: undefined })
                      : ref.promptRef,
                    wrong.bindings.orchestrator.prompts[index],
                  ],
                  skills: [
                    ref.scope === "location"
                      ? new Composition.SkillRef({ ...ref.skillRef, target: undefined })
                      : ref.skillRef,
                    wrong.bindings.orchestrator.skills[index],
                  ],
                  commands: [
                    ref.scope === "location"
                      ? new Composition.CommandRef({ ...ref.commandRef, target: undefined })
                      : ref.commandRef,
                    wrong.bindings.orchestrator.commands[index],
                  ],
                }),
              },
            })
            const assertMixedReads = () => {
              expect(reads).toEqual({
                agent: 1,
                prompt: ref.scope === "location" ? 1 : 0,
                skill: ref.scope === "location" ? 1 : 0,
                workflow: 1,
                command: ref.scope === "location" ? 1 : 0,
                mcp: 1,
                profiles: 0,
              })
              ;["prompt", "skill", "command"].forEach((kind) => {
                ;["location", "project", "global"].forEach((scope) => {
                  expect(sourceReads.get(`${kind}/${scope}/select`) ?? 0).toBe(scope === ref.scope ? 1 : 0)
                  expect(sourceReads.get(`${kind}/${scope}/list`) ?? 0).toBe(
                    scope === ref.scope && scope !== "location" ? 1 : 0,
                  )
                  expect(sourceReads.get(`${kind}/${scope}/getByPath`) ?? 0).toBe(0)
                })
              })
              expect(sourceReads.size).toBe(ref.scope === "location" ? 3 : 6)
            }
            Object.assign(reads, readCounts())
            sourceReads.clear()
            const mixedPlan = yield* resolver.resolve(mixed)
            expect(mixedPlan.valid).toBe(false)
            expect(mixedPlan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
              "asset_target_mismatch",
              "asset_target_mismatch",
              "asset_target_mismatch",
            ])
            expect(mixedPlan.skills[0].target).toEqual(ref.skillTarget)
            expect(mixedPlan.commands[0].target).toEqual(ref.commandTarget)
            assertMixedReads()
            Object.assign(reads, readCounts())
            sourceReads.clear()
            expect(
              yield* resolver.freeze(new Composition.FreezeInput({ input: mixed })).pipe(Effect.flip),
            ).toMatchObject({ code: "invalid_composition_plan" })
            assertMixedReads()
          }),
        )
        const local = declared.bindings["agents/coder"]
        const missing = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [new Composition.PromptRef({ ...local.prompts[0], target: refs[1].promptTarget })],
              skills: [new Composition.SkillRef({ ...local.skills[0], target: refs[1].skillTarget })],
              commands: [new Composition.CommandRef({ ...local.commands[0], target: refs[1].commandTarget })],
            }),
          },
        })
        const missingPlan = yield* resolver.resolve(missing)
        expect(missingPlan.valid).toBe(false)
        expect(missingPlan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
          "prompt_not_found",
          "skill_not_found",
          "command_not_found",
        ])
        expect(missingPlan.skills).toEqual([])
        expect(missingPlan.commands).toEqual([])
        const duplicate = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [
                new Composition.PromptRef({ ...refs[0].promptRef, relativePath: " shared.md ", target: undefined }),
                refs[0].promptRef,
              ],
              skills: [],
              commands: [],
            }),
          },
        })
        const duplicatePlan = yield* resolver.resolve(duplicate)
        expect(duplicatePlan.valid).toBe(false)
        expect(duplicatePlan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate_asset"])
        const conflict = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [],
              skills: [refs[0].skillRef, refs[1].skillRef],
              commands: [],
            }),
          },
        })
        const conflictPlan = yield* resolver.resolve(conflict)
        expect(conflictPlan.valid).toBe(false)
        expect(conflictPlan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["skill_id_conflict"])
      }).pipe(
        Effect.provide(
          fullLayer(fixture.child, {
            location: fixture.location,
            global: fixture.global,
            ...trackedAssetLayers(reads, sourceReads),
          }),
        ),
      )
    }),
  )

  it.live("separates source and expected revision while sharing stale facts across consumers", () =>
    Effect.gen(function* () {
      const fixture = yield* sourceFixture
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const declared = yield* currentInput
        const refs = yield* sourceRefs
        const expected = Composition.Revision.make("0".repeat(64))
        const otherExpected = Composition.Revision.make("1".repeat(64))
        const input = new Composition.TemporaryInput({
          ...declared,
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [
                new Composition.PromptRef({ ...refs[1].promptRef, revision: expected }),
                new Composition.PromptRef({ ...refs[2].promptRef, revision: expected }),
              ],
              skills: [new Composition.SkillRef({ ...refs[1].skillRef, revision: expected })],
              commands: [new Composition.CommandRef({ ...refs[1].commandRef, revision: expected })],
            }),
            "agents/coder": new Composition.Binding({
              prompts: [new Composition.PromptRef({ ...refs[1].promptRef, revision: expected })],
              skills: [new Composition.SkillRef({ ...refs[2].skillRef, revision: expected })],
              commands: [new Composition.CommandRef({ ...refs[2].commandRef, revision: expected })],
            }),
            "agents/reviewer": new Composition.Binding({
              prompts: [new Composition.PromptRef({ ...refs[1].promptRef, revision: otherExpected })],
              skills: [],
              commands: [],
            }),
          },
        })
        const profile = yield* saveProfile(fixture.child, input)
        const health = yield* resolver.checkHealth(profile.relativePath)
        expect(health.status).toBe("degraded")
        expect(health.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_asset")).toBe(false)
        expect(health.staleRevisions).toHaveLength(7)
        expect(health.staleRevisions).toEqual(
          expect.arrayContaining([
            {
              kind: "prompt",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[1].prompt.revision,
              target: refs[1].promptTarget,
            },
            {
              kind: "prompt",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[2].prompt.revision,
              target: refs[2].promptTarget,
            },
            {
              kind: "prompt",
              relativePath: "shared.md",
              expectedRevision: otherExpected,
              currentRevision: refs[1].prompt.revision,
              target: refs[1].promptTarget,
            },
            {
              kind: "skill",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[1].skill.revision,
              target: refs[1].skillTarget,
            },
            {
              kind: "skill",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[2].skill.revision,
              target: refs[2].skillTarget,
            },
            {
              kind: "command",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[1].command.revision,
              target: refs[1].commandTarget,
            },
            {
              kind: "command",
              relativePath: "shared.md",
              expectedRevision: expected,
              currentRevision: refs[2].command.revision,
              target: refs[2].commandTarget,
            },
          ]),
        )
      }).pipe(Effect.provide(fullLayer(fixture.child, { location: fixture.location, global: fixture.global })))
    }),
  )
})

describe("CompositionResolver freeze", () => {
  it.live("resolves and freezes saved zero-pool Profile roots with canonical Profile input and source revision", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const reads = readCounts()
      const fs = yield* FSUtil.Service
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const registry = yield* Tool.Service
        const profiles = yield* CustomProfile.Service
        const agents = yield* Agent.Service
        yield* PlanPlugin.Plugin.effect(
          host({
            agent: agentHost(agents),
            tool: { ...host().tool, hook: () => Effect.succeed({ dispose: Effect.void }) },
            session: { hook: () => Effect.succeed({ dispose: Effect.void }) },
          }),
        ).pipe(Effect.provide(tempGlobalLayer))
        yield* registry.transform((editor) =>
          editor.add({
            name: "read",
            description: "Read a file",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die(new Error("Profile preview and freeze must not execute")),
          }),
        )
        yield* Effect.forEach(["build", "plan", "meta"] as const, (id) =>
          Effect.gen(function* () {
            const preview = yield* resolver.resolve(
              new Composition.TemporaryInput({
                source: "temporary",
                root: new Composition.BuiltinRoot({ source: "builtin", id }),
                agents: [],
                bindings: {},
                presentation: "native",
                requestedCapabilities: [],
              }),
            )
            expect({ id, valid: preview.valid, diagnostics: preview.diagnostics }).toEqual({
              id,
              valid: true,
              diagnostics: [],
            })
            if (preview.input.source !== "temporary" || preview.input.root?.revision === undefined)
              throw new Error("Expected the captured builtin root")
            const profile = yield* saveProfile(directory.path, preview.input)
            expect(profile.profile.root).toEqual(preview.input.root)
            const input = new Composition.ProfileInput({
              source: "profile",
              profilePath: profile.relativePath,
              profileRevision: Composition.Revision.make(profile.revision),
            })
            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.version).toBe(2)
            expect(plan.orchestrator).toEqual(preview.orchestrator)
            expect(plan.agents).toEqual([])
            expect(plan.input).toEqual(input)
            expect(Object.hasOwn(Schema.encodeSync(Composition.CompositionInput)(plan.input), "root")).toBe(false)
            expect(plan.digest).toBe(CompositionDigest.computeCompositionDigest(input))
            const before = reads.profiles
            const frozen = yield* resolver.freeze(
              new Composition.FreezeInput({ input: plan.input, sessionID: "profile-session" }),
            )
            expect(reads.profiles - before).toBe(1)
            expect(frozen.digest).toBe(plan.digest)
            expect(frozen.profilePath).toBe(profile.relativePath)
            expect(frozen.profileRevision).toBe(input.profileRevision)
            expect(frozen.data.sourceLocation?.directory).toBe(AbsolutePath.make(directory.path))
            expect(frozen.data.root).toEqual(profile.profile.root)
            expect(frozen.data.orchestrator).toEqual(plan.orchestrator)
            expect(frozen.data.agents).toEqual([])
            expect(frozen.data.executors).toEqual([])
            expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("healthy")
            yield* fs.writeWithDirs(
              path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, profile.relativePath),
              AssetYaml.stringify({ ...profile.profile, description: "Changed after preview" }),
            )
            yield* profiles.reload()
            const drifted = yield* resolver.resolve(input)
            expect(drifted.valid).toBe(false)
            expect(drifted.input).toEqual(input)
            expect(drifted.digest).toBe(plan.digest)
            expect(drifted.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["profile_stale_revision"])
            const rejected = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
            expect(rejected.code).toBe("invalid_composition_plan")
            expect(rejected.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("profile_stale_revision")
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path, trackedAssetLayers(reads))))
      expect(yield* fs.exists(path.join(directory.path, ".omnixa/agents"))).toBe(false)
    }),
  )

  it.live("normalizes builtin root versions for zero-user-asset plans and frozen definitions", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const registry = yield* Tool.Service
        yield* registry.transform((editor) =>
          editor.add({
            name: "read",
            description: "Read a file",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die(new Error("a composition preview must not execute")),
          }),
        )
        yield* Effect.forEach(["build", "meta"] as const, (id) =>
          Effect.gen(function* () {
            const input = new Composition.TemporaryInput({
              source: "temporary",
              root: new Composition.BuiltinRoot({ source: "builtin", id }),
              agents: [],
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            })
            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.orchestrator?.id).toBe(Agent.ID.make(id))
            expect(plan.input.source).toBe("temporary")
            if (plan.input.source !== "temporary" || plan.orchestrator === undefined)
              throw new Error("Expected a normalized builtin root plan")
            expect(plan.input.root).toEqual({
              source: "builtin",
              id,
              revision: Composition.Revision.make(
                CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(plan.orchestrator)),
              ),
            })
            expect(input.root?.revision).toBeUndefined()
            expect(plan.digest).toBe(CompositionDigest.computeCompositionDigest(plan.input))
            expect(yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)).toMatchObject({
              code: "builtin_root_revision_required",
            })
            const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: plan.input }))
            expect(frozen.data.root).toEqual(plan.input.root)
            expect(frozen.data.orchestrator).toEqual(plan.orchestrator)
            expect(frozen.data.agents).toEqual([])
            expect(frozen.data.executors).toEqual([])
            expect(frozen.data.bindings?.orchestrator).toEqual({
              instructions: [],
              prompts: [],
              skills: [],
              commands: [],
            })
            expect(frozen.digest).toBe(plan.digest)
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
      expect(yield* fs.exists(path.join(directory.path, ".omnixa/agents"))).toBe(false)
      expect(yield* fs.exists(path.join(directory.path, ".omnixa/custom-profiles"))).toBe(false)
    }),
  )

  it.live("rejects stale or unavailable builtin roots without replacing the declared version", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const agents = yield* Agent.Service
        const input = new Composition.TemporaryInput({
          source: "temporary",
          root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        })
        const original = yield* resolver.resolve(input)
        expect(original.valid).toBe(true)
        if (original.input.source !== "temporary") throw new Error("Expected a temporary builtin plan")
        const profile = yield* saveProfile(directory.path, original.input)
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("build"), (info) => {
            info.system = "A changed builtin definition."
          }),
        )
        const stale = yield* resolver.resolve(original.input)
        expect(stale.valid).toBe(false)
        expect(stale.input).toEqual(original.input)
        expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_stale_revision")
        expect(
          yield* resolver.freeze(new Composition.FreezeInput({ input: original.input })).pipe(Effect.flip),
        ).toMatchObject({ code: "invalid_composition_plan" })
        const profileStale = yield* resolver.resolve(profileInput)
        expect(profileStale.valid).toBe(false)
        expect(profileStale.input).toEqual(profileInput)
        expect(profileStale.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_stale_revision")
        const rejectedProfile = yield* resolver
          .freeze(new Composition.FreezeInput({ input: profileInput }))
          .pipe(Effect.flip)
        expect(rejectedProfile.code).toBe("invalid_composition_plan")
        expect(rejectedProfile.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
          "builtin_root_stale_revision",
        )
        yield* Effect.forEach(
          [
            { hidden: true },
            { mode: "subagent" as const },
            { originRelativePath: "shadowed.md", originRevision: "a".repeat(64) },
          ],
          (fields) =>
            Effect.gen(function* () {
              yield* agents.transform((editor) =>
                editor.update(Agent.ID.make("build"), (info) => {
                  Object.assign(
                    info,
                    { hidden: false, mode: "all", originRelativePath: undefined, originRevision: undefined },
                    fields,
                  )
                }),
              )
              const unavailable = yield* resolver.resolve(input)
              expect(unavailable.valid).toBe(false)
              expect(unavailable.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_unavailable")
              expect(unavailable.input).toEqual(input)
              const profileUnavailable = yield* resolver.resolve(profileInput)
              expect(profileUnavailable.valid).toBe(false)
              expect(profileUnavailable.input).toEqual(profileInput)
              expect(profileUnavailable.orchestrator).toBeUndefined()
              expect(profileUnavailable.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
                "builtin_root_unavailable",
              )
            }),
        )
        yield* agents.transform((editor) => editor.remove(Agent.ID.make("build")))
        const missing = yield* resolver.resolve(input)
        expect(missing.valid).toBe(false)
        expect(missing.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_unavailable")
        expect(missing.orchestrator).toBeUndefined()
        const profileMissing = yield* resolver.resolve(profileInput)
        expect(profileMissing.valid).toBe(false)
        expect(profileMissing.orchestrator).toBeUndefined()
        expect(profileMissing.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_unavailable")
        expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("keeps an invalid selected user reference blocking an explicit builtin root", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const preview = yield* resolver.resolve(
          new Composition.TemporaryInput({
            source: "temporary",
            root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
            agents: [],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          }),
        )
        expect(preview.valid).toBe(true)
        if (preview.input.source !== "temporary" || preview.input.root?.revision === undefined)
          throw new Error("Expected a canonical builtin root revision")
        const input = new Composition.TemporaryInput({
          ...preview.input,
          agents: [
            new Composition.AgentRef({
              kind: "agent",
              relativePath: "missing.md",
              revision: Composition.Revision.make("a".repeat(64)),
            }),
          ],
        })
        const plan = yield* resolver.resolve(input)
        expect(plan.valid).toBe(false)
        expect(plan.orchestrator?.id).toBe(Agent.ID.make("build"))
        expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")
        const rejected = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
        expect(rejected.code).toBe("invalid_composition_plan")
        expect(rejected.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")
        const profile = yield* saveProfile(directory.path, input)
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        const profilePlan = yield* resolver.resolve(profileInput)
        expect(profilePlan.valid).toBe(false)
        expect(profilePlan.orchestrator?.id).toBe(Agent.ID.make("build"))
        expect(profilePlan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")
        const profileRejected = yield* resolver
          .freeze(new Composition.FreezeInput({ input: profileInput }))
          .pipe(Effect.flip)
        expect(profileRejected.code).toBe("invalid_composition_plan")
        expect(profileRejected.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("does not expose rejected builtin root credentials in a public Plan", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const agents = yield* Agent.Service
        yield* Effect.forEach(["build", "meta"] as const, (id) =>
          Effect.gen(function* () {
            yield* agents.transform((editor) =>
              editor.update(Agent.ID.make(id), (info) => {
                info.request.headers = { Authorization: "Bearer builtin-root-secret-fixture" }
              }),
            )
            const input = new Composition.TemporaryInput({
              source: "temporary",
              root: new Composition.BuiltinRoot({ source: "builtin", id }),
              agents: [],
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            })
            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(false)
            expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("orchestrator_request_credentials")
            expect(plan.orchestrator).toBeUndefined()
            expect(JSON.stringify(Schema.encodeSync(Composition.Plan)(plan))).not.toContain(
              "builtin-root-secret-fixture",
            )
            const failure = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
            expect(JSON.stringify(failure)).not.toContain("builtin-root-secret-fixture")
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("freezes explicit builtin roots with real user bindings and rejects root identity collisions", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const assets = yield* AgentAsset.Service
        const prompts = yield* PromptAsset.Service
        const declared = yield* currentInput
        yield* Effect.forEach(["build", "meta"] as const, (id) =>
          Effect.gen(function* () {
            const plan = yield* resolver.resolve(
              new Composition.TemporaryInput({
                ...declared,
                root: new Composition.BuiltinRoot({ source: "builtin", id }),
                bindings: {
                  ...declared.bindings,
                  orchestrator: new Composition.Binding({
                    prompts: [
                      new Composition.PromptRef({
                        kind: "prompt",
                        relativePath: "system.md",
                        revision: Composition.Revision.make((yield* prompts.getByPath("system.md")).revision),
                      }),
                    ],
                    skills: [],
                    commands: [],
                  }),
                },
              }),
            )
            expect(plan.valid).toBe(true)
            const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: plan.input }))
            expect(frozen.data.root?.id).toBe(id)
            expect(frozen.data.orchestrator?.id).toBe(Agent.ID.make(id))
            expect(frozen.data.agents.map((member) => member.id)).toEqual(["coder", "reviewer"])
            expect(frozen.data.bindings?.orchestrator.prompts[0].content).toBe(
              (yield* prompts.getByPath("system.md")).template,
            )
            expect(frozen.data.bindings?.["agents/coder"].skills[0].content).toContain("Skill body")
            if (frozen.data.orchestrator === undefined) throw new Error("Expected the frozen root")
            expect(frozen.data.root?.revision).toBe(
              Composition.Revision.make(
                CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(frozen.data.orchestrator)),
              ),
            )
            if (plan.input.source !== "temporary") throw new Error("Expected a captured temporary composition")
            const profile = yield* saveProfile(directory.path, plan.input)
            const input = new Composition.ProfileInput({
              source: "profile",
              profilePath: profile.relativePath,
              profileRevision: Composition.Revision.make(profile.revision),
            })
            const profilePlan = yield* resolver.resolve(input)
            expect(profilePlan.valid).toBe(true)
            expect(profilePlan.orchestrator).toEqual(plan.orchestrator)
            const profileFrozen = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(profileFrozen.data).toEqual(frozen.data)
            expect(profileFrozen.profileRevision).toBe(input.profileRevision)
          }),
        )
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/agents/root-collision.md"),
          markdown({ kind: "agent", name: "Build", description: "Conflicting root name" }, "A real user asset."),
        )
        yield* assets.reload()
        const collision = yield* assets.getByPath("root-collision.md")
        const invalidInput = new Composition.TemporaryInput({
          ...declared,
          root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
          agents: [
            new Composition.AgentRef({
              kind: "agent",
              relativePath: collision.relativePath,
              revision: Composition.Revision.make(collision.revision),
            }),
          ],
          workflow: undefined,
          bindings: {},
        })
        const invalid = yield* resolver.resolve(invalidInput)
        expect(invalid.valid).toBe(false)
        expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("root_agent_forbidden")
        const root = yield* resolver.resolve(new Composition.TemporaryInput({ ...invalidInput, agents: [] }))
        if (root.input.source !== "temporary") throw new Error("Expected a captured root input")
        const profile = yield* saveProfile(
          directory.path,
          new Composition.TemporaryInput({ ...root.input, agents: invalidInput.agents }),
        )
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        const profileCollision = yield* resolver.resolve(profileInput)
        expect(profileCollision.valid).toBe(false)
        expect(profileCollision.diagnostics.map((diagnostic) => diagnostic.code)).toContain("root_agent_forbidden")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("freezes primary and all-mode asset roots from file bytes through saved Profiles", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.forEach(["primary", "all"] as const, (mode) =>
        fs.writeWithDirs(
          path.join(directory.path, ".omnixa/agents", `root-${mode}.md`),
          markdown(
            {
              kind: "agent",
              name: `root-${mode}`,
              description: "An asset root",
              config: AssetYaml.stringify({ mode, request: { headers: { "X-Asset-Root": mode } } }),
            },
            `Frozen ${mode} asset root.`,
          ),
        ),
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const assets = yield* AgentAsset.Service
        const declared = yield* currentInput
        yield* Effect.forEach(["primary", "all"] as const, (mode) =>
          Effect.gen(function* () {
            const asset = yield* assets.getByPath(`root-${mode}.md`)
            const root = new Composition.AssetRoot({
              source: "asset",
              id: Agent.ID.make(asset.name),
              kind: "agent",
              relativePath: asset.relativePath,
              revision: Composition.Revision.make(asset.revision),
            })
            const input = new Composition.TemporaryInput({
              ...declared,
              root,
            })
            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.input).toEqual(input)
            const aliasInput = new Composition.TemporaryInput({
              ...input,
              root: new Composition.AssetRoot({ ...root, relativePath: ` ${asset.relativePath} ` }),
            })
            const alias = yield* resolver.resolve(aliasInput)
            expect(alias.valid).toBe(true)
            expect(alias.input).toEqual(aliasInput)
            expect(alias.digest).toBe(CompositionDigest.computeCompositionDigest(aliasInput))
            const aliasFrozen = yield* resolver.freeze(new Composition.FreezeInput({ input: alias.input }))
            expect(aliasFrozen.data.root).toEqual(root)
            const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: plan.input }))
            expect(frozen.data.root).toEqual(input.root)
            expect(frozen.data.orchestrator).toMatchObject({
              id: asset.name,
              mode,
              system: `Frozen ${mode} asset root.`,
              request: { headers: { "X-Asset-Root": mode } },
              originRelativePath: asset.relativePath,
              originRevision: asset.revision,
            })
            expect(frozen.data.agents.map((member) => member.id)).toEqual([
              Agent.ID.make("coder"),
              Agent.ID.make("reviewer"),
            ])
            expect(frozen.data.executors?.map((executor) => executor.id)).toEqual([
              Agent.ID.make("coder"),
              Agent.ID.make("reviewer"),
            ])
            if (frozen.data.orchestrator === undefined) throw new Error("Expected the frozen asset root")
            expect(frozen.data.root?.revision).not.toBe(
              CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(frozen.data.orchestrator)),
            )
            const profile = yield* saveProfile(directory.path, input)
            const profileInput = new Composition.ProfileInput({
              source: "profile",
              profilePath: profile.relativePath,
              profileRevision: Composition.Revision.make(profile.revision),
            })
            const savedPlan = yield* resolver.resolve(profileInput)
            expect(savedPlan.valid).toBe(true)
            const saved = yield* resolver.freeze(new Composition.FreezeInput({ input: profileInput }))
            expect(saved.data).toEqual(frozen.data)
            expect(saved.profilePath).toBe(profile.relativePath)
            expect(saved.profileRevision).toBe(Composition.Revision.make(profile.revision))
            const zeroPool = yield* resolver.freeze(
              new Composition.FreezeInput({
                input: new Composition.TemporaryInput({ ...input, agents: [], workflow: undefined, bindings: {} }),
              }),
            )
            expect(zeroPool.data.agents).toEqual([])
            expect(zeroPool.data.executors).toEqual([])
            expect(zeroPool.data.root).toEqual(input.root)
            expect(Object.keys(zeroPool.data.bindings ?? {})).toEqual(["orchestrator"])
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("rejects unavailable, stale, renamed and duplicate asset roots without builtin fallback", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      const file = path.join(directory.path, ".omnixa/agents/root.md")
      const write = (config: unknown, body = "Original asset root.") =>
        fs.writeWithDirs(
          file,
          markdown(
            { kind: "agent", name: "asset-root", description: "Root", config: AssetYaml.stringify(config) },
            body,
          ),
        )
      yield* write({ mode: "primary" })
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const assets = yield* AgentAsset.Service
        const asset = yield* assets.getByPath("root.md")
        const root = new Composition.AssetRoot({
          source: "asset",
          id: Agent.ID.make(asset.name),
          kind: "agent",
          relativePath: asset.relativePath,
          revision: Composition.Revision.make(asset.revision),
        })
        const input = new Composition.TemporaryInput({
          source: "temporary",
          root,
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        })
        const original = yield* resolver.freeze(new Composition.FreezeInput({ input }))
        const mismatched = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            root: new Composition.AssetRoot({ ...root, id: Agent.ID.make("build") }),
          }),
        )
        expect(mismatched.valid).toBe(false)
        expect(mismatched.orchestrator).toBeUndefined()
        expect(mismatched.diagnostics.map((diagnostic) => diagnostic.code)).toContain("asset_root_unavailable")
        const repeated = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [
              new Composition.AgentRef({ kind: "agent", relativePath: root.relativePath, revision: root.revision }),
            ],
          }),
        )
        expect(repeated.valid).toBe(false)
        expect(repeated.diagnostics.map((diagnostic) => diagnostic.code)).toContain("root_agent_forbidden")
        yield* Effect.forEach(
          [{ mode: "subagent" }, { mode: "all", hidden: true }, { mode: "primary", disabled: true }, "Invalid config"],
          (config) =>
            Effect.gen(function* () {
              yield* write(config)
              yield* assets.reload()
              const current = yield* assets.getByPath(root.relativePath)
              const invalidInput = new Composition.TemporaryInput({
                ...input,
                root: new Composition.AssetRoot({ ...root, revision: Composition.Revision.make(current.revision) }),
              })
              const invalid = yield* resolver.resolve(invalidInput)
              expect(invalid.valid).toBe(false)
              expect(invalid.orchestrator).toBeUndefined()
              expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("asset_root_unavailable")
              expect(
                (yield* resolver.freeze(new Composition.FreezeInput({ input: invalidInput })).pipe(Effect.flip)).code,
              ).toBe("invalid_composition_plan")
            }),
        )
        yield* write({ mode: "primary", request: { headers: { Authorization: "Bearer asset-root-secret-fixture" } } })
        yield* assets.reload()
        const credentialAsset = yield* assets.getByPath(root.relativePath)
        const credentials = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            root: new Composition.AssetRoot({ ...root, revision: Composition.Revision.make(credentialAsset.revision) }),
          }),
        )
        expect(credentials.valid).toBe(false)
        expect(credentials.orchestrator).toBeUndefined()
        expect(credentials.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          "orchestrator_request_credentials",
        )
        expect(JSON.stringify(Schema.encodeSync(Composition.Plan)(credentials))).not.toContain(
          "asset-root-secret-fixture",
        )
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/agents/meta-root.md"),
          markdown(
            {
              kind: "agent",
              name: "meta",
              description: "An asset cannot become Meta",
              config: AssetYaml.stringify({ mode: "primary" }),
            },
            "Asset Meta body.",
          ),
        )
        yield* assets.reload()
        const meta = yield* assets.getByPath("meta-root.md")
        const forbiddenMeta = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            root: new Composition.AssetRoot({
              source: "asset",
              id: Agent.ID.make("meta"),
              kind: "agent",
              relativePath: meta.relativePath,
              revision: Composition.Revision.make(meta.revision),
            }),
          }),
        )
        expect(forbiddenMeta.valid).toBe(false)
        expect(forbiddenMeta.orchestrator).toBeUndefined()
        expect(forbiddenMeta.diagnostics.map((diagnostic) => diagnostic.code)).toContain("asset_root_unavailable")
        yield* write({ mode: "primary" }, "Changed live asset root.")
        yield* assets.reload()
        const stale = yield* resolver.resolve(input)
        expect(stale.valid).toBe(false)
        expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_stale_revision")
        expect((yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)).code).toBe(
          "invalid_composition_plan",
        )
        expect(original.data.orchestrator?.system).toBe("Original asset root.")
        expect(original.data.root).toEqual(root)
        yield* fs.remove(file)
        yield* assets.reload()
        const missing = yield* resolver.resolve(input)
        expect(missing.valid).toBe(false)
        expect(missing.orchestrator).toBeUndefined()
        expect(missing.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("captures protocol cards without adopting live updates or filling historical absence", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const assets = yield* AgentAsset.Service
        const absent = yield* resolver.freeze(new Composition.FreezeInput({ input: yield* currentInput }))
        const cardA = { capabilities: ["review"], constraints: ["read only"], protocol: "Exact frozen A\n" }
        const cardB = { ...cardA, protocol: "Exact live B\n" }
        const writeCard = (card: unknown) =>
          fs.writeWithDirs(
            path.join(directory.path, ".omnixa/agents/coder.md"),
            markdown(
              {
                kind: "agent",
                name: "coder",
                description: "Coder",
                config: AssetYaml.stringify({ mode: "subagent", card }),
              },
              "Code carefully.",
            ),
          )
        yield* writeCard(cardA)
        yield* assets.reload()
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: yield* currentInput }))
        const encoded = Schema.encodeSync(Composition.SnapshotV2)(frozen)
        const decoded = Schema.decodeUnknownSync(Composition.SnapshotV2)(encoded)
        expect(decoded.data.executors?.find((executor) => executor.id === "coder")?.info.card).toEqual(cardA)
        yield* writeCard(cardB)
        yield* assets.reload()
        const adopted = yield* resolver.freeze(new Composition.FreezeInput({ input: yield* currentInput }))
        expect(adopted.data.executors?.find((executor) => executor.id === "coder")?.info.card).toEqual(cardB)
        expect(Schema.encodeSync(Composition.SnapshotV2)(frozen)).toEqual(encoded)
        expect(absent.data.executors?.find((executor) => executor.id === "coder")?.info.card).toBeUndefined()
        yield* writeCard(false)
        yield* assets.reload()
        const broken = yield* resolver.freeze(new Composition.FreezeInput({ input: yield* currentInput }))
        expect(broken.data.executors?.find((executor) => executor.id === "coder")?.info.card).toEqual({
          _tag: "InvalidCard",
          reason: "invalid_shape",
        })
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )
  it.live("rejects credential material in frozen Agent requests without exposing it in diagnostics", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const agents = yield* AgentAsset.Service
        const resolver = yield* CompositionResolver.Service
        yield* Effect.forEach(
          [
            { headers: { Authorization: "Bearer cred-short" } },
            { headers: { "proxy-authorization": "Basic cred-short" } },
            { headers: { Cookie: "session=cred-short" } },
            { headers: { "Set-Cookie": "session=cred-short" } },
            { headers: { "X-Api-Key": "cred-short" } },
            { headers: { "X-Goog-Api-Key": "cred-short" } },
            { headers: { "X-Auth-Token": "cred-short" } },
            { body: { token: "cred-short" } },
            { body: { api_key: "cred-short" } },
            { body: { auth: { access_token: "cred-short" } } },
            { body: { providers: [{ client_secret: "cred-short" }] } },
            { body: { auth: { apiKey: "" } } },
            { body: { metadata: { AuthToken: "cred-short" } } },
            { body: { session: { Cookie: "session=cred-short" } } },
            { body: { auth: { private_key: "cred-short" } } },
            { body: { token: "synthetic-credential-value" } },
            { body: { metadata: { note: "token=synthetic-credential-value" } } },
          ],
          (request) =>
            Effect.gen(function* () {
              yield* fs.writeWithDirs(
                path.join(directory.path, ".omnixa/agents/coder.md"),
                markdown(
                  {
                    kind: "agent",
                    name: "coder",
                    description: "Request credential boundary",
                    config: AssetYaml.stringify({ request }),
                  },
                  "Coder body",
                ),
              )
              yield* agents.reload()
              const input = yield* currentInput
              const plan = yield* resolver.resolve(input)
              expect(plan.valid).toBe(false)
              expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_request_credentials")
              const rejected = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
              expect(rejected.code).toBe("invalid_composition_plan")
              expect(JSON.stringify(rejected)).not.toContain("cred-short")
              expect(JSON.stringify(rejected.diagnostics)).not.toContain("synthetic-")
              expect(JSON.stringify(plan)).not.toContain("cred-short")
              expect(JSON.stringify(plan)).not.toContain("synthetic-")
            }),
          { discard: true },
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("freezes non-credential request headers and nested generation parameters unchanged", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      const request = {
        headers: { "x-agent": "frozen", "Content-Type": "application/json", "x-token-budget": "32" },
        body: {
          max_tokens: 1024,
          max_completion_tokens: 2048,
          token_budget: 512,
          reasoning: { effort: "low" },
          metadata: { owner: "coder", token_count: 3, tags: ["frozen", { label: "ordinary" }] },
          tools: [{ type: "function", function: { name: "search", parameters: { token_budget: 3 } } }],
        },
      }
      yield* fs.writeWithDirs(
        path.join(directory.path, ".omnixa/agents/coder.md"),
        markdown(
          {
            kind: "agent",
            name: "coder",
            description: "Generation parameters",
            config: AssetYaml.stringify({ request }),
          },
          "Coder body",
        ),
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const input = yield* currentInput
        const plan = yield* resolver.resolve(input)
        expect(plan.valid).toBe(true)
        expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("agent_request_credentials")
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input }))
        expect(frozen.data.executors?.find((executor) => executor.id === "coder")?.info.request).toEqual({
          settings: {},
          ...request,
        })
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("reads every owner once and fingerprints the same real tool capture", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      const reads = readCounts()
      const captures: Tool.Snapshot["catalog"][] = []
      const factReads: number[] = []
      yield* Effect.gen(function* () {
        const real = yield* Tool.Service
        yield* real.transform((editor) => {
          editor.add({
            name: "direct",
            description: "Direct",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die("freeze executed direct"),
          })
          editor.add({
            name: "internal",
            description: "Internal",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () => Effect.die("freeze executed CodeMode"),
          })
        })
        yield* Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = yield* currentInput
          const profile = yield* saveProfile(directory.path, input)
          Object.assign(reads, readCounts())
          captures.length = 0
          factReads.length = 0
          const frozen = yield* resolver.freeze(
            new Composition.FreezeInput({
              input: new Composition.ProfileInput({
                source: "profile",
                profilePath: profile.relativePath,
                profileRevision: Composition.Revision.make(profile.revision),
              }),
              sessionID: "historical-session-id",
            }),
          )
          expect(reads).toEqual({ agent: 1, prompt: 1, skill: 1, workflow: 1, command: 1, mcp: 1, profiles: 1 })
          expect(captures).toHaveLength(1)
          expect(factReads).toHaveLength(1)
          expect(frozen.data.tools).toEqual(CompositionDigest.captureTools(captures[0], directory.path, "freeze-test"))
          expect(frozen.data.tools.catalog).toEqual(["direct", "execute", "internal"])
          expect(
            frozen.data.tools.fingerprints.every(
              (tool) => tool.placement === directory.path && tool.installationVersion === "freeze-test",
            ),
          ).toBe(true)
          expect(frozen).toMatchObject({
            sessionID: "historical-session-id",
            profilePath: profile.relativePath,
            profileRevision: profile.revision,
          })
          expect(frozen.createdAt).toBeGreaterThan(0)
          expect(
            Schema.decodeUnknownSync(Composition.SnapshotV2)(Schema.encodeSync(Composition.SnapshotV2)(frozen)),
          ).toEqual(frozen)
        }).pipe(
          Effect.provide(
            fullLayer(directory.path, {
              ...trackedAssetLayers(reads),
              tools: Tool.Service.of({
                ...real,
                snapshot: (permissions, includeRegistered) =>
                  real.snapshot(permissions, includeRegistered).pipe(
                    Effect.tap((snapshot) =>
                      Effect.sync(() => {
                        captures.push(snapshot.catalog)
                      }),
                    ),
                  ),
              }),
              readFacts: () =>
                Effect.sync(() => {
                  factReads.push(1)
                  return []
                }),
            }),
          ),
        )
      }).pipe(Effect.provide(toolLayer), Effect.provideService(App.Metadata, App.make({ version: "freeze-test" })))
    }),
  )

  it.live("freezes complete Agent configuration and exact inputs for each consumer", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* fs.writeWithDirs(
        path.join(directory.path, ".omnixa/agents/coder.md"),
        markdown(
          {
            kind: "agent",
            name: "coder",
            description: "Configured coder",
            config: AssetYaml.stringify({
              model: "openai/frozen-model#variant",
              mode: "subagent",
              hidden: false,
              steps: 3,
              color: "#112233",
              permissions: [{ action: "read", resource: "*", effect: "allow" }],
              request: { headers: { "x-agent": "frozen" }, body: { effort: "low" } },
              handoffs: [{ label: "Review", agent: "reviewer", prompt: "Review code", send: true }],
            }),
          },
          "  Configured body  ",
        ),
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const prompts = yield* PromptAsset.Service
        const skills = yield* SkillAsset.Service
        const commands = yield* CommandAsset.Service
        const input = yield* currentInput
        const shared = new Composition.TemporaryInput({
          ...input,
          bindings: { ...input.bindings, "agents/reviewer": input.bindings["agents/coder"] },
        })
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: shared }))
        expect(frozen.version).toBe(2)
        expect(frozen.data.orchestrator).toMatchObject({ id: "meta", mode: "primary", hidden: false })
        expect(frozen.data.orchestrator?.system).toContain("**coder**")
        expect(frozen.data.orchestrator?.system).toContain("**reviewer**")
        expect(frozen.data.orchestrator?.system).not.toContain("**general**")
        expect(frozen.data.orchestrator?.system).not.toContain("**explore**")
        expect(frozen.data.orchestrator?.system).not.toContain("{{")
        expect(frozen.data.bindings?.orchestrator).toEqual(
          new Composition.SnapshotBindingData({ instructions: [], prompts: [], skills: [], commands: [] }),
        )
        expect(frozen.data.bindings?.["agents/coder"].instructions.map((instruction) => instruction.content)).toEqual([
          "Configured body",
          "Prompt body",
        ])
        expect(
          frozen.data.bindings?.["agents/reviewer"].instructions.map((instruction) => instruction.content),
        ).toEqual(["Reviewer body", "Prompt body"])
        const prompt = yield* prompts.getByPath("system.md")
        const skill = yield* skills.getByPath("git/SKILL.md")
        const command = yield* commands.getByPath("check.md")
        Array.of("agents/coder", "agents/reviewer").forEach((consumer) => {
          expect(frozen.data.bindings?.[consumer].prompts[0]).toMatchObject({
            relativePath: prompt.relativePath,
            revision: prompt.revision,
            content: prompt.template,
          })
          expect(frozen.data.bindings?.[consumer].skills[0]).toMatchObject({
            relativePath: skill.relativePath,
            revision: skill.revision,
            content: skill.content,
          })
          expect(frozen.data.bindings?.[consumer].commands[0]).toMatchObject({
            relativePath: command.relativePath,
            revision: command.revision,
            invocation: "/check",
            args: "<files>",
            source: command.source,
          })
        })
        expect(frozen.data.prompts).toHaveLength(1)
        expect(frozen.data.skills).toHaveLength(1)
        expect(frozen.data.commands).toHaveLength(1)
        expect(frozen.data.executors).toHaveLength(2)
        expect(frozen.data.executors?.some((executor) => executor.id === "meta")).toBe(false)
        expect(frozen.data.executors?.[0]).toMatchObject({
          id: "coder",
          relativePath: "coder.md",
          revision: input.agents[0].revision,
          info: {
            model: { providerID: "openai", id: "frozen-model", variant: "variant" },
            system: "Configured body",
            description: "Configured coder",
            mode: "subagent",
            hidden: false,
            steps: 3,
            color: "#112233",
            request: { settings: {}, headers: { "x-agent": "frozen" }, body: { effort: "low" } },
            permissions: [{ action: "read", resource: "*", effect: "allow" }],
            handoffs: [{ label: "Review", agent: "reviewer", prompt: "Review code", send: true }],
            originRelativePath: "coder.md",
            originRevision: input.agents[0].revision,
          },
        })
        expect(frozen.data.workflow?.steps).toHaveLength(3)
        expect(frozen.data.maxConcurrency).toBe(2)
        const single = new Composition.TemporaryInput({
          ...input,
          agents: [input.agents[0]],
          workflow: undefined,
          bindings: {},
        })
        const plan = yield* resolver.resolve(single)
        expect(plan.version).toBe(1)
        expect(
          plan.capabilities.every(
            (capability) => capability.status === "unsupported" && capability.reason?.includes("permission rules"),
          ),
        ).toBe(true)
        const one = yield* resolver.freeze(new Composition.FreezeInput({ input: single }))
        expect(one.version).toBe(2)
        expect(one.data.executors?.[0]).toEqual(frozen.data.executors?.[0])
        expect(one.data.bindings?.["agents/coder"].instructions.map((instruction) => instruction.content)).toEqual([
          "Configured body",
        ])
        expect(Schema.encodeSync(Composition.SnapshotV2)(one)).not.toHaveProperty("profilePath")
        expect(Schema.encodeSync(Composition.SnapshotV2)(one)).not.toHaveProperty("sessionID")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("captures meta once, renders only root-bound assets, and preserves its frozen configuration", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      let reads = 0
      const root = {
        ...Agent.Info.empty(Agent.ID.make("meta")),
        mode: "primary",
        system: "Custom root\n{{SUBAGENTS_LIST}}\n{{CLI_LIST}}\n{{ASSETS_LIST}}",
        model: Model.Ref.parse("openai/frozen-root"),
        steps: 5,
        request: { settings: {}, headers: { "X-Root": "frozen" }, body: { owner: "root" } },
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      } satisfies Agent.Info
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const assets = yield* AgentAsset.Service
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/agents/unselected.md"),
          markdown({ kind: "agent", name: "unselected", description: "Not in the pool" }, "Unselected body"),
        )
        yield* assets.reload()
        const input = yield* currentInput
        const frozen = yield* resolver.freeze(
          new Composition.FreezeInput({
            input: new Composition.TemporaryInput({
              ...input,
              agents: [input.agents[0]],
              workflow: undefined,
              bindings: {
                orchestrator: new Composition.Binding({
                  prompts: [],
                  skills: input.bindings["agents/coder"].skills,
                  commands: [],
                }),
                "agents/coder": input.bindings["agents/coder"],
              },
            }),
          }),
        )
        expect(reads).toBe(1)
        expect(frozen.data.orchestrator).toMatchObject({
          id: "meta",
          model: { providerID: "openai", id: "frozen-root" },
          steps: 5,
          request: root.request,
          permissions: root.permissions,
        })
        expect(frozen.data.orchestrator?.system).toContain("Custom root")
        expect(frozen.data.orchestrator?.system).toContain("**coder**")
        expect(frozen.data.orchestrator?.system).not.toContain("**reviewer**")
        expect(frozen.data.orchestrator?.system).not.toContain("**unselected**")
        expect(frozen.data.orchestrator?.system).toContain("**skills**: git")
        expect(frozen.data.orchestrator?.system).not.toContain("**prompts**")
        expect(frozen.data.orchestrator?.system).not.toContain("**commands**")
        expect(root.system).toContain("{{SUBAGENTS_LIST}}")
        root.request.headers["X-Root"] = "changed"
        root.request.body.owner = "changed"
        expect(frozen.data.orchestrator?.request.headers["X-Root"]).toBe("frozen")
        expect(frozen.data.orchestrator?.request.body.owner).toBe("root")
      }).pipe(
        Effect.provide(
          fullLayer(directory.path, {
            runtimeAgentLayer: Layer.mock(Agent.Service, {
              get: (id) =>
                Effect.sync(() => {
                  reads += 1
                  return id === "meta" ? root : undefined
                }),
            }),
          }),
        ),
      )
    }),
  )

  it.live("rejects a missing or credential-bearing root without disclosing request values", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      const roots = [
        undefined,
        Agent.Info.make({
          ...Agent.Info.empty(Agent.ID.make("meta")),
          mode: "primary",
          request: { settings: {}, headers: {}, body: { api_key: "cred-short" } },
        }),
      ]
      yield* Effect.forEach(roots, (root) =>
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = yield* currentInput
          const error = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
          expect(error.code).toBe("invalid_composition_plan")
          expect(error.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
            root === undefined ? "orchestrator_unavailable" : "orchestrator_request_credentials",
          )
          expect(JSON.stringify(error)).not.toContain("cred-short")
        }).pipe(
          Effect.provide(
            fullLayer(directory.path, {
              runtimeAgentLayer: Layer.mock(Agent.Service, { get: () => Effect.succeed(root) }),
            }),
          ),
        ),
      )
    }),
  )

  it.live("keeps frozen data intact after live edits and deletions and rejects stale or invalid inputs", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const agents = yield* AgentAsset.Service
        const prompts = yield* PromptAsset.Service
        const skills = yield* SkillAsset.Service
        const commands = yield* CommandAsset.Service
        const workflows = yield* WorkflowAsset.Service
        const profiles = yield* CustomProfile.Service
        const tools = yield* Tool.Service
        const input = yield* currentInput
        const profile = yield* saveProfile(directory.path, input)
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: profileInput }))
        const encoded = structuredClone(Schema.encodeSync(Composition.SnapshotV2)(frozen))
        yield* Effect.forEach(
          Object.entries({
            ".omnixa/agents/coder.md": markdown(
              {
                kind: "agent",
                name: "coder",
                description: "Changed coder",
                config: AssetYaml.stringify({ steps: 8, mode: "primary" }),
              },
              "Changed agent body",
            ),
            ".omnixa/prompts/system.md": markdown(
              { kind: "prompt", name: "system", description: "Changed prompt" },
              "Changed prompt body",
            ),
            ".omnixa/skills/git/SKILL.md": markdown(
              { kind: "skill", name: "git", description: "Changed skill" },
              "Changed skill body",
            ),
            ".omnixa/commands/check.md": markdown(
              { kind: "command", name: "check", description: "Changed command", invocation: "/changed" },
              "Changed command body",
            ),
            ".omnixa/workflows/review.yaml": workflow([
              { id: "entry", name: "Changed", agent: "coder", input: {}, next: "END" },
            ]),
          }),
          ([relativePath, content]) => fs.writeWithDirs(path.join(directory.path, relativePath), content),
          { discard: true },
        )
        yield* agents.reload()
        yield* prompts.reload()
        yield* skills.reload()
        yield* commands.reload()
        yield* workflows.reload()
        yield* tools.transform((editor) => {
          editor.add({
            name: "later",
            description: "Added after freeze",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die("freeze executed changed registry"),
          })
        })
        const stale = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
        expect(stale).toBeInstanceOf(Composition.ResolveError)
        expect(stale.code).toBe("invalid_composition_plan")
        expect(stale.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
          expect.arrayContaining([
            "agent_stale_revision",
            "prompt_stale_revision",
            "skill_stale_revision",
            "command_stale_revision",
            "workflow_stale_revision",
          ]),
        )
        expect(Schema.encodeSync(Composition.SnapshotV2)(frozen)).toEqual(encoded)
        const current = yield* currentInput
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/agents/coder.md"),
          markdown(
            { kind: "agent", name: "coder", description: "Invalid config", config: "steps: nope" },
            "Invalid configuration",
          ),
        )
        yield* agents.reload()
        const invalid = yield* resolver
          .freeze(new Composition.FreezeInput({ input: yield* currentInput }))
          .pipe(Effect.flip)
        expect(invalid.code).toBe("invalid_composition_plan")
        expect(invalid.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("invalid_agent_config")
        yield* fs.remove(path.join(directory.path, ".omnixa/prompts/system.md"))
        yield* prompts.reload()
        const missing = yield* resolver.freeze(new Composition.FreezeInput({ input: current })).pipe(Effect.flip)
        expect(missing.code).toBe("invalid_composition_plan")
        expect(missing.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("prompt_not_found")
        yield* fs.remove(path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, profile.relativePath))
        yield* profiles.reload()
        const missingProfile = yield* resolver
          .freeze(new Composition.FreezeInput({ input: profileInput }))
          .pipe(Effect.flip)
        expect(missingProfile.code).toBe("invalid_composition_plan")
        expect(missingProfile.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("profile_not_found")
        expect(Schema.encodeSync(Composition.SnapshotV2)(frozen)).toEqual(encoded)
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live(
    "captures bound direct and CodeMode MCP tools while excluding ambient registrations and transport material",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        yield* writeFixture(directory.path)
        const facts: McpConnection.Fact[] = []
        yield* Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const mcps = yield* MCPAsset.Service
          const tools = yield* Tool.Service
          const input = yield* currentInput
          const asset = yield* mcps.getByPath("servers/probe.md")
          const profile = yield* saveProfile(directory.path, input, [
            {
              serverName: "probe",
              ref: { relativePath: asset.relativePath, revision: Composition.Revision.make(asset.revision) },
              transport: "remote",
              url: "https://example.test/mcp",
              credentialRef: "cred_opaque",
            },
          ])
          const direct = McpRegistration.canonicalToolName("probe", "list-files")
          const codeMode = McpRegistration.canonicalToolName("probe", "list_files")
          facts.push(
            new McpConnection.Fact({
              serverName: "probe",
              ref: profile.profile.mcpBindings[0].ref,
              transportFingerprint: McpConnection.transportFingerprint(profile.profile.mcpBindings[0]),
              credentialRef: "cred_opaque",
              credentialStatus: "available",
              health: "ready",
              tools: [direct, codeMode],
            }),
          )
          yield* McpRegistration.registerServer(tools, {
            serverName: "probe",
            tools: {
              "list-files": {
                name: "list-files",
                description: "Direct MCP",
                input: Schema.Struct({}),
                output: Schema.String,
                options: { codemode: false },
                execute: () => Effect.die("freeze executed direct MCP"),
              },
              list_files: {
                name: "list_files",
                description: "CodeMode MCP",
                input: Schema.Struct({}),
                output: Schema.String,
                execute: () => Effect.die("freeze executed CodeMode MCP"),
              },
            },
          })
          yield* McpRegistration.registerServer(tools, {
            serverName: "ambient",
            tools: {
              read: {
                name: "read",
                description: "Ambient",
                input: Schema.Struct({}),
                output: Schema.String,
                options: { codemode: false },
                execute: () => Effect.die("freeze executed ambient MCP"),
              },
            },
          })
          const frozen = yield* resolver.freeze(
            new Composition.FreezeInput({
              input: new Composition.ProfileInput({
                source: "profile",
                profilePath: profile.relativePath,
                profileRevision: Composition.Revision.make(profile.revision),
              }),
            }),
          )
          expect(frozen.data.tools.capture).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ name: direct, placement: "direct" }),
              expect.objectContaining({ name: codeMode, placement: "codemode" }),
            ]),
          )
          expect(frozen.data.tools.catalog).toHaveLength(3)
          expect(frozen.data.tools.catalog).not.toContain(McpRegistration.canonicalToolName("ambient", "read"))
          expect(frozen.data.mcp.tools.map((tool) => tool.canonicalName)).toEqual([direct, codeMode])
          expect(
            Composition.mcpAuditMatchesCatalog({
              catalog: frozen.data.tools.catalog,
              auditToolNames: frozen.data.mcp.tools.map((tool) => tool.canonicalName),
            }).matches,
          ).toBe(true)
          expect(frozen.data.mcp.bindings[0]).toEqual(
            new Composition.SnapshotMcpBinding({
              serverName: "probe",
              ref: new Composition.McpRef({ kind: "mcp", ...profile.profile.mcpBindings[0].ref }),
              credentialRef: "cred_opaque",
              transportFingerprint: McpConnection.transportFingerprint(profile.profile.mcpBindings[0]),
            }),
          )
          expect(JSON.stringify(frozen)).not.toContain("https://example.test/mcp")
          expect(JSON.stringify(frozen)).not.toContain("must stay out of plan")
          expect(JSON.stringify(frozen)).not.toContain("server.js")
        }).pipe(Effect.provide(fullLayer(directory.path, { facts })))
      }),
  )

  it.live("rejects MCP catalog drift and stale transport or readiness facts", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      const facts: McpConnection.Fact[] = []
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const mcps = yield* MCPAsset.Service
        const tools = yield* Tool.Service
        const input = yield* currentInput
        const asset = yield* mcps.getByPath("servers/probe.md")
        const profile = yield* saveProfile(directory.path, input, [
          {
            serverName: "probe",
            ref: { relativePath: asset.relativePath, revision: Composition.Revision.make(asset.revision) },
            transport: "remote",
            url: "https://example.test/mcp",
            credentialRef: "cred_opaque",
          },
        ])
        const freeze = new Composition.FreezeInput({
          input: new Composition.ProfileInput({
            source: "profile",
            profilePath: profile.relativePath,
            profileRevision: Composition.Revision.make(profile.revision),
          }),
        })
        const canonical = McpRegistration.canonicalToolName("probe", "read")
        const ready = new McpConnection.Fact({
          serverName: "probe",
          ref: profile.profile.mcpBindings[0].ref,
          transportFingerprint: McpConnection.transportFingerprint(profile.profile.mcpBindings[0]),
          credentialRef: "cred_opaque",
          credentialStatus: "available",
          health: "ready",
          tools: [canonical],
        })
        yield* McpRegistration.registerServer(tools, {
          serverName: "probe",
          tools: {
            read: {
              name: "read",
              description: "Read",
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execute: () => Effect.die("freeze executed drifted MCP"),
            },
          },
        })
        facts.push(
          new McpConnection.Fact({
            ...ready,
            tools: [canonical, McpRegistration.canonicalToolName("probe", "missing")],
          }),
        )
        const mismatch = yield* resolver.freeze(freeze).pipe(Effect.flip)
        expect(mismatch).toBeInstanceOf(Composition.ResolveError)
        expect(mismatch.code).toBe("mcp_catalog_mismatch")
        facts[0] = ready
        const frozen = yield* resolver.freeze(freeze)
        expect(frozen.data.mcp.tools.map((tool) => tool.canonicalName)).toEqual([canonical])
        facts[0] = new McpConnection.Fact({
          ...ready,
          transportFingerprint: McpConnection.transportFingerprint({
            ...profile.profile.mcpBindings[0],
            transport: "remote",
            url: "https://changed.example.test/mcp",
          }),
        })
        const transport = yield* resolver.freeze(freeze).pipe(Effect.flip)
        expect(transport.code).toBe("invalid_composition_plan")
        expect(transport.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("mcp_binding_mismatch")
        facts[0] = new McpConnection.Fact({ ...ready, health: "offline" })
        const offline = yield* resolver.freeze(freeze).pipe(Effect.flip)
        expect(offline.code).toBe("invalid_composition_plan")
        expect(offline.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("mcp_not_ready")
        facts[0] = ready
        yield* tools.transform((editor) => {
          editor.remove(canonical)
        })
        const removed = yield* resolver.freeze(freeze).pipe(Effect.flip)
        expect(removed.code).toBe("mcp_catalog_mismatch")
        expect(frozen.data.tools.catalog).toContain(canonical)
      }).pipe(Effect.provide(fullLayer(directory.path, { facts })))
    }),
  )
})

describe("CompositionResolver read-only preview", () => {
  it.live("resolves real assets and provider definitions without executing tools", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const tools = yield* Tool.Service
        yield* tools.transform((editor) => {
          editor.add({
            name: "direct",
            description: "Direct tool",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die("preview executed a tool"),
          })
          editor.add({
            name: "internal",
            description: "CodeMode tool",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () => Effect.die("preview executed CodeMode"),
          })
        })
        yield* McpRegistration.registerServer(tools, {
          serverName: "ambient",
          tools: {
            read: {
              name: "read",
              description: "Ambient MCP",
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execute: () => Effect.die("preview executed ambient MCP"),
            },
          },
        })
        const input = yield* currentInput
        const plan = yield* resolver.resolve(input)
        expect(plan.valid).toBe(true)
        expect(plan.version).toBe(2)
        expect(plan.diagnostics).toEqual([])
        expect(plan.agents?.map((agent) => agent.consumerKey)).toEqual(["agents/coder", "agents/reviewer"])
        expect(plan.instructions.map((instruction) => instruction.content)).toEqual([
          "Coder body",
          "Reviewer body",
          "Prompt body",
        ])
        expect(plan.skills.map((skill) => skill.relativePath)).toEqual(["git/SKILL.md"])
        expect(plan.commands[0]).toMatchObject({
          name: "check",
          invocation: "/check",
          args: "<files>",
          source: "Command body\n",
        })
        expect(plan.costPreview).toMatchObject({ agentCount: 2, maxConcurrency: 2, effectiveToolCount: 2 })
        expect((yield* tools.snapshot()).definitions.map((definition) => definition.name)).toEqual([
          "direct",
          "mcp_ambient_read",
          "execute",
        ])
        expect(plan.capabilities.map((capability) => capability.status)).toEqual([
          "unsupported",
          "unsupported",
          "unsupported",
          "unsupported",
          "unsupported",
        ])
        expect(plan.digest).toMatch(/^[0-9a-f]{64}$/)
        expect((yield* resolver.resolve(input)).digest).toBe(plan.digest)
        const profile = yield* saveProfile(directory.path, input)
        expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("healthy")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("records all six expected/current revision differences from one set of registry reads", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      const reads = readCounts()
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const mcp = yield* MCPAsset.Service
        const input = yield* currentInput
        const expected = Composition.Revision.make("0".repeat(64))
        const stale = new Composition.TemporaryInput({
          ...input,
          agents: input.agents.map((ref) => new Composition.AgentRef({ ...ref, revision: expected })),
          workflow: input.workflow && new Composition.WorkflowRef({ ...input.workflow, revision: expected }),
          bindings: {
            "agents/coder": new Composition.Binding({
              prompts: input.bindings["agents/coder"].prompts.map(
                (ref) => new Composition.PromptRef({ ...ref, revision: expected }),
              ),
              skills: input.bindings["agents/coder"].skills.map(
                (ref) => new Composition.SkillRef({ ...ref, revision: expected }),
              ),
              commands: input.bindings["agents/coder"].commands.map(
                (ref) => new Composition.CommandRef({ ...ref, revision: expected }),
              ),
            }),
          },
        })
        const profile = yield* saveProfile(directory.path, stale, [
          {
            serverName: "probe",
            ref: { relativePath: "servers/probe.md", revision: expected },
            transport: "remote",
            url: "https://example.test/mcp",
            credentialRef: "cred_opaque",
          },
        ])
        Composition.AllowedKind.members.forEach((kind) => {
          reads[kind.literal] = 0
        })
        reads.profiles = 0
        const health = yield* resolver.checkHealth(profile.relativePath)
        expect(health.status).toBe("degraded")
        expect(new Set(health.staleRevisions.map((ref) => ref.kind))).toEqual(
          new Set(["agent", "prompt", "skill", "workflow", "command", "mcp"]),
        )
        expect(health.staleRevisions).toHaveLength(7)
        expect(
          health.staleRevisions.every((ref) => ref.expectedRevision === expected && ref.currentRevision !== expected),
        ).toBe(true)
        expect(health.staleRevisions.find((ref) => ref.kind === "mcp")?.currentRevision).toBe(
          Composition.Revision.make((yield* mcp.getByPath("servers/probe.md")).revision),
        )
        expect(reads).toEqual({ agent: 1, prompt: 1, skill: 1, workflow: 1, command: 1, mcp: 1, profiles: 1 })
        const plan = yield* resolver.resolve(
          new Composition.ProfileInput({
            source: "profile",
            profilePath: profile.relativePath,
            profileRevision: Composition.Revision.make(profile.revision),
          }),
        )
        expect(plan.valid).toBe(false)
        expect(plan.mcp.denied[0]?.reason).toBe("mcp_asset_stale_revision")
      }).pipe(Effect.provide(fullLayer(directory.path, trackedAssetLayers(reads))))
    }),
  )

  it.live("marks missing assets and Profiles broken, while a missing health path is typed", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const input = yield* currentInput
        const missing = new Composition.TemporaryInput({
          ...input,
          bindings: {
            "agents/coder": new Composition.Binding({
              prompts: [
                new Composition.PromptRef({ ...input.bindings["agents/coder"].prompts[0], relativePath: "missing.md" }),
              ],
              skills: [],
              commands: [],
            }),
          },
        })
        const profile = yield* saveProfile(directory.path, missing)
        expect((yield* resolver.resolve(missing)).diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          "prompt_not_found",
        )
        expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
        const absent = yield* resolver.resolve(
          new Composition.ProfileInput({
            source: "profile",
            profilePath: "absent.yaml",
            profileRevision: Composition.Revision.make("0".repeat(64)),
          }),
        )
        expect(absent.valid).toBe(false)
        expect(absent.diagnostics.map((diagnostic) => diagnostic.code)).toContain("profile_not_found")
        expect(yield* resolver.checkHealth("absent.yaml").pipe(Effect.flip)).toBeInstanceOf(CustomProfile.NotFoundError)
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("enforces agent bounds, root exclusion, normalized duplicate refs and consumer collisions", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* fs.writeWithDirs(
        path.join(directory.path, ".omnixa/agents/meta.md"),
        markdown({ kind: "agent", name: "meta", description: "Root" }, "Root body"),
      )
      yield* fs.writeWithDirs(
        path.join(directory.path, ".omnixa/agents/spaced.md"),
        markdown({ kind: "agent", name: " coder ", description: "Collision" }, "Collision body"),
      )
      yield* Effect.forEach(
        [
          { path: "review/审查.md", name: "审查员" },
          { path: "review/编程.md", name: "编程员" },
        ],
        (asset) =>
          fs.writeWithDirs(
            path.join(directory.path, ".omnixa/agents", asset.path),
            markdown({ kind: "agent", name: asset.name, description: asset.name }, "Agent body"),
          ),
        { discard: true },
      )
      yield* Effect.forEach(
        Array.from({ length: 16 }, (_, index) => `member-${index}`),
        (name) =>
          fs.writeWithDirs(
            path.join(directory.path, ".omnixa/agents", `${name}.md`),
            markdown({ kind: "agent", name, description: name }, `${name} body`),
          ),
        { discard: true },
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const agents = yield* AgentAsset.Service
        const input = yield* currentInput
        const members = yield* Effect.forEach(
          Array.from({ length: 16 }, (_, index) => `member-${index}.md`),
          (relativePath) =>
            agents.getByPath(relativePath).pipe(
              Effect.map(
                (asset) =>
                  new Composition.AgentRef({
                    kind: "agent",
                    relativePath,
                    revision: Composition.Revision.make(asset.revision),
                  }),
              ),
            ),
        )
        yield* Effect.forEach(
          Array.from({ length: 16 }, (_, index) => index + 1),
          (count) =>
            Effect.gen(function* () {
              const plan = yield* resolver.resolve(
                new Composition.TemporaryInput({
                  ...input,
                  agents: members.slice(0, count),
                  workflow: undefined,
                  bindings: {},
                }),
              )
              expect(plan.valid).toBe(true)
              expect(plan.agents).toHaveLength(count)
              expect(plan.costPreview?.agentCount).toBe(count)
            }),
        )
        yield* Effect.forEach([[], Array.from({ length: 17 }, () => input.agents[0])], (refs) =>
          Effect.gen(function* () {
            const plan = yield* resolver.resolve(
              new Composition.TemporaryInput({ ...input, agents: refs, workflow: undefined, bindings: {} }),
            )
            expect(plan.valid).toBe(false)
            expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_agent_cardinality")
          }),
        )
        const duplicate = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [input.agents[0], new Composition.AgentRef({ ...input.agents[0], relativePath: " coder.md " })],
            workflow: undefined,
            bindings: {},
          }),
        )
        expect(duplicate.diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate_asset")
        const root = yield* agents.getByPath("meta.md")
        const forbidden = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [
              new Composition.AgentRef({
                kind: "agent",
                relativePath: root.relativePath,
                revision: Composition.Revision.make(root.revision),
              }),
            ],
            bindings: {},
            workflow: undefined,
          }),
        )
        expect(forbidden.diagnostics.map((diagnostic) => diagnostic.code)).toContain("root_agent_forbidden")
        expect(forbidden.agents?.some((agent) => agent.name === "meta")).toBe(false)
        const collision = yield* agents.getByPath("spaced.md")
        const ambiguous = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [
              input.agents[0],
              new Composition.AgentRef({
                kind: "agent",
                relativePath: collision.relativePath,
                revision: Composition.Revision.make(collision.revision),
              }),
            ],
            workflow: undefined,
            bindings: {},
          }),
        )
        expect(ambiguous.diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate_consumer_key")
        const localizedAgents = yield* Effect.forEach(["review/审查.md", "review/编程.md"], (relativePath) =>
          agents.getByPath(relativePath).pipe(
            Effect.map(
              (asset) =>
                new Composition.AgentRef({
                  kind: "agent",
                  relativePath: asset.relativePath,
                  revision: Composition.Revision.make(asset.revision),
                }),
            ),
          ),
        )
        const localizedInput = new Composition.TemporaryInput({
          ...input,
          agents: localizedAgents,
          workflow: undefined,
          bindings: {},
        })
        const localized = yield* resolver.resolve(localizedInput)
        expect(localized.valid).toBe(true)
        expect(localized.agents).toHaveLength(2)
        expect(new Set(localized.agents?.map((agent) => agent.consumerKey)).size).toBe(2)
        expect((yield* resolver.resolve(localizedInput)).agents).toEqual(localized.agents)
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("keeps cross-consumer bindings valid and diagnoses duplicates or disconnected consumers", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const input = yield* currentInput
        const binding = input.bindings["agents/coder"]
        const shared = new Composition.TemporaryInput({
          ...input,
          bindings: { "agents/coder": binding, "agents/reviewer": binding },
        })
        expect((yield* resolver.resolve(shared)).valid).toBe(true)
        expect((yield* resolver.resolve(shared)).commands).toHaveLength(1)
        const repeated = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            bindings: {
              "agents/coder": new Composition.Binding({
                ...binding,
                prompts: [
                  binding.prompts[0],
                  new Composition.PromptRef({ ...binding.prompts[0], relativePath: " system.md " }),
                ],
              }),
            },
          }),
        )
        expect(repeated.diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate_asset")
        const disconnected = new Composition.TemporaryInput({ ...input, bindings: { "agents/unknown": binding } })
        const invalid = yield* resolver.resolve(disconnected)
        expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unknown_consumer_key")
        expect(invalid.diagnostics.filter((diagnostic) => diagnostic.code === "unconnected_asset")).toHaveLength(3)
        expect(invalid.skills).toEqual([])
        expect(invalid.commands).toEqual([])
        expect(invalid.instructions.some((instruction) => instruction.source.startsWith("prompt:"))).toBe(false)
        const profile = yield* saveProfile(directory.path, disconnected)
        expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("rejects consumer Skill ID collisions in plan, health, and freeze before creating a Session", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.forEach(["one", "two"], (owner) =>
        fs.writeWithDirs(
          path.join(directory.path, `.omnixa/skills/${owner}/review/SKILL.md`),
          markdown({ kind: "skill", name: `review-${owner}`, description: `${owner} review` }, `${owner} body`),
        ),
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const skills = yield* SkillAsset.Service
        const input = yield* currentInput
        const references = yield* Effect.forEach(["one", "two"], (owner) =>
          skills.getByPath(`${owner}/review/SKILL.md`).pipe(
            Effect.map(
              (skill) =>
                new Composition.SkillRef({
                  kind: "skill",
                  relativePath: skill.relativePath,
                  revision: Composition.Revision.make(skill.revision),
                }),
            ),
          ),
        )
        yield* Effect.forEach(["orchestrator", "agents/coder"], (consumer) =>
          Effect.gen(function* () {
            const collision = new Composition.TemporaryInput({
              ...input,
              bindings: {
                ...input.bindings,
                [consumer]: new Composition.Binding({ prompts: [], skills: references, commands: [] }),
              },
            })
            const plan = yield* resolver.resolve(collision)
            expect(plan.valid).toBe(false)
            expect(plan.diagnostics).toContainEqual(
              expect.objectContaining({
                severity: "blocking",
                code: "skill_id_conflict",
                message: expect.stringContaining(`Consumer '${consumer}'`),
              }),
            )
            const profile = yield* saveProfile(directory.path, collision)
            const health = yield* resolver.checkHealth(profile.relativePath)
            expect(health.status).toBe("broken")
            expect(health.diagnostics.map((diagnostic) => diagnostic.code)).toContain("skill_id_conflict")
            const error = yield* resolver
              .freeze(
                new Composition.FreezeInput({
                  input: new Composition.ProfileInput({
                    source: "profile",
                    profilePath: profile.relativePath,
                    profileRevision: Composition.Revision.make(profile.revision),
                  }),
                }),
              )
              .pipe(Effect.flip)
            expect(error.code).toBe("invalid_composition_plan")
            expect(error.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("skill_id_conflict")
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("allows equal Skill IDs with different bodies when they belong to different consumers", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.forEach(["one", "two"], (owner) =>
        fs.writeWithDirs(
          path.join(directory.path, `.omnixa/skills/${owner}/review/SKILL.md`),
          markdown({ kind: "skill", name: `review-${owner}`, description: `${owner} review` }, `${owner} body`),
        ),
      )
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const skills = yield* SkillAsset.Service
        const input = yield* currentInput
        const references = yield* Effect.forEach(["one", "two"], (owner) =>
          skills.getByPath(`${owner}/review/SKILL.md`).pipe(
            Effect.map(
              (skill) =>
                new Composition.SkillRef({
                  kind: "skill",
                  relativePath: skill.relativePath,
                  revision: Composition.Revision.make(skill.revision),
                }),
            ),
          ),
        )
        const separated = new Composition.TemporaryInput({
          ...input,
          bindings: {
            orchestrator: new Composition.Binding({ prompts: [], skills: [references[0]], commands: [] }),
            "agents/coder": new Composition.Binding({ prompts: [], skills: [references[1]], commands: [] }),
          },
        })
        const plan = yield* resolver.resolve(separated)
        expect(plan.valid).toBe(true)
        expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("skill_id_conflict")
        const profile = yield* saveProfile(directory.path, separated)
        expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("healthy")
        const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input: separated }))
        expect(frozen.data.bindings?.orchestrator.skills[0].content).toContain("one body")
        expect(frozen.data.bindings?.["agents/coder"].skills[0].content).toContain("two body")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("reuses the real graph owner for cycles, targets, reachability and selected agent validation", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const workflows = yield* WorkflowAsset.Service
        const input = yield* currentInput
        yield* Effect.forEach(
          [
            [{ id: "cycle", name: "Cycle", agent: "coder", input: {}, next: "cycle" }],
            [{ id: "target", name: "Target", agent: "coder", input: {}, next: "missing" }],
            [{ id: "branch", name: "Branch", agent: "coder", input: {}, branches: { yes: "missing" } }],
            [{ id: "parallel", name: "Parallel", agent: "coder", input: {}, parallel: ["missing"] }],
            [
              { id: "first", name: "First", agent: "coder", input: {}, next: "END" },
              { id: "island", name: "Island", agent: "coder", input: {}, next: "END" },
            ],
          ],
          (steps) =>
            Effect.gen(function* () {
              yield* fs.writeWithDirs(
                path.join(directory.path, ".omnixa/workflows/review.yaml"),
                AssetYaml.stringify({
                  kind: "workflow",
                  name: "review",
                  description: "Invalid graph",
                  version: "1.0.0",
                  steps,
                }),
              )
              yield* workflows.reload()
              const asset = yield* workflows.getByPath("review.yaml")
              const plan = yield* resolver.resolve(
                new Composition.TemporaryInput({
                  ...input,
                  workflow: new Composition.WorkflowRef({
                    kind: "workflow",
                    relativePath: asset.relativePath,
                    revision: Composition.Revision.make(asset.revision),
                  }),
                }),
              )
              expect(plan.valid).toBe(false)
              expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_workflow_graph")
            }),
        )
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/workflows/review.yaml"),
          AssetYaml.stringify({
            kind: "workflow",
            name: "review",
            description: "Unknown agent",
            version: "1.0.0",
            steps: [{ id: "root", name: "Root", agent: "meta", input: {}, next: "END" }],
          }),
        )
        yield* workflows.reload()
        const current = yield* workflows.getByPath("review.yaml")
        const missingAgent = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            workflow: new Composition.WorkflowRef({
              kind: "workflow",
              relativePath: current.relativePath,
              revision: Composition.Revision.make(current.revision),
            }),
          }),
        )
        expect(missingAgent.diagnostics.map((diagnostic) => diagnostic.code)).toContain("workflow_unknown_agent")
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("normalizes owner-relative paths and returns diagnostics for invalid paths or distinct owner prefixes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const input = yield* currentInput
        const binding = input.bindings["agents/coder"]
        const normalized = new Composition.TemporaryInput({
          ...input,
          agents: input.agents.map(
            (ref) => new Composition.AgentRef({ ...ref, relativePath: ` ${ref.relativePath} ` }),
          ),
          workflow: input.workflow && new Composition.WorkflowRef({ ...input.workflow, relativePath: " review.yaml " }),
          bindings: {
            "agents/coder": new Composition.Binding({
              prompts: [new Composition.PromptRef({ ...binding.prompts[0], relativePath: " system.md " })],
              skills: [new Composition.SkillRef({ ...binding.skills[0], relativePath: " git\\SKILL.md " })],
              commands: [new Composition.CommandRef({ ...binding.commands[0], relativePath: " check.md " })],
            }),
          },
        })
        expect((yield* resolver.resolve(normalized)).valid).toBe(true)
        const invalid = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [new Composition.AgentRef({ ...input.agents[0], relativePath: "../coder.md" })],
            workflow: undefined,
            bindings: {},
          }),
        )
        expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_asset_path")
        const prefixed = yield* resolver.resolve(
          new Composition.TemporaryInput({
            ...input,
            agents: [new Composition.AgentRef({ ...input.agents[0], relativePath: ".omnixa/agents/coder.md" })],
            workflow: undefined,
            bindings: {},
          }),
        )
        expect(prefixed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_not_found")

        const mcps = yield* MCPAsset.Service
        const mcp = yield* mcps.getByPath("servers/probe.md")
        const kinds: readonly Composition.AllowedKind[] = ["agent", "prompt", "skill", "workflow", "command", "mcp"]
        yield* Effect.forEach(kinds, (kind) =>
          Effect.gen(function* () {
            const extension = kind === "workflow" ? ".yaml" : ".md"
            yield* Effect.forEach(
              [
                { relativePath: `../escaped${extension}`, expectedCode: "invalid_asset_path" },
                {
                  relativePath: `missing${extension}`,
                  expectedCode: kind === "mcp" ? "mcp_asset_not_found" : `${kind}_not_found`,
                },
              ],
              (boundary) =>
                Effect.gen(function* () {
                  const candidate = new Composition.TemporaryInput({
                    ...input,
                    agents:
                      kind === "agent"
                        ? [new Composition.AgentRef({ ...input.agents[0], relativePath: boundary.relativePath })]
                        : input.agents,
                    workflow:
                      kind === "workflow" && input.workflow
                        ? new Composition.WorkflowRef({ ...input.workflow, relativePath: boundary.relativePath })
                        : undefined,
                    bindings: {
                      "agents/coder": new Composition.Binding({
                        prompts:
                          kind === "prompt"
                            ? [
                                new Composition.PromptRef({
                                  ...binding.prompts[0],
                                  relativePath: boundary.relativePath,
                                }),
                              ]
                            : [],
                        skills:
                          kind === "skill"
                            ? [new Composition.SkillRef({ ...binding.skills[0], relativePath: boundary.relativePath })]
                            : [],
                        commands:
                          kind === "command"
                            ? [
                                new Composition.CommandRef({
                                  ...binding.commands[0],
                                  relativePath: boundary.relativePath,
                                }),
                              ]
                            : [],
                      }),
                    },
                  })
                  const profile = yield* saveProfile(
                    directory.path,
                    candidate,
                    kind === "mcp"
                      ? [
                          {
                            serverName: "probe",
                            ref: {
                              relativePath: boundary.relativePath,
                              revision: Composition.Revision.make(mcp.revision),
                            },
                            transport: "remote",
                            url: "https://example.test/mcp",
                          },
                        ]
                      : [],
                  )
                  const plan = yield* resolver.resolve(
                    new Composition.ProfileInput({
                      source: "profile",
                      profilePath: profile.relativePath,
                      profileRevision: Composition.Revision.make(profile.revision),
                    }),
                  )
                  expect(plan.valid).toBe(false)
                  expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(boundary.expectedCode)
                  expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
                }),
            )
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("uses reloaded owner revisions while keeping the declared input digest stable", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const prompts = yield* PromptAsset.Service
        const input = yield* currentInput
        const profile = yield* saveProfile(directory.path, input)
        const profileInput = new Composition.ProfileInput({
          source: "profile",
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        })
        const original = yield* resolver.resolve(profileInput)
        yield* fs.writeWithDirs(
          path.join(directory.path, ".omnixa/prompts/system.md"),
          markdown({ kind: "prompt", name: "system", description: "Updated prompt" }, "Updated prompt body"),
        )
        yield* prompts.reload()
        const stale = yield* resolver.resolve(profileInput)
        expect(stale.valid).toBe(false)
        expect(stale.digest).toBe(original.digest)
        expect(stale.instructions.some((instruction) => instruction.content === "Updated prompt body")).toBe(true)
        const degraded = yield* resolver.checkHealth(profile.relativePath)
        expect(degraded.status).toBe("degraded")
        expect(degraded.staleRevisions).toHaveLength(1)
        expect(degraded.staleRevisions[0]?.kind).toBe("prompt")

        const repaired = yield* saveProfile(directory.path, yield* currentInput)
        expect(repaired.revision).not.toBe(profile.revision)
        const oldInput = yield* resolver.resolve(profileInput)
        expect(oldInput.valid).toBe(false)
        expect(oldInput.digest).toBe(original.digest)
        expect(oldInput.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["profile_stale_revision"])
        const current = yield* resolver.resolve(
          new Composition.ProfileInput({
            ...profileInput,
            profileRevision: Composition.Revision.make(repaired.revision),
          }),
        )
        expect(current.valid).toBe(true)
        expect(current.digest).not.toBe(original.digest)
        expect((yield* resolver.checkHealth(repaired.relativePath)).status).toBe("healthy")

        yield* fs.writeWithDirs(path.join(directory.path, ".omnixa/prompts/system.md"), "invalid frontmatter")
        yield* prompts.reload()
        const broken = yield* resolver.checkHealth(repaired.relativePath)
        expect(broken.status).toBe("broken")
        expect(broken.diagnostics.map((diagnostic) => diagnostic.code)).toContain("prompt_not_found")
        expect(broken.staleRevisions).toEqual([])
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("resolves identical Profile paths only from their owning Location", () =>
    Effect.gen(function* () {
      const directories = [yield* tmpdirScoped(), yield* tmpdirScoped()]
      const fs = yield* FSUtil.Service
      const saved = yield* Effect.forEach(directories, (directory, index) =>
        Effect.gen(function* () {
          yield* writeFixture(directory.path)
          yield* fs.writeWithDirs(
            path.join(directory.path, ".omnixa/agents/coder.md"),
            markdown({ kind: "agent", name: "coder", description: `Location ${index}` }, `Location ${index} body`),
          )
          return yield* Effect.gen(function* () {
            const input = yield* currentInput
            const profile = yield* saveProfile(directory.path, input)
            return new Composition.ProfileInput({
              source: "profile",
              profilePath: profile.relativePath,
              profileRevision: Composition.Revision.make(profile.revision),
            })
          }).pipe(Effect.provide(fullLayer(directory.path)))
        }),
      )
      yield* Effect.forEach(directories, (directory, index) =>
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(saved[index])
          expect(plan.valid).toBe(true)
          expect(plan.instructions.some((instruction) => instruction.content === `Location ${index} body`)).toBe(true)
          expect(plan.instructions.some((instruction) => instruction.content === `Location ${1 - index} body`)).toBe(
            false,
          )
          const foreign = yield* resolver.resolve(saved[1 - index])
          expect(foreign.valid).toBe(false)
          expect(foreign.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["profile_stale_revision"])
          expect(foreign.instructions.some((instruction) => instruction.content === `Location ${index} body`)).toBe(
            true,
          )
          expect((yield* resolver.checkHealth("dev.yaml")).status).toBe("healthy")
        }).pipe(Effect.provide(fullLayer(directory.path))),
      )
    }),
  )

  it.live("rejects duplicate MCP servers and reuses the canonical server grammar", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* writeFixture(directory.path)
      yield* Effect.gen(function* () {
        const resolver = yield* CompositionResolver.Service
        const mcp = yield* MCPAsset.Service
        const input = yield* currentInput
        const asset = yield* mcp.getByPath("servers/probe.md")
        const binding = {
          serverName: "probe",
          ref: { relativePath: asset.relativePath, revision: Composition.Revision.make(asset.revision) },
          transport: "remote",
          url: "https://example.test/mcp",
        }
        const duplicated = yield* saveProfile(directory.path, input, [binding, binding])
        const repeated = yield* resolver.resolve(
          new Composition.ProfileInput({
            source: "profile",
            profilePath: duplicated.relativePath,
            profileRevision: Composition.Revision.make(duplicated.revision),
          }),
        )
        expect(repeated.valid).toBe(false)
        expect(repeated.mcp.requested).toHaveLength(2)
        expect(repeated.mcp.denied.map((entry) => entry.reason)).toEqual(["not_connected", "duplicate_binding"])
        expect(repeated.diagnostics.map((diagnostic) => diagnostic.code)).toContain("mcp_duplicate_binding")
        yield* Effect.forEach(["Probe", "bad.name", "p".repeat(65)], (serverName) =>
          Effect.gen(function* () {
            const profile = yield* saveProfile(directory.path, input, [{ ...binding, serverName }])
            const plan = yield* resolver.resolve(
              new Composition.ProfileInput({
                source: "profile",
                profilePath: profile.relativePath,
                profileRevision: Composition.Revision.make(profile.revision),
              }),
            )
            expect(plan.valid).toBe(false)
            expect(plan.mcp.denied[0]?.reason).toBe("invalid_server_name")
            expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("mcp_invalid_server_name")
            expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
          }),
        )
      }).pipe(Effect.provide(fullLayer(directory.path)))
    }),
  )

  it.live("previews facts published by the real MCP owner without calling its tools", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const fs = yield* FSUtil.Service
        yield* writeFixture(directory.path)
        const databaseCredentials = AppNodeBuilder.build(LayerNode.group([Credential.node, Database.node, Bus.node]), [
          Bus.node.replace(Bus.configured({ persist: true })),
        ])
        const bindingStore = McpCredentialBindingStore.layer.pipe(Layer.provide(databaseCredentials))
        const ownerLayer = McpConnection.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              permissionLayer(),
              toolLayer,
              AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node])),
              bindingStore,
              databaseCredentials,
              CredentialScanner.layer,
              FetchHttpClient.layer,
            ),
          ),
          Layer.provide(
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(directory.path) })),
            ),
          ),
          Layer.fresh,
        )
        yield* Effect.gen(function* () {
          const owner = yield* McpConnection.Service
          const tools = yield* Tool.Service
          const marker = path.join(directory.path, "mcp-called.txt")
          yield* Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const mcp = yield* MCPAsset.Service
            const input = yield* currentInput
            const asset = yield* mcp.getByPath("servers/probe.md")
            const profile = yield* saveProfile(directory.path, input, [
              {
                serverName: "probe",
                ref: { relativePath: asset.relativePath, revision: Composition.Revision.make(asset.revision) },
                transport: "stdio",
                command: [
                  process.execPath,
                  path.join(import.meta.dir, "fixture/mcp/fake-mcp-server.mjs"),
                  "results",
                  marker,
                ],
              },
            ])
            const connected = yield* owner.connect({ binding: profile.profile.mcpBindings[0] })
            expect(connected.health).toBe("ready")
            const facts = yield* owner.facts()
            expect(facts).toHaveLength(1)
            expect(facts[0]?.tools).toHaveLength(9)
            expect(facts[0]?.tools).toContain(McpRegistration.canonicalToolName("probe", "echo"))
            const profileInput = new Composition.ProfileInput({
              source: "profile",
              profilePath: profile.relativePath,
              profileRevision: Composition.Revision.make(profile.revision),
            })
            const plan = yield* resolver.resolve(profileInput)
            expect(plan.valid).toBe(true)
            expect(plan.mcp.effective[0]).toMatchObject({
              serverName: "probe",
              health: "ready",
              credentialStatus: "not-required",
              tools: facts[0]?.tools,
            })
            expect(plan.costPreview?.effectiveToolCount).toBe(1)
            expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("healthy")
            expect(yield* fs.existsSafe(marker)).toBe(false)
            expect((yield* owner.connections())[0]?.health).toBe("ready")
            expect(JSON.stringify(plan)).not.toContain("fake-mcp-server.mjs")
            yield* Effect.forEach(
              [
                { ...profile.profile.mcpBindings[0], command: ["/does/not/exist"] },
                {
                  ...profile.profile.mcpBindings[0],
                  transport: "remote" as const,
                  url: "https://changed.example.test/mcp",
                },
              ],
              (binding) =>
                Effect.gen(function* () {
                  const changed = yield* saveProfile(directory.path, input, [binding])
                  const preview = yield* resolver.resolve(
                    new Composition.ProfileInput({
                      source: "profile",
                      profilePath: changed.relativePath,
                      profileRevision: Composition.Revision.make(changed.revision),
                    }),
                  )
                  expect(preview.valid).toBe(false)
                  expect(preview.mcp.effective).toEqual([])
                  expect(preview.mcp.denied[0]?.reason).toBe("binding_mismatch")
                  expect((yield* resolver.checkHealth(changed.relativePath)).status).toBe("broken")
                  expect((yield* owner.connections())[0]?.health).toBe("ready")
                  expect(yield* fs.existsSafe(marker)).toBe(false)
                }),
            )
            yield* saveProfile(directory.path, input, profile.profile.mcpBindings)
            yield* owner.disconnect("probe")
            expect(yield* owner.facts()).toEqual([])
            expect((yield* tools.snapshot()).definitions.map((definition) => definition.name)).toEqual(["execute"])
            const disconnected = yield* resolver.resolve(profileInput)
            expect(disconnected.valid).toBe(false)
            expect(disconnected.mcp.denied[0]?.reason).toBe("not_connected")
            expect(disconnected.costPreview?.effectiveToolCount).toBe(1)
          }).pipe(
            Effect.provide(fullLayer(directory.path, { readFacts: owner.facts, tools })),
            Effect.provide(Layer.mock(Credential.Service, {})),
          )
        }).pipe(Effect.provide(ownerLayer))
      }),
    ),
  )

  it.live(
    "projects MCP facts without connecting, reading credential material or advertising other MCP definitions",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        yield* writeFixture(directory.path)
        const facts: McpConnection.Fact[] = []
        yield* Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const mcp = yield* MCPAsset.Service
          const tools = yield* Tool.Service
          const input = yield* currentInput
          const asset = yield* mcp.getByPath("servers/probe.md")
          const revision = Composition.Revision.make(asset.revision)
          const profile = yield* saveProfile(directory.path, input, [
            {
              serverName: "probe",
              ref: { relativePath: asset.relativePath, revision },
              transport: "remote",
              url: "https://example.test/mcp",
              credentialRef: "cred_opaque",
            },
          ])
          const profileInput = new Composition.ProfileInput({
            source: "profile",
            profilePath: profile.relativePath,
            profileRevision: Composition.Revision.make(profile.revision),
          })
          const offline = yield* resolver.resolve(profileInput)
          expect(offline.mcp.denied[0]?.reason).toBe("not_connected")
          expect(offline.mcp.denied[0]?.credentialStatus).toBeUndefined()
          expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("broken")
          const canonicalName = McpRegistration.canonicalToolName("probe", "read")
          facts.push(
            new McpConnection.Fact({
              serverName: "probe",
              ref: { relativePath: asset.relativePath, revision },
              transportFingerprint: McpConnection.transportFingerprint(profile.profile.mcpBindings[0]),
              credentialRef: "cred_wrong",
              credentialStatus: "available",
              health: "ready",
              tools: [canonicalName],
            }),
          )
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.reason).toBe("binding_mismatch")
          facts[0] = new McpConnection.Fact({
            ...facts[0],
            credentialRef: "cred_opaque",
            ref: { relativePath: "servers/other.md", revision },
          })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.reason).toBe("binding_mismatch")
          facts[0] = new McpConnection.Fact({
            ...facts[0],
            ref: { relativePath: asset.relativePath, revision: Composition.Revision.make("0".repeat(64)) },
          })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.reason).toBe("binding_mismatch")
          facts[0] = new McpConnection.Fact({
            ...facts[0],
            ref: { relativePath: asset.relativePath, revision },
            health: "offline",
          })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]).toMatchObject({
            reason: "not_ready",
            health: "offline",
          })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.credentialStatus).toBe("available")
          facts[0] = new McpConnection.Fact({
            ...facts[0],
            credentialRef: "cred_opaque",
            health: "revoked",
            credentialStatus: "revoked",
          })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]).toMatchObject({
            reason: "not_ready",
            health: "revoked",
            credentialStatus: "revoked",
          })
          facts[0] = new McpConnection.Fact({ ...facts[0], health: "auth-required", credentialStatus: "missing" })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.credentialStatus).toBe("missing")
          facts[0] = new McpConnection.Fact({ ...facts[0], credentialStatus: "expired" })
          expect((yield* resolver.resolve(profileInput)).mcp.denied[0]?.credentialStatus).toBe("expired")
          facts[0] = new McpConnection.Fact({ ...facts[0], health: "ready", credentialStatus: "available" })
          yield* McpRegistration.registerServer(tools, {
            serverName: "probe",
            tools: {
              read: {
                name: "read",
                description: "Read",
                input: Schema.Struct({}),
                output: Schema.String,
                options: { codemode: false },
                execute: () => Effect.die("preview executed MCP"),
              },
            },
          })
          const ready = yield* resolver.resolve(profileInput)
          expect(ready.valid).toBe(true)
          expect(ready.mcp.effective[0]).toMatchObject({
            serverName: "probe",
            health: "ready",
            credentialRef: "cred_opaque",
            credentialStatus: "available",
            tools: [canonicalName],
          })
          expect(ready.costPreview?.effectiveToolCount).toBe(2)
          expect((yield* resolver.checkHealth(profile.relativePath)).status).toBe("healthy")
          expect(JSON.stringify(ready)).not.toContain("must stay out of plan")
          expect(JSON.stringify(ready)).not.toContain("https://example.test/mcp")
        }).pipe(Effect.provide(fullLayer(directory.path, { facts })))
      }),
  )
})
