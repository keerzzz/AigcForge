export * as CompositionResolver from "./composition-resolver"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { computeMaxConcurrency, validateGraph } from "@aigcfroge/schema/workflow-asset"
import { CustomProfile } from "./custom-profile"
import { AgentAsset } from "./agent-asset"
import { PromptAsset } from "./prompt-asset"
import { SkillAsset } from "./skill-asset"
import { WorkflowAsset } from "./workflow-asset"
import { CommandAsset } from "./command-asset"
import { MCPAsset } from "./mcp-asset"
import { McpConnection } from "./mcp/connection"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import path from "path"
import { computeCompositionDigest, computeDigest } from "./composition/digest"
import { Location } from "./location"
import { ToolRegistry } from "./tool/registry"
import { InstallationVersion } from "./installation/version"

const SUPPORTED_CAPABILITIES = new Set(["workspace.read", "workspace.write", "terminal.exec", "browser.navigate"])

function makeConsumerKey(name: string, relativePath: string): string {
  const trimmed = name.trim()
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return `agents/${trimmed}`
  const base = path.basename(relativePath, path.extname(relativePath))
  const sanitized = base.replaceAll(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "")
  if (sanitized.length > 0 && /^[a-zA-Z0-9_-]+$/.test(sanitized)) return `agents/${sanitized}`
  // deterministic fallback: hex of relativePath+name
  const fallback = Buffer.from(`${relativePath}:${name}`).toString("hex").slice(0, 12)
  return `agents/${fallback}`
}

export interface Interface {
  readonly resolve: (input: Composition.CompositionInput) => Effect.Effect<Composition.Plan>
  readonly checkHealth: (profile: SchemaCustomProfile.Profile) => Effect.Effect<Composition.Health>
  readonly findReferencingProfiles: (
    kind: string,
    relativePath: string,
  ) => Effect.Effect<ReadonlyArray<SchemaCustomProfile.Summary>>
  readonly freeze: (input: Composition.FreezeInput) => Effect.Effect<Composition.Snapshot, Composition.ResolveError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CompositionResolver") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const customProfiles = yield* CustomProfile.Service
    const agentAssets = yield* AgentAsset.Service
    const promptAssets = yield* PromptAsset.Service
    const skillAssets = yield* SkillAsset.Service
    const workflowAssets = yield* WorkflowAsset.Service
    const commandAssets = yield* CommandAsset.Service
    const mcpAssets = yield* MCPAsset.Service
    const mcpConnections = yield* McpConnection.Service
    const location = yield* Location.Service
    const tools = yield* ToolRegistry.Service

    const resolveInternal = Effect.fn("CompositionResolver.resolveInternal")(function* (
      input: Composition.CompositionInput,
    ) {
      const digest = computeCompositionDigest(input)
      const diagnostics: Composition.Diagnostic[] = []
      const instructions: Composition.Instruction[] = []
      const skills: Composition.SkillInfo[] = []
      const commands: Composition.CommandInfo[] = []
      const capabilities: Composition.CapabilityInfo[] = []
      const perConsumerInstructions = new Map<string, Composition.Instruction[]>()
      const perConsumerPrompts = new Map<string, Composition.SnapshotPromptData[]>()
      const perConsumerSkills = new Map<string, Composition.SkillInfo[]>()
      const perConsumerCommands = new Map<string, Composition.CommandInfo[]>()
      const promptData = new Map<string, Composition.SnapshotPromptData>()
      const ensureConsumer = (key: string) => {
        if (!perConsumerInstructions.has(key)) perConsumerInstructions.set(key, [])
        if (!perConsumerPrompts.has(key)) perConsumerPrompts.set(key, [])
        if (!perConsumerSkills.has(key)) perConsumerSkills.set(key, [])
        if (!perConsumerCommands.has(key)) perConsumerCommands.set(key, [])
      }

      let resolvedAgents: readonly Composition.AgentRef[] = []
      let resolvedWorkflow: Composition.WorkflowRef | undefined
      let resolvedBindings: Record<string, Composition.Binding> = {}
      let resolvedMcpBindings: readonly McpScope.McpServerBinding[] = []
      let resolvedCapabilities: readonly string[] = []

      // 0. Profile source validation
      if (input.source === "profile") {
        const profileOpt = yield* customProfiles.getByPath(input.profilePath).pipe(Effect.option)
        if (Option.isNone(profileOpt)) {
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "profile_not_found",
              message: `Custom profile not found: ${input.profilePath}`,
              path: input.profilePath,
            }),
          )
        } else {
          const p = profileOpt.value
          if (p.revision !== input.profileRevision) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "profile_stale_revision",
                message: `Profile revision mismatch: expected ${input.profileRevision}, found ${p.revision}`,
                path: input.profilePath,
              }),
            )
          }
          resolvedAgents = p.profile.agents
          resolvedWorkflow = p.profile.workflow
          resolvedBindings = p.profile.bindings as Record<string, Composition.Binding>
          resolvedMcpBindings = p.profile.mcpBindings
          resolvedCapabilities = p.profile.requestedCapabilities
        }
      } else {
        resolvedAgents = input.agents
        resolvedWorkflow = input.workflow
        resolvedBindings = input.bindings as Record<string, Composition.Binding>
        resolvedCapabilities = input.requestedCapabilities
      }

      // 0.5 Duplicate declared assets fail closed
      const seenAssetKeys = new Set<string>()
      const declaredAssets = [
        ...resolvedAgents.map((ref) => ({ key: `${ref.kind}:${ref.relativePath}`, ref })),
        ...(resolvedWorkflow
          ? [{ key: `${resolvedWorkflow.kind}:${resolvedWorkflow.relativePath}`, ref: resolvedWorkflow }]
          : []),
        ...Object.entries(resolvedBindings).flatMap(([consumer, binding]) =>
          [...binding.prompts, ...binding.skills, ...binding.commands].map((ref) => ({
            key: `${consumer}:${ref.kind}:${ref.relativePath}`,
            ref,
          })),
        ),
      ]
      for (const declared of declaredAssets) {
        const ref = declared.ref
        const key = declared.key
        if (seenAssetKeys.has(key)) {
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "duplicate_asset",
              message: `Asset is listed more than once in the composition: ${ref.kind} ${ref.relativePath}`,
              path: ref.relativePath,
              asset: ref,
            }),
          )
          continue
        }
        seenAssetKeys.add(key)
      }

      // 1. Cardinality check (1..16 agents supported in M2)
      const resolvedAgentInfos: Composition.AgentInfo[] = []
      // Agents whose asset body is non-empty, i.e. those that must contribute an `agent:<name>`
      // instruction to their own consumer binding. Recorded during resolution because the live
      // asset is only in scope there.
      const agentsWithBody = new Set<string>()
      if (resolvedAgents.length < 1) {
        diagnostics.push(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "invalid_agent_cardinality",
            message: `Composition must contain at least 1 agent (got ${resolvedAgents.length})`,
          }),
        )
      } else if (resolvedAgents.length > 16) {
        diagnostics.push(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "invalid_agent_cardinality",
            message: `Composition cannot contain more than 16 agents (got ${resolvedAgents.length})`,
          }),
        )
      } else {
        for (const agentRef of resolvedAgents) {
          if ((agentRef as { kind?: string }).kind !== "agent") {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "blocking",
                code: "invalid_ref_kind",
                message: `Expected agent asset ref but got kind '${String((agentRef as { kind?: string }).kind)}'`,
                path: agentRef.relativePath,
                asset: agentRef,
              }),
            )
            continue
          }

          const agentAssetOpt = yield* agentAssets.getByPath(agentRef.relativePath).pipe(Effect.option)
          if (Option.isNone(agentAssetOpt)) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "blocking",
                code: "agent_not_found",
                message: `Agent asset not found: ${agentRef.relativePath}`,
                path: agentRef.relativePath,
                asset: agentRef,
              }),
            )
            continue
          }

          const a = agentAssetOpt.value
          if (a.name === "meta") {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "blocking",
                code: "root_agent_forbidden",
                message: "Root meta agent cannot be bound in custom composition",
                path: agentRef.relativePath,
                asset: agentRef,
              }),
            )
          } else if (a.revision !== agentRef.revision) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "agent_stale_revision",
                message: `Agent revision mismatch: expected ${agentRef.revision}, found ${a.revision}`,
                path: agentRef.relativePath,
                asset: agentRef,
              }),
            )
          }

          const consumerKey = makeConsumerKey(a.name, a.relativePath)
          const agentInfo = new Composition.AgentInfo({
            id: a.name,
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: Schema.decodeUnknownSync(Composition.Revision)(a.revision),
            consumerKey,
          })
          resolvedAgentInfos.push(agentInfo)

          ensureConsumer(consumerKey)
          if (a.source && a.source.trim()) {
            agentsWithBody.add(a.name)
            const instr = new Composition.Instruction({
              source: `agent:${a.name}`,
              content: a.source.trim(),
            })
            instructions.push(instr)
            perConsumerInstructions.get(consumerKey)!.push(instr)
          }
        }
      }

      // 2. Workflow resolution
      let workflowInfo: Composition.WorkflowInfo | undefined
      if (resolvedWorkflow) {
        if ((resolvedWorkflow as { kind?: string }).kind !== "workflow") {
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "blocking",
              code: "invalid_ref_kind",
              message: `Expected workflow asset ref but got kind '${String((resolvedWorkflow as { kind?: string }).kind)}'`,
              path: resolvedWorkflow.relativePath,
              asset: resolvedWorkflow,
            }),
          )
        } else {
          const workflowAssetOpt = yield* workflowAssets.getByPath(resolvedWorkflow.relativePath).pipe(Effect.option)
          if (Option.isNone(workflowAssetOpt)) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "blocking",
                code: "workflow_not_found",
                message: `Workflow asset not found: ${resolvedWorkflow.relativePath}`,
                path: resolvedWorkflow.relativePath,
                asset: resolvedWorkflow,
              }),
            )
          } else {
            const w = workflowAssetOpt.value
            if (w.revision !== resolvedWorkflow.revision) {
              diagnostics.push(
                new Composition.Diagnostic({
                  severity: "error",
                  code: "workflow_stale_revision",
                  message: `Workflow revision mismatch: expected ${resolvedWorkflow.revision}, found ${w.revision}`,
                  path: resolvedWorkflow.relativePath,
                  asset: resolvedWorkflow,
                }),
              )
            }

            const rawSteps = w.steps
            const graphValidation = validateGraph(rawSteps)
            if (!graphValidation.valid) {
              const errorMessage = graphValidation.errors.map((e) => e.message).join("; ")
              diagnostics.push(
                new Composition.Diagnostic({
                  severity: "blocking",
                  code: "invalid_workflow_graph",
                  message: `Invalid workflow graph: ${errorMessage}`,
                  path: resolvedWorkflow.relativePath,
                  asset: resolvedWorkflow,
                }),
              )
            }

            // `meta` is the root orchestrator, never a delegation target: it is
            // kept out of the Snapshot pool by `root_agent_forbidden`, so accepting
            // it here would let a plan freeze as valid and only fail at dispatch.
            // An empty agent is equally unroutable.
            const knownAgents = new Set([
              ...resolvedAgentInfos.map((a) => a.name),
              ...resolvedAgentInfos.map((a) => a.id),
            ])
            for (const step of rawSteps) {
              if (!knownAgents.has(step.agent)) {
                diagnostics.push(
                  new Composition.Diagnostic({
                    severity: "blocking",
                    code: "workflow_unknown_agent",
                    message: `Workflow step '${step.id}' references unknown agent '${step.agent}'`,
                    path: resolvedWorkflow.relativePath,
                    asset: resolvedWorkflow,
                  }),
                )
              }
            }

            workflowInfo = new Composition.WorkflowInfo({
              name: w.name,
              description: w.description,
              relativePath: w.relativePath,
              revision: Schema.decodeUnknownSync(Composition.Revision)(w.revision),
              steps: rawSteps,
            })
          }
        }
      }

      // 3. Bindings & Consumer keys validation
      const allowedConsumerKeys = new Set<string>(["orchestrator"])
      for (const a of resolvedAgentInfos) {
        if (a.consumerKey) allowedConsumerKeys.add(a.consumerKey)
        else allowedConsumerKeys.add(`agents/${a.name}`)
      }
      // ensure per-consumer maps have entry for each allowed key (even if empty)
      for (const key of allowedConsumerKeys) ensureConsumer(key)

      if (resolvedBindings) {
        for (const [consumerKey, binding] of Object.entries(resolvedBindings)) {
          if (allowedConsumerKeys.has(consumerKey)) continue
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "error",
              code: "unknown_consumer_key",
              message: `Consumer key '${consumerKey}' is unrecognized for composition`,
            }),
          )
          for (const ref of [...binding.prompts, ...binding.skills, ...binding.commands]) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "unconnected_asset",
                message: `Asset ${ref.kind} ${ref.relativePath} is bound to unrecognized consumer '${consumerKey}' and stays unconnected`,
                path: ref.relativePath,
                asset: ref,
              }),
            )
          }
        }
      }

      for (const [consumer, binding] of Object.entries(resolvedBindings)) {
        if (!allowedConsumerKeys.has(consumer)) continue
        ensureConsumer(consumer)
        // Prompts in binding
        for (const promptRef of binding.prompts) {
          if ((promptRef as { kind?: string }).kind !== "prompt") {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "invalid_ref_kind",
                message: `Expected prompt asset ref but got kind '${String((promptRef as { kind?: string }).kind)}'`,
                path: promptRef.relativePath,
                asset: promptRef,
              }),
            )
            continue
          }
          const pOpt = yield* promptAssets.getByPath(promptRef.relativePath).pipe(Effect.option)
          if (Option.isNone(pOpt)) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "prompt_not_found",
                message: `Prompt asset not found: ${promptRef.relativePath}`,
                path: promptRef.relativePath,
                asset: promptRef,
              }),
            )
          } else {
            const p = pOpt.value
            if (p.revision !== promptRef.revision) {
              diagnostics.push(
                new Composition.Diagnostic({
                  severity: "error",
                  code: "prompt_stale_revision",
                  message: `Prompt revision mismatch: expected ${promptRef.revision}, found ${p.revision}`,
                  path: promptRef.relativePath,
                  asset: promptRef,
                }),
              )
            }
            const snapshotPrompt = new Composition.SnapshotPromptData({
              relativePath: p.relativePath,
              revision: promptRef.revision,
              content: p.template ?? "",
            })
            perConsumerPrompts.get(consumer)!.push(snapshotPrompt)
            promptData.set(`${p.relativePath}:${String(promptRef.revision)}`, snapshotPrompt)
            if (p.template && p.template.trim()) {
              const instr = new Composition.Instruction({
                source: `prompt:${p.name}`,
                content: p.template.trim(),
              })
              instructions.push(instr)
              perConsumerInstructions.get(consumer)!.push(instr)
            }
          }
        }

        // Skills in binding
        for (const skillRef of binding.skills) {
          if ((skillRef as { kind?: string }).kind !== "skill") {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "invalid_ref_kind",
                message: `Expected skill asset ref but got kind '${String((skillRef as { kind?: string }).kind)}'`,
                path: skillRef.relativePath,
                asset: skillRef,
              }),
            )
            continue
          }
          const sOpt = yield* skillAssets.getByPath(skillRef.relativePath).pipe(Effect.option)
          if (Option.isNone(sOpt)) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "skill_not_found",
                message: `Skill asset not found: ${skillRef.relativePath}`,
                path: skillRef.relativePath,
                asset: skillRef,
              }),
            )
          } else {
            const s = sOpt.value
            if (s.revision !== skillRef.revision) {
              diagnostics.push(
                new Composition.Diagnostic({
                  severity: "error",
                  code: "skill_stale_revision",
                  message: `Skill revision mismatch: expected ${skillRef.revision}, found ${s.revision}`,
                  path: skillRef.relativePath,
                  asset: skillRef,
                }),
              )
            }
            const skillInfo = new Composition.SkillInfo({
              name: s.name,
              description: s.description,
              relativePath: s.relativePath,
              revision: Schema.decodeUnknownSync(Composition.Revision)(s.revision),
            })
            skills.push(skillInfo)
            perConsumerSkills.get(consumer)!.push(skillInfo)
          }
        }

        for (const commandRef of binding.commands) {
          if ((commandRef as { kind?: string }).kind !== "command") {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "invalid_ref_kind",
                message: `Expected command asset ref but got kind '${String((commandRef as { kind?: string }).kind)}'`,
                path: commandRef.relativePath,
                asset: commandRef,
              }),
            )
            continue
          }
          const commandOpt = yield* commandAssets.getByPath(commandRef.relativePath).pipe(Effect.option)
          if (Option.isNone(commandOpt)) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "command_not_found",
                message: `Command asset not found: ${commandRef.relativePath}`,
                path: commandRef.relativePath,
                asset: commandRef,
              }),
            )
            continue
          }
          const command = commandOpt.value
          if (command.revision !== commandRef.revision) {
            diagnostics.push(
              new Composition.Diagnostic({
                severity: "error",
                code: "command_stale_revision",
                message: `Command revision mismatch: expected ${commandRef.revision}, found ${command.revision}`,
                path: commandRef.relativePath,
                asset: commandRef,
              }),
            )
          }
          const alreadyGlobal = commands.some((item) => item.relativePath === command.relativePath)
          const cmdInfo = new Composition.CommandInfo({
            name: command.name,
            description: command.description,
            relativePath: command.relativePath,
            revision: Schema.decodeUnknownSync(Composition.Revision)(command.revision),
            invocation: command.invocation,
            args: command.args,
            source: command.source,
          })
          if (!alreadyGlobal) commands.push(cmdInfo)
          if (!perConsumerCommands.get(consumer)!.some((c) => c.relativePath === cmdInfo.relativePath)) {
            perConsumerCommands.get(consumer)!.push(cmdInfo)
          }
        }
      }

      const mcpRequested: Composition.McpRequestedInfo[] = []
      const mcpEffective: Composition.McpEffectiveInfo[] = []
      const mcpDenied: Composition.McpDeniedInfo[] = []
      const mcpFacts = yield* mcpConnections.facts()
      for (const binding of resolvedMcpBindings) {
        const ref = new Composition.McpRef({ kind: "mcp", ...binding.ref })
        mcpRequested.push(
          new Composition.McpRequestedInfo({
            serverName: binding.serverName,
            ref,
            credentialRef: binding.credentialRef,
          }),
        )
        const asset = Option.getOrUndefined(yield* mcpAssets.getByPath(binding.ref.relativePath).pipe(Effect.option))
        if (asset === undefined) {
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "error",
              code: "mcp_asset_not_found",
              message: `MCP asset not found: ${binding.ref.relativePath}`,
              path: binding.ref.relativePath,
              asset: ref,
            }),
          )
          mcpDenied.push(
            new Composition.McpDeniedInfo({
              serverName: binding.serverName,
              ref,
              credentialRef: binding.credentialRef,
              reason: "mcp_asset_not_found",
            }),
          )
          continue
        }
        if (asset.revision !== binding.ref.revision) {
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "error",
              code: "mcp_asset_stale_revision",
              message: `MCP asset revision mismatch: expected ${binding.ref.revision}, found ${asset.revision}`,
              path: binding.ref.relativePath,
              asset: ref,
            }),
          )
          mcpDenied.push(
            new Composition.McpDeniedInfo({
              serverName: binding.serverName,
              ref,
              credentialRef: binding.credentialRef,
              reason: "mcp_asset_stale_revision",
            }),
          )
          continue
        }
        const fact = mcpFacts.find(
          (candidate) =>
            candidate.serverName === binding.serverName &&
            candidate.ref.relativePath === binding.ref.relativePath &&
            candidate.ref.revision === binding.ref.revision &&
            candidate.credentialRef === binding.credentialRef,
        )
        if (fact === undefined) {
          const sameServer = mcpFacts.find((candidate) => candidate.serverName === binding.serverName)
          const reason = sameServer === undefined ? "not_connected" : "binding_mismatch"
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "error",
              code: `mcp_${reason}`,
              message: `MCP server '${binding.serverName}' is ${reason.replaceAll("_", " ")}`,
              path: binding.ref.relativePath,
              asset: ref,
            }),
          )
          mcpDenied.push(
            new Composition.McpDeniedInfo({
              serverName: binding.serverName,
              ref,
              credentialRef: binding.credentialRef,
              reason,
              health: sameServer?.health,
              credentialStatus: binding.credentialRef === undefined ? "not-required" : undefined,
            }),
          )
          continue
        }
        if (fact.health !== "ready") {
          const credentialStatus =
            fact.health === "revoked"
              ? "revoked"
              : fact.health === "auth-required"
                ? "missing"
                : binding.credentialRef === undefined
                  ? "not-required"
                  : "available"
          diagnostics.push(
            new Composition.Diagnostic({
              severity: "error",
              code: "mcp_not_ready",
              message: `MCP server '${binding.serverName}' is ${fact.health}`,
              path: binding.ref.relativePath,
              asset: ref,
            }),
          )
          mcpDenied.push(
            new Composition.McpDeniedInfo({
              serverName: binding.serverName,
              ref,
              credentialRef: binding.credentialRef,
              reason: "not_ready",
              health: fact.health,
              credentialStatus,
            }),
          )
          continue
        }
        mcpEffective.push(
          new Composition.McpEffectiveInfo({
            serverName: binding.serverName,
            ref,
            credentialRef: binding.credentialRef,
            credentialStatus: binding.credentialRef === undefined ? "not-required" : "available",
            health: fact.health,
            tools: fact.tools,
          }),
        )
      }
      const mcp = new Composition.McpPlan({ requested: mcpRequested, effective: mcpEffective, denied: mcpDenied })

      // 4. Capabilities evaluation
      for (const cap of resolvedCapabilities) {
        if (SUPPORTED_CAPABILITIES.has(cap)) {
          capabilities.push(
            new Composition.CapabilityInfo({
              id: cap,
              status: "denied",
              reason: "Requested capabilities do not grant permission; effective policy is evaluated by the M1 runtime",
            }),
          )
        } else {
          capabilities.push(
            new Composition.CapabilityInfo({
              id: cap,
              status: "unsupported",
              reason: `Capability '${cap}' is not supported in M1`,
            }),
          )
        }
      }

      // 5. Cost preview calculation
      const materialized = yield* tools.materialize()
      const effectiveMcpTools = new Set(mcp.effective.flatMap((entry) => entry.tools))
      const definitions = materialized.definitions.filter(
        (definition) => !definition.name.startsWith("mcp_") || effectiveMcpTools.has(definition.name),
      )
      let estimatedTokens = instructions.reduce((sum, i) => sum + Math.ceil(i.content.length / 4), 0)
      if (workflowInfo) {
        for (const step of workflowInfo.steps) {
          const inputLen = JSON.stringify(step.input).length
          estimatedTokens += 500 + Math.ceil(inputLen / 4)
        }
      }
      estimatedTokens = Math.max(100, estimatedTokens)

      const maxConcurrency = workflowInfo ? computeMaxConcurrency(workflowInfo.steps) : 1
      const effectiveToolCount = definitions.length
      const costPreview = new Composition.CostPreview({
        estimatedTokens,
        maxConcurrency,
        effectiveToolCount,
        agentCount: resolvedAgentInfos.length,
      })

      const hasBlockingOrError = diagnostics.some((d) => d.severity === "blocking" || d.severity === "error")
      const valid = !hasBlockingOrError

      const isV2 = resolvedAgentInfos.length > 1 || workflowInfo !== undefined || commands.length > 0
      const planVersion = isV2 ? 2 : 1

      const plan = new Composition.Plan({
        version: planVersion,
        digest,
        valid,
        input,
        agent: resolvedAgentInfos[0],
        agents: resolvedAgentInfos,
        workflow: workflowInfo,
        commands,
        instructions,
        skills,
        capabilities,
        costPreview,
        mcp,
        diagnostics,
      })

      // Build per-consumer snapshot bindings from the already-read assets (no second live read).
      //
      // Every addressable consumer gets an entry, even when it binds nothing: the orchestrator and
      // one per frozen agent. "Present but empty" and "absent" must stay distinguishable, because
      // the runtime fails closed on absent — emitting entries only when they have content would
      // make a legitimate composition (everything bound to child agents, nothing to the
      // orchestrator) unrunnable at its root.
      const snapshotBindings: Record<string, Composition.SnapshotBindingData> = {}
      const addressableConsumers = new Set<string>([
        "orchestrator",
        ...resolvedAgentInfos.map((a) => a.consumerKey ?? `agents/${a.name}`),
        ...Object.keys(resolvedBindings),
        ...perConsumerInstructions.keys(),
      ])
      for (const key of addressableConsumers) {
        snapshotBindings[key] = new Composition.SnapshotBindingData({
          instructions: perConsumerInstructions.get(key) ?? [],
          prompts: perConsumerPrompts.get(key) ?? [],
          skills: perConsumerSkills.get(key) ?? [],
          commands: perConsumerCommands.get(key) ?? [],
        })
      }

      // Freeze-time completeness: an agent with a non-empty asset body must have its system prompt
      // in its own consumer's binding. assertDependency cannot check this later — from the snapshot
      // alone, "the prompt was dropped" and "this agent has no body" are indistinguishable. Here
      // both the live asset and the binding are in hand, so a drop is a defect, not a data shape.
      for (const info of resolvedAgentInfos) {
        if (!agentsWithBody.has(info.name)) continue
        const key = info.consumerKey ?? `agents/${info.name}`
        const landed = snapshotBindings[key]?.instructions.some((i) => i.source === `agent:${info.name}`)
        if (!landed) {
          return yield* Effect.die(
            `Composition freeze dropped the system prompt for agent '${info.name}' (consumer '${key}')`,
          )
        }
      }

      return { plan, snapshotBindings, promptData }
    })

    const resolve = Effect.fn("CompositionResolver.resolve")(function* (input: Composition.CompositionInput) {
      const { plan } = yield* resolveInternal(input)
      return plan
    })

    const checkHealth = Effect.fn("CompositionResolver.checkHealth")(function* (profile: SchemaCustomProfile.Profile) {
      const input = new Composition.TemporaryInput({
        source: "temporary",
        agents: profile.agents,
        workflow: profile.workflow,
        bindings: profile.bindings,
        presentation: profile.presentation,
        requestedCapabilities: profile.requestedCapabilities,
      })

      const plan = yield* resolve(input)
      const staleRevisions: Composition.StaleRevision[] = []

      for (const d of plan.diagnostics) {
        if (d.asset && (d.code.includes("stale") || d.code.includes("revision"))) {
          let currentRev: string | undefined
          if (d.asset.kind === "agent") {
            const a = yield* agentAssets.getByPath(d.asset.relativePath).pipe(Effect.option)
            currentRev = Option.getOrUndefined(a)?.revision
          } else if (d.asset.kind === "prompt") {
            const p = yield* promptAssets.getByPath(d.asset.relativePath).pipe(Effect.option)
            currentRev = Option.getOrUndefined(p)?.revision
          } else if (d.asset.kind === "skill") {
            const s = yield* skillAssets.getByPath(d.asset.relativePath).pipe(Effect.option)
            currentRev = Option.getOrUndefined(s)?.revision
          } else if (d.asset.kind === "workflow") {
            const w = yield* workflowAssets.getByPath(d.asset.relativePath).pipe(Effect.option)
            currentRev = Option.getOrUndefined(w)?.revision
          } else if (d.asset.kind === "command") {
            const command = yield* commandAssets.getByPath(d.asset.relativePath).pipe(Effect.option)
            currentRev = Option.getOrUndefined(command)?.revision
          }
          if (currentRev) {
            staleRevisions.push(
              new Composition.StaleRevision({
                kind: d.asset.kind,
                relativePath: d.asset.relativePath,
                expectedRevision: d.asset.revision,
                currentRevision: Schema.decodeUnknownSync(Composition.Revision)(currentRev),
              }),
            )
          }
        }
      }

      let status: Composition.HealthStatus = "healthy"
      if (plan.diagnostics.some((d) => d.severity === "blocking" || d.code.includes("not_found"))) {
        status = "broken"
      } else if (staleRevisions.length > 0 || plan.diagnostics.length > 0) {
        status = "degraded"
      }

      return new Composition.Health({
        status,
        diagnostics: plan.diagnostics,
        staleRevisions,
      })
    })

    const findReferencingProfiles = Effect.fn("CompositionResolver.findReferencingProfiles")(function* (
      kind: string,
      relativePath: string,
    ) {
      const allProfiles = yield* customProfiles.list()
      const matching: SchemaCustomProfile.Summary[] = []

      for (const p of allProfiles) {
        let matched = false
        // Check agents in profile
        for (const agentRef of p.profile.agents) {
          if (agentRef.kind === kind && agentRef.relativePath === relativePath) {
            matched = true
            break
          }
        }
        if (
          !matched &&
          p.profile.mcpBindings.some((binding) => binding.ref.relativePath === relativePath && kind === "mcp")
        ) {
          matched = true
        }
        if (!matched && p.profile.workflow) {
          if (p.profile.workflow.kind === kind && p.profile.workflow.relativePath === relativePath) {
            matched = true
          }
        }
        if (!matched) {
          // Check bindings
          for (const binding of Object.values(p.profile.bindings)) {
            for (const promptRef of binding.prompts) {
              if (promptRef.kind === kind && promptRef.relativePath === relativePath) {
                matched = true
                break
              }
            }
            if (matched) break
            for (const skillRef of binding.skills) {
              if (skillRef.kind === kind && skillRef.relativePath === relativePath) {
                matched = true
                break
              }
            }
            if (matched) break
            for (const commandRef of binding.commands) {
              if (commandRef.kind === kind && commandRef.relativePath === relativePath) {
                matched = true
                break
              }
            }
            if (matched) break
          }
        }

        if (matched) {
          matching.push(
            Schema.decodeUnknownSync(SchemaCustomProfile.Summary)({
              kind: "custom-profile",
              name: p.name,
              description: p.description,
              relativePath: p.relativePath,
              revision: p.revision,
            }),
          )
        }
      }

      return matching
    })

    const freeze: Interface["freeze"] = Effect.fn("CompositionResolver.freeze")(function* (input) {
      const { plan, snapshotBindings, promptData } = yield* resolveInternal(input.input)
      if (!plan.valid) {
        return yield* new Composition.ResolveError({
          code: "invalid_composition_plan",
          message: "Cannot freeze an invalid composition plan",
          diagnostics: plan.diagnostics,
        })
      }

      const materialized = yield* tools.materialize()
      const effectiveMcpTools = new Set(plan.mcp.effective.flatMap((entry) => entry.tools))
      const fingerprints = materialized.definitions
        .filter((definition) => !definition.name.startsWith("mcp_") || effectiveMcpTools.has(definition.name))
        .map((definition) => ({
          placement: location.workspaceID
            ? `${location.directory}#${location.workspaceID}`
            : String(location.directory),
          name: definition.name,
          digest: computeDigest({
            description: definition.description,
            inputSchema: definition.inputSchema,
            outputSchema: definition.outputSchema,
          }),
          installationVersion: InstallationVersion,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name))
      const toolNames = fingerprints.map((fingerprint) => fingerprint.name)
      const catalogDigest = computeDigest(fingerprints)

      const isV2 =
        plan.version === 2 ||
        (plan.agents && plan.agents.length > 1) ||
        plan.workflow != null ||
        plan.mcp.requested.length > 0

      if (isV2) {
        const snapshotData = new Composition.SnapshotDataV2({
          agents: plan.agents ?? (plan.agent ? [plan.agent] : []),
          workflow: plan.workflow,
          bindings: snapshotBindings,
          maxConcurrency: plan.costPreview?.maxConcurrency ?? 1,
          commands: plan.commands ?? [],
          instructions: plan.instructions,
          prompts: Array.from(promptData.values()),
          skills: plan.skills,
          tools: new Composition.SnapshotToolInfo({
            fingerprints,
            catalogDigest,
            catalog: toolNames,
          }),
          mcp: new Composition.SnapshotMcpInfo({
            bindings: plan.mcp.effective.map(
              (entry) =>
                new Composition.SnapshotMcpBinding({
                  serverName: entry.serverName,
                  ref: entry.ref,
                  credentialRef: entry.credentialRef,
                }),
            ),
            tools: plan.mcp.effective.flatMap((entry) =>
              entry.tools.map(
                (canonicalName) =>
                  new Composition.SnapshotMcpTool({
                    canonicalName,
                    serverName: entry.serverName,
                    ref: entry.ref,
                  }),
              ),
            ),
          }),
        })

        return new Composition.SnapshotV2({
          version: 2,
          digest: plan.digest,
          sessionID: input.sessionID,
          profilePath: plan.input.source === "profile" ? plan.input.profilePath : undefined,
          profileRevision: plan.input.source === "profile" ? plan.input.profileRevision : undefined,
          createdAt: Date.now(),
          data: snapshotData,
        })
      }

      const snapshotData = new Composition.SnapshotDataV1({
        agentID: plan.agent?.id ?? "default",
        instructions: plan.instructions,
        prompts: Array.from(promptData.values()),
        skills: plan.skills,
        tools: new Composition.SnapshotToolInfo({
          fingerprints,
          catalogDigest,
          catalog: toolNames,
        }),
      })

      return new Composition.SnapshotV1({
        version: 1,
        digest: plan.digest,
        sessionID: input.sessionID,
        profilePath: plan.input.source === "profile" ? plan.input.profilePath : undefined,
        profileRevision: plan.input.source === "profile" ? plan.input.profileRevision : undefined,
        createdAt: Date.now(),
        data: snapshotData,
      })
    })

    return Service.of({
      resolve,
      checkHealth,
      findReferencingProfiles,
      freeze,
    } satisfies Interface)
  }),
)

export const locationLayer = layer
