import path from "path"
import { Context, DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CredentialScan } from "@aigcfroge/schema/credential-scan"
import { computeMaxConcurrency, validateGraph } from "@aigcfroge/schema/workflow-asset"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Hash } from "@aigcfroge/util/hash"
import { Agent } from "./agent"
import { AgentAsset } from "./agent-asset"
import { AgentAssetBridge } from "./agent/asset-bridge"
import { AssetPlacement } from "./asset-placement"
import { App } from "./app"
import { CommandAsset } from "./command-asset"
import { CompositionDigest } from "./composition/digest"
import { CompositionReference } from "./composition/reference"
import { CustomProfile } from "./custom-profile"
import { MCPAsset } from "./mcp-asset"
import { MCPAssetPath } from "./mcp-asset/path"
import { McpConnection } from "./mcp/connection"
import { Location } from "./location"
import { PromptAsset } from "./prompt-asset"
import { AgentPlugin } from "./plugin/agent"
import { SkillAsset } from "./skill-asset"
import { CompositionCatalog } from "./skill/composition-catalog"
import { Tool } from "./tool"
import { SERVER_NAME_PATTERN } from "./tool/mcp-registration"
import { WorkflowAsset } from "./workflow-asset"
import { Model } from "./model.js"
import { ModelGroup } from "./model-group.js"

export interface Interface {
  readonly resolve: (input: Composition.CompositionInput) => Effect.Effect<Composition.Plan>
  readonly freeze: (input: Composition.FreezeInput) => Effect.Effect<Composition.SnapshotV2, Composition.ResolveError>
  readonly checkHealth: (profilePath: string) => Effect.Effect<Composition.Health, CustomProfile.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CompositionResolver") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const profiles = yield* CustomProfile.Service
    const agentAssets = yield* AgentAsset.Service
    const promptAssets = yield* PromptAsset.Service
    const skillAssets = yield* SkillAsset.Service
    const workflowAssets = yield* WorkflowAsset.Service
    const commandAssets = yield* CommandAsset.Service
    const mcpAssets = yield* MCPAsset.Service
    const connections = yield* McpConnection.Service
    const tools = yield* Tool.Service
    const runtimeAgents = yield* Agent.Service
    const location = yield* Location.Service
    const app = yield* App.Metadata
    const groups = yield* ModelGroup.Service

    const resolveInternal = Effect.fn("CompositionResolver.resolveInternal")(function* (
      input: Composition.CompositionInput,
      profileInfo?: CustomProfile.Info,
    ) {
      const issues: { readonly diagnostic: Composition.Diagnostic; readonly broken: boolean }[] = []
      const stale = new Map<string, Composition.StaleRevision>()
      const report = (diagnostic: Composition.Diagnostic, broken = true) => issues.push({ diagnostic, broken })
      const profile =
        input.source === "profile"
          ? (profileInfo ?? Option.getOrUndefined(yield* profiles.getByPath(input.profilePath).pipe(Effect.option)))
          : undefined
      if (input.source === "profile" && !profile) {
        report(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "profile_not_found",
            message: `Custom profile not found: ${input.profilePath}`,
            path: input.profilePath,
          }),
        )
      }
      if (
        input.source === "profile" &&
        profile &&
        Composition.Revision.make(profile.revision) !== input.profileRevision
      ) {
        report(
          new Composition.Diagnostic({
            severity: "error",
            code: "profile_stale_revision",
            message: `Profile revision mismatch: expected ${input.profileRevision}, found ${profile.revision}`,
            path: input.profilePath,
          }),
          false,
        )
        stale.set(
          `custom-profile:${profile.relativePath}`,
          new Composition.StaleRevision({
            kind: "custom-profile",
            relativePath: profile.relativePath,
            expectedRevision: input.profileRevision,
            currentRevision: Composition.Revision.make(profile.revision),
          }),
        )
      }
      const source = input.source === "temporary" ? input : profile?.profile
      const declaredAgents = source?.agents ?? []
      const declaredWorkflow = source?.workflow
      const declaredBindings = source?.bindings ?? {}
      const declaredMcp = profile?.profile.mcpBindings ?? []
      const declaredRoot = source?.root
      const rootID = declaredRoot?.id ?? "meta"

      // Fixed owners retain their Location catalogs. Source-aware families are
      // captured once per selected scope below; owners do not share a transaction.
      const catalogs = {
        agents: yield* agentAssets.list(),
        workflows: yield* workflowAssets.list(),
        mcp: yield* mcpAssets.list(),
      }
      const facts = yield* connections.facts()
      const seen = new Set<string>()
      const readAsset = <A extends { readonly relativePath: string; readonly revision: string }>(
        ref: Composition.AssetRef,
        catalog: readonly A[],
        consumer = "",
        target?: AssetPlacement.Target,
      ): Result.Result<A, string> => {
        const normalized = Result.try(() => CompositionReference.normalize(ref.kind, ref.relativePath))
        if (Result.isFailure(normalized)) {
          report(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "invalid_asset_path",
              message: `Invalid ${ref.kind} asset path: ${ref.relativePath}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          return Result.fail("invalid_asset_path")
        }
        const assetKey = CompositionReference.key(ref.kind, normalized.success, target)
        const identity = JSON.stringify([consumer, assetKey])
        if (seen.has(identity)) {
          report(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "duplicate_asset",
              message: `Asset is listed more than once for consumer '${consumer}': ${ref.kind} ${normalized.success}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          return Result.fail("duplicate_asset")
        }
        seen.add(identity)
        const asset = catalog.find(
          (candidate) => CompositionReference.key(ref.kind, candidate.relativePath, target) === assetKey,
        )
        if (!asset) {
          const code = ref.kind === "mcp" ? "mcp_asset_not_found" : `${ref.kind}_not_found`
          report(
            new Composition.Diagnostic({
              severity: ref.kind === "agent" || ref.kind === "workflow" ? "blocking" : "error",
              code,
              message: `${ref.kind} asset not found: ${normalized.success}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          return Result.fail(code)
        }
        if (asset.revision !== ref.revision) {
          const currentRevision = Composition.Revision.make(asset.revision)
          const code = ref.kind === "mcp" ? "mcp_asset_stale_revision" : `${ref.kind}_stale_revision`
          report(
            new Composition.Diagnostic({
              severity: "error",
              code,
              message: `${ref.kind} revision mismatch: expected ${ref.revision}, found ${currentRevision}`,
              path: ref.relativePath,
              asset: ref,
            }),
            false,
          )
          stale.set(
            JSON.stringify([assetKey, ref.revision]),
            new Composition.StaleRevision({
              kind: ref.kind,
              relativePath: asset.relativePath,
              expectedRevision: ref.revision,
              currentRevision,
              ...(target === undefined ? {} : { target }),
            }),
          )
        }
        return Result.succeed(asset)
      }

      const rootAsset =
        declaredRoot?.source === "asset"
          ? Result.getOrUndefined(readAsset(declaredRoot, catalogs.agents, "orchestrator"))
          : undefined
      const rootConfig = rootAsset === undefined ? undefined : AgentAssetBridge.parseAgentAssetConfig(rootAsset.config)
      const rootInfo =
        declaredRoot?.source === "asset"
          ? rootAsset === undefined
            ? undefined
            : AgentAssetBridge.agentAssetToAgentInfo(rootAsset)
          : yield* runtimeAgents
              .get(Agent.ID.make(rootID))
              .pipe(
                Effect.map((info) =>
                  info === undefined
                    ? undefined
                    : Schema.decodeUnknownSync(Agent.Info)(structuredClone(Schema.encodeSync(Agent.Info)(info))),
                ),
              )
      const rootUnavailable =
        rootInfo === undefined ||
        rootInfo.id !== rootID ||
        rootConfig?.disabled === true ||
        (declaredRoot === undefined ? rootInfo.mode !== "primary" : rootInfo.mode === "subagent" || rootInfo.hidden) ||
        (declaredRoot?.source === "asset"
          ? rootAsset === undefined ||
            rootInfo.originRelativePath !== rootAsset.relativePath ||
            rootInfo.originRevision !== rootAsset.revision
          : rootInfo.originKind === "user" ||
            rootInfo.originRelativePath !== undefined ||
            rootInfo.originRevision !== undefined)
      if (rootUnavailable)
        report(
          new Composition.Diagnostic({
            severity: "blocking",
            code:
              declaredRoot === undefined
                ? "orchestrator_unavailable"
                : declaredRoot.source === "asset"
                  ? "asset_root_unavailable"
                  : "builtin_root_unavailable",
            message:
              declaredRoot === undefined
                ? "Custom composition requires the platform meta agent"
                : `Selected ${declaredRoot.source} root '${rootID}' is unavailable or cannot run as a root`,
          }),
        )
      const rootCredentials =
        rootInfo !== undefined &&
        (containsCredentialField(rootInfo.request) || CredentialScan.containsSecret(JSON.stringify(rootInfo.request)))
      if (rootCredentials)
        report(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "orchestrator_request_credentials",
            message: "Root request contains credential material that cannot be frozen",
          }),
        )
      // The same rejection also protects the public Plan's canonical root configuration.
      const orchestrator = rootUnavailable || rootCredentials ? undefined : rootInfo

      const instructions: Composition.Instruction[] = []
      const skills: Composition.SkillInfo[] = []
      const executors: Composition.SnapshotExecutorData[] = []
      const frozenSkills = new Map<string, Composition.SnapshotSkillData>()
      const prompts = new Map<string, { readonly data: Composition.SnapshotPromptData; readonly name: string }>()
      const bindings: Record<string, Composition.SnapshotBindingData> = {
        orchestrator: new Composition.SnapshotBindingData({ instructions: [], prompts: [], skills: [], commands: [] }),
      }
      const commands = new Map<string, Composition.CommandInfo>()
      const allowedConsumers = new Set<string>(["orchestrator"])
      if (source && ((declaredAgents.length < 1 && declaredRoot === undefined) || declaredAgents.length > 16)) {
        report(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "invalid_agent_cardinality",
            message: `Composition must contain ${declaredRoot === undefined ? "1" : "0"}..16 user agents (got ${declaredAgents.length})`,
          }),
        )
      }
      const agents =
        declaredAgents.length > 16
          ? []
          : declaredAgents.flatMap((ref) => {
              const found = readAsset(ref, catalogs.agents)
              if (Result.isFailure(found)) return []
              const asset = found.success
              if (
                asset.name === "meta" ||
                (declaredRoot !== undefined && (asset.name === rootID || asset.name === orchestrator?.name))
              ) {
                report(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "root_agent_forbidden",
                    message: "The root identity cannot also be bound as a user agent",
                    path: ref.relativePath,
                    asset: ref,
                  }),
                )
                return []
              }
              const consumerKey = makeConsumerKey(asset.name, asset.relativePath)
              if (allowedConsumers.has(consumerKey)) {
                report(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "duplicate_consumer_key",
                    message: `More than one agent maps to consumer '${consumerKey}'`,
                    path: ref.relativePath,
                    asset: ref,
                  }),
                )
                return []
              }
              allowedConsumers.add(consumerKey)
              const info = AgentAssetBridge.agentAssetToAgentInfo(asset)
              const config = AgentAssetBridge.parseAgentAssetConfig(asset.config)
              if (asset.config.trim() && !config) {
                report(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "invalid_agent_config",
                    message: `Invalid execution configuration for agent '${asset.name}'`,
                    path: ref.relativePath,
                    asset: ref,
                  }),
                )
              }
              if (config?.disabled)
                report(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "agent_disabled",
                    message: `Selected agent '${asset.name}' is disabled`,
                    path: ref.relativePath,
                    asset: ref,
                  }),
                )
              // Frozen requests are durable data. Authentication stays with the
              // provider credential owner instead of entering the snapshot.
              if (
                config?.request &&
                (containsCredentialField(config.request.headers ?? {}) ||
                  containsCredentialField(config.request.body ?? {}) ||
                  CredentialScan.containsSecret(JSON.stringify(config.request)))
              )
                report(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "agent_request_credentials",
                    message: `Agent '${asset.name}' request contains credential material that cannot be frozen`,
                    path: ref.relativePath,
                    asset: ref,
                  }),
                )
              if (info) {
                executors.push(
                  new Composition.SnapshotExecutorData({
                    id: info.id,
                    relativePath: asset.relativePath,
                    revision: Composition.Revision.make(asset.revision),
                    info,
                  }),
                )
              }
              bindings[consumerKey] = new Composition.SnapshotBindingData({
                instructions: asset.source.trim()
                  ? [new Composition.Instruction({ source: `agent:${asset.name}`, content: asset.source.trim() })]
                  : [],
                prompts: [],
                skills: [],
                commands: [],
              })
              if (asset.source.trim())
                instructions.push(
                  new Composition.Instruction({ source: `agent:${asset.name}`, content: asset.source.trim() }),
                )
              return [
                new Composition.AgentInfo({
                  id: asset.name,
                  name: asset.name,
                  description: asset.description,
                  relativePath: asset.relativePath,
                  revision: Composition.Revision.make(asset.revision),
                  consumerKey,
                }),
              ]
            })

      const workflow = declaredWorkflow
        ? Result.getOrUndefined(readAsset(declaredWorkflow, catalogs.workflows))
        : undefined
      if (workflow && declaredWorkflow) {
        const graph = validateGraph(workflow.steps)
        if (!graph.valid)
          report(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "invalid_workflow_graph",
              message: `Invalid workflow graph: ${graph.errors.map((error) => error.message).join("; ")}`,
              path: workflow.relativePath,
              asset: declaredWorkflow,
            }),
          )
        const knownAgents = new Set(agents.flatMap((agent) => [agent.id, agent.name]))
        workflow.steps.forEach((step) => {
          if (knownAgents.has(step.agent)) return
          report(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "workflow_unknown_agent",
              message: `Workflow step '${step.id}' references unknown agent '${step.agent}'`,
              path: workflow.relativePath,
              asset: declaredWorkflow,
            }),
          )
        })
      }
      const workflowInfo = workflow
        ? new Composition.WorkflowInfo({
            name: workflow.name,
            description: workflow.description,
            relativePath: workflow.relativePath,
            revision: Composition.Revision.make(workflow.revision),
            steps: workflow.steps,
          })
        : undefined

      const captureSources = <A extends { readonly relativePath: string; readonly revision: string }>(
        refs: ReadonlyArray<Composition.PromptRef | Composition.SkillRef | Composition.CommandRef>,
        owner: {
          readonly list: () => Effect.Effect<ReadonlyArray<A>>
          readonly select: (scope: AssetPlacement.Scope) => Effect.Effect<
            {
              readonly target: AssetPlacement.Target
              readonly list: () => Effect.Effect<ReadonlyArray<A>, AssetPlacement.Error>
            },
            AssetPlacement.Error
          >
        },
      ) =>
        Effect.gen(function* () {
          const selections = yield* Effect.forEach(
            Array.from(new Set(refs.map((ref) => ref.target?.scope ?? "location"))),
            (scope) =>
              owner.select(scope).pipe(
                Effect.flatMap((selected) =>
                  Effect.gen(function* () {
                    const scopedRefs = refs.filter((ref) => (ref.target?.scope ?? "location") === scope)
                    const reviewed = new Map(
                      scopedRefs.flatMap((ref) =>
                        ref.target === undefined ? [] : [[ref.target.root, ref.target] as const],
                      ),
                    )
                    const mismatches = new Map(
                      Array.from(
                        reviewed,
                        ([root, target]) => [root, AssetPlacement.targetMismatch(target, selected.target)] as const,
                      ),
                    )
                    const valid = scopedRefs.some(
                      (ref) => ref.target === undefined || mismatches.get(ref.target.root) === undefined,
                    )
                    const catalog = yield* valid
                      ? scope === "location" && scopedRefs.some((ref) => ref.target === undefined)
                        ? owner.list()
                        : selected.list()
                      : Effect.succeed<ReadonlyArray<A>>([])
                    return {
                      target: selected.target,
                      mismatches,
                      catalog: catalog.map((asset) => ({ ...asset, target: selected.target })),
                    }
                  }),
                ),
                Effect.result,
                Effect.map((result) => [scope, result] as const),
              ),
          )
          return new Map(selections)
        })
      const selectedBindings = Object.entries(declaredBindings)
        .filter(([consumer]) => allowedConsumers.has(consumer))
        .map(([, binding]) => binding)
      const sources = {
        prompts: yield* captureSources(
          selectedBindings.flatMap((binding) => binding.prompts),
          promptAssets,
        ),
        skills: yield* captureSources(
          selectedBindings.flatMap((binding) => binding.skills),
          skillAssets,
        ),
        commands: yield* captureSources(
          selectedBindings.flatMap((binding) => binding.commands),
          commandAssets,
        ),
      }
      const readSelectedAsset = <A extends { readonly relativePath: string; readonly revision: string }>(
        ref: Composition.PromptRef | Composition.SkillRef | Composition.CommandRef,
        selections: ReadonlyMap<
          AssetPlacement.Scope,
          Result.Result<
            {
              readonly target: AssetPlacement.Target
              readonly mismatches: ReadonlyMap<
                AssetPlacement.Target["root"],
                AssetPlacement.TargetMismatchError | undefined
              >
              readonly catalog: ReadonlyArray<A>
            },
            AssetPlacement.Error
          >
        >,
        consumer: string,
      ): Result.Result<A & { readonly target: AssetPlacement.Target }, string> => {
        const selected = selections.get(ref.target?.scope ?? "location")
        if (selected === undefined || Result.isFailure(selected)) {
          report(
            new Composition.Diagnostic({
              severity: "error",
              code: "asset_source_unavailable",
              message:
                selected === undefined
                  ? `No captured source for ${ref.kind} ${ref.relativePath}`
                  : `Cannot read ${ref.kind} source: ${selected.failure.message}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          return Result.fail("asset_source_unavailable")
        }
        const mismatch = ref.target && selected.success.mismatches.get(ref.target.root)
        if (mismatch) {
          report(
            new Composition.Diagnostic({
              severity: "error",
              code: "asset_target_mismatch",
              message: mismatch.message,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          return Result.fail("asset_target_mismatch")
        }
        return readAsset(ref, selected.success.catalog, consumer, selected.success.target).pipe(
          Result.map((asset) => ({ ...asset, target: selected.success.target })),
        )
      }

      Object.entries(declaredBindings).forEach(([consumer, binding]) => {
        if (!allowedConsumers.has(consumer)) {
          report(
            new Composition.Diagnostic({
              severity: "error",
              code: "unknown_consumer_key",
              message: `Consumer '${consumer}' is not selected for this composition`,
            }),
          )
          const refs = [...binding.prompts, ...binding.skills, ...binding.commands]
          refs.forEach((ref) =>
            report(
              new Composition.Diagnostic({
                severity: "error",
                code: "unconnected_asset",
                message: `Asset ${ref.kind} ${ref.relativePath} is bound to unrecognized consumer '${consumer}'`,
                path: ref.relativePath,
                asset: ref,
              }),
            ),
          )
          return
        }
        const frozen = bindings[consumer]
        const consumerInstructions = [...frozen.instructions]
        const consumerPrompts = [...frozen.prompts]
        const consumerSkills = [...frozen.skills]
        const consumerCommands = [...frozen.commands]
        binding.prompts.forEach((ref) => {
          const found = readSelectedAsset(ref, sources.prompts, consumer)
          if (Result.isFailure(found)) return
          const prompt = new Composition.SnapshotPromptData({
            relativePath: found.success.relativePath,
            revision: Composition.Revision.make(found.success.revision),
            content: found.success.template,
            target: found.success.target,
          })
          prompts.set(CompositionReference.key("prompt", prompt.relativePath, prompt.target), {
            data: prompt,
            name: found.success.name,
          })
          consumerPrompts.push(prompt)
          if (prompt.content.trim())
            consumerInstructions.push(
              new Composition.Instruction({ source: `prompt:${found.success.name}`, content: prompt.content.trim() }),
            )
          if (found.success.template.trim())
            instructions.push(
              new Composition.Instruction({
                source: `prompt:${found.success.name}`,
                content: found.success.template.trim(),
              }),
            )
        })
        binding.skills.forEach((ref) => {
          const found = readSelectedAsset(ref, sources.skills, consumer)
          if (Result.isFailure(found)) return
          const skill = new Composition.SnapshotSkillData({
            name: found.success.name,
            description: found.success.description,
            relativePath: found.success.relativePath,
            revision: Composition.Revision.make(found.success.revision),
            content: found.success.content,
            target: found.success.target,
          })
          frozenSkills.set(CompositionReference.key("skill", skill.relativePath, skill.target), skill)
          consumerSkills.push(skill)
          skills.push(
            new Composition.SkillInfo({
              name: found.success.name,
              description: found.success.description,
              relativePath: found.success.relativePath,
              revision: Composition.Revision.make(found.success.revision),
              target: found.success.target,
            }),
          )
        })
        const selectedSkills = CompositionCatalog.frozenSkills(location.directory, consumerSkills)
        if (Result.isFailure(selectedSkills))
          report(
            new Composition.Diagnostic({
              severity: "blocking",
              code: selectedSkills.failure.code,
              message: `Consumer '${consumer}': ${selectedSkills.failure.message}`,
            }),
          )
        binding.commands.forEach((ref) => {
          const found = readSelectedAsset(ref, sources.commands, consumer)
          if (Result.isFailure(found)) return
          const command = new Composition.CommandInfo({
            name: found.success.name,
            description: found.success.description,
            relativePath: found.success.relativePath,
            revision: Composition.Revision.make(found.success.revision),
            invocation: found.success.invocation,
            target: found.success.target,
            ...(found.success.args === undefined ? {} : { args: found.success.args }),
            ...(found.success.source === undefined ? {} : { source: found.success.source }),
          })
          commands.set(CompositionReference.key("command", command.relativePath, command.target), command)
          consumerCommands.push(command)
        })
        bindings[consumer] = new Composition.SnapshotBindingData({
          instructions: consumerInstructions,
          prompts: consumerPrompts,
          skills: consumerSkills,
          commands: consumerCommands,
        })
      })

      const requested: Composition.McpRequestedInfo[] = []
      const effective: Composition.McpEffectiveInfo[] = []
      const denied: Composition.McpDeniedInfo[] = []
      const servers = new Set<string>()
      declaredMcp.forEach((binding) => {
        const ref = new Composition.McpRef({
          kind: "mcp",
          relativePath: binding.ref.relativePath,
          revision: binding.ref.revision,
        })
        const request = new Composition.McpRequestedInfo({
          serverName: binding.serverName,
          ref,
          ...(binding.credentialRef === undefined ? {} : { credentialRef: binding.credentialRef }),
        })
        requested.push(request)
        const deny = (
          reason: string,
          details: {
            readonly health?: Composition.McpConnectionHealth
            readonly credentialStatus?: Composition.McpCredentialStatus
          } = {},
        ) => {
          denied.push(
            new Composition.McpDeniedInfo({
              ...request,
              reason,
              ...(details.health === undefined ? {} : { health: details.health }),
              ...(details.credentialStatus === undefined ? {} : { credentialStatus: details.credentialStatus }),
            }),
          )
          report(
            new Composition.Diagnostic({
              severity: "error",
              code: `mcp_${reason}`,
              message: `MCP server '${binding.serverName}': ${reason}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
        }
        if (!SERVER_NAME_PATTERN.test(binding.serverName)) return deny("invalid_server_name")
        if (servers.has(binding.serverName)) return deny("duplicate_binding")
        servers.add(binding.serverName)
        const found = readAsset(ref, catalogs.mcp, binding.serverName)
        if (Result.isFailure(found)) {
          denied.push(new Composition.McpDeniedInfo({ ...request, reason: found.failure }))
          return
        }
        if (found.success.revision !== ref.revision) {
          denied.push(new Composition.McpDeniedInfo({ ...request, reason: "mcp_asset_stale_revision" }))
          return
        }
        const fact = facts.find((candidate) => {
          const normalized = Result.try(() => MCPAssetPath.validateRelativePath(candidate.ref.relativePath))
          return (
            candidate.serverName === binding.serverName &&
            Result.isSuccess(normalized) &&
            normalized.success === found.success.relativePath &&
            candidate.ref.revision === ref.revision &&
            candidate.transportFingerprint === McpConnection.transportFingerprint(binding) &&
            candidate.credentialRef === binding.credentialRef
          )
        })
        if (!fact) {
          const sameServer = facts.find((candidate) => candidate.serverName === binding.serverName)
          return deny(sameServer ? "binding_mismatch" : "not_connected", {
            health: sameServer?.health,
            credentialStatus: binding.credentialRef === undefined ? "not-required" : undefined,
          })
        }
        if (fact.health !== "ready")
          return deny("not_ready", {
            health: fact.health,
            credentialStatus: fact.credentialStatus,
          })
        effective.push(
          new Composition.McpEffectiveInfo({
            ...request,
            health: fact.health,
            credentialStatus: fact.credentialStatus,
            tools: fact.tools,
          }),
        )
      })
      const mcp = new Composition.McpPlan({ requested, effective, denied })
      const effectiveMcpTools = new Set(effective.flatMap((entry) => entry.tools))
      const snapshot = yield* tools.snapshot(
        undefined,
        (name) => !name.startsWith("mcp_") || effectiveMcpTools.has(name),
      )
      // This count is provider-facing: direct definitions plus CodeMode's entry.
      const effectiveToolCount = snapshot.definitions.length
      const frozenOrchestrator =
        orchestrator === undefined
          ? undefined
          : Agent.Info.make({
              ...orchestrator,
              system:
                orchestrator.id !== "meta" || orchestrator.system === undefined
                  ? orchestrator.system
                  : AgentPlugin.renderMetaSystem(
                      orchestrator.system,
                      executors.map((executor) => executor.info),
                      [
                        ...bindings.orchestrator.prompts.map((prompt) => ({
                          kind: "prompt",
                          name:
                            prompts.get(CompositionReference.key("prompt", prompt.relativePath, prompt.target))?.name ??
                            prompt.relativePath,
                        })),
                        ...bindings.orchestrator.skills.map((skill) => ({ kind: "skill", name: skill.name })),
                        ...bindings.orchestrator.commands.map((command) => ({ kind: "command", name: command.name })),
                      ],
                    ),
            })
      // Asset revisions identify file bytes; builtin revisions identify the rendered definition.
      const rootRevision =
        declaredRoot === undefined || frozenOrchestrator === undefined
          ? undefined
          : declaredRoot.source === "asset"
            ? rootAsset === undefined
              ? undefined
              : Composition.Revision.make(rootAsset.revision)
            : Composition.Revision.make(
                CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(frozenOrchestrator)),
              )
      if (
        declaredRoot?.source === "builtin" &&
        declaredRoot.revision !== undefined &&
        rootRevision !== undefined &&
        declaredRoot.revision !== rootRevision
      )
        report(
          new Composition.Diagnostic({
            severity: "error",
            code: "builtin_root_stale_revision",
            message: `Builtin root '${rootID}' revision mismatch: expected ${declaredRoot.revision}, found ${rootRevision}`,
          }),
          false,
        )
      const diagnostics = issues.map((issue) => issue.diagnostic)
      const valid = !diagnostics.some(
        (diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "blocking",
      )
      const resolvedRoot =
        declaredRoot === undefined || rootRevision === undefined
          ? undefined
          : declaredRoot.source === "builtin"
            ? new Composition.BuiltinRoot({ ...declaredRoot, revision: rootRevision })
            : rootAsset === undefined
              ? undefined
              : new Composition.AssetRoot({
                  ...declaredRoot,
                  relativePath: rootAsset.relativePath,
                  revision: rootRevision,
                })
      const normalizedInput =
        input.source === "temporary" &&
        resolvedRoot !== undefined &&
        valid &&
        declaredRoot?.source === "builtin" &&
        declaredRoot.revision === undefined
          ? new Composition.TemporaryInput({ ...input, root: resolvedRoot })
          : input
      const plan = new Composition.Plan({
        version:
          declaredRoot !== undefined ||
          agents.length > 1 ||
          workflowInfo !== undefined ||
          commands.size > 0 ||
          requested.length > 0
            ? 2
            : 1,
        digest: CompositionDigest.computeCompositionDigest(normalizedInput),
        valid,
        input: normalizedInput,
        ...(frozenOrchestrator === undefined ? {} : { orchestrator: frozenOrchestrator }),
        ...(agents[0] === undefined ? {} : { agent: agents[0] }),
        agents,
        ...(workflowInfo === undefined ? {} : { workflow: workflowInfo }),
        instructions,
        skills,
        commands: Array.from(commands.values()),
        capabilities: (source?.requestedCapabilities ?? []).map(
          (id) =>
            new Composition.CapabilityInfo({
              id,
              status: "unsupported",
              reason: `Capability '${id}' is a declaration only; V2 agent and Session permission rules decide access`,
            }),
        ),
        costPreview: new Composition.CostPreview({
          estimatedTokens: Math.max(
            100,
            instructions.reduce((total, instruction) => total + Math.ceil(instruction.content.length / 4), 0) +
              (workflowInfo?.steps.reduce(
                (total, step) => total + 500 + Math.ceil(JSON.stringify(step.input).length / 4),
                0,
              ) ?? 0),
          ),
          maxConcurrency: workflowInfo ? computeMaxConcurrency(workflowInfo.steps) : 1,
          effectiveToolCount,
          agentCount: agents.length,
        }),
        mcp,
        diagnostics,
      })
      return {
        plan,
        snapshot,
        bindings,
        executors,
        orchestrator: frozenOrchestrator,
        root: resolvedRoot,
        prompts: Array.from(prompts.values(), (prompt) => prompt.data),
        skills: Array.from(frozenSkills.values()),
        declaredMcp,
        staleRevisions: Array.from(stale.values()),
        broken: issues.some((issue) => issue.broken),
      }
    })

    return Service.of({
      resolve: Effect.fn("CompositionResolver.resolve")(function* (input) {
        return (yield* resolveInternal(input)).plan
      }),
      freeze: Effect.fn("CompositionResolver.freeze")(function* (input) {
        if (
          input.input.source === "temporary" &&
          input.input.root?.source === "builtin" &&
          input.input.root.revision === undefined
        )
          return yield* new Composition.ResolveError({
            code: "builtin_root_revision_required",
            message: "Preview the builtin root before adopting its definition",
          })
        const resolved = yield* resolveInternal(input.input)
        if (!resolved.plan.valid)
          return yield* new Composition.ResolveError({
            code: "invalid_composition_plan",
            message: "Cannot freeze an invalid composition plan",
            diagnostics: resolved.plan.diagnostics,
          })
        if (resolved.orchestrator === undefined)
          return yield* new Composition.ResolveError({
            code: "orchestrator_unavailable",
            message: "Custom composition requires a frozen root agent",
          })
        const tools = CompositionDigest.captureTools(
          resolved.snapshot.catalog,
          location.workspaceID ? `${location.directory}#${location.workspaceID}` : String(location.directory),
          app.version,
        )
        const audit = resolved.plan.mcp.effective.flatMap((entry) =>
          entry.tools.map(
            (canonicalName) =>
              new Composition.SnapshotMcpTool({ canonicalName, serverName: entry.serverName, ref: entry.ref }),
          ),
        )
        if (
          !Composition.mcpAuditMatchesCatalog({
            catalog: tools.catalog,
            auditToolNames: audit.map((tool) => tool.canonicalName),
          }).matches
        )
          return yield* new Composition.ResolveError({
            code: "mcp_catalog_mismatch",
            message: "Ready MCP connection facts do not match the captured tool catalog",
          })
        const rootModel = resolved.orchestrator.model
        const groupBehavior =
          rootModel !== undefined && Model.Selection.isGroup(rootModel)
            ? yield* groups
                .behavior(rootModel.groupID)
                .pipe(
                  Effect.mapError(
                    (error) => new Composition.ResolveError({ code: "root_group_unavailable", message: error.message }),
                  ),
                )
            : undefined
        const executors = yield* Effect.forEach(resolved.executors, (executor) => {
          const selected = executor.info.model
          if (selected === undefined || !Model.Selection.isGroup(selected)) return Effect.succeed(executor)
          return groups.behavior(selected.groupID).pipe(
            Effect.map((groupBehavior) => new Composition.SnapshotExecutorData({ ...executor, groupBehavior })),
            Effect.mapError(
              (error) => new Composition.ResolveError({ code: "executor_group_unavailable", message: error.message }),
            ),
          )
        })
        // New freezes use the complete scoped shape even for a single agent.
        // V1 remains a historical read contract and lacks executor configuration.
        const data = new Composition.SnapshotDataV2({
          sourceLocation: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          ...(resolved.root === undefined ? {} : { root: resolved.root }),
          agents: resolved.plan.agents ?? [],
          orchestrator: resolved.orchestrator,
          groupBehavior,
          executors,
          bindings: resolved.bindings,
          workflow: resolved.plan.workflow,
          maxConcurrency: resolved.plan.costPreview?.maxConcurrency ?? 1,
          commands: resolved.plan.commands,
          instructions: resolved.plan.instructions,
          prompts: resolved.prompts,
          skills: resolved.skills,
          tools,
          mcp: new Composition.SnapshotMcpInfo({
            bindings: resolved.plan.mcp.effective.map((entry) => {
              const binding = resolved.declaredMcp.find((candidate) => candidate.serverName === entry.serverName)
              return new Composition.SnapshotMcpBinding({
                serverName: entry.serverName,
                ref: entry.ref,
                ...(entry.credentialRef === undefined ? {} : { credentialRef: entry.credentialRef }),
                ...(binding === undefined ? {} : { transportFingerprint: McpConnection.transportFingerprint(binding) }),
              })
            }),
            tools: audit,
          }),
        })
        return new Composition.SnapshotV2({
          version: 2,
          digest: resolved.plan.digest,
          ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
          ...(input.input.source === "profile"
            ? { profilePath: input.input.profilePath, profileRevision: input.input.profileRevision }
            : {}),
          createdAt: (yield* DateTime.nowAsDate).getTime(),
          data: Schema.decodeUnknownSync(Composition.SnapshotDataV2)(
            structuredClone(Schema.encodeSync(Composition.SnapshotDataV2)(data)),
          ),
        })
      }),
      checkHealth: Effect.fn("CompositionResolver.checkHealth")(function* (profilePath) {
        const profile = yield* profiles.getByPath(profilePath)
        const resolved = yield* resolveInternal(
          new Composition.ProfileInput({
            source: "profile",
            profilePath: profile.relativePath,
            profileRevision: Composition.Revision.make(profile.revision),
          }),
          profile,
        )
        return new Composition.Health({
          status: resolved.broken ? "broken" : resolved.plan.diagnostics.length > 0 ? "degraded" : "healthy",
          diagnostics: resolved.plan.diagnostics,
          staleRevisions: resolved.staleRevisions,
        })
      }),
    } satisfies Interface)
  }),
)

function containsCredentialField(value: Schema.Json): boolean {
  if (value === null || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some(containsCredentialField)
  return Object.entries(value).some(
    ([name, entry]) =>
      /^(?:authorization|proxy-authorization|cookie|set-cookie)$/i.test(name) ||
      // Probe the shared credential patterns with a fixed value so short or
      // empty credentials cannot evade the text scanner's length thresholds.
      CredentialScan.containsSecret(`${name.toUpperCase()}=00000000000000000000`) ||
      containsCredentialField(entry),
  )
}

function makeConsumerKey(name: string, relativePath: string) {
  const trimmed = name.trim()
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return `agents/${trimmed}`
  const sanitized = path.posix
    .basename(relativePath, ".md")
    .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
  if (sanitized) return `agents/${sanitized}`
  return `agents/${Hash.sha256(`${relativePath}:${name}`).slice(0, 12)}`
}

export const locationLayer = layer
export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    CustomProfile.node,
    Agent.node,
    AgentAsset.node,
    PromptAsset.node,
    SkillAsset.node,
    WorkflowAsset.node,
    CommandAsset.node,
    MCPAsset.node,
    McpConnection.node,
    Tool.node,
    Location.node,
    App.node,
    ModelGroup.node,
  ],
})

export * as CompositionResolver from "./composition-resolver"
