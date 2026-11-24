import { Composition } from "@omnixa/schema/composition"
import { CompositionResolveError } from "@omnixa/protocol/errors"
import { Schema } from "effect"
import { T0 } from "./app"

export const revision = "b".repeat(64)

export const digest = "c".repeat(64)

export function plan(
  root: Composition.BuiltinRoot["id"],
  input: { revision?: string; digest?: string; valid?: boolean; diagnostics?: Composition.Diagnostic[] } = {},
) {
  return Schema.decodeUnknownSync(Schema.toCodecJson(Composition.Plan))({
    version: 2,
    digest: input.digest ?? digest,
    valid: input.valid ?? true,
    input: {
      source: "temporary",
      root: { source: "builtin", id: root, revision: input.revision ?? revision },
      agents: [],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    },
    orchestrator: {
      id: root,
      name: { build: "Build", plan: "Plan", meta: "Meta" }[root],
      mode: "primary",
      hidden: false,
      request: { settings: {}, headers: {}, body: {} },
      system: "Saved builtin system",
      permissions: [{ action: "write", resource: "*", effect: "ask" }],
      handoffs: [],
    },
    agents: [],
    commands: [],
    instructions: [],
    skills: [],
    capabilities: [],
    mcp: { requested: [], effective: [], denied: [] },
    diagnostics: input.diagnostics ?? [],
  })
}

export function planAnswer(value: Composition.Plan) {
  return { status: 200, body: Schema.encodeSync(Schema.toCodecJson(Composition.Plan))(value) }
}

export function staleAnswer(root: Composition.BuiltinRoot["id"], expected: string, actual: string) {
  return {
    status: 422,
    body: Schema.encodeSync(Schema.toCodecJson(CompositionResolveError))(
      new CompositionResolveError({
        code: "invalid_composition_plan",
        message: "Cannot freeze an invalid composition plan",
        diagnostics: [
          new Composition.Diagnostic({
            severity: "error",
            code: "builtin_root_stale_revision",
            message: `Builtin root '${root}' revision mismatch: expected ${expected}, found ${actual}`,
          }),
        ],
      }),
    ),
  }
}

export function startAnswer(
  input: Composition.StartInput,
  directory: string,
  value: Composition.Plan,
  projectID = "proj_custom_composition",
) {
  const root = value.input.source === "temporary" ? value.input.root : undefined

  const started = Schema.decodeUnknownSync(Schema.toCodecJson(Composition.StartResponse))({
    session: {
      id: input.sessionID ?? "ses_custom_created",
      projectID,
      mode: "custom",
      agent: root?.id,
      model: input.model ?? { id: "test", providerID: "omnixa" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: T0, updated: T0 },
      title: "Adopted builtin",
      location: { directory },
    },
    snapshot: {
      version: 2,
      sessionID: input.sessionID ?? "ses_custom_created",
      digest: value.digest,
      createdAt: T0,
      data: {
        sourceLocation: { directory },
        root,
        orchestrator: value.orchestrator,
        agents: [],
        executors: [],
        bindings: { orchestrator: { instructions: [], prompts: [], skills: [], commands: [] } },
        maxConcurrency: 1,
        commands: [],
        instructions: [],
        prompts: [],
        skills: [],
        tools: { catalog: [], fingerprints: [], catalogDigest: value.digest, capture: [] },
        mcp: { bindings: [], tools: [] },
      },
    },
  })

  return { status: 200, body: Schema.encodeSync(Schema.toCodecJson(Composition.StartResponse))(started) }
}

export * as CustomCompositionFixture from "./custom-composition"
