import assert from "node:assert/strict"
import path from "node:path"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
// The schema and registry export the same CustomProfile name.
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { CustomProfile } from "../../src/custom-profile"
import { CustomProfileService } from "../../src/custom-profile-service"
import { FileMutation } from "../../src/file-mutation"
import { LocationMutation } from "../../src/location-mutation"
import { Location } from "../../src/location"
import { AbsolutePath } from "../../src/schema"
import { WorkflowAsset } from "../../src/workflow-asset"
import { PluginAsset } from "../../src/plugin-asset"
import { AgentAssetBridge } from "../../src/agent/asset-bridge"
import { ProposePluginAssetTool } from "../../src/tool/propose-plugin-asset"
import { ProposeWorkflowAssetTool } from "../../src/tool/propose-workflow-asset"
import { location } from "./location"
import { hostEnvironmentLayer } from "./environment"

const workflow = `kind: workflow
name: on
description: "中文: YAML # keeps quotes"
version: "1.0.0"
steps:
  - id: first
    name: review
    agent: builtin
    input:
      label: &label "中文: quoted # text"
      alias: *label
      enabled: true
      plain_yes: yes
      plain_on: on
      date: 2026-10-19
      decimal: 010
`
const plugin = `kind: plugin
name: yes
description: &description "中文: YAML # keeps quotes"
version: "1.0.0"
author:
  name: *description
hooks:
  - event: PreToolUse
    command: 'printf "中文: # text"'
    timeout: 30
`
// Each level reuses ten copies of its predecessor. The parser's default alias
// bound must reject this before any schema or registry can accept the asset.
const aliases = [
  "a: &a [seed]",
  `b: &b [${Array(10).fill("*a").join(", ")}]`,
  `c: &c [${Array(10).fill("*b").join(", ")}]`,
  `d: &d [${Array(10).fill("*c").join(", ")}]`,
].join("\n")

const probe = Effect.gen(function* () {
  const filesystem = yield* FileSystem.FileSystem
  const directory = yield* filesystem.makeTempDirectoryScoped({ prefix: "aigcfroge-asset-yaml-" })
  const canonical = yield* filesystem.realPath(directory)
  const scope = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(canonical) })),
  )
  const files = FSUtil.layer
  const profiles = CustomProfileService.locationLayer.pipe(
    Layer.provide(FileMutation.layer),
    Layer.provide(LocationMutation.locationLayer),
    Layer.provideMerge(CustomProfile.locationLayer),
    Layer.provide(scope),
    Layer.provide(files),
    Layer.provide(hostEnvironmentLayer),
  )
  const registries = Layer.merge(WorkflowAsset.locationLayer, PluginAsset.locationLayer).pipe(
    Layer.provide(scope),
    Layer.provide(files),
  )

  yield* Effect.gen(function* () {
    const service = yield* CustomProfileService.Service
    const registry = yield* CustomProfile.Service
    const candidate = Schema.decodeUnknownSync(SchemaCustomProfile.Candidate)({
      name: "runtime-profile",
      description: '中文: YAML # preserves "quotes"\nsecond line',
      relativePath: "nested/runtime-profile.yaml",
      profile: {
        kind: "custom-profile",
        name: "runtime-profile",
        description: '中文: YAML # preserves "quotes"\nsecond line',
        agents: [{ kind: "agent", relativePath: "coder.md", revision: "0".repeat(64) }],
        bindings: { "agents/coder": { prompts: [], skills: [] } },
        presentation: "native",
        requestedCapabilities: ["workspace.read"],
      },
    })
    assert.equal((yield* service.propose(candidate)).exists, false)
    const created = yield* service.apply({ candidate, baseRevision: null, overwrite: false })
    assert.deepEqual(
      Schema.encodeSync(SchemaCustomProfile.Profile)(created.profile),
      Schema.encodeSync(SchemaCustomProfile.Profile)(candidate.profile),
    )
    assert.equal(created.revision.length, 64)
    const loaded = yield* registry.getByPath(candidate.relativePath)
    assert.equal(
      loaded.rawYaml,
      yield* filesystem.readFileString(path.join(canonical, CustomProfile.CUSTOM_PROFILES_DIR, candidate.relativePath)),
    )
    assert.equal(loaded.revision, created.revision)
    const repeated = yield* service.apply({ candidate, baseRevision: created.revision, overwrite: true })
    assert.equal(repeated.revision, created.revision)
    const updatedCandidate = Schema.decodeUnknownSync(SchemaCustomProfile.Candidate)({
      ...candidate,
      description: "false",
      profile: { ...candidate.profile, description: "false" },
    })
    const updated = yield* service.apply({
      candidate: updatedCandidate,
      baseRevision: repeated.revision,
      overwrite: true,
    })
    assert.equal(updated.description, "false")
    assert.notEqual(updated.revision, created.revision)
    const stale = yield* service.apply({ candidate, baseRevision: created.revision, overwrite: true }).pipe(Effect.flip)
    assert.equal(stale._tag, "CustomProfileService.StaleRevision")
    assert.equal((yield* registry.getByPath(candidate.relativePath)).revision, updated.revision)
    yield* filesystem.writeFileString(path.join(canonical, CustomProfile.CUSTOM_PROFILES_DIR, "aliases.yaml"), aliases)
    yield* registry.reload()
    assert.equal((yield* registry.getInvalid("aliases.yaml"))?.errorTag, "parse_error")
    const deleted = yield* service.delete({ relativePath: candidate.relativePath, baseRevision: updated.revision })
    assert.equal(deleted.relativePath, candidate.relativePath)
    assert.equal((yield* service.propose(candidate)).exists, false)
    assert.equal(yield* registry.findByName(candidate.name), undefined)
    assert.equal(
      yield* filesystem.exists(path.join(canonical, CustomProfile.CUSTOM_PROFILES_DIR, candidate.relativePath)),
      false,
    )
  }).pipe(Effect.provide(profiles))

  yield* filesystem.makeDirectory(path.join(canonical, WorkflowAsset.WORKFLOWS_DIR), { recursive: true })
  yield* filesystem.makeDirectory(path.join(canonical, PluginAsset.PLUGINS_DIR), { recursive: true })
  yield* Effect.forEach(
    [
      { directory: WorkflowAsset.WORKFLOWS_DIR, filename: "valid.yaml", content: workflow },
      { directory: WorkflowAsset.WORKFLOWS_DIR, filename: "aliases.yaml", content: workflow + aliases },
      { directory: WorkflowAsset.WORKFLOWS_DIR, filename: "broken.yaml", content: "steps: [" },
      {
        directory: WorkflowAsset.WORKFLOWS_DIR,
        filename: "schema.yaml",
        content: workflow.replace("kind: workflow", "kind: plugin"),
      },
      { directory: PluginAsset.PLUGINS_DIR, filename: "valid.plugin.yaml", content: plugin },
      { directory: PluginAsset.PLUGINS_DIR, filename: "aliases.plugin.yaml", content: plugin + aliases },
      { directory: PluginAsset.PLUGINS_DIR, filename: "broken.plugin.yaml", content: "hooks: [" },
      {
        directory: PluginAsset.PLUGINS_DIR,
        filename: "schema.plugin.yaml",
        content: plugin.replace("kind: plugin", "kind: workflow"),
      },
    ],
    (input) => filesystem.writeFileString(path.join(canonical, input.directory, input.filename), input.content),
  )

  yield* Effect.gen(function* () {
    const workflows = yield* WorkflowAsset.Service
    const plugins = yield* PluginAsset.Service
    assert.equal((yield* workflows.list()).length, 1)
    assert.equal((yield* plugins.list()).length, 1)
    const loadedWorkflow = yield* workflows.getByPath("valid.yaml")
    assert.equal(loadedWorkflow.name, "on")
    assert.equal(loadedWorkflow.version, "1.0.0")
    assert.deepEqual(loadedWorkflow.steps[0].input, {
      label: "中文: quoted # text",
      alias: "中文: quoted # text",
      enabled: true,
      plain_yes: "yes",
      plain_on: "on",
      date: "2026-10-19",
      decimal: 10,
    })
    const loadedPlugin = yield* plugins.getByPath("valid.plugin.yaml")
    assert.equal(loadedPlugin.name, "yes")
    assert.equal(loadedPlugin.author?.name, loadedPlugin.description)
    assert.equal(loadedPlugin.hooks[0].command, 'printf "中文: # text"')
    assert.equal(loadedPlugin.hooks[0].timeout, 30)
    assert.deepEqual((yield* workflows.listInvalid()).map((item) => [item.relativePath, item.errorTag]).sort(), [
      ["aliases.yaml", "parse_error"],
      ["broken.yaml", "parse_error"],
      ["schema.yaml", "bad_frontmatter"],
    ])
    assert.deepEqual((yield* plugins.listInvalid()).map((item) => [item.relativePath, item.errorTag]).sort(), [
      ["aliases.plugin.yaml", "parse_error"],
      ["broken.plugin.yaml", "parse_error"],
      ["schema.plugin.yaml", "bad_frontmatter"],
    ])
  }).pipe(Effect.provide(registries))

  assert.equal(ProposeWorkflowAssetTool.validateContent(workflow), null)
  assert.equal(ProposePluginAssetTool.validateContent(plugin), null)
  assert.equal(ProposeWorkflowAssetTool.validateContent(workflow + aliases), "Invalid YAML format in workflow content.")
  assert.equal(ProposePluginAssetTool.validateContent(plugin + aliases), "Invalid YAML format in plugin content.")
  assert.equal(ProposeWorkflowAssetTool.validateContent("steps: ["), "Invalid YAML format in workflow content.")
  assert.equal(ProposePluginAssetTool.validateContent("hooks: ["), "Invalid YAML format in plugin content.")
  assert.match(
    ProposeWorkflowAssetTool.validateContent(workflow.replace("kind: workflow", "kind: plugin")) ?? "",
    /required schema/,
  )
  assert.match(
    ProposePluginAssetTool.validateContent(plugin.replace("kind: plugin", "kind: workflow")) ?? "",
    /required schema/,
  )
  const agentConfig = `model: anthropic/claude-3-5-sonnet\nmode: subagent\nhidden: true\nsteps: 3\n`
  const config = AgentAssetBridge.parseAgentAssetConfig(agentConfig)
  assert.ok(config?.model && "providerID" in config.model)
  assert.equal(config?.model?.providerID, "anthropic")
  assert.equal(config?.model?.model, "claude-3-5-sonnet")
  assert.equal(config?.hidden, true)
  const agent = AgentAssetBridge.agentAssetToAgentInfo({
    kind: "agent",
    name: "reviewer",
    description: "runtime reviewer",
    relativePath: "reviewer.md",
    config: agentConfig,
    source: "Review YAML assets.",
    revision: "0".repeat(64),
    handoffs: [],
  })
  assert.equal(agent?.mode, "subagent")
  assert.equal(agent?.hidden, true)
  assert.equal(agent?.steps, 3)
  assert.ok(agent?.model && "id" in agent.model)
  assert.equal(agent?.model?.id, "claude-3-5-sonnet")
  const mergedConfig = AgentAssetBridge.parseAgentAssetConfig(`defaults: &defaults
  hidden: true
  mode: subagent
<<: *defaults
steps: 3
`)
  assert.equal(mergedConfig?.hidden, true)
  assert.equal(mergedConfig?.mode, "subagent")
  const duplicateConfig = AgentAssetBridge.parseAgentAssetConfig("hidden: false\nhidden: true\n")
  assert.equal(duplicateConfig?.hidden, true)
  const directiveConfig = AgentAssetBridge.parseAgentAssetConfig("%YAML 1.1\n---\ndescription: on\nhidden: true\n")
  assert.equal(directiveConfig?.description, "on")
  assert.equal(AgentAssetBridge.parseAgentAssetConfig("steps: ["), undefined)
  assert.equal(AgentAssetBridge.parseAgentAssetConfig(agentConfig + aliases), undefined)
  assert.equal(AgentAssetBridge.parseAgentAssetConfig("steps: -1"), undefined)
  return {
    runtime: process.versions.bun ? "bun" : "node",
    node: process.version,
    bun: process.versions.bun ?? null,
    owners: 7,
  }
}).pipe(Effect.provide(NodeFileSystem.layer), Effect.scoped)

console.log(JSON.stringify(await Effect.runPromise(probe)))
