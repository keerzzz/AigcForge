export * as CompositionResolver from "./composition-resolver"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { CustomProfile } from "./custom-profile"
import { AgentAsset } from "./agent-asset"
import { PromptAsset } from "./prompt-asset"
import { SkillAsset } from "./skill-asset"
import { computeCompositionDigest, computeDigest } from "./composition/digest"
import { Location } from "./location"
import { ToolRegistry } from "./tool/registry"
import { InstallationVersion } from "./installation/version"

const SUPPORTED_CAPABILITIES = new Set(["workspace.read", "workspace.write", "terminal.exec", "browser.navigate"])

export interface Interface {
  readonly resolve: (input: Composition.CompositionInput) => Effect.Effect<Composition.Plan>
  readonly checkHealth: (profile: SchemaCustomProfile.Profile) => Effect.Effect<Composition.Health>
  readonly findReferencingProfiles: (
    kind: string,
    relativePath: string,
  ) => Effect.Effect<ReadonlyArray<SchemaCustomProfile.Summary>>
  readonly freeze: (
    input: Composition.FreezeInput,
  ) => Effect.Effect<Composition.Snapshot, Composition.ResolveError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CompositionResolver") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const customProfiles = yield* CustomProfile.Service
    const agentAssets = yield* AgentAsset.Service
    const promptAssets = yield* PromptAsset.Service
    const skillAssets = yield* SkillAsset.Service
    const location = yield* Location.Service
    const tools = yield* ToolRegistry.Service

    const resolve = Effect.fn("CompositionResolver.resolve")(function* (input: Composition.CompositionInput) {
      const digest = computeCompositionDigest(input)
      const diagnostics: Composition.Diagnostic[] = []
      let agentInfo: Composition.AgentInfo | undefined
      const instructions: Composition.Instruction[] = []
      const skills: Composition.SkillInfo[] = []
      const capabilities: Composition.CapabilityInfo[] = []

      let resolvedAgents: readonly Composition.AgentRef[] = []
      let resolvedBindings: Record<string, Composition.Binding> = {}
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
          resolvedBindings = p.profile.bindings as Record<string, Composition.Binding>
          resolvedCapabilities = p.profile.requestedCapabilities
        }
      } else {
        resolvedAgents = input.agents
        resolvedBindings = input.bindings as Record<string, Composition.Binding>
        resolvedCapabilities = input.requestedCapabilities
      }

      // 0.5 Duplicate declared assets fail closed per M0 plan Phase E
      // ("duplicate/unconnected asset ... 全部 fail closed"). A duplicate ref would be
      // materialized twice into instructions/skills/snapshot data, so it is a blocking
      // input defect (same class as invalid_agent_cardinality).
      const seenAssetKeys = new Set<string>()
      const declaredAssets: Composition.AssetRef[] = [
        ...resolvedAgents,
        ...Object.values(resolvedBindings).flatMap((binding) => [...binding.prompts, ...binding.skills]),
      ]
      for (const ref of declaredAssets) {
        const key = `${ref.kind}:${ref.relativePath}`
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

      // 1. Cardinality check (M1 requires exactly 1 agent)
      if (resolvedAgents.length !== 1) {
        diagnostics.push(
          new Composition.Diagnostic({
            severity: "blocking",
            code: "invalid_agent_cardinality",
            message: `Composition must contain exactly 1 agent in M1 (got ${resolvedAgents.length})`,
          }),
        )
      } else {
        const agentRef = resolvedAgents[0]
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
        } else {
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
          } else {
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

            agentInfo = new Composition.AgentInfo({
              id: a.name,
              name: a.name,
              description: a.description,
              relativePath: a.relativePath,
              revision: Schema.decodeUnknownSync(Composition.Revision)(a.revision),
            })

            if (a.source && a.source.trim()) {
              instructions.push(
                new Composition.Instruction({
                  source: `agent:${a.name}`,
                  content: a.source.trim(),
                }),
              )
            }

            const allowedConsumerKeys = new Set(["orchestrator", `agents/${a.name}`])

            // Validate consumer keys
            if (resolvedBindings) {
              for (const [consumerKey, binding] of Object.entries(resolvedBindings)) {
                if (allowedConsumerKeys.has(consumerKey)) continue
                diagnostics.push(
                  new Composition.Diagnostic({
                    severity: "error",
                    code: "unknown_consumer_key",
                    message: `Consumer key '${consumerKey}' is unrecognized for agent '${a.name}'`,
                  }),
                )
                // Refs under an unrecognized consumer never reach a real consumer and are
                // dropped from the plan. List each one explicitly instead of silently
                // ignoring it. Severity "error" (not warning) because the M0 plan Phase E
                // contract requires unconnected assets to fail closed.
                for (const ref of [...binding.prompts, ...binding.skills]) {
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
                  if (p.template && p.template.trim()) {
                    instructions.push(
                      new Composition.Instruction({
                        source: `prompt:${p.name}`,
                        content: p.template.trim(),
                      }),
                    )
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
                  skills.push(
                    new Composition.SkillInfo({
                      name: s.name,
                      description: s.description,
                      relativePath: s.relativePath,
                      revision: Schema.decodeUnknownSync(Composition.Revision)(s.revision),
                    }),
                  )
                }
              }
            }
          }
        }
      }

      // Capabilities evaluation
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

      const hasBlockingOrError = diagnostics.some((d) => d.severity === "blocking" || d.severity === "error")
      const valid = !hasBlockingOrError

      return new Composition.Plan({
        version: 1,
        digest,
        valid,
        input,
        agent: agentInfo,
        instructions,
        skills,
        capabilities,
        diagnostics,
      })
    })

    const checkHealth = Effect.fn("CompositionResolver.checkHealth")(function* (profile: SchemaCustomProfile.Profile) {
      const input = new Composition.TemporaryInput({
        source: "temporary",
        agents: profile.agents,
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
      const plan = yield* resolve(input.input)
      if (!plan.valid) {
        return yield* new Composition.ResolveError({
          code: "invalid_composition_plan",
          message: "Cannot freeze an invalid composition plan",
          diagnostics: plan.diagnostics,
        })
      }

      const promptData: Composition.SnapshotPromptData[] = []
      let bindingsObj: Record<string, Composition.Binding> = {}
      if (plan.input.source === "temporary") {
        bindingsObj = plan.input.bindings as Record<string, Composition.Binding>
      } else {
        const pOpt = yield* customProfiles.getByPath(plan.input.profilePath).pipe(Effect.option)
        if (Option.isSome(pOpt)) {
          bindingsObj = pOpt.value.profile.bindings as Record<string, Composition.Binding>
        }
      }

      for (const binding of Object.values(bindingsObj)) {
        for (const p of binding.prompts) {
          const pInfo = yield* promptAssets.getByPath(p.relativePath).pipe(Effect.option)
          promptData.push(
            new Composition.SnapshotPromptData({
              relativePath: p.relativePath,
              revision: p.revision,
              content: Option.getOrUndefined(pInfo)?.template ?? "",
            }),
          )
        }
      }

      const materialized = yield* tools.materialize()
      const fingerprints = materialized.definitions
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
      const snapshotData = new Composition.SnapshotDataV1({
        agentID: plan.agent?.id ?? "default",
        instructions: plan.instructions,
        prompts: promptData,
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
