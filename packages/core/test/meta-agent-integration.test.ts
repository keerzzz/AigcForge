import { describe, expect, it, spyOn } from "bun:test"
import { $ } from "bun"
import { createHash, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { Readable, Writable } from "node:stream"
import type { HookCallback, Query, SDKResultSuccess, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"
import path from "node:path"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { MetaAgentMemory } from "@aigcfroge/core/agent/meta/memory"
import { AIError, InvalidRequestError, LLMClient, LLMEvent } from "@aigcfroge/ai"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { Skill } from "@aigcfroge/core/skill"
import { Tool } from "@aigcfroge/core/tool"
import { Bus } from "@aigcfroge/core/bus"
import { Job } from "@aigcfroge/core/job"
import { KV } from "@aigcfroge/core/kv"
import { DelegationEvent } from "@aigcfroge/core/delegation/event"
import { Database } from "@aigcfroge/core/database/database"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationFold } from "@aigcfroge/core/delegation/fold"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { DelegationReceipt } from "@aigcfroge/core/delegation/receipt"
import { DelegationReview } from "@aigcfroge/core/delegation/review"
import { ScopedGrantTable } from "@aigcfroge/core/grant/sql"
import { Environment } from "@aigcfroge/core/environment/index"
import { CliAdapter } from "@aigcfroge/core/tool/cli-adapter"
import { CodexAppServer } from "@aigcfroge/core/tool/codex-app-server"
import { ClaudeCodeSdkAdapter } from "@aigcfroge/core/tool/claude-code-sdk"
import { ClaudeCodeAcpAdapter } from "@aigcfroge/core/tool/claude-code-acp"
import { AcpClientConnection } from "@aigcfroge/core/acp-client/connection"
import { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { AnyMessage, InitializeRequest, ReadTextFileRequest } from "@agentclientprotocol/sdk"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import {
  MetaAgentMemoryTable,
  MetaAgentStepTable,
  MetaAgentSessionTable,
  MetaAgentTable,
} from "@aigcfroge/core/meta-agent/sql"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Form } from "@aigcfroge/core/form"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowRunTable } from "@aigcfroge/core/workflow/sql"
import { Composition } from "@aigcfroge/schema/composition"
import { ConfigMeta } from "@aigcfroge/core/config/meta"
import { Config } from "@aigcfroge/core/config"
import { Verifier } from "@aigcfroge/core/session/verifier"
import { VerificationRouter } from "@aigcfroge/core/session/verification-router"
import { TaskTool } from "@aigcfroge/core/tool/plugin/task"
import { ClaudeCodeAdapter } from "@aigcfroge/core/tool/claude-code"
import { SessionShareTool } from "@aigcfroge/core/tool/plugin/share"
import { QuestionTool } from "@aigcfroge/core/tool/plugin/question"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { Permission } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { Event } from "@aigcfroge/schema/event"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { and, eq, sql } from "drizzle-orm"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream, Struct } from "effect"
import { git, initRepo } from "./fixture/git"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { executeTool } from "./lib/tool"

type AcpStream = import("@agentclientprotocol/sdk").Stream

describe("Meta-agent A injection integration", () => {
  it("PROMPT_META template contains {{ASSETS_LIST}}", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    expect(template).toContain("{{ASSETS_LIST}}")
  })

  it("fillAssetsList replaces placeholder in template", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}\n\n## Notes`
    const assets = [
      { kind: "prompt", name: "code-review" },
      { kind: "prompt", name: "commit-msg" },
      { kind: "skill", name: "deploy" },
    ]
    const result = MetaPrompt.fillAssetsList(template, assets)
    expect(result).not.toContain("{{ASSETS_LIST}}")
    expect(result).toContain("code-review")
    expect(result).toContain("deploy")
    expect(result).toMatch(/- \*\*.*\*\*: .+/)
  })

  it("fillAssetsList with empty assets shows fallback", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, [])
    expect(result).toContain("(no assets available)")
  })

  it("fillAssetsList handles single asset per kind", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, [{ kind: "mcp", name: "github" }])
    expect(result).toContain("- **mcps**: github")
  })

  it("fillCliList refills an earlier empty fill (order-independent)", () => {
    // The core plugin fills {{CLI_LIST}} with an empty list at init; the
    // aigcfroge filler must still be able to overwrite that marker later.
    const empty = MetaPrompt.fillCliList("CLIs:\n{{CLI_LIST}}", [])
    expect(empty).toContain(MetaPrompt.NO_CLI_MESSAGE)
    const refilled = MetaPrompt.fillCliList(empty, ["claude-code", "codex"])
    expect(refilled).toContain("- claude-code")
    expect(refilled).toContain("- codex")
    expect(refilled).not.toContain(MetaPrompt.NO_CLI_MESSAGE)
  })
})

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const metaLayer = (persist: boolean, databasePath?: string) =>
  AppNodeBuilder.build(
    LayerNode.group([
      WorkflowExecution.node,
      WorkflowRun.node,
      SessionComposition.node,
      DelegationExecution.node,
      DelegationService.node,
      Session.node,
      SessionTask.node,
      SessionExecution.node,
      LocationServiceMap.node,
      ApprovalPresence.node,
      Job.node,
      FSUtil.node,
      KV.node,
      MetaAgentService.node,
      MetaAgentMemory.node,
      Database.node,
      Bus.node,
      llmTest,
    ]),
    [
      Global.node.replace(tempGlobalLayer),
      ...(databasePath ? [Database.node.replace(Database.configured({ path: databasePath }))] : []),
      ...(persist ? [Bus.node.replace(Bus.configured({ persist: true }))] : []),
      offlineModels,
      LayerNodePlatform.llmClient.replace(llmClient),
    ],
  )
const metaTest = (persist: boolean) => testEffect(metaLayer(persist))

const effectTest = metaTest(true)
// Omit the Bus override to exercise the production default, including its projectors.
const memoryOriginTest = metaTest(false)

const metaSetup = (
  worker = Agent.ID.make("keeper-worker"),
  external = false,
  actor = Agent.ID.make("meta"),
  transport: CliAdapter.CliAdapterValue["transport"] = "app-server",
  artifactPath?: string,
  locationPath = "",
  mode?: "work",
  meta?: ConfigMeta.Info,
  externalTarget = "codex",
  externalTimeout?: number,
  externalCommand = "mc06-controlled-peer",
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    if (artifactPath)
      yield* Effect.promise(async () => {
        await initRepo(directory.path)
        await Bun.write(`${directory.path}/${artifactPath}`, "base\n")
        await git(directory.path, "add", "--", artifactPath)
        await git(directory.path, "commit", "-m", "tracked artifact baseline")
      })
    if (external || meta)
      yield* Effect.promise(() =>
        Bun.write(
          `${directory.path}/aigcfroge.json`,
          JSON.stringify({
            ...(external
              ? {
                  cli_agents: {
                    [externalTarget]: {
                      command: externalCommand,
                      transport,
                      ...(externalTimeout === undefined ? {} : { timeout: externalTimeout }),
                    },
                  },
                }
              : {}),
            ...(meta ? { meta: Schema.encodeSync(ConfigMeta.Info)(meta) } : {}),
          }),
        ),
      )
    const location = Location.Ref.make({
      directory: AbsolutePath.make(locationPath ? `${directory.path}/${locationPath}` : directory.path),
    })
    const locations = yield* LocationServiceMap.Service
    const local = locations.get(location)
    const providerID = Provider.ID.make("meta-keeper")
    const metaModel = Model.Ref.make({ providerID, id: Model.ID.make("keeper-meta") })
    const executorModel = Model.Ref.make({ providerID, id: Model.ID.make("keeper-worker") })
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(providerID),
          activation: "enabled",
          package: "@aigcfroge/ai/providers/openai/responses",
        }),
        models: [metaModel, executorModel].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
      },
    ]).pipe(Effect.provide(local))
    if (worker !== "build")
      yield* Agent.Service.use((agents) =>
        agents.transform((editor) =>
          editor.update(worker, (agent) => {
            // This runtime fixture is builtin; user assets enter through the Custom keepers.
            agent.originKind = "builtin"
            agent.mode = "subagent"
            agent.model = executorModel
          }),
        ),
      ).pipe(Effect.provide(local))
    if (worker === "build")
      expect(yield* Agent.Service.use((agents) => agents.get(worker)).pipe(Effect.provide(local))).toMatchObject({
        id: "build",
        mode: "all",
        name: "Build",
      })
    const sessions = yield* Session.Service
    const root = yield* sessions.create({
      location,
      mode,
      agent: actor,
      title: "Meta agent keeper",
      model: metaModel,
      ...(actor === "meta"
        ? { executorPreference: new MetaAgent.ExecutorPreference({ agent: worker, model: executorModel }) }
        : {}),
    })
    return {
      sessions,
      root,
      metaModel,
      executorModel,
      worker,
      llm: yield* TestLLM.Test,
      runs: yield* SessionExecution.Service,
    }
  })

const mc04bTask = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof metaSetup>>,
  id: string,
  input: typeof TaskTool.Input.Type,
  responses: readonly TestLLM.Response[] = [],
) {
  yield* fixture.llm.push(
    TestLLM.tool(id, TaskTool.name, input),
    ...responses,
    TestLLM.text(`Consumed ${id} completely.`, `${id}-parent`),
  )
  yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: input.description })
  yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), `${id} did not settle`, "10 seconds")
  const result = yield* mc07Consumed(fixture, id)
  if (result.tool.state.status !== "completed" && result.tool.state.status !== "error")
    return yield* Effect.die(new Error(`${id} has no terminal Task facts`))
  return {
    ...result,
    verification: Schema.decodeUnknownSync(VerificationRouter.Settlement)(result.tool.state.metadata?.verification),
  }
})

const mc04bSetup = Effect.fnUntraced(function* (
  verifier = ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 2 }),
  typecheck:
    | string
    | false = `${JSON.stringify(path.resolve(import.meta.dirname, "../../../node_modules/.bin/tsgo"))} --noEmit --skipLibCheck --target esnext input.ts`,
) {
  const fixture = yield* metaSetup(
    Agent.ID.make("build"),
    false,
    Agent.ID.make("meta"),
    "app-server",
    undefined,
    "",
    "work",
    ConfigMeta.Info.make({ verifier }),
  )
  yield* fixture.sessions.setPermissions({
    sessionID: fixture.root.id,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  if (typecheck !== false)
    yield* Effect.promise(() =>
      Bun.write(
        `${fixture.root.location.directory}/package.json`,
        JSON.stringify({ packageManager: "bun@1.4.2", scripts: { typecheck } }),
      ),
    )
  return fixture
})

const mc04bWrite = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof metaSetup>>,
  id: string,
  content: string,
) {
  yield* fixture.llm.push(
    TestLLM.tool(id, "write", { path: "input.ts", content }),
    TestLLM.text(`Consumed ${id}.`, `${id}-parent`),
  )
  yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Write and check the actual fixture." })
  yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), `${id} did not settle`, "10 seconds")
  const saved = yield* mc07Result(fixture, id)
  if (saved.tool.state.status !== "completed")
    return yield* Effect.die(new Error(`${id} did not save a completed Tool`))
  const consumed = (yield* fixture.llm.requests())
    .flatMap((request) => request.messages)
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .findLast((part) => part.type === "tool-result" && part.id === id)
  expect(consumed?.type === "tool-result" && consumed.result).toEqual({
    type: "content",
    value: saved.tool.state.content,
  })
  return {
    ...saved,
    mechanical: Schema.decodeUnknownSync(Verifier.Result)(saved.tool.state.metadata?.verification),
    text: saved.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
  }
})

effectTest.live(
  "MC04b consumes actual L0 source through the configured Judge and complete parent result",
  () =>
    Effect.gen(function* () {
      const fixture = yield* metaSetup(
        Agent.ID.make("build"),
        false,
        Agent.ID.make("meta"),
        "app-server",
        undefined,
        "",
        "work",
        ConfigMeta.Info.make({
          verifier: ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
        }),
      )
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      yield* Effect.promise(() =>
        Bun.write(
          `${fixture.root.location.directory}/package.json`,
          JSON.stringify({
            packageManager: "bun@1.4.2",
            scripts: {
              typecheck: `${JSON.stringify(path.resolve(import.meta.dirname, "../../../node_modules/.bin/tsgo"))} --noEmit --skipLibCheck --target esnext input.ts`,
            },
          }),
        ),
      )
      yield* fixture.llm.push(
        TestLLM.tool("mc04b-l0-write", "write", { path: "input.ts", content: "export const value: string = 1\n" }),
        TestLLM.text("Recorded the actual compiler result.", "mc04b-l0-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Write the fixture and check it." })
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC04b L0 did not settle", "10 seconds")
      const mechanical = yield* mc07Result(fixture, "mc04b-l0-write")
      if (mechanical.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC04b mechanical Tool result is missing"))
      const mechanicalText =
        mechanical.tool.state.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
      expect(mechanicalText).toContain("typecheck 失败")
      expect(mechanicalText).toContain("[验证来源] verification.source=")
      const observations = JSON.stringify({
        observations: [
          { kind: "contradiction", quote: "typecheck 失败", detail: "The declared string received a number." },
        ],
      })
      const requestedJudges: (typeof TaskTool.Input.Type)[] = []
      yield* fixture.llm.serve((request) => {
        if (
          request.messages.some(
            (message) =>
              message.role === "user" &&
              message.content.some((part) => part.type === "text" && part.text.includes("<verification_source>")),
          )
        )
          return TestLLM.text(observations, `mc04b-judge-${request.model.id}`)
        const consumed = request.messages.flatMap((message) => (message.role === "tool" ? message.content : []))
        if (consumed.some((part) => part.type === "tool-result" && part.id === "mc04b-l1-judge"))
          return TestLLM.text("Consumed all Judge results and retained the compiler failure.", "mc04b-l1-parent")
        const mechanical = consumed.find((part) => part.type === "tool-result" && part.id === "mc04b-l0-write")
        const text =
          mechanical?.type === "tool-result" && mechanical.result.type === "content"
            ? mechanical.result.value.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
            : ""
        const source = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Struct({ messageID: SessionMessage.ID, id: Schema.String })),
        )(text.match(/^\[验证来源\] verification.source=(.+)$/m)?.[1])
        const input: typeof TaskTool.Input.Type = {
          description: "Observe the actual compiler failure",
          prompt: "Report contradictions and missing evidence in the saved compiler result.",
          subagent_type: "build",
          execution_type: "judge",
          judge_models: [
            `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
            `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
          ],
          verification: { source },
        }
        requestedJudges.push(input)
        return TestLLM.tool("mc04b-l1-judge", TaskTool.name, input)
      })
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Judge the saved verification result." })
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC04b Judge did not settle", "10 seconds")
      const judged = yield* mc07Consumed(fixture, "mc04b-l1-judge")
      expect(judged.tool.state.status).toBe("completed")
      if (judged.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b Judge result is missing"))
      expect(mechanical.tool.state.metadata?.verification).toMatchObject({ status: "failed" })
      expect(judged.tool.state.metadata?.verification).toMatchObject({
        level: "l1",
        state: { level: "l2", failures: 0 },
      })
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(judged.text)
      expect(output.workers.map((worker) => worker.text)).toEqual([observations, observations])
      expect(output.workers.every((worker) => worker.receipt !== undefined)).toBe(true)
      expect(output.input.text).toContain(mechanicalText)
      expect(yield* Effect.promise(() => Bun.file(`${fixture.root.location.directory}/.git/HEAD`).exists())).toBe(false)
      expect(requestedJudges).toHaveLength(1)
      const verification = requestedJudges[0]?.verification
      expect(verification).toEqual({ source: { messageID: mechanical.assistant.id, id: mechanical.tool.id } })
      if (!verification?.source) return yield* Effect.die(new Error("MC04b parent did not copy the visible L0 source"))
      expect(Schema.decodeUnknownSync(TaskTool.Input)(judged.tool.state.input).verification).toEqual(verification)
      yield* Effect.promise(async () => {
        await initRepo(fixture.root.location.directory)
        await git(fixture.root.location.directory, "add", "--", "input.ts")
        await git(fixture.root.location.directory, "commit", "-m", "MC04b tracked fixture baseline")
      })
      const r1 = yield* mc04bTask(
        fixture,
        "mc04b-l2-r1",
        {
          description: "Capture the current failed revision",
          prompt: "Write the new revision for the original compiler failure.",
          subagent_type: "build",
          new_delegation: true,
          artifact_path: "input.ts",
          verification,
        },
        [
          TestLLM.tool("mc04b-r1-write", "write", { path: "input.ts", content: "export const value: string = 2\n" }),
          TestLLM.text("R1 still needs the typed compiler repair.", "mc04b-r1-child"),
        ],
      )
      if (r1.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b R1 Task failed"))
      const producer = Schema.decodeUnknownSync(DelegationService.Governance)(r1.tool.state.metadata?.governance)
      if (producer.kind !== "revision" || !("artifact" in producer))
        return yield* Effect.die(new Error("MC04b R1 has no actual revision"))
      expect(r1.tool.state.metadata?.verification).toMatchObject({
        level: "l2",
        reset: "none",
        state: { level: "l2", failures: 0 },
      })
      const reviewText = (digest: string, verdict: "rejected" | "approved") =>
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: digest,
          verdict,
          findings: [],
          summary: `${verdict}: the current compiler result was inspected.`,
        })}</review>`
      const rejected = yield* mc04bTask(
        fixture,
        "mc04b-l2-rejected",
        {
          description: "Review the actual R1",
          prompt: "Review the bound R1 and record the typed finding.",
          subagent_type: "build",
          intent: "review",
          revision_digest: producer.artifact.revisionDigest,
          delegation_id: producer.receipt.delegationID,
          verification,
        },
        [TestLLM.text(reviewText(producer.artifact.revisionDigest, "rejected"), "mc04b-reject-child")],
      )
      if (rejected.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b R1 review failed"))
      const reviewer = Schema.decodeUnknownSync(Delegation.Receipt)(rejected.tool.state.metadata?.receipt)
      const repair = yield* mc04bTask(
        fixture,
        "mc04b-l2-repair",
        {
          description: "Repair the original typed rejection",
          prompt: `Repair the exact reviewed compiler failure.\n${rejected.text}`,
          subagent_type: "build",
          artifact_path: "input.ts",
          delegation_id: producer.receipt.delegationID,
          participant_id: producer.receipt.participantID,
          task_id: producer.receipt.childSessionID,
          command: "append",
          verification,
        },
        [
          TestLLM.tool("mc04b-r2-write", "write", {
            path: "input.ts",
            content: 'export const value: string = "fixed"\n',
          }),
          TestLLM.text("R2 fixed the compiler failure.", "mc04b-r2-child"),
        ],
      )
      if (repair.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b R2 Task failed"))
      const repaired = Schema.decodeUnknownSync(DelegationService.Governance)(repair.tool.state.metadata?.governance)
      if (repaired.kind !== "revision" || !("artifact" in repaired))
        return yield* Effect.die(new Error("MC04b repair has no actual revision"))
      expect(repaired.receipt.childSessionID).toBe(producer.receipt.childSessionID)
      expect(repaired.receipt.inputID).not.toBe(producer.receipt.inputID)
      expect(repaired.artifact.revisionDigest).not.toBe(producer.artifact.revisionDigest)
      const childMessages = yield* fixture.sessions.messages({
        sessionID: repaired.receipt.childSessionID,
        type: "assistant",
        order: "asc",
      })
      const passed = childMessages
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc04b-r2-write")
      if (passed?.type !== "tool" || passed.state.status !== "completed")
        return yield* Effect.die(new Error("MC04b repair write is missing"))
      const actualPassed = Schema.decodeUnknownSync(Verifier.Result)(passed.state.metadata?.verification)
      expect(actualPassed).toMatchObject({ status: "passed", packages: [{ status: "passed", exitCode: 0 }] })
      const approved = yield* mc04bTask(
        fixture,
        "mc04b-l2-approved",
        {
          description: "Review the repaired R2",
          prompt: "Review R2 in the same original reviewer.",
          subagent_type: "build",
          intent: "review",
          revision_digest: repaired.artifact.revisionDigest,
          delegation_id: repaired.receipt.delegationID,
          participant_id: reviewer.participantID,
          task_id: reviewer.childSessionID,
          verification,
        },
        [TestLLM.text(reviewText(repaired.artifact.revisionDigest, "approved"), "mc04b-approve-child")],
      )
      const delegations = yield* DelegationService.Service
      const blocked = yield* delegations.foldState(producer.receipt.delegationID)
      expect(blocked?.reviews.map((review) => review.verdict)).toEqual(["rejected", "approved"])
      expect(blocked?.delegation.rejectionBlocked).toBe(true)
      const completeInput = {
        description: "Complete the verified delegation",
        prompt: "Complete and archive after the original review barrier.",
        subagent_type: "build",
        delegation_id: producer.receipt.delegationID,
        command: "complete" as const,
        verification,
      }
      const refused = yield* mc04bTask(fixture, "mc04b-l2-blocked", completeInput)
      if (refused.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC04b completion refusal did not preserve its result"))
      expect(refused.tool.state.metadata?.verification).toMatchObject({
        status: "unavailable",
        reset: "none",
        state: { level: "l2", failures: 0 },
      })
      expect(refused.text).toMatch(/barrier/i)
      expect(yield* delegations.foldState(producer.receipt.delegationID)).toEqual(blocked)
      const retracted = yield* mc04bTask(fixture, "mc04b-l2-retract", {
        ...completeInput,
        description: "Retract the repaired R1 rejection",
        prompt: "Explicitly retract R1: R2 passed the actual compiler check and the same reviewer approved R2.",
        participant_id: reviewer.participantID,
        command: "retract_rejection",
      })
      if (retracted.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b retraction failed"))
      expect(retracted.tool.state.metadata?.verification).toMatchObject({
        reset: "none",
        state: { level: "l2", failures: 0 },
      })
      const completed = yield* mc04bTask(fixture, "mc04b-l2-complete", completeInput)
      if (completed.tool.state.status !== "completed") return yield* Effect.die(new Error("MC04b completion failed"))
      expect(completed.tool.state.metadata?.verification).toMatchObject({
        status: "completed",
        reset: "completion_barrier",
        state: { level: "l0", failures: 0 },
        completion: { canComplete: true, revisionDigest: repaired.artifact.revisionDigest },
      })
      expect((yield* delegations.foldState(producer.receipt.delegationID))?.delegation.status).toBe("archived")
      if (actualPassed.source?.type !== "tool")
        return yield* Effect.die(new Error("MC04b passed child result has no Tool source"))
      const childReset = yield* mc04bTask(fixture, "mc04b-child-passed-source", {
        description: "Consume the owned child passed result",
        prompt: "Observe the exact saved child compiler pass.",
        subagent_type: "build",
        execution_type: "judge",
        verification: {
          source: {
            sessionID: repaired.receipt.childSessionID,
            messageID: SessionMessage.ID.make(actualPassed.source.messageID),
            id: actualPassed.source.id,
          },
        },
      })
      expect(childReset.verification).toMatchObject({
        level: "l0",
        reset: "l0_passed",
        mechanicalSource: { sessionID: repaired.receipt.childSessionID },
        state: { level: "l0", failures: 0 },
      })
      const sources = [judged, r1, rejected, repair, approved, refused, retracted, completed, childReset]
      const requests = yield* fixture.llm.requests()
      console.info(
        "MC04B_FULL_CONSUMER",
        JSON.stringify({
          mechanical: mechanical.tool.state.metadata?.verification,
          visibleMechanical: { text: mechanicalText, source: verification.source, taskInput: requestedJudges[0] },
          judge: output,
          repairedMechanical: passed.state.metadata?.verification,
          results: sources.map((result) => ({
            source: { messageID: result.assistant.id, id: result.tool.id },
            body: result.text,
            metadata: result.tool.state.status === "completed" ? result.tool.state.metadata : undefined,
          })),
          consumers: sources.map((result) => ({
            id: result.tool.id,
            bodySha256: createHash("sha256").update(result.text).digest("hex"),
            requests: requests.flatMap((request, index) =>
              request.messages
                .flatMap((message) => (message.role === "tool" ? message.content : []))
                .some(
                  (part) =>
                    part.type === "tool-result" &&
                    part.id === result.tool.id &&
                    part.result.type === "text" &&
                    part.result.value === result.text,
                )
                ? [index]
                : [],
            ),
          })),
          modelRequests: requests.map((request) => ({
            provider: request.model.provider,
            id: request.model.id,
            route: request.model.route.id,
          })),
        }),
      )
      return undefined
    }),
  30_000,
)

effectTest.live(
  "MC04b saves threshold-two failure counts once, reads them back, and resets on a fresh passed source",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup()
      const failed = yield* mc04bWrite(fixture, "mc04b-count-failed", "export const value: string = 1\n")
      const input = {
        description: "Consume the saved mechanical result",
        prompt: "Observe the exact saved result.",
        subagent_type: "build",
        execution_type: "judge" as const,
        judge_models: [
          `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
          `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
        ],
        verification: { source: { messageID: failed.assistant.id, id: failed.tool.id } },
      }
      const first = yield* mc04bTask(fixture, "mc04b-count-first", input)
      expect(first.verification).toMatchObject({
        level: "l0",
        status: "not_dispatched",
        state: { level: "l0", failures: 1 },
      })
      const duplicate = yield* mc04bTask(fixture, "mc04b-count-duplicate", input)
      expect(duplicate.verification.state).toEqual(first.verification.state)
      expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toHaveLength(0)
      const second = yield* mc04bWrite(fixture, "mc04b-count-second-failure", "export const value: string = 2\n")
      const advisory = yield* mc04bTask(
        fixture,
        "mc04b-count-l1",
        { ...input, verification: { source: { messageID: second.assistant.id, id: second.tool.id } } },
        [TestLLM.text('{"observations":[]}', "mc04b-count-a"), TestLLM.text('{"observations":[]}', "mc04b-count-b")],
      )
      expect(advisory.verification).toMatchObject({
        level: "l1",
        reset: "none",
        state: { level: "l1", failures: 0 },
        observations: [{ status: "no_issue_reported" }, { status: "no_issue_reported" }],
      })
      const fixed = yield* mc04bWrite(fixture, "mc04b-count-passed", 'export const value: string = "fixed"\n')
      const passed = yield* mc04bTask(fixture, "mc04b-count-reset", {
        ...input,
        verification: { source: { messageID: fixed.assistant.id, id: fixed.tool.id } },
      })
      expect(passed.verification).toMatchObject({
        level: "l0",
        reset: "l0_passed",
        state: { level: "l0", failures: 0 },
      })
      const stale = yield* mc04bTask(fixture, "mc04b-count-stale", input)
      expect(stale.verification).toMatchObject({
        status: "unavailable",
        reset: "none",
        state: { level: "l0", failures: 0 },
      })
      expect(stale.verification.reason).toContain("stale")
      console.info(
        "MC04B_COUNT_REPLAY",
        JSON.stringify({
          first: first.verification,
          duplicate: duplicate.verification,
          advisory: advisory.verification,
          passed: passed.verification,
          stale: stale.verification,
        }),
      )
    }),
)

effectTest.live("MC04b disabled escalation retains actual base L0 and dispatches no Judge", () =>
  Effect.gen(function* () {
    const fixture = yield* mc04bSetup(ConfigMeta.Verifier.make({ escalation_enabled: false, escalation_threshold: 1 }))
    const failed = yield* mc04bWrite(fixture, "mc04b-disabled-write", "export const value: string = 1\n")
    expect(failed.mechanical.status).toBe("failed")
    const result = yield* mc04bTask(fixture, "mc04b-disabled-task", {
      description: "Evaluate disabled escalation",
      prompt: "Observe the saved compiler result.",
      subagent_type: "build",
      execution_type: "judge",
      verification: { source: { messageID: failed.assistant.id, id: failed.tool.id } },
    })
    expect(result.verification).toMatchObject({
      enabled: false,
      level: "l0",
      status: "not_dispatched",
      state: { level: "l0", failures: 0 },
      mechanical: { status: "failed" },
    })
    expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toHaveLength(0)
    expect(yield* fixture.llm.requests()).toHaveLength(4)
  }),
)

for (const status of ["unavailable", "unchecked"] as const)
  effectTest.live(`MC04b ${status} mechanical result counts no code failure`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup(
        ConfigMeta.Verifier.make({
          enabled: status !== "unchecked",
          escalation_enabled: true,
          escalation_threshold: 1,
        }),
        "mc04b-nonexistent-typechecker",
      )
      const saved = yield* mc04bWrite(fixture, `mc04b-${status}-write`, "export const value: string = 1\n")
      expect(saved.mechanical.status, JSON.stringify({ mechanical: saved.mechanical, text: saved.text })).toBe(status)
      const result = yield* mc04bTask(fixture, `mc04b-${status}-task`, {
        description: "Consume the actual unavailable result",
        prompt: "Observe the saved result.",
        subagent_type: "build",
        execution_type: "judge",
        verification: { source: { messageID: saved.assistant.id, id: saved.tool.id } },
      })
      expect(result.verification).toMatchObject({
        level: "l0",
        status: "not_dispatched",
        reset: "none",
        state: { level: "l0", failures: 0 },
      })
      expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toHaveLength(0)
    }),
  )

effectTest.live(
  "MC04b explicit content creation retains invalid approved text and empty advisory without granting quality",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup(
        ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
        false,
      )
      const result = yield* mc04bTask(
        fixture,
        "mc04b-content-judge",
        {
          description: "Observe explicit content evidence",
          prompt: "Content evidence is complete. 🚀",
          subagent_type: "build",
          execution_type: "judge",
          judge_models: [
            `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
            `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
          ],
          verification: { intent: "content_creation" },
        },
        [
          TestLLM.text("approved", "mc04b-content-approved"),
          TestLLM.text('{"observations":[]}', "mc04b-content-empty"),
        ],
      )
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(result.text)
      expect(output.workers.map((worker) => worker.text)).toEqual(["approved", '{"observations":[]}'])
      expect(result.verification).toMatchObject({
        mechanical: { status: "unavailable", packages: [] },
        level: "l1",
        reset: "none",
        state: { level: "l1", failures: 0 },
        observations: [{ status: "invalid" }, { status: "no_issue_reported" }],
      })
      expect(yield* Effect.promise(() => Bun.file(`${fixture.root.location.directory}/package.json`).exists())).toBe(
        false,
      )
      expect(yield* Effect.promise(() => Bun.file(`${fixture.root.location.directory}/.git/HEAD`).exists())).toBe(false)
      const delegations = yield* DelegationService.Service
      for (const worker of output.workers)
        expect((yield* delegations.foldState(worker.delegationID))?.reviews).toEqual([])
      const database = yield* Database.Service
      expect(yield* database.db.select().from(ScopedGrantTable)).toEqual([])
      const wrongSource = yield* mc04bTask(fixture, "mc04b-content-wrong-source", {
        description: "Reject the wrong saved Tool type",
        prompt: "Observe the referenced result.",
        subagent_type: "build",
        execution_type: "judge",
        verification: { source: { messageID: result.assistant.id, id: result.tool.id } },
      })
      expect(wrongSource.verification).toMatchObject({
        status: "unavailable",
        reset: "none",
        state: { level: "l1", failures: 0 },
      })
      expect(wrongSource.verification.reason).toContain("write/edit/patch")
    }),
)

for (const condition of ["missing_model", "unavailable_model", "permission_denied"] as const)
  effectTest.live(`MC04b ${condition} retains accurate undispatched facts without a child`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup(
        ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
        false,
      )
      if (condition === "permission_denied")
        yield* fixture.sessions.setPermissions({
          sessionID: fixture.root.id,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task", resource: "build", effect: "deny" },
          ],
        })
      const input = {
        description: "Observe missing dispatch conditions",
        prompt: "The content needs evidence.",
        subagent_type: "build",
        execution_type: "judge" as const,
        verification: { intent: "content_creation" as const },
        ...(condition === "missing_model"
          ? {}
          : {
              judge_models: [
                `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
                `${fixture.metaModel.providerID}/${condition === "unavailable_model" ? "missing-model" : fixture.metaModel.id}`,
              ],
            }),
      }
      const result = yield* mc04bTask(fixture, `mc04b-${condition}`, input)
      expect(result.verification.status).toBe("unavailable")
      expect(result.verification.reset).toBe("none")
      expect(result.verification.reason).toMatch(
        condition === "missing_model"
          ? /judge_models/
          : condition === "unavailable_model"
            ? /unavailable/
            : /denied|blocked/i,
      )
      expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toHaveLength(0)
      expect(yield* fixture.llm.requests()).toHaveLength(2)
    }),
  )

effectTest.live("MC04b failed Judge worker retains its completed sibling observation and full parent result", () =>
  Effect.gen(function* () {
    const fixture = yield* mc04bSetup(
      ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
      false,
    )
    const observed = JSON.stringify({
      observations: [
        { kind: "missing_evidence", quote: "Evidence is missing.", detail: "The evidence must be supplied." },
      ],
    })
    const result = yield* mc04bTask(
      fixture,
      "mc04b-partial-failure",
      {
        description: "Observe incomplete content evidence",
        prompt: "Evidence is missing.",
        subagent_type: "build",
        execution_type: "judge",
        judge_models: [
          `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
          `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
        ],
        verification: { intent: "content_creation" },
      },
      [
        TestLLM.text(observed, "mc04b-completed-sibling"),
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "MC04b controlled worker failure" }) })),
      ],
    )
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(result.text)
    expect(output.status).toBe("failed")
    expect(output.workers.map((worker) => worker.status)).toEqual(["completed", "failed"])
    expect(output.workers[0]?.text).toBe(observed)
    expect(output.workers[1]?.text).toContain("MC04b controlled worker failure")
    expect(result.verification).toMatchObject({
      status: "failed",
      reset: "none",
      state: { level: "l2", failures: 0 },
      observations: [{ status: "reported" }, { status: "failed" }],
    })
    const successful = output.workers[0]?.receipt
    if (!successful) return yield* Effect.die(new Error("MC04b completed sibling receipt is missing"))
    expect(yield* DelegationExecution.Service.use((execution) => execution.wait(successful))).toMatchObject({
      status: "completed",
      text: observed,
    })
    return undefined
  }),
)

effectTest.live(
  "MC04b rejects quotes of appended format instructions and retains partial JSON without counting it",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup(
        ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
        false,
      )
      const locations = yield* LocationServiceMap.Service
      const local = locations.get(fixture.root.location)
      yield* Agent.Service.use((agents) =>
        agents.transform((editor) =>
          editor.update(Agent.ID.make("build"), (agent) => {
            agent.steps = 1
          }),
        ),
      ).pipe(Effect.provide(local))
      const invalid = JSON.stringify({
        observations: [
          { kind: "contradiction", quote: "Return only JSON:", detail: "This quotes the appended format instruction." },
        ],
      })
      const partial = JSON.stringify({
        observations: [
          {
            kind: "missing_evidence",
            quote: "Original evidence.",
            detail: "Readable output stopped at its length limit.",
          },
        ],
      })
      const result = yield* mc04bTask(
        fixture,
        "mc04b-instruction-anchor",
        {
          description: "Observe only original evidence",
          prompt: "Original evidence.",
          subagent_type: "build",
          execution_type: "judge",
          judge_models: [
            `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
            `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
          ],
          verification: { intent: "content_creation" },
        },
        [
          TestLLM.text(invalid, "mc04b-format-quote"),
          TestLLM.complete(
            { reason: { normalized: "length" } },
            LLMEvent.textStart({ id: "mc04b-partial-json" }),
            LLMEvent.textDelta({ id: "mc04b-partial-json", text: partial }),
            LLMEvent.textEnd({ id: "mc04b-partial-json" }),
          ),
        ],
      )
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(result.text)
      expect(output.input.text).toContain("Return only JSON:")
      expect(output.workers.map((worker) => worker.text)).toEqual([invalid, partial])
      expect(result.verification).toMatchObject({
        reset: "none",
        state: { level: "l1", failures: 0 },
        observations: [
          { status: "invalid", observations: [] },
          { status: "partial", observations: [] },
        ],
      })
    }),
)

for (const reportsIssue of [true, false]) {
  effectTest.live(
    `MC04b cancelled Judge retains ${reportsIssue ? "reported" : "empty"} completed workers for exact parent consumption`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* mc04bSetup(
          ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
          false,
        )
        const observed = JSON.stringify({
          observations: reportsIssue
            ? [
                {
                  kind: "missing_evidence",
                  quote: "Original cancellation evidence.",
                  detail: "The completed sibling reported missing evidence.",
                },
              ]
            : [],
        })
        const input = {
          description: "Observe cancellable evidence",
          prompt: "Original cancellation evidence.",
          subagent_type: "build",
          execution_type: "judge" as const,
          judge_models: [
            `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
            `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
          ],
          verification: { intent: "content_creation" as const },
        }
        const ready = yield* Deferred.make<(typeof TaskTool.JudgeOutput.Type.workers)[number]>()
        const bus = yield* Bus.Service
        const unsubscribe = yield* bus.listen((event) => {
          if (event.type !== SessionEvent.Tool.Progress.type) return Effect.void
          const progress = Schema.decodeUnknownSync(SessionEvent.Tool.Progress.data)(event.data)
          if (progress.sessionID !== fixture.root.id || progress.id !== "mc04b-cancel-judge") return Effect.void
          const workers = Schema.decodeUnknownOption(TaskTool.JudgeOutput.fields.workers)(
            progress.metadata.completedWorkers,
          )
          return Option.isSome(workers) && workers.value.length === 1 && workers.value[0]
            ? Deferred.succeed(ready, workers.value[0]).pipe(Effect.asVoid)
            : Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* fixture.llm.push(TestLLM.tool("mc04b-cancel-judge", TaskTool.name, input))
        yield* fixture.llm.serve((request) =>
          request.messages.some(
            (message) =>
              message.role === "user" &&
              message.content.some((part) => part.type === "text" && part.text.includes("<verification_source>")),
          )
            ? String(request.model.id) === fixture.executorModel.id
              ? TestLLM.text(observed, "mc04b-cancel-completed")
              : Stream.never
            : TestLLM.text("Consumed the retained cancellation facts.", "mc04b-cancel-parent"),
        )
        yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: input.description })
        yield* awaitWithTimeout(fixture.llm.wait(3), "MC04b cancellable workers did not start", "10 seconds")
        const completed = yield* awaitWithTimeout(
          Deferred.await(ready),
          "MC04b completed sibling progress was not observed",
          "10 seconds",
        )
        if (!completed.receipt) return yield* Effect.die(new Error("MC04b completed sibling has no exact receipt"))
        const receipt = completed.receipt
        expect(completed.text).toBe(observed)
        expect(yield* fixture.runs.interrupt(fixture.root.id)).toBe(true)
        yield* awaitWithTimeout(
          fixture.runs.awaitIdle(fixture.root.id),
          "MC04b cancellation did not settle",
          "10 seconds",
        )
        const cancelled = yield* mc07Result(fixture, "mc04b-cancel-judge")
        expect(cancelled.tool.state.status).toBe("error")
        if (cancelled.tool.state.status !== "error")
          return yield* Effect.die(new Error("MC04b cancellation has no saved Tool error"))
        const settlement = Schema.decodeUnknownSync(VerificationRouter.Settlement)(
          cancelled.tool.state.metadata?.verification,
        )
        expect(settlement).toMatchObject({
          status: "cancelled",
          reset: "none",
          state: { level: reportsIssue ? "l2" : "l1", failures: 0 },
          observations: [{ status: reportsIssue ? "reported" : "no_issue_reported" }],
        })
        expect(
          Schema.decodeUnknownSync(TaskTool.JudgeOutput.fields.workers)(
            cancelled.tool.state.metadata?.completedWorkers,
          ),
        ).toEqual([completed])
        expect(yield* DelegationExecution.Service.use((execution) => execution.wait(receipt))).toMatchObject({
          status: "completed",
          text: observed,
        })
        const beforeRead = yield* fixture.llm.requests()
        const sources = yield* DelegationExecution.Service.use((execution) =>
          execution.readSources(receipt.delegationID),
        )
        const original = sources.find((source) => source.receipt?.inputID === receipt.inputID)
        if (!original) return yield* Effect.die(new Error("Cancelled Judge's admitted source is missing"))
        expect(original.source).toEqual(completed.source)
        expect(original.parentTaskID).toBe(completed.taskID)
        expect((yield* DelegationExecution.Service.use((execution) => execution.readResult(original))).text).toBe(
          observed,
        )
        expect(yield* fixture.llm.requests()).toEqual(beforeRead)
        yield* fixture.sessions.revert.stage({
          sessionID: receipt.childSessionID,
          messageID: receipt.inputID,
          files: false,
        })
        yield* fixture.sessions.revert.commit(receipt.childSessionID)
        const db = (yield* Database.Service).db
        expect(
          (yield* SessionInputResult.read(db, { sessionID: receipt.childSessionID, inputID: receipt.inputID })).status,
        ).toBe("missing")
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, cancelled.assistant.id))
          .get()
        if (!row || completed.source.type !== "tool")
          return yield* Effect.die(new Error("Retained Judge Tool source is missing"))
        const readOnly = {
          tasks: yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id)),
          requests: yield* fixture.llm.requests(),
          inboxes: yield* Effect.forEach([fixture.root.id, receipt.childSessionID], (sessionID) =>
            fixture.sessions.inbox(sessionID),
          ),
          contexts: yield* Effect.forEach([fixture.root.id, receipt.childSessionID], (sessionID) =>
            fixture.sessions.context(sessionID),
          ),
          events: yield* Effect.forEach(
            [fixture.root.id, receipt.childSessionID, receipt.delegationID],
            (aggregateID) => bus.log({ aggregateID }).pipe(Stream.runCollect),
          ),
        }
        expect((yield* DelegationExecution.Service.use((execution) => execution.readResult(original))).text).toBe(
          observed,
        )
        yield* Effect.forEach(
          [
            ...[
              { ...receipt, delegationID: DelegationID.ID.create() },
              { ...receipt, childSessionID: Session.ID.create() },
              { ...receipt, participantID: ParticipantID.create() },
              { ...receipt, turnID: TurnID.create() },
              { ...receipt, deliveryOrigin: "foreign-origin" },
              { ...receipt, senderParticipantID: ParticipantID.create() },
              { ...receipt, attempt: receipt.attempt + 1 },
            ].map((value) => ({ ...completed, receipt: new Delegation.Receipt(value) })),
            { ...completed, delegationID: DelegationID.ID.create() },
            { ...completed, participantID: ParticipantID.create() },
            { ...completed, turnID: TurnID.create() },
            { ...completed, taskID: "foreign-judge-task" },
            { ...completed, source: { ...completed.source, id: "foreign-judge-call" } },
          ],
          (changed) =>
            Effect.gen(function* () {
              yield* db
                .update(SessionMessageTable)
                .set({
                  data: {
                    ...row.data,
                    content: Schema.encodeSync(SessionMessage.Assistant.fields.content)(
                      cancelled.assistant.content.map((part) =>
                        part.type === "tool" && part.id === cancelled.tool.id && part.state.status === "error"
                          ? {
                              ...part,
                              state: {
                                ...part.state,
                                metadata: {
                                  ...part.state.metadata,
                                  completedWorkers: Schema.encodeSync(
                                    Schema.toCodecJson(TaskTool.JudgeOutput.fields.workers),
                                  )([changed]),
                                },
                              },
                            }
                          : part,
                      ),
                    ),
                  },
                })
                .where(eq(SessionMessageTable.id, row.id))
                .run()
              expect(
                (yield* DelegationExecution.Service.use((execution) => execution.readResult(original))).available,
              ).toBe(false)
            }).pipe(
              Effect.ensuring(
                db
                  .update(SessionMessageTable)
                  .set({ data: row.data })
                  .where(eq(SessionMessageTable.id, row.id))
                  .run()
                  .pipe(Effect.orDie),
              ),
            ),
        )
        expect((yield* DelegationExecution.Service.use((execution) => execution.readResult(original))).text).toBe(
          observed,
        )
        expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toEqual(readOnly.tasks)
        expect(yield* fixture.llm.requests()).toEqual(readOnly.requests)
        expect(
          yield* Effect.forEach([fixture.root.id, receipt.childSessionID], (sessionID) =>
            fixture.sessions.inbox(sessionID),
          ),
        ).toEqual(readOnly.inboxes)
        expect(
          yield* Effect.forEach([fixture.root.id, receipt.childSessionID], (sessionID) =>
            fixture.sessions.context(sessionID),
          ),
        ).toEqual(readOnly.contexts)
        expect(
          yield* Effect.forEach([fixture.root.id, receipt.childSessionID, receipt.delegationID], (aggregateID) =>
            bus.log({ aggregateID }).pipe(Stream.runCollect),
          ),
        ).toEqual(readOnly.events)
        const unrelated = yield* mc04bTask(fixture, "mc04b-cancel-unrelated", {
          description: "Read unrelated content facts",
          prompt: "A different content request.",
          subagent_type: "build",
          verification: input.verification,
        })
        expect(unrelated.text).not.toContain("<retained_judge_results>")
        const replay = yield* mc04bTask(
          fixture,
          "mc04b-cancel-replay",
          input,
          reportsIssue
            ? []
            : [
                TestLLM.text(JSON.stringify({ observations: [] }), "mc04b-new-judge-first"),
                TestLLM.text(JSON.stringify({ observations: [] }), "mc04b-new-judge-second"),
              ],
        )
        expect(replay.verification).toMatchObject({
          status: reportsIssue ? "not_dispatched" : "completed",
          reset: "none",
          state: { level: reportsIssue ? "l2" : "l1", failures: 0 },
        })
        const restored = reportsIssue
          ? Schema.decodeUnknownSync(
              Schema.fromJsonString(
                Schema.Array(
                  Schema.Struct({
                    verification: VerificationRouter.Settlement,
                    workers: TaskTool.JudgeOutput.fields.workers,
                  }),
                ),
              ),
            )(replay.text.match(/<retained_judge_results>([\s\S]*?)<\/retained_judge_results>/)?.[1])
          : Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(replay.text).retained
        expect(restored).toEqual([{ verification: settlement, workers: [completed] }])
        if (replay.tool.state.status !== "completed")
          return yield* Effect.die(new Error("MC04b restored result has no saved canonical Tool content"))
        expect(replay.tool.state.metadata?.restoredVerificationSources).toEqual([
          Schema.encodeSync(VerificationRouter.Source)(settlement.source),
        ])
        const repeated = yield* mc04bTask(fixture, "mc04b-cancel-repeat", {
          description: "Read the same saved facts",
          prompt: input.prompt,
          subagent_type: "build",
          verification: input.verification,
        })
        expect(repeated.text).not.toContain("<retained_judge_results>")
        const requests = yield* fixture.llm.requests()
        expect(requests).toHaveLength(reportsIssue ? 9 : 11)
        console.info(
          "MC04B_CANCEL_REPLAY",
          JSON.stringify({
            case: reportsIssue ? "reported" : "empty",
            source: { messageID: cancelled.assistant.id, id: cancelled.tool.id },
            settlement,
            completed,
            replay: {
              verification: replay.verification,
              text: replay.text,
              restored,
              consumers: requests.flatMap((request, index) =>
                request.messages
                  .flatMap((message) => (message.role === "tool" ? message.content : []))
                  .some(
                    (part) =>
                      part.type === "tool-result" &&
                      part.id === replay.tool.id &&
                      part.result.type === "text" &&
                      part.result.value === replay.text,
                  )
                  ? [index]
                  : [],
              ),
            },
            unrelated: unrelated.text,
            repeated: repeated.text,
          }),
        )
        return undefined
      }),
  )
}

effectTest.live(
  "MC04b reconciles an original recovery-required delivery without a first revision and keeps L2 unsettled",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc04bSetup(
        ConfigMeta.Verifier.make({ escalation_enabled: true, escalation_threshold: 1 }),
        false,
      )
      const observed = JSON.stringify({
        observations: [
          {
            kind: "missing_evidence",
            quote: "The first artifact has no evidence.",
            detail: "The first artifact requires investigation.",
          },
        ],
      })
      yield* mc04bTask(
        fixture,
        "mc04b-reconcile-judge",
        {
          description: "Observe missing first artifact evidence",
          prompt: "The first artifact has no evidence.",
          subagent_type: "build",
          execution_type: "judge",
          judge_models: [
            `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
            `${fixture.metaModel.providerID}/${fixture.metaModel.id}`,
          ],
          verification: { intent: "content_creation" },
        },
        [TestLLM.text(observed, "mc04b-reconcile-a"), TestLLM.text(observed, "mc04b-reconcile-b")],
      )
      yield* fixture.llm.push(
        TestLLM.tool("mc04b-existing-task", TaskTool.name, {
          description: "Create the original owned Task",
          prompt: "Produce the original Task receipt without an artifact revision.",
          subagent_type: "build",
          new_delegation: true,
        }),
        TestLLM.text("The original input and receipt are retained.", "mc04b-existing-child"),
        TestLLM.text("Consumed the original Task receipt.", "mc04b-existing-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Prepare the existing Task recovery fixture.",
      })
      yield* awaitWithTimeout(
        fixture.runs.awaitIdle(fixture.root.id),
        "MC04b original Task did not settle",
        "10 seconds",
      )
      const original = yield* mc07Consumed(fixture, "mc04b-existing-task")
      if (original.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC04b original Task receipt is missing"))
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(original.tool.state.metadata?.receipt)
      const delegations = yield* DelegationService.Service
      expect((yield* delegations.foldState(receipt.delegationID))?.delegation.latestRevisionDigest).toBeUndefined()
      const turn = yield* delegations.appendTurn({
        delegationID: receipt.delegationID,
        kind: "task",
        promptSummary: "Admit the original first-artifact recovery fixture",
        participantIDs: [receipt.participantID],
        delivery: "steer",
        origin: { deliveryOrigin: receipt.deliveryOrigin, senderParticipantID: receipt.senderParticipantID },
      })
      yield* delegations.recordDelivery({
        delegationID: receipt.delegationID,
        turnID: turn.id,
        participantID: receipt.participantID,
        deliveryOrigin: receipt.deliveryOrigin,
        senderParticipantID: receipt.senderParticipantID,
        attempt: 1,
        status: "recovery_required",
        errorCode: "mc04b_controlled_disruption",
        summary: "Controlled original delivery recovery fixture",
      })
      const before = yield* delegations.foldState(receipt.delegationID)
      expect([...(before?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual([
        "completed",
        "recovery_required",
      ])
      const requests = (yield* fixture.llm.requests()).length
      const result = yield* mc04bTask(fixture, "mc04b-l2-reconcile", {
        description: "Reconcile the original disrupted input",
        prompt: "Reconcile the existing delivery without replaying its effects.",
        subagent_type: "build",
        command: "reconcile",
        delegation_id: receipt.delegationID,
        verification: { intent: "content_creation" },
      })
      expect(result.verification).toMatchObject({
        level: "l2",
        status: "completed",
        reset: "none",
        state: { level: "l2", failures: 0 },
      })
      const after = yield* delegations.foldState(receipt.delegationID)
      expect([...(after?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === turn.id)).toMatchObject({
        status: "failed",
        errorCode: "reconciled_after_disruption",
      })
      expect(after?.delegation.latestRevisionDigest).toBeUndefined()
      expect((yield* fixture.llm.requests()).length - requests).toBe(2)
      console.info(
        "MC04B_RECONCILE",
        JSON.stringify({
          receipt,
          source: result.verification.source,
          verification: result.verification,
          deliveries: [...(after?.deliveries.values() ?? [])],
        }),
      )
      return undefined
    }),
)

effectTest.live(
  "MC08 R1 Work Meta consumes exact arbitration and summary then shares the saved Task to a target request",
  () =>
    Effect.gen(function* () {
      const fixture = yield* metaSetup(
        Agent.ID.make("build"),
        false,
        Agent.ID.make("meta"),
        "app-server",
        undefined,
        "",
        "work",
      )
      const locations = yield* LocationServiceMap.Service
      const local = locations.get(fixture.root.location)
      const refs = ["judge-second", "arbitrator", "summarizer", "share-target"].map((id) =>
        Model.Ref.make({ providerID: fixture.metaModel.providerID, id: Model.ID.make(id) }),
      )
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(fixture.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [fixture.metaModel, fixture.executorModel, ...refs].map((ref) =>
            Model.Info.make({
              ...Model.Info.default(ref.providerID, ref.id),
              modelID: Model.ID.make(`actual-${ref.id}`),
              canonical: Provider.ID.make("r1-runtime"),
            }),
          ),
        },
      ]).pipe(Effect.provide(local))
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const targetModel = refs.find((ref) => ref.id === "share-target")
      const arbitrationModel = refs.find((ref) => ref.id === "arbitrator")
      const summaryModel = refs.find((ref) => ref.id === "summarizer")
      if (!targetModel || !arbitrationModel || !summaryModel)
        return yield* Effect.die(new Error("R1 model fixtures are missing"))
      const target = yield* fixture.sessions.create({
        location: fixture.root.location,
        model: targetModel,
        agent: Agent.ID.make("build"),
      })
      const bodies = [
        "Judge A exact body 🚀\n" + "A evidence. ".repeat(90),
        "Judge B exact body\n" + "B evidence. ".repeat(90),
      ]
      const arbitrationText = "Arbitration exact body 🚀\nBoth worker sources were considered."
      const summaryText = "Summary exact body 🚀\nDecision and evidence from both actual workers."
      const input = {
        description: "Arbitrate and share exact evidence",
        prompt: "<workflow_result>\nComplete upstream evidence 🚀\nKeep this second line.\n</workflow_result>",
        subagent_type: "build",
        execution_type: "judge" as const,
        judge_models: [
          `${fixture.executorModel.providerID}/${fixture.executorModel.id}`,
          `${fixture.metaModel.providerID}/judge-second`,
        ],
        arbitration_model: arbitrationModel,
        summary: { model: summaryModel },
      }
      yield* fixture.llm.serve((request) => {
        if (request.model.id === "actual-keeper-worker") return TestLLM.text(bodies[0], "r1-worker-A")
        if (request.model.id === "actual-judge-second") return TestLLM.text(bodies[1], "r1-worker-B")
        if (request.model.id === "actual-arbitrator") return TestLLM.text(arbitrationText, "r1-arbitration")
        if (request.model.id === "actual-summarizer") return TestLLM.text(summaryText, "r1-summary")
        if (request.model.id === "actual-share-target")
          return TestLLM.text("Consumed the exact shared result and its quality and source.", "r1-target-final")
        const consumed = request.messages.flatMap((message) => (message.role === "tool" ? message.content : []))
        if (consumed.some((part) => part.type === "tool-result" && part.id === "mc08-r1-share"))
          return TestLLM.text("Consumed the exact Task and share admission.", "r1-parent-final")
        const judge = consumed.find((part) => part.type === "tool-result" && part.id === "mc08-r1-task")
        if (judge?.type === "tool-result" && judge.result.type === "text") {
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(judge.result.value)
          if (output.arbitration === "none") return TestLLM.text("R1 enhancements are missing.", "r1-parent-red")
          return TestLLM.tool("mc08-r1-share", SessionShareTool.name, {
            sourceSessionID: fixture.root.id,
            targetSessionID: target.id,
            scope: "result",
            result_source: {
              messageID: output.source.type === "tool" ? output.source.messageID : "missing",
              id: "mc08-r1-task",
            },
          })
        }
        return TestLLM.tool("mc08-r1-task", TaskTool.name, input)
      })
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Judge, arbitrate, summarize and share the exact saved result.",
      })
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "R1 parent did not settle", "10 seconds")
      const saved = yield* mc07Consumed(fixture, "mc08-r1-task")
      expect(saved.tool.state.status).toBe("completed")
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(saved.text)
      expect(output.arbitration).not.toBe("none")
      if (output.arbitration === "none" || !output.summary)
        return yield* Effect.die(new Error("R1 enhancements are missing"))
      expect(output.arbitration.status).toBe("completed")
      expect(output.arbitration.result?.text).toBe(arbitrationText)
      expect(output.summary.status).toBe("completed")
      expect(output.summary.result?.text).toBe(summaryText)
      expect(output.workers.map((worker) => worker.text)).toEqual(bodies)
      expect(output.taskSettlement).toBe("updated")
      expect(saved.text.match(/"input":\{/g)).toHaveLength(1)
      const task = yield* SessionTask.Service
      const settled = yield* task.get(fixture.root.id)
      expect(settled).toHaveLength(5)
      expect(settled.find((value) => value.id === output.parentTaskID)).toMatchObject({
        status: "completed",
        revision: 2,
      })
      const enhancementInputs = yield* Effect.forEach([output.arbitration, output.summary], (enhancement) =>
        Effect.gen(function* () {
          const result = enhancement.result
          const receipt = result?.receipt
          if (!result || !receipt) return yield* Effect.die(new Error("R1 enhancement has no actual receipt"))
          expect(result.source).toEqual(output.source)
          expect(result.completion).toMatchObject({
            model: result.executor.model,
            finish: "stop",
            needsContinuation: false,
          })
          expect(settled.find((value) => value.id === result.taskID)).toMatchObject({
            parentID: output.parentTaskID,
            status: "completed",
            revision: 2,
          })
          const child = yield* fixture.sessions.get(receipt.childSessionID)
          expect(child.controller).toMatchObject({ kind: "child", executor: result.executor })
          const admitted = (yield* fixture.sessions.context(child.id)).find((message) => message.id === receipt.inputID)
          if (admitted?.type !== "user") return yield* Effect.die(new Error("R1 exact enhancement input is missing"))
          expect(admitted).toMatchObject({
            type: "user",
            metadata: { task: { parentTaskID: result.taskID, source: output.source } },
          })
          const state = yield* DelegationService.Service.use((service) => service.foldState(receipt.delegationID))
          expect(state?.reviews).toEqual([])
          return { enhancement, receipt, text: admitted.text }
        }),
      )
      const arbitrationInput = enhancementInputs[0]
      const summaryInput = enhancementInputs[1]
      if (!arbitrationInput || !summaryInput)
        return yield* Effect.die(new Error("R1 exact enhancement inputs are missing"))
      expect(arbitrationInput.text).toContain(bodies[0].replaceAll("\n", "\\n"))
      expect(arbitrationInput.text).toContain(bodies[1].replaceAll("\n", "\\n"))
      expect(summaryInput.text).toContain(arbitrationText.replaceAll("\n", "\\n"))
      const arbitrationEvidence = arbitrationInput.text.split("<judge_result>\n")[1]?.split("\n</judge_result>")[0]
      const summaryEvidence = summaryInput.text.split("<judge_result>\n")[1]?.split("\n</judge_result>")[0]
      if (!arbitrationEvidence) return yield* Effect.die(new Error("R1 arbitration evidence is missing"))
      expect(JSON.parse(arbitrationEvidence)).toEqual({
        sessionID: output.sessionID,
        parentTaskID: output.parentTaskID,
        source: output.source,
        input: output.input,
        status: output.status,
        workers: Schema.encodeSync(TaskTool.JudgeOutput)(output).workers,
      })
      expect(summaryEvidence).toBe(arbitrationEvidence)
      const arbitrationResult = summaryInput.text
        .split("<arbitration_result>\n")[1]
        ?.split("\n</arbitration_result>")[0]
      if (!arbitrationResult) return yield* Effect.die(new Error("R1 summary arbitration input is missing"))
      expect(JSON.parse(arbitrationResult)).toEqual(
        Schema.encodeSync(Schema.toCodecJson(TaskTool.JudgeEnhancement))(output.arbitration),
      )
      expect(arbitrationResult.match(/"input":\{/g)).toBeNull()
      yield* awaitWithTimeout(fixture.llm.wait(8), "R1 consumer requests are missing", "10 seconds")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(target.id), "R1 target did not settle", "10 seconds")
      const shared = yield* mc07Consumed(fixture, "mc08-r1-share")
      const delivery = Schema.decodeUnknownSync(Schema.fromJsonString(SessionShareTool.ResultOutput))(shared.text)
      expect(delivery).toMatchObject({
        targetSessionID: target.id,
        sourceSessionID: fixture.root.id,
        scope: "result",
        basis: "summary",
        result_source: { messageID: saved.assistant.id, id: "mc08-r1-task" },
        admission: "admitted",
      })
      expect(delivery.text).toContain(summaryText)
      expect(delivery.text).toContain("quality")
      expect(delivery.text).toContain("actual-arbitrator")
      expect(delivery.text).toContain("actual-summarizer")
      const requests = yield* fixture.llm.requests()
      expect(requests).toHaveLength(8)
      const targetRequest = requests.find((request) => request.model.id === "actual-share-target")
      expect(
        targetRequest?.messages.flatMap((message) => (message.role === "user" ? message.content : [])),
      ).toContainEqual({ type: "text", text: expect.stringContaining(delivery.text) })
      for (const input of enhancementInputs) {
        const request = requests.find((request) => request.model.id === input.enhancement.result?.runtime?.id)
        expect(request?.messages.flatMap((message) => (message.role === "user" ? message.content : []))).toContainEqual(
          { type: "text", text: input.text },
        )
      }
      expect(yield* fixture.sessions.inbox(target.id)).toEqual([])
      console.info(
        "MC08_R1_FULL_CONSUMPTION",
        JSON.stringify({
          output,
          taskBody: saved.text,
          shareBody: shared.text,
          targetBody: delivery.text,
          enhancementInputs,
          requests: requests.map((request) => ({
            model: { provider: request.model.provider, id: request.model.id, route: request.model.route.id },
            messages: request.messages,
          })),
        }),
      )
    }),
)

effectTest.live(
  "MC08 J1 ordinary Work Meta consumes all exact Judge bodies, models and sources in its next request",
  () =>
    Effect.gen(function* () {
      const fixture = yield* metaSetup(
        Agent.ID.make("build"),
        false,
        Agent.ID.make("meta"),
        "app-server",
        undefined,
        "",
        "work",
      )
      const locations = yield* LocationServiceMap.Service
      const local = locations.get(fixture.root.location)
      const second = Model.Ref.make({ providerID: fixture.metaModel.providerID, id: Model.ID.make("judge-second") })
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(fixture.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [
            Model.Info.make(Model.Info.default(fixture.metaModel.providerID, fixture.metaModel.id)),
            Model.Info.make({
              ...Model.Info.default(fixture.executorModel.providerID, fixture.executorModel.id),
              modelID: Model.ID.make("judge-api-A"),
              canonical: Provider.ID.make("judge-runtime"),
              variants: [{ id: Model.VariantID.make("review"), settings: {} }],
            }),
            Model.Info.make({
              ...Model.Info.default(second.providerID, second.id),
              modelID: Model.ID.make("judge-api-B"),
              canonical: Provider.ID.make("judge-runtime"),
            }),
          ],
        },
      ]).pipe(Effect.provide(local))
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const input = {
        description: "Judge the exact workflow evidence",
        prompt:
          '<workflow_result>\n{"source":"controlled upstream Tool evidence","steps":[{"detail":"A exact body 🚀"},{"detail":"B exact body\\nsecond line"}]}\n</workflow_result>',
        subagent_type: "build",
        execution_type: "judge" as const,
        judge_models: [
          `${fixture.executorModel.providerID}/${fixture.executorModel.id}#review`,
          `${second.providerID}/${second.id}`,
        ],
      }
      const bodies = [
        "Judge A complete body 🚀\n" + "A evidence. ".repeat(100) + "\nA final line.",
        "Judge B complete body\n" + "B evidence. ".repeat(100) + "\napproved is ordinary worker text.",
      ]
      const release = yield* Deferred.make<void>()
      yield* fixture.llm.serve((request) => {
        if (request.model.id === "judge-api-A")
          return Stream.unwrap(
            Deferred.await(release).pipe(Effect.as(Stream.fromIterable(TestLLM.text(bodies[0], "judge-A")))),
          )
        if (request.model.id === "judge-api-B") return TestLLM.text(bodies[1], "judge-B")
        const consumed = request.messages
          .flatMap((message) => (message.role === "tool" ? message.content : []))
          .some((part) => part.type === "tool-result" && part.id === "mc08-j1-official")
        if (consumed)
          return TestLLM.text(
            "Consumed every exact Judge body and its actual source with no arbitration.",
            "judge-parent-final",
          )
        return TestLLM.tool("mc08-j1-official", TaskTool.name, input)
      })
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Compare the complete Workflow evidence with the specified Judge models.",
      })
      yield* awaitWithTimeout(fixture.llm.wait(3), "MC08 J1 did not start both actual models", "10 seconds")
      const delegations = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service
      const states = yield* delegations.list({ parentSessionID: fixture.root.id })
      const ready = states.find((state) =>
        [...(state?.participants.values() ?? [])].some(
          (participant) =>
            participant.executor &&
            !Model.Selection.isGroup(participant.executor.model) &&
            participant.executor.model.id === second.id,
        ),
      )
      const participant = [...(ready?.participants.values() ?? [])].find(
        (participant) =>
          participant.executor &&
          !Model.Selection.isGroup(participant.executor.model) &&
          participant.executor.model.id === second.id,
      )
      if (!participant?.childSessionID) return yield* Effect.die(new Error("Judge B actual child is missing"))
      const user = (yield* fixture.sessions.context(participant.childSessionID)).find(
        (message) => message.type === "user",
      )
      if (!user) return yield* Effect.die(new Error("Judge B actual input is missing"))
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(
        Object.assign({}, user.metadata?.delegation, { childSessionID: participant.childSessionID, inputID: user.id }),
      )
      expect(
        yield* awaitWithTimeout(execution.wait(receipt), "MC08 J1 completed sibling did not settle", "10 seconds"),
      ).toMatchObject({ status: "completed", text: bodies[1] })
      const tasks = yield* SessionTask.Service
      const admitted = yield* tasks.get(fixture.root.id)
      expect(admitted).toHaveLength(3)
      expect(admitted.find((task) => task.parentID === undefined)?.status).toBe("in_progress")
      const pending = yield* mc07Result(fixture, "mc08-j1-official")
      expect(pending.tool.state.status).toBe("running")
      expect(yield* fixture.llm.requests()).toHaveLength(3)
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC08 J1 parent did not settle", "10 seconds")
      const result = yield* mc07Consumed(fixture, "mc08-j1-official")
      expect(result.tool.state.status).toBe("completed")
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(result.text)
      expect(output.arbitration).toBe("none")
      expect(output.status).toBe("completed")
      expect(output.taskSettlement).toBe("updated")
      expect(output.input).toEqual({ text: input.prompt })
      const source = { type: "tool" as const, messageID: result.assistant.id, id: "mc08-j1-official" }
      expect(output.source).toEqual(source)
      expect(output.workers.map((worker) => worker.text)).toEqual(bodies)
      expect(output.workers.map((worker) => ({ provider: worker.runtime?.provider, id: worker.runtime?.id }))).toEqual([
        { provider: "judge-runtime", id: "judge-api-A" },
        { provider: "judge-runtime", id: "judge-api-B" },
      ])
      expect(
        output.workers.map((worker) =>
          Model.Selection.isGroup(worker.executor.model) ? undefined : worker.executor.model.id,
        ),
      ).toEqual([fixture.executorModel.id, second.id])
      expect(output.workers[0]?.requested).toMatchObject({ variant: Model.VariantID.make("review") })
      expect(output.workers[0]?.executor.model).toMatchObject({ variant: Model.VariantID.make("review") })
      const settled = yield* tasks.get(fixture.root.id)
      expect(settled.find((task) => task.id === output.parentTaskID)).toMatchObject({
        status: "completed",
        revision: 2,
      })
      for (const worker of output.workers) {
        const receipt = worker.receipt
        if (!receipt) return yield* Effect.die(new Error("Judge worker has no original receipt"))
        expect(settled.find((task) => task.id === worker.taskID)).toMatchObject({
          parentID: output.parentTaskID,
          status: "completed",
          revision: 2,
        })
        expect(worker.source).toEqual(source)
        const child = yield* fixture.sessions.get(receipt.childSessionID)
        expect(child.mode).toBe("work")
        expect(child.agent).toBe(Agent.ID.make("build"))
        expect(child.controller).toMatchObject({
          kind: "child",
          executor: worker.executor,
          source: { kind: "task", delegationID: receipt.delegationID, participantID: receipt.participantID },
        })
        const admitted = (yield* fixture.sessions.context(child.id)).find((message) => message.id === receipt.inputID)
        expect(admitted).toMatchObject({
          type: "user",
          text: input.prompt,
          metadata: { task: { parentTaskID: worker.taskID, parentTaskRevision: 1, background: false, source } },
        })
        expect(worker.completion).toMatchObject({
          model: worker.executor.model,
          finish: "stop",
          needsContinuation: false,
        })
        const state = yield* delegations.foldState(receipt.delegationID)
        expect(state?.participants.get(receipt.participantID)).toMatchObject({
          provider: "internal",
          role: "reviewer",
          context: "fresh",
          executor: worker.executor,
        })
        expect(state?.reviews).toEqual([])
      }
      expect(new Set(output.workers.map((worker) => worker.delegationID)).size).toBe(2)
      const requests = yield* fixture.llm.requests()
      expect(requests).toHaveLength(4)
      const children = requests.filter((request) => request.model.provider === "judge-runtime")
      expect(children.map((request) => String(request.model.id)).sort()).toEqual(["judge-api-A", "judge-api-B"])
      for (const request of children) {
        expect(output.workers.find((worker) => worker.runtime?.id === request.model.id)?.runtime).toEqual({
          provider: String(request.model.provider),
          id: String(request.model.id),
          route: request.model.route.id,
        })
        expect(
          request.messages.flatMap((message) =>
            message.role === "user" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [],
          ),
        ).toEqual([input.prompt])
      }
      const parents = requests.filter((request) => String(request.model.id) === fixture.metaModel.id)
      expect(parents).toHaveLength(2)
      const consumed = parents[1]?.messages
        .flatMap((message) => (message.role === "tool" ? message.content : []))
        .find((part) => part.type === "tool-result" && part.id === "mc08-j1-official")
      expect(consumed?.type === "tool-result" && consumed.result).toEqual({ type: "text", value: result.text })
      expect((yield* fixture.sessions.inbox(fixture.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
      expect((yield* fixture.sessions.get(fixture.root.id)).mode).toBe("work")
      expect((yield* fixture.sessions.get(fixture.root.id)).agent).toBe(Agent.ID.make("meta"))
      const evidencePath = process.env.AIGCFROGE_MC08_J1_EVIDENCE
      if (evidencePath)
        yield* Effect.promise(() =>
          Bun.write(
            evidencePath,
            JSON.stringify(
              { source, input, output, toolText: result.text, request: parents[1], requests, tasks: settled },
              null,
              2,
            ),
          ),
        )
      console.info(
        "MC08_J1_PARENT_CONSUMED",
        JSON.stringify({
          source,
          parentTaskID: output.parentTaskID,
          requests: requests.length,
          workers: output.workers.map((worker) => ({
            taskID: worker.taskID,
            runtime: worker.runtime,
            receipt: worker.receipt,
          })),
        }),
      )
    }),
)

effectTest.live("MC08 W2 ordinary Work Meta consumes a frozen Workflow through its real Task result", () =>
  Effect.gen(function* () {
    const fixture = yield* metaSetup(undefined, undefined, undefined, undefined, undefined, undefined, "work")
    expect(fixture.root.mode).toBe("work")
    const local = (yield* LocationServiceMap.Service).get(fixture.root.location)
    const compositions = yield* SessionComposition.Service
    const before = yield* compositions.read(fixture.root.id)
    const agent =
      "---\nkind: agent\nname: wf-coder\ndescription: Frozen workflow worker\nconfig: |\n  model: meta-keeper/keeper-worker\n  mode: subagent\n  permissions:\n    - { action: skill, resource: wf, effect: allow }\n    - { action: read, resource: frozen.txt, effect: allow }\n---\nFROZEN_WORKFLOW_SYSTEM\n"
    const skill = "---\nname: wf\ndescription: Frozen workflow skill\n---\nFROZEN_WORKFLOW_SKILL_BODY\n"
    const workflow = JSON.stringify({
      kind: "workflow",
      name: "mc08-w2",
      description: "Published serial workflow",
      version: "1",
      steps: [
        { id: "A", name: "A", agent: "wf-coder", input: { payload: "published A 🚀" }, next: "B" },
        { id: "B", name: "B", agent: "wf-coder", input: { payload: "published B" }, next: "END" },
      ],
    })
    yield* Effect.promise(() => Bun.write(`${fixture.root.location.directory}/.aigcfroge/agents/wf-coder.md`, agent))
    yield* Effect.promise(() =>
      Bun.write(`${fixture.root.location.directory}/.aigcfroge/workflows/mc08-w2.yaml`, workflow),
    )
    yield* Effect.promise(() => Bun.write(`${fixture.root.location.directory}/.aigcfroge/skills/wf/SKILL.md`, skill))
    yield* AgentAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    yield* WorkflowAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    yield* SkillAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const input = {
      description: "Run published serial workflow",
      prompt: "Task prose must not replace the published StepInput.",
      workflow: {
        source: "temporary",
        agents: [
          { kind: "agent", relativePath: "wf-coder.md", revision: createHash("sha256").update(agent).digest("hex") },
        ],
        workflow: {
          kind: "workflow",
          relativePath: "mc08-w2.yaml",
          revision: createHash("sha256").update(workflow).digest("hex"),
        },
        bindings: {
          "agents/wf-coder": {
            prompts: [],
            skills: [
              {
                kind: "skill",
                relativePath: "wf/SKILL.md",
                revision: createHash("sha256").update(skill).digest("hex"),
              },
            ],
          },
        },
        presentation: "native",
        requestedCapabilities: [],
      },
    }
    const outputs = ["Exact A body: α 🚀", "Exact B body: final answer β"]
    const release = yield* Deferred.make<void>()
    yield* fixture.llm.push(
      TestLLM.tool("mc08-w2-workflow", TaskTool.name, input),
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.tool("mc08-w2-skill", "skill", { id: "wf" }))),
        ),
      ),
      TestLLM.text(outputs[0], "mc08-w2-A"),
      TestLLM.text(outputs[1], "mc08-w2-B"),
      TestLLM.text("Consumed the exact workflow Tool result.", "mc08-w2-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Execute the selected published workflow." })
    yield* awaitWithTimeout(fixture.llm.wait(2), "MC08 W2 Task did not execute", "10 seconds")
    const admitted = yield* WorkflowRun.Service.use((runs) => runs.getBySession(fixture.root.id))
    if (!admitted) {
      const result = yield* mc07Result(fixture, "mc08-w2-workflow")
      return yield* Effect.die(
        new Error(`MC08 W2 admission is missing in ${fixture.root.mode}: ${JSON.stringify(result.tool.state)}`),
      )
    }
    const first = (yield* WorkflowRun.Service.use((runs) => runs.getSteps(admitted.id)))[0]
    if (!first?.childSessionId) return yield* Effect.die(new Error("MC08 W2 first child is missing"))
    const firstChild = yield* fixture.sessions.get(Session.ID.make(first.childSessionId))
    yield* fixture.sessions.setPermissions({ sessionID: firstChild.id, permissions: [] })
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) =>
        editor.update(Agent.ID.make("wf-coder"), (live) => {
          live.system = "LIVE_CHANGED_WORKFLOW_SYSTEM"
          live.model = fixture.metaModel
          live.permissions = [
            { action: "skill", resource: "wf", effect: "deny" },
            { action: "read", resource: "frozen.txt", effect: "deny" },
          ]
        }),
      ),
    ).pipe(Effect.provide(local))
    yield* Effect.promise(() =>
      Bun.write(
        `${fixture.root.location.directory}/.aigcfroge/skills/wf/SKILL.md`,
        "---\nname: wf\ndescription: Changed skill\n---\nLIVE_CHANGED_WORKFLOW_SKILL_BODY\n",
      ),
    )
    yield* SkillAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    yield* Skill.Service.use((skills) =>
      skills.transform((editor) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("wf"),
            name: Skill.Name.make("wf"),
            path: AbsolutePath.make(`${fixture.root.location.directory}/.aigcfroge/skills/wf/SKILL.md`),
            content: "LIVE_CHANGED_WORKFLOW_SKILL_BODY",
          }),
        ),
      ),
    ).pipe(Effect.provide(local))
    const permission = yield* Permission.Service.pipe(Effect.provide(local))
    expect(
      (yield* permission.effectiveRules(firstChild.id, firstChild.agent)).findLast(
        (rule) => rule.action === "skill" && rule.resource === "wf",
      ),
    ).toMatchObject({ effect: "allow" })
    yield* Deferred.succeed(release, undefined)
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC08 W2 parent did not settle", "10 seconds")
    const result = yield* mc07Result(fixture, "mc08-w2-workflow")
    console.info("MC08_W2_TASK_STATE", JSON.stringify(result.tool.state))
    expect(result.tool.state.status).toBe("completed")
    if (result.tool.state.status !== "completed")
      return yield* Effect.die(new Error(`MC08 W2 Task failed: ${JSON.stringify(result.tool.state)}`))
    const text = result.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    expect(Array.from(text).length).toBeLessThanOrEqual(12_000)
    const payload = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
      JSON.parse(text.slice("<workflow_result>\n".length, -"\n</workflow_result>".length)),
    )
    const steps = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(payload.steps)
    expect(payload.status).toBe("completed")
    expect(payload.quality).toBe("complete")
    expect(payload.omittedSteps).toBe(0)
    expect(steps.map((step) => step.detail)).toEqual(outputs)
    const source = { type: "tool", messageID: result.assistant.id, id: "mc08-w2-workflow" }
    expect(payload.source).toEqual(source)
    const run = yield* WorkflowRun.Service.use((runs) => runs.getBySession(fixture.root.id))
    if (!run) return yield* Effect.die(new Error("MC08 W2 owning run is missing"))
    expect(payload.runID).toBe(run.id)
    const database = yield* Database.Service
    const row = yield* database.db
      .select()
      .from(WorkflowRunTable)
      .where(eq(WorkflowRunTable.id, run.id))
      .get()
      .pipe(Effect.orDie)
    const frozen = Schema.decodeUnknownSync(Schema.fromJsonString(Composition.SnapshotV2))(row?.frozen_snapshot)
    const binding = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
      row?.task_binding,
    )
    expect(binding).toMatchObject({ parentTaskID: payload.parentTaskID, parentTaskRevision: 1, source })
    expect(frozen.data.workflow?.steps.map((step) => step.input)).toEqual([
      { payload: "published A 🚀" },
      { payload: "published B" },
    ])
    const tasks = yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))
    expect(tasks.find((task) => task.id === payload.parentTaskID)).toMatchObject({ status: "completed", revision: 2 })
    const children = (yield* WorkflowRun.Service.use((runs) => runs.getSteps(run.id))).map(
      (step) => step.childSessionId,
    )
    for (const childID of children) {
      if (!childID) return yield* Effect.die(new Error("MC08 W2 child is missing"))
      const child = yield* fixture.sessions.get(Session.ID.make(childID))
      expect(child.mode).toBe("work")
      expect(child.controller).toMatchObject({ kind: "child", source: { kind: "workflow", runID: run.id } })
      expect((yield* compositions.get(child.id)).data).toEqual(frozen.data)
      if (child.controller?.kind !== "child")
        return yield* Effect.die(new Error("MC08 W2 real child controller is missing"))
      const create = {
        id: child.id,
        parentID: fixture.root.id,
        agent: child.agent,
        model: child.controller.executor.model,
        executor: child.controller.executor,
        source: child.controller.source,
        metadata: child.metadata,
        frozenSnapshot: frozen,
      }
      expect((yield* fixture.sessions.create(create)).id).toBe(child.id)
      expect(yield* fixture.sessions.create({ ...create, model: fixture.metaModel }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.ControllerConflictError",
        kind: "meta_binding_conflict",
      })
      expect(
        yield* fixture.sessions
          .create({
            ...create,
            frozenSnapshot: new Composition.SnapshotV2({
              ...frozen,
              data: new Composition.SnapshotDataV2({
                ...frozen.data,
                instructions: [new Composition.Instruction({ source: "changed", content: "changed" })],
              }),
            }),
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.CompositionConflictError", reason: "inherited_snapshot_mismatch" })
      const metas = yield* MetaAgentService.Service
      yield* metas.assertOwner(child)
      expect(
        yield* metas
          .assertChildSource(
            fixture.root,
            Session.ID.make("ses_wrong_child"),
            child.controller.executor,
            child.controller.source,
            child.metadata,
            true,
          )
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_child_source_invalid" })
      expect(
        yield* metas
          .assertChildSource(
            fixture.root,
            child.id,
            child.controller.executor,
            child.controller.source,
            { ...child.metadata, workflowInputID: "msg_wrong_input" },
            true,
          )
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_child_source_invalid" })
    }
    expect((yield* fixture.sessions.get(fixture.root.id)).mode).toBe("work")
    expect((yield* fixture.sessions.get(fixture.root.id)).agent).toBe(fixture.root.agent)
    expect(yield* compositions.read(fixture.root.id)).toEqual(before)
    expect((yield* fixture.sessions.inbox(fixture.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    const requests = yield* fixture.llm.requests()
    expect(requests).toHaveLength(5)
    for (const [index, request] of requests.slice(1, 4).entries()) {
      expect(request.model).toMatchObject({ id: fixture.executorModel.id, provider: fixture.executorModel.providerID })
      expect(JSON.stringify(request.system)).toContain("FROZEN_WORKFLOW_SYSTEM")
      const user = request.messages
        .flatMap((message) =>
          message.role === "user" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [],
        )
        .join("\n")
      expect(user).toContain(index < 2 ? "published A 🚀" : "published B")
      expect(user).not.toContain(input.prompt)
    }
    const skillResult = requests[2]?.messages
      .flatMap((message) => (message.role === "tool" ? message.content : []))
      .find((part) => part.type === "tool-result" && part.id === "mc08-w2-skill")
    expect(JSON.stringify(skillResult)).toContain("FROZEN_WORKFLOW_SKILL_BODY")
    expect(JSON.stringify(skillResult)).not.toContain("LIVE_CHANGED_WORKFLOW_SKILL_BODY")
    const consumed = requests
      .at(-1)
      ?.messages.flatMap((message) => (message.role === "tool" ? message.content : []))
      .find((part) => part.type === "tool-result" && part.id === "mc08-w2-workflow")
    expect(consumed?.type === "tool-result" && consumed.result).toEqual({ type: "text", value: text })
    expect(
      requests
        .at(-1)
        ?.messages.filter((message) => message.role === "user")
        .flatMap((message) => message.content)
        .some((part) => part.type === "text" && part.text.startsWith("<workflow_result>")),
    ).toBe(false)
    console.info("MC08_W2_PARENT", JSON.stringify({ callID: "mc08-w2-workflow", source, binding, text, consumed }))
    const registry = yield* Tool.Service.pipe(Effect.provide(local))
    const beforeRetryTasks = yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))
    yield* Effect.promise(() => Bun.file(`${fixture.root.location.directory}/.aigcfroge/agents/wf-coder.md`).delete())
    yield* Effect.promise(() =>
      Bun.file(`${fixture.root.location.directory}/.aigcfroge/workflows/mc08-w2.yaml`).delete(),
    )
    yield* AgentAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    yield* WorkflowAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(local))
    const retryCall = {
      sessionID: fixture.root.id,
      agent: Agent.ID.make("meta"),
      messageID: result.assistant.id,
      call: {
        type: "tool-call" as const,
        id: "mc08-w2-workflow",
        name: TaskTool.name,
        input: { ...input, expectedPlanDigest: frozen.digest },
      },
    }
    const retried = yield* executeTool(registry, retryCall)
    expect(retried.status).toBe("completed")
    expect(retried.content).toEqual(result.tool.state.content)
    expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toEqual(beforeRetryTasks)
    expect((yield* fixture.llm.requests()).length).toBe(5)
    expect(
      (yield* executeTool(registry, {
        ...retryCall,
        call: { ...retryCall.call, input: { ...input, parent_task_id: "tsk_foreign" } },
      })).status,
    ).toBe("error")
    expect(
      (yield* executeTool(registry, {
        ...retryCall,
        call: { ...retryCall.call, input: { ...input, expectedPlanDigest: "f".repeat(64) } },
      })).status,
    ).toBe("error")
    expect(
      (yield* executeTool(registry, { ...retryCall, call: { ...retryCall.call, id: "mc08-w2-new-call" } })).status,
    ).toBe("error")
    expect(yield* SessionTask.Service.use((tasks) => tasks.get(fixture.root.id))).toEqual(beforeRetryTasks)
    expect((yield* fixture.llm.requests()).length).toBe(5)
  }),
)

const mc07Diff =
  "diff --git a/artifact.txt b/artifact.txt\n" +
  "index df967b96a579e45a18b8251732d16804b2e56a55..230c401cfd8f8bfffcaded578b08c2985de11ff6 100644\n" +
  "--- a/artifact.txt\n+++ b/artifact.txt\n@@ -1 +1,2 @@\n base\n+r1\n"

const mc07R2Diff =
  "diff --git a/artifact.txt b/artifact.txt\n" +
  "index df967b96a579e45a18b8251732d16804b2e56a55..6ad37cfcfbe716e040dabef482c3b1b82bf6575f 100644\n" +
  "--- a/artifact.txt\n+++ b/artifact.txt\n@@ -1 +1,3 @@\n base\n+r1\n+r2\n"

const mc07Result = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof metaSetup>>, callID: string) {
  const messages = yield* fixture.sessions.context(fixture.root.id)
  const assistant = messages.find(
    (message): message is SessionMessage.Assistant =>
      message.type === "assistant" && message.content.some((part) => part.type === "tool" && part.id === callID),
  )
  const tool = assistant?.content.find(
    (part): part is SessionMessage.AssistantTool => part.type === "tool" && part.id === callID,
  )
  if (!assistant || !tool) return yield* Effect.die(new Error(`MC07 Task result is missing: ${callID}`))
  return { assistant, tool }
})

const mc07Consumed = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof metaSetup>>,
  callID: string,
) {
  const result = yield* mc07Result(fixture, callID)
  if (result.tool.state.status !== "completed" && result.tool.state.status !== "error")
    return yield* Effect.die(new Error("Task has no terminal model result"))
  const text = result.tool.state.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
  const consumed = (yield* fixture.llm.requests())
    .flatMap((request) => request.messages)
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .findLast((part) => part.type === "tool-result" && part.id === callID)
  expect(consumed?.type === "tool-result" && consumed.result).toEqual(
    result.tool.state.status === "error"
      ? { type: "error", value: { error: result.tool.state.error, content: result.tool.state.content ?? [] } }
      : { type: "text", value: text },
  )
  return { ...result, text }
})

const mc07Build = Effect.fnUntraced(function* (
  artifactPath = "artifact.txt",
  locationPath = "",
  external = false,
  existing?: Effect.Success<ReturnType<typeof metaSetup>>,
) {
  const fixture =
    existing ??
    (yield* metaSetup(
      Agent.ID.make("keeper-worker"),
      external,
      Agent.ID.make("meta"),
      "app-server",
      locationPath ? `${locationPath}/${artifactPath}` : artifactPath,
      locationPath,
    ))
  yield* fixture.sessions.setPermissions({
    sessionID: fixture.root.id,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  yield* fixture.llm.push(
    TestLLM.tool("mc07-implement", TaskTool.name, {
      description: "Produce one tracked artifact",
      prompt: "Write the requested tracked file and finish.",
      subagent_type: fixture.worker,
      artifact_path: artifactPath,
    }),
    TestLLM.tool("mc07-write", "write", { path: artifactPath, content: "base\nr1\n" }),
    TestLLM.text("R1 artifact is ready.", "mc07-implement-answer"),
    TestLLM.text("Received the R1 artifact.", "mc07-parent-artifact"),
  )
  yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Produce the finite tracked artifact." })
  yield* awaitWithTimeout(fixture.llm.wait(4), "MC07 implementer did not complete", "10 seconds")
  yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 parent did not consume R1", "10 seconds")
  const result = yield* mc07Result(fixture, "mc07-implement")
  expect(result.tool.state.status).toBe("completed")
  if (result.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 implementer failed"))
  const visible = external ? yield* mc07Consumed(fixture, "mc07-implement") : undefined
  const governance = visible
    ? Schema.decodeUnknownSync(Schema.fromJsonString(DelegationService.Governance))(
        visible.text.match(/<task_governance>([\s\S]*?)<\/task_governance>/)?.[1],
      )
    : undefined
  const receipt =
    governance?.kind === "revision"
      ? governance.receipt
      : Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
  const delegations = yield* DelegationService.Service
  const state = yield* delegations.foldState(receipt.delegationID)
  expect(state?.revisions).toHaveLength(1)
  const digest = state?.delegation.latestRevisionDigest
  if (!digest) return yield* Effect.die(new Error("MC07 real Task did not produce R1"))
  if (external) expect(governance).toMatchObject({ kind: "revision", receipt, artifact: { revisionDigest: digest } })
  return { ...fixture, receipt, digest, result, delegations }
})

const mc07Review = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof mc07Build>>,
  callID: string,
  verdict: Delegation.ReviewVerdict,
  digest = fixture.digest,
  childSessionID?: Session.ID,
) {
  const count = (yield* fixture.llm.requests()).length
  yield* fixture.llm.push(
    TestLLM.tool(callID, TaskTool.name, {
      description: "Review the bound artifact",
      prompt: "Review the bound artifact and return the current typed verdict.",
      subagent_type: fixture.worker,
      delegation_id: fixture.receipt.delegationID,
      ...(childSessionID ? { task_id: childSessionID } : {}),
      intent: "review",
      revision_digest: digest,
    }),
    TestLLM.text(
      `<review>${JSON.stringify({
        kind: "aigcfroge.review.v1",
        reviewed_revision_digest: digest,
        verdict,
        findings: [],
        summary: `Current verdict: ${verdict}.`,
      })}</review>`,
      `${callID}-child`,
    ),
    TestLLM.text(`Consumed ${verdict}.`, `${callID}-parent`),
  )
  yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review the current artifact." })
  yield* awaitWithTimeout(fixture.llm.wait(count + 3), "MC07 review did not reach its parent")
  yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 review did not settle")
  const reviewed = yield* mc07Result(fixture, callID)
  expect(reviewed.tool.state.status).toBe("completed")
  if (reviewed.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 review failed"))
  return { ...reviewed, receipt: Schema.decodeUnknownSync(Delegation.Receipt)(reviewed.tool.state.metadata?.receipt) }
})

effectTest.live(
  "MC07 no_code_change records a real empty commit and consumes inherited approval through complete",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const original = yield* fixture.delegations.revision({
        delegationID: fixture.receipt.delegationID,
        revisionDigest: fixture.digest,
      })
      if (!original.artifact) return yield* Effect.die(new Error("MC07 no_code_change R1 evidence is missing"))
      const artifact = original.artifact
      const directory = fixture.root.location.directory
      const beforeGit = yield* Effect.promise(async () => ({
        head: (await $`git rev-parse HEAD`.cwd(directory).quiet().text()).trim(),
        tree: (await $`git show -s --format=%T HEAD`.cwd(directory).quiet().text()).trim(),
        blob: await $`git ls-tree -z HEAD -- artifact.txt`.cwd(directory).quiet().text(),
        index: await $`git ls-files --stage -z -- artifact.txt`.cwd(directory).quiet().text(),
        status: await $`git status --porcelain=v1 -- artifact.txt`.cwd(directory).quiet().text(),
      }))
      expect(beforeGit.head).toBe(artifact.commitSha)
      expect(beforeGit.blob).toMatch(/^100644 blob [0-9a-f]+\tartifact\.txt\0$/)
      expect(beforeGit.index).toBe(beforeGit.blob.replace("blob ", "").replace("\t", " 0\t"))
      expect(beforeGit.status).toBe(" M artifact.txt\n")
      const reviewed = yield* mc07Review(fixture, "mc07-ncc-approve", "approved")
      const before = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      if (!before) return yield* Effect.die(new Error("MC07 no_code_change approved aggregate is missing"))
      expect(before.reviews).toHaveLength(1)
      expect(before.reviews[0]).toMatchObject({ reviewedRevisionDigest: fixture.digest, verdict: "approved" })
      const count = (yield* fixture.llm.requests()).length
      const command =
        "git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m mc07-no-code-change"
      yield* fixture.llm.push(
        TestLLM.tool("mc07-ncc-commit", TaskTool.name, {
          description: "Create the next empty commit",
          prompt: "Execute the one authorized empty commit and keep artifact.txt unchanged and unstaged.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          participant_id: fixture.receipt.participantID,
          task_id: fixture.receipt.childSessionID,
          command: "append",
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-ncc-shell", "shell", { command, workdir: directory }),
        TestLLM.text("The single empty commit completed.", "mc07-ncc-commit-child"),
        TestLLM.text("Consumed the new revision.", "mc07-ncc-commit-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Create and capture the same child's empty commit.",
      })
      yield* fixture.runs.awaitIdle(fixture.root.id)
      expect((yield* fixture.llm.requests()).length).toBeGreaterThanOrEqual(count + 4)
      const produced = yield* mc07Result(fixture, "mc07-ncc-commit")
      expect(produced.tool.state.status).toBe("completed")
      if (produced.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 no_code_change Task failed"))
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(produced.tool.state.metadata?.receipt)
      const childMessages = yield* fixture.sessions.context(receipt.childSessionID)
      const shellAssistant = childMessages.find(
        (message): message is SessionMessage.Assistant =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "tool" && part.id === "mc07-ncc-shell"),
      )
      const shell = shellAssistant?.content.find(
        (part): part is SessionMessage.AssistantTool => part.type === "tool" && part.id === "mc07-ncc-shell",
      )
      expect(shell?.state.status).toBe("completed")
      if (shell?.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 no_code_change shell did not complete"))
      expect(shell.state.metadata?.exit).toBe(0)
      expect(shell.state.input).toEqual({ command, workdir: directory })
      const afterGit = yield* Effect.promise(async () => {
        const head = (await $`git rev-parse HEAD`.cwd(directory).quiet().text()).trim()
        return {
          head,
          parents: (await $`git show -s --format=%P ${head}`.cwd(directory).quiet().text()).trim().split(" "),
          tree: (await $`git show -s --format=%T ${head}`.cwd(directory).quiet().text()).trim(),
          blob: await $`git ls-tree -z ${head} -- artifact.txt`.cwd(directory).quiet().text(),
          index: await $`git ls-files --stage -z -- artifact.txt`.cwd(directory).quiet().text(),
          status: await $`git status --porcelain=v1 -- artifact.txt`.cwd(directory).quiet().text(),
          targetSha256: createHash("sha256")
            .update(Buffer.from(await Bun.file(`${directory}/artifact.txt`).arrayBuffer()))
            .digest("hex"),
          normalizedDiff:
            await $`git -c core.quotepath=false -c core.autocrlf=false --literal-pathspecs diff --no-ext-diff --no-textconv --no-renames --no-color --src-prefix=a/ --dst-prefix=b/ --full-index --unified=2147483647 ${head} -- artifact.txt`
              .cwd(directory)
              .quiet()
              .text(),
        }
      })
      expect(afterGit.head).not.toBe(beforeGit.head)
      expect(afterGit.parents).toEqual([beforeGit.head])
      expect(afterGit.tree).toBe(beforeGit.tree)
      expect(afterGit.blob).toBe(beforeGit.blob)
      expect(afterGit.index).toBe(beforeGit.index)
      expect(afterGit.status).toBe(beforeGit.status)
      expect(afterGit.targetSha256).toBe(artifact.targetSha256)
      expect(afterGit.normalizedDiff).toBe(artifact.normalizedDiff)
      const state = yield* fixture.delegations.foldState(receipt.delegationID)
      console.log(
        "MC07 no_code_change Git evidence",
        JSON.stringify({
          revisions: state?.revisions,
          reviews: state?.reviews,
          before: beforeGit,
          after: afterGit,
          shell: {
            source: { type: "tool", messageID: shellAssistant?.id, id: shell.id },
            input: shell.state.input,
            state: shell.state,
          },
          task: {
            receipt,
            source: { type: "tool", messageID: produced.assistant.id, id: "mc07-ncc-commit" },
            state: produced.tool.state,
          },
        }),
      )
      expect(produced.tool.state.metadata?.status).toBe("completed")
      const governance = Schema.decodeUnknownSync(DelegationService.Governance)(
        produced.tool.state.metadata?.governance,
      )
      expect(governance).toMatchObject({ kind: "revision", receipt })
      if (governance.kind !== "revision" || !("artifact" in governance))
        return yield* Effect.die(new Error("MC07 no_code_change capture is missing"))
      const digest = governance.artifact.revisionDigest
      expect(digest).not.toBe(fixture.digest)
      expect(governance).toMatchObject({
        source: { type: "tool", messageID: produced.assistant.id, id: "mc07-ncc-commit" },
        artifact: {
          ...artifact,
          commitSha: afterGit.head,
          revisionDigest: digest,
          changeKind: "no_code_change",
        },
      })
      expect("producer" in governance && governance.producer).toBeFalsy()
      expect(receipt.delegationID).toBe(fixture.receipt.delegationID)
      expect(receipt.childSessionID).toBe(fixture.receipt.childSessionID)
      expect(receipt.participantID).toBe(fixture.receipt.participantID)
      expect(receipt.inputID).not.toBe(fixture.receipt.inputID)
      expect(receipt.turnID).not.toBe(fixture.receipt.turnID)
      const inputs = childMessages.filter((message): message is SessionMessage.User => message.type === "user")
      expect(inputs.map((input) => input.id)).toEqual([fixture.receipt.inputID, receipt.inputID])
      const link = Schema.decodeUnknownSync(
        Schema.Struct({ source: Permission.Source, artifact: DelegationExecution.ArtifactBaseline }),
      )(inputs.find((input) => input.id === receipt.inputID)?.metadata?.task)
      expect(link.source).toEqual(governance.source)
      expect(link.artifact.previous).toEqual(original)
      expect(link.artifact.commitSha).toBe(beforeGit.head)
      expect(beforeGit.blob).toBe(`100644 blob ${link.artifact.blob}\tartifact.txt\0`)
      expect(link.artifact.baseSha256).toBe(artifact.baseSha256)
      const current = yield* fixture.delegations.revision({
        delegationID: receipt.delegationID,
        revisionDigest: digest,
      })
      expect(current).toEqual(
        new DelegationService.RevisionReference({
          receipt,
          source: governance.source,
          path: original.path,
          revisionDigest: digest,
          artifact: governance.artifact,
        }),
      )
      expect(
        yield* fixture.delegations.revision({ delegationID: receipt.delegationID, revisionDigest: fixture.digest }),
      ).toEqual(original)
      if (!state) return yield* Effect.die(new Error("MC07 no_code_change aggregate is missing"))
      expect(state.revisions.map((revision) => revision.revisionDigest)).toEqual([fixture.digest, digest])
      expect(state.revisions[1]?.changeKind).toBe("no_code_change")
      expect(state.reviews).toEqual(before.reviews)
      const barrier = {
        participants: [...state.participants.values()],
        reviews: state.reviews,
        revisions: state.revisions,
        latestRevisionDigest: state.delegation.latestRevisionDigest,
        rejectionBlocked: state.delegation.rejectionBlocked,
        turns: [...state.turns.values()],
        deliveries: [...state.deliveries.values()],
      }
      expect(DelegationReview.evaluateReviewBarrier(barrier).passed).toBe(true)
      expect(DelegationReview.canComplete(barrier)).toBe(true)
      const bus = yield* Bus.Service
      const revisionEvents = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter(
          (item): item is Event.Payload<typeof DelegationEvent.RevisionRecorded> =>
            !Bus.isSynced(item) && item.type === DelegationEvent.RevisionRecorded.type,
        ),
        Stream.runCollect,
      )
      expect(revisionEvents).toHaveLength(2)
      expect(Schema.decodeUnknownSync(DelegationEvent.RevisionRecordedData)(revisionEvents[1]?.data)).toMatchObject({
        delegationID: receipt.delegationID,
        turnID: receipt.turnID,
        participantID: receipt.participantID,
        revisionDigest: digest,
        commitSha: afterGit.head,
        changeKind: "no_code_change",
        diffSummary: artifact.normalizedDiff,
      })
      const locations = yield* LocationServiceMap.Service
      const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ location: fixture.root.location, custom: false })
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "task_close", resource: receipt.delegationID, effect: "ask" },
          { action: "task_archive", resource: receipt.delegationID, effect: "ask" },
        ],
      })
      const closeAsked = yield* Deferred.make<Permission.Request>()
      const archiveAsked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
        if (request.source?.type !== "tool" || request.source.id !== "mc07-ncc-complete") return Effect.void
        if (request.action === "task_close") return Deferred.succeed(closeAsked, request).pipe(Effect.asVoid)
        if (request.action === "task_archive") return Deferred.succeed(archiveAsked, request).pipe(Effect.asVoid)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const beforeComplete = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter((event) => !Bus.isSynced(event)),
        Stream.runCollect,
      )
      const beforeCompleteCount = (yield* fixture.llm.requests()).length
      yield* fixture.llm.push(
        TestLLM.tool("mc07-ncc-complete", TaskTool.name, {
          description: "Complete the inherited approval",
          prompt: "Complete and archive the actual no_code_change revision.",
          subagent_type: fixture.worker,
          delegation_id: receipt.delegationID,
          command: "complete",
        }),
        TestLLM.text("Consumed the complete persistent result.", "mc07-ncc-complete-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Complete the inherited approved revision." })
      const close = yield* awaitWithTimeout(
        Deferred.await(closeAsked),
        "MC07 no_code_change complete did not ask task_close",
      )
      const completeCall = yield* mc07Result(fixture, "mc07-ncc-complete")
      expect(close).toMatchObject({
        action: "task_close",
        resources: [receipt.delegationID],
        sessionID: fixture.root.id,
        source: { type: "tool", messageID: completeCall.assistant.id, id: "mc07-ncc-complete" },
      })
      yield* permission.reply({ requestID: close.id, reply: "once" })
      const archive = yield* awaitWithTimeout(
        Deferred.await(archiveAsked),
        "MC07 no_code_change complete did not ask task_archive",
      )
      expect(archive).toMatchObject({
        action: "task_archive",
        resources: close.resources,
        sessionID: close.sessionID,
        source: close.source,
      })
      expect(archive.id).not.toBe(close.id)
      expect(
        yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
          Stream.filter((event) => !Bus.isSynced(event)),
          Stream.runCollect,
        ),
      ).toEqual(beforeComplete)
      yield* permission.reply({ requestID: archive.id, reply: "once" })
      yield* fixture.runs.awaitIdle(fixture.root.id)
      expect((yield* fixture.llm.requests()).length).toBeGreaterThanOrEqual(beforeCompleteCount + 2)
      const completed = yield* mc07Result(fixture, "mc07-ncc-complete")
      expect(completed.tool.state.status).toBe("completed")
      if (completed.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 no_code_change complete failed"))
      expect(completed.tool.state.metadata?.status).toBe("completed")
      const final = yield* fixture.delegations.foldState(receipt.delegationID)
      if (!final) return yield* Effect.die(new Error("MC07 no_code_change completed aggregate is missing"))
      expect(final.delegation.status).toBe("archived")
      expect(final.archivedFrom).toBe("completed")
      expect(final.delegation.latestRevisionDigest).toBe(digest)
      expect(final.reviews).toEqual(before.reviews)
      expect(final.revisions).toEqual(state.revisions)
      expect([...final.participants.values()].every((participant) => participant.phase === "closed")).toBe(true)
      expect(yield* fixture.sessions.inbox(receipt.childSessionID)).toEqual([])
      expect(yield* fixture.runs.isActive(receipt.childSessionID)).toBe(false)
      const full = completed.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
      const summary = /<task_result>\n([\s\S]+)\n<\/task_result>/.exec(full)
      if (!summary?.[1]) return yield* Effect.die(new Error("MC07 no_code_change completion summary is missing"))
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(summary[1])).toEqual({
        command: "complete",
        source: close.source,
        delegation: Schema.encodeSync(Schema.toCodecJson(Delegation.Info))(final.delegation),
        archivedFrom: "completed",
        latestRevisionDigest: digest,
        reviewBarrier: DelegationReview.evaluateReviewBarrier(barrier),
        canComplete: true,
      })
      const requests = yield* fixture.llm.requests()
      for (const item of [
        { callID: "mc07-implement", result: fixture.result },
        { callID: "mc07-ncc-approve", result: reviewed },
        { callID: "mc07-ncc-commit", result: produced },
        { callID: "mc07-ncc-complete", result: completed },
      ]) {
        if (item.result.tool.state.status !== "completed")
          return yield* Effect.die(new Error("MC07 no_code_change consumed Task failed"))
        const consumed = requests
          .find(
            (request) =>
              request.model.id.toString() === fixture.metaModel.id.toString() &&
              request.messages
                .flatMap((message) => message.content)
                .some((part) => part.type === "tool-result" && part.id === item.callID),
          )
          ?.messages.flatMap((message) => message.content)
          .find((part) => part.type === "tool-result" && part.id === item.callID)
        if (consumed?.type !== "tool-result" || consumed.result.type !== "text")
          return yield* Effect.die(new Error(`MC07 no_code_change parent did not consume ${item.callID}`))
        expect(consumed.result.value).toBe(
          item.result.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
      }
      const events = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter(
          (item): item is Event.Payload<Event.DurableDefinition> => !Bus.isSynced(item) && item.durable !== undefined,
        ),
        Stream.runCollect,
      )
      expect(events.filter((event) => event.type === DelegationEvent.RevisionRecorded.type)).toHaveLength(2)
      const approvals = events.filter((event) => event.type === DelegationEvent.ReviewApproved.type)
      expect(approvals).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationEvent.ReviewApprovedData)(approvals[0]?.data)).toMatchObject({
        participantID: reviewed.receipt.participantID,
        reviewedRevisionDigest: fixture.digest,
      })
      const lifecycle = events.map((event) => event.type)
      expect(lifecycle.indexOf(DelegationEvent.Completed.type)).toBeGreaterThan(
        lifecycle.indexOf(DelegationEvent.Closing.type),
      )
      expect(lifecycle.indexOf(DelegationEvent.Archived.type)).toBeGreaterThan(
        lifecycle.indexOf(DelegationEvent.Completed.type),
      )
      console.log(
        "MC07 no_code_change completion evidence",
        JSON.stringify({
          revisions: final.revisions,
          reviews: final.reviews,
          archive: final.delegation,
          archivedFrom: final.archivedFrom,
          permissions: [close, archive].map((request) => ({
            action: request.action,
            source: request.source,
            resources: request.resources,
            sessionID: request.sessionID,
          })),
          lifecycle: events
            .filter((event) =>
              [
                DelegationEvent.Closing.type,
                DelegationEvent.ParticipantClosed.type,
                DelegationEvent.Completed.type,
                DelegationEvent.Archived.type,
              ].some((type) => type === event.type),
            )
            .map((event) => ({ type: event.type, seq: event.durable.seq })),
          consumedComplete: full,
        }),
      )
    }),
  30_000,
)

effectTest.live(
  "MC07 no_code_change refuses a real empty commit without a trusted previous revision",
  () =>
    Effect.gen(function* () {
      const fixture = yield* metaSetup(
        Agent.ID.make("keeper-worker"),
        false,
        Agent.ID.make("meta"),
        "app-server",
        "artifact.txt",
      )
      const directory = fixture.root.location.directory
      const head = yield* Effect.promise(() =>
        $`git rev-parse HEAD`
          .cwd(directory)
          .quiet()
          .text()
          .then((text) => text.trim()),
      )
      const tree = yield* Effect.promise(() =>
        $`git show -s --format=%T HEAD`
          .cwd(directory)
          .quiet()
          .text()
          .then((text) => text.trim()),
      )
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const command =
        "git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m mc07-no-code-change"
      yield* fixture.llm.push(
        TestLLM.tool("mc07-ncc-no-previous", TaskTool.name, {
          description: "Attempt an unapproved empty commit",
          prompt: "Execute the one private empty commit and leave artifact.txt unchanged.",
          subagent_type: fixture.worker,
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-ncc-no-previous-shell", "shell", { command, workdir: directory }),
        TestLLM.text("The private empty commit completed.", "mc07-ncc-no-previous-child"),
        TestLLM.text("Consumed the missing-previous refusal.", "mc07-ncc-no-previous-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Attempt the empty commit without an accepted predecessor.",
      })
      yield* awaitWithTimeout(
        fixture.llm.wait(4),
        "MC07 no_code_change missing-previous Task did not reach its parent",
        "10 seconds",
      )
      yield* awaitWithTimeout(
        fixture.runs.awaitIdle(fixture.root.id),
        "MC07 no_code_change missing-previous Task did not settle",
        "10 seconds",
      )
      const result = yield* mc07Result(fixture, "mc07-ncc-no-previous")
      expect(result.tool.state.status).toBe("completed")
      if (result.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 no_code_change missing-previous Task failed"))
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
      const shell = (yield* fixture.sessions.context(receipt.childSessionID))
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find(
          (part): part is SessionMessage.AssistantTool =>
            part.type === "tool" && part.id === "mc07-ncc-no-previous-shell",
        )
      expect(shell?.state.status).toBe("completed")
      if (shell?.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 no_code_change missing-previous shell failed"))
      expect(shell.state.metadata?.exit).toBe(0)
      expect(shell.state.input).toEqual({ command, workdir: directory })
      const current = yield* Effect.promise(async () => ({
        head: (await $`git rev-parse HEAD`.cwd(directory).quiet().text()).trim(),
        parents: (await $`git show -s --format=%P HEAD`.cwd(directory).quiet().text()).trim().split(" "),
        tree: (await $`git show -s --format=%T HEAD`.cwd(directory).quiet().text()).trim(),
        status: await $`git status --porcelain=v1 -- artifact.txt`.cwd(directory).quiet().text(),
      }))
      expect(current.head).not.toBe(head)
      expect(current.parents).toEqual([head])
      expect(current.tree).toBe(tree)
      expect(current.status).toBe("")
      const governance = Schema.decodeUnknownSync(DelegationService.Governance)(result.tool.state.metadata?.governance)
      expect(governance).toMatchObject({
        kind: "revision",
        status: "invalid",
        reason: "Artifact repository or HEAD changed after admission",
        receipt,
      })
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(receipt.delegationID)
      expect(state?.revisions).toEqual([])
      expect(state?.reviews).toEqual([])
      const bus = yield* Bus.Service
      expect(
        yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
          Stream.filter((event) => !Bus.isSynced(event) && event.type === DelegationEvent.RevisionRecorded.type),
          Stream.runCollect,
        ),
      ).toEqual([])
      console.log(
        "MC07 no_code_change refusal evidence",
        JSON.stringify({ case: "no_previous", baseline: { head, tree }, current, shell: shell.state, governance }),
      )
    }),
  30_000,
)

for (const failure of ["non_direct", "tree_change", "index_drift", "target_drift", "diff_drift"] as const)
  effectTest.live(
    `MC07 no_code_change refuses ${failure} after a real completed child shell`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* mc07Build()
        const original = yield* fixture.delegations.revision({
          delegationID: fixture.receipt.delegationID,
          revisionDigest: fixture.digest,
        })
        if (!original.artifact)
          return yield* Effect.die(new Error("MC07 no_code_change refusal has no accepted artifact"))
        const artifact = original.artifact
        const directory = fixture.root.location.directory
        const tree = yield* Effect.promise(() =>
          $`git show -s --format=%T HEAD`
            .cwd(directory)
            .quiet()
            .text()
            .then((text) => text.trim()),
        )
        // Prepare a private forward commit without moving HEAD or staging the accepted artifact.
        const bridge =
          failure === "non_direct"
            ? yield* Effect.promise(() =>
                $`git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit-tree ${tree} -p ${artifact.commitSha} -m mc07-private-bridge`
                  .cwd(directory)
                  .quiet()
                  .text()
                  .then((text) => text.trim()),
              )
            : artifact.commitSha
        const releaseShell = yield* Deferred.make<void>()
        const releaseAnswer = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() =>
          Deferred.succeed(releaseShell, undefined).pipe(
            Effect.andThen(Deferred.succeed(releaseAnswer, undefined)),
            Effect.asVoid,
          ),
        )
        const count = (yield* fixture.llm.requests()).length
        const command =
          "git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m mc07-no-code-change"
        const callID = `mc07-ncc-refused-${failure}`
        const shellID = `${callID}-shell`
        yield* fixture.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: "Attempt the bounded empty commit",
            prompt: "Execute the one private empty commit and finish.",
            subagent_type: fixture.worker,
            delegation_id: fixture.receipt.delegationID,
            participant_id: fixture.receipt.participantID,
            task_id: fixture.receipt.childSessionID,
            artifact_path: "artifact.txt",
          }),
          Stream.unwrap(
            Deferred.await(releaseShell).pipe(
              Effect.as(Stream.fromIterable(TestLLM.tool(shellID, "shell", { command, workdir: directory }))),
            ),
          ),
          Stream.unwrap(
            Deferred.await(releaseAnswer).pipe(
              Effect.as(Stream.fromIterable(TestLLM.text("The private empty commit completed.", `${callID}-child`))),
            ),
          ),
          TestLLM.text("Consumed the invalid artifact capture.", `${callID}-parent`),
        )
        yield* fixture.sessions.prompt({
          sessionID: fixture.root.id,
          text: "Attempt the bounded empty commit in the private drift fixture.",
        })
        yield* awaitWithTimeout(
          fixture.llm.wait(count + 2),
          "MC07 no_code_change drift fixture did not admit its child",
        )
        const admitted = (yield* fixture.sessions.context(fixture.receipt.childSessionID))
          .filter((message): message is SessionMessage.User => message.type === "user")
          .at(-1)
        const link = Schema.decodeUnknownSync(Schema.Struct({ artifact: DelegationExecution.ArtifactBaseline }))(
          admitted?.metadata?.task,
        )
        expect(link.artifact.previous).toEqual(original)
        if (failure === "non_direct")
          yield* Effect.promise(() => git(directory, "update-ref", "HEAD", bridge, artifact.commitSha))
        if (failure === "tree_change")
          yield* Effect.promise(async () => {
            await Bun.write(`${directory}/other.txt`, "private staged tree drift\n")
            await git(directory, "add", "--", "other.txt")
          })
        yield* Deferred.succeed(releaseShell, undefined)
        yield* awaitWithTimeout(fixture.llm.wait(count + 3), "MC07 no_code_change drift shell did not finish")
        if (failure === "index_drift")
          yield* Effect.promise(() =>
            git(directory, "update-index", "--cacheinfo", `100755,${link.artifact.blob},artifact.txt`),
          )
        if (failure === "target_drift")
          yield* Effect.promise(() => Bun.write(`${directory}/artifact.txt`, "base\nr1\nunaccepted\n"))
        const capturedTargets: string[] = []
        if (failure === "diff_drift") {
          const locations = yield* LocationServiceMap.Service
          const environment = yield* Environment.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
          const read = environment.files.read
          const observed: Environment.Files["read"] = (file, range) =>
            read(file, range).pipe(
              Effect.tap((content) => {
                if (file !== path.join(directory, "artifact.txt")) return Effect.void
                capturedTargets.push(createHash("sha256").update(content.bytes).digest("hex"))
                return Effect.promise(() => Bun.write(file, "base\nr1\ndiff-drift\n")).pipe(Effect.asVoid)
              }),
            )
          Object.assign(environment.files, { read: observed })
          yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(environment.files, { read })))
        }
        yield* Deferred.succeed(releaseAnswer, undefined)
        yield* awaitWithTimeout(
          fixture.llm.wait(count + 4),
          "MC07 no_code_change drift refusal did not reach its parent",
        )
        yield* awaitWithTimeout(
          fixture.runs.awaitIdle(fixture.root.id),
          "MC07 no_code_change drift refusal did not settle",
        )
        const result = yield* mc07Result(fixture, callID)
        expect(result.tool.state.status).toBe("completed")
        if (result.tool.state.status !== "completed")
          return yield* Effect.die(new Error("MC07 no_code_change drift Task failed"))
        const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
        expect(receipt.childSessionID).toBe(fixture.receipt.childSessionID)
        expect(receipt.participantID).toBe(fixture.receipt.participantID)
        expect(receipt.inputID).not.toBe(fixture.receipt.inputID)
        const shell = (yield* fixture.sessions.context(receipt.childSessionID))
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part): part is SessionMessage.AssistantTool => part.type === "tool" && part.id === shellID)
        expect(shell?.state.status).toBe("completed")
        if (shell?.state.status !== "completed")
          return yield* Effect.die(new Error("MC07 no_code_change drift shell failed before capture"))
        expect(shell.state.metadata?.exit).toBe(0)
        expect(shell.state.input).toEqual({ command, workdir: directory })
        const current = yield* Effect.promise(async () => ({
          head: (await $`git rev-parse HEAD`.cwd(directory).quiet().text()).trim(),
          parents: (await $`git show -s --format=%P HEAD`.cwd(directory).quiet().text()).trim().split(" "),
          tree: (await $`git show -s --format=%T HEAD`.cwd(directory).quiet().text()).trim(),
          blob: await $`git ls-tree -z HEAD -- artifact.txt`.cwd(directory).quiet().text(),
          index: await $`git ls-files --stage -z -- artifact.txt`.cwd(directory).quiet().text(),
          status: await $`git status --porcelain=v1 -- artifact.txt`.cwd(directory).quiet().text(),
          targetSha256: createHash("sha256")
            .update(Buffer.from(await Bun.file(`${directory}/artifact.txt`).arrayBuffer()))
            .digest("hex"),
          normalizedDiff:
            await $`git -c core.quotepath=false -c core.autocrlf=false --literal-pathspecs diff --no-ext-diff --no-textconv --no-renames --no-color --src-prefix=a/ --dst-prefix=b/ --full-index --unified=2147483647 HEAD -- artifact.txt`
              .cwd(directory)
              .quiet()
              .text(),
        }))
        expect(current.head).not.toBe(artifact.commitSha)
        expect(current.blob).toBe(`100644 blob ${link.artifact.blob}\tartifact.txt\0`)
        expect(current.parents).toEqual([bridge])
        if (failure === "tree_change") expect(current.tree).not.toBe(tree)
        if (failure !== "tree_change") expect(current.tree).toBe(tree)
        if (failure === "index_drift") expect(current.index).toBe(`100755 ${link.artifact.blob} 0\tartifact.txt\0`)
        if (failure !== "index_drift") expect(current.index).toBe(`100644 ${link.artifact.blob} 0\tartifact.txt\0`)
        if (failure === "target_drift" || failure === "diff_drift")
          expect(current.targetSha256).not.toBe(artifact.targetSha256)
        if (failure !== "target_drift" && failure !== "diff_drift")
          expect(current.targetSha256).toBe(artifact.targetSha256)
        if (failure === "diff_drift") {
          expect(capturedTargets).toEqual([artifact.targetSha256])
          expect(current.normalizedDiff).not.toBe(artifact.normalizedDiff)
        }
        const governance = Schema.decodeUnknownSync(DelegationService.Governance)(
          result.tool.state.metadata?.governance,
        )
        expect(governance).toMatchObject({
          kind: "revision",
          status: "invalid",
          receipt,
          source: { type: "tool", messageID: result.assistant.id, id: callID },
          reason:
            failure === "non_direct" || failure === "tree_change"
              ? "Artifact HEAD must be one direct empty commit from its baseline"
              : failure === "index_drift"
                ? "Artifact index changed after admission"
                : "Artifact changed across the empty commit",
        })
        const state = yield* fixture.delegations.foldState(receipt.delegationID)
        expect(state?.revisions).toHaveLength(1)
        expect(state?.delegation.latestRevisionDigest).toBe(fixture.digest)
        const bus = yield* Bus.Service
        expect(
          yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
            Stream.filter((event) => !Bus.isSynced(event) && event.type === DelegationEvent.RevisionRecorded.type),
            Stream.runCollect,
          ),
        ).toHaveLength(1)
        console.log(
          "MC07 no_code_change refusal evidence",
          JSON.stringify({
            case: failure,
            baseline: { commitSha: artifact.commitSha, tree, targetSha256: artifact.targetSha256 },
            current,
            capturedTargets,
            shell: shell.state,
            governance,
          }),
        )
        return undefined
      }),
    30_000,
  )

effectTest.live(
  "MC07 R2 preserves the original producer for a new no_change input",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const original = yield* fixture.delegations.revision({
        delegationID: fixture.receipt.delegationID,
        revisionDigest: fixture.digest,
      })
      yield* mc07Review(fixture, "mc07-r2-original-approval", "approved")
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-no-change", TaskTool.name, {
          description: "Confirm the current artifact",
          prompt: "Keep the current artifact unchanged and report its result.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          task_id: fixture.receipt.childSessionID,
          artifact_path: "artifact.txt",
        }),
        TestLLM.text("The original artifact is unchanged.", "mc07-r2-no-change-child"),
        TestLLM.text("Consumed the new unchanged input.", "mc07-r2-no-change-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Confirm the same child's current artifact." })
      yield* awaitWithTimeout(fixture.llm.wait(8), "MC07 R2 no_change request did not start")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 R2 no_change did not settle")
      const completed = yield* mc07Result(fixture, "mc07-r2-no-change")
      expect(completed.tool.state.status).toBe("completed")
      if (completed.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 R2 unchanged input was refused"))
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(completed.tool.state.metadata?.receipt)
      const governance = Schema.decodeUnknownSync(DelegationService.Governance)(
        completed.tool.state.metadata?.governance,
      )
      expect(receipt.childSessionID).toBe(fixture.receipt.childSessionID)
      expect(receipt.participantID).toBe(fixture.receipt.participantID)
      expect(receipt.inputID).not.toBe(fixture.receipt.inputID)
      expect(governance).toMatchObject({
        kind: "revision",
        receipt,
        source: { type: "tool", messageID: completed.assistant.id, id: "mc07-r2-no-change" },
        artifact: { revisionDigest: fixture.digest, changeKind: "no_change", normalizedDiff: mc07Diff },
        producer: { receipt: original.receipt, source: original.source, revisionDigest: fixture.digest },
      })
      const state = yield* fixture.delegations.foldState(receipt.delegationID)
      expect(state?.revisions).toHaveLength(1)
      expect(
        yield* fixture.delegations.revision({ delegationID: receipt.delegationID, revisionDigest: fixture.digest }),
      ).toEqual(original)
      if (!state) return yield* Effect.die(new Error("MC07 R2 no_change aggregate is missing"))
      expect(
        DelegationReview.evaluateReviewBarrier({
          participants: [...state.participants.values()],
          reviews: state.reviews,
          revisions: state.revisions,
          latestRevisionDigest: state.delegation.latestRevisionDigest,
          rejectionBlocked: state.delegation.rejectionBlocked,
        }).passed,
      ).toBe(true)
      const kv = yield* KV.Service
      const parentTask = Schema.decodeUnknownSync(Schema.Struct({ parentTaskID: Schema.String }))(
        completed.tool.state.metadata,
      )
      const key = `delegation:task-settlement:${DelegationReceipt.notificationID(receipt.inputID, parentTask.parentTaskID)}`
      const settlement = yield* kv.get(key)
      if (settlement === undefined) return yield* Effect.die(new Error("MC07 copy settlement is missing"))
      const settlementJson = JSON.stringify(settlement)
      const retained = Schema.decodeUnknownSync(
        Schema.Struct({
          status: Schema.String,
          revision: Schema.Int,
          governance: DelegationService.Governance,
        }),
      )(settlement)
      expect(retained.status).toBe("completed")
      expect(typeof retained.revision).toBe("number")
      expect(retained.governance).toEqual(governance)
      const requests = yield* fixture.llm.requests()
      const consumed = requests
        .at(-1)
        ?.messages.flatMap((message) => message.content)
        .find((part) => part.type === "tool-result" && part.id === "mc07-r2-no-change")
      expect(consumed).toMatchObject({ result: { type: "text" } })
      if (consumed?.type !== "tool-result" || consumed.result.type !== "text")
        return yield* Effect.die(new Error("MC07 R2 no_change result was not consumed"))
      expect(consumed.result.value).toBe(
        completed.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      )
      expect(consumed.result.value).toContain(JSON.stringify(mc07Diff).slice(1, -1))
      const execution = yield* DelegationExecution.Service
      const originalResult = yield* execution.wait(receipt)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-after-copy", TaskTool.name, {
          description: "Produce a later actual revision",
          prompt: "Write base, r1, and r2 on separate lines.",
          subagent_type: fixture.worker,
          delegation_id: receipt.delegationID,
          participant_id: receipt.participantID,
          artifact_path: "artifact.txt",
          command: "append",
          intent: "implement",
        }),
        TestLLM.tool("mc07-r2-after-copy-write", "write", { path: "artifact.txt", content: "base\nr1\nr2\n" }),
        TestLLM.text("Later R2 is ready.", "mc07-r2-after-copy-child"),
        TestLLM.text("Consumed the later R2.", "mc07-r2-after-copy-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Produce the later R2 in the same child." })
      yield* awaitWithTimeout(fixture.llm.wait(14), "MC07 later R2 did not reach its parent", "10 seconds")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 later R2 did not settle", "10 seconds")
      const later = yield* fixture.delegations.foldState(receipt.delegationID)
      const laterDigest = later?.delegation.latestRevisionDigest
      if (!later || !laterDigest) return yield* Effect.die(new Error("MC07 later R2 is missing"))
      expect(later.revisions).toHaveLength(2)
      expect(later.delegation.latestRevisionDigest).not.toBe(fixture.digest)
      expect(
        DelegationReview.evaluateReviewBarrier({
          participants: [...later.participants.values()],
          reviews: later.reviews,
          revisions: later.revisions,
          latestRevisionDigest: later.delegation.latestRevisionDigest,
          rejectionBlocked: later.delegation.rejectionBlocked,
        }).passed,
      ).toBe(false)
      const bus = yield* Bus.Service
      const before = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      )
      yield* execution.recover({
        kind: "delegation",
        ...receipt,
        parentSessionID: fixture.root.id,
        description: "Completed no_change reentry after R2",
      })
      expect(yield* execution.wait(receipt)).toEqual(originalResult)
      expect(yield* kv.get(key)).toEqual(settlement)
      expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(later)
      expect(
        yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
          Stream.filter((item) => !Bus.isSynced(item)),
          Stream.runCollect,
        ),
      ).toEqual(before)
      expect(yield* fixture.llm.requests()).toHaveLength(14)

      if (!("artifact" in governance)) return yield* Effect.die(new Error("MC07 copy evidence is missing"))
      const record = {
        delegationID: receipt.delegationID,
        turnID: receipt.turnID,
        participantID: receipt.participantID,
        receipt,
        source: governance.source,
        commitSha: governance.artifact.commitSha,
        revisionDigest: governance.artifact.revisionDigest,
        changeKind: governance.artifact.changeKind,
      }
      const db = (yield* Database.Service).db
      const row = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, receipt.inputID)).get()
      if (!row) return yield* Effect.die(new Error("MC07 copy input is missing"))
      const user = Schema.decodeUnknownSync(SessionMessage.User)({ ...row.data, type: row.type, id: row.id })
      const link = Schema.decodeUnknownSync(
        Schema.Struct({
          parentTaskID: Schema.String,
          parentTaskRevision: Schema.Int,
          description: Schema.String,
          background: Schema.Boolean,
          source: Permission.Source,
          artifact: DelegationExecution.ArtifactBaseline,
        }),
      )(user.metadata?.task)
      for (const changed of [
        { link: { ...link, source: original.source }, reason: "Revision has no matching completed input evidence" },
        {
          link: {
            ...link,
            artifact: new DelegationExecution.ArtifactBaseline({
              ...link.artifact,
              previous: new DelegationService.RevisionReference({ ...original, source: governance.source }),
            }),
          },
          reason: "Artifact baseline has no matching original producer lineage",
        },
        {
          link: {
            ...link,
            artifact: new DelegationExecution.ArtifactBaseline({
              ...link.artifact,
              previous: new DelegationService.RevisionReference({ ...original, revisionDigest: laterDigest }),
            }),
          },
          reason: "Artifact baseline has no matching original producer lineage",
        },
      ]) {
        yield* db
          .update(SessionMessageTable)
          .set({ data: { ...row.data, metadata: { ...user.metadata, task: changed.link } } })
          .where(eq(SessionMessageTable.id, row.id))
          .run()
        expect(yield* fixture.delegations.recordRevision(record).pipe(Effect.flip)).toMatchObject({
          _tag: "Delegation.DelegationInvalidStateError",
          reason: changed.reason,
        })
        yield* db.update(SessionMessageTable).set({ data: row.data }).where(eq(SessionMessageTable.id, row.id)).run()
        expect(yield* kv.get(key)).toEqual(settlement)
        expect(yield* fixture.delegations.recordRevision(record).pipe(Effect.exit)).toMatchObject({
          _tag: "Success",
          value: "reused",
        })
      }
      expect(
        yield* fixture.delegations.recordRevision({ ...record, source: original.source }).pipe(Effect.flip),
      ).toMatchObject({ reason: "Revision has no matching completed input evidence" })
      for (const changed of [
        {
          value: { governance },
          reason: "Artifact baseline is no longer the latest revision",
        },
        {
          value: {
            status: "completed",
            governance,
          },
          reason: "Artifact baseline is no longer the latest revision",
        },
        {
          value: {
            status: "completed",
            revision: 1,
            governance: {
              kind: governance.kind,
              receipt: governance.receipt,
              source: governance.source,
              artifact: governance.artifact,
            },
          },
          reason: "Artifact baseline is no longer the latest revision",
        },
        {
          value: {
            status: "completed",
            revision: 1,
            governance: {
              ...governance,
              producer: new DelegationService.RevisionReference({
                receipt: original.receipt,
                path: original.path,
                revisionDigest: original.revisionDigest,
                source: governance.source,
              }),
            },
          },
          reason: "Revision digest belongs to a different producing input",
        },
      ]) {
        yield* kv.set(key, {
          ...(changed.value.status === undefined ? {} : { status: changed.value.status }),
          ...(changed.value.revision === undefined ? {} : { revision: changed.value.revision }),
          governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(changed.value.governance),
        })
        expect(yield* fixture.delegations.recordRevision(record).pipe(Effect.flip)).toMatchObject({
          _tag: "Delegation.DelegationInvalidStateError",
          reason: changed.reason,
        })
        yield* kv.set(key, settlement)
        const restored = yield* kv.get(key)
        expect(JSON.stringify(restored)).toBe(settlementJson)
        expect(
          Schema.decodeUnknownSync(Schema.Struct({ governance: DelegationService.Governance }))(restored).governance,
        ).toMatchObject({
          receipt: record.receipt,
          source: record.source,
          artifact: { commitSha: record.commitSha, changeKind: record.changeKind },
        })
        const replay = yield* fixture.delegations.recordRevision(record).pipe(Effect.exit)
        expect(Exit.isSuccess(replay)).toBe(true)
        if (Exit.isFailure(replay)) return yield* Effect.die(new Error(Cause.pretty(replay.cause)))
        expect(replay.value).toBe("reused")
      }
      expect(
        yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
          Stream.filter((item) => !Bus.isSynced(item)),
          Stream.runCollect,
        ),
      ).toEqual(before)
      return undefined
    }),
  30_000,
)

effectTest.live(
  "MC07 R2 repairs the same child and requires the current typed review",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-changes", TaskTool.name, {
          description: "Review the first artifact",
          prompt: "Review R1 and request its actual repair.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          intent: "review",
          revision_digest: fixture.digest,
        }),
        TestLLM.text(
          `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: fixture.digest, verdict: "changes_requested", findings: [], summary: "Add the required r2 line." })}</review>`,
          "mc07-r2-changes-child",
        ),
        TestLLM.text("Consumed the request for repair.", "mc07-r2-changes-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review the original R1." })
      yield* awaitWithTimeout(fixture.llm.wait(7), "MC07 R2 changes review did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 R2 changes review did not settle")
      const reviewed = yield* mc07Result(fixture, "mc07-r2-changes")
      if (reviewed.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 changes review failed"))
      const reviewer = Schema.decodeUnknownSync(Delegation.Receipt)(reviewed.tool.state.metadata?.receipt)
      const before = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(before?.reviews.at(-1)?.verdict).toBe("changes_requested")
      if (!before) return yield* Effect.die(new Error("MC07 R2 review aggregate is missing"))
      expect([...before.deliveries.values()].every((delivery) => delivery.status === "completed")).toBe(true)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-repair", TaskTool.name, {
          description: "Repair the original artifact",
          prompt: "Use the review and write base, r1, and r2 on separate lines.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          task_id: fixture.receipt.childSessionID,
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-r2-write", "write", { path: "artifact.txt", content: "base\nr1\nr2\n" }),
        TestLLM.text("The requested R2 is ready.", "mc07-r2-repair-child"),
        TestLLM.text("Consumed the actual repair.", "mc07-r2-repair-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Repair through the original child." })
      yield* awaitWithTimeout(fixture.llm.wait(8), "MC07 R2 repair did not start")
      yield* fixture.runs.awaitIdle(fixture.root.id)
      const repaired = yield* mc07Result(fixture, "mc07-r2-repair")
      expect(repaired.tool.state.status).toBe("completed")
      if (repaired.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 R2 repair was refused"))
      const repair = Schema.decodeUnknownSync(Delegation.Receipt)(repaired.tool.state.metadata?.receipt)
      expect(repair.childSessionID).toBe(fixture.receipt.childSessionID)
      expect(repair.participantID).toBe(fixture.receipt.participantID)
      expect(repair.inputID).not.toBe(fixture.receipt.inputID)
      const state = yield* fixture.delegations.foldState(repair.delegationID)
      const digest = state?.delegation.latestRevisionDigest
      expect(state?.revisions).toHaveLength(2)
      expect(digest).not.toBe(fixture.digest)
      if (!state || !digest) return yield* Effect.die(new Error("MC07 R2 revision is missing"))
      expect(
        DelegationReview.evaluateReviewBarrier({
          participants: [...state.participants.values()],
          reviews: state.reviews,
          revisions: state.revisions,
          latestRevisionDigest: digest,
          rejectionBlocked: state.delegation.rejectionBlocked,
        }).passed,
      ).toBe(false)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-approve", TaskTool.name, {
          description: "Review the actual R2",
          prompt: "Review the current repaired artifact and approve only that digest.",
          subagent_type: fixture.worker,
          delegation_id: repair.delegationID,
          task_id: reviewer.childSessionID,
          intent: "review",
          revision_digest: digest,
        }),
        TestLLM.text(
          `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: digest, verdict: "approved", findings: [], summary: "The actual R2 is approved." })}</review>`,
          "mc07-r2-approve-child",
        ),
        TestLLM.text("Consumed the current approval.", "mc07-r2-approve-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review the current R2." })
      yield* awaitWithTimeout(fixture.llm.wait(14), "MC07 R2 approval did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 R2 approval did not settle")
      const approved = yield* fixture.delegations.foldState(repair.delegationID)
      if (!approved) return yield* Effect.die(new Error("MC07 R2 aggregate is missing"))
      expect(
        DelegationReview.canComplete({
          participants: [...approved.participants.values()],
          reviews: approved.reviews,
          revisions: approved.revisions,
          latestRevisionDigest: approved.delegation.latestRevisionDigest,
          rejectionBlocked: approved.delegation.rejectionBlocked,
          turns: [...approved.turns.values()],
          deliveries: [...approved.deliveries.values()],
        }),
      ).toBe(true)
      const original = yield* fixture.delegations.revision({
        delegationID: repair.delegationID,
        revisionDigest: fixture.digest,
      })
      const current = yield* fixture.delegations.revision({ delegationID: repair.delegationID, revisionDigest: digest })
      expect(current.artifact).toMatchObject({
        location: original.artifact?.location,
        repository: original.artifact?.repository,
        path: "artifact.txt",
        commitSha: original.artifact?.commitSha,
        baseSha256: original.artifact?.baseSha256,
        changeKind: "rework",
      })
      expect(current.artifact?.targetSha256).toBe("1894ce0ca98d816bded15e17cb540bd3d748fb81271a6eefb68bb6c0ba9ba11f")
      expect(current.artifact?.normalizedDiff).toBe(mc07R2Diff)
      expect(current.receipt).toEqual(repair)
      expect(current.source).toEqual({ type: "tool", messageID: repaired.assistant.id, id: "mc07-r2-repair" })
      const inputs = (yield* fixture.sessions.context(repair.childSessionID)).filter(
        (message): message is SessionMessage.User => message.type === "user",
      )
      const firstBaseline = Schema.decodeUnknownSync(Schema.Struct({ artifact: DelegationExecution.ArtifactBaseline }))(
        inputs.find((input) => input.id === fixture.receipt.inputID)?.metadata?.task,
      ).artifact
      const repairBaseline = Schema.decodeUnknownSync(
        Schema.Struct({ source: Permission.Source, artifact: DelegationExecution.ArtifactBaseline }),
      )(inputs.find((input) => input.id === repair.inputID)?.metadata?.task)
      expect(repairBaseline.artifact).toMatchObject({
        blob: firstBaseline.blob,
        commitSha: firstBaseline.commitSha,
        baseSha256: firstBaseline.baseSha256,
        previous: original,
        agent: "meta",
      })
      expect(repairBaseline.source).toEqual(current.source)
      const repairConsumed = (yield* fixture.llm.requests())[10]?.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool-result" && part.id === "mc07-r2-repair")
      if (repairConsumed?.type !== "tool-result" || repairConsumed.result.type !== "text")
        return yield* Effect.die(new Error("MC07 R2 repair was not consumed"))
      expect(repairConsumed.result.value).toBe(
        repaired.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      )
      const bus = yield* Bus.Service
      const beforeComplete = yield* bus.log({ aggregateID: repair.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      )
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-complete", TaskTool.name, {
          description: "Complete the approved delegation",
          prompt: "Complete and archive the approved R2.",
          subagent_type: fixture.worker,
          delegation_id: repair.delegationID,
          command: "complete",
        }),
        TestLLM.text("Consumed the completed archive.", "mc07-r2-complete-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Complete the approved delegation." })
      yield* awaitWithTimeout(fixture.llm.wait(16), "MC07 R2 completion did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 R2 completion did not settle")
      const completed = yield* mc07Result(fixture, "mc07-r2-complete")
      if (completed.tool.state.status !== "completed")
        return yield* Effect.die(
          new Error(
            JSON.stringify({
              callID: "mc07-r2-complete",
              tool: completed.tool.state,
              delegation: (yield* fixture.delegations.foldState(repair.delegationID))?.delegation,
              nextRequest: (yield* fixture.llm.requests())[15]?.messages
                .flatMap((message) => message.content)
                .filter((part) => part.type === "tool-result" && part.id === "mc07-r2-complete"),
              requests: (yield* fixture.llm.requests()).slice(14).map((request) => ({
                model: request.model.id,
                toolResults: request.messages
                  .flatMap((message) => message.content)
                  .flatMap((part) => (part.type === "tool-result" ? [part.id] : [])),
              })),
              events: (yield* bus.log({ aggregateID: fixture.root.id }).pipe(
                Stream.filter((item) => !Bus.isSynced(item)),
                Stream.runCollect,
              )).filter(
                (event) =>
                  !Bus.isSynced(event) &&
                  event.type.startsWith("session.tool.") &&
                  JSON.stringify(event.data).includes('"mc07-r2-complete"'),
              ),
            }),
          ),
        )
      expect(completed.tool.state.metadata?.status).toBe("completed")
      const final = yield* fixture.delegations.foldState(repair.delegationID)
      if (!final) return yield* Effect.die(new Error("MC07 completed archive is missing"))
      expect(final.delegation.status).toBe("archived")
      expect(final.archivedFrom).toBe("completed")
      expect(final.delegation.completedAt).toEqual(expect.any(Number))
      expect([...final.participants.values()].every((participant) => participant.phase === "closed")).toBe(true)
      const full = completed.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
      const summary = /<task_result>\n([\s\S]+)\n<\/task_result>/.exec(full)
      if (!summary?.[1]) return yield* Effect.die(new Error("MC07 completion summary is missing"))
      const barrier = {
        participants: [...final.participants.values()],
        reviews: final.reviews,
        revisions: final.revisions,
        latestRevisionDigest: final.delegation.latestRevisionDigest,
        rejectionBlocked: final.delegation.rejectionBlocked,
        turns: [...final.turns.values()],
        deliveries: [...final.deliveries.values()],
      }
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(summary[1])).toEqual({
        command: "complete",
        source: { type: "tool", messageID: completed.assistant.id, id: "mc07-r2-complete" },
        delegation: Schema.encodeSync(Schema.toCodecJson(Delegation.Info))(final.delegation),
        archivedFrom: "completed",
        latestRevisionDigest: digest,
        reviewBarrier: DelegationReview.evaluateReviewBarrier(barrier),
        canComplete: DelegationReview.canComplete(barrier),
      })
      const consumed = (yield* fixture.llm.requests())[15]?.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool-result" && part.id === "mc07-r2-complete")
      if (consumed?.type !== "tool-result" || consumed.result.type !== "text")
        return yield* Effect.die(new Error("MC07 completion was not consumed"))
      expect(consumed.result.value).toBe(full)
      const completedEvents = yield* bus.log({ aggregateID: repair.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      )
      const types = completedEvents.slice(beforeComplete.length).map((event) => event.type)
      expect(types.indexOf(DelegationEvent.Closing.type)).toBeGreaterThanOrEqual(0)
      expect(types.indexOf(DelegationEvent.Completed.type)).toBeGreaterThan(types.indexOf(DelegationEvent.Closing.type))
      expect(types.indexOf(DelegationEvent.Archived.type)).toBeGreaterThan(
        types.indexOf(DelegationEvent.Completed.type),
      )
      expect(yield* fixture.sessions.inbox(repair.childSessionID)).toEqual([])
      expect(yield* fixture.runs.isActive(repair.childSessionID)).toBe(false)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-complete-again", TaskTool.name, {
          description: "Read the completed archive",
          prompt: "Repeat completion of the same approved delegation.",
          subagent_type: fixture.worker,
          delegation_id: repair.delegationID,
          command: "complete",
        }),
        TestLLM.text("The same completed archive is retained.", "mc07-r2-complete-again-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Repeat the completed operation." })
      yield* awaitWithTimeout(fixture.llm.wait(18), "MC07 repeat completion did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 repeat completion did not settle")
      expect((yield* mc07Result(fixture, "mc07-r2-complete-again")).tool.state.status).toBe("completed")
      expect(yield* fixture.delegations.foldState(repair.delegationID)).toEqual(final)
      expect(
        yield* bus.log({ aggregateID: repair.delegationID }).pipe(
          Stream.filter((item) => !Bus.isSynced(item)),
          Stream.runCollect,
        ),
      ).toEqual(completedEvents)
      return undefined
    }),
  30_000,
)

for (const failure of ["read_deny", "read_reject", "target_drift", "diff_drift", "other_child"] as const)
  effectTest.live(`MC07 R2 admission refuses ${failure} before a new child input`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const reviewer =
        failure === "other_child" ? yield* mc07Review(fixture, "mc07-r2-other-reviewer", "approved") : undefined
      if (failure === "target_drift") {
        yield* fixture.llm.push(
          TestLLM.tool("mc07-r2-drift-write", "write", { path: "artifact.txt", content: "base\nr1\nunaccepted\n" }),
          TestLLM.text("Saved the unaccepted bytes.", "mc07-r2-drift-parent"),
        )
        yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Write the fixture's unaccepted change." })
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 drift write did not settle")
      }
      if (failure === "diff_drift")
        yield* Effect.promise(async () => {
          // Windows has no executable-bit drift; exercise the same unsupported-diff refusal with Git attributes.
          if (process.platform === "win32") {
            await Bun.write(path.join(fixture.root.location.directory, ".gitattributes"), "artifact.txt -diff\n")
            return
          }
          await $`chmod 755 ${`${fixture.root.location.directory}/artifact.txt`}`.quiet()
        })
      if (failure === "read_deny" || failure === "read_reject")
        yield* fixture.sessions.setPermissions({
          sessionID: fixture.root.id,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "artifact.txt", effect: failure === "read_deny" ? "deny" : "ask" },
          ],
        })
      const locations = yield* LocationServiceMap.Service
      const local = locations.get(fixture.root.location)
      const environment = yield* Environment.Service.pipe(Effect.provide(local))
      const reads: string[] = []
      const read = environment.files.read
      const observed: Environment.Files["read"] = (file, range) => {
        if (file.endsWith("/artifact.txt")) reads.push(file)
        return read(file, range)
      }
      Object.assign(environment.files, { read: observed })
      yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(environment.files, { read })))
      const callID = `mc07-r2-refused-${failure}`
      const asked = yield* Deferred.make<Permission.Request>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
        return request.source?.type === "tool" && request.source.id === callID
          ? Deferred.succeed(asked, request).pipe(Effect.asVoid)
          : Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ location: fixture.root.location, custom: false })
      const count = (yield* fixture.llm.requests()).length
      const beforeInputs = (yield* fixture.sessions.context(fixture.receipt.childSessionID))
        .filter((message) => message.type === "user")
        .map((message) => message.id)
      yield* fixture.llm.push(
        TestLLM.tool(callID, TaskTool.name, {
          description: "Attempt the bounded repair",
          prompt: "Repair the declared artifact and finish.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          task_id: reviewer?.receipt.childSessionID ?? fixture.receipt.childSessionID,
          artifact_path: "artifact.txt",
        }),
        ...(failure === "read_reject" ? [] : [TestLLM.text("The invalid admission was refused.", `${callID}-parent`)]),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Attempt the bounded repair." })
      if (failure === "read_reject") {
        const request = yield* awaitWithTimeout(Deferred.await(asked), "MC07 repair admission did not request read")
        const current = yield* mc07Result(fixture, callID)
        expect(request).toMatchObject({
          action: "read",
          resources: ["artifact.txt"],
          sessionID: fixture.root.id,
          source: { type: "tool", messageID: current.assistant.id, id: callID },
        })
        expect(reads).toEqual([])
        const permission = yield* Permission.Service.pipe(Effect.provide(local))
        yield* permission.reply({ requestID: request.id, reply: "reject" })
      }
      if (failure !== "read_reject")
        yield* awaitWithTimeout(fixture.llm.wait(count + 2), "MC07 refused admission did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 refused admission left its parent waiting")
      const result = yield* mc07Result(fixture, callID)
      expect(result.tool.state.status).toBe("error")
      if (result.tool.state.status !== "error") return yield* Effect.die(new Error("MC07 invalid admission succeeded"))
      if (failure === "target_drift") expect(result.tool.state.error.message).toContain("latest accepted revision")
      if (failure === "diff_drift") expect(result.tool.state.error.message).toContain("Artifact modes")
      if (failure === "other_child") expect(result.tool.state.error.message).toContain("not a implementer")
      if (failure === "read_deny" || failure === "read_reject") expect(reads).toEqual([])
      const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(state?.revisions).toHaveLength(1)
      expect(state?.delegation.latestRevisionDigest).toBe(fixture.digest)
      expect(
        (yield* fixture.sessions.context(fixture.receipt.childSessionID))
          .filter((message) => message.type === "user")
          .map((message) => message.id),
      ).toEqual(beforeInputs)
      expect(yield* fixture.llm.requests()).toHaveLength(count + (failure === "read_reject" ? 1 : 2))
    }),
  )

effectTest.live("MC07 R2 capture uses the new invocation's current read authorization", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const callID = "mc07-r2-capture-read"
    yield* fixture.llm.push(
      TestLLM.tool(callID, TaskTool.name, {
        description: "Repair before current capture",
        prompt: "Write the real R2 and finish.",
        subagent_type: fixture.worker,
        delegation_id: fixture.receipt.delegationID,
        task_id: fixture.receipt.childSessionID,
        artifact_path: "artifact.txt",
      }),
      TestLLM.tool("mc07-r2-capture-write", "write", { path: "artifact.txt", content: "base\nr1\nr2\n" }),
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text("R2 written.", "mc07-r2-capture-child"))),
        ),
      ),
      TestLLM.text("The current capture was declined.", "mc07-r2-capture-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Repair and capture with current permission." })
    yield* awaitWithTimeout(fixture.llm.wait(7), "MC07 R2 child did not finish its write")
    const locations = yield* LocationServiceMap.Service
    const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ location: fixture.root.location, custom: false })
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "ask" },
      ],
    })
    yield* Deferred.succeed(release, undefined)
    const request = yield* pollWithTimeout(
      permission
        .forSession(fixture.root.id)
        .pipe(
          Effect.map((requests) =>
            requests.find(
              (item) => item.action === "read" && item.source?.type === "tool" && item.source.id === callID,
            ),
          ),
        ),
      "MC07 current capture did not ask read",
    )
    const running = yield* mc07Result(fixture, callID)
    expect(request.source).toEqual({ type: "tool", messageID: running.assistant.id, id: callID })
    expect(request.source).not.toEqual({ type: "tool", messageID: fixture.result.assistant.id, id: "mc07-implement" })
    yield* permission.reply({ requestID: request.id, reply: "reject" })
    yield* awaitWithTimeout(fixture.llm.wait(8), "MC07 declined capture did not reach its parent")
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 declined capture did not settle")
    const result = yield* mc07Result(fixture, callID)
    expect(result.tool.state.status).toBe("completed")
    if (result.tool.state.status !== "completed")
      return yield* Effect.die(new Error("MC07 declined capture result is missing"))
    expect(result.tool.state.metadata?.status).toBe("failed")
    expect(result.tool.state.metadata?.governance).toBeUndefined()
    const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
    expect(receipt.childSessionID).toBe(fixture.receipt.childSessionID)
    expect(receipt.inputID).not.toBe(fixture.receipt.inputID)
    const state = yield* fixture.delegations.foldState(receipt.delegationID)
    expect(state?.revisions).toHaveLength(1)
    expect(state?.delegation.latestRevisionDigest).toBe(fixture.digest)
    expect([...(state?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === receipt.turnID)?.status).toBe(
      "failed",
    )
    const bus = yield* Bus.Service
    const before = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
      Stream.filter((item) => !Bus.isSynced(item)),
      Stream.runCollect,
    )
    const execution = yield* DelegationExecution.Service
    yield* execution.recover({
      kind: "delegation",
      ...receipt,
      parentSessionID: fixture.root.id,
      description: "Declined current R2 capture",
    })
    expect(
      yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      ),
    ).toEqual(before)
    expect(yield* permission.forSession(fixture.root.id)).toEqual([])
  }),
)

effectTest.live(
  "MC07 R2 preserves a sticky rejection until the authorized matching retraction",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const rejected = yield* mc07Review(fixture, "mc07-r2-sticky-rejected", "rejected")
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-sticky-repair", TaskTool.name, {
          description: "Repair the rejected artifact",
          prompt: "Write the real R2.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          task_id: fixture.receipt.childSessionID,
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-r2-sticky-write", "write", { path: "artifact.txt", content: "base\nr1\nr2\n" }),
        TestLLM.text("The rejected artifact was repaired.", "mc07-r2-sticky-child"),
        TestLLM.text("Consumed the actual repair.", "mc07-r2-sticky-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Repair the rejected artifact." })
      yield* awaitWithTimeout(fixture.llm.wait(11), "MC07 sticky repair did not reach its parent", "10 seconds")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 sticky repair did not settle")
      const repaired = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      const digest = repaired?.delegation.latestRevisionDigest
      if (!digest) return yield* Effect.die(new Error("MC07 sticky R2 is missing"))
      yield* mc07Review(fixture, "mc07-r2-sticky-approved", "approved", digest, rejected.receipt.childSessionID)
      const blocked = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      if (!blocked) return yield* Effect.die(new Error("MC07 sticky aggregate is missing"))
      expect(blocked.delegation.rejectionBlocked).toBe(true)
      expect(blocked.reviews.map((review) => review.verdict)).toEqual(["rejected", "approved"])
      expect(
        DelegationReview.evaluateReviewBarrier({
          participants: [...blocked.participants.values()],
          reviews: blocked.reviews,
          revisions: blocked.revisions,
          latestRevisionDigest: digest,
          rejectionBlocked: blocked.delegation.rejectionBlocked,
        }).passed,
      ).toBe(false)
      for (const failure of ["participant", "deny"] as const) {
        if (failure === "deny")
          yield* fixture.sessions.setPermissions({
            sessionID: fixture.root.id,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: "task_reconcile", resource: fixture.receipt.delegationID, effect: "deny" },
            ],
          })
        const callID = `mc07-r2-retract-${failure}`
        yield* fixture.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: "Attempt rejection retraction",
            prompt: "Retract this blocker.",
            subagent_type: fixture.worker,
            delegation_id: fixture.receipt.delegationID,
            command: "retract_rejection",
            participant_id: failure === "participant" ? fixture.receipt.participantID : rejected.receipt.participantID,
          }),
          TestLLM.text("The invalid retraction was refused.", `${callID}-parent`),
        )
        yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Attempt the explicit retraction." })
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 invalid retraction did not settle")
        expect((yield* mc07Result(fixture, callID)).tool.state.status).toBe("error")
        expect(yield* fixture.delegations.foldState(fixture.receipt.delegationID)).toEqual(blocked)
      }
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "task_reconcile", resource: fixture.receipt.delegationID, effect: "ask" },
        ],
      })
      const locations = yield* LocationServiceMap.Service
      const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ location: fixture.root.location, custom: false })
      const bus = yield* Bus.Service
      const before = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      )
      yield* fixture.llm.push(
        TestLLM.tool("mc07-r2-retract-once", TaskTool.name, {
          description: "Retract the matching blocker",
          prompt: "Explicitly retract the original rejection.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          command: "retract_rejection",
          participant_id: rejected.receipt.participantID,
        }),
        TestLLM.text("The explicit retraction was consumed.", "mc07-r2-retract-once-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Retract the matching blocker with current approval.",
      })
      const request = yield* pollWithTimeout(
        permission
          .forSession(fixture.root.id)
          .pipe(Effect.map((requests) => requests.find((item) => item.action === "task_reconcile"))),
        "MC07 retraction did not ask",
      )
      const pending = yield* mc07Result(fixture, "mc07-r2-retract-once")
      expect(request).toMatchObject({
        action: "task_reconcile",
        resources: [fixture.receipt.delegationID],
        source: { type: "tool", messageID: pending.assistant.id, id: "mc07-r2-retract-once" },
      })
      expect(yield* fixture.delegations.foldState(fixture.receipt.delegationID)).toEqual(blocked)
      yield* permission.reply({ requestID: request.id, reply: "once" })
      yield* awaitWithTimeout(fixture.llm.wait(20), "MC07 retraction did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 retraction did not settle")
      expect((yield* mc07Result(fixture, "mc07-r2-retract-once")).tool.state.status).toBe("completed")
      const final = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      if (!final) return yield* Effect.die(new Error("MC07 retracted aggregate is missing"))
      expect(final.delegation.rejectionBlocked).toBe(false)
      expect(final.reviews).toEqual(blocked.reviews)
      expect(final.revisions).toEqual(blocked.revisions)
      expect(
        DelegationReview.canComplete({
          participants: [...final.participants.values()],
          reviews: final.reviews,
          revisions: final.revisions,
          latestRevisionDigest: digest,
          rejectionBlocked: final.delegation.rejectionBlocked,
          turns: [...final.turns.values()],
          deliveries: [...final.deliveries.values()],
        }),
      ).toBe(true)
      expect(
        (yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
          Stream.filter((item) => !Bus.isSynced(item)),
          Stream.runCollect,
        ))
          .slice(before.length)
          .map((event) => event.type),
      ).toEqual([DelegationEvent.RejectionRetracted.type])
      return undefined
    }),
  30_000,
)

for (const action of ["task_close", "task_archive"] as const)
  effectTest.live(
    `MC07 R2 complete fences new work after ${action} approval returns`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* mc07Build()
        yield* mc07Review(fixture, `mc07-r2-race-approved-${action}`, "approved")
        const locations = yield* LocationServiceMap.Service
        const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ location: fixture.root.location, custom: false })
        yield* fixture.sessions.setPermissions({
          sessionID: fixture.root.id,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task_close", resource: fixture.receipt.delegationID, effect: "ask" },
            { action: "task_archive", resource: fixture.receipt.delegationID, effect: "ask" },
          ],
        })
        const completeID = `mc07-r2-race-complete-${action}`
        const repairID = `mc07-r2-race-repair-${action}`
        const closeAsked = yield* Deferred.make<Permission.Request>()
        const archiveAsked = yield* Deferred.make<Permission.Request>()
        const releaseChild = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(releaseChild, undefined).pipe(Effect.asVoid))
        const bus = yield* Bus.Service
        const unsubscribe = yield* bus.listen((event) => {
          if (event.type !== Permission.Event.Asked.type) return Effect.void
          const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
          if (request.source?.type !== "tool" || request.source.id !== completeID) return Effect.void
          if (request.action === "task_close") return Deferred.succeed(closeAsked, request).pipe(Effect.asVoid)
          if (request.action === "task_archive") return Deferred.succeed(archiveAsked, request).pipe(Effect.asVoid)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        const before = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
          Stream.filter((item) => !Bus.isSynced(item)),
          Stream.runCollect,
        )
        const response = TestLLM.toolCalls(
          LLMEvent.toolCall({
            id: completeID,
            name: TaskTool.name,
            input: {
              description: "Complete the approved delegation",
              prompt: "Complete the current approved artifact.",
              subagent_type: fixture.worker,
              delegation_id: fixture.receipt.delegationID,
              command: "complete",
            },
          }),
          LLMEvent.toolCall({
            id: repairID,
            name: TaskTool.name,
            input: {
              description: "Admit the next real repair",
              prompt: "Write the real R2 and finish.",
              subagent_type: fixture.worker,
              delegation_id: fixture.receipt.delegationID,
              task_id: fixture.receipt.childSessionID,
              artifact_path: "artifact.txt",
            },
          }),
        )
        yield* fixture.llm.push(
          Stream.fromIterable(response.slice(0, 2)).pipe(
            Stream.concat(
              Stream.unwrap(
                Deferred.await(action === "task_close" ? closeAsked : archiveAsked).pipe(
                  Effect.as(Stream.fromIterable(response.slice(2))),
                ),
              ),
            ),
          ),
          Stream.unwrap(
            Deferred.await(releaseChild).pipe(
              Effect.as(
                Stream.fromIterable(
                  TestLLM.tool(`mc07-r2-race-write-${action}`, "write", {
                    path: "artifact.txt",
                    content: "base\nr1\nr2\n",
                  }),
                ),
              ),
            ),
          ),
          TestLLM.text("The new repair completed.", `mc07-r2-race-child-${action}`),
          TestLLM.text("The late completion was refused and the repair completed.", `mc07-r2-race-parent-${action}`),
        )
        yield* fixture.sessions.prompt({
          sessionID: fixture.root.id,
          text: "Complete while the next repair is admitted in the same Step.",
        })
        const close = yield* awaitWithTimeout(Deferred.await(closeAsked), "MC07 complete did not ask task_close")
        if (action === "task_archive") yield* permission.reply({ requestID: close.id, reply: "once" })
        yield* awaitWithTimeout(fixture.llm.wait(9), "MC07 same-Step repair did not request its child model")
        const active = yield* pollWithTimeout(
          fixture.delegations.foldState(fixture.receipt.delegationID).pipe(
            Effect.map((state) => {
              const turn = [...(state?.turns.values() ?? [])].at(-1)
              return state && turn?.kind === "repair" && turn.status === "running" ? { state, turn } : undefined
            }),
          ),
          "MC07 same-Step repair has no running Turn",
        )
        const users = (yield* fixture.sessions.context(fixture.receipt.childSessionID)).filter(
          (message): message is SessionMessage.User => message.type === "user",
        )
        expect(users).toHaveLength(2)
        const input = users.at(-1)
        if (!input) return yield* Effect.die(new Error("MC07 same-Step repair input is missing"))
        expect(active.turn.participantIDs).toEqual([fixture.receipt.participantID])
        const complete = yield* mc07Result(fixture, completeID)
        const repair = yield* mc07Result(fixture, repairID)
        expect(repair.assistant.id).toBe(complete.assistant.id)
        const link = Schema.decodeUnknownSync(
          Schema.Struct({ source: Permission.Source, artifact: DelegationExecution.ArtifactBaseline }),
        )(input.metadata?.task)
        expect(link.source).toEqual({ type: "tool", messageID: complete.assistant.id, id: repairID })
        expect(link.artifact.previous?.receipt).toEqual(fixture.receipt)
        if (action === "task_close") yield* permission.reply({ requestID: close.id, reply: "once" })
        const archive = yield* awaitWithTimeout(Deferred.await(archiveAsked), "MC07 complete did not ask task_archive")
        expect(close.source).toEqual({ type: "tool", messageID: complete.assistant.id, id: completeID })
        expect(archive.source).toEqual(close.source)
        expect(archive.id).not.toBe(close.id)
        expect([close.action, archive.action]).toEqual(["task_close", "task_archive"])
        expect(close.resources).toEqual([fixture.receipt.delegationID])
        expect(archive.resources).toEqual(close.resources)
        expect(archive.sessionID).toBe(close.sessionID)
        expect(close.sessionID).toBe(fixture.root.id)
        const forbidden = [
          DelegationEvent.Closing.type,
          DelegationEvent.DeliveryCancelled.type,
          DelegationEvent.Completed.type,
          DelegationEvent.Archived.type,
        ]
        expect(
          (yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
            Stream.filter((item) => !Bus.isSynced(item)),
            Stream.runCollect,
          ))
            .slice(before.length)
            .filter((event) => forbidden.some((type) => type === event.type)),
        ).toEqual([])
        yield* permission.reply({ requestID: archive.id, reply: "once" })
        const refused = yield* pollWithTimeout(
          mc07Result(fixture, completeID).pipe(
            Effect.map((result) => (result.tool.state.status === "error" ? result : undefined)),
          ),
          "MC07 completion did not reject the fresh running Turn",
        )
        if (refused.tool.state.status !== "error") return yield* Effect.die(new Error("MC07 complete did not refuse"))
        expect(refused.tool.state.error.message).toContain("completion barrier")
        expect(
          (yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
            Stream.filter((item) => !Bus.isSynced(item)),
            Stream.runCollect,
          ))
            .slice(before.length)
            .filter((event) => forbidden.some((type) => type === event.type)),
        ).toEqual([])
        yield* Deferred.succeed(releaseChild, undefined)
        yield* awaitWithTimeout(fixture.llm.wait(11), "MC07 permitted repair did not reach its parent")
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 same-Step parent did not settle")
        const completed = yield* mc07Result(fixture, repairID)
        expect(completed.tool.state.status).toBe("completed")
        if (completed.tool.state.status !== "completed")
          return yield* Effect.die(new Error("MC07 complete cancelled the newer repair"))
        const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(completed.tool.state.metadata?.receipt)
        expect(receipt.childSessionID).toBe(fixture.receipt.childSessionID)
        expect(receipt.turnID).toBe(active.turn.id)
        expect(receipt.inputID).toBe(input.id)
        const final = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
        expect(final?.revisions).toHaveLength(2)
        expect(final?.delegation.latestRevisionDigest).not.toBe(fixture.digest)
        expect(final?.reviews).toEqual(active.state.reviews)
        expect(
          (yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
            Stream.filter((item) => !Bus.isSynced(item)),
            Stream.runCollect,
          ))
            .slice(before.length)
            .filter((event) => forbidden.some((type) => type === event.type)),
        ).toEqual([])
        return undefined
      }),
    30_000,
  )

effectTest.live("MC07 R2 refuses a retained archive from cancelled", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build()
    yield* mc07Review(fixture, "mc07-r2-retained-approved", "approved")
    const bus = yield* Bus.Service
    // Only the retained lifecycle is seeded; the revision and review came through real Tasks.
    yield* bus.publish(DelegationEvent.Closing, {
      delegationID: fixture.receipt.delegationID,
      reason: "Retained cancellation fence",
      timestamp: (yield* DateTime.nowAsDate).getTime(),
    })
    yield* bus.publish(DelegationEvent.Cancelled, {
      delegationID: fixture.receipt.delegationID,
      reason: "Retained cancelled lifecycle",
      timestamp: (yield* DateTime.nowAsDate).getTime(),
    })
    yield* fixture.llm.push(
      TestLLM.tool("mc07-r2-retained-archive", TaskTool.name, {
        description: "Archive the retained cancellation",
        prompt: "Archive this cancelled delegation.",
        subagent_type: fixture.worker,
        delegation_id: fixture.receipt.delegationID,
        command: "archive",
      }),
      TestLLM.text("The cancellation is retained in its archive.", "mc07-r2-retained-archive-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Archive the retained cancellation." })
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 retained archive did not settle")
    const archived = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    expect(archived?.archivedFrom).toBe("cancelled")
    const before = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
      Stream.filter((item) => !Bus.isSynced(item)),
      Stream.runCollect,
    )
    yield* fixture.llm.push(
      TestLLM.tool("mc07-r2-retained-complete", TaskTool.name, {
        description: "Attempt the cancelled archive",
        prompt: "Complete the retained cancelled archive.",
        subagent_type: fixture.worker,
        delegation_id: fixture.receipt.delegationID,
        command: "complete",
      }),
      TestLLM.text("The cancelled origin cannot complete.", "mc07-r2-retained-complete-parent"),
    )
    yield* fixture.sessions.prompt({
      sessionID: fixture.root.id,
      text: "Attempt completion of the retained cancellation.",
    })
    yield* awaitWithTimeout(
      fixture.runs.awaitIdle(fixture.root.id),
      "MC07 retained cancellation refusal did not settle",
    )
    expect((yield* mc07Result(fixture, "mc07-r2-retained-complete")).tool.state.status).toBe("error")
    expect(yield* fixture.delegations.foldState(fixture.receipt.delegationID)).toEqual(archived)
    expect(
      yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
        Stream.filter((item) => !Bus.isSynced(item)),
        Stream.runCollect,
      ),
    ).toEqual(before)
    expect(archived?.revisions).toHaveLength(1)
    expect(archived?.reviews).toHaveLength(1)
  }),
)

effectTest.live("MC07 R1 produces a complete artifact and typed review through real Tasks", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build()
    if (fixture.result.tool.state.status !== "completed")
      return yield* Effect.die(new Error("MC07 original Task result is missing"))
    const evidence = Schema.decodeUnknownSync(
      Schema.Struct({
        kind: Schema.Literal("revision"),
        receipt: Delegation.Receipt,
        source: Permission.Source,
        artifact: Schema.Struct({
          path: Schema.String,
          commitSha: Schema.String,
          normalizedDiff: Schema.String,
          revisionDigest: Delegation.RevisionDigest,
          baseSha256: Schema.String,
          targetSha256: Schema.String,
        }),
      }),
    )(fixture.result.tool.state.metadata?.governance)
    expect(evidence.receipt).toEqual(fixture.receipt)
    expect(evidence.source).toEqual({ type: "tool", messageID: fixture.result.assistant.id, id: "mc07-implement" })
    expect(evidence.artifact).toMatchObject({
      path: "artifact.txt",
      normalizedDiff: mc07Diff,
      revisionDigest: fixture.digest,
      baseSha256: "f34848ca92665c342abd5816c9e3eda0e82180671195362bcd0080544a3bc2ac",
      targetSha256: "0e058fda93239ce588dd187f583f54d6e1de2235ff6c6d824b5daf2e52ba1c70",
    })
    expect(Buffer.byteLength(evidence.artifact.normalizedDiff)).toBe(199)
    const head = yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(fixture.root.location.directory).quiet().text())
    expect(evidence.artifact.commitSha).toBe(head.trim())
    const firstRequests = yield* fixture.llm.requests()
    const firstConsumed = firstRequests[3]?.messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-result" && part.id === "mc07-implement")
    expect(firstConsumed).toMatchObject({ result: { type: "text" } })
    if (firstConsumed?.type !== "tool-result" || firstConsumed.result.type !== "text")
      return yield* Effect.die(new Error("MC07 artifact was not consumed"))
    expect(firstConsumed.result.value).toBe(
      fixture.result.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
    )
    expect(firstConsumed.result.value).toContain(JSON.stringify(mc07Diff).slice(1, -1))
    expect(JSON.stringify(firstRequests[3]?.messages)).toContain(fixture.digest)
    const reviewText =
      "Review context " +
      "x".repeat(60000) +
      `\n<review>${JSON.stringify({
        kind: "aigcfroge.review.v1",
        reviewed_revision_digest: fixture.digest,
        verdict: "approved",
        findings: [],
        summary: "The exact R1 is approved.",
      })}</review>`
    const db = (yield* Database.Service).db
    const grants = yield* db.select().from(ScopedGrantTable)
    const bus = yield* Bus.Service
    const releaseReview = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(releaseReview, undefined).pipe(Effect.asVoid))
    yield* fixture.llm.push(
      TestLLM.tool("mc07-review", TaskTool.name, {
        description: "Review the exact R1",
        prompt: "Review the bound artifact and return a typed envelope.",
        subagent_type: fixture.worker,
        delegation_id: fixture.receipt.delegationID,
        intent: "review",
        revision_digest: fixture.digest,
      }),
      Stream.unwrap(
        Deferred.await(releaseReview).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text(reviewText, "mc07-review-answer"))),
        ),
      ),
      TestLLM.text("Consumed the exact typed review.", "mc07-parent-review"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review R1, then report." })
    yield* awaitWithTimeout(fixture.llm.wait(6), "MC07 reviewer did not request its model", "10 seconds")
    const reviewing = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    if (!reviewing) return yield* Effect.die(new Error("MC07 review admission has no state"))
    expect(reviewing.reviews).toEqual([])
    expect(
      DelegationReview.evaluateReviewBarrier({
        participants: [...reviewing.participants.values()],
        reviews: reviewing.reviews,
        revisions: reviewing.revisions,
        latestRevisionDigest: reviewing.delegation.latestRevisionDigest,
        rejectionBlocked: reviewing.delegation.rejectionBlocked,
      }).passed,
    ).toBe(false)
    yield* Deferred.succeed(releaseReview, undefined)
    yield* awaitWithTimeout(fixture.llm.wait(7), "MC07 review did not reach the parent")
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 review parent did not settle")
    const reviewed = yield* mc07Result(fixture, "mc07-review")
    expect(reviewed.tool.state.status).toBe("completed")
    if (reviewed.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 reviewer failed"))
    const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(reviewed.tool.state.metadata?.receipt)
    expect(receipt.participantID).not.toBe(fixture.receipt.participantID)
    const state = yield* fixture.delegations.foldState(receipt.delegationID)
    if (!state) return yield* Effect.die(new Error("MC07 delegation is missing"))
    expect(state.participants.get(receipt.participantID)?.role).toBe("reviewer")
    expect(state.turns.get(receipt.turnID)).toMatchObject({ kind: "review", revisionDigest: fixture.digest })
    expect(state.reviews).toHaveLength(1)
    expect(state.reviews[0]).toMatchObject({
      participantID: receipt.participantID,
      reviewedRevisionDigest: fixture.digest,
      verdict: "approved",
    })
    expect(
      DelegationReview.canComplete({
        participants: [...state.participants.values()],
        reviews: state.reviews,
        revisions: state.revisions,
        latestRevisionDigest: state.delegation.latestRevisionDigest,
        rejectionBlocked: state.delegation.rejectionBlocked,
        deliveries: [...state.deliveries.values()],
        turns: [...state.turns.values()],
      }),
    ).toBe(true)
    expect(state.delegation.status).toBe("approved")
    const requests = yield* fixture.llm.requests()
    const consumed = requests[6]?.messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-result" && part.id === "mc07-review")
    expect(consumed).toMatchObject({ result: { type: "text" } })
    if (consumed?.type !== "tool-result" || consumed.result.type !== "text")
      return yield* Effect.die(new Error("MC07 review was not consumed"))
    expect(consumed.result.value).toBe(
      reviewed.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
    )
    expect(consumed.result.value).toContain(reviewText)
    expect(
      Schema.decodeUnknownSync(DelegationService.Governance)(reviewed.tool.state.metadata?.governance),
    ).toMatchObject({ kind: "review", status: "valid", receipt, reviewedRevisionDigest: fixture.digest })
    const execution = yield* DelegationExecution.Service
    const original = yield* execution.wait(fixture.receipt)
    const originalReview = yield* execution.wait(receipt)
    const before = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(Stream.runCollect)
    for (const owning of [fixture.receipt, receipt])
      expect(
        yield* execution.recover({
          kind: "delegation",
          delegationID: owning.delegationID,
          participantID: owning.participantID,
          childSessionID: owning.childSessionID,
          parentSessionID: fixture.root.id,
          description: "MC07 exact input reentry",
        }),
      ).toMatchObject({ status: "reconciled" })
    expect(yield* execution.wait(fixture.receipt)).toEqual(original)
    expect(yield* execution.wait(receipt)).toEqual(originalReview)
    expect(yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(Stream.runCollect)).toEqual(before)
    expect(yield* db.select().from(ScopedGrantTable)).toEqual(grants)
    for (const wrong of [
      { ...receipt, inputID: fixture.receipt.inputID },
      { ...receipt, childSessionID: fixture.receipt.childSessionID },
      { ...receipt, participantID: fixture.receipt.participantID },
      { ...receipt, deliveryOrigin: "different-origin" },
      { ...receipt, attempt: receipt.attempt + 1 },
    ])
      expect(yield* execution.wait(wrong).pipe(Effect.flip)).toMatchObject({
        _tag: "Delegation.DelegationInvalidStateError",
      })
    expect(yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(Stream.runCollect)).toEqual(before)
  }),
)

effectTest.live("MC07 source rejects retained governance from another source and preserves exact R1 reentry", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build()
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.receipt.childSessionID), "MC07 source child did not settle")
    const execution = yield* DelegationExecution.Service
    const kv = yield* KV.Service
    const database = yield* Database.Service
    const db = database.db
    const bus = yield* Bus.Service
    const row = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, fixture.receipt.inputID))
      .get()
    if (!row) return yield* Effect.die(new Error("MC07 source original Task input is missing"))
    const user = Schema.decodeUnknownSync(SessionMessage.User)({ ...row.data, type: row.type, id: row.id })
    const link = Schema.decodeUnknownSync(Schema.Struct({ parentTaskID: Schema.String, source: Permission.Source }))(
      user.metadata?.task,
    )
    const key = `delegation:task-settlement:${DelegationReceipt.notificationID(fixture.receipt.inputID, link.parentTaskID)}`
    const settlement = yield* kv.get(key)
    const originalBytes = yield* db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${key}`)
    if (settlement === undefined || !originalBytes)
      return yield* Effect.die(new Error("MC07 source original settlement is missing"))
    const retained = Schema.decodeUnknownSync(
      Schema.Struct({ status: Schema.String, revision: Schema.Int, governance: DelegationService.Governance }),
    )(settlement)
    expect(retained.status).toBe("completed")
    expect(retained.governance.receipt).toEqual(fixture.receipt)
    expect(retained.governance.source).toEqual(link.source)
    const original = yield* execution.wait(fixture.receipt)
    expect(original.governance).toEqual(retained.governance)
    const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    if (!state) return yield* Effect.die(new Error("MC07 source original aggregate is missing"))
    expect(state.revisions).toHaveLength(1)
    expect(state.reviews).toEqual([])
    const events = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
      Stream.filter((event) => !Bus.isSynced(event)),
      Stream.runCollect,
    )
    const allEvents = yield* db.select().from(EventTable).orderBy(EventTable.aggregate_id, EventTable.seq).all()
    const grants = yield* db.select().from(ScopedGrantTable).all()
    const parentMessages = yield* fixture.sessions.context(fixture.root.id)
    const childMessages = yield* fixture.sessions.context(fixture.receipt.childSessionID)
    const requests = (yield* fixture.llm.requests()).length
    console.log(
      "MC07 source original evidence",
      JSON.stringify(
        {
          key,
          settlement,
          originalBytes,
          user,
          taskLink: user.metadata?.task,
          original,
          taskResult: fixture.result,
          state,
          events,
          allEvents,
          grants,
          parentMessages,
          childMessages,
          requests,
        },
        (_key, value) => (value instanceof Map ? [...value.entries()] : value),
      ),
    )
    const originalSource = Schema.decodeUnknownSync(Permission.ToolSource)(retained.governance.source)
    const source = { ...originalSource, id: `${originalSource.id}-source-conflict` }
    const conflicting = {
      ...retained,
      governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))({
        ...retained.governance,
        source,
      }),
    }
    yield* kv.set(key, conflicting)
    const conflictingBytes = yield* db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${key}`)
    console.log(
      "MC07 source mutation evidence",
      JSON.stringify({ key, conflicting: yield* kv.get(key), conflictingBytes }),
    )
    expect(conflictingBytes?.value).toBe(
      originalBytes.value.replace(JSON.stringify(retained.governance.source), JSON.stringify(source)),
    )
    const recovery = {
      kind: "delegation" as const,
      ...fixture.receipt,
      parentSessionID: fixture.root.id,
      description: "MC07 source exact R1 reentry",
    }
    const refused = yield* execution.recover(recovery).pipe(Effect.exit)
    const error = Exit.isFailure(refused) ? Cause.squash(refused.cause) : undefined
    const refusedSettlement = yield* kv.get(key)
    const refusedBytes = yield* db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${key}`)
    const refusedResult = yield* execution.wait(fixture.receipt)
    const refusedState = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    const refusedEvents = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
      Stream.filter((event) => !Bus.isSynced(event)),
      Stream.runCollect,
    )
    console.log(
      "MC07 source refusal evidence",
      JSON.stringify(
        {
          exit: refused._tag,
          error,
          cause: Exit.isFailure(refused) ? Cause.pretty(refused.cause) : undefined,
          settlement: refusedSettlement,
          bytes: refusedBytes,
          result: refusedResult,
          state: refusedState,
          events: refusedEvents,
        },
        (_key, value) => (value instanceof Map ? [...value.entries()] : value),
      ),
    )
    expect(Exit.isFailure(refused)).toBe(true)
    expect(error).toBeInstanceOf(Delegation.DelegationInvalidStateError)
    expect(error).toMatchObject({
      delegationID: fixture.receipt.delegationID,
      currentStatus: state.delegation.status,
      attemptedTransition: "govern",
      reason: "Retained governance belongs to a different receipt or source",
    })
    expect(refusedSettlement).toEqual(conflicting)
    expect(refusedBytes).toEqual(conflictingBytes)
    expect(refusedResult.status).toBe(original.status)
    expect(refusedResult.text).toBe(original.text)
    expect(refusedResult.governance).toEqual({ ...retained.governance, source })
    expect(refusedState).toEqual(state)
    expect(refusedEvents).toEqual(events)
    expect(yield* db.select().from(EventTable).orderBy(EventTable.aggregate_id, EventTable.seq).all()).toEqual(
      allEvents,
    )
    expect(yield* db.select().from(ScopedGrantTable).all()).toEqual(grants)
    expect(yield* fixture.sessions.context(fixture.root.id)).toEqual(parentMessages)
    expect(yield* fixture.sessions.context(fixture.receipt.childSessionID)).toEqual(childMessages)
    expect((yield* fixture.llm.requests()).length).toBe(requests)

    // Restoring the private fixture is test arrangement; production recovery already rejected the conflict.
    yield* kv.set(key, settlement)
    const restoredBytes = yield* db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${key}`)
    expect(restoredBytes).toEqual(originalBytes)
    const recovered = yield* execution.recover(recovery)
    expect(recovered).toMatchObject({ status: "reconciled", childSessionID: fixture.receipt.childSessionID })
    const restored = yield* execution.wait(fixture.receipt)
    const restoredSettlement = yield* kv.get(key)
    const restoredState = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    const restoredEvents = yield* bus.log({ aggregateID: fixture.receipt.delegationID }).pipe(
      Stream.filter((event) => !Bus.isSynced(event)),
      Stream.runCollect,
    )
    expect(restored).toEqual(original)
    expect(restoredSettlement).toEqual(settlement)
    expect(yield* db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${key}`)).toEqual(originalBytes)
    expect(restoredState).toEqual(state)
    expect(restoredEvents).toEqual(events)
    expect(yield* db.select().from(EventTable).orderBy(EventTable.aggregate_id, EventTable.seq).all()).toEqual(
      allEvents,
    )
    expect(yield* db.select().from(ScopedGrantTable).all()).toEqual(grants)
    expect(yield* fixture.sessions.context(fixture.root.id)).toEqual(parentMessages)
    expect(yield* fixture.sessions.context(fixture.receipt.childSessionID)).toEqual(childMessages)
    expect((yield* fixture.llm.requests()).length).toBe(requests)
    console.log(
      "MC07 source restored evidence",
      JSON.stringify(
        {
          recovered,
          settlement: restoredSettlement,
          bytes: restoredBytes,
          result: restored,
          state: restoredState,
          events: restoredEvents,
          delegationEventsBefore: events.length,
          delegationEventsAfterRefusal: refusedEvents.length,
          delegationEventsAfterRestore: restoredEvents.length,
          allEvents: yield* db.select().from(EventTable).orderBy(EventTable.aggregate_id, EventTable.seq).all(),
          grants: yield* db.select().from(ScopedGrantTable).all(),
          taskResult: yield* mc07Result(fixture, "mc07-implement"),
          requests: (yield* fixture.llm.requests()).length,
        },
        (_key, value) => (value instanceof Map ? [...value.entries()] : value),
      ),
    )
  }),
)

effectTest.live("MC07 R1 rejects review admission before a real revision exists", () =>
  Effect.gen(function* () {
    const fixture = yield* metaSetup()
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const delegations = yield* DelegationService.Service
    const selected = yield* delegations.resolve({
      parentSessionID: fixture.root.id,
      agent: fixture.root.agent,
      title: "MC07 no revision",
    })
    yield* fixture.llm.push(
      TestLLM.tool("mc07-early-review", TaskTool.name, {
        description: "Review a missing R1",
        prompt: "Review the requested revision.",
        subagent_type: fixture.worker,
        delegation_id: selected.delegation.id,
        intent: "review",
        revision_digest: `rev_${"0".repeat(64)}`,
      }),
      TestLLM.text("The input has no revision.", "mc07-no-revision"),
      TestLLM.text("Review was refused.", "mc07-no-revision-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review before R1 exists." })
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 missing-R1 parent did not settle")
    const result = yield* mc07Result(fixture, "mc07-early-review")
    expect(result.tool.state.status).toBe("error")
    const state = yield* delegations.foldState(selected.delegation.id)
    expect(state?.turns.size).toBe(0)
    expect(state?.deliveries.size).toBe(0)
    expect(
      [...(state?.participants.values() ?? [])].flatMap((participant) =>
        participant.childSessionID ? [participant.childSessionID] : [],
      ),
    ).toEqual([])
  }),
)

for (const invalid of ["missing", "malformed", "wrong_digest"] as const)
  effectTest.live(`MC07 R1 keeps ${invalid} review invalid after completed transport`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const text =
        invalid === "missing"
          ? "Approved without an envelope."
          : invalid === "malformed"
            ? "<review>{broken}</review>"
            : `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: `rev_${"f".repeat(64)}`, verdict: "approved", findings: [], summary: "Wrong artifact." })}</review>`
      yield* fixture.llm.push(
        TestLLM.tool("mc07-invalid-review", TaskTool.name, {
          description: "Validate one review",
          prompt: "Return your review.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          intent: "review",
          revision_digest: fixture.digest,
        }),
        TestLLM.text(text, "mc07-invalid-answer"),
        TestLLM.text("Review is invalid.", "mc07-invalid-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Validate the reviewer output." })
      yield* awaitWithTimeout(fixture.llm.wait(7), "MC07 invalid review did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 invalid review did not settle")
      const result = yield* mc07Result(fixture, "mc07-invalid-review")
      expect(result.tool.state.status).toBe("completed")
      if (result.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 transport did not complete"))
      expect(result.tool.state.metadata?.governance).toMatchObject({
        kind: "review",
        status: "invalid",
        reason: invalid,
      })
      const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(state?.reviews).toEqual([])
      expect(state?.delegation.status).not.toBe("approved")
      expect([...(state?.deliveries.values() ?? [])].every((delivery) => delivery.status === "completed")).toBe(true)
    }),
  )

effectTest.live("MC07 R1 read deny prevents artifact bytes and child input admission", () =>
  Effect.gen(function* () {
    const fixture = yield* metaSetup(
      Agent.ID.make("keeper-worker"),
      false,
      Agent.ID.make("meta"),
      "app-server",
      "artifact.txt",
    )
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "deny" },
      ],
    })
    const locations = yield* LocationServiceMap.Service
    const environment = yield* Environment.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
    const reads: string[] = []
    const read = environment.files.read
    const observedRead: Environment.Files["read"] = (file, range) => {
      reads.push(file)
      return read(file, range)
    }
    Object.assign(environment.files, { read: observedRead })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Object.assign(environment.files, { read })
      }),
    )
    yield* fixture.llm.push(
      TestLLM.tool("mc07-denied-artifact", TaskTool.name, {
        description: "Read one denied artifact",
        prompt: "Finish this artifact.",
        subagent_type: fixture.worker,
        artifact_path: "artifact.txt",
      }),
      TestLLM.text("The read boundary denied this artifact.", "mc07-denied-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Attempt the declared artifact." })
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 denied artifact did not settle")
    const result = yield* mc07Result(fixture, "mc07-denied-artifact")
    expect(result.tool.state.status).toBe("error")
    expect(reads.filter((file) => file.endsWith("/artifact.txt"))).toEqual([])
    const delegations = yield* DelegationService.Service
    const states = yield* delegations.list({ parentSessionID: fixture.root.id })
    expect(states.flatMap((state) => state.revisions)).toEqual([])
    for (const state of states)
      for (const participant of state.participants.values())
        if (participant.childSessionID)
          expect(
            (yield* fixture.sessions.context(participant.childSessionID)).filter((message) => message.type === "user"),
          ).toEqual([])
    expect(yield* fixture.llm.requests()).toHaveLength(2)
  }),
)

for (const terminal of ["failed", "cancelled"] as const)
  effectTest.live(`MC07 R1 ${terminal} reviewer produces no approval or grant`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build()
      const db = (yield* Database.Service).db
      const grants = yield* db.select().from(ScopedGrantTable)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-terminal-review", TaskTool.name, {
          description: "Review before termination",
          prompt: "Return your typed review.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          intent: "review",
          revision_digest: fixture.digest,
        }),
        terminal === "failed"
          ? TestLLM.failAfter(
              new AIError({
                reason: new InvalidRequestError({ message: "MC07 reviewer failed", body: "controlled failure" }),
              }),
            )
          : TestLLM.hangAfter(),
        TestLLM.text("Reviewer did not approve.", "mc07-terminal-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Start the reviewer." })
      yield* awaitWithTimeout(fixture.llm.wait(6), "MC07 terminal reviewer did not start", "10 seconds")
      if (terminal === "cancelled") {
        const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
        const reviewer = [...(state?.participants.values() ?? [])].find(
          (participant) => participant.role === "reviewer",
        )
        if (!reviewer) return yield* Effect.die(new Error("MC07 reviewer is missing"))
        const execution = yield* DelegationExecution.Service
        yield* execution.interrupt({ delegationID: fixture.receipt.delegationID, participantID: reviewer.id })
      }
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 terminal reviewer did not settle")
      const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(state?.reviews).toEqual([])
      expect(state?.delegation.status).not.toBe("approved")
      expect(
        [...(state?.deliveries.values() ?? [])].find(
          (delivery) => delivery.participantID !== fixture.receipt.participantID,
        )?.status,
      ).toBe(terminal)
      expect(yield* db.select().from(ScopedGrantTable)).toEqual(grants)
      const result = yield* mc07Result(fixture, "mc07-terminal-review")
      expect(result.tool.state.status).toBe("completed")
      if (result.tool.state.status !== "completed")
        return yield* Effect.die(new Error("MC07 terminal Task result is missing"))
      expect(result.tool.state.metadata?.status).toBe(terminal)
      expect(result.tool.state.metadata?.governance).toBeUndefined()
    }),
  )

effectTest.live("MC07 R1 subdirectory review respects the declared file read deny", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build("artifact.txt", "sub")
    const before = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    if (!before) return yield* Effect.die(new Error("MC07 subdirectory R1 is missing"))
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "deny" },
      ],
    })
    yield* fixture.llm.push(
      TestLLM.tool("mc07-sub-review", TaskTool.name, {
        description: "Review a denied subdirectory artifact",
        prompt: "Review this R1.",
        subagent_type: fixture.worker,
        delegation_id: fixture.receipt.delegationID,
        intent: "review",
        revision_digest: fixture.digest,
      }),
      TestLLM.text("Read permission refused review.", "mc07-sub-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Try reviewing the subdirectory artifact." })
    yield* awaitWithTimeout(
      fixture.runs.awaitIdle(fixture.root.id),
      "MC07 subdirectory deny did not settle",
      "10 seconds",
    )
    expect((yield* mc07Result(fixture, "mc07-sub-review")).tool.state.status).toBe("error")
    const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    expect(state?.turns).toEqual(before.turns)
    expect(state?.deliveries).toEqual(before.deliveries)
    expect(state?.participants).toEqual(before.participants)
    expect(state?.reviews).toEqual([])
    expect(yield* fixture.llm.requests()).toHaveLength(6)
  }),
)

effectTest.live("MC07 R2 rejects restored HEAD bytes before admitting another child input", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build()
    yield* fixture.llm.push(
      TestLLM.tool("mc07-restore-baseline", "write", { path: "artifact.txt", content: "base\n" }),
      TestLLM.text("Restored the fixture baseline.", "mc07-restored"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Restore the tracked file to its baseline." })
    yield* awaitWithTimeout(
      fixture.runs.awaitIdle(fixture.root.id),
      "MC07 baseline restore did not settle",
      "10 seconds",
    )
    yield* fixture.llm.push(
      TestLLM.tool("mc07-conflict", TaskTool.name, {
        description: "Produce the same bytes again",
        prompt: "Write the original R1 bytes and finish.",
        subagent_type: fixture.worker,
        artifact_path: "artifact.txt",
        delegation_id: fixture.receipt.delegationID,
        task_id: fixture.receipt.childSessionID,
      }),
      TestLLM.text("The new producing input was refused.", "mc07-conflict-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Attempt the same R1 with a new input." })
    yield* awaitWithTimeout(
      fixture.runs.awaitIdle(fixture.root.id),
      "MC07 owner conflict left the parent waiting",
      "10 seconds",
    )
    const result = yield* mc07Result(fixture, "mc07-conflict")
    expect(result.tool.state.status).toBe("error")
    if (result.tool.state.status !== "error") return yield* Effect.die(new Error("MC07 conflict refusal is missing"))
    expect(result.tool.state.error.message).toContain("Artifact path differs from the latest accepted revision")
    const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    expect(state?.revisions).toHaveLength(1)
    expect(state?.delegation.latestRevisionDigest).toBe(fixture.digest)
    expect(state?.reviews).toEqual([])
    expect(
      (yield* fixture.sessions.context(fixture.receipt.childSessionID))
        .filter((message) => message.type === "user")
        .map((message) => message.id),
    ).toEqual([fixture.receipt.inputID])
    const requests = yield* fixture.llm.requests()
    expect(requests).toHaveLength(8)
    const consumed = requests[7]?.messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-result" && part.id === "mc07-conflict")
    if (consumed?.type !== "tool-result" || consumed.result.type !== "error")
      return yield* Effect.die(new Error("MC07 parent did not consume the conflict"))
    expect(consumed.result.value).toEqual({ error: result.tool.state.error, content: result.tool.state.content ?? [] })
  }),
)

effectTest.live("MC07 R1 capture read ask reject exits and preserves its failed reentry", () =>
  Effect.gen(function* () {
    const fixture = yield* metaSetup(
      Agent.ID.make("keeper-worker"),
      false,
      Agent.ID.make("meta"),
      "app-server",
      "artifact.txt",
    )
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const locations = yield* LocationServiceMap.Service
    const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ location: fixture.root.location, custom: false })
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* fixture.llm.push(
      TestLLM.tool("mc07-ask-artifact", TaskTool.name, {
        description: "Capture with current read permission",
        prompt: "Write the artifact, then finish.",
        subagent_type: fixture.worker,
        artifact_path: "artifact.txt",
      }),
      TestLLM.tool("mc07-ask-write", "write", { path: "artifact.txt", content: "base\nr1\n" }),
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text("Artifact written.", "mc07-ask-child"))),
        ),
      ),
      TestLLM.text("Capture did not pass its read permission.", "mc07-ask-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Capture the finite artifact." })
    yield* awaitWithTimeout(fixture.llm.wait(3), "MC07 capture child did not reach final response", "10 seconds")
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "ask" },
      ],
    })
    yield* Deferred.succeed(release, undefined)
    const request = yield* pollWithTimeout(
      permission
        .forSession(fixture.root.id)
        .pipe(Effect.map((requests) => requests.find((request) => request.action === "read"))),
      "MC07 capture did not request current read permission",
      "10 seconds",
    )
    expect(request.resources).toEqual(["artifact.txt"])
    yield* permission.reply({ requestID: request.id, reply: "reject" })
    yield* awaitWithTimeout(
      fixture.runs.awaitIdle(fixture.root.id),
      "MC07 rejected capture left the parent waiting",
      "10 seconds",
    )
    const result = yield* mc07Result(fixture, "mc07-ask-artifact")
    expect(result.tool.state.status).toBe("completed")
    if (result.tool.state.status !== "completed")
      return yield* Effect.die(new Error("MC07 rejected capture result is missing"))
    expect(result.tool.state.metadata?.status).toBe("failed")
    expect(result.tool.state.metadata?.governance).toBeUndefined()
    const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
    const delegations = yield* DelegationService.Service
    const state = yield* delegations.foldState(receipt.delegationID)
    expect(state?.revisions).toEqual([])
    expect(state?.reviews).toEqual([])
    const bus = yield* Bus.Service
    const before = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(Stream.runCollect)
    const execution = yield* DelegationExecution.Service
    yield* execution.recover({
      kind: "delegation",
      delegationID: receipt.delegationID,
      participantID: receipt.participantID,
      childSessionID: receipt.childSessionID,
      parentSessionID: fixture.root.id,
      description: "MC07 rejected read reentry",
    })
    expect(yield* bus.log({ aggregateID: receipt.delegationID }).pipe(Stream.runCollect)).toEqual(before)
    expect(yield* permission.forSession(fixture.root.id)).toEqual([])
    const database = yield* Database.Service
    expect(yield* database.db.select().from(ScopedGrantTable)).toEqual([])
  }),
)

for (const failure of ["failure", "interruption", "mixed"] as const)
  effectTest.live(`MC07 R1 classifies ${failure} capture cause at the real settlement boundary`, () =>
    Effect.gen(function* () {
      const fixture = yield* metaSetup(
        Agent.ID.make("keeper-worker"),
        false,
        Agent.ID.make("meta"),
        "app-server",
        "artifact.txt",
      )
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* fixture.llm.push(
        TestLLM.tool("mc07-cause-artifact", TaskTool.name, {
          description: "Capture one tracked artifact",
          prompt: "Write the tracked file and finish.",
          subagent_type: fixture.worker,
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-cause-write", "write", { path: "artifact.txt", content: "base\nr1\n" }),
        Stream.unwrap(
          Deferred.await(release).pipe(Effect.as(Stream.fromIterable(TestLLM.text("Written.", "mc07-cause-child")))),
        ),
        TestLLM.text("The capture stopped.", "mc07-cause-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Run the finite capture." })
      yield* awaitWithTimeout(fixture.llm.wait(3), "MC07 cause fixture did not finish writing", "10 seconds")
      const locations = yield* LocationServiceMap.Service
      const environment = yield* Environment.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
      const read = environment.files.read
      const defect = Cause.die(new Error("MC07 capture failed"))
      const cause =
        failure === "interruption"
          ? Cause.interrupt()
          : failure === "mixed"
            ? Cause.combine(defect, Cause.interrupt())
            : defect
      const observedRead: Environment.Files["read"] = (file, range) =>
        file === path.join(fixture.root.location.directory, "artifact.txt")
          ? Effect.failCause(cause)
          : read(file, range)
      Object.assign(environment.files, { read: observedRead })
      yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(environment.files, { read })))
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(
        fixture.runs.awaitIdle(fixture.root.id),
        "MC07 failed capture left its parent waiting",
        "10 seconds",
      )
      const result = yield* mc07Result(fixture, "mc07-cause-artifact")
      if (result.tool.state.status !== "completed") return yield* Effect.die(new Error("MC07 cause result is missing"))
      expect(result.tool.state.metadata?.status).toBe(failure === "interruption" ? "cancelled" : "failed")
      expect(result.tool.state.metadata?.governance).toBeUndefined()
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(result.tool.state.metadata?.receipt)
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(receipt.delegationID)
      expect(state?.revisions).toEqual([])
      expect(state?.reviews).toEqual([])
      expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual([
        failure === "interruption" ? "cancelled" : "failed",
      ])
    }),
  )

effectTest.live("uses the Location default model for an ordinary Build with omitted Session model", () =>
  Effect.gen(function* () {
    const f = yield* metaSetup()
    const locations = yield* LocationServiceMap.Service
    const models = yield* Model.Service.pipe(Effect.provide(locations.get(f.root.location)))
    const original = yield* models.default()
    expect(original).toBeDefined()
    const selected = original?.id === f.metaModel.id ? f.executorModel : f.metaModel
    expect(String(selected.id)).not.toBe(String(original?.id))
    yield* models.transform((editor) => editor.default.set(selected.providerID, selected.id))
    const root = yield* f.sessions.create({
      location: f.root.location,
      agent: Agent.ID.make("build"),
      title: "Default model keeper",
    })
    expect(root.model).toBeUndefined()
    expect(root.controller).toBeUndefined()
    expect(root.executorPreference).toBeUndefined()
    yield* f.llm.push(TestLLM.text("Location default answer", "default-answer"))
    const input = yield* f.sessions.prompt({ sessionID: root.id, text: "Use the configured default." })
    yield* awaitWithTimeout(f.llm.wait(1), "The default model was not called", "10 seconds")
    yield* awaitWithTimeout(f.runs.awaitIdle(root.id), "The default model did not settle", "10 seconds")
    const requests = yield* f.llm.requests()
    expect(requests).toHaveLength(1)
    expect(String(requests[0]?.model.id)).toBe(String(selected.id))
    expect(String(requests[0]?.model.provider)).toBe(String(selected.providerID))
    const database = yield* Database.Service
    expect(yield* SessionInputResult.read(database.db, { sessionID: root.id, inputID: input.id })).toMatchObject({
      status: "completed",
      assistant: { model: selected, needsContinuation: false },
    })
    expect(yield* f.sessions.inbox(root.id)).toEqual([])
    expect((yield* f.sessions.list({ parentID: root.id })).data).toEqual([])
    expect(
      yield* database.db.select().from(MetaAgentSessionTable).where(eq(MetaAgentSessionTable.session_id, root.id)),
    ).toEqual([])
  }),
)

for (const selection of ["omitted", "explicit"] as const)
  effectTest.live(
    selection === "omitted"
      ? "rejects omitted model when the Location has no available models"
      : "keeps an explicit unavailable model instead of using the Location default",
    () =>
      Effect.gen(function* () {
        const f = yield* metaSetup()
        const locations = yield* LocationServiceMap.Service
        const local = locations.get(f.root.location)
        const models = yield* Model.Service.pipe(Effect.provide(local))
        if (selection === "omitted") {
          yield* useOfflineCatalog([]).pipe(Effect.provide(local))
          expect(yield* models.available()).toEqual([])
        }
        if (selection === "explicit") {
          yield* models.transform((editor) => editor.default.set(f.executorModel.providerID, f.executorModel.id))
          expect(yield* models.default()).toMatchObject({
            providerID: f.executorModel.providerID,
            id: f.executorModel.id,
          })
        }
        const requested =
          selection === "explicit"
            ? Model.Ref.make({ providerID: f.metaModel.providerID, id: Model.ID.make("unavailable") })
            : undefined
        const root = yield* f.sessions.create({
          location: f.root.location,
          agent: Agent.ID.make("build"),
          model: requested,
          title: `Unavailable ${selection} model keeper`,
        })
        if (requested) expect(root.model).toMatchObject(requested)
        const input = yield* f.sessions.prompt({ sessionID: root.id, text: "Use the selected model.", resume: false })
        const error = yield* f.runs.resume(root.id).pipe(Effect.flip)
        expect(error).toMatchObject(
          selection === "omitted"
            ? { _tag: "SessionRunnerModel.ModelNotSelectedError", sessionID: root.id }
            : {
                _tag: "SessionRunnerModel.ModelUnavailableError",
                providerID: requested?.providerID,
                modelID: requested?.id,
              },
        )
        expect(yield* f.llm.requests()).toEqual([])
        const database = yield* Database.Service
        expect(yield* SessionInputResult.read(database.db, { sessionID: root.id, inputID: input.id })).toMatchObject({
          status: "failed",
        })
        expect((yield* f.sessions.get(root.id)).model).toEqual(root.model)
        expect((yield* f.sessions.list({ parentID: root.id })).data).toEqual([])
        expect(
          yield* database.db.select().from(MetaAgentSessionTable).where(eq(MetaAgentSessionTable.session_id, root.id)),
        ).toEqual([])
      }),
  )

effectTest.live("adopts a successful Meta fork after source drift and rejects a new stale preview", () =>
  Effect.gen(function* () {
    const f = yield* metaSetup()
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Original context", resume: false })
    yield* SessionInbox.promote(db, bus, f.root.id, "steer")
    const expectedSource = new SessionSchema.ForkExpectedSource({
      sourceSessionID: f.root.id,
      mode: f.root.mode,
      agent: f.root.agent,
      controller: f.root.controller,
      model: f.root.model,
    })
    const fork = yield* f.sessions.fork({ sessionID: f.root.id, control: "meta", expectedSource })
    yield* f.sessions.switchModel({ sessionID: f.root.id, model: f.executorModel })
    yield* f.sessions.selectExecutor({
      sessionID: f.root.id,
      executorPreference: new MetaAgent.ExecutorPreference({ agent: f.worker, model: f.metaModel }),
    })
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Later context", resume: false })
    yield* SessionInbox.promote(db, bus, f.root.id, "steer")
    const before = yield* Effect.all({
      sessions: db.select().from(SessionTable),
      events: db.select().from(EventTable),
      metas: db.select().from(MetaAgentTable),
      links: db.select().from(MetaAgentSessionTable),
    })
    expect(yield* f.sessions.fork({ id: fork.id, sessionID: f.root.id, control: "meta", expectedSource })).toEqual(fork)
    expect(
      (yield* f.sessions.context(fork.id)).map((message) => (message.type === "user" ? message.text : undefined)),
    ).toEqual(["Original context"])
    expect(
      yield* f.sessions.fork({ sessionID: f.root.id, control: "meta", expectedSource }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "fork_source_conflict", field: "expectedSource" })
    expect(
      yield* Effect.all({
        sessions: db.select().from(SessionTable),
        events: db.select().from(EventTable),
        metas: db.select().from(MetaAgentTable),
        links: db.select().from(MetaAgentSessionTable),
      }),
    ).toEqual(before)
  }),
)

for (const worker of ["keeper-worker", "build"] as const)
  effectTest.live(
    `runs a real Meta task through a durable receipt and root continuation (${worker})`,
    () =>
      Effect.gen(function* () {
        const f = yield* metaSetup(Agent.ID.make(worker))
        if (f.root.controller?.kind !== "root") return yield* Effect.die(new Error("Meta root is missing"))
        const controller = f.root.controller
        const callID = "call-meta-task"
        const text = "Worker finished the entire task."
        yield* f.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: "Review complete task",
            prompt: "Return the complete result.",
            subagent_type: f.worker,
          }),
          TestLLM.text(text, "worker-answer"),
          TestLLM.text("Task completed.", "root-answer"),
        )
        const admitted = yield* f.sessions.prompt({ sessionID: f.root.id, text: "Delegate, then report the result." })
        yield* awaitWithTimeout(f.llm.wait(3), "Meta did not consume the task receipt", "10 seconds")
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Meta did not settle", "10 seconds")
        const messages = yield* f.sessions.context(f.root.id)
        const assistant = messages.find(
          (message): message is SessionMessage.Assistant =>
            message.type === "assistant" && message.content.some((item) => item.type === "tool" && item.id === callID),
        )
        const tool = assistant?.content.find(
          (item): item is SessionMessage.AssistantTool => item.type === "tool" && item.id === callID,
        )
        if (!assistant || tool?.state.status !== "completed")
          return yield* Effect.die(new Error("Durable task result is missing"))
        const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(tool.state.metadata?.receipt)
        expect(receipt).toMatchObject({
          deliveryOrigin: "meta",
          senderParticipantID: receipt.participantID,
          attempt: 1,
        })
        expect(receipt.inputID).toBe(DelegationExecution.inputID(receipt.delegationID, receipt))
        const child = yield* f.sessions.get(receipt.childSessionID)
        expect(child).toMatchObject({
          parentID: f.root.id,
          agent: f.worker,
          model: f.executorModel,
          controller: {
            kind: "child",
            metaAgentID: controller.metaAgentID,
            rootSessionID: f.root.id,
            executor: { agent: f.worker, model: f.executorModel, source: "preference" },
            source: { kind: "task", delegationID: receipt.delegationID, participantID: receipt.participantID },
          },
        })
        const input = yield* f.sessions.message({ sessionID: child.id, messageID: receipt.inputID })
        if (input?.type !== "user") return yield* Effect.die(new Error("Worker input is missing"))
        expect(input.metadata?.delegation).toMatchObject({
          delegationID: receipt.delegationID,
          turnID: receipt.turnID,
          participantID: receipt.participantID,
          deliveryOrigin: receipt.deliveryOrigin,
          senderParticipantID: receipt.senderParticipantID,
          attempt: receipt.attempt,
        })
        const link = Schema.decodeUnknownSync(
          Schema.Struct({ parentTaskID: Schema.String, parentTaskRevision: Schema.Int, source: Permission.Source }),
        )(input.metadata?.task)
        expect(link.source).toEqual({ type: "tool", messageID: assistant.id, id: callID })
        const db = (yield* Database.Service).db
        expect(yield* SessionInputResult.read(db, { sessionID: child.id, inputID: receipt.inputID })).toMatchObject({
          status: "completed",
          assistant: { model: f.executorModel, needsContinuation: false },
        })
        const execution = yield* DelegationExecution.Service
        expect(yield* execution.wait(receipt)).toEqual({ status: "completed", text })
        const delegations = yield* DelegationService.Service
        const state = yield* delegations.foldState(receipt.delegationID)
        expect(state?.delegation).toMatchObject({ parentSessionID: f.root.id, metaAgentID: controller.metaAgentID })
        expect(state?.participants.get(receipt.participantID)).toMatchObject({
          childSessionID: child.id,
          executor: child.controller?.kind === "child" ? child.controller.executor : undefined,
        })
        expect(
          state?.deliveries.get(
            DelegationFold.deliveryKey(
              receipt.turnID,
              receipt.participantID,
              receipt.deliveryOrigin,
              receipt.senderParticipantID,
            ),
          ),
        ).toMatchObject({ status: "completed", attempt: 1 })
        const tasks = yield* SessionTask.Service
        expect((yield* tasks.get(f.root.id)).find((item) => item.id === link.parentTaskID)).toMatchObject({
          status: "completed",
          revision: link.parentTaskRevision + 1,
        })
        const requests = yield* f.llm.requests()
        expect(requests).toHaveLength(3)
        expect(requests.map((request) => String(request.model.id))).toEqual([
          String(f.metaModel.id),
          String(f.executorModel.id),
          String(f.metaModel.id),
        ])
        const expected = `<task id="${child.id}" state="completed">\n<task_result>\n${text}\n</task_result>\n</task>`
        expect(
          requests[2]?.messages
            .filter((message) => message.role === "tool")
            .flatMap((message) => message.content)
            .find((item) => item.type === "tool-result" && item.id === callID),
        ).toMatchObject({ result: { type: "text", value: expected } })
        expect(yield* SessionInputResult.read(db, { sessionID: f.root.id, inputID: admitted.id })).toMatchObject({
          status: "completed",
          assistant: { model: f.metaModel, needsContinuation: false },
        })
        const metas = yield* MetaAgentService.Service
        yield* metas.assertOwner(f.root)
        yield* metas.assertOwner(child)
        const steps = yield* db
          .select()
          .from(MetaAgentStepTable)
          .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID))
        expect(
          steps.filter(
            (step) =>
              step.event_type !== SessionEvent.Attempt.Started.type &&
              step.event_type !== SessionEvent.Attempt.Ended.type,
          ),
        ).toHaveLength(8)
        expect(steps.filter((step) => step.event_type === SessionEvent.Attempt.Started.type)).toHaveLength(
          requests.length,
        )
        expect(steps.filter((step) => step.event_type === SessionEvent.Attempt.Ended.type)).toHaveLength(
          requests.length,
        )
        expect(steps.find((step) => step.type === "receipt")).toMatchObject({
          root_session_id: f.root.id,
          meta_agent_session_id: f.root.id,
          tool_call_id: callID,
          engine: "task",
          provenance: { receipt: { ...receipt, source: link.source } },
        })
        const bus = yield* Bus.Service
        const events = yield* f.sessions.log({ sessionID: f.root.id }).pipe(Stream.runCollect)
        const success = events.find(
          (event): event is SessionEvent.Tool.Success =>
            !Bus.isSynced(event) && event.type === SessionEvent.Tool.Success.type,
        )
        if (!success) return yield* Effect.die(new Error("Task success event is missing"))
        const completed = steps.find((step) => step.event_id === success.id)
        if (!completed) return yield* Effect.die(new Error("Real task success Meta step is missing"))
        expect(completed).toMatchObject({
          status: "completed",
          event_type: SessionEvent.Tool.Success.type,
          event_id: success.id,
          event_seq: success.durable.seq,
          meta_agent_session_id: f.root.id,
          assistant_message_id: success.data.assistantMessageID,
          tool_call_id: callID,
        })
        expect(yield* db.select().from(EventTable).where(eq(EventTable.id, success.id)).get()).toMatchObject({
          id: success.id,
          aggregate_id: f.root.id,
          seq: success.durable.seq,
          type: Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
          data: Schema.encodeSync(SessionEvent.Tool.Success.data)(success.data),
        })
        const memory = yield* MetaAgentMemory.Service
        const memoryID = yield* memory.record({
          id: `mem_real_task_success_${worker}`,
          sessionID: f.root.id,
          projectID: f.root.projectID,
          factCategory: "workflow",
          content: "The real Task result was recorded from its completed producer.",
          sourceSessionID: f.root.id,
          sourceStepID: completed.id,
        })
        expect(
          yield* db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, memoryID)).get(),
        ).toMatchObject({
          id: memoryID,
          meta_agent_id: controller.metaAgentID,
          source_session_id: f.root.id,
          source_step_id: completed.id,
        })
        yield* metas.materialize(success)
        expect(
          yield* db
            .select()
            .from(MetaAgentStepTable)
            .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID)),
        ).toEqual(steps)
        const unrelatedAssistant = messages.find(
          (message) => message.type === "assistant" && message.id !== assistant.id,
        )
        if (!unrelatedAssistant) return yield* Effect.die(new Error("Root continuation assistant is missing"))
        yield* metas.materialize({
          ...success,
          id: Event.ID.create(),
          data: { ...success.data, assistantMessageID: unrelatedAssistant.id },
        })
        expect(
          yield* db
            .select()
            .from(MetaAgentStepTable)
            .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID)),
        ).toEqual(steps)
        yield* execution.wait(receipt)
        expect((yield* tasks.get(f.root.id)).find((item) => item.id === link.parentTaskID)?.revision).toBe(
          link.parentTaskRevision + 1,
        )
        const starts = events.filter(
          (event): event is SessionEvent.Step.Started | SessionEvent.Tool.Called =>
            !Bus.isSynced(event) &&
            (event.type === SessionEvent.Step.Started.type || event.type === SessionEvent.Tool.Called.type),
        )
        const beforeStats = yield* metas.stats(controller.metaAgentID)
        for (const start of starts) yield* metas.materialize({ ...start, id: Event.ID.create() })
        expect(
          yield* db
            .select()
            .from(MetaAgentStepTable)
            .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID)),
        ).toHaveLength(steps.length + starts.length)
        expect(yield* metas.stats(controller.metaAgentID)).toEqual(beforeStats)
        expect(beforeStats.physicalAttemptCoverage).toBe("unknown")
        const decoy = yield* f.sessions.prompt({
          sessionID: child.id,
          text: input.text,
          metadata: input.metadata,
          resume: false,
        })
        expect(decoy.id).not.toBe(receipt.inputID)
        expect((yield* f.sessions.inbox(child.id)).find((item) => item.id === decoy.id)).toBeDefined()
        yield* bus.publish(SessionEvent.Tool.Success, {
          ...success.data,
          metadata: { ...success.data.metadata, receipt: { ...receipt, inputID: decoy.id } },
        })
        expect(
          (yield* db
            .select()
            .from(MetaAgentStepTable)
            .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID))).filter(
            (step) => step.type === "receipt",
          ),
        ).toHaveLength(1)
      }),
    30_000,
  )

effectTest.live(
  "MC05 keeps two implementers and later work in the same durable delegation",
  () =>
    Effect.gen(function* () {
      const f = yield* metaSetup()
      if (f.root.controller?.kind !== "root") return yield* Effect.die(new Error("Meta root is missing"))
      const controller = f.root.controller
      const calls = [
        { id: "mc05-first", agent: f.worker, prompt: "Produce the first result.", result: "First worker result." },
        {
          id: "mc05-second",
          agent: Agent.ID.make("build"),
          prompt: "Produce a separate result.",
          result: "Build result.",
        },
        {
          id: "mc05-followup",
          agent: f.worker,
          prompt: "Continue the first result.",
          result: "First worker continued.",
        },
      ]
      yield* f.llm.push(
        ...calls.flatMap((call) => [
          TestLLM.tool(call.id, TaskTool.name, {
            description: call.prompt,
            prompt: call.prompt,
            subagent_type: call.agent,
            model: f.executorModel,
          }),
          TestLLM.text(call.result, `${call.id}-answer`),
        ]),
        TestLLM.text("Both workers completed; the first worker continued in place.", "mc05-root-answer"),
      )
      const admitted = yield* f.sessions.prompt({
        sessionID: f.root.id,
        text: "Coordinate two workers and continue one.",
      })
      yield* awaitWithTimeout(f.llm.wait(7), "MC05 did not consume all three Task results", "10 seconds")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "MC05 root did not settle", "10 seconds")

      const messages = yield* f.sessions.context(f.root.id)
      const db = (yield* Database.Service).db
      const tasks = yield* SessionTask.Service
      const taskRows = yield* tasks.get(f.root.id)
      const rows = yield* Effect.forEach(calls, (call) =>
        Effect.gen(function* () {
          const assistant = messages.find(
            (message): message is SessionMessage.Assistant =>
              message.type === "assistant" &&
              message.content.some((item) => item.type === "tool" && item.id === call.id),
          )
          const tool = assistant?.content.find(
            (item): item is SessionMessage.AssistantTool => item.type === "tool" && item.id === call.id,
          )
          if (!assistant || tool?.state.status !== "completed")
            return yield* Effect.die(new Error(`MC05 Task result is missing: ${call.id}`))
          const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(tool.state.metadata?.receipt)
          const child = yield* f.sessions.get(receipt.childSessionID)
          expect(child).toMatchObject({
            parentID: f.root.id,
            agent: call.agent,
            model: f.executorModel,
            controller: {
              kind: "child",
              metaAgentID: controller.metaAgentID,
              rootSessionID: f.root.id,
              executor: { agent: call.agent, model: f.executorModel, source: "tool" },
              source: { kind: "task", delegationID: receipt.delegationID, participantID: receipt.participantID },
            },
          })
          expect(receipt).toMatchObject({
            deliveryOrigin: "meta",
            senderParticipantID: receipt.participantID,
            attempt: 1,
          })
          expect(receipt.inputID).toBe(DelegationExecution.inputID(receipt.delegationID, receipt))
          const input = yield* f.sessions.message({ sessionID: child.id, messageID: receipt.inputID })
          if (input?.type !== "user") return yield* Effect.die(new Error(`MC05 child input is missing: ${call.id}`))
          expect(input.text).toBe(call.prompt)
          expect(input.metadata?.delegation).toMatchObject({
            delegationID: receipt.delegationID,
            turnID: receipt.turnID,
            participantID: receipt.participantID,
            deliveryOrigin: receipt.deliveryOrigin,
            senderParticipantID: receipt.senderParticipantID,
            attempt: receipt.attempt,
          })
          const link = Schema.decodeUnknownSync(
            Schema.Struct({ parentTaskID: Schema.String, parentTaskRevision: Schema.Int, source: Permission.Source }),
          )(input.metadata?.task)
          expect(link.source).toEqual({ type: "tool", messageID: assistant.id, id: call.id })
          expect(taskRows.find((task) => task.id === link.parentTaskID)).toMatchObject({
            status: "completed",
            revision: link.parentTaskRevision + 1,
          })
          expect(yield* SessionInputResult.read(db, { sessionID: child.id, inputID: receipt.inputID })).toMatchObject({
            status: "completed",
            assistant: { model: f.executorModel, needsContinuation: false },
          })
          return { receipt, child, link, assistant }
        }),
      )
      const first = rows[0]
      const second = rows[1]
      const followup = rows[2]
      if (!first || !second || !followup) return yield* Effect.die(new Error("MC05 receipts are incomplete"))
      expect(new Set(rows.map((row) => row.receipt.delegationID)).size).toBe(1)
      expect(new Set(rows.map((row) => row.receipt.turnID)).size).toBe(3)
      expect(new Set(rows.map((row) => row.receipt.inputID)).size).toBe(3)
      expect(first.receipt.participantID).not.toBe(second.receipt.participantID)
      expect(first.child.id).not.toBe(second.child.id)
      expect(followup.receipt.participantID).toBe(first.receipt.participantID)
      expect(followup.child.id).toBe(first.child.id)
      expect(taskRows).toHaveLength(3)

      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(first.receipt.delegationID)
      expect(state?.delegation).toMatchObject({ parentSessionID: f.root.id, metaAgentID: controller.metaAgentID })
      expect(state?.participants.size).toBe(2)
      expect(state?.turns.size).toBe(3)
      expect(state?.deliveries.size).toBe(3)
      expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ])
      expect((yield* f.sessions.context(first.child.id)).filter((message) => message.type === "user")).toHaveLength(2)
      expect((yield* f.sessions.context(second.child.id)).filter((message) => message.type === "user")).toHaveLength(1)

      const requests = yield* f.llm.requests()
      expect(requests.map((request) => String(request.model.id))).toEqual(
        [
          f.metaModel.id,
          f.executorModel.id,
          f.metaModel.id,
          f.executorModel.id,
          f.metaModel.id,
          f.executorModel.id,
          f.metaModel.id,
        ].map(String),
      )
      calls.forEach((call, index) => {
        const child = rows[index]?.child
        expect(child).toBeDefined()
        expect(
          requests[6]?.messages
            .filter((message) => message.role === "tool")
            .flatMap((message) => message.content)
            .find((item) => item.type === "tool-result" && item.id === call.id),
        ).toMatchObject({
          result: {
            type: "text",
            value: `<task id="${child?.id}" state="completed">\n<task_result>\n${call.result}\n</task_result>\n</task>`,
          },
        })
      })
      expect(yield* SessionInputResult.read(db, { sessionID: f.root.id, inputID: admitted.id })).toMatchObject({
        status: "completed",
        assistant: { model: f.metaModel, needsContinuation: false },
      })
      const metas = yield* MetaAgentService.Service
      const steps = yield* db
        .select()
        .from(MetaAgentStepTable)
        .where(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID))
      rows.forEach((row, index) => {
        expect(steps.find((step) => step.type === "receipt" && step.tool_call_id === calls[index]?.id)).toMatchObject({
          root_session_id: f.root.id,
          meta_agent_session_id: f.root.id,
          assistant_message_id: row.assistant.id,
          provenance: { receipt: { ...row.receipt, source: row.link.source } },
        })
      })
      expect(steps.filter((step) => step.type === "receipt")).toHaveLength(3)
      expect(yield* metas.stats(controller.metaAgentID)).toMatchObject({
        totalSessions: 3,
        stepCount: 10,
        recordedOnly: true,
        physicalAttemptCoverage: "unknown",
        unknownStepCount: 0,
      })
      expect(yield* f.sessions.inbox(f.root.id)).toHaveLength(0)
      expect(yield* f.sessions.inbox(first.child.id)).toHaveLength(0)
      expect(yield* f.sessions.inbox(second.child.id)).toHaveLength(0)
    }),
  30_000,
)

for (const agent of ["plan", "meta"] as const)
  effectTest.live(
    `consumes a real Question Form answer in the native ${agent} Session`,
    () =>
      Effect.gen(function* () {
        const f = yield* metaSetup()
        const root =
          agent === "meta"
            ? f.root
            : yield* f.sessions.create({
                location: f.root.location,
                agent: Agent.ID.make(agent),
                model: f.metaModel,
                title: "Plan Question keeper",
              })
        const locations = yield* LocationServiceMap.Service
        const local = locations.get(root.location)
        const forms = yield* Form.Service.pipe(Effect.provide(local))
        const callID = `call-${agent}-question`
        yield* f.llm.push(
          TestLLM.tool(callID, QuestionTool.name, {
            questions: [
              {
                header: "Confirm",
                question: "Which result is confirmed?",
                options: [{ label: "verified", description: "Confirm the result" }],
              },
            ],
          }),
          TestLLM.text("Confirmed verified.", `${agent}-answer`),
        )
        const admitted = yield* f.sessions.prompt({ sessionID: root.id, text: "Ask me to confirm the result." })
        const form = yield* pollWithTimeout(
          forms.list({ sessionID: root.id }).pipe(Effect.map((pending) => pending[0])),
          `${agent} did not create a Question Form`,
        )
        expect(form).toMatchObject({ sessionID: root.id, metadata: { kind: "question", tool: { id: callID } } })
        expect(yield* forms.state(form.id)).toEqual({ status: "pending" })
        expect(yield* f.llm.requests()).toHaveLength(1)
        yield* forms.reply({ id: form.id, answer: { q0: "verified" } })
        yield* awaitWithTimeout(f.llm.wait(2), `${agent} did not consume the Form answer`, "10 seconds")
        yield* awaitWithTimeout(f.runs.awaitIdle(root.id), `${agent} did not settle`, "10 seconds")
        expect(yield* forms.state(form.id)).toEqual({ status: "answered", answer: { q0: "verified" } })
        expect(yield* forms.list({ sessionID: root.id })).toEqual([])
        expect(yield* f.sessions.inbox(root.id)).toEqual([])
        expect((yield* f.sessions.list({ parentID: root.id })).data).toEqual([])
        const requests = yield* f.llm.requests()
        expect(requests).toHaveLength(2)
        expect(requests.map((request) => String(request.model.id))).toEqual([
          String(f.metaModel.id),
          String(f.metaModel.id),
        ])
        expect(
          requests[1]?.messages
            .filter((message) => message.role === "tool")
            .flatMap((message) => message.content)
            .find((item) => item.type === "tool-result" && item.id === callID),
        ).toMatchObject({
          result: {
            type: "text",
            value:
              'User has answered your questions: "Which result is confirmed?"="verified". You can now continue with the user\'s answers in mind.',
          },
        })
        const db = (yield* Database.Service).db
        expect(yield* SessionInputResult.read(db, { sessionID: root.id, inputID: admitted.id })).toMatchObject({
          status: "completed",
          assistant: { model: f.metaModel, needsContinuation: false },
        })
        if (agent === "meta") return yield* MetaAgentService.Service.use((metas) => metas.assertOwner(root))
        expect(root.controller).toBeUndefined()
        expect(
          yield* db.select().from(MetaAgentSessionTable).where(eq(MetaAgentSessionTable.session_id, root.id)),
        ).toEqual([])
      }),
    30_000,
  )

effectTest.live(
  "answers directly from the Meta without creating a child",
  () =>
    Effect.gen(function* () {
      const f = yield* metaSetup()
      yield* f.llm.push(TestLLM.text("Direct answer", "direct"))
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Answer directly." })
      yield* awaitWithTimeout(f.llm.wait(1), "Meta did not answer")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Meta did not settle")
      expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
      expect(yield* f.llm.requests()).toHaveLength(1)
    }),
  30_000,
)

const memorySourceSetup = () =>
  Effect.gen(function* () {
    const f = yield* metaSetup()
    const source = yield* f.sessions.create({
      location: f.root.location,
      agent: Agent.ID.make("meta"),
      title: "Independent memory source Meta",
      model: f.metaModel,
      executorPreference: new MetaAgent.ExecutorPreference({ agent: f.worker, model: f.executorModel }),
    })
    if (f.root.controller?.kind !== "root" || source.controller?.kind !== "root")
      return yield* Effect.die(new Error("Memory writer or source controller is missing"))
    expect(source.projectID).toBe(f.root.projectID)
    expect(source.controller.metaAgentID).not.toBe(f.root.controller.metaAgentID)
    const metas = yield* MetaAgentService.Service
    yield* metas.assertOwner(f.root)
    yield* metas.assertOwner(source)
    return {
      ...f,
      source,
      metas,
      memory: yield* MetaAgentMemory.Service,
      db: (yield* Database.Service).db,
      writerMetaID: f.root.controller.metaAgentID,
      sourceMetaID: source.controller.metaAgentID,
    }
  })

memoryOriginTest.live(
  "records real running origins across Metas with retention off and keeps their references after normal completion",
  () =>
    Effect.gen(function* () {
      const f = yield* memorySourceSetup()
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(
          Effect.andThen(
            awaitWithTimeout(f.runs.awaitIdle(f.source.id), "The source cleanup did not settle", "10 seconds"),
          ),
          Effect.asVoid,
          Effect.orDie,
        ),
      )
      const response = TestLLM.text("The source completed normally.", "memory-running-source")
      // The real runner commits Attempt.Started before the response gate blocks later output.
      yield* f.llm.push(
        Stream.fromIterable(response.slice(0, 1)).pipe(
          Stream.concat(Stream.unwrap(Deferred.await(release).pipe(Effect.as(Stream.fromIterable(response.slice(1)))))),
        ),
      )
      const admitted = yield* f.sessions.prompt({ sessionID: f.source.id, text: "Produce a verifiable memory source." })
      yield* awaitWithTimeout(f.llm.wait(1), "The source provider request did not start", "10 seconds")
      const step = yield* pollWithTimeout(
        f.db
          .select()
          .from(MetaAgentStepTable)
          .where(
            and(
              eq(MetaAgentStepTable.meta_agent_session_id, f.source.id),
              eq(MetaAgentStepTable.event_type, SessionEvent.Attempt.Started.type),
            ),
          )
          .get(),
        "The real Started projector did not commit",
        "10 seconds",
      )
      if (!step.assistant_message_id || !step.event_id || step.event_seq === null)
        return yield* Effect.die(new Error("Started producer identity is missing"))
      expect(step).toMatchObject({
        status: "running",
        meta_agent_id: f.sourceMetaID,
        root_session_id: f.source.id,
        meta_agent_session_id: f.source.id,
      })
      const assistant = yield* f.sessions.message({
        sessionID: f.source.id,
        messageID: SessionMessage.ID.make(step.assistant_message_id),
      })
      if (assistant?.type !== "assistant") return yield* Effect.die(new Error("Running source assistant is missing"))
      expect(assistant.origin).toEqual({
        kind: "step",
        sessionID: f.source.id,
        id: Event.ID.make(step.event_id),
        seq: Event.Seq.make(step.event_seq),
      })
      expect(assistant.completion).toBeUndefined()
      expect(yield* f.db.select().from(EventTable).where(eq(EventTable.aggregate_id, f.source.id))).toEqual([])
      const id = yield* f.memory.record({
        id: "mem_real_running_origin",
        sessionID: f.root.id,
        projectID: f.root.projectID,
        factCategory: "api",
        content: "A same-project Meta can supply a verifiable running origin.",
        sourceSessionID: f.source.id,
        sourceStepID: step.id,
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, id)).get(),
      ).toMatchObject({
        meta_agent_id: f.writerMetaID,
        source_session_id: f.source.id,
        source_step_id: step.id,
      })
      const stepOnly = yield* f.memory.record({
        id: "mem_real_step_only_origin",
        sessionID: f.root.id,
        projectID: f.root.projectID,
        factCategory: "api",
        content: "Step-only admission validates its Session without storing an omitted SourceSession.",
        sourceStepID: step.id,
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, stepOnly)).get(),
      ).toMatchObject({ meta_agent_id: f.writerMetaID, source_session_id: null, source_step_id: step.id })
      expect(
        (yield* f.memory.query({ projectID: f.root.projectID })).find((fact) => fact.id === stepOnly),
      ).toMatchObject({
        sourceSessionID: undefined,
        sourceStepID: step.id,
      })
      // Negative fixture: copied producer fields cannot attest a different event identity.
      const forgedEventID = Event.ID.create()
      const forgedStepID = `stp_${forgedEventID}`
      yield* f.db
        .insert(MetaAgentStepTable)
        .values({ ...step, id: forgedStepID, event_id: forgedEventID, seq: step.seq + 1 })
        .run()
      const recorded = yield* f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id)
      expect(
        yield* f.memory
          .record({
            id: "mem_rejected_forged_origin",
            sessionID: f.root.id,
            projectID: f.root.projectID,
            factCategory: "api",
            content: "This copied row has no actual matching producer.",
            sourceSessionID: f.source.id,
            sourceStepID: forgedStepID,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(MetaAgentMemory.InvalidSourceError)
      expect(yield* f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id)).toEqual(recorded)
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(f.runs.awaitIdle(f.source.id), "The source did not complete normally", "10 seconds")
      const completed = yield* f.sessions.message({
        sessionID: f.source.id,
        messageID: SessionMessage.ID.make(step.assistant_message_id),
      })
      if (completed?.type !== "assistant") return yield* Effect.die(new Error("Completed source assistant is missing"))
      expect(completed).toMatchObject({ finish: "stop", needsContinuation: false, origin: assistant.origin })
      expect(completed.completion).toBeDefined()
      expect(completed.completion?.id).not.toBe(step.event_id)
      expect(yield* SessionInputResult.read(f.db, { sessionID: f.source.id, inputID: admitted.id })).toMatchObject({
        status: "completed",
        assistant: { model: f.metaModel, needsContinuation: false },
      })
      expect(yield* f.db.select().from(EventTable).where(eq(EventTable.aggregate_id, f.source.id))).toEqual([])
      // Default-off materialization retains the Started row; completion does not invalidate that real occurrence.
      expect(yield* f.db.select().from(MetaAgentStepTable).where(eq(MetaAgentStepTable.id, step.id)).get()).toEqual(
        step,
      )
      const afterCompletion = yield* f.memory.record({
        id: "mem_origin_after_completion",
        sessionID: f.root.id,
        projectID: f.root.projectID,
        factCategory: "api",
        content: "The original real Started occurrence remains verifiable after normal completion.",
        sourceSessionID: f.source.id,
        sourceStepID: step.id,
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, afterCompletion)).get(),
      ).toMatchObject({ meta_agent_id: f.writerMetaID, source_session_id: f.source.id, source_step_id: step.id })
      expect(
        yield* f.memory.record({
          id,
          sessionID: f.root.id,
          projectID: f.root.projectID,
          factCategory: "api",
          content: "A same-project Meta can supply a verifiable running origin.",
          sourceSessionID: f.source.id,
          sourceStepID: step.id,
        }),
      ).toBe(id)
      expect((yield* f.memory.query({ projectID: f.root.projectID })).map((fact) => fact.id).sort()).toEqual(
        [id, stepOnly, afterCompletion].sort(),
      )
    }),
  30_000,
)

effectTest.live(
  "records a real completed Ended producer across Metas when its exact event is retained",
  () =>
    Effect.gen(function* () {
      const f = yield* memorySourceSetup()
      yield* f.llm.push(TestLLM.text("Normal completed source.", "memory-ended-source"))
      const admitted = yield* f.sessions.prompt({ sessionID: f.source.id, text: "Complete a real source step." })
      yield* awaitWithTimeout(f.llm.wait(1), "The retained source provider did not run", "10 seconds")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.source.id), "The retained source did not settle", "10 seconds")
      const events = yield* f.sessions.log({ sessionID: f.source.id }).pipe(Stream.runCollect)
      const ended = events.find(
        (event): event is SessionEvent.Step.Ended =>
          !Bus.isSynced(event) && event.type === SessionEvent.Step.Ended.type,
      )
      if (!ended) return yield* Effect.die(new Error("Real Ended event is missing"))
      const step = yield* f.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(eq(MetaAgentStepTable.meta_agent_session_id, f.source.id), eq(MetaAgentStepTable.event_id, ended.id)),
        )
        .get()
      if (!step) return yield* Effect.die(new Error("Real completed Ended Meta step is missing"))
      expect(step).toMatchObject({
        status: "completed",
        meta_agent_id: f.sourceMetaID,
        root_session_id: f.source.id,
        event_id: ended.id,
        event_seq: ended.durable.seq,
        event_type: SessionEvent.Step.Ended.type,
        assistant_message_id: ended.data.assistantMessageID,
      })
      expect(yield* f.db.select().from(EventTable).where(eq(EventTable.id, ended.id)).get()).toMatchObject({
        id: ended.id,
        aggregate_id: f.source.id,
        seq: ended.durable.seq,
        type: Bus.versionedType(SessionEvent.Step.Ended.type, SessionEvent.Step.Ended.durable.version),
        data: Schema.encodeSync(SessionEvent.Step.Ended.data)(ended.data),
      })
      const assistant = yield* f.sessions.message({ sessionID: f.source.id, messageID: ended.data.assistantMessageID })
      if (assistant?.type !== "assistant") return yield* Effect.die(new Error("Ended source assistant is missing"))
      expect(assistant.completion).toBeDefined()
      expect(assistant.completion?.id).not.toBe(ended.id)
      expect(yield* SessionInputResult.read(f.db, { sessionID: f.source.id, inputID: admitted.id })).toMatchObject({
        status: "completed",
        assistant: { needsContinuation: false },
      })
      const id = yield* f.memory.record({
        id: "mem_real_ended_origin",
        sessionID: f.root.id,
        projectID: f.root.projectID,
        factCategory: "workflow",
        content: "A completed source is admitted from its actual retained Ended event.",
        sourceSessionID: f.source.id,
        sourceStepID: step.id,
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, id)).get(),
      ).toMatchObject({ meta_agent_id: f.writerMetaID, source_session_id: f.source.id, source_step_id: step.id })
    }),
  30_000,
)

memoryOriginTest.live(
  "rejects unattested running and completed sources while preserving historical facts and associations",
  () =>
    Effect.gen(function* () {
      const f = yield* memorySourceSetup()
      const legacy = yield* Effect.forEach(["running", "completed"] as const, (status, index) =>
        Effect.gen(function* () {
          const id = yield* f.metas.writeStep({
            metaAgentSessionID: f.source.id,
            seq: index + 1,
            type: "tool",
            engine: "unattested-history-fixture",
          })
          // Fixture status alone is deliberately insufficient producer evidence.
          if (status === "completed") yield* f.metas.updateStep({ stepID: id, status, result: "Legacy summary" })
          return id
        }),
      )
      const historicalID = "mem_unattested_historical_origin"
      yield* f.db
        .insert(MetaAgentMemoryTable)
        .values({
          id: historicalID,
          project_id: f.root.projectID,
          meta_agent_id: f.writerMetaID,
          fact_category: "protocol",
          content: "Historical source associations remain readable as recorded.",
          source_session_id: null,
          source_step_id: legacy[0],
        })
        .run()
      const before = yield* Effect.all({
        memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
        steps: f.db.select().from(MetaAgentStepTable).orderBy(MetaAgentStepTable.id),
        links: f.db.select().from(MetaAgentSessionTable).orderBy(MetaAgentSessionTable.meta_agent_id),
      })
      expect(before.steps.map((step) => step.status).sort()).toEqual(["completed", "running"])
      expect(before.steps.every((step) => step.event_id === null && step.event_seq === null)).toBe(true)
      yield* Effect.forEach(legacy, (sourceStepID, index) =>
        Effect.gen(function* () {
          expect(
            yield* f.memory
              .record({
                id: `mem_unattested_new_${index}`,
                sessionID: f.root.id,
                projectID: f.root.projectID,
                factCategory: "protocol",
                content: "An unattested row must not authorize a new source reference.",
                sourceStepID,
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(MetaAgentMemory.InvalidSourceError)
        }),
      )
      expect(
        yield* Effect.all({
          memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
          steps: f.db.select().from(MetaAgentStepTable).orderBy(MetaAgentStepTable.id),
          links: f.db.select().from(MetaAgentSessionTable).orderBy(MetaAgentSessionTable.meta_agent_id),
        }),
      ).toEqual(before)
      const historical = {
        id: historicalID,
        metaAgentID: f.writerMetaID,
        sourceSessionID: undefined,
        sourceStepID: legacy[0],
      }
      expect(yield* f.memory.query({ projectID: f.root.projectID })).toMatchObject([historical])
      expect(yield* f.memory.search({ projectID: f.root.projectID, keyword: "Historical" })).toMatchObject([historical])
      expect(yield* f.memory.latest({ projectID: f.root.projectID, topN: 10 })).toMatchObject([historical])
      expect(yield* f.llm.requests()).toEqual([])
    }),
  30_000,
)

memoryOriginTest.live(
  "rejects missing, mismatched and foreign-project sources before insertion",
  () =>
    Effect.gen(function* () {
      const f = yield* memorySourceSetup()
      yield* f.llm.push(TestLLM.text("Real relationship source.", "memory-relationship-source"))
      yield* f.sessions.prompt({ sessionID: f.source.id, text: "Complete the relationship source." })
      yield* awaitWithTimeout(f.llm.wait(1), "The relationship source did not start", "10 seconds")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.source.id), "The relationship source did not settle", "10 seconds")
      const step = yield* f.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.source.id),
            eq(MetaAgentStepTable.event_type, SessionEvent.Step.Started.type),
          ),
        )
        .get()
      if (!step) return yield* Effect.die(new Error("Relationship source Started row is missing"))
      const foreignDirectory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(foreignDirectory.path))
      const foreign = yield* f.sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(foreignDirectory.path) }),
        agent: Agent.ID.make("build"),
        title: "Foreign memory source",
      })
      expect(foreign.projectID).not.toBe(f.root.projectID)
      const sessionOnly = yield* f.memory.record({
        id: "mem_valid_session_only_origin",
        sessionID: f.root.id,
        projectID: f.root.projectID,
        factCategory: "api",
        content: "A supplied same-project Session is a valid source without a supplied Step.",
        sourceSessionID: f.source.id,
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, sessionOnly)).get(),
      ).toMatchObject({ source_session_id: f.source.id, source_step_id: null, meta_agent_id: f.writerMetaID })
      const before = yield* Effect.all({
        memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
        steps: f.db.select().from(MetaAgentStepTable).orderBy(MetaAgentStepTable.id),
        links: f.db.select().from(MetaAgentSessionTable).orderBy(MetaAgentSessionTable.meta_agent_id),
        sessions: f.db.select().from(SessionTable).orderBy(SessionTable.id),
      })
      yield* Effect.forEach(
        [
          { sourceSessionID: "ses_memory_missing" },
          { sourceStepID: "stp_memory_missing" },
          { sourceSessionID: f.source.id, sourceStepID: "stp_memory_missing" },
          { sourceSessionID: f.root.id, sourceStepID: step.id },
          { sourceSessionID: foreign.id },
          // The implicit Session must also be checked when only SourceStep is supplied.
          { projectID: foreign.projectID, sourceStepID: step.id },
        ],
        (source, index) =>
          Effect.gen(function* () {
            expect(
              yield* f.memory
                .record({
                  id: `mem_invalid_relation_${index}`,
                  sessionID: f.root.id,
                  projectID: f.root.projectID,
                  factCategory: "api",
                  content: "This new source relationship is invalid.",
                  ...source,
                })
                .pipe(Effect.flip),
            ).toBeInstanceOf(MetaAgentMemory.InvalidSourceError)
          }),
      )
      expect(
        yield* Effect.all({
          memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
          steps: f.db.select().from(MetaAgentStepTable).orderBy(MetaAgentStepTable.id),
          links: f.db.select().from(MetaAgentSessionTable).orderBy(MetaAgentSessionTable.meta_agent_id),
          sessions: f.db.select().from(SessionTable).orderBy(SessionTable.id),
        }),
      ).toEqual(before)
    }),
  30_000,
)

memoryOriginTest.live(
  "rejects an ambiguous legacy writer and records after explicit Meta selection while retaining old associations",
  () =>
    Effect.gen(function* () {
      const f = yield* memorySourceSetup()
      const writer = yield* f.sessions.create({
        location: f.root.location,
        agent: Agent.ID.make("build"),
        title: "Legacy memory writer",
        model: f.metaModel,
      })
      expect(writer.controller).toBeUndefined()
      expect(
        yield* f.memory
          .record({
            sessionID: writer.id,
            projectID: writer.projectID,
            factCategory: "api",
            content: "A writer with zero Meta associations is not admitted.",
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(MetaAgentMemory.NotMetaSessionError)
      yield* f.metas.attach({ metaID: f.writerMetaID, sessionID: writer.id, role: "orchestrator" })
      const legacyID = yield* f.memory.record({
        id: "mem_unique_legacy_owner",
        sessionID: writer.id,
        projectID: writer.projectID,
        factCategory: "api",
        content: "The unique historical association remains compatible.",
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, legacyID)).get(),
      ).toMatchObject({ meta_agent_id: f.writerMetaID, source_session_id: null, source_step_id: null })
      yield* f.metas.attach({ metaID: f.sourceMetaID, sessionID: writer.id, role: "worker" })
      const before = yield* Effect.all({
        writer: f.sessions.get(writer.id),
        links: f.db
          .select()
          .from(MetaAgentSessionTable)
          .where(eq(MetaAgentSessionTable.session_id, writer.id))
          .orderBy(MetaAgentSessionTable.meta_agent_id),
        memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
      })
      expect(before.writer.controller).toBeUndefined()
      expect(before.links).toHaveLength(2)
      expect(
        yield* f.memory
          .record({
            id: "mem_ambiguous_writer_rejected",
            sessionID: writer.id,
            projectID: writer.projectID,
            factCategory: "api",
            content: "The ambiguous writer cannot select an owner during record.",
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(MetaAgentMemory.AmbiguousOwnerError)
      expect(
        yield* Effect.all({
          writer: f.sessions.get(writer.id),
          links: f.db
            .select()
            .from(MetaAgentSessionTable)
            .where(eq(MetaAgentSessionTable.session_id, writer.id))
            .orderBy(MetaAgentSessionTable.meta_agent_id),
          memory: f.db.select().from(MetaAgentMemoryTable).orderBy(MetaAgentMemoryTable.id),
        }),
      ).toEqual(before)
      // Establish ownership through the existing explicit Session API.
      yield* f.sessions.switchAgent({ sessionID: writer.id, agent: Agent.ID.make("meta"), model: f.metaModel })
      const selected = yield* f.sessions.get(writer.id)
      if (selected.controller?.kind !== "root") return yield* Effect.die(new Error("Explicit Meta owner is missing"))
      yield* f.metas.assertOwner(selected)
      const links = yield* f.db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.session_id, writer.id))
        .orderBy(MetaAgentSessionTable.meta_agent_id)
      expect(links).toEqual(expect.arrayContaining(before.links))
      expect(links).toHaveLength(before.links.length + 1)
      const id = yield* f.memory.record({
        id: "mem_selected_controller_owner",
        sessionID: selected.id,
        projectID: selected.projectID,
        factCategory: "api",
        content: "The selected controller now determines the admitted writer.",
      })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, id)).get(),
      ).toMatchObject({ meta_agent_id: selected.controller.metaAgentID, source_session_id: null, source_step_id: null })
      expect(
        yield* f.db.select().from(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, legacyID)).get(),
      ).toEqual(before.memory.find((fact) => fact.id === legacyID))
      expect(yield* f.llm.requests()).toEqual([])
    }),
  30_000,
)

const externalSetup = (
  changedCommand = false,
  actor = Agent.ID.make("meta"),
  background = false,
  steer?: { parentTask?: "original"; response?: "reject" | "mismatch" },
  queue = false,
  transport: CliAdapter.CliAdapterValue["transport"] = "app-server",
  governance?: Effect.Success<ReturnType<typeof mc07Build>>,
) =>
  Effect.gen(function* () {
    if (background)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "1"
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
              return
            }
            process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
          }),
      )
    const calls: {
      method: string
      thread?: string
      input?: unknown
      closedBeforeStart?: number
      cwd?: string
      command?: string
    }[] = []
    const decisions: { id: string | number; decision: string }[] = []
    const outputs = [
      background ? "MC06_BACKGROUND_" + "x".repeat(60_000) + "_TAIL" : "MC06_FIRST_" + "x".repeat(5000),
      "MC06_SECOND",
    ]
    const state = { turns: 0, closed: 0, steers: [] as unknown[], holdResult: false, archiveFailure: false }
    const readBoundary: { beforeResult?: Effect.Effect<void> } = {}
    const terminals = new Set<(kind: "completed" | "interrupted" | "error") => void>()
    const pendingApprovals = new Set<() => void>()
    const pendingResults = new Set<() => void>()
    const previous = CliAdapter.getCliAdapter("codex")
    const adapter = CodexAppServer.makeCodexAppServerAdapter(({ cwd, resumeId, command }) =>
      Effect.sync(() => {
        const notifications = new Set<(event: CodexAppServer.CodexAppServerServerNotification) => void>()
        const approvals = new Set<(event: CodexAppServer.ServerRequest) => void>()
        const local = { turn: 0 }
        const requestApproval = () =>
          approvals.forEach((listener) =>
            listener({
              id: 7,
              method: "item/commandExecution/requestApproval",
              params: {
                kind: "command",
                threadId: "external-thread",
                turnId: `external-turn-${local.turn}`,
                itemId: `command-${local.turn}`,
                startedAtMs: 1,
                environmentId: null,
                command: "echo MC06",
                cwd,
              },
            }),
          )
        pendingApprovals.add(requestApproval)
        const terminate = (kind: "completed" | "interrupted" | "error") => {
          if (kind === "error") {
            notifications.forEach((listener) =>
              listener({
                method: "error",
                params: {
                  threadId: "external-thread",
                  turnId: `external-turn-${local.turn}`,
                  error: { message: "Controlled external turn failure" },
                  willRetry: false,
                },
              }),
            )
            return
          }
          notifications.forEach((listener) =>
            listener({
              method: "turn/completed",
              params: {
                threadId: "external-thread",
                turn: { id: `external-turn-${local.turn}`, status: kind, items: [], error: null },
              },
            }),
          )
        }
        terminals.add(terminate)
        const finish = () => {
          notifications.forEach((listener) =>
            listener({
              method: "item/agentMessage/delta",
              params: {
                threadId: "external-thread",
                turnId: `external-turn-${local.turn}`,
                itemId: `answer-${local.turn}`,
                delta: outputs[local.turn - 1] ?? "UNEXPECTED",
              },
            }),
          )
          terminate("completed")
        }
        pendingResults.add(finish)
        const connection: CodexAppServer.CodexAppServerConnection = {
          request: <T>(method: string, _params?: unknown, codec?: Schema.Decoder<T>) =>
            Effect.gen(function* () {
              calls.push({
                method,
                thread: resumeId,
                ...(queue || governance ? { input: _params, closedBeforeStart: state.closed } : {}),
                ...(governance ? { cwd, command } : {}),
              })
              if (method === "turn/steer") {
                state.steers.push(_params)
                if (steer?.response === "reject")
                  return yield* new CodexAppServer.RpcResponseError({
                    method,
                    requestID: 41,
                    reason: "Controlled steer rejection",
                    code: -32600,
                  })
              }
              if (method === "thread/archive" && state.archiveFailure)
                return yield* new CodexAppServer.RpcResponseError({
                  method,
                  requestID: 81,
                  code: -32600,
                  reason: "Controlled archive failure",
                })
              if (method === "thread/read" && readBoundary.beforeResult) yield* readBoundary.beforeResult
              if (!codec) return yield* Effect.die(new Error("A response codec is required"))
              const id = method === "turn/start" ? `external-turn-${++state.turns}` : `external-turn-${state.turns}`
              const turn = { id, status: "inProgress", items: [], error: null }
              if (method === "turn/start") {
                local.turn = state.turns
                notifications.forEach((listener) =>
                  listener({
                    method: "turn/started",
                    params: { threadId: "external-thread", turn: { ...turn, status: "inProgress" } },
                  }),
                )
                if (!background) requestApproval()
              }
              const response =
                method === "initialize"
                  ? { userAgent: "codex/0.162.1" }
                  : method === "turn/start"
                    ? { turn }
                    : method === "turn/steer"
                      ? { turnId: steer?.response === "mismatch" ? "foreign-turn" : id }
                      : {
                          approvalPolicy: "untrusted",
                          approvalsReviewer: "user",
                          cwd,
                          model: "fixture-external",
                          modelProvider: "fixture",
                          sandbox: { type: "readOnly", networkAccess: false },
                          thread: {
                            id: "external-thread",
                            cliVersion: "0.162.1",
                            createdAt: 1,
                            cwd,
                            ephemeral: false,
                            modelProvider: "fixture",
                            preview: "",
                            projectId: null,
                            sessionId: "external-tree",
                            source: "app-server",
                            status: { type: "idle" },
                            turns:
                              method === "thread/read" && governance
                                ? outputs.slice(0, state.turns).map((text, index) => ({
                                    id: `external-turn-${index + 1}`,
                                    status: "completed",
                                    itemsView: "full",
                                    error: null,
                                    items: [{ type: "agentMessage", id: `answer-${index + 1}`, text }],
                                  }))
                                : [],
                            updatedAt: 1,
                          },
                        }
              return yield* Schema.decodeUnknownEffect(codec)(response).pipe(
                Effect.mapError((error) => new Error(String(error))),
              )
            }),
          notify: () => Effect.void,
          onNotification: (listener) => {
            notifications.add(listener)
            return () => {
              notifications.delete(listener)
            }
          },
          onRequest: (listener) => {
            approvals.add(listener)
            return () => {
              approvals.delete(listener)
            }
          },
          respond: (id, result) =>
            Effect.sync(() => {
              decisions.push({ id, decision: result.decision })
              if (result.decision !== "accept" && !governance) return
              if (state.holdResult) return
              finish()
            }),
          close: () =>
            Effect.sync(() => {
              state.closed += 1
              terminals.delete(terminate)
              pendingApprovals.delete(requestApproval)
              pendingResults.delete(finish)
            }),
        }
        return connection
      }),
    )
    CliAdapter.registerCliAdapter("codex", adapter)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => CliAdapter.registerCliAdapter("codex", previous ?? CodexAppServer.adapter)),
    )
    const f = governance ?? (yield* metaSetup(undefined, true, actor, transport))
    const locations = yield* LocationServiceMap.Service
    const local = locations.get(f.root.location)
    const agents = yield* Agent.Service.pipe(Effect.provide(local))
    yield* agents.transform((editor) =>
      editor.update(actor, (agent) => {
        agent.permissions = [
          { action: "*", resource: "*", effect: "allow" },
          { action: "shell", resource: "*", effect: "ask" },
        ]
      }),
    )
    const permission = yield* Permission.Service.pipe(Effect.provide(local))
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ location: f.root.location, custom: false })
    const fixture = {
      ...f,
      permission,
      calls,
      decisions,
      outputs,
      state,
      readBoundary,
      requestApproval: () => pendingApprovals.forEach((request) => request()),
      terminate: (kind: "completed" | "interrupted" | "error") => terminals.forEach((terminate) => terminate(kind)),
      releaseResult: () => pendingResults.forEach((finish) => finish()),
    }
    if (governance) return fixture
    yield* f.llm.serve((request) => {
      const results = request.messages
        .filter((message) => message.role === "tool")
        .flatMap((message) => message.content)
        .flatMap((part) => {
          if (part.type !== "tool-result" || part.result.type !== "text") return []
          const result = Schema.decodeUnknownOption(Schema.fromJsonString(DelegationReceipt.Output))(part.result.value)
          return Option.isSome(result) ? [result.value] : []
        })
      const first = results[0]
      if (queue && first && JSON.stringify(request.messages).includes("MC06_R3_QUEUE_")) {
        const id = JSON.stringify(request.messages).includes("MC06_R3_QUEUE_2") ? "mc06-queue-2" : "mc06-queue-1"
        const answered = request.messages
          .flatMap((message) => (message.role === "tool" ? message.content : []))
          .find((part) => part.type === "tool-result" && part.id === id)
        if (answered?.type === "tool-result")
          return TestLLM.text(
            answered.result.type === "error" ? "Queue admission failed" : "Consumed queued admission or result",
            `${id}-parent`,
          )
        return TestLLM.tool(id, TaskTool.name, {
          description: `Queue ${id}`,
          prompt: `Execute ${id} after its physical predecessor`,
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          attended: true,
          background: true,
          delegation_id: first.delegationID,
          participant_id: first.participantID,
          ...(id === "mc06-queue-1" ? { command: "append" } : {}),
        })
      }
      if (steer && first && JSON.stringify(request.messages).includes("MC06_R3_STEER_REQUEST")) {
        const answered = request.messages
          .flatMap((message) => (message.role === "tool" ? message.content : []))
          .find((part) => part.type === "tool-result" && part.id === "mc06-steer")
        if (answered?.type === "tool-result")
          return TestLLM.text(
            answered.result.type === "error" ? "Steer did not return a receipt" : "Consumed steered result",
            "mc06-steer-parent",
          )
        return TestLLM.tool("mc06-steer", TaskTool.name, {
          description: "Steer the existing external work",
          prompt: "Include the new instruction in the original active turn",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          command: "steer",
          background: false,
          delegation_id: first.delegationID,
          participant_id: first.participantID,
          ...(steer.parentTask === "original" ? { parent_task_id: first.parentTaskID } : {}),
        })
      }
      if (background && first)
        return TestLLM.text(
          JSON.stringify(request.messages).includes(outputs[0]) ? "Consumed background result" : "Background accepted",
          "mc06-background-parent",
        )
      if (request.messages.some((message) => message.role === "tool") && !first)
        return TestLLM.text("Unexpected external Task failure", "mc06-failure")
      if (changedCommand && request.messages.filter((message) => message.role === "tool").length > 1)
        return TestLLM.text("Continuation rejected", "mc06-rejected")
      if (changedCommand && first) {
        const changed = adapter.forCommand?.("changed-codex")
        if (!changed) throw new Error("Invocation factory missing")
        CliAdapter.registerCliAdapter("codex", { ...adapter, forCommand: () => changed })
      }
      if (results.length > 1) return TestLLM.text("Consumed MC06_FIRST and MC06_SECOND", "mc06-answer")
      return TestLLM.tool(first ? "mc06-second" : "mc06-first", TaskTool.name, {
        description: "Read the external result",
        prompt: first ? "Continue the same thread" : "Return the first result",
        subagent_type: "codex",
        cli_target: "codex",
        execution_type: "external-cli",
        attended: true,
        ...(background ? { background: true } : {}),
        ...(first ? { delegation_id: first.delegationID, participant_id: first.participantID } : {}),
      })
    })
    return fixture
  })

effectTest.live(
  "MC07 external governance repairs R1 through the same child and reviewer before completion",
  () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build("artifact.txt", "", true)
      const external = yield* externalSetup(
        false,
        Agent.ID.make("meta"),
        false,
        undefined,
        false,
        "app-server",
        fixture,
      )
      external.outputs[0] =
        "MC07_EXTERNAL_R1_" +
        "x".repeat(5000) +
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: fixture.digest,
          verdict: "rejected",
          findings: [{ file: "artifact.txt", severity: "blocking", summary: "将末行 r1 改为 r2，保留 base 行。" }],
          summary: "R1 requires the requested repair.",
        })}</review>`
      const bus = yield* Bus.Service
      const kv = yield* KV.Service
      const settledBeforeSuccess = yield* Deferred.make<{ parentStatus: string; text?: string }>()
      yield* bus.project(DelegationEvent.ReviewRejected, (event) =>
        Effect.gen(function* () {
          const parent = yield* mc07Result(fixture, "mc07-external-r1")
          const state = yield* fixture.delegations.foldState(event.data.delegationID)
          if (!state) return yield* Effect.die(new Error("Review has no aggregate"))
          const delivery = [...state.deliveries.values()].find((value) => value.turnID === event.data.turnID)
          if (!delivery) return yield* Effect.die(new Error("Review has no actual delivery"))
          const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
            yield* kv.get(DelegationReceipt.key({ delegationID: event.data.delegationID, ...delivery })),
          )
          yield* Deferred.succeed(settledBeforeSuccess, {
            parentStatus: parent.tool.state.status,
            text: binding.settlement?.text,
          })
          return undefined
        }).pipe(Effect.orDie),
      )
      yield* fixture.llm.push(
        TestLLM.tool("mc07-external-r1", TaskTool.name, {
          description: "Review the real R1",
          prompt: "Read the bound R1 and return the typed review with its blocking finding.",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          intent: "review",
          attended: false,
          delegation_id: fixture.receipt.delegationID,
          revision_digest: fixture.digest,
        }),
        TestLLM.text("Consumed the complete external R1 rejection.", "mc07-external-r1-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review the actual R1 with external Codex." })
      yield* awaitWithTimeout(fixture.llm.wait(6), "MC07 external R1 did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 external R1 did not settle")
      const result = yield* mc07Consumed(fixture, "mc07-external-r1")
      expect(result.tool.state).toMatchObject({ status: "completed" })
      if (result.tool.state.status !== "completed") return yield* Effect.die(new Error("External R1 review failed"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(result.text)
      const receipt = output.governance?.receipt
      if (!(receipt instanceof DelegationReceipt.External))
        return yield* Effect.die(new Error("R1 has no visible external proof"))
      const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(state?.participants.get(receipt.participantID)).toMatchObject({ provider: "codex", role: "reviewer" })
      expect(state?.turns.get(receipt.turnID)).toMatchObject({ kind: "review", revisionDigest: fixture.digest })
      expect(state?.reviews).toHaveLength(1)
      expect(state?.reviews[0]).toMatchObject({ reviewedRevisionDigest: fixture.digest, verdict: "rejected" })
      expect(state?.delegation.rejectionBlocked).toBe(true)
      expect(
        yield* awaitWithTimeout(Deferred.await(settledBeforeSuccess), "Review settlement observation is missing"),
      ).toEqual({ parentStatus: "running", text: external.outputs[0] })
      expect(output.output).toBe(external.outputs[0])
      expect(output).toMatchObject({
        delegationID: receipt.delegationID,
        participantID: receipt.participantID,
        turnID: receipt.turnID,
      })
      expect(external.decisions).toEqual([{ id: 7, decision: "decline" }])
      expect(yield* Effect.promise(() => Bun.file(`${fixture.root.location.directory}/artifact.txt`).text())).toBe(
        "base\nr1\n",
      )
      const execution = yield* DelegationExecution.Service
      const cold = yield* execution.wait(receipt)
      expect(cold.text).toBe(external.outputs[0])
      expect(cold.governance).toEqual(
        Schema.decodeUnknownSync(DelegationService.Governance)(result.tool.state.metadata?.governance),
      )
      const count = (yield* fixture.llm.requests()).length
      const repairPrompt = `Apply the complete R1 finding below. Keep base and replace r1 with r2.\n${external.outputs[0]}\n${JSON.stringify(receipt)}`
      yield* fixture.llm.push(
        TestLLM.tool("mc07-external-repair", TaskTool.name, {
          description: "Repair the external rejection",
          prompt: repairPrompt,
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          participant_id: fixture.receipt.participantID,
          task_id: fixture.receipt.childSessionID,
          command: "append",
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc07-external-repair-write", "write", { path: "artifact.txt", content: "base\nr2\n" }),
        TestLLM.text("R2 repair is ready.", "mc07-external-repair-child"),
        TestLLM.text("Consumed the complete R2 producer.", "mc07-external-repair-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Repair the external R1 rejection in the same child.",
      })
      yield* fixture.runs.awaitIdle(fixture.root.id)
      expect((yield* fixture.llm.requests()).length).toBe(count + 4)
      const repair = yield* mc07Consumed(fixture, "mc07-external-repair")
      expect(repair.tool.state).toMatchObject({ status: "completed" })
      if (repair.tool.state.status !== "completed") return yield* Effect.die(new Error("External R2 repair failed"))
      const repairedGovernance = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationService.Governance))(
        repair.text.match(/<task_governance>([\s\S]*?)<\/task_governance>/)?.[1],
      )
      if (repairedGovernance.kind !== "revision" || !("artifact" in repairedGovernance))
        return yield* Effect.die(new Error("R2 has no visible producer"))
      const repairedReceipt = repairedGovernance.receipt
      expect(repairedReceipt).toMatchObject({
        childSessionID: fixture.receipt.childSessionID,
        participantID: fixture.receipt.participantID,
      })
      expect(repairedReceipt.inputID).not.toBe(fixture.receipt.inputID)
      const repaired = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      const digest = repairedGovernance.artifact.revisionDigest
      expect(repaired?.delegation.latestRevisionDigest).toBe(digest)
      expect(digest).not.toBe(fixture.digest)
      expect(repaired?.revisions).toHaveLength(2)
      expect(repaired?.revisions[1]).toMatchObject({ revisionDigest: digest, changeKind: "rework" })
      external.outputs[1] = `<review>${JSON.stringify({
        kind: "aigcfroge.review.v1",
        reviewed_revision_digest: digest,
        verdict: "approved",
        findings: [],
        summary: "R2 keeps base and replaces r1 with r2.",
      })}</review>`
      yield* fixture.llm.push(
        TestLLM.tool("mc07-external-r2", TaskTool.name, {
          description: "Review the real R2",
          prompt: "Read the current R2 and review the completed repair.",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          intent: "review",
          attended: false,
          delegation_id: fixture.receipt.delegationID,
          participant_id: receipt.participantID,
          command: "append",
          revision_digest: digest,
        }),
        TestLLM.text("Consumed the complete external R2 approval.", "mc07-external-r2-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review R2 in the same external thread." })
      yield* awaitWithTimeout(fixture.llm.wait(count + 6), "MC07 external R2 did not reach its parent")
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "MC07 external R2 did not settle")
      const approval = yield* mc07Consumed(fixture, "mc07-external-r2")
      expect(approval.tool.state).toMatchObject({ status: "completed" })
      if (approval.tool.state.status !== "completed") return yield* Effect.die(new Error("External R2 review failed"))
      const approvedOutput = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(
        approval.text,
      )
      const approvedReceipt = approvedOutput.governance?.receipt
      if (!(approvedReceipt instanceof DelegationReceipt.External))
        return yield* Effect.die(new Error("R2 has no visible external proof"))
      expect(approvedOutput.governance).toMatchObject({ status: "valid", reviewedRevisionDigest: digest })
      expect(approvedReceipt).toMatchObject({
        participantID: receipt.participantID,
        externalThreadID: receipt.externalThreadID,
      })
      expect(approvedReceipt.turnID).not.toBe(receipt.turnID)
      expect(approvedReceipt.externalTurnID).not.toBe(receipt.externalTurnID)
      expect(approvedReceipt.source).not.toEqual(receipt.source)
      const blocked = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(blocked?.reviews.map((review) => review.verdict)).toEqual(["rejected", "approved"])
      expect(blocked?.delegation.rejectionBlocked).toBe(true)
      expect(external.state.turns).toBe(2)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-external-blocked-complete", TaskTool.name, {
          description: "Try completion with the blocker",
          prompt: "Complete only if the original rejection was retracted.",
          subagent_type: fixture.worker,
          delegation_id: fixture.receipt.delegationID,
          command: "complete",
        }),
        TestLLM.text("Consumed the completion refusal and retained the blocker.", "mc07-external-blocked-parent"),
      )
      yield* fixture.sessions.prompt({
        sessionID: fixture.root.id,
        text: "Attempt completion with the original rejection still active.",
      })
      yield* awaitWithTimeout(
        fixture.runs.awaitIdle(fixture.root.id),
        "MC07 external blocked completion did not settle",
      )
      const refused = yield* mc07Consumed(fixture, "mc07-external-blocked-complete")
      expect(refused.tool.state.status).toBe("error")
      if (refused.tool.state.status !== "error") return yield* Effect.die(new Error("Sticky rejection was ignored"))
      expect(refused.tool.state.error.message).toMatch(/barrier/i)
      expect(yield* fixture.delegations.foldState(fixture.receipt.delegationID)).toEqual(blocked)
      yield* fixture.llm.push(
        TestLLM.tool("mc07-external-wrong-retract", TaskTool.name, {
          description: "Try the wrong rejection owner",
          prompt: "Explicitly retract this rejection.",
          subagent_type: fixture.worker,
          delegation_id: receipt.delegationID,
          participant_id: fixture.receipt.participantID,
          command: "retract_rejection",
        }),
        TestLLM.text("Consumed the participant mismatch.", "mc07-external-wrong-retract-parent"),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Try the non-reviewer participant." })
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "Wrong rejection owner did not settle")
      expect((yield* mc07Consumed(fixture, "mc07-external-wrong-retract")).tool.state.status).toBe("error")
      expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(blocked)
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "task_reconcile", resource: receipt.delegationID, effect: "ask" },
        ],
      })
      const reason = "Explicitly retract R1 rejection because R2 fixed the finding and the same reviewer approved R2."
      for (const reply of ["reject", "once"] as const) {
        const callID = `mc07-external-retract-${reply}`
        yield* fixture.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: "Retract the actual reviewer rejection",
            prompt: reason,
            subagent_type: fixture.worker,
            delegation_id: receipt.delegationID,
            participant_id: receipt.participantID,
            command: "retract_rejection",
          }),
          ...(reply === "once" ? [TestLLM.text(`Consumed retraction ${reply}.`, `${callID}-parent`)] : []),
        )
        yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: reason })
        const request = yield* pollWithTimeout(
          external.permission
            .forSession(fixture.root.id)
            .pipe(Effect.map((requests) => requests.find((request) => request.action === "task_reconcile"))),
          "Retraction permission is missing",
        )
        const pending = yield* mc07Result(fixture, callID)
        expect(request.source).toEqual({ type: "tool", messageID: pending.assistant.id, id: callID })
        expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(blocked)
        yield* external.permission.reply({ requestID: request.id, reply })
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "Explicit external retraction did not settle")
        expect((yield* mc07Result(fixture, callID)).tool.state.status).toBe(reply === "once" ? "completed" : "error")
        if (reply === "reject") expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(blocked)
      }
      const retracted = yield* fixture.delegations.foldState(receipt.delegationID)
      yield* mc07Consumed(fixture, "mc07-external-retract-reject")
      yield* mc07Consumed(fixture, "mc07-external-retract-once")
      expect(retracted?.delegation.rejectionBlocked).toBe(false)
      expect(retracted?.reviews).toEqual(blocked?.reviews)
      const r1Binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        yield* kv.get(DelegationReceipt.key(receipt)),
      )
      const r2Binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        yield* kv.get(DelegationReceipt.key(approvedReceipt)),
      )
      expect(r1Binding.review).toMatchObject({
        receipt: fixture.receipt,
        revisionDigest: fixture.digest,
        artifact: { normalizedDiff: mc07Diff },
      })
      expect(r1Binding.reviewText).toBe("base\nr1\n")
      expect(r2Binding.review).toMatchObject({ receipt: repairedReceipt, revisionDigest: digest })
      expect(r2Binding.reviewText).toBe("base\nr2\n")
      const nativeRequests = external.calls
        .filter((call) => call.method === "turn/start")
        .map((call) =>
          Schema.decodeUnknownSync(
            Schema.Struct({
              input: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
              sandboxPolicy: Schema.Struct({ type: Schema.Literal("readOnly"), networkAccess: Schema.Literal(false) }),
            }),
          )(call.input),
        )
      expect(nativeRequests).toHaveLength(2)
      expect(nativeRequests[0]?.input[0]?.text).toContain(
        JSON.stringify({ reference: r1Binding.review, text: r1Binding.reviewText }),
      )
      expect(nativeRequests[1]?.input[0]?.text).toContain(
        JSON.stringify({ reference: r2Binding.review, text: r2Binding.reviewText }),
      )
      expect(
        (yield* fixture.llm.requests()).some((request) =>
          request.messages.some(
            (message) =>
              message.role === "user" &&
              message.content.some((part) => part.type === "text" && part.text === repairPrompt),
          ),
        ),
      ).toBe(true)
      for (const change of ["no_change", "no_code_change"] as const) {
        const before = (yield* fixture.llm.requests()).length
        const head = yield* Effect.promise(async () => ({
          sha: (await $`git rev-parse HEAD`.cwd(fixture.root.location.directory).quiet().text()).trim(),
          tree: (await $`git show -s --format=%T HEAD`.cwd(fixture.root.location.directory).quiet().text()).trim(),
        }))
        const callID = `mc07-external-${change}`
        const command =
          "git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m mc07-no-code-change"
        yield* fixture.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: `Capture ${change}`,
            prompt:
              change === "no_change"
                ? "Keep the exact R2 bytes and HEAD."
                : "Execute the one authorized empty commit; keep R2 unstaged and unchanged.",
            subagent_type: fixture.worker,
            delegation_id: receipt.delegationID,
            participant_id: repairedReceipt.participantID,
            task_id: repairedReceipt.childSessionID,
            command: "append",
            artifact_path: "artifact.txt",
          }),
          ...(change === "no_code_change"
            ? [TestLLM.tool(`${callID}-shell`, "shell", { command, workdir: fixture.root.location.directory })]
            : []),
          TestLLM.text(`Completed ${change}.`, `${callID}-child`),
          TestLLM.text(`Consumed the complete ${change} producer.`, `${callID}-parent`),
        )
        yield* fixture.sessions.prompt({
          sessionID: fixture.root.id,
          text: `Capture ${change} on the same child before archival.`,
        })
        yield* fixture.runs.awaitIdle(fixture.root.id)
        expect((yield* fixture.llm.requests()).length).toBeGreaterThanOrEqual(
          before + (change === "no_code_change" ? 4 : 3),
        )
        const copied = yield* mc07Consumed(fixture, callID)
        expect(copied.tool.state).toMatchObject({ status: "completed" })
        const governance = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationService.Governance))(
          copied.text.match(/<task_governance>([\s\S]*?)<\/task_governance>/)?.[1],
        )
        if (governance.kind !== "revision" || !("artifact" in governance))
          return yield* Effect.die(new Error("Copy has no visible producer"))
        expect(governance.receipt).toMatchObject({
          childSessionID: repairedReceipt.childSessionID,
          participantID: repairedReceipt.participantID,
        })
        expect(governance.receipt.inputID).not.toBe(repairedReceipt.inputID)
        expect(governance.artifact).toMatchObject({
          changeKind: change,
          targetSha256: repairedGovernance.artifact.targetSha256,
          normalizedDiff: repairedGovernance.artifact.normalizedDiff,
        })
        const current = yield* fixture.delegations.foldState(receipt.delegationID)
        expect(current?.reviews).toEqual(retracted?.reviews)
        expect(current?.revisions).toHaveLength(change === "no_change" ? 2 : 3)
        if (!current) return yield* Effect.die(new Error("Copy has no effective review context"))
        expect(
          DelegationReview.evaluateReviewBarrier({
            participants: [...current.participants.values()],
            reviews: current.reviews,
            revisions: current.revisions,
            latestRevisionDigest: current.delegation.latestRevisionDigest,
            rejectionBlocked: current.delegation.rejectionBlocked,
          }).passed,
        ).toBe(true)
        if (change === "no_change") expect(governance.producer?.receipt).toEqual(repairedReceipt)
        if (change === "no_code_change") {
          expect(governance.artifact.revisionDigest).not.toBe(digest)
          expect(
            yield* Effect.promise(async () =>
              (await $`git show -s --format=%P HEAD`.cwd(fixture.root.location.directory).quiet().text()).trim(),
            ),
          ).toBe(head.sha)
          expect(
            yield* Effect.promise(async () =>
              (await $`git show -s --format=%T HEAD`.cwd(fixture.root.location.directory).quiet().text()).trim(),
            ),
          ).toBe(head.tree)
        }
        expect(external.state.turns).toBe(2)
        expect(
          Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(receipt))),
        ).toEqual(r1Binding)
        expect(
          Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(approvedReceipt))),
        ).toEqual(r2Binding)
      }
      const ready = yield* fixture.delegations.foldState(receipt.delegationID)
      const sourceConflict = new DelegationReceipt.Binding({
        ...r2Binding,
        source: { ...r2Binding.source, id: "foreign-source" },
      })
      yield* kv.set(
        DelegationReceipt.key(approvedReceipt),
        Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(sourceConflict),
      )
      if (approvedOutput.governance?.kind !== "review" || approvedOutput.governance.status !== "valid")
        return yield* Effect.die(new Error("Visible R2 proof is missing"))
      const reviewInput = {
        ...approvedReceipt,
        reviewedRevisionDigest: digest,
        verdict: approvedOutput.governance.envelope.verdict,
        findings: approvedOutput.governance.envelope.findings,
        summary: approvedOutput.governance.envelope.summary,
        receipt: approvedReceipt,
        source: approvedReceipt.source,
      }
      expect(yield* fixture.delegations.recordReview(reviewInput).pipe(Effect.flip)).toMatchObject({
        _tag: "Delegation.DelegationInvalidStateError",
      })
      expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(ready)
      yield* kv.set(
        DelegationReceipt.key(approvedReceipt),
        Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(r2Binding),
      )
      expect(yield* fixture.delegations.recordReview(reviewInput)).toBe("reused")
      const legacy = { ...r2Binding }
      delete legacy.settlement
      yield* kv.set(
        DelegationReceipt.key(approvedReceipt),
        Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(new DelegationReceipt.Binding(legacy)),
      )
      expect(
        yield* fixture.delegations
          .close({ delegationID: receipt.delegationID, requireComplete: true })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError", reason: expect.stringContaining("proof") })
      expect(yield* fixture.delegations.foldState(receipt.delegationID)).toEqual(ready)
      yield* kv.set(
        DelegationReceipt.key(approvedReceipt),
        Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(r2Binding),
      )
      yield* fixture.sessions.setPermissions({
        sessionID: fixture.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "task_close", resource: receipt.delegationID, effect: "ask" },
          { action: "task_archive", resource: receipt.delegationID, effect: "ask" },
        ],
      })
      for (const failure of [true, false]) {
        external.state.archiveFailure = failure
        const callID = failure ? "mc07-external-archive-failed" : "mc07-external-complete"
        yield* fixture.llm.push(
          TestLLM.tool(callID, TaskTool.name, {
            description: "Complete and archive the actual task",
            prompt: "Complete the repaired task after the explicit retraction and inherited approval.",
            subagent_type: fixture.worker,
            delegation_id: receipt.delegationID,
            command: "complete",
          }),
          TestLLM.text("Consumed the complete archive result.", `${callID}-parent`),
        )
        yield* fixture.sessions.prompt({
          sessionID: fixture.root.id,
          text: failure
            ? "Complete and archive the task with the current permissions."
            : "Retry the explicit archive after its recorded failure; preserve the completed task.",
        })
        for (const action of ["task_close", "task_archive"] as const) {
          const request = yield* pollWithTimeout(
            external.permission
              .forSession(fixture.root.id)
              .pipe(Effect.map((requests) => requests.find((request) => request.action === action))),
            `${action} permission is missing`,
          )
          expect(request.resources).toEqual([receipt.delegationID])
          yield* external.permission.reply({ requestID: request.id, reply: "once" })
        }
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "External completion did not settle")
        const result = yield* mc07Consumed(fixture, callID)
        expect(result.tool.state.status).toBe(failure ? "error" : "completed")
        if (failure) {
          if (result.tool.state.status !== "error") return yield* Effect.die(new Error("Archive failure was hidden"))
          expect(result.tool.state.error.message).toContain("Native thread archive failed")
          expect((yield* fixture.delegations.foldState(receipt.delegationID))?.delegation.status).toBe("completed")
          expect(
            Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(approvedReceipt)))
              .archiveReceipts,
          ).toMatchObject([
            {
              status: "failed",
              source: { type: "tool", messageID: result.assistant.id, id: callID },
              error: expect.stringContaining("Controlled archive failure"),
            },
          ])
        }
      }
      const completed = yield* mc07Consumed(fixture, "mc07-external-complete")
      const final = yield* fixture.delegations.foldState(receipt.delegationID)
      expect(final?.delegation.status).toBe("archived")
      expect(final?.archivedFrom).toBe("completed")
      expect(completed.text).toContain('"archivedFrom":"completed"')
      expect(completed.text).toContain(
        JSON.stringify({ type: "tool", messageID: completed.assistant.id, id: "mc07-external-complete" }),
      )
      expect(external.calls.filter((call) => call.method === "thread/archive")).toHaveLength(2)
      expect(external.calls.filter((call) => call.method === "thread/archive")).toEqual([
        expect.objectContaining({
          thread: receipt.externalThreadID,
          cwd: fixture.root.location.directory,
          command: "mc06-controlled-peer",
          input: { threadId: receipt.externalThreadID },
        }),
        expect.objectContaining({
          thread: receipt.externalThreadID,
          cwd: fixture.root.location.directory,
          command: "mc06-controlled-peer",
          input: { threadId: receipt.externalThreadID },
        }),
      ])
      const archivedBinding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        yield* kv.get(DelegationReceipt.key(approvedReceipt)),
      )
      expect(archivedBinding.settlement).toEqual(r2Binding.settlement)
      expect(archivedBinding.archiveReceipts?.map((record) => record.status)).toEqual(["failed", "completed"])
      expect(archivedBinding.archiveReceipts?.[1]?.source).toEqual({
        type: "tool",
        messageID: completed.assistant.id,
        id: "mc07-external-complete",
      })
      const events = yield* bus.log({ aggregateID: receipt.delegationID }).pipe(
        Stream.filter(
          (event): event is Event.Payload<Event.DurableDefinition> =>
            !Bus.isSynced(event) && event.durable !== undefined,
        ),
        Stream.runCollect,
      )
      expect(events.filter((event) => event.type === DelegationEvent.Completed.type)).toHaveLength(1)
      expect(events.filter((event) => event.type === DelegationEvent.Archived.type)).toHaveLength(1)
      console.log(
        "MC07 external governance evidence",
        JSON.stringify({
          r1: { receipt: fixture.receipt, digest: fixture.digest, review: output.governance },
          r2: { receipt: repairedReceipt, digest, review: approvedOutput.governance },
          nativeRequests,
          archivedBinding,
          delegation: final?.delegation,
          archivedFrom: final?.archivedFrom,
          events: events.map((event) => ({ type: event.type, seq: event.durable.seq, data: event.data })),
          completeBody: completed.text,
        }),
      )
      expect(external.decisions).toEqual([
        { id: 7, decision: "decline" },
        { id: 7, decision: "decline" },
      ])
      expect(yield* external.permission.forSession(fixture.root.id)).toEqual([])
      const db = (yield* Database.Service).db
      expect(
        yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.session_id, fixture.root.id)).all(),
      ).toEqual([])
      return undefined
    }),
  30_000,
)

for (const invalid of ["missing", "malformed", "wrong_digest"] as const)
  effectTest.live(`MC07 external governance keeps ${invalid} native review invalid with full parent consumption`, () =>
    Effect.gen(function* () {
      const fixture = yield* mc07Build("artifact.txt", "", true)
      const external = yield* externalSetup(
        false,
        Agent.ID.make("meta"),
        false,
        undefined,
        false,
        "app-server",
        fixture,
      )
      external.outputs[0] =
        invalid === "missing"
          ? "No typed review was returned."
          : invalid === "malformed"
            ? "<review>{not-json}</review>"
            : `<review>${JSON.stringify({
                kind: "aigcfroge.review.v1",
                reviewed_revision_digest: `rev_${"0".repeat(64)}`,
                verdict: "approved",
                findings: [],
              })}</review>`
      yield* fixture.llm.push(
        TestLLM.tool(`mc07-external-${invalid}`, TaskTool.name, {
          description: "Review the captured R1",
          prompt: "Review the current artifact and return the typed result.",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          intent: "review",
          attended: false,
          delegation_id: fixture.receipt.delegationID,
          revision_digest: fixture.digest,
        }),
        TestLLM.text("Consumed the invalid external review.", `mc07-external-${invalid}-parent`),
      )
      yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Review the real R1." })
      yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "Invalid native review did not settle")
      const result = yield* mc07Consumed(fixture, `mc07-external-${invalid}`)
      expect(result.tool.state).toMatchObject({ status: "completed" })
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(result.text)
      expect(output.output).toBe(external.outputs[0])
      expect(output.governance).toMatchObject({ kind: "review", status: "invalid", reason: invalid })
      const state = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
      expect(state?.reviews).toEqual([])
      expect(state?.revisions).toHaveLength(1)
      expect(state?.delegation.latestRevisionDigest).toBe(fixture.digest)
      const db = (yield* Database.Service).db
      expect(
        yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.session_id, fixture.root.id)).all(),
      ).toEqual([])
    }),
  )

effectTest.live("MC07 external governance read deny stops before review admission and native start", () =>
  Effect.gen(function* () {
    const fixture = yield* mc07Build("artifact.txt", "", true)
    const external = yield* externalSetup(false, Agent.ID.make("meta"), false, undefined, false, "app-server", fixture)
    const before = yield* fixture.delegations.foldState(fixture.receipt.delegationID)
    const tasks = yield* SessionTask.Service
    const priorTasks = yield* tasks.get(fixture.root.id)
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "deny" },
      ],
    })
    yield* fixture.llm.push(
      TestLLM.tool("mc07-external-read-deny", TaskTool.name, {
        description: "Read the actual R1",
        prompt: "Review R1 under the current read policy.",
        subagent_type: "codex",
        cli_target: "codex",
        execution_type: "external-cli",
        intent: "review",
        attended: false,
        delegation_id: fixture.receipt.delegationID,
        revision_digest: fixture.digest,
      }),
      TestLLM.text("Consumed the current read denial.", "mc07-external-read-deny-parent"),
    )
    yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: "Attempt the review with read denied." })
    yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "Denied native review did not settle")
    expect((yield* mc07Consumed(fixture, "mc07-external-read-deny")).tool.state.status).toBe("error")
    expect(yield* fixture.delegations.foldState(fixture.receipt.delegationID)).toEqual(before)
    expect(yield* tasks.get(fixture.root.id)).toEqual(priorTasks)
    expect(external.calls).toEqual([])
    expect(external.decisions).toEqual([])
  }),
)

for (const ownerDuringRead of [false, true])
  testEffect(Layer.empty).live(
    `MC07 external governance ${ownerDuringRead ? "defers for the new parent owner" : "recovers a real Task checkpoint before Tool.Success with the same typed proof"}`,
    () =>
      Effect.gen(function* () {
        const originalContext = yield* Layer.build(metaLayer(true))
        const fixture = yield* mc07Build("artifact.txt", "", true).pipe(Effect.provide(originalContext))
        const external = yield* externalSetup(
          false,
          Agent.ID.make("meta"),
          false,
          undefined,
          false,
          "app-server",
          fixture,
        ).pipe(Effect.provide(originalContext))
        external.outputs[0] =
          "MC07_COLD_" +
          "x".repeat(5000) +
          `<review>${JSON.stringify({
            kind: "aigcfroge.review.v1",
            reviewed_revision_digest: fixture.digest,
            verdict: "rejected",
            findings: [],
            summary: "The persisted R1 requires repair.",
          })}</review>`
        external.state.holdResult = true
        yield* fixture.llm.push(
          TestLLM.tool("mc07-external-cold", TaskTool.name, {
            description: "Review the captured R1",
            prompt: "Review the current bound artifact.",
            subagent_type: "codex",
            cli_target: "codex",
            execution_type: "external-cli",
            intent: "review",
            attended: false,
            delegation_id: fixture.receipt.delegationID,
            revision_digest: fixture.digest,
          }),
          TestLLM.text("Consumed the original external result.", "mc07-external-cold-original-parent"),
        )
        yield* fixture.sessions.prompt({
          sessionID: fixture.root.id,
          text: "Review R1 and preserve the original Task.",
        })
        const kv = Context.get(originalContext, KV.Service)
        const binding = yield* pollWithTimeout(
          kv.scan({ prefix: `delegation:external:${fixture.receipt.delegationID}:` }).pipe(
            Effect.map((page) =>
              page.entries
                .flatMap((entry) => {
                  const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(entry.value)
                  return Option.isSome(decoded) &&
                    decoded.value.source.id === "mc07-external-cold" &&
                    decoded.value.externalTurnID
                    ? [decoded.value]
                    : []
                })
                .at(0),
            ),
          ),
          "Actual native review binding is missing",
        )
        yield* pollWithTimeout(
          Effect.sync(() => external.decisions.at(0)),
          "Original native approval did not settle",
        )
        expect((yield* mc07Result(fixture, binding.source.id)).tool.state.status).toBe("running")
        const snapshot = `${(yield* tmpdirScoped()).path}/mc07-cold.sqlite`
        const database = Context.get(originalContext, Database.Service)
        yield* database.db.run(sql`VACUUM INTO ${snapshot}`)
        external.state.holdResult = false
        external.releaseResult()
        yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), "Original native result did not finish")
        const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
        expect(Context.get(context, Database.Service)).not.toBe(database)
        const sessions = Context.get(context, Session.Service)
        const root = yield* sessions.get(fixture.root.id)
        const locations = Context.get(context, LocationServiceMap.Service)
        const local = locations.get(root.location)
        yield* useOfflineCatalog([
          {
            info: Provider.Info.make({
              ...Provider.Info.empty(fixture.metaModel.providerID),
              activation: "enabled",
              package: "@aigcfroge/ai/providers/openai/responses",
            }),
            models: [fixture.metaModel, fixture.executorModel].map((ref) =>
              Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
            ),
          },
        ]).pipe(Effect.provide(local))
        const opened = {
          ...fixture,
          sessions,
          root,
          llm: Context.get(context, TestLLM.Test),
          runs: Context.get(context, SessionExecution.Service),
        }
        const execution = Context.get(context, DelegationExecution.Service)
        expect((yield* mc07Result(opened, binding.source.id)).tool.state.status).toBe("running")
        if (ownerDuringRead) {
          const before = Effect.all({
            state: Context.get(context, DelegationService.Service).foldState(binding.delegationID),
            tasks: Context.get(context, SessionTask.Service).get(root.id),
          })
          const observed = yield* Deferred.make<Effect.Success<typeof before>>()
          const held = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          yield* opened.llm.push(
            Stream.fromEffect(Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release)))).pipe(
              Stream.flatMap(() =>
                Stream.fromIterable(TestLLM.text("The new parent owner completed.", "mc07-new-owner")),
              ),
            ),
          )
          external.readBoundary.beforeResult = Effect.gen(function* () {
            yield* opened.sessions.prompt({
              sessionID: root.id,
              text: "Resume with the new parent input while the old native result is being read.",
            })
            yield* awaitWithTimeout(Deferred.await(held), "The new parent owner did not start")
            yield* Deferred.succeed(observed, yield* before)
          }).pipe(Effect.orDie)
          yield* execution.recoverPending
          expect(yield* opened.runs.isActive(root.id)).toBe(true)
          expect(yield* before).toEqual(yield* Deferred.await(observed))
          expect(
            Schema.decodeUnknownSync(DelegationReceipt.Binding)(
              yield* Context.get(context, KV.Service).get(DelegationReceipt.key(binding)),
            ).settlement,
          ).toBeUndefined()
          yield* Deferred.succeed(release, undefined)
          yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "The new parent owner did not finish")
          return
        }
        expect(yield* execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [root.id] })
        const recovered = yield* mc07Result(opened, binding.source.id)
        expect(recovered.tool.state).toMatchObject({ status: "completed" })
        if (recovered.tool.state.status !== "completed")
          return yield* Effect.die(new Error("Native checkpoint was not recovered"))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(
          recovered.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        expect(output.output).toBe(external.outputs[0])
        expect(output.governance).toMatchObject({
          kind: "review",
          status: "valid",
          reviewedRevisionDigest: fixture.digest,
          receipt: {
            source: binding.source,
            externalThreadID: binding.externalThreadID,
            externalTurnID: binding.externalTurnID,
          },
        })
        const state = yield* Context.get(context, DelegationService.Service).foldState(binding.delegationID)
        expect(state?.reviews).toHaveLength(1)
        yield* execution.recoverPending
        expect(yield* mc07Result(opened, binding.source.id)).toEqual(recovered)
        yield* opened.llm.push(
          TestLLM.text(
            "Consumed the complete recovered review and its original identities.",
            "mc07-external-cold-parent",
          ),
        )
        yield* opened.runs.resume(root.id)
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "Recovered parent did not finish")
        yield* mc07Consumed(opened, binding.source.id)
        expect(external.state.turns).toBe(1)
        expect(external.calls.filter((call) => call.method === "thread/read")).toHaveLength(1)
      }),
  )

for (const transport of ["sdk", "acp", "jsonl"] as const)
  effectTest.live(`MC06 R4 ${transport} refusal reaches the parent without external admission`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), false, undefined, false, transport)
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Try the explicitly configured external transport once." })
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Unsupported transport did not settle")
      const calls = (yield* f.sessions.context(f.root.id)).flatMap((message) =>
        message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
      )
      expect(calls).toHaveLength(1)
      const call = calls[0]
      if (!call || call.state.status !== "error")
        return yield* Effect.die(new Error("Expected the original Task error"))
      expect(call.name).toBe(TaskTool.name)
      expect(call.state.error.message).toContain("codex/app-server")
      const requests = yield* f.llm.requests()
      expect(requests).toHaveLength(2)
      const consumed = requests[1]?.messages
        .flatMap((message) => (message.role === "tool" ? message.content : []))
        .find((part) => part.type === "tool-result" && part.id === call.id)
      expect(consumed?.type === "tool-result" && consumed.result).toEqual({
        type: "error",
        value: { error: call.state.error, content: call.state.content ?? [] },
      })
      expect((yield* f.sessions.get(f.root.id)).outcome).toBe("succeeded")
      expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
      const tasks = yield* SessionTask.Service
      expect(yield* tasks.get(f.root.id)).toEqual([])
      const delegations = yield* DelegationService.Service
      expect(yield* delegations.resolveActive(f.root.id, Agent.ID.make("meta"))).toBeUndefined()
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect(f.calls).toEqual([])
      expect(f.decisions).toEqual([])
      expect(f.state.turns).toBe(0)
      expect(f.state.closed).toBe(0)
      const database = yield* Database.Service
      expect(
        yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt"))),
      ).toEqual([])
    }),
  )

const queuedExternalSetup = () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(false, Agent.ID.make("meta"), true, undefined, true)
    f.outputs[0] = "MC06_QUEUE_PREDECESSOR"
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start the original background external work" })
    yield* awaitWithTimeout(f.llm.wait(2), "Original background ACK was not consumed")
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original background ACK did not release the parent")
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "MC06_R3_QUEUE_1" })
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Queued admission blocked on its active predecessor")
    const call = (yield* f.sessions.context(f.root.id))
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .find((part) => part.type === "tool" && part.id === "mc06-queue-1")
    expect(call).toMatchObject({ state: { status: "completed", metadata: { status: "queued" } } })
    if (call?.type !== "tool" || call.state.status !== "completed")
      return yield* Effect.die(new Error("Queued ACK missing"))
    const tasks = yield* SessionTask.Service
    const parentTaskID = Schema.decodeUnknownSync(Schema.String)(call.state.metadata?.parentTaskID)
    const queuedTask = (yield* tasks.get(f.root.id)).find((task) => task.id === parentTaskID)
    const delegations = yield* DelegationService.Service
    const state = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
    const delivery = state && [...state.deliveries.values()].find((item) => item.status === "queued")
    if (!queuedTask || !state || !delivery) return yield* Effect.die(new Error("Queued durable identity missing"))
    return {
      ...f,
      queuedTask,
      queueCall: call,
      queueState: state,
      queueDelivery: delivery,
      queueKey: DelegationReceipt.key({ ...delivery, delegationID: state.delegation.id }),
      noticeID: DelegationReceipt.notificationID(DelegationFold.inputID(state.delegation.id, delivery), queuedTask.id),
    }
  })

effectTest.live("MC06 pending interrupt uses the parent permission and preserves its active predecessor", () =>
  Effect.gen(function* () {
    const f = yield* queuedExternalSetup()
    const delegations = yield* DelegationService.Service
    const jobs = yield* Job.Service
    const before = yield* delegations.foldState(f.queueState.delegation.id)
    const physicalCalls = f.calls.filter((call) => ["turn/start", "turn/steer", "turn/interrupt"].includes(call.method))
    for (const allowed of [false, true]) {
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "task_interrupt", resource: f.queueState.delegation.id, effect: allowed ? "allow" : "deny" },
        ],
      })
      const id = allowed ? "mc06-pending-cancel" : "mc06-pending-denied"
      const requests = (yield* f.llm.requests()).length
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Cancel only the unsent queued input",
          prompt: "Keep the original background work and its result.",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          command: "interrupt",
          delegation_id: f.queueState.delegation.id,
          participant_id: f.queueDelivery.participantID,
          turn_id: f.queueDelivery.turnID,
        }),
        TestLLM.text("Consumed the exact interrupt outcome.", `${id}-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: `Request ${id}` })
      yield* awaitWithTimeout(f.llm.wait(requests + 2), "The targeted interrupt did not reach its parent")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The targeted interrupt did not settle")
      expect((yield* mc07Result(f, id)).tool.state.status).toBe(allowed ? "completed" : "error")
      if (!allowed) {
        expect(yield* delegations.foldState(f.queueState.delegation.id)).toEqual(before)
        expect((yield* jobs.get(f.queueKey))?.status).toBe("running")
      }
    }
    const state = yield* pollWithTimeout(
      delegations
        .foldState(f.queueState.delegation.id)
        .pipe(
          Effect.map((state) =>
            state &&
            [...state.deliveries.values()].some(
              (delivery) => delivery.turnID === f.queueDelivery.turnID && delivery.status === "cancelled",
            )
              ? state
              : undefined,
          ),
        ),
      "The exact queued delivery was not cancelled",
    )
    expect(state.participants.get(f.queueDelivery.participantID)?.phase).not.toBe("closed")
    expect([...state.deliveries.values()].filter((delivery) => delivery.status === "running")).toHaveLength(1)
    expect((yield* mc07Result(f, "mc06-queue-1")).tool).toEqual(f.queueCall)
    expect(f.state.turns).toBe(1)
    expect(f.state.closed).toBe(0)
    expect(f.calls.filter((call) => ["turn/start", "turn/steer", "turn/interrupt"].includes(call.method))).toEqual(
      physicalCalls,
    )
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).find((task) => task.id === f.queuedTask.id)?.status).toBe("cancelled")
    const notice = yield* pollWithTimeout(
      f.sessions
        .context(f.root.id)
        .pipe(
          Effect.map((messages) =>
            messages.find((message) => message.type === "synthetic" && message.id === f.noticeID),
          ),
        ),
      "The precise cancellation did not publish its terminal result",
    )
    if (notice.type !== "synthetic") return yield* Effect.die(new Error("The cancellation result was not synthetic"))
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(notice.text)).toMatchObject({
      status: "cancelled",
      execution: "queued",
      parentTaskID: f.queuedTask.id,
    })
    expect((yield* jobs.get(f.queueKey))?.status).not.toBe("running")
    const predecessor = [...state.deliveries.values()].find((delivery) => delivery.status === "running")
    if (!predecessor) return yield* Effect.die(new Error("The active predecessor was lost"))
    expect(
      (yield* jobs.get(DelegationReceipt.key({ ...predecessor, delegationID: state.delegation.id })))?.status,
    ).toBe("running")
  }),
)

effectTest.live(
  "MC06 R3b acknowledges two queued inputs before ordered native starts and delivers their full results",
  () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), true, undefined, true)
      f.outputs[0] = "MC06_QUEUE_PREDECESSOR"
      f.outputs[1] = "MC06_QUEUED_" + "x".repeat(60_000) + "_TAIL"
      f.outputs[2] = "MC06_QUEUE_LAST"
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start the original background external work" })
      yield* awaitWithTimeout(f.llm.wait(2), "Original background ACK was not consumed")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original background ACK did not release the parent")
      for (const index of [1, 2]) {
        yield* f.sessions.prompt({ sessionID: f.root.id, text: `MC06_R3_QUEUE_${index}` })
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Queued admission blocked on its active predecessor")
        const messages = yield* f.sessions.context(f.root.id)
        const call = messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.id === `mc06-queue-${index}`)
        expect(call).toMatchObject({ state: { status: "completed", metadata: { status: "queued" } } })
        if (call?.type !== "tool" || call.state.status !== "completed")
          return yield* Effect.die(new Error("Queued ACK missing"))
        const ack = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
          call.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        expect(ack).toMatchObject({ kind: "external-cli", status: "queued" })
        expect(ack).not.toHaveProperty("externalTurnID")
        expect(call.state.metadata?.externalReceipt).toBeUndefined()
        expect(f.state.turns).toBe(1)
        expect(f.state.closed).toBe(0)
      }
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual([
        "in_progress",
        "in_progress",
        "in_progress",
      ])
      const delegations = yield* DelegationService.Service
      const queued = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
      if (!queued) return yield* Effect.die(new Error("Queued delegation missing"))
      expect(
        [...queued.turns.values()].sort((left, right) => left.seq - right.seq).map((turn) => turn.delivery),
      ).toEqual(["steer", "queue", "queue"])
      expect([...queued.deliveries.values()].filter((delivery) => delivery.status === "queued")).toHaveLength(2)
      const database = yield* Database.Service
      expect(
        yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt"))),
      ).toHaveLength(0)
      for (const [index, id] of ["mc06-first", "mc06-queue-1", "mc06-queue-2"].entries()) {
        yield* pollWithTimeout(
          Effect.sync(() => (f.state.turns === index + 1 ? true : undefined)),
          "Queued native turn did not start after its predecessor",
        )
        f.requestApproval()
        const asked = yield* pollWithTimeout(
          f.permission
            .forSession(f.root.id)
            .pipe(
              Effect.map((pending) =>
                pending.find((request) => request.source?.type === "tool" && request.source.id === id),
              ),
            ),
          "The queued turn did not retain its own original permission source",
        )
        yield* f.permission.reply({ requestID: asked.id, reply: "once" })
      }
      yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              f.outputs.every((output) =>
                messages.some((message) => message.type === "synthetic" && message.text.includes(output)),
              )
                ? true
                : undefined,
            ),
          ),
        "Queued complete outputs were not delivered",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Queued result consumer did not settle")
      expect(f.calls.filter((call) => call.method === "turn/start").map((call) => call.closedBeforeStart)).toEqual([
        0, 1, 2,
      ])
      expect(f.calls.filter((call) => call.method === "turn/start").map((call) => call.thread)).toEqual([
        undefined,
        "external-thread",
        "external-thread",
      ])
      expect(f.calls.filter((call) => call.method === "turn/start").map((call) => call.input)).toMatchObject([
        { input: [{ text: "Return the first result" }] },
        { input: [{ text: "Execute mc06-queue-1 after its physical predecessor" }] },
        { input: [{ text: "Execute mc06-queue-2 after its physical predecessor" }] },
      ])
      expect(f.state.steers).toEqual([])
      expect(f.state.turns).toBe(3)
      expect(f.state.closed).toBe(3)
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "completed", "completed"])
      const receipts = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      expect(receipts).toHaveLength(3)
      expect(new Set(receipts.map((receipt) => receipt.tool_call_id))).toEqual(
        new Set(["mc06-first", "mc06-queue-1", "mc06-queue-2"]),
      )
      const requests = yield* f.llm.requests()
      expect(f.outputs.every((output) => JSON.stringify(requests.at(-1)?.messages).includes(output))).toBe(true)
    }),
)

effectTest.live(
  "MC06 R3b cancels a pending Job without cancelling its physical predecessor or inventing a native turn",
  () =>
    Effect.gen(function* () {
      const f = yield* queuedExternalSetup()
      const jobs = yield* Job.Service
      expect(yield* jobs.cancel(f.queueKey)).toMatchObject({ status: "cancelled" })
      expect(f.state.turns).toBe(1)
      expect(f.state.closed).toBe(0)
      const notice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === f.noticeID),
            ),
          ),
        "Cancelled queued input did not publish its accurate admission result",
      )
      if (notice.type !== "synthetic") return yield* Effect.die(new Error("Queued result was not synthetic"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(notice.text)
      expect(output).toMatchObject({ kind: "external-cli", status: "cancelled", parentTaskID: f.queuedTask.id })
      expect(output).not.toHaveProperty("externalTurnID")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Cancelled queued notification did not settle")
      f.requestApproval()
      const asked = yield* pollWithTimeout(
        f.permission
          .forSession(f.root.id)
          .pipe(
            Effect.map((pending) =>
              pending.find((request) => request.source?.type === "tool" && request.source.id === "mc06-first"),
            ),
          ),
        "Cancelling a queued Job cancelled the original permission scope",
      )
      yield* f.permission.reply({ requestID: asked.id, reply: "once" })
      yield* pollWithTimeout(
        Effect.sync(() => (f.state.closed === 1 ? true : undefined)),
        "Original Job did not complete after queued cancellation",
      )
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === f.queuedTask.id)?.status).toBe("cancelled")
      const database = yield* Database.Service
      const receipt = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
            eq(MetaAgentStepTable.tool_call_id, "mc06-queue-1"),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
      expect(receipt).toHaveLength(1)
      expect(receipt[0]?.status).toBe("failed")
      expect(f.state.turns).toBe(1)
      expect(f.calls.some((call) => call.method === "turn/interrupt")).toBe(false)
    }),
)

for (const stop of ["interrupted", "error"] as const)
  effectTest.live(`MC06 R3b retains recovery facts and never starts after a ${stop} predecessor`, () =>
    Effect.gen(function* () {
      const f = yield* queuedExternalSetup()
      f.terminate(stop)
      const delegations = yield* DelegationService.Service
      const delivery = yield* pollWithTimeout(
        delegations.foldState(f.queueState.delegation.id).pipe(
          Effect.map((state) => {
            const value = state && [...state.deliveries.values()].find((item) => item.turnID === f.queueDelivery.turnID)
            return value?.status === "recovery_required" ? value : undefined
          }),
        ),
        "Queued input did not retain its non-success predecessor outcome",
      )
      expect(delivery.externalTurnID).toBeUndefined()
      const notice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === f.noticeID),
            ),
          ),
        "Queued recovery state was not delivered to its parent",
      )
      if (notice.type !== "synthetic") return yield* Effect.die(new Error("Queued recovery notice missing"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(notice.text)
      expect(output).toMatchObject({ status: "recovery_required", parentTaskID: f.queuedTask.id })
      expect(output).not.toHaveProperty("externalTurnID")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Queued recovery notice did not settle")
      expect(f.state.turns).toBe(1)
      expect(f.state.closed).toBe(1)
      expect(f.decisions.some((decision) => decision.decision === "accept")).toBe(false)
      const tasks = yield* SessionTask.Service
      const before = {
        state: yield* delegations.foldState(f.queueState.delegation.id),
        tasks: yield* tasks.get(f.root.id),
        calls: [...f.calls],
      }
      if (!before.state) return yield* Effect.die(new Error("The stopped predecessor lost its delegation"))
      const execution = yield* DelegationExecution.Service
      yield* execution.interrupt({
        delegationID: f.queueState.delegation.id,
        participantID: f.queueDelivery.participantID,
        turnID: f.queueDelivery.turnID,
      })
      const after = yield* delegations.foldState(f.queueState.delegation.id)
      const cancelled = [...(after?.deliveries.values() ?? [])].find((item) => item.turnID === f.queueDelivery.turnID)
      expect(cancelled).toMatchObject({ status: "cancelled" })
      expect(cancelled?.externalTurnID).toBeUndefined()
      expect([...(after?.deliveries.values() ?? [])].filter((item) => item.turnID !== f.queueDelivery.turnID)).toEqual(
        [...before.state.deliveries.values()].filter((item) => item.turnID !== f.queueDelivery.turnID),
      )
      expect(after?.participants.get(f.queueDelivery.participantID)).toEqual(
        before.state.participants.get(f.queueDelivery.participantID),
      )
      expect(yield* tasks.get(f.root.id)).toEqual(before.tasks)
      expect((yield* f.sessions.context(f.root.id)).find((message) => message.id === f.noticeID)).toEqual(notice)
      expect((yield* mc07Result(f, "mc06-queue-1")).tool).toEqual(f.queueCall)
      expect(f.calls).toEqual(before.calls)
    }),
  )

effectTest.live("MC06 R3b does not start or overwrite a queued Task whose revision changed", () =>
  Effect.gen(function* () {
    const f = yield* queuedExternalSetup()
    const tasks = yield* SessionTask.Service
    const changed = yield* tasks.updateTask({
      sessionID: f.root.id,
      id: f.queuedTask.id,
      expectedRevision: f.queuedTask.revision,
      status: "in_progress",
      content: "New owner decision before queued execution",
    })
    if (!changed) return yield* Effect.die(new Error("Queued Task revision did not change"))
    f.requestApproval()
    const asked = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "Original Job permission missing",
    )
    yield* f.permission.reply({ requestID: asked.id, reply: "once" })
    const jobs = yield* Job.Service
    yield* pollWithTimeout(
      jobs.get(f.queueKey).pipe(Effect.map((job) => (job?.status !== "running" ? true : undefined))),
      "Stale queued claim did not stop",
    )
    expect((yield* tasks.get(f.root.id)).find((task) => task.id === changed.id)).toEqual(changed)
    expect(f.state.turns).toBe(1)
    expect((yield* f.sessions.context(f.root.id)).some((message) => message.id === f.noticeID)).toBe(false)
    const database = yield* Database.Service
    expect(
      yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
            eq(MetaAgentStepTable.tool_call_id, "mc06-queue-1"),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        ),
    ).toHaveLength(0)
  }),
)

effectTest.live(
  "MC06 R3b closes the original and pending Jobs without starting queued work or retaining the lock",
  () =>
    Effect.gen(function* () {
      const f = yield* queuedExternalSetup()
      f.requestApproval()
      yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "Original permission missing before close",
      )
      const execution = yield* DelegationExecution.Service
      yield* awaitWithTimeout(
        execution.close({ delegationID: f.queueState.delegation.id, reason: "Stop the queued work" }),
        "Queue close retained the settlement lock",
        "5 seconds",
      )
      expect(f.state.turns).toBe(1)
      expect(f.state.closed).toBe(1)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["cancelled", "cancelled"])
      expect(f.decisions.some((decision) => decision.decision === "accept")).toBe(false)
    }),
)

effectTest.live("MC06-R2 keeps attended approval after the background ACK and delivers the full result once", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start one attended background external Task." })
    yield* awaitWithTimeout(f.llm.wait(2), "Parent did not consume its background ACK")
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Background ACK did not release the parent")
    const messages = yield* f.sessions.context(f.root.id)
    const call = messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .find((part) => part.type === "tool" && part.id === "mc06-first")
    expect(call).toMatchObject({ type: "tool", state: { status: "completed", metadata: { status: "running" } } })
    if (call?.type !== "tool" || call.state.status !== "completed")
      return yield* Effect.die(new Error("Background Task did not return its ACK"))
    expect(call.state.metadata?.externalReceipt).toBeUndefined()
    expect(f.state.turns).toBe(1)
    expect(f.state.closed).toBe(0)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["in_progress"])
    const database = yield* Database.Service
    const receipts = database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(yield* receipts).toEqual([])
    f.requestApproval()
    const asked = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "Background approval was lost after the ACK",
    )
    expect(asked).toMatchObject({
      sessionID: f.root.id,
      action: "shell",
      source: { type: "tool", id: "mc06-first" },
      metadata: { threadID: "external-thread", turnID: "external-turn-1", requestID: 7 },
    })
    yield* f.permission.reply({ requestID: asked.id, reply: "once" })
    yield* awaitWithTimeout(f.llm.wait(3), "Parent did not consume the background result")
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Background completion did not settle")
    const completed = yield* f.sessions.context(f.root.id)
    const notices = completed.filter((message) => message.type === "synthetic" && message.text.includes(f.outputs[0]))
    expect(notices).toHaveLength(1)
    const notice = notices[0]
    if (notice?.type !== "synthetic") return yield* Effect.die(new Error("Complete background notice missing"))
    const receipt = Schema.decodeUnknownSync(DelegationReceipt.External)(notice.metadata?.externalReceipt)
    const execution = yield* DelegationExecution.Service
    expect(yield* execution.wait(receipt)).toEqual({ status: "completed", text: f.outputs[0] })
    expect(JSON.stringify((yield* f.llm.requests())[2]?.messages)).toContain(f.outputs[0])
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed"])
    expect(yield* receipts).toHaveLength(1)
    const metas = yield* MetaAgentService.Service
    if (!f.root.controller) return yield* Effect.die(new Error("Meta controller missing"))
    expect(yield* metas.stats(f.root.controller.metaAgentID)).toMatchObject({
      totalSessions: 1,
      stepCount: 4,
      recordedOnly: true,
      physicalAttemptCoverage: "unknown",
    })
    expect(f.decisions).toEqual([{ id: 7, decision: "accept" }])
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect(f.state.closed).toBe(1)
    const calls = [...f.calls]
    yield* execution.recoverPending
    expect(f.calls).toEqual(calls)
    expect(yield* f.sessions.context(f.root.id)).toEqual(completed)
    expect(yield* receipts).toHaveLength(1)
    expect(yield* f.llm.requests()).toHaveLength(3)
    const saved = completed
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .find((part) => part.type === "tool" && part.id === "mc06-first")
    expect(saved).toEqual(call)
  }),
)

for (const linked of [false, true])
  effectTest.live(
    `MC06 R3a steers the original background Job with ${linked ? "a linked" : "a new"} parent Task${linked ? "" : " after its Location CLI configuration is removed"}`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalSetup(false, Agent.ID.make("meta"), true, linked ? { parentTask: "original" } : {})
        if (linked) f.outputs[0] = "MC06_LINKED_STEER_RESULT"
        yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start the original background external work" })
        yield* awaitWithTimeout(f.llm.wait(2), "Original background ACK was not consumed")
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original ACK did not release the parent")
        const tasks = yield* SessionTask.Service
        const originalTasks = yield* tasks.get(f.root.id)
        expect(originalTasks).toHaveLength(1)
        const originalTask = originalTasks[0]
        if (!originalTask) return yield* Effect.die(new Error("Original parent Task missing"))
        if (!linked) {
          const locations = yield* LocationServiceMap.Service
          const config = yield* Config.Service.pipe(Effect.provide(locations.get(f.root.location)))
          const files = yield* FSUtil.Service
          yield* files.writeFileString(`${f.root.location.directory}/aigcfroge.json`, "{}\n")
          yield* pollWithTimeout(
            config
              .entries()
              .pipe(
                Effect.map((entries) => (Config.latest(entries, "cli_agents")?.codex === undefined ? true : undefined)),
              ),
            "The original Job's CLI route was not removed from its Location",
          )
        }
        yield* f.sessions.prompt({ sessionID: f.root.id, text: "MC06_R3_STEER_REQUEST" })
        yield* pollWithTimeout(
          f.sessions.context(f.root.id).pipe(
            Effect.map((messages) => {
              const call = messages
                .flatMap((message) => (message.type === "assistant" ? message.content : []))
                .find((part) => part.type === "tool" && part.id === "mc06-steer")
              return f.state.steers.length || (call?.type === "tool" && call.state.status === "error")
                ? true
                : undefined
            }),
          ),
          "Steer neither reached the original connection nor returned a failure",
        )
        const steered = yield* mc07Result(f, "mc06-steer")
        if (steered.tool.state.status === "error")
          return yield* Effect.die(new Error(`MC06 R3a steer failed: ${JSON.stringify(steered.tool.state)}`))
        expect(f.state.steers).toEqual([
          {
            threadId: "external-thread",
            expectedTurnId: "external-turn-1",
            input: [{ type: "text", text: "Include the new instruction in the original active turn" }],
          },
        ])
        expect(f.calls.filter((call) => call.method === "turn/start")).toHaveLength(1)
        expect(f.state.turns).toBe(1)
        expect(f.state.closed).toBe(0)
        const admitted = yield* tasks.get(f.root.id)
        expect(admitted).toHaveLength(linked ? 1 : 2)
        expect(admitted.find((task) => task.id === originalTask.id)).toEqual(
          linked ? expect.objectContaining({ id: originalTask.id, revision: originalTask.revision + 1 }) : originalTask,
        )
        f.requestApproval()
        const asked = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "Original Job permission was lost during steer",
        )
        expect(asked.source).toMatchObject({ type: "tool", id: "mc06-first" })
        yield* f.permission.reply({ requestID: asked.id, reply: "once" })
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Steered foreground Task did not settle")
        if (!linked)
          yield* pollWithTimeout(
            f.sessions
              .context(f.root.id)
              .pipe(
                Effect.map((messages) =>
                  messages.some((message) => message.type === "synthetic" && message.text.includes(f.outputs[0]))
                    ? true
                    : undefined,
                ),
              ),
            "Original background completion was not delivered",
          )
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Final background notice did not settle")
        const completed = yield* f.sessions.context(f.root.id)
        const call = completed
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.id === "mc06-steer")
        expect(call).toMatchObject({ state: { status: "completed", metadata: { status: "completed" } } })
        if (call?.type !== "tool" || call.state.status !== "completed")
          return yield* Effect.die(new Error("Steered Task did not complete"))
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.External)(call.state.metadata?.externalReceipt)
        const execution = yield* DelegationExecution.Service
        expect(yield* execution.wait(receipt)).toEqual({ status: "completed", text: f.outputs[0] })
        const finalTasks = yield* tasks.get(f.root.id)
        expect(finalTasks.map((task) => task.status)).toEqual(linked ? ["completed"] : ["completed", "completed"])
        if (linked) {
          expect(finalTasks[0]?.revision).toBe(originalTask.revision + 2)
          expect(completed.filter((message) => message.type === "synthetic")).toEqual([])
        }
        const database = yield* Database.Service
        const receipts = yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
        expect(receipts).toHaveLength(linked ? 1 : 2)
        expect(new Set(receipts.map((item) => item.tool_call_id))).toEqual(
          new Set(linked ? ["mc06-steer"] : ["mc06-first", "mc06-steer"]),
        )
        expect(JSON.stringify((yield* f.llm.requests()).at(-1)?.messages)).toContain(f.outputs[0])
        expect(f.state.turns).toBe(1)
        expect(f.state.closed).toBe(1)
        expect(f.decisions).toEqual([{ id: 7, decision: "accept" }])
      }),
  )

for (const response of ["reject", "mismatch"] as const)
  effectTest.live(`MC06 R3a ${response} affects only the new input while the original Job completes`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), true, { response })
      f.outputs[0] = "MC06_ORIGINAL_AFTER_STEER_ERROR"
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start original background work" })
      yield* awaitWithTimeout(f.llm.wait(2), "Original ACK was not consumed")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original ACK did not release parent")
      const tasks = yield* SessionTask.Service
      const delegations = yield* DelegationService.Service
      const originalTask = (yield* tasks.get(f.root.id))[0]
      const original = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
      const delivery = original && [...original.deliveries.values()][0]
      if (!originalTask || !original || !delivery) return yield* Effect.die(new Error("Original work missing"))
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "MC06_R3_STEER_REQUEST" })
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Failed steer did not release the parent")
      expect(f.state.steers).toHaveLength(1)
      expect(f.state.closed).toBe(0)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === originalTask.id)).toEqual(originalTask)
      const current = yield* delegations.foldState(original.delegation.id)
      if (!current) return yield* Effect.die(new Error("Delegation disappeared"))
      expect([...current.deliveries.values()].find((item) => item.turnID === delivery.turnID)).toEqual(delivery)
      expect([...current.participants.values()].map((item) => item.phase)).toEqual(
        [...original.participants.values()].map((item) => item.phase),
      )
      expect([...current.deliveries.values()].find((item) => item.turnID !== delivery.turnID)?.status).toBe(
        response === "reject" ? "cancelled" : "recovery_required",
      )
      f.requestApproval()
      const asked = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "Original permission was cancelled by the new input error",
      )
      yield* f.permission.reply({ requestID: asked.id, reply: "once" })
      yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.some((message) => message.type === "synthetic" && message.text.includes(f.outputs[0]))
                ? true
                : undefined,
            ),
          ),
        "Original successful result was lost after steer error",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original completion did not settle")
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === originalTask.id)?.status).toBe("completed")
      const database = yield* Database.Service
      const receipts = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      expect(receipts.map((item) => item.tool_call_id)).toEqual(["mc06-first"])
      const before = [...f.calls]
      const execution = yield* DelegationExecution.Service
      yield* execution.recoverPending
      expect(f.calls).toEqual(before)
      expect(f.state.turns).toBe(1)
      expect(f.state.closed).toBe(1)
    }),
  )

effectTest.live("MC06 R3a closes a shared Job and withdraws its permission without a lock deadlock", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(false, Agent.ID.make("meta"), true, {})
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start original background work" })
    yield* awaitWithTimeout(f.llm.wait(2), "Original ACK was not consumed")
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original ACK did not release parent")
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "MC06_R3_STEER_REQUEST" })
    yield* pollWithTimeout(
      Effect.sync(() => (f.state.steers.length === 1 ? true : undefined)),
      "Steer was not dispatched",
    )
    f.requestApproval()
    yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "Original approval did not become pending",
    )
    const delegations = yield* DelegationService.Service
    const state = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
    if (!state) return yield* Effect.die(new Error("Shared delegation missing"))
    const execution = yield* DelegationExecution.Service
    yield* awaitWithTimeout(
      execution.close({ delegationID: state.delegation.id, reason: "Stop the shared native turn" }),
      "Shared Job cancellation retained the settlement lock",
      "5 seconds",
    )
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Cancelled steer did not release parent")
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect(f.state.turns).toBe(1)
    expect(f.state.closed).toBe(1)
    expect(f.decisions.some((item) => item.decision === "accept")).toBe(false)
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).every((task) => task.status !== "in_progress")).toBe(true)
  }),
)

effectTest.live("MC06-R2 keeps external Task foreground when the background flag is disabled", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
    process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "0"
    f.outputs[0] = "MC06_FOREGROUND_FLAG_DISABLED"
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Request background with the feature disabled." })
    yield* pollWithTimeout(
      Effect.sync(() => (f.state.turns === 1 ? true : undefined)),
      "Foreground external turn did not start",
    )
    const before = yield* f.sessions.context(f.root.id)
    expect(
      before
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc06-first"),
    ).toMatchObject({ state: { status: "running" } })
    f.requestApproval()
    const asked = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "Foreground permission was not presented",
    )
    yield* f.permission.reply({ requestID: asked.id, reply: "once" })
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Foreground external Task did not settle")
    const messages = yield* f.sessions.context(f.root.id)
    const call = messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .find((part) => part.type === "tool" && part.id === "mc06-first")
    expect(call).toMatchObject({ state: { status: "completed", metadata: { status: "completed" } } })
    expect(messages.filter((message) => message.type === "synthetic")).toEqual([])
    expect(yield* f.llm.requests()).toHaveLength(2)
  }),
)

effectTest.live("MC06-R2 retains a result completed before the background ACK is published", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
    const locations = yield* LocationServiceMap.Service
    const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(f.root.location)))
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const afterCalls: string[] = []
    yield* hooks.register("tool", "execute.after", (event) => {
      if (event.tool !== "task" || event.status !== "completed") return Effect.void
      afterCalls.push(event.id)
      return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Complete the background result while its ACK is held." })
    yield* awaitWithTimeout(Deferred.await(entered), "Background ACK did not reach its after hook")
    f.requestApproval()
    const asked = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "Held ACK lost its background permission",
    )
    yield* f.permission.reply({ requestID: asked.id, reply: "once" })
    yield* pollWithTimeout(
      Effect.sync(() => (f.state.closed === 1 ? true : undefined)),
      "External result did not complete before the ACK release",
    )
    const before = yield* f.sessions.context(f.root.id)
    expect(
      before
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc06-first"),
    ).toMatchObject({ state: { status: "running" } })
    yield* Deferred.succeed(release, undefined)
    yield* pollWithTimeout(
      f.llm
        .requests()
        .pipe(
          Effect.map((requests) => requests.find((request) => JSON.stringify(request.messages).includes(f.outputs[0]))),
        ),
      "Parent did not consume the early background result",
    )
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Early result parent did not settle")
    const requests = yield* f.llm.requests()
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain(f.outputs[0])
    const messages = yield* f.sessions.context(f.root.id)
    expect(
      messages.filter((message) => message.type === "synthetic" && message.text.includes(f.outputs[0])),
    ).toHaveLength(1)
    const database = yield* Database.Service
    const receipts = yield* database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(receipts).toHaveLength(1)
    expect(afterCalls).toEqual(["mc06-first"])
    expect(f.state.turns).toBe(1)
  }),
)

for (const stop of ["participant", "delegation", "delete-parent"] as const)
  effectTest.live(`MC06-R2 ${stop} cancels the background approval after its ACK`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start an attended background Task, then cancel it." })
      yield* awaitWithTimeout(f.llm.wait(2), "Parent did not consume its background ACK")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Background ACK did not settle")
      const messages = yield* f.sessions.context(f.root.id)
      const call = messages
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc06-first")
      expect(call).toMatchObject({ state: { status: "completed", metadata: { status: "running" } } })
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.resolveActive(f.root.id, Agent.ID.make("meta"))
      if (!state) return yield* Effect.die(new Error("Background delegation missing"))
      const participant = [...state.participants.values()][0]
      if (!participant) return yield* Effect.die(new Error("Background participant missing"))
      f.requestApproval()
      const asked = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "Background permission was not presented",
      )
      // An idle parent interruption does not cancel work already handed to Job.
      yield* f.runs.interrupt(f.root.id)
      expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
      expect(f.state.closed).toBe(0)
      const execution = yield* DelegationExecution.Service
      if (stop === "participant")
        yield* execution.interrupt({ delegationID: state.delegation.id, participantID: participant.id })
      if (stop === "delegation") yield* execution.close({ delegationID: state.delegation.id })
      if (stop === "delete-parent") yield* f.sessions.remove(f.root.id)
      yield* pollWithTimeout(
        Effect.sync(() => (f.state.closed === 1 ? true : undefined)),
        "Background connection was not closed",
      )
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect(yield* f.permission.reply({ requestID: asked.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Permission.NotFoundError",
      })
      expect(f.decisions.some((decision) => decision.decision === "accept")).toBe(false)
      expect(f.state.turns).toBe(1)
      if (stop === "delete-parent") {
        expect(yield* f.sessions.get(f.root.id).pipe(Effect.flip)).toMatchObject({ _tag: "Session.NotFoundError" })
        return
      }
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Cancelled background notification did not settle")
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["cancelled"])
      const completed = yield* f.sessions.context(f.root.id)
      expect(
        completed
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.id === "mc06-first"),
      ).toEqual(call)
      expect(completed.some((message) => message.type === "synthetic" && message.text.includes(f.outputs[0]))).toBe(
        false,
      )
    }),
  )

effectTest.live(
  "MC06 native cancelled predecessor starts an independent same-SID foreground Task before its original cancellation notice is saved",
  () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
      const delegations = yield* DelegationService.Service
      const jobs = yield* Job.Service
      const tasks = yield* SessionTask.Service
      const kv = yield* KV.Service
      const database = yield* Database.Service
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start the original attended background Task." })
      yield* awaitWithTimeout(f.llm.wait(2), "The original native ACK was not consumed")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original native ACK did not release its parent")
      const original = yield* mc07Consumed(f, "mc06-first")
      expect(original.tool.state).toMatchObject({ status: "completed", metadata: { status: "running" } })
      const state = yield* delegations.resolveActive(f.root.id, Agent.ID.make("meta"))
      if (!state) return yield* Effect.die(new Error("The original native delegation is missing"))
      const binding = (yield* kv.scan({ prefix: `delegation:external:${state.delegation.id}:` })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find(
          (entry) =>
            entry.parentSessionID === f.root.id &&
            entry.source.messageID === original.assistant.id &&
            entry.source.id === original.tool.id,
        )
      if (!binding) return yield* Effect.die(new Error("The original native source has no Binding"))
      const delivery = state.deliveries.get(
        DelegationFold.deliveryKey(
          binding.turnID,
          binding.participantID,
          binding.deliveryOrigin,
          binding.senderParticipantID,
        ),
      )
      if (!delivery) return yield* Effect.die(new Error("The original native delivery is missing"))
      const key = DelegationReceipt.key(binding)
      const receipt = DelegationReceipt.fromBinding(binding)
      if (!(receipt instanceof DelegationReceipt.External))
        return yield* Effect.die(new Error("The original native ACK has no native receipt"))
      const noticeID = DelegationReceipt.notificationID(
        DelegationFold.inputID(state.delegation.id, delivery),
        binding.parentTaskID,
      )
      const observerWaiting = yield* Deferred.make<void>()
      const observerGate = yield* Deferred.make<void>()
      const wait = jobs.wait
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(jobs, "wait").mockImplementation((input) =>
            wait(input).pipe(
              Effect.tap((result) =>
                Effect.gen(function* () {
                  if (input.id !== key || result.info?.status !== "cancelled") return
                  if (!(yield* Deferred.succeed(observerWaiting, undefined))) return
                  yield* Deferred.await(observerGate)
                }),
              ),
            ),
          ),
        ),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      yield* Effect.addFinalizer(() => Deferred.succeed(observerGate, undefined).pipe(Effect.asVoid))
      expect((yield* jobs.get(key))?.status).toBe("running")
      f.requestApproval()
      const asked = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "The original native command approval was not presented",
      )
      expect(asked.source).toEqual(binding.source)
      expect(
        yield* awaitWithTimeout(jobs.cancel(key), "The original native Job did not finish cancellation", "5 seconds"),
      ).toMatchObject({ status: "cancelled" })
      yield* awaitWithTimeout(
        Deferred.await(observerWaiting),
        "The original observer did not read its cancelled Job outside the lock",
      )
      expect(yield* Deferred.isDone(observerGate)).toBe(false)
      expect(yield* SessionInbox.find(database.db, noticeID)).toBeUndefined()
      expect((yield* f.sessions.context(f.root.id)).some((message) => message.id === noticeID)).toBe(false)
      const cancelledTask = (yield* tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)
      expect(cancelledTask?.status).toBe("cancelled")
      const cancelledBinding = yield* kv.get(key)
      expect(f.state.closed).toBe(1)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])

      const id = "mc06-native-after-cancel"
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Continue the retained native session with a new Task",
          prompt: "Return the independent successor result.",
          subagent_type: "codex",
          cli_target: "codex",
          execution_type: "external-cli",
          command: "append",
          attended: true,
          background: false,
          delegation_id: receipt.delegationID,
          participant_id: receipt.participantID,
        }),
        TestLLM.text("Consumed the independent native successor.", `${id}-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Continue after the original native Job was cancelled." })
      yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              f.state.turns === 2 ||
              messages.some(
                (message) =>
                  message.type === "assistant" &&
                  message.content.some(
                    (part) => part.type === "tool" && part.id === id && part.state.status === "error",
                  ),
              )
                ? true
                : undefined,
            ),
          ),
        "The independent native successor neither started nor returned its error",
      )
      expect(f.state.turns).toBe(2)
      expect(f.state.closed).toBe(1)
      expect(yield* Deferred.isDone(observerGate)).toBe(false)
      expect(yield* SessionInbox.find(database.db, noticeID)).toBeUndefined()
      f.requestApproval()
      const nextAsk = yield* pollWithTimeout(
        f.permission
          .forSession(f.root.id)
          .pipe(
            Effect.map((pending) =>
              pending.find((request) => request.source?.type === "tool" && request.source.id === id),
            ),
          ),
        "The independent native successor approval was not presented",
      )
      const nextSource = Schema.decodeUnknownSync(Permission.ToolSource)(nextAsk.source)
      expect(nextAsk).toMatchObject({
        source: { type: "tool", id },
        metadata: { threadID: receipt.externalThreadID, turnID: "external-turn-2", requestID: 7 },
      })
      expect(nextAsk.id).not.toBe(asked.id)
      expect(nextSource.messageID).not.toBe(binding.source.messageID)
      expect(yield* f.permission.reply({ requestID: asked.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Permission.NotFoundError",
      })
      const admitted = yield* delegations.foldState(receipt.delegationID)
      const nextBinding = (yield* kv.scan({ prefix: `delegation:external:${receipt.delegationID}:` })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find(
          (entry) =>
            entry.parentSessionID === f.root.id &&
            entry.source.id === id &&
            entry.source.messageID === nextSource.messageID,
        )
      const nextDelivery =
        nextBinding &&
        admitted?.deliveries.get(
          DelegationFold.deliveryKey(
            nextBinding.turnID,
            nextBinding.participantID,
            nextBinding.deliveryOrigin,
            nextBinding.senderParticipantID,
          ),
        )
      if (!nextBinding || !nextDelivery)
        return yield* Effect.die(new Error("The independent native successor delivery is missing"))
      const nextKey = DelegationReceipt.key(nextBinding)
      expect(nextKey).not.toBe(key)
      expect((yield* jobs.get(nextKey))?.status).toBe("running")
      yield* f.permission.reply({ requestID: nextAsk.id, reply: "once" })
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The independent native successor did not settle")
      const completed = yield* mc07Consumed(f, id)
      if (completed.tool.state.status !== "completed")
        return yield* Effect.die(new Error("The independent native successor did not complete"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(completed.text)
      const nextReceipt = Schema.decodeUnknownSync(DelegationReceipt.External)(
        completed.tool.state.metadata?.externalReceipt,
      )
      expect(output).toMatchObject({
        status: "completed",
        output: f.outputs[1],
        externalThreadID: receipt.externalThreadID,
        externalTurnID: "external-turn-2",
      })
      expect(nextReceipt).toMatchObject({
        delegationID: receipt.delegationID,
        participantID: receipt.participantID,
        source: { id, messageID: completed.assistant.id },
      })
      expect(output.parentTaskID).not.toBe(binding.parentTaskID)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toEqual(cancelledTask)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === output.parentTaskID)?.status).toBe("completed")
      expect(yield* kv.get(key)).toEqual(cancelledBinding)
      expect((yield* mc07Result(f, original.tool.id)).tool).toEqual(original.tool)
      const nextMeta = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
            eq(MetaAgentStepTable.type, "receipt"),
            eq(MetaAgentStepTable.tool_call_id, id),
          ),
        )
      expect(nextMeta).toHaveLength(1)
      const requests = (yield* f.llm.requests()).length
      yield* Deferred.succeed(observerGate, undefined)
      const notice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === noticeID),
            ),
          ),
        "The original observer did not deliver its cancellation after the successor completed",
      )
      if (notice.type !== "synthetic") return yield* Effect.die(new Error("The native cancellation notice is missing"))
      const cancelledOutput = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.NativeOutput))(
        notice.text,
      )
      expect(cancelledOutput.status).toBe("cancelled")
      expect(DelegationReceipt.matchesOutput(binding, cancelledOutput)).toBe(true)
      yield* awaitWithTimeout(f.llm.wait(requests + 1), "The parent did not consume its delayed native cancellation")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The delayed native cancellation consumer did not settle")
      expect(
        (yield* f.llm.requests())
          .at(-1)
          ?.messages.flatMap((message) => (message.role === "user" ? message.content : []))
          .flatMap((part) => (part.type === "text" ? [part.text] : [])),
      ).toContain(notice.text)
      expect(yield* kv.get(key)).toEqual(cancelledBinding)
      expect(
        DelegationReceipt.fromBinding(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))),
      ).toEqual(receipt)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toEqual(cancelledTask)
      expect((yield* mc07Result(f, original.tool.id)).tool).toEqual(original.tool)
      expect((yield* f.sessions.context(f.root.id)).find((message) => message.id === noticeID)).toEqual(notice)
      const finalMeta = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      expect(finalMeta.filter((row) => row.tool_call_id === original.tool.id)).toHaveLength(1)
      expect(finalMeta.filter((row) => row.tool_call_id === id)).toEqual(nextMeta)
      expect(f.calls.filter((call) => call.method === "thread/resume")).toEqual([
        { method: "thread/resume", thread: receipt.externalThreadID },
      ])
      expect(f.state.closed).toBe(2)
      expect(f.decisions).toEqual([
        { id: 7, decision: "cancel" },
        { id: 7, decision: "accept" },
      ])
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    }),
)

for (const changed of ["cancelled", "revision"] as const)
  effectTest.live(`MC06-R2 a ${changed} Task cannot receive success from its old background attempt`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup(false, Agent.ID.make("meta"), true)
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start a background Task whose owner will change." })
      yield* awaitWithTimeout(f.llm.wait(2), "Parent did not consume its background ACK")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Background ACK did not settle")
      const tasks = yield* SessionTask.Service
      const original = (yield* tasks.get(f.root.id))[0]
      if (!original) return yield* Effect.die(new Error("Original background Task missing"))
      const updated = yield* tasks.updateTask({
        sessionID: f.root.id,
        id: original.id,
        expectedRevision: original.revision,
        status: changed === "cancelled" ? "cancelled" : "in_progress",
        content: "New owner decision",
      })
      expect(updated).toBeDefined()
      if (!updated) return yield* Effect.die(new Error("New Task decision was not committed"))
      f.requestApproval()
      const asked = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "Background permission was not presented",
      )
      yield* f.permission.reply({ requestID: asked.id, reply: "once" })
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.resolveActive(f.root.id, Agent.ID.make("meta"))
      const delivery = state && [...state.deliveries.values()][0]
      if (!state || !delivery) return yield* Effect.die(new Error("Background delivery missing"))
      const jobs = yield* Job.Service
      const key = DelegationReceipt.key({ ...delivery, delegationID: state.delegation.id })
      yield* pollWithTimeout(
        jobs.get(key).pipe(Effect.map((job) => (job === undefined ? true : undefined))),
        "Superseded background observer did not release its terminal Job",
      )
      expect((yield* tasks.get(f.root.id))[0]).toEqual(updated)
      const messages = yield* f.sessions.context(f.root.id)
      expect(messages.some((message) => message.type === "synthetic" && message.text.includes(f.outputs[0]))).toBe(
        false,
      )
      const database = yield* Database.Service
      expect(
        yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt"))),
      ).toHaveLength(0)
      expect(yield* f.llm.requests()).toHaveLength(2)
      expect(f.state.closed).toBe(1)
    }),
  )

for (const actor of ["meta", "build"] as const)
  effectTest.live(
    `MC06 ${actor} consumes two external Task results through one thread and the real parent Permission waiter`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalSetup(false, Agent.ID.make(actor))
        yield* f.sessions.prompt({ sessionID: f.root.id, text: "Delegate twice to the same external participant." })
        const firstAsk = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "MC06 first permission was not presented",
        )
        expect(firstAsk).toMatchObject({
          sessionID: f.root.id,
          action: "shell",
          source: { type: "tool", id: "mc06-first" },
          metadata: { threadID: "external-thread", turnID: "external-turn-1", requestID: 7 },
        })
        expect(f.decisions).toEqual([])
        yield* f.permission.reply({ requestID: firstAsk.id, reply: "once" })
        const secondAsk = yield* pollWithTimeout(
          f.permission
            .forSession(f.root.id)
            .pipe(Effect.map((pending) => pending.find((request) => request.id !== firstAsk.id))),
          "MC06 second permission was not presented",
        )
        expect(secondAsk).toMatchObject({
          source: { id: "mc06-second" },
          metadata: { threadID: "external-thread", turnID: "external-turn-2", requestID: 7 },
        })
        expect(yield* f.permission.reply({ requestID: firstAsk.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Permission.NotFoundError",
        })
        expect(f.decisions).toEqual([{ id: 7, decision: "accept" }])
        yield* f.permission.reply({ requestID: secondAsk.id, reply: "once" })
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "MC06 root did not settle", "10 seconds")
        const requests = yield* f.llm.requests()
        expect(requests).toHaveLength(3)
        const messages = yield* f.sessions.context(f.root.id)
        const tools = messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .filter((part) => part.type === "tool" && part.name === "task")
        expect(tools).toHaveLength(2)
        const receipts = tools.map((tool) => {
          if (tool.type !== "tool" || tool.state.status !== "completed")
            throw new Error("External Task did not return a result")
          expect(tool.state.metadata?.receipt).toBeUndefined()
          expect(tool.state.metadata?.sessionID).toBeUndefined()
          return Schema.decodeUnknownSync(DelegationReceipt.External)(tool.state.metadata?.externalReceipt)
        })
        expect(receipts[0]?.participantID).toBe(receipts[1]?.participantID)
        expect(receipts.map((value) => value.externalThreadID)).toEqual(["external-thread", "external-thread"])
        expect(receipts.map((value) => value.externalTurnID)).toEqual(["external-turn-1", "external-turn-2"])
        const execution = yield* DelegationExecution.Service
        for (const [index, receipt] of receipts.entries()) {
          expect(yield* execution.wait(receipt)).toEqual({ status: "completed", text: f.outputs[index] })
          expect(JSON.stringify(requests[2]?.messages)).toContain(f.outputs[index])
        }
        const receipt = receipts[0]
        if (!receipt) throw new Error("First external receipt missing")
        const other = yield* f.sessions.create({
          location: f.root.location,
          agent: Agent.ID.make("build"),
          model: f.metaModel,
        })
        expect(
          yield* execution
            .wait(new DelegationReceipt.External({ ...receipt, parentSessionID: other.id }))
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError" })
        expect(
          yield* execution
            .wait(new DelegationReceipt.External({ ...receipt, externalTurnID: "late-foreign-turn" }))
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError" })
        expect(f.state.turns).toBe(2)
        expect(f.state.closed).toBe(2)
        expect(f.calls.filter((call) => call.method === "thread/resume")).toEqual([
          { method: "thread/resume", thread: "external-thread" },
        ])
        expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
        const tasks = yield* SessionTask.Service
        expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "completed"])
        const database = yield* Database.Service
        const rows = yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id))
        expect(rows.filter((row) => row.type === "receipt")).toHaveLength(actor === "meta" ? 2 : 0)
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      }),
  )

for (const stop of ["reject", "interrupt", "close"] as const)
  effectTest.live(`MC06 ${stop} preserves the parent failure and withdraws the external approval`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup()
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start an external task." })
      const request = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "MC06 permission did not become pending",
      )
      if (stop === "reject") yield* f.permission.reply({ requestID: request.id, reply: "reject" })
      if (stop === "interrupt") yield* f.runs.interrupt(f.root.id)
      if (stop === "close") {
        const delegations = yield* DelegationService.Service
        const state = yield* delegations.resolveActive(f.root.id, Agent.ID.make("meta"))
        if (!state) throw new Error("External delegation missing")
        const execution = yield* DelegationExecution.Service
        yield* execution.close({ delegationID: state.delegation.id })
      }
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "MC06 cancelled root did not settle", "10 seconds")
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect(yield* f.permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Permission.NotFoundError",
      })
      expect(f.decisions.some((decision) => decision.decision === "accept")).toBe(false)
      expect(f.state.closed).toBe(1)
      expect(yield* f.llm.requests()).toHaveLength(1)
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual([
        stop === "reject" ? "failed" : "cancelled",
      ])
      const messages = yield* f.sessions.context(f.root.id)
      expect(
        messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .filter((part) => part.type === "tool" && part.state.status === "completed"),
      ).toEqual([])
    }),
  )

effectTest.live("MC06 rejected continuation settles admitted work without another external turn", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup(true)
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Continue only the bound command." })
    const request = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "MC06 first permission missing",
    )
    yield* f.permission.reply({ requestID: request.id, reply: "once" })
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "MC06 rejected continuation did not settle", "10 seconds")
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "failed"])
    const delegations = yield* DelegationService.Service
    const state = yield* delegations.foldState(
      Schema.decodeUnknownSync(DelegationID.ID)(request.metadata?.delegationID),
    )
    expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["completed", "failed"])
    expect(f.state.turns).toBe(1)
    expect(f.state.closed).toBe(1)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
  }),
)

for (const terminal of ["completed", "interrupted", "error"] as const)
  effectTest.live(`MC06 R1 ${terminal} revokes pending permission before any late once`, () =>
    Effect.gen(function* () {
      const f = yield* externalSetup()
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start one external task." })
      const request = yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
        "R1 permission did not become pending",
      )
      f.terminate(terminal)
      yield* pollWithTimeout(
        f.permission.forSession(f.root.id).pipe(Effect.map((pending) => (pending.length === 0 ? true : undefined))),
        "R1 terminal notification left Permission pending",
      )
      expect(yield* f.permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Permission.NotFoundError",
      })
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "R1 parent did not settle", "10 seconds")
      expect(f.decisions.some((reply) => reply.decision === "accept")).toBe(false)
      expect(f.state.closed).toBe(1)
      const tasks = yield* SessionTask.Service
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["failed"])
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(
        Schema.decodeUnknownSync(DelegationID.ID)(request.metadata?.delegationID),
      )
      expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["recovery_required"])
      const messages = yield* f.sessions.context(f.root.id)
      expect(
        messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .filter((part) => part.type === "tool" && part.state.status === "completed"),
      ).toEqual([])
    }),
  )

effectTest.live("MC06 R2 cancellation at committed Started settles the owning Job and Task", () =>
  Effect.gen(function* () {
    const f = yield* externalSetup()
    const bus = yield* Bus.Service
    const started = yield* Deferred.make<typeof DelegationEvent.DeliveryStartedData.Type>()
    const release = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type !== DelegationEvent.DeliveryStarted.type) return Effect.void
      return Deferred.succeed(started, Schema.decodeUnknownSync(DelegationEvent.DeliveryStartedData)(event.data)).pipe(
        Effect.andThen(Deferred.await(release)),
      )
    })
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe)))
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Cancel exactly at external Job handoff." })
    const event = yield* awaitWithTimeout(Deferred.await(started), "R2 Started was not committed")
    const jobs = yield* Job.Service
    const jobBefore = yield* jobs.get(DelegationReceipt.key(event))
    yield* f.runs.interrupt(f.root.id)
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "R2 cancelled parent did not settle", "10 seconds")
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["cancelled"])
    const delegations = yield* DelegationService.Service
    const state = yield* delegations.foldState(event.delegationID)
    expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
    expect(jobBefore?.status).toBe("running")
    expect((yield* jobs.get(DelegationReceipt.key(event)))?.status).not.toBe("running")
    expect(f.calls).toEqual([])
    expect(f.state.turns).toBe(0)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
  }),
)

const sdkTaskSetup = (
  toolName: "Read" | "Grep" | "Glob" = "Read",
  validIdentity = true,
  continuedResult?: { sessionID?: string; messageID?: string },
  background = false,
  artifactPath?: string,
  controlledQueue = false,
) =>
  Effect.gen(function* () {
    if (background)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "1"
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
              return
            }
            process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
          }),
      )
    const nativeStarted = yield* Deferred.make<void>()
    const afterRead = yield* Deferred.make<void>()
    const resultGate = yield* Deferred.make<void>()
    const nativeFinished = yield* Deferred.make<void>()
    const controls = yield* Effect.forEach(controlledQueue ? [0, 1, 2] : [], () =>
      Effect.all({
        afterRead: Deferred.make<void>(),
        resultGate: Deferred.make<void>(),
        afterResult: Deferred.make<void>(),
        tailGate: Deferred.make<void>(),
      }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        controls,
        (control) =>
          Deferred.succeed(control.resultGate, undefined).pipe(
            Effect.andThen(Deferred.succeed(control.tailGate, undefined)),
          ),
        { discard: true },
      ),
    )
    const run = Effect.runPromiseWith(yield* Effect.context())
    const queries: Parameters<ClaudeCodeSdkAdapter.ClaudeSdk["query"]>[0][] = []
    const closedBeforeQuery: number[] = []
    const terminalErrors: boolean[] = []
    const state = { reads: 0, closed: 0, hookCalls: 0 }
    const previous = CliAdapter.getCliAdapter("claude-code")
    const fixture = yield* metaSetup(
      Agent.ID.make("keeper-worker"),
      true,
      Agent.ID.make("meta"),
      "sdk",
      artifactPath,
      "",
      "work",
      undefined,
      "claude-code",
    )
    const locations = yield* LocationServiceMap.Service
    const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(fixture.root.location)))
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ location: fixture.root.location, custom: false })
    const readPath = `${fixture.root.location.directory}/${artifactPath ?? "sdk-read.txt"}`
    if (!artifactPath) yield* Effect.promise(() => Bun.write(readPath, "native SDK input\n"))
    const text = " \nMC06_SDK_" + "汉字🙂\n".repeat(15_000) + "_TAIL\n  "
    const continuedText = text.replace("MC06_SDK_", "MC06_SDK_FOLLOWUP_").replace("_TAIL\n  ", "_FOLLOWUP_TAIL\n  ")
    const outputs: string[] = []
    const adapter = ClaudeCodeSdkAdapter.makeClaudeCodeSdkAdapter({
      query: (input) => {
        closedBeforeQuery.push(state.closed)
        queries.push(input)
        const index = queries.length
        const control = controls[index - 1]
        const sessionID = input.options?.resume ?? `sdk-session-${index}`
        return Object.assign(
          (async function* () {
            try {
              const options = input.options
              const hook = options?.hooks?.PreToolUse?.[0]?.hooks[0]
              if (!options?.abortController || !hook) throw new Error("SDK query lost its owning readonly hook/scope")
              await run(Deferred.succeed(nativeStarted, undefined))
              yield { type: "system", session_id: sessionID, uuid: `sdk-init-${index}` }
              yield { type: "assistant", session_id: sessionID, uuid: `sdk-assistant-${index}` }
              state.hookCalls += 1
              const answer = await hook(
                {
                  hook_event_name: "PreToolUse",
                  session_id: sessionID,
                  cwd: fixture.root.location.directory,
                  transcript_path: "fixture-transcript",
                  tool_name: toolName,
                  tool_use_id: `sdk-tool-${index}`,
                  tool_input:
                    toolName === "Read"
                      ? { file_path: readPath }
                      : {
                          pattern: toolName === "Grep" ? "native SDK" : "*.txt",
                          path: fixture.root.location.directory,
                        },
                },
                `sdk-tool-${index}`,
                { signal: options.abortController.signal },
              )
              const decision =
                "hookSpecificOutput" in answer && answer.hookSpecificOutput?.hookEventName === "PreToolUse"
                  ? answer.hookSpecificOutput.permissionDecision
                  : undefined
              if (decision === "allow") {
                await Bun.file(readPath).text()
                state.reads += 1
              }
              await run(Deferred.succeed(afterRead, undefined))
              if (control) await run(Deferred.succeed(control.afterRead, undefined))
              // A terminal frame already in flight may arrive after cancellation; the owning Effect must discard it.
              await run(Deferred.await(control?.resultGate ?? resultGate))
              yield {
                type: "result",
                is_error: terminalErrors[index - 1] === true,
                session_id: input.options?.resume ? (continuedResult?.sessionID ?? sessionID) : sessionID,
                uuid: validIdentity
                  ? input.options?.resume
                    ? (continuedResult?.messageID ?? `sdk-result-${index}`)
                    : `sdk-result-${index}`
                  : undefined,
                result:
                  decision === "allow"
                    ? (outputs[index - 1] ?? (input.options?.resume ? continuedText : text))
                    : "SDK_READ_DENIED",
              }
              if (control) {
                await run(Deferred.succeed(control.afterResult, undefined))
                await run(Deferred.await(control.tailGate))
              }
            } finally {
              await run(Deferred.succeed(nativeFinished, undefined))
            }
          })(),
          {
            close: () => {
              state.closed += 1
              void run(
                Deferred.succeed(control?.resultGate ?? resultGate, undefined).pipe(
                  Effect.andThen(control ? Deferred.succeed(control.tailGate, undefined) : Effect.void),
                ),
              )
            },
          },
        )
      },
    })
    CliAdapter.registerCliAdapter("claude-code", adapter)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => CliAdapter.registerCliAdapter("claude-code", previous ?? ClaudeCodeSdkAdapter.adapter)),
    )
    yield* fixture.sessions.setPermissions({
      sessionID: fixture.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    return {
      ...fixture,
      permission,
      state,
      queries,
      text,
      continuedText,
      outputs,
      controls,
      closedBeforeQuery,
      terminalErrors,
      adapter,
      nativeStarted,
      afterRead,
      resultGate,
      nativeFinished,
      toolName,
    }
  })

const sdkSteerUser = Schema.Struct({
  type: Schema.Literal("user"),
  uuid: Schema.TemplateLiteral([
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
  ]),
  session_id: Schema.optionalKey(Schema.String),
  message: Schema.Struct({ role: Schema.Literal("user"), content: Schema.String }),
  parent_tool_use_id: Schema.Null,
  priority: Schema.optionalKey(Schema.Literals(["now", "next", "later"])),
})

// This peer runs the installed SDK's stdio, hooks, input stream and iterator; it never spawns a native process.
const sdkSteerSetup = Effect.fnUntraced(function* (timeoutMs = 30_000, cancelA = true) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "1"
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          return
        }
        process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
      }),
  )
  const f = yield* metaSetup(
    Agent.ID.make("keeper-worker"),
    true,
    Agent.ID.make("meta"),
    "sdk",
    undefined,
    "",
    "work",
    undefined,
    "claude-code",
    timeoutMs,
  )
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.root.location)
  const permission = yield* Permission.Service.pipe(Effect.provide(local))
  const presence = yield* ApprovalPresence.Service
  yield* presence.bindResponder({ location: f.root.location, custom: false })
  yield* f.sessions.setPermissions({
    sessionID: f.root.id,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "ask" },
    ],
  })
  yield* f.llm.serve(() => TestLLM.text("Consumed the original SDK activity facts.", "mc06-sdk-steer-notice-parent"))
  const readPath = `${f.root.location.directory}/sdk-steer-read.txt`
  yield* Effect.promise(() => Bun.write(readPath, "original SDK permission bytes\n"))
  const gates = yield* Effect.all({
    aWritten: Deferred.make<void>(),
    bWritten: Deferred.make<void>(),
    bHookAnswered: Deferred.make<void>(),
    aHookAnswered: Deferred.make<void>(),
    inputFinished: Deferred.make<void>(),
    outputEnded: Deferred.make<void>(),
  })
  const run = Effect.runPromiseWith(yield* Effect.context())
  const state = {
    spawned: 0,
    closed: 0,
    returned: 0,
    reads: 0,
    kills: 0,
    inputFinished: false,
    outputEnded: false,
    cancelledA: false,
    buffer: "",
    callbackID: "",
    bDecision: "",
    aDecision: "",
    aHookRequestID: randomUUID(),
    bHookRequestID: randomUUID(),
  }
  const users: (typeof sdkSteerUser.Type)[] = []
  const writes: Record<string, unknown>[] = []
  const observations: Record<string, unknown>[] = []
  const hookCalls: { toolUseID?: string; sessionID: string; signal: AbortSignal }[] = []
  const queries: Parameters<ClaudeCodeSdkAdapter.ClaudeSdk["query"]>[0][] = []
  const queryOwners: Query[] = []
  const sessionID = randomUUID()
  const resultUUID = randomUUID()
  const text = " \nSDK_STEER_B_" + "汉字🙂\n".repeat(15_000) + "_EXACT_TAIL\n  "
  const result = (uuid: string, body = text): SDKResultSuccess => ({
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: body,
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: "standard",
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    },
    modelUsage: {},
    permission_denials: [],
    terminal_reason: "completed",
    uuid: resultUUID,
    session_id: sessionID,
    user_message_uuid: uuid,
  })
  const emit = (frame: Record<string, unknown>) => {
    observations.push(frame)
    peer.stdout.push(`${JSON.stringify(frame)}\n`)
  }
  const lifecycle = (uuid: string, lifecycleState: "queued" | "started" | "completed" | "cancelled" | "discarded") =>
    emit({
      type: "command_lifecycle",
      command_uuid: uuid,
      state: lifecycleState,
      uuid: randomUUID(),
      session_id: sessionID,
    })
  const hook = (requestID: string, toolUseID: string) =>
    emit({
      type: "control_request",
      request_id: requestID,
      request: {
        subtype: "hook_callback",
        callback_id: state.callbackID,
        tool_use_id: toolUseID,
        input: {
          hook_event_name: "PreToolUse",
          session_id: sessionID,
          cwd: f.root.location.directory,
          transcript_path: "sdk-stdio-transcript",
          tool_name: "Read",
          tool_use_id: toolUseID,
          tool_input: { file_path: readPath },
        },
      },
    })
  const receive = async (frame: Record<string, unknown>) => {
    writes.push(frame)
    if (frame.type === "control_request") {
      const init = Schema.decodeUnknownSync(
        Schema.Struct({
          request_id: Schema.String,
          request: Schema.Struct({
            subtype: Schema.Literal("initialize"),
            hooks: Schema.Struct({
              PreToolUse: Schema.Array(Schema.Struct({ hookCallbackIds: Schema.Array(Schema.String) })),
            }),
          }),
        }),
      )(frame)
      state.callbackID = init.request.hooks.PreToolUse[0]?.hookCallbackIds[0] ?? ""
      if (!state.callbackID) throw new Error("The real SDK initialization did not register its original hook")
      emit({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: init.request_id,
          response: {
            commands: [],
            agents: [],
            output_style: "default",
            available_output_styles: ["default"],
            models: [],
            account: {},
          },
        },
      })
      return
    }
    if (frame.type === "user") {
      const user = Schema.decodeUnknownSync(sdkSteerUser)(frame)
      users.push(user)
      if (users.length === 1) {
        emit({
          type: "system",
          subtype: "init",
          uuid: randomUUID(),
          session_id: sessionID,
          cwd: f.root.location.directory,
          tools: ["Read", "Grep", "Glob"],
          mcp_servers: [],
          model: "fixture",
          permissionMode: "default",
          slash_commands: [],
          apiKeySource: "none",
          claude_code_version: "2.1.220",
          agents: [],
          skills: [],
          plugins: [],
        })
        lifecycle(user.uuid, "queued")
        lifecycle(user.uuid, "started")
        hook(state.aHookRequestID, "sdk-steer-tool-a")
        await run(Deferred.succeed(gates.aWritten, undefined))
        return
      }
      lifecycle(user.uuid, "queued")
      if (users.length === 2) {
        if (cancelA) {
          state.cancelledA = true
          emit({ type: "control_cancel_request", request_id: state.aHookRequestID })
          emit({ ...result(users[0]!.uuid, "SDK_A_ABORTED"), uuid: randomUUID(), terminal_reason: "aborted_tools" })
          lifecycle(users[0]!.uuid, "cancelled")
        }
        lifecycle(user.uuid, "started")
        hook(state.bHookRequestID, "sdk-steer-tool-b")
        await run(Deferred.succeed(gates.bWritten, undefined))
        return
      }
      lifecycle(user.uuid, "started")
      return
    }
    if (frame.type !== "control_response") return
    const response = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(frame.response)
    if (response.request_id !== state.bHookRequestID && response.request_id !== state.aHookRequestID) return
    const answer = Schema.decodeUnknownOption(
      Schema.Struct({
        hookSpecificOutput: Schema.Struct({
          hookEventName: Schema.Literal("PreToolUse"),
          permissionDecision: Schema.optionalKey(Schema.String),
        }),
      }),
    )(response.response)
    const decision = Option.isSome(answer) ? (answer.value.hookSpecificOutput.permissionDecision ?? "") : ""
    if (decision === "allow") {
      await Bun.file(readPath).text()
      state.reads += 1
    }
    if (response.request_id === state.aHookRequestID) {
      state.aDecision = decision
      await run(Deferred.succeed(gates.aHookAnswered, undefined))
      return
    }
    state.bDecision = decision
    await run(Deferred.succeed(gates.bHookAnswered, undefined))
  }
  class MemorySdkProcess extends EventEmitter implements SpawnedProcess {
    killed = false
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    stdout = new Readable({ read() {} })
    stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        state.buffer += String(chunk)
        const lines = state.buffer.split("\n")
        state.buffer = lines.pop() ?? ""
        void lines
          .filter(Boolean)
          .reduce(
            (pending, line) =>
              pending.then(() =>
                receive(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(line))),
              ),
            Promise.resolve(),
          )
          .then(
            () => callback(),
            (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
          )
      },
    })
    finish(code: number | null = 0, signal: NodeJS.Signals | null = null) {
      if (state.outputEnded) return
      state.outputEnded = true
      this.exitCode = code
      this.signalCode = signal
      this.stdout.push(null)
      this.emit("exit", code, signal)
      void run(Deferred.succeed(gates.outputEnded, undefined))
    }
    kill(signal: NodeJS.Signals) {
      state.kills += 1
      this.killed = true
      this.finish(null, signal)
      return true
    }
  }
  const peer = new MemorySdkProcess()
  peer.stdin.on("finish", () => {
    state.inputFinished = true
    void run(Deferred.succeed(gates.inputFinished, undefined))
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => peer.finish()))
  const { query } = yield* Effect.promise(() => import("@anthropic-ai/claude-agent-sdk"))
  const previous = CliAdapter.getCliAdapter("claude-code")
  const adapter = ClaudeCodeSdkAdapter.makeClaudeCodeSdkAdapter({
    query: (input) => {
      queries.push(input)
      const owner = query({
        prompt: input.prompt,
        options: {
          ...input.options,
          pathToClaudeCodeExecutable: "/sdk-memory-peer/claude",
          env: { CLAUDE_CONFIG_DIR: f.root.location.directory, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" },
          hooks: {
            ...input.options?.hooks,
            PreToolUse: input.options?.hooks?.PreToolUse?.map((matcher) => ({
              ...matcher,
              hooks: matcher.hooks.map(
                (original): HookCallback =>
                  async (hookInput, toolUseID, options) => {
                    hookCalls.push({ toolUseID, sessionID: hookInput.session_id, signal: options.signal })
                    return original(hookInput, toolUseID, options)
                  },
              ),
            })),
          },
          spawnClaudeCodeProcess: () => {
            state.spawned += 1
            return peer
          },
        },
      })
      const close = owner.close.bind(owner)
      const iterator = owner[Symbol.asyncIterator]()
      const returned = iterator.return.bind(iterator)
      owner.close = () => {
        state.closed += 1
        close()
      }
      iterator.return = async (...args: Parameters<typeof iterator.return>) => {
        const completed = await returned(...args)
        state.returned += 1
        return completed
      }
      queryOwners.push(owner)
      return owner
    },
  })
  CliAdapter.registerCliAdapter("claude-code", adapter)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => CliAdapter.registerCliAdapter("claude-code", previous ?? ClaudeCodeSdkAdapter.adapter)),
  )
  const config = yield* Config.Service.pipe(Effect.provide(local))
  const entries = yield* config.entries()
  const configured = yield* CliAdapter.resolve(entries, "claude-code")
  expect(configured.timeout).toBe(timeoutMs)
  return {
    ...f,
    permission,
    state,
    users,
    writes,
    observations,
    hookCalls,
    queries,
    queryOwners,
    peer,
    cancelA,
    gates,
    sessionID,
    resultUUID,
    text,
    result,
    emit,
    lifecycle,
    kv: yield* KV.Service,
    tasks: yield* SessionTask.Service,
    jobs: yield* Job.Service,
    delegations: yield* DelegationService.Service,
    execution: yield* DelegationExecution.Service,
    database: yield* Database.Service,
  }
})

const sdkSteerStart = Effect.fnUntraced(function* (f: Effect.Success<ReturnType<typeof sdkSteerSetup>>) {
  const first = yield* sdkTask(f, "mc06-sdk-steer-a", {
    description: "Start the original SDK activity",
    prompt: "Run A through the original readonly SDK scope.",
    execution_type: "external-cli",
    cli_target: "claude-code",
    subagent_type: "claude-code",
    attended: true,
    background: true,
  })
  if (first.tool.state.status !== "completed")
    return yield* Effect.die(new Error(`The SDK activity admission failed: ${JSON.stringify(first.tool.state)}`))
  const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(first.text)
  yield* awaitWithTimeout(Deferred.await(f.gates.aWritten), "The real SDK did not write A")
  const aBinding = yield* pollWithTimeout(
    f.kv
      .scan({ prefix: `delegation:external:${admission.delegationID}:` })
      .pipe(
        Effect.map((entries) =>
          entries.entries
            .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
            .find(
              (entry) =>
                entry.source.id === "mc06-sdk-steer-a" &&
                entry.sdkInput?.observations.some(
                  (observation) =>
                    observation instanceof DelegationReceipt.SdkLifecycle && observation.state === "started",
                ),
            ),
        ),
      ),
    "The product did not observe native A started",
  )
  const aRequest = yield* pollWithTimeout(
    f.permission
      .forSession(f.root.id)
      .pipe(
        Effect.map((requests) =>
          requests.find((request) => request.source?.type === "tool" && request.source.id === "mc06-sdk-steer-a"),
        ),
      ),
    "A did not reach its original parent permission",
  )
  return { ...f, first, admission, aBinding, aRequest, aKey: DelegationReceipt.key(aBinding) }
})

const sdkSteerAdmit = Effect.fnUntraced(function* (
  f: Effect.Success<ReturnType<typeof sdkSteerStart>>,
  parentTaskID?: string,
  includeC = false,
) {
  const input = {
    description: "Steer the original SDK activity",
    prompt: "Run B now and return B's entire independent answer.",
    execution_type: "external-cli" as const,
    cli_target: "claude-code" as const,
    subagent_type: "claude-code",
    command: "steer" as const,
    background: false,
    delegation_id: f.admission.delegationID,
    participant_id: f.admission.participantID,
    ...(parentTaskID ? { parent_task_id: parentTaskID } : {}),
  }
  yield* f.llm.push(
    TestLLM.toolCalls(
      LLMEvent.toolCall({ id: "mc06-sdk-steer-b", name: TaskTool.name, input }),
      ...(includeC
        ? [
            LLMEvent.toolCall({
              id: "mc06-sdk-steer-c",
              name: TaskTool.name,
              input: { ...input, prompt: "Run representative C now.", description: "Steer representative C" },
            }),
          ]
        : []),
    ),
    TestLLM.text("Consumed the independent SDK steer answer.", "mc06-sdk-steer-b-parent"),
  )
  yield* f.sessions.prompt({
    sessionID: f.root.id,
    text: "Send the independent foreground B to the running SDK Query.",
  })
  yield* pollWithTimeout(
    Effect.gen(function* () {
      if (yield* Deferred.isDone(f.gates.bWritten)) return true
      const messages = yield* f.sessions.context(f.root.id)
      const tool = messages
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc06-sdk-steer-b")
      if (tool?.type === "tool" && tool.state.status === "error")
        return yield* Effect.fail(new Error(`MC06 SDK steer B failed: ${JSON.stringify(tool.state)}`))
    }),
    "The real SDK did not write ordinary B now",
    "2 seconds",
  )
  const bBinding = yield* pollWithTimeout(
    f.kv
      .scan({ prefix: `delegation:external:${f.admission.delegationID}:` })
      .pipe(
        Effect.map((entries) =>
          entries.entries
            .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
            .find(
              (entry) =>
                entry.source.id === "mc06-sdk-steer-b" &&
                entry.sdkInput?.observations.some(
                  (observation) =>
                    observation instanceof DelegationReceipt.SdkLifecycle && observation.state === "started",
                ),
            ),
        ),
      ),
    "The product did not observe native B started",
  )
  const bRequest = yield* pollWithTimeout(
    f.permission
      .forSession(f.root.id)
      .pipe(Effect.map((requests) => requests.find((request) => request.id !== f.aRequest.id))),
    "B did not reach the original Query's parent permission",
  )
  return { ...f, bBinding, bRequest, bKey: DelegationReceipt.key(bBinding) }
})

const sdkSteerAnswer = Effect.fnUntraced(function* (
  f: Effect.Success<ReturnType<typeof sdkSteerAdmit>>,
  reply: "once" | "reject" = "once",
) {
  yield* f.permission.reply({ requestID: f.bRequest.id, reply })
  yield* awaitWithTimeout(
    Deferred.await(f.gates.bHookAnswered),
    "The real SDK did not write B's original hook response",
  )
  expect(f.state.inputFinished).toBe(false)
  expect(f.hookCalls.map((call) => call.toolUseID)).toEqual(["sdk-steer-tool-a", "sdk-steer-tool-b"])
  expect(f.hookCalls[0]?.signal.aborted).toBe(f.cancelA)
  expect(f.hookCalls[1]?.signal.aborted).toBe(false)
})

const sdkSteerFinish = Effect.fnUntraced(function* (
  f: Effect.Success<ReturnType<typeof sdkSteerAdmit>>,
  body = f.text,
  completedFirst = false,
  tailError = false,
) {
  const uuid = f.bBinding.sdkInput?.uuid
  if (!uuid) return yield* Effect.die(new Error("The activity Binding lost B's client UUID"))
  if (completedFirst) {
    f.lifecycle(uuid, "completed")
    yield* pollWithTimeout(
      f.kv
        .get(f.bKey)
        .pipe(
          Effect.map((raw) =>
            Schema.decodeUnknownSync(DelegationReceipt.Binding)(raw).sdkInput?.observations.some(
              (observation) =>
                observation instanceof DelegationReceipt.SdkLifecycle && observation.state === "completed",
            )
              ? true
              : undefined,
          ),
        ),
      "B completed was not observed before its held result",
    )
    expect(f.state.inputFinished).toBe(false)
  }
  f.emit({ ...f.result(uuid, body) })
  if (!completedFirst) f.lifecycle(uuid, "completed")
  if (tailError)
    f.emit({
      ...f.result(uuid),
      subtype: "error_during_execution",
      is_error: true,
      uuid: randomUUID(),
      user_message_uuid: undefined,
      result: undefined,
      terminal_reason: "api_error",
      errors: ["Query tail failed after accepted B"],
    })
  yield* awaitWithTimeout(
    Deferred.await(f.gates.inputFinished),
    "The original feed did not end after each native input's result",
  )
  expect((yield* mc07Result(f, "mc06-sdk-steer-b")).tool.state.status).toBe("running")
  expect(f.state.outputEnded).toBe(false)
  f.peer.finish()
  yield* awaitWithTimeout(
    f.runs.awaitIdle(f.root.id),
    "The real SDK activity did not finish cleanup and return B",
    "10 seconds",
  )
  return yield* mc07Consumed(f, "mc06-sdk-steer-b")
})

const sdkTask = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof metaSetup>>,
  id: string,
  input: typeof TaskTool.Input.Type,
) {
  yield* fixture.llm.push(
    TestLLM.tool(id, TaskTool.name, input),
    TestLLM.text(`Consumed ${id} completely.`, `${id}-parent`),
  )
  yield* fixture.sessions.prompt({ sessionID: fixture.root.id, text: input.description })
  yield* awaitWithTimeout(fixture.runs.awaitIdle(fixture.root.id), `${id} did not settle`, "10 seconds")
  const result = yield* mc07Consumed(fixture, id)
  if (result.tool.state.status !== "completed" && result.tool.state.status !== "error")
    return yield* Effect.die(new Error(`${id} has no terminal external Task facts`))
  return { ...result, tool: { ...result.tool, state: result.tool.state } }
})

for (const completedFirst of [false, true])
  effectTest.live(
    `MC06 SDK activity F1 real SDK and Meta preserve independent B with ${completedFirst ? "completed before held result" : "result before completed"}`,
    () =>
      Effect.gen(function* () {
        const f = yield* sdkSteerSetup().pipe(
          Effect.flatMap(sdkSteerStart),
          Effect.flatMap((started) => sdkSteerAdmit(started)),
        )
        expect(f.queries).toHaveLength(1)
        expect(f.state.spawned).toBe(1)
        expect(typeof f.queries[0]?.prompt).toBe("object")
        expect(f.users).toHaveLength(2)
        if (!f.aBinding.sdkInput || !f.bBinding.sdkInput)
          return yield* Effect.die(new Error("The actual SDK activity inputs have no saved UUIDs"))
        expect(f.users[0]?.uuid).toBe(f.aBinding.sdkInput.uuid)
        expect(f.users[1]).toMatchObject({
          uuid: f.bBinding.sdkInput?.uuid,
          session_id: f.sessionID,
          priority: "now",
          message: { role: "user", content: "Run B now and return B's entire independent answer." },
          parent_tool_use_id: null,
        })
        expect(f.users[1]?.uuid).not.toBe(f.users[0]?.uuid)
        expect(f.resultUUID).not.toBe(f.users[1]?.uuid)
        expect(f.aBinding.parentTaskID).not.toBe(f.bBinding.parentTaskID)
        expect(f.bBinding.source.id).toBe("mc06-sdk-steer-b")
        expect(f.bRequest.source).toEqual(f.aBinding.source)
        expect(f.bRequest.id).not.toBe(f.aRequest.id)
        expect(f.state.reads).toBe(0)
        expect(f.observations.filter((frame) => frame.type === "control_cancel_request")).toEqual([
          { type: "control_cancel_request", request_id: f.state.aHookRequestID },
        ])
        yield* f.permission.reply({ requestID: f.aRequest.id, reply: "once" }).pipe(Effect.exit)
        expect(f.state.reads).toBe(0)
        yield* sdkSteerAnswer(f)
        const settled = yield* sdkSteerFinish(f, f.text, completedFirst)
        if (settled.tool.state.status !== "completed")
          return yield* Effect.die(new Error(`The real SDK F1 did not return B: ${JSON.stringify(settled.tool.state)}`))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(settled.text)
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(settled.tool.state.metadata?.externalReceipt)
        expect(output.output).toBe(f.text)
        expect(output.sdkMessage).toEqual(
          new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: f.resultUUID }),
        )
        expect(receipt.source).toEqual(f.bBinding.source)
        expect(output.parentTaskID).toBe(f.bBinding.parentTaskID)
        const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
        const a = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.aKey))
        expect(b.settlement).toEqual({ status: "completed", text: f.text })
        expect(b.sdkMessage).toEqual(output.sdkMessage)
        expect(a.settlement?.status).toBe("cancelled")
        expect(a.sdkMessage).toBeUndefined()
        expect(
          a.sdkInput?.observations.find((observation) => observation instanceof DelegationReceipt.SdkResultObservation),
        ).toMatchObject({
          type: "result",
          user_message_uuid: f.users[0]?.uuid,
          result: "SDK_A_ABORTED",
          terminal_reason: "aborted_tools",
        })
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === b.parentTaskID)).toMatchObject({
          status: "completed",
          revision: b.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.text),
        })
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === a.parentTaskID)?.status).toBe("cancelled")
        expect(JSON.stringify((yield* mc07Result(f, "mc06-sdk-steer-a")).tool)).toBe(JSON.stringify(f.first.tool))
        expect(yield* sdkEarlyEvents(f, b).metas).toHaveLength(1)
        expect(yield* sdkEarlyEvents(f, b).successes).toHaveLength(1)
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
        expect(f.state).toMatchObject({
          spawned: 1,
          reads: 1,
          closed: 1,
          returned: 1,
          kills: 0,
          inputFinished: true,
          outputEnded: true,
        })
        expect(f.queries[0]?.options?.abortController?.signal.aborted).toBe(true)
        expect(yield* Effect.promise(() => f.queryOwners[0]!.next())).toMatchObject({ done: true })
      }),
  )

effectTest.live("MC06 SDK activity F1 original Query survives a changed registered CLI transport", () =>
  Effect.gen(function* () {
    const started = yield* sdkSteerSetup().pipe(Effect.flatMap(sdkSteerStart))
    const adapter = CliAdapter.getCliAdapter("claude-code")
    if (!adapter)
      return yield* Effect.die(new Error("The original SDK registration disappeared before the fixture changed it"))
    CliAdapter.registerCliAdapter("claude-code", {
      ...adapter,
      command: "changed-after-original-start",
      transport: "acp",
    })
    const f = yield* sdkSteerAdmit(started)
    yield* sdkSteerAnswer(f)
    const result = yield* sdkSteerFinish(f)
    expect(result.tool.state.status).toBe("completed")
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text).output).toBe(
      f.text,
    )
    expect(f.queries).toHaveLength(1)
    expect(f.state.spawned).toBe(1)
    expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey)).command).toBe(
      started.aBinding.command,
    )
  }),
)

for (const missing of [
  "user_message_uuid",
  "unknown_input",
  "session_id",
  "foreign_session",
  "uuid",
  "result",
  "global_error",
] as const)
  effectTest.live(`MC06 SDK activity F2 ${missing} preserves its observed tuple without completing B`, () =>
    Effect.gen(function* () {
      const f = yield* sdkSteerSetup().pipe(
        Effect.flatMap(sdkSteerStart),
        Effect.flatMap((started) => sdkSteerAdmit(started)),
      )
      yield* sdkSteerAnswer(f)
      if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("B has no saved input UUID"))
      const frame: Record<string, unknown> = { ...f.result(f.bBinding.sdkInput.uuid) }
      if (missing === "unknown_input") frame.user_message_uuid = randomUUID()
      if (missing === "foreign_session") frame.session_id = randomUUID()
      if (missing === "global_error") {
        frame.subtype = "error_during_execution"
        frame.is_error = true
        frame.terminal_reason = "api_error"
        frame.errors = ["Unassigned Query error"]
        delete frame.result
        delete frame.user_message_uuid
      }
      if (missing !== "unknown_input" && missing !== "foreign_session" && missing !== "global_error")
        delete frame[missing]
      f.emit(frame)
      f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
      yield* pollWithTimeout(
        f.kv.scan({ prefix: `delegation:external:${f.admission.delegationID}:` }).pipe(
          Effect.map((entries) =>
            entries.entries
              .flatMap((entry) => {
                const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value)
                return [...(binding.sdkObservations ?? []), ...(binding.sdkInput?.observations ?? [])]
              })
              .filter((observation) => observation instanceof DelegationReceipt.SdkResultObservation).length >= 2
              ? true
              : undefined,
          ),
        ),
        "The product did not preserve the invalid result observation",
      )
      const pending = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
      expect(pending.sdkMessage).toBeUndefined()
      expect(pending.settlement).toBeUndefined()
      expect(f.state.inputFinished).toBe(false)
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === pending.parentTaskID)?.status).toBe(
        "in_progress",
      )
      f.peer.finish()
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "EOF did not release an unmatched SDK input", "10 seconds")
      const failed = yield* mc07Consumed(f, "mc06-sdk-steer-b")
      const saved = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
      expect(failed.tool.state.status).toBe("error")
      if (failed.tool.state.status !== "error")
        return yield* Effect.die(new Error("The unmatched SDK input did not fail its owning Task"))
      expect(failed.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(saved.sdkMessage).toBeUndefined()
      expect(saved.settlement?.status).toBe("recovery_required")
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === saved.parentTaskID)?.status).toBe("failed")
      expect(yield* sdkEarlyEvents(f, saved).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, saved).metas).toEqual([])
      expect(f.state).toMatchObject({ spawned: 1, closed: 1, returned: 1, outputEnded: true })
      expect(f.queries).toHaveLength(1)
    }),
  )

effectTest.live("MC06 SDK activity F2 representative C result cannot complete its unrepresented B", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started, undefined, true)),
    )
    yield* pollWithTimeout(
      Effect.sync(() => (f.users.length === 3 ? true : undefined)),
      "The original SDK feed did not actually write C",
    )
    const c = yield* pollWithTimeout(
      f.kv
        .scan({ prefix: `delegation:external:${f.admission.delegationID}:` })
        .pipe(
          Effect.map((entries) =>
            entries.entries
              .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
              .find((binding) => binding.source.id === "mc06-sdk-steer-c" && binding.sdkInput !== undefined),
          ),
        ),
      "Representative C has no actual Binding",
    )
    if (!f.bBinding.sdkInput || !c.sdkInput)
      return yield* Effect.die(new Error("The B/C batch has no actual input UUIDs"))
    yield* sdkSteerAnswer(f)
    const body = " \nREPRESENTATIVE_C_" + "结果🙂".repeat(4096) + "_TAIL\n "
    f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
    f.emit({ ...f.result(c.sdkInput.uuid, body), uuid: randomUUID() })
    f.lifecycle(c.sdkInput.uuid, "completed")
    yield* pollWithTimeout(
      f.kv
        .get(DelegationReceipt.key(c))
        .pipe(
          Effect.map((raw) =>
            Schema.decodeUnknownSync(DelegationReceipt.Binding)(raw).settlement?.status === "completed"
              ? true
              : undefined,
          ),
        ),
      "C did not persist its own representative result",
    )
    expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey)).sdkMessage).toBeUndefined()
    expect(f.state.inputFinished).toBe(false)
    f.peer.finish()
    yield* awaitWithTimeout(
      f.runs.awaitIdle(f.root.id),
      "The original Query did not release B/C after EOF",
      "10 seconds",
    )
    expect((yield* mc07Consumed(f, "mc06-sdk-steer-b")).tool.state.status).toBe("error")
    const result = yield* mc07Consumed(f, "mc06-sdk-steer-c")
    if (result.tool.state.status !== "completed")
      return yield* Effect.die(new Error("The unrepresented B prevented representative C's own Task result"))
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text).output).toBe(body)
    const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    expect(b.settlement?.status).toBe("recovery_required")
    expect(b.sdkMessage).toBeUndefined()
    expect(yield* sdkEarlyEvents(f, b).metas).toEqual([])
    expect(yield* sdkEarlyEvents(f, c).metas).toHaveLength(1)
    expect(f.queries).toHaveLength(1)
  }),
)

effectTest.live("MC06 SDK activity F2 accepted B retains its full result after an unassigned Query tail error", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    yield* sdkSteerAnswer(f)
    const result = yield* sdkSteerFinish(f, f.text, false, true)
    expect(result.tool.state.status).toBe("completed")
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text).output).toBe(
      f.text,
    )
    const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    const a = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.aKey))
    expect(b.settlement).toEqual({ status: "completed", text: f.text })
    expect(
      a.sdkObservations?.find((observation) => observation instanceof DelegationReceipt.SdkResultObservation),
    ).toMatchObject({
      subtype: "error_during_execution",
      is_error: true,
      errors: ["Query tail failed after accepted B"],
    })
    expect(
      (yield* f.execution.wait(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(b)))).text,
    ).toBe(f.text)
    expect(yield* sdkEarlyEvents(f, b).metas).toHaveLength(1)
  }),
)

effectTest.live("MC06 SDK activity F3 same parent Task revision survives A's old cancellation claim", () =>
  Effect.gen(function* () {
    const started = yield* sdkSteerSetup().pipe(Effect.flatMap(sdkSteerStart))
    const f = yield* sdkSteerAdmit(started, started.aBinding.parentTaskID)
    expect(f.bBinding.parentTaskID).toBe(f.aBinding.parentTaskID)
    expect(f.bBinding.parentTaskRevision).toBeGreaterThan(f.aBinding.parentTaskRevision)
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === f.bBinding.parentTaskID)).toMatchObject({
      status: "in_progress",
      revision: f.bBinding.parentTaskRevision,
    })
    yield* sdkSteerAnswer(f)
    const result = yield* sdkSteerFinish(f)
    expect(result.tool.state.status).toBe("completed")
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === f.bBinding.parentTaskID)).toMatchObject({
      status: "completed",
      revision: f.bBinding.parentTaskRevision + 1,
      outputDigest: DelegationReceipt.outputDigest(f.text),
    })
    expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.aKey)).settlement?.status).toBe(
      "cancelled",
    )
    expect((yield* mc07Result(f, "mc06-sdk-steer-a")).tool).toEqual(f.first.tool)
    expect(f.queries).toHaveLength(1)
  }),
)

for (const change of ["edited", "cancelled"] as const)
  effectTest.live(`MC06 SDK activity F3 ${change} B claim survives its late successful producer result`, () =>
    Effect.gen(function* () {
      const f = yield* sdkSteerSetup().pipe(
        Effect.flatMap(sdkSteerStart),
        Effect.flatMap((started) => sdkSteerAdmit(started)),
      )
      yield* sdkSteerAnswer(f)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const patch = f.tasks.patch
      const held = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(f.tasks, "patch").mockImplementation((input, options) => {
            const result = patch(input, options)
            if (
              input.id !== f.bBinding.parentTaskID ||
              input.expectedRevision !== f.bBinding.parentTaskRevision ||
              input.status !== "completed"
            )
              return result
            return Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(result),
            )
          }),
        ),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("The CAS input lost B's UUID"))
      f.emit({ ...f.result(f.bBinding.sdkInput.uuid) })
      yield* awaitWithTimeout(Deferred.await(entered), "B did not reach its original Task CAS window")
      const changed = yield* f.tasks.updateTask({
        sessionID: f.root.id,
        id: f.bBinding.parentTaskID,
        expectedRevision: f.bBinding.parentTaskRevision,
        status: change === "cancelled" ? "cancelled" : "in_progress",
        content: "The owner revised this Task at the actual producer/CAS boundary.",
      })
      if (!changed) return yield* Effect.die(new Error("The concurrent Task owner did not update its claim"))
      const saved = yield* f.kv.get(f.bKey)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(saved).settlement).toEqual({
        status: "completed",
        text: f.text,
      })
      yield* Deferred.succeed(release, undefined)
      yield* Effect.sync(() => held.mockRestore())
      f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
      yield* awaitWithTimeout(
        Deferred.await(f.gates.inputFinished),
        "The CAS loser did not release its consumed SDK input",
      )
      f.peer.finish()
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The CAS loser did not release the parent Task",
        "10 seconds",
      )
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === changed.id)).toEqual(changed)
      expect((yield* mc07Consumed(f, "mc06-sdk-steer-b")).tool.state.status).toBe("error")
      expect(yield* sdkEarlyEvents(f, f.bBinding).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, f.bBinding).metas).toEqual([])
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey)).settlement?.text).toBe(f.text)
      expect(f.queries).toHaveLength(1)
    }),
  )

effectTest.live("MC06 SDK activity F4 original A permission scope rejects B Read without executing it", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    yield* sdkSteerAnswer(f, "reject")
    const body = "SDK_B_READ_DENIED"
    const result = yield* sdkSteerFinish(f, body)
    expect(result.tool.state.status).toBe("completed")
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text).output).toBe(body)
    expect(f.bRequest.source).toEqual(f.aBinding.source)
    expect(f.state.reads).toBe(0)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    const responses = f.writes
      .filter((frame) => frame.type === "control_response")
      .map((frame) => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(frame.response))
      .filter((response) => response.request_id === f.state.bHookRequestID)
    expect(responses).toHaveLength(1)
    expect(
      Schema.decodeUnknownSync(
        Schema.Struct({ subtype: Schema.Literal("error"), request_id: Schema.String, error: Schema.String }),
      )(responses[0]),
    ).toMatchObject({ subtype: "error", request_id: f.state.bHookRequestID })
  }),
)

effectTest.live("MC06 SDK activity F5 whole Job cancellation releases the original pending B hook and waiter", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    const scope = yield* Effect.scope
    const stopping = yield* f.execution
      .interrupt({ delegationID: f.admission.delegationID, participantID: f.admission.participantID })
      .pipe(Effect.forkIn(scope, { startImmediately: true }))
    yield* pollWithTimeout(
      Effect.sync(() => (f.queries[0]?.options?.abortController?.signal.aborted ? true : undefined)),
      "Whole Job cancellation did not abort the original SDK scope",
    )
    if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("Cancelled B has no original client UUID"))
    f.emit({ ...f.result(f.bBinding.sdkInput.uuid) })
    f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
    f.peer.finish(null, "SIGTERM")
    yield* awaitWithTimeout(Fiber.join(stopping), "The cancelled SDK Job retained its original lock or cleanup")
    yield* awaitWithTimeout(
      f.runs.awaitIdle(f.root.id),
      "The cancelled foreground B did not release its parent",
      "10 seconds",
    )
    const result = yield* mc07Consumed(f, "mc06-sdk-steer-b")
    const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    expect(result.tool.state.status).toBe("error")
    expect(b.sdkMessage).toBeUndefined()
    expect(b.settlement?.status).toBe("cancelled")
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === b.parentTaskID)?.status).toBe("cancelled")
    expect(yield* sdkEarlyEvents(f, b).successes).toEqual([])
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    yield* f.permission.reply({ requestID: f.bRequest.id, reply: "once" }).pipe(Effect.exit)
    expect(f.state.reads).toBe(0)
    expect(f.hookCalls[1]?.signal.aborted).toBe(true)
    expect(f.state).toMatchObject({ spawned: 1, closed: 1, returned: 1, outputEnded: true })
  }),
)

effectTest.live("MC06 SDK activity F5 natural EOF releases B's pending original permission and missing result", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    expect(f.state.inputFinished).toBe(false)
    f.peer.finish()
    yield* awaitWithTimeout(
      f.runs.awaitIdle(f.root.id),
      "Natural SDK EOF did not release the unanswered B input",
      "10 seconds",
    )
    const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    expect((yield* mc07Consumed(f, "mc06-sdk-steer-b")).tool.state.status).toBe("error")
    expect(b.sdkMessage).toBeUndefined()
    expect(b.settlement?.status).toBe("recovery_required")
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect(f.state.reads).toBe(0)
    expect(f.hookCalls[1]?.signal.aborted).toBe(true)
    expect(f.state).toMatchObject({ closed: 1, returned: 1, outputEnded: true })
  }),
)

effectTest.live("MC06 SDK activity F5 original timeout releases an input without a matching result", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup(2000).pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    yield* sdkSteerAnswer(f)
    yield* pollWithTimeout(
      Effect.sync(() => (f.queries[0]?.options?.abortController?.signal.aborted ? true : undefined)),
      "The original SDK adapter timeout did not abort its scope",
      "10 seconds",
    )
    f.peer.finish()
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The SDK timeout did not release B's own waiter", "10 seconds")
    const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    expect((yield* mc07Consumed(f, "mc06-sdk-steer-b")).tool.state.status).toBe("error")
    expect(b.sdkMessage).toBeUndefined()
    expect(b.settlement?.status).toBe("recovery_required")
    expect(yield* sdkEarlyEvents(f, b).metas).toEqual([])
    expect(f.queries).toHaveLength(1)
    expect(f.state).toMatchObject({ closed: 1, returned: 1, outputEnded: true })
  }),
)

effectTest.live("MC06 SDK activity F5 B admission racing original Query close has no native result credit", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(Effect.flatMap(sdkSteerStart))
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const controlled = { held: false }
    const set = f.kv.set
    const held = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(f.kv, "set").mockImplementation((key, value) => {
          const binding = Schema.decodeUnknownOption(DelegationReceipt.Binding)(value)
          if (controlled.held || Option.isNone(binding) || binding.value.source.id !== "mc06-sdk-steer-b")
            return set(key, value)
          controlled.held = true
          return Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(set(key, value)),
          )
        }),
      ),
      (value) => Effect.sync(() => value.mockRestore()),
    )
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* f.llm.push(
      TestLLM.tool("mc06-sdk-steer-b", TaskTool.name, {
        description: "Admit B at the close boundary",
        prompt: "Close-racing ordinary B",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        command: "steer",
        delegation_id: f.admission.delegationID,
        participant_id: f.admission.participantID,
      }),
      TestLLM.text("Consumed the SDK close race.", "mc06-sdk-steer-close-parent"),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Race B's original admission with physical Query EOF." })
    yield* awaitWithTimeout(Deferred.await(entered), "B did not reach its original Binding/offer boundary")
    f.peer.finish()
    yield* pollWithTimeout(
      Effect.sync(() => (f.queries[0]?.options?.abortController?.signal.aborted ? true : undefined)),
      "The close-racing Query did not finish its original SDK scope before B offer",
    )
    yield* Deferred.succeed(release, undefined)
    yield* Effect.sync(() => held.mockRestore())
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The close-racing SDK Task did not release", "10 seconds")
    const result = yield* mc07Consumed(f, "mc06-sdk-steer-b")
    const b = (yield* f.kv.scan({ prefix: `delegation:external:${f.admission.delegationID}:` })).entries
      .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
      .find((binding) => binding.source.id === "mc06-sdk-steer-b")
    if (!b) return yield* Effect.die(new Error("The locally admitted close-racing B lost its Binding"))
    expect(result.tool.state.status).toBe("error")
    expect(b.sdkMessage).toBeUndefined()
    expect(b.settlement?.status).toBe("recovery_required")
    expect(yield* sdkEarlyEvents(f, b).successes).toEqual([])
    expect(f.users).toHaveLength(1)
    expect(f.queries).toHaveLength(1)
    expect(f.state).toMatchObject({ closed: 1, returned: 1, outputEnded: true })
  }),
)

for (const phase of ["binding", "task", "delivery", "tool"] as const)
  effectTest.live(`MC06 SDK activity F6 cold B recovery at ${phase} preserves full original result exactly once`, () =>
    Effect.gen(function* () {
      const f = yield* sdkSteerSetup().pipe(
        Effect.flatMap(sdkSteerStart),
        Effect.flatMap((started) => sdkSteerAdmit(started)),
      )
      yield* sdkSteerAnswer(f)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const bus = yield* Bus.Service
      const patch = f.tasks.patch
      const held =
        phase === "binding" || phase === "task"
          ? yield* Effect.acquireRelease(
              Effect.sync(() =>
                spyOn(f.tasks, "patch").mockImplementation((input, options) => {
                  const result = patch(input, options)
                  if (
                    input.id !== f.bBinding.parentTaskID ||
                    input.expectedRevision !== f.bBinding.parentTaskRevision ||
                    input.status !== "completed"
                  )
                    return result
                  const gate = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                  return phase === "binding" ? gate.pipe(Effect.andThen(result)) : result.pipe(Effect.tap(() => gate))
                }),
              ),
              (value) => Effect.sync(() => value.mockRestore()),
            )
          : undefined
      const unsubscribe = yield* bus.listen((event) => {
        if (phase === "delivery" && event.type === DelegationEvent.DeliveryCompleted.type) {
          const data = Schema.decodeUnknownSync(Schema.toType(DelegationEvent.DeliveryCompletedData))(event.data)
          if (DelegationReceipt.key(data) !== f.bKey || data.attempt !== f.bBinding.attempt) return Effect.void
          return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        }
        if (phase === "tool" && event.type === SessionEvent.Tool.Success.type) {
          const data = Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID, id: Schema.String }))(event.data)
          if (data.sessionID !== f.root.id || data.id !== "mc06-sdk-steer-b") return Effect.void
          return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe), Effect.asVoid),
      )
      if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("The cold checkpoint lost B's UUID"))
      f.emit({ ...f.result(f.bBinding.sdkInput.uuid) })
      f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
      if (phase === "tool") {
        yield* awaitWithTimeout(Deferred.await(f.gates.inputFinished), "The Tool checkpoint's SDK input did not finish")
        f.peer.finish()
      }
      yield* awaitWithTimeout(Deferred.await(entered), `The real B result did not reach its ${phase} checkpoint`)
      const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint))
      expect(checkpoint.settlement).toEqual({ status: "completed", text: f.text })
      expect(checkpoint.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: f.resultUUID }),
      )
      expect(checkpoint.sdkInput?.uuid).toEqual(f.bBinding.sdkInput.uuid)
      const snapshot = `${(yield* tmpdirScoped()).path}/sdk-activity-${phase}.sqlite`
      yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
      const opened = yield* sdkEarlyOpen(f, snapshot)
      expect(opened.database).not.toBe(f.database)
      expect(opened.execution).not.toBe(f.execution)
      yield* opened.llm.serve(() =>
        TestLLM.text("Consumed the original cold B result.", `sdk-activity-${phase}-cold-parent`),
      )
      yield* opened.execution.recoverPending
      yield* opened.sessions.prompt({
        sessionID: opened.root.id,
        text: "Consume the original persisted B result through its existing Tool source.",
      })
      yield* awaitWithTimeout(
        opened.runs.awaitIdle(opened.root.id),
        "The cold Meta parent did not consume B",
        "10 seconds",
      )
      const consumed = yield* mc07Consumed(opened, "mc06-sdk-steer-b")
      if (consumed.tool.state.status !== "completed")
        return yield* Effect.die(new Error(`Cold B ${phase} did not publish its original complete Tool result`))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(consumed.text)
      expect(output.output).toBe(f.text)
      expect(output.sdkMessage).toEqual(receipt.sdkMessage)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(consumed.tool.state.metadata?.externalReceipt)).toEqual(
        receipt,
      )
      expect((yield* opened.execution.wait(receipt)).text).toBe(f.text)
      const events = sdkEarlyEvents(opened, checkpoint)
      const before = yield* Effect.all({
        tasks: opened.tasks.get(opened.root.id),
        binding: opened.kv.get(f.bKey),
        state: opened.delegations.foldState(checkpoint.delegationID),
        successes: events.successes,
        metas: events.metas,
        messages: opened.sessions.context(opened.root.id),
      })
      expect(before.successes).toHaveLength(1)
      expect(before.metas).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(before.metas[0]?.provenance?.externalReceipt)).toEqual(
        receipt,
      )
      yield* opened.execution.recoverPending
      yield* opened.execution.recoverPending
      expect(
        yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.bKey),
          state: opened.delegations.foldState(checkpoint.delegationID),
          successes: events.successes,
          metas: events.metas,
          messages: opened.sessions.context(opened.root.id),
        }),
      ).toEqual(before)
      expect(f.queries).toHaveLength(1)
      yield* Deferred.succeed(release, undefined)
      yield* Effect.sync(() => held?.mockRestore())
      yield* unsubscribe
      if (phase !== "tool") {
        yield* awaitWithTimeout(
          Deferred.await(f.gates.inputFinished),
          "The original checkpoint feed did not finish after release",
        )
        f.peer.finish()
      }
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The original B checkpoint owner did not finish",
        "10 seconds",
      )
      expect(f.queries).toHaveLength(1)
    }),
  )

const acpTaskSetup = Effect.fnUntraced(function* (requestLine?: number) {
  const fixture = yield* metaSetup(
    Agent.ID.make("keeper-worker"),
    true,
    Agent.ID.make("meta"),
    "acp",
    undefined,
    "",
    "work",
    undefined,
    "claude-code",
  )
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(fixture.root.location)
  const permission = yield* Permission.Service.pipe(Effect.provide(local))
  const presence = yield* ApprovalPresence.Service
  yield* presence.bindResponder({ location: fixture.root.location, custom: false })
  const readPath = `${fixture.root.location.directory}/acp-read.txt`
  const fileText = "first line\n  第二行🙂  \nthird line\n"
  const files = yield* FSUtil.Service
  yield* files.writeFileString(readPath, fileText)
  const controls = yield* Effect.forEach([0, 1, 2], () =>
    Effect.all({
      started: Deferred.make<void>(),
      afterRead: Deferred.make<void>(),
      resultGate: Deferred.make<void>(),
      promptEnded: Deferred.make<void>(),
      closed: Deferred.make<void>(),
    }),
  )
  yield* Effect.addFinalizer(() =>
    Effect.forEach(controls, (control) => Deferred.succeed(control.resultGate, undefined), { discard: true }),
  )
  const outputs = [0, 1, 2].map((index) => {
    const prefix = ` \nACP_${index}_`
    return prefix + "x".repeat(4095 - prefix.length) + "🙂" + "汉字🙂\n".repeat(15_000) + `_TAIL_${index}\n  `
  })
  const outgoing: AnyMessage[][] = []
  const incoming: AnyMessage[][] = []
  const initialized: InitializeRequest[] = []
  const requests: ReadTextFileRequest[] = []
  const contents: string[] = []
  const calls: { cwd: string; resumeId?: string }[] = []
  const loads: string[] = []
  const closedBeforeCall: number[] = []
  const state = { reads: 0, closed: 0 }
  const run = Effect.runPromiseWith(yield* Effect.context())
  const adapter = ClaudeCodeAcpAdapter.makeClaudeCodeAcpAdapter((input) =>
    Effect.sync(() => {
      const index = calls.length
      const control = controls[index]
      if (!control) throw new Error("The ACP fixture has no control for this invocation")
      closedBeforeCall.push(state.closed)
      calls.push({ cwd: input.cwd, ...(input.resumeId ? { resumeId: input.resumeId } : {}) })
      const sent: AnyMessage[] = []
      const received: AnyMessage[] = []
      outgoing.push(sent)
      incoming.push(received)
      const c2a = new TransformStream<AnyMessage, AnyMessage>({
        transform: (frame, controller) => {
          sent.push(frame)
          controller.enqueue(frame)
        },
      })
      const a2c = new TransformStream<AnyMessage, AnyMessage>({
        transform: (frame, controller) => {
          received.push(frame)
          controller.enqueue(frame)
        },
      })
      const clientStream: AcpStream = { writable: c2a.writable, readable: a2c.readable }
      const agentStream: AcpStream = { writable: a2c.writable, readable: c2a.readable }
      const server = new AgentSideConnection(
        (conn) => ({
          initialize: async (params) => {
            initialized.push(params)
            return { protocolVersion: 1, agentCapabilities: { loadSession: true } }
          },
          newSession: async () => ({ sessionId: "acp-session-1" }),
          loadSession: async (params) => {
            loads.push(params.sessionId)
            await conn.sessionUpdate({
              sessionId: params.sessionId,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD_LOAD_HISTORY" } },
            })
            return {}
          },
          cancel: async () => {},
          authenticate: async () => {},
          prompt: async (params) => {
            try {
              await run(Deferred.succeed(control.started, undefined))
              const read = {
                sessionId: params.sessionId,
                path: readPath,
                ...(requestLine !== undefined ? { line: requestLine } : index === 1 ? { line: 2, limit: 1 } : {}),
              }
              requests.push(read)
              const content = await conn.readTextFile(read)
              state.reads += 1
              contents.push(content.content)
              await run(Deferred.succeed(control.afterRead, undefined))
              await run(Deferred.await(control.resultGate))
              await conn.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: outputs[index] },
                  ...(index === 0 ? { messageId: "11111111-1111-4111-8111-111111111111" } : {}),
                },
              })
              return {
                stopReason: "end_turn",
                ...(index === 0 ? { userMessageId: "22222222-2222-4222-8222-222222222222" } : {}),
              }
            } finally {
              await run(Deferred.succeed(control.promptEnded, undefined))
            }
          },
        }),
        agentStream,
      )
      const client = AcpClientConnection.makeClientConnection(clientStream, input)
      return {
        ...client,
        close: async () => {
          await client.close()
          await server.closed
          state.closed += 1
          await run(Deferred.succeed(control.closed, undefined))
        },
      }
    }),
  )
  const previous = CliAdapter.getCliAdapter("claude-code")
  CliAdapter.registerCliAdapter("claude-code", adapter)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => CliAdapter.registerCliAdapter("claude-code", previous ?? ClaudeCodeSdkAdapter.adapter)),
  )
  yield* fixture.sessions.setPermissions({
    sessionID: fixture.root.id,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  return {
    ...fixture,
    local,
    permission,
    adapter,
    readPath,
    fileText,
    controls,
    outputs,
    outgoing,
    incoming,
    initialized,
    requests,
    contents,
    calls,
    loads,
    closedBeforeCall,
    state,
    tasks: yield* SessionTask.Service,
    kv: yield* KV.Service,
    jobs: yield* Job.Service,
    delegations: yield* DelegationService.Service,
    execution: yield* DelegationExecution.Service,
    database: yield* Database.Service,
  }
})

effectTest.live(
  "MC06 ACP formal foreground and same-SID successor keep independent Tasks, original wire IDs and full parent Read results",
  () =>
    Effect.gen(function* () {
      const f = yield* acpTaskSetup()
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "ask" },
        ],
      })
      const receipts: DelegationReceipt.Acp[] = []
      const bindings: DelegationReceipt.Binding[] = []
      for (const index of [0, 1]) {
        const id = `mc06-acp-formal-${index}`
        yield* f.llm.push(
          TestLLM.tool(id, TaskTool.name, {
            description: `Read the original ACP input ${index}`,
            prompt: "Read the parent file and preserve the complete response.",
            execution_type: "external-cli",
            cli_target: "claude-code",
            subagent_type: "claude-code",
            attended: true,
            ...(index === 1
              ? {
                  command: "append",
                  delegation_id: receipts[0].delegationID,
                  participant_id: receipts[0].participantID,
                }
              : {}),
          }),
          TestLLM.text(`Consumed ACP ${index} completely.`, `${id}-parent`),
        )
        yield* f.sessions.prompt({ sessionID: f.root.id, text: `Run the independent ACP Task ${index}.` })
        yield* awaitWithTimeout(Deferred.await(f.controls[index].started), "The formal ACP prompt did not start")
        const request = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "The ACP parent Read did not ask",
        )
        const call = yield* mc07Result(f, id)
        expect(request).toMatchObject({
          action: "read",
          resources: ["acp-read.txt"],
          sessionID: f.root.id,
          source: { type: "tool", messageID: call.assistant.id, id },
        })
        expect(f.state.reads).toBe(index)
        expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
        yield* f.permission.reply({ requestID: request.id, reply: "once" })
        yield* awaitWithTimeout(
          Deferred.await(f.controls[index].afterRead),
          "The ACP parent did not return its authorized file content",
        )
        yield* Deferred.succeed(f.controls[index].resultGate, undefined)
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The formal ACP parent did not settle")
        const result = yield* mc07Consumed(f, id)
        if (result.tool.state.status !== "completed")
          return yield* Effect.die(new Error("The formal ACP Task did not complete"))
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Acp)(result.tool.state.metadata?.externalReceipt)
        const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
          yield* f.kv.get(DelegationReceipt.key(receipt)),
        )
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.AcpOutput))(result.text)
        const wire = f.outgoing[index].find((frame) => "method" in frame && frame.method === "session/prompt")
        if (
          !wire ||
          !("method" in wire) ||
          !("id" in wire) ||
          (typeof wire.id !== "number" && typeof wire.id !== "string")
        )
          return yield* Effect.die(new Error("The formal ACP Task has no actual wire request"))
        expect(f.incoming[index].some((frame) => !("method" in frame) && frame.id === wire.id)).toBe(true)
        expect(receipt.acpPrompt.requestID).toBe(wire.id)
        expect(receipt.acpPrompt.sessionID).toBe("acp-session-1")
        expect(receipt.externalTurnID).toBeUndefined()
        expect(binding.sdkMessage).toBeUndefined()
        expect(binding.transport).toBe("acp")
        expect(binding.command).toBe("mc06-controlled-peer")
        expect(binding.source).toEqual(receipt.source)
        expect(binding.settlement).toEqual({ status: "completed", text: f.outputs[index] })
        expect(output.output).toBe(f.outputs[index])
        expect(output.output.length).toBeGreaterThan(50 * 1024)
        expect(output.output.charCodeAt(4095)).toBe(0xd83d)
        expect(result.tool.state.metadata?.truncated).toBe(false)
        expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
        expect(DelegationReceipt.matchesOutput(binding, output)).toBe(true)
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toMatchObject({
          status: "completed",
          revision: binding.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.outputs[index]),
        })
        expect(f.initialized[index]?.clientCapabilities?.fs?.readTextFile).toBe(true)
        expect(yield* sdkEarlyEvents(f, binding).metas).toHaveLength(1)
        receipts.push(receipt)
        bindings.push(binding)
      }
      expect(f.contents).toEqual([f.fileText, "  第二行🙂  "])
      expect(f.loads).toEqual(["acp-session-1"])
      expect(f.calls).toEqual([
        { cwd: f.root.location.directory },
        { cwd: f.root.location.directory, resumeId: "acp-session-1" },
      ])
      expect(f.closedBeforeCall).toEqual([0, 1])
      expect(f.state).toEqual({ reads: 2, closed: 2 })
      expect(receipts[0].acpPrompt.requestID).toBe(receipts[1].acpPrompt.requestID)
      expect(receipts[0].source.id).not.toBe(receipts[1].source.id)
      expect(bindings[0].parentTaskID).not.toBe(bindings[1].parentTaskID)
      expect(DelegationReceipt.key(bindings[0])).not.toBe(DelegationReceipt.key(bindings[1]))
      expect(receipts[0].acpPrompt.agentMessageIDs).toEqual(["11111111-1111-4111-8111-111111111111"])
      expect(receipts[1].acpPrompt.agentMessageIDs).toBeUndefined()
      expect(receipts[1].acpPrompt.userMessageID).toBeUndefined()
      expect(
        Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(DelegationReceipt.key(bindings[0]))),
      ).toEqual(bindings[0])
      expect(DelegationReceipt.matches(bindings[1], receipts[0])).toBe(false)
      const wrongType = new DelegationReceipt.Binding({
        ...bindings[0],
        acpPrompt: new DelegationReceipt.AcpPrompt({
          ...receipts[0].acpPrompt,
          requestID: String(receipts[0].acpPrompt.requestID),
        }),
      })
      expect(DelegationReceipt.matches(wrongType, receipts[0])).toBe(false)
      const output = Schema.decodeUnknownSync(DelegationReceipt.AcpOutput)(
        DelegationReceipt.response(receipts[0], bindings[0].parentTaskID, { status: "completed", text: f.outputs[0] })
          .output,
      )
      expect(DelegationReceipt.matchesOutput(wrongType, output)).toBe(false)
      const zero = new DelegationReceipt.Binding({
        ...bindings[0],
        acpPrompt: new DelegationReceipt.AcpPrompt({ ...receipts[0].acpPrompt, requestID: 0 }),
      })
      const zeroReceipt = DelegationReceipt.fromBinding(zero)
      if (!(zeroReceipt instanceof DelegationReceipt.Acp))
        return yield* Effect.die(new Error("ACP request ID zero was lost by its codec"))
      expect(DelegationReceipt.matches(zero, zeroReceipt)).toBe(true)
    }),
)

for (const invalidRead of ["denied", "zero"] as const)
  effectTest.live(`MC06 ACP formal ${invalidRead} file read returns no content or successful receipt`, () =>
    Effect.gen(function* () {
      const f = yield* acpTaskSetup(invalidRead === "zero" ? 0 : undefined)
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: invalidRead === "zero" ? "ask" : "deny" },
        ],
      })
      const result = yield* sdkTask(f, `mc06-acp-formal-read-${invalidRead}`, {
        description: "Reject the unavailable ACP read",
        prompt: "Read the original parent path.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        attended: true,
      })
      expect(result.tool.state.status).toBe("error")
      expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(f.state).toEqual({ reads: 0, closed: 1 })
      expect(f.contents).toEqual([])
      expect(f.calls).toHaveLength(1)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect((yield* f.tasks.get(f.root.id)).map((task) => task.status)).toEqual(["failed"])
    }),
  )

effectTest.live(
  "MC06 ACP formal unavailable controls fail before Task admission even when background is disabled",
  () =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
              return
            }
            process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
          }),
      )
      const f = yield* acpTaskSetup()
      const inputs = [{ background: true }, { command: "steer" as const }, { intent: "review" as const }]
      for (const [index, input] of inputs.entries()) {
        const result = yield* sdkTask(f, `mc06-acp-formal-unavailable-${index}`, {
          description: "Check the selected ACP capability",
          prompt: "Do not fall back to another transport.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          ...input,
        })
        expect(result.tool.state.status).toBe("error")
        expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      }
      expect(f.calls).toEqual([])
      expect(f.initialized).toEqual([])
      expect(f.state).toEqual({ reads: 0, closed: 0 })
      expect(yield* f.tasks.get(f.root.id)).toEqual([])
      expect(yield* f.delegations.list({ parentSessionID: f.root.id })).toEqual([])
    }),
)

for (const boundary of ["read", "terminal"] as const)
  effectTest.live(
    `MC06 ACP formal ${boundary} cancellation releases the parent Permission and preserves the original cancelled Task`,
    () =>
      Effect.gen(function* () {
        const f = yield* acpTaskSetup()
        if (boundary === "read")
          yield* f.sessions.setPermissions({
            sessionID: f.root.id,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "ask" },
            ],
          })
        const id = `mc06-acp-formal-cancel-${boundary}`
        yield* f.llm.push(
          TestLLM.tool(id, TaskTool.name, {
            description: "Cancel the owning ACP invocation",
            prompt: "Read the parent input before the terminal gate.",
            execution_type: "external-cli",
            cli_target: "claude-code",
            subagent_type: "claude-code",
            attended: true,
          }),
          TestLLM.text("Consumed the cancelled ACP Task.", `${id}-parent`),
        )
        yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start the cancellable ACP Task." })
        yield* awaitWithTimeout(Deferred.await(f.controls[0].started), "The cancellable ACP prompt did not start")
        if (boundary === "read")
          yield* pollWithTimeout(
            f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
            "The ACP file read did not reach its parent Permission",
          )
        if (boundary === "terminal")
          yield* awaitWithTimeout(Deferred.await(f.controls[0].afterRead), "The ACP authorized read did not finish")
        const original = (yield* f.delegations.list({ parentSessionID: f.root.id }))[0]
        const participant = original && [...original.participants.values()][0]
        if (!original || !participant)
          return yield* Effect.die(new Error("The ACP invocation has no original participant"))
        yield* awaitWithTimeout(
          f.execution.interrupt({ delegationID: original.delegation.id, participantID: participant.id }),
          "ACP cancellation retained its owning lock",
          "5 seconds",
        )
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The cancelled ACP waiter did not release its parent")
        const before = yield* Effect.all({
          tasks: f.tasks.get(f.root.id),
          state: f.delegations.foldState(original.delegation.id),
        })
        expect(before.tasks.map((task) => task.status)).toEqual(["cancelled"])
        expect([...(before.state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
        expect(f.state).toEqual({ reads: boundary === "terminal" ? 1 : 0, closed: 1 })
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
        const binding = (yield* f.kv.scan({ prefix: `delegation:external:${original.delegation.id}:` })).entries.map(
          (entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value),
        )[0]
        if (!binding) return yield* Effect.die(new Error("The cancelled ACP Task has no original Binding"))
        expect((yield* f.jobs.wait({ id: DelegationReceipt.key(binding) })).timedOut).toBe(false)
        yield* Deferred.succeed(f.controls[0].resultGate, undefined)
        yield* awaitWithTimeout(Deferred.await(f.controls[0].promptEnded), "The late ACP handler did not end")
        expect(yield* f.tasks.get(f.root.id)).toEqual(before.tasks)
        expect(yield* f.delegations.foldState(original.delegation.id)).toEqual(before.state)
        expect(yield* sdkEarlyEvents(f, binding).successes).toEqual([])
        expect(yield* sdkEarlyEvents(f, binding).metas).toEqual([])
      }),
  )

const acpCheckpoint = Effect.fnUntraced(function* (phase: "cas" | "delivery") {
  const f = yield* acpTaskSetup()
  const id = `mc06-acp-formal-checkpoint-${phase}`
  yield* f.llm.push(
    TestLLM.tool(id, TaskTool.name, {
      description: "Retain the complete ACP result before local settlement",
      prompt: "Read the original path and return the full result.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
    }),
    TestLLM.text("Consumed the original complete ACP checkpoint.", `${id}-parent`),
  )
  yield* f.sessions.prompt({ sessionID: f.root.id, text: "Capture the actual ACP local persistence checkpoint." })
  yield* awaitWithTimeout(Deferred.await(f.controls[0].afterRead), "The checkpoint ACP parent read did not finish")
  const binding = (yield* f.kv.scan({ prefix: "delegation:external:" })).entries
    .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
    .find((entry) => entry.source.id === id)
  if (!binding) return yield* Effect.die(new Error("The ACP checkpoint has no original admitted Binding"))
  const key = DelegationReceipt.key(binding)
  const entered = yield* Deferred.make<void>()
  const gate = yield* Deferred.make<void>()
  const patch = f.tasks.patch
  const recordDelivery = f.delegations.recordDelivery
  const held =
    phase === "cas"
      ? yield* Effect.acquireRelease(
          Effect.sync(() =>
            spyOn(f.tasks, "patch").mockImplementation((input, options) => {
              const result = patch(input, options)
              if (
                input.sessionID !== binding.parentSessionID ||
                input.id !== binding.parentTaskID ||
                input.expectedRevision !== binding.parentTaskRevision ||
                input.status !== "completed"
              )
                return result
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(result),
              )
            }),
          ),
          (value) => Effect.sync(() => value.mockRestore()),
        )
      : yield* Effect.acquireRelease(
          Effect.sync(() =>
            spyOn(f.delegations, "recordDelivery").mockImplementation((input) => {
              const result = recordDelivery(input)
              if (
                input.status !== "completed" ||
                DelegationReceipt.key(input) !== key ||
                input.attempt !== binding.attempt
              )
                return result
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(result),
              )
            }),
          ),
          (value) => Effect.sync(() => value.mockRestore()),
        )
  yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.asVoid))
  yield* Deferred.succeed(f.controls[0].resultGate, undefined)
  yield* awaitWithTimeout(Deferred.await(entered), "The ACP result did not reach its actual local checkpoint")
  const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(key))
  const receipt = Schema.decodeUnknownSync(DelegationReceipt.Acp)(DelegationReceipt.fromBinding(checkpoint))
  expect(checkpoint.settlement).toEqual({ status: "completed", text: f.outputs[0] })
  expect(checkpoint.source).toEqual(binding.source)
  expect((yield* mc07Result(f, id)).tool.state.status).toBe("running")
  expect(f.state).toEqual({ reads: 1, closed: 1 })
  return {
    ...f,
    id,
    key,
    binding: checkpoint,
    receipt,
    release: Deferred.succeed(gate, undefined).pipe(Effect.andThen(Effect.sync(() => held.mockRestore()))),
  }
})

for (const phase of ["cas", "delivery"] as const)
  effectTest.live(
    `MC06 ACP formal cold ${phase} checkpoint settles the original Task and full Tool/Meta result once without execution`,
    () =>
      Effect.gen(function* () {
        const f = yield* acpCheckpoint(phase)
        const task = (yield* f.tasks.get(f.root.id)).find((task) => task.id === f.binding.parentTaskID)
        expect(task).toMatchObject({
          status: phase === "cas" ? "in_progress" : "completed",
          revision: f.binding.parentTaskRevision + (phase === "cas" ? 0 : 1),
        })
        expect(yield* sdkEarlyEvents(f, f.binding).deliveries).toEqual([])
        expect(yield* sdkEarlyEvents(f, f.binding).successes).toEqual([])
        const snapshot = `${(yield* tmpdirScoped()).path}/acp-${phase}.sqlite`
        yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
        yield* f.release
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original ACP checkpoint did not release")
        const original = yield* mc07Consumed(f, f.id)
        const opened = yield* sdkEarlyOpen(f, snapshot)
        const events = sdkEarlyEvents(opened, f.binding)
        const deliveryKey = DelegationFold.deliveryKey(
          f.binding.turnID,
          f.binding.participantID,
          f.binding.deliveryOrigin,
          f.binding.senderParticipantID,
        )
        expect(opened.database).not.toBe(f.database)
        expect(opened.execution).not.toBe(f.execution)
        expect(opened.tasks).not.toBe(f.tasks)
        expect(opened.delegations).not.toBe(f.delegations)
        expect(opened.jobs).not.toBe(f.jobs)
        expect(opened.runs).not.toBe(f.runs)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* opened.kv.get(f.key))).toEqual(f.binding)
        expect((yield* opened.tasks.get(opened.root.id)).find((value) => value.id === f.binding.parentTaskID)).toEqual(
          task,
        )
        expect(
          (yield* opened.delegations.foldState(f.binding.delegationID))?.deliveries.get(deliveryKey),
        ).toMatchObject({ status: "running", attempt: f.binding.attempt })
        const recovered = yield* opened.execution.recoverPending
        expect(recovered.scanAvailable).toBe(true)
        expect(yield* opened.execution.wait(f.receipt)).toEqual({ status: "completed", text: f.outputs[0] })
        expect(
          (yield* opened.delegations.foldState(f.binding.delegationID))?.deliveries.get(deliveryKey),
        ).toMatchObject({ status: "completed", attempt: f.binding.attempt })
        expect(
          (yield* opened.tasks.get(opened.root.id)).find((task) => task.id === f.binding.parentTaskID),
        ).toMatchObject({
          status: "completed",
          revision: f.binding.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.outputs[0]),
        })
        const completed = yield* mc07Result(opened, f.id)
        expect(completed.tool.state.status).toBe("completed")
        if (completed.tool.state.status !== "completed")
          return yield* Effect.die(new Error("The cold ACP Task did not produce its original Tool result"))
        expect(Schema.decodeUnknownSync(DelegationReceipt.Acp)(completed.tool.state.metadata?.externalReceipt)).toEqual(
          f.receipt,
        )
        expect(yield* events.deliveries).toHaveLength(1)
        expect(yield* events.successes).toHaveLength(1)
        expect(yield* events.metas).toHaveLength(1)
        expect(yield* opened.jobs.get(f.key)).toBeUndefined()
        expect(yield* opened.runs.isActive(opened.root.id)).toBe(false)
        const before = yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.key),
          deliveries: events.deliveries,
          successes: events.successes,
          metas: events.metas,
        })
        yield* opened.execution.recoverPending
        expect(
          yield* Effect.all({
            tasks: opened.tasks.get(opened.root.id),
            binding: opened.kv.get(f.key),
            deliveries: events.deliveries,
            successes: events.successes,
            metas: events.metas,
          }),
        ).toEqual(before)
        yield* opened.llm.push(TestLLM.text("Consumed the recovered full ACP result.", `${f.id}-cold-parent`))
        yield* opened.sessions.resume(opened.root.id)
        yield* awaitWithTimeout(opened.runs.awaitIdle(opened.root.id), "The cold ACP parent did not consume its result")
        expect((yield* mc07Consumed(opened, f.id)).text).toBe(original.text)
        expect(f.calls).toHaveLength(1)
        expect(f.initialized).toHaveLength(1)
        expect(f.loads).toEqual([])
        expect(f.state).toEqual({ reads: 1, closed: 1 })
        yield* opened.execution.recoverPending
        expect(yield* events.deliveries).toHaveLength(1)
        expect(yield* events.successes).toHaveLength(1)
        expect(yield* events.metas).toHaveLength(1)
      }),
  )

effectTest.live("MC06 ACP formal CAS competition preserves the edited Task and its original complete checkpoint", () =>
  Effect.gen(function* () {
    const f = yield* acpCheckpoint("cas")
    const changed = yield* f.tasks.updateTask({
      sessionID: f.root.id,
      id: f.binding.parentTaskID,
      expectedRevision: f.binding.parentTaskRevision,
      status: "in_progress",
      content: "The owner edited this ACP Task before its original CAS.",
    })
    expect(changed).toMatchObject({ revision: f.binding.parentTaskRevision + 1, status: "in_progress" })
    const events = sdkEarlyEvents(f, f.binding)
    const before = yield* Effect.all({
      tasks: f.tasks.get(f.root.id),
      binding: f.kv.get(f.key),
      state: f.delegations.foldState(f.binding.delegationID),
    })
    const snapshot = `${(yield* tmpdirScoped()).path}/acp-cas-conflict.sqlite`
    yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
    yield* f.release
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The ACP CAS loser did not release its waiter")
    expect((yield* mc07Result(f, f.id)).tool.state.status).toBe("error")
    expect(
      yield* Effect.all({
        tasks: f.tasks.get(f.root.id),
        binding: f.kv.get(f.key),
        state: f.delegations.foldState(f.binding.delegationID),
      }),
    ).toEqual(before)
    expect(yield* events.deliveries).toEqual([])
    expect(yield* events.successes).toEqual([])
    expect(yield* events.metas).toEqual([])
    const opened = yield* sdkEarlyOpen(f, snapshot)
    const coldEvents = sdkEarlyEvents(opened, f.binding)
    yield* opened.execution.recoverPending
    yield* opened.execution.recoverPending
    expect(
      yield* Effect.all({
        tasks: opened.tasks.get(opened.root.id),
        binding: opened.kv.get(f.key),
        state: opened.delegations.foldState(f.binding.delegationID),
      }),
    ).toEqual(before)
    expect(yield* coldEvents.deliveries).toEqual([])
    expect(yield* coldEvents.successes).toEqual([])
    expect(yield* coldEvents.metas).toEqual([])
    expect(f.calls).toHaveLength(1)
    expect(f.state).toEqual({ reads: 1, closed: 1 })
  }),
)

effectTest.live(
  "MC06 ACP formal raw cold clones keep missing prompt identity, changed SID and wrong tool source unconsumed",
  () =>
    Effect.gen(function* () {
      const f = yield* acpCheckpoint("cas")
      const deliveryKey = DelegationFold.deliveryKey(
        f.binding.turnID,
        f.binding.participantID,
        f.binding.deliveryOrigin,
        f.binding.senderParticipantID,
      )
      for (const variant of ["missing", "sid", "source"] as const) {
        const snapshot = `${(yield* tmpdirScoped()).path}/acp-${variant}.sqlite`
        yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
        const opened = yield* sdkEarlyOpen(f, snapshot)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* opened.kv.get(f.key))).toEqual(f.binding)
        expect(
          (yield* opened.tasks.get(opened.root.id)).find((task) => task.id === f.binding.parentTaskID),
        ).toMatchObject({ status: "in_progress", revision: f.binding.parentTaskRevision })
        expect(
          (yield* opened.delegations.foldState(f.binding.delegationID))?.deliveries.get(deliveryKey),
        ).toMatchObject({ status: "running", attempt: f.binding.attempt })
        expect((yield* mc07Result(opened, f.id)).tool.state.status).toBe("running")
        expect(yield* opened.runs.isActive(opened.root.id)).toBe(false)
        expect(yield* opened.jobs.get(f.key)).toBeUndefined()
        const changed = {
          ...Schema.encodeSync(DelegationReceipt.Binding)(
            new DelegationReceipt.Binding({
              ...f.binding,
              ...(variant === "sid"
                ? {
                    acpPrompt: new DelegationReceipt.AcpPrompt({
                      ...f.receipt.acpPrompt,
                      sessionID: "acp-other-session",
                    }),
                  }
                : variant === "source"
                  ? { source: { ...f.binding.source, id: "other-task-source" } }
                  : {}),
            }),
          ),
        }
        if (variant === "missing") delete changed.acpPrompt
        yield* opened.kv.set(f.key, changed)
        const before = yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.key),
          state: opened.delegations.foldState(f.binding.delegationID),
          tool: mc07Result(opened, f.id),
        })
        yield* opened.execution.recoverPending
        yield* opened.execution.recoverPending
        expect(
          yield* Effect.all({
            tasks: opened.tasks.get(opened.root.id),
            binding: opened.kv.get(f.key),
            state: opened.delegations.foldState(f.binding.delegationID),
            tool: mc07Result(opened, f.id),
          }),
        ).toEqual(before)
        expect(yield* sdkEarlyEvents(opened, f.binding).deliveries).toEqual([])
        expect(yield* sdkEarlyEvents(opened, f.binding).successes).toEqual([])
        expect(yield* sdkEarlyEvents(opened, f.binding).metas).toEqual([])
        expect(yield* opened.jobs.get(f.key)).toBeUndefined()
      }
      yield* f.release
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The original ACP checkpoint did not finish after the cold negative cases",
      )
      expect(f.calls).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1 })
    }),
)

effectTest.live(
  "MC06 ACP formal cancelling append during predecessor cleanup releases only its new Task and waiter",
  () =>
    Effect.gen(function* () {
      const f = yield* acpTaskSetup()
      const id = "mc06-acp-formal-cleanup-original"
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Complete the original ACP Task",
          prompt: "Read the original file and retain the full response.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
        }),
        TestLLM.text("Consumed the original complete ACP result.", `${id}-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Keep the original Task while another caller appends." })
      yield* awaitWithTimeout(Deferred.await(f.controls[0].afterRead), "The original cleanup ACP read did not finish")
      const admitted = (yield* f.kv.scan({ prefix: "delegation:external:" })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find((entry) => entry.source.id === id)
      if (!admitted) return yield* Effect.die(new Error("The original cleanup Task has no Binding"))
      const key = DelegationReceipt.key(admitted)
      const originalWait = yield* Deferred.make<void>()
      const appendWait = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const seen = { waits: 0 }
      const wait = f.jobs.wait
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(f.jobs, "wait").mockImplementation((input) =>
            wait(input).pipe(
              Effect.tap(() => {
                if (input.id !== key) return Effect.void
                seen.waits += 1
                return Deferred.succeed(seen.waits === 1 ? originalWait : appendWait, undefined).pipe(
                  Effect.andThen(Deferred.await(gate)),
                )
              }),
            ),
          ),
        ),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.asVoid))
      yield* Deferred.succeed(f.controls[0].resultGate, undefined)
      yield* awaitWithTimeout(
        Deferred.await(originalWait),
        "The original waiter did not reach its completed Job checkpoint",
      )
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(key))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Acp)(DelegationReceipt.fromBinding(binding))
      const original = yield* mc07Result(f, id)
      const before = {
        binding: yield* f.kv.get(key),
        task: (yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID),
      }
      expect(before.task).toMatchObject({ status: "completed", revision: binding.parentTaskRevision + 1 })
      expect((yield* f.jobs.get(key))?.status).toBe("completed")
      const appendedID = "mc06-acp-formal-cleanup-append"
      const input = {
        description: "Append with an independent Task source",
        prompt: "Wait for the predecessor cleanup before reading again.",
        execution_type: "external-cli" as const,
        cli_target: "claude-code",
        subagent_type: "claude-code",
        command: "append" as const,
        delegation_id: receipt.delegationID,
        participant_id: receipt.participantID,
      }
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID: f.root.id,
        assistantMessageID: original.assistant.id,
        id: appendedID,
        name: TaskTool.name,
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID: f.root.id,
        assistantMessageID: original.assistant.id,
        id: appendedID,
        input,
        executed: false,
      })
      const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
      const scope = yield* Effect.scope
      const appended = yield* executeTool(registry, {
        sessionID: f.root.id,
        agent: original.assistant.agent,
        messageID: original.assistant.id,
        call: { type: "tool-call", id: appendedID, name: TaskTool.name, input },
      }).pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(appendWait), "The append Job did not wait outside the predecessor's lock")
      expect(f.calls).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1 })
      const newBinding = (yield* f.kv.scan({ prefix: `delegation:external:${receipt.delegationID}:` })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find((entry) => entry.source.id === appendedID)
      if (!newBinding) return yield* Effect.die(new Error("The waiting append has no independent admitted Binding"))
      expect(newBinding.parentTaskID).not.toBe(binding.parentTaskID)
      expect(newBinding.source).toEqual({ type: "tool", messageID: original.assistant.id, id: appendedID })
      const stopped = yield* awaitWithTimeout(
        Fiber.interrupt(appended).pipe(Effect.andThen(Fiber.await(appended))),
        "Cancelling the append retained its predecessor cleanup lock",
        "5 seconds",
      )
      expect(Exit.isFailure(stopped)).toBe(true)
      expect(yield* Deferred.isDone(gate)).toBe(false)
      expect(yield* f.kv.get(key)).toEqual(before.binding)
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toEqual(before.task)
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === newBinding.parentTaskID)?.status).toBe(
        "cancelled",
      )
      expect((yield* f.jobs.get(key))?.status).toBe("completed")
      expect(
        DelegationReceipt.matches(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(key)), receipt),
      ).toBe(true)
      yield* bus.publish(SessionEvent.Tool.Failed, {
        sessionID: f.root.id,
        assistantMessageID: original.assistant.id,
        id: appendedID,
        error: { type: "tool.execution", message: "The append caller cancelled its cleanup wait." },
        executed: false,
      })
      yield* Deferred.succeed(gate, undefined)
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The original completed ACP parent did not finish after append cancellation",
      )
      const consumed = yield* mc07Consumed(f, id)
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.AcpOutput))(consumed.text).output).toBe(
        f.outputs[0],
      )
      expect(yield* sdkEarlyEvents(f, binding).metas).toHaveLength(1)
      expect(yield* sdkEarlyEvents(f, newBinding).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, newBinding).metas).toEqual([])
      expect(f.calls).toHaveLength(1)
    }),
)

for (const toolName of ["Read", "Grep", "Glob"] as const)
  for (const allowed of [false, true])
    effectTest.live(
      `MC06 SDK ${toolName} ${allowed ? "allow" : "deny"} uses the original Task permission and exact result`,
      () =>
        Effect.gen(function* () {
          const f = yield* sdkTaskSetup(toolName)
          yield* f.sessions.setPermissions({
            sessionID: f.root.id,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: toolName.toLowerCase(), resource: "*", effect: allowed ? "ask" : "deny" },
            ],
          })
          const id = `mc06-sdk-${toolName.toLowerCase()}-${allowed}`
          yield* f.llm.push(
            TestLLM.tool(id, TaskTool.name, {
              description: "Analyze the readonly native input",
              prompt: "Read the scoped input and return the complete analysis.",
              execution_type: "external-cli",
              cli_target: "claude-code",
              subagent_type: "claude-code",
              attended: true,
            }),
            TestLLM.text("Consumed the exact SDK result.", `${id}-parent`),
          )
          yield* f.sessions.prompt({ sessionID: f.root.id, text: "Run one readonly SDK Task." })
          yield* awaitWithTimeout(Deferred.await(f.nativeStarted), "Configured SDK Task did not start", "10 seconds")
          const permission = f.permission
          if (allowed) {
            const request = yield* pollWithTimeout(
              permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
              "SDK tool did not ask through its parent permission",
            )
            const call = yield* mc07Result(f, id)
            expect(request).toMatchObject({
              action: toolName.toLowerCase(),
              source: { type: "tool", id, messageID: call.assistant.id },
              sessionID: f.root.id,
            })
            expect(yield* permission.forSession(f.root.id)).toHaveLength(1)
            expect(f.state.reads).toBe(0)
            yield* permission.reply({ requestID: request.id, reply: "once" })
          }
          yield* awaitWithTimeout(Deferred.await(f.afterRead), "SDK permission bridge did not settle")
          yield* Deferred.succeed(f.resultGate, undefined)
          yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK result retained the Delegation lock", "10 seconds")
          const result = yield* mc07Consumed(f, id)
          if (result.tool.state.status !== "completed")
            return yield* Effect.die(
              new Error(
                result.tool.state.status === "error"
                  ? result.tool.state.error.message
                  : "SDK Task has no completed result",
              ),
            )
          expect(result.tool.state.status).toBe("completed")
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text)
          expect(output.output).toBe(allowed ? f.text : "SDK_READ_DENIED")
          expect(output.sdkMessage).toMatchObject({ sessionID: "sdk-session-1", messageID: "sdk-result-1" })
          expect(output).not.toHaveProperty("externalTurnID")
          expect(f.state).toEqual({ reads: allowed ? 1 : 0, closed: 1, hookCalls: 1 })
          expect(f.queries).toHaveLength(1)
          expect(f.queries[0]?.options).toMatchObject({
            cwd: f.root.location.directory,
            tools: ["Read", "Grep", "Glob"],
            settingSources: [],
            strictMcpConfig: true,
            mcpServers: {},
          })
          expect(f.queries[0]?.options?.canUseTool).toBeUndefined()
          expect(f.queries[0]?.options?.abortController?.signal.aborted).toBe(true)
          const tasks = yield* SessionTask.Service
          expect((yield* tasks.get(f.root.id)).find((task) => task.id === output.parentTaskID)?.status).toBe(
            "completed",
          )
          expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
          const db = yield* Database.Service
          const steps = yield* db.db
            .select()
            .from(MetaAgentStepTable)
            .where(
              and(
                eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
                eq(MetaAgentStepTable.tool_call_id, id),
                eq(MetaAgentStepTable.type, "receipt"),
              ),
            )
          expect(steps).toHaveLength(1)
          expect(steps[0]?.provenance).toMatchObject({
            externalReceipt: {
              transport: "sdk",
              sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
            },
          })
        }),
    )

effectTest.live("MC06 SDK missing result identity fails its admitted Task without a successful receipt", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup("Read", false)
    yield* Deferred.succeed(f.resultGate, undefined)
    const result = yield* sdkTask(f, "mc06-sdk-missing-identity", {
      description: "Read with missing SDK identity",
      prompt: "Analyze the native input.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
    })
    expect(result.tool.state.status).toBe("error")
    expect(f.queries).toHaveLength(1)
    expect(f.state.closed).toBe(1)
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["failed"])
    const delegations = yield* DelegationService.Service
    const state = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
    expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["failed"])
    expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
  }),
)

effectTest.live("MC06 SDK cancelled admission preserves the Task claim and never starts a query", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup()
    yield* Deferred.succeed(f.resultGate, undefined)
    const bus = yield* Bus.Service
    const admitted = yield* Deferred.make<typeof DelegationEvent.DeliveryAdmittedData.Type>()
    const release = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type !== DelegationEvent.DeliveryAdmitted.type) return Effect.void
      return Deferred.succeed(
        admitted,
        Schema.decodeUnknownSync(DelegationEvent.DeliveryAdmittedData)(event.data),
      ).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe)))
    const id = "mc06-sdk-cancel-admission"
    yield* f.llm.push(
      TestLLM.tool(id, TaskTool.name, {
        description: "Cancel the admitted SDK Task",
        prompt: "Analyze the native input.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
      }),
      TestLLM.text("Consumed the cancelled claim.", `${id}-parent`),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Cancel before the SDK Job starts." })
    const event = yield* awaitWithTimeout(Deferred.await(admitted), "SDK delivery was not admitted")
    const tasks = yield* SessionTask.Service
    const task = (yield* tasks.get(f.root.id))[0]
    if (!task) return yield* Effect.die(new Error("SDK admission has no Task claim"))
    const cancelled = yield* tasks.patch({
      sessionID: f.root.id,
      id: task.id,
      expectedRevision: task.revision,
      expect: ["in_progress"],
      status: "cancelled",
    })
    if (!cancelled) return yield* Effect.die(new Error("SDK admission Task cancellation lost its claim"))
    yield* Deferred.succeed(release, undefined)
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Cancelled SDK admission did not settle", "10 seconds")
    expect(yield* tasks.get(f.root.id)).toEqual([cancelled])
    const jobs = yield* Job.Service
    expect(yield* jobs.get(DelegationReceipt.key(event))).toBeUndefined()
    expect(f.queries).toEqual([])
    expect(f.state).toEqual({ reads: 0, closed: 0, hookCalls: 0 })
    const result = yield* mc07Consumed(f, id)
    expect(result.tool.state.status).toBe("error")
    if (result.tool.state.status !== "error")
      return yield* Effect.die(new Error("Cancelled SDK admission did not fail its Tool"))
    expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
    const delegations = yield* DelegationService.Service
    const state = yield* delegations.foldState(event.delegationID)
    expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["failed"])
  }),
)

effectTest.live("MC06 SDK cancellation at committed Started cancels its Job before query", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup()
    const bus = yield* Bus.Service
    const started = yield* Deferred.make<typeof DelegationEvent.DeliveryStartedData.Type>()
    const release = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type !== DelegationEvent.DeliveryStarted.type) return Effect.void
      return Deferred.succeed(started, Schema.decodeUnknownSync(DelegationEvent.DeliveryStartedData)(event.data)).pipe(
        Effect.andThen(Deferred.await(release)),
      )
    })
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe)))
    yield* f.llm.push(
      TestLLM.tool("mc06-sdk-cancel-started", TaskTool.name, {
        description: "Cancel before query",
        prompt: "Analyze the native input.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
      }),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Cancel exactly at SDK Job handoff." })
    const event = yield* awaitWithTimeout(Deferred.await(started), "SDK Started was not committed")
    const jobs = yield* Job.Service
    expect((yield* jobs.get(DelegationReceipt.key(event)))?.status).toBe("running")
    yield* f.runs.interrupt(f.root.id)
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Cancelled SDK handoff did not settle", "10 seconds")
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["cancelled"])
    const delegations = yield* DelegationService.Service
    const state = yield* delegations.foldState(event.delegationID)
    expect([...(state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
    expect((yield* jobs.get(DelegationReceipt.key(event)))?.status).not.toBe("running")
    expect(f.queries).toEqual([])
    expect(f.state).toEqual({ reads: 0, closed: 0, hookCalls: 0 })
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
  }),
)

for (const boundary of ["permission", "result"] as const)
  effectTest.live(`MC06 SDK cancellation at ${boundary} releases the Job lock and preserves the terminal outcome`, () =>
    Effect.gen(function* () {
      const f = yield* sdkTaskSetup()
      const permission = f.permission
      if (boundary === "permission")
        yield* f.sessions.setPermissions({
          sessionID: f.root.id,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "ask" },
          ],
        })
      yield* f.llm.push(
        TestLLM.tool(`mc06-sdk-cancel-${boundary}`, TaskTool.name, {
          description: "Cancel the SDK analysis",
          prompt: "Read the input before the terminal result.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          attended: true,
        }),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Begin the cancellable SDK Task." })
      yield* awaitWithTimeout(Deferred.await(f.nativeStarted), "SDK query did not start", "10 seconds")
      if (boundary === "permission")
        yield* pollWithTimeout(
          permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "SDK read did not reach its parent permission",
        )
      if (boundary === "result") yield* awaitWithTimeout(Deferred.await(f.afterRead), "SDK input read did not complete")
      const delegations = yield* DelegationService.Service
      const original = (yield* delegations.list({ parentSessionID: f.root.id }))[0]
      if (!original) return yield* Effect.die(new Error("SDK query has no durable delegation"))
      const participant = [...original.participants.values()][0]
      if (!participant) return yield* Effect.die(new Error("SDK query has no durable participant"))
      const execution = yield* DelegationExecution.Service
      yield* awaitWithTimeout(
        execution.interrupt({ delegationID: original.delegation.id, participantID: participant.id }),
        "SDK cancellation retained its settlement lock",
        "5 seconds",
      )
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "Cancelled SDK Task did not release its parent",
        "10 seconds",
      )
      const tasks = yield* SessionTask.Service
      const before = { tasks: yield* tasks.get(f.root.id), state: yield* delegations.foldState(original.delegation.id) }
      expect(before.tasks.map((task) => task.status)).toEqual(["cancelled"])
      expect([...(before.state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
      expect(f.state.closed).toBe(1)
      expect(f.queries[0]?.options?.abortController?.signal.aborted).toBe(true)
      expect(f.state.reads).toBe(boundary === "result" ? 1 : 0)
      expect(yield* permission.forSession(f.root.id)).toEqual([])
      yield* Deferred.succeed(f.resultGate, undefined)
      yield* awaitWithTimeout(Deferred.await(f.nativeFinished), "The in-flight SDK frame did not complete")
      expect(yield* tasks.get(f.root.id)).toEqual(before.tasks)
      expect(yield* delegations.foldState(original.delegation.id)).toEqual(before.state)
      expect(f.queries).toHaveLength(1)
    }),
  )

effectTest.live("MC06 SDK new tasks remain executable while an exact admitted attempt cannot query twice", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup()
    yield* Deferred.succeed(f.resultGate, undefined)
    const first = yield* sdkTask(f, "mc06-sdk-first", {
      description: "Run the first SDK analysis",
      prompt: "Analyze the native input.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
    })
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(first.text)
    const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(first.tool.state.metadata?.externalReceipt)
    const kv = yield* KV.Service
    const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(receipt)))
    const execution = yield* DelegationExecution.Service
    expect(
      yield* execution
        .dispatch({
          delegationID: receipt.delegationID,
          turnID: receipt.turnID,
          prompt: "Analyze the native input.",
          task: {
            parentTaskID: output.parentTaskID,
            parentTaskRevision: binding.parentTaskRevision,
            description: "Run the first SDK analysis",
            background: false,
            source: receipt.source,
          },
          external: {
            operation: "execute",
            agent: Agent.ID.make(binding.agent),
            adapter: f.adapter,
            readOnly: true,
            canUseTool: async () => "allow",
            onPermission: () => Effect.succeed("deny"),
            onText: () => Effect.void,
          },
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(Error)
    expect(f.queries).toHaveLength(1)
    expect((yield* execution.wait(receipt)).text).toBe(f.text)
    const second = yield* sdkTask(f, "mc06-sdk-second", {
      description: "Run a fresh SDK analysis",
      prompt: "Analyze the native input again.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
      new_delegation: true,
    })
    const next = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(second.text)
    expect(next.sdkMessage).toMatchObject({ sessionID: "sdk-session-2", messageID: "sdk-result-2" })
    expect(next.delegationID).not.toBe(output.delegationID)
    expect(f.queries).toHaveLength(2)
    expect((yield* mc07Result(f, "mc06-sdk-first")).tool).toEqual(first.tool)
    expect(yield* kv.get(DelegationReceipt.key(receipt))).toEqual(Schema.encodeSync(DelegationReceipt.Binding)(binding))
  }),
)

effectTest.live("MC06 SDK append resumes its session with a new Task source and complete result", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup()
    yield* Deferred.succeed(f.resultGate, undefined)
    const first = yield* sdkTask(f, "mc06-sdk-followup-a", {
      description: "Read the first SDK input",
      prompt: "Read the native input and return the first complete result.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
    })
    const firstOutput = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(first.text)
    const firstReceipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(first.tool.state.metadata?.externalReceipt)
    const firstKey = DelegationReceipt.key(firstReceipt)
    const kv = yield* KV.Service
    const tasks = yield* SessionTask.Service
    const jobs = yield* Job.Service
    const db = yield* Database.Service
    const saved = yield* kv.get(firstKey)
    const originalBinding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(saved)
    const originalKV = JSON.stringify(saved)
    const originalTool = JSON.stringify(first.tool)
    const originalTask = JSON.stringify(
      (yield* tasks.get(f.root.id)).find((task) => task.id === firstOutput.parentTaskID),
    )
    const originalMeta = yield* db.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(originalMeta).toHaveLength(1)
    const originalMetaText = JSON.stringify(originalMeta[0])
    expect(firstOutput.output).toBe(f.text)
    expect(f.state.closed).toBe(1)
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "*", effect: "ask" },
      ],
    })
    yield* f.llm.push(
      TestLLM.tool("mc06-sdk-followup-b", TaskTool.name, {
        description: "Continue the SDK analysis",
        prompt: "Use the earlier SDK context and return the complete followup result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        delegation_id: firstOutput.delegationID,
        participant_id: firstOutput.participantID,
        command: "append",
      }),
      TestLLM.text("Consumed the complete new SDK result.", "mc06-sdk-followup-b-parent"),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Continue the completed SDK Task." })
    const request = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "SDK followup did not ask through its own Task source",
    )
    const running = yield* mc07Result(f, "mc06-sdk-followup-b")
    expect(request).toMatchObject({
      action: "read",
      sessionID: f.root.id,
      source: { type: "tool", id: "mc06-sdk-followup-b", messageID: running.assistant.id },
    })
    expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
    expect(f.state.reads).toBe(1)
    yield* f.permission.reply({ requestID: request.id, reply: "once" })
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK append did not settle", "10 seconds")
    const second = yield* mc07Consumed(f, "mc06-sdk-followup-b")
    if (second.tool.state.status !== "completed")
      return yield* Effect.die(new Error("SDK append has no completed Tool result"))
    const secondOutput = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(second.text)
    const secondReceipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(second.tool.state.metadata?.externalReceipt)
    const secondKey = DelegationReceipt.key(secondReceipt)
    const secondBinding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(secondKey))
    expect(f.queries).toHaveLength(2)
    expect(f.queries[0]?.options?.resume).toBeUndefined()
    expect(f.queries[1]?.options).toMatchObject({
      resume: firstOutput.sdkMessage.sessionID,
      cwd: f.root.location.directory,
      persistSession: true,
    })
    expect(f.state).toEqual({ reads: 2, closed: 2, hookCalls: 2 })
    expect(f.queries.every((query) => query.options?.abortController?.signal.aborted)).toBe(true)
    expect(secondOutput).toMatchObject({
      delegationID: firstOutput.delegationID,
      participantID: firstOutput.participantID,
      parentSessionID: f.root.id,
      status: "completed",
      sdkMessage: { sessionID: firstOutput.sdkMessage.sessionID, messageID: "sdk-result-2" },
    })
    expect(secondOutput.sdkMessage.messageID).not.toBe(firstOutput.sdkMessage.messageID)
    expect(secondOutput.turnID).not.toBe(firstOutput.turnID)
    expect(secondOutput.parentTaskID).not.toBe(firstOutput.parentTaskID)
    expect(secondReceipt.source.messageID).not.toBe(firstReceipt.source.messageID)
    expect(secondReceipt.source.id).toBe("mc06-sdk-followup-b")
    expect(secondOutput.output).toBe(f.continuedText)
    expect(secondOutput.output).not.toBe(firstOutput.output)
    expect(secondKey).not.toBe(firstKey)
    expect(DelegationReceipt.matches(secondBinding, secondReceipt)).toBe(true)
    expect(DelegationReceipt.matchesOutput(secondBinding, secondOutput)).toBe(true)
    expect(yield* jobs.get(firstKey)).toMatchObject({ status: "completed", output: f.text })
    expect(yield* jobs.get(secondKey)).toMatchObject({ status: "completed", output: f.continuedText })
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "completed"])
    expect((yield* f.sessions.list({ parentID: f.root.id })).data).toEqual([])
    const meta = yield* db.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(meta).toHaveLength(2)
    const secondMeta = meta.find((step) => step.tool_call_id === "mc06-sdk-followup-b")
    expect(secondMeta?.status).toBe("completed")
    expect(
      DelegationReceipt.matches(
        secondBinding,
        Schema.decodeUnknownSync(DelegationReceipt.Sdk)(secondMeta?.provenance?.externalReceipt),
      ),
    ).toBe(true)
    expect(JSON.stringify(meta.find((step) => step.tool_call_id === "mc06-sdk-followup-a"))).toBe(originalMetaText)
    expect(JSON.stringify(yield* kv.get(firstKey))).toBe(originalKV)
    expect(JSON.stringify((yield* mc07Result(f, "mc06-sdk-followup-a")).tool)).toBe(originalTool)
    expect(JSON.stringify((yield* tasks.get(f.root.id)).find((task) => task.id === firstOutput.parentTaskID))).toBe(
      originalTask,
    )
    const execution = yield* DelegationExecution.Service
    expect((yield* execution.wait(firstReceipt)).text).toBe(f.text)
    expect((yield* execution.wait(secondReceipt)).text).toBe(f.continuedText)
    expect(DelegationReceipt.matches(originalBinding, firstReceipt)).toBe(true)
  }),
)

for (const invalid of [
  {
    name: "changed session",
    result: { sessionID: "sdk-other-session" },
    error: "SDK continuation changed its native session",
  },
  {
    name: "reused result UUID",
    result: { messageID: "sdk-result-1" },
    error: "SDK continuation reused its previous result message",
  },
])
  effectTest.live(`MC06 SDK append rejects ${invalid.name} while preserving the original Task and receipt`, () =>
    Effect.gen(function* () {
      const f = yield* sdkTaskSetup("Read", true, invalid.result)
      yield* Deferred.succeed(f.resultGate, undefined)
      const first = yield* sdkTask(f, "mc06-sdk-invalid-followup-a", {
        description: "Finish the original SDK Task",
        prompt: "Read the native input and return the original complete result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
      })
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(first.text)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(first.tool.state.metadata?.externalReceipt)
      const key = DelegationReceipt.key(receipt)
      const kv = yield* KV.Service
      const tasks = yield* SessionTask.Service
      const jobs = yield* Job.Service
      const db = yield* Database.Service
      const originalKV = JSON.stringify(yield* kv.get(key))
      const originalTool = JSON.stringify(first.tool)
      const originalTask = JSON.stringify((yield* tasks.get(f.root.id)).find((task) => task.id === output.parentTaskID))
      const originalMeta = yield* db.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      expect(originalMeta).toHaveLength(1)
      const originalMetaText = JSON.stringify(originalMeta)
      const second = yield* sdkTask(f, "mc06-sdk-invalid-followup-b", {
        description: "Continue the original SDK session",
        prompt: "Return the new complete SDK result in the original session.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        delegation_id: output.delegationID,
        participant_id: output.participantID,
        command: "append",
      })
      expect(second.tool.state.status).toBe("error")
      if (second.tool.state.status !== "error")
        return yield* Effect.die(new Error("Invalid SDK continuation has no failed Tool result"))
      expect(second.tool.state.error.message).toContain(invalid.error)
      expect(second.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(f.queries).toHaveLength(2)
      expect(f.queries[1]?.options?.resume).toBe(output.sdkMessage.sessionID)
      expect(f.state).toEqual({ reads: 2, closed: 2, hookCalls: 2 })
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(output.delegationID)
      const deliveries = [...(state?.deliveries.values() ?? [])]
      expect(deliveries).toHaveLength(2)
      const failed = deliveries.find((delivery) => delivery.turnID !== receipt.turnID)
      if (!failed) return yield* Effect.die(new Error("Invalid SDK continuation has no admitted delivery"))
      expect(failed.status).toBe("failed")
      expect(state?.participants.get(output.participantID)?.externalThreadID).toBe(output.sdkMessage.sessionID)
      const failedKey = DelegationReceipt.key({ delegationID: output.delegationID, ...failed })
      const failedBinding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(failedKey))
      expect(failedKey).not.toBe(key)
      expect(failedBinding.externalThreadID).toBe(output.sdkMessage.sessionID)
      expect(failedBinding.sdkMessage).toBeUndefined()
      expect(failedBinding.parentTaskID).not.toBe(output.parentTaskID)
      expect(failedBinding.source.id).toBe("mc06-sdk-invalid-followup-b")
      expect(failedBinding.settlement?.status).toBe("failed")
      expect((yield* jobs.get(failedKey))?.status).not.toBe("running")
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "failed"])
      const meta = yield* db.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      expect(JSON.stringify(meta)).toBe(originalMetaText)
      expect(JSON.stringify(yield* kv.get(key))).toBe(originalKV)
      expect(JSON.stringify((yield* mc07Result(f, "mc06-sdk-invalid-followup-a")).tool)).toBe(originalTool)
      expect(JSON.stringify((yield* tasks.get(f.root.id)).find((task) => task.id === output.parentTaskID))).toBe(
        originalTask,
      )
      const execution = yield* DelegationExecution.Service
      expect((yield* execution.wait(receipt)).text).toBe(f.text)
    }),
  )

for (const scenario of [
  { kind: "complete", name: "restores full Unicode output and original identities exactly once" },
  { kind: "reclaimed", name: "defers when the original Task claim revision changes" },
  { kind: "missing-settlement", name: "does not query SDK when the complete settlement is absent" },
] as const)
  testEffect(Layer.empty).live(`MC06 SDK cold recovery ${scenario.name}`, () =>
    Effect.gen(function* () {
      const originalContext = yield* Layer.build(metaLayer(true))
      const f = yield* sdkTaskSetup().pipe(Effect.provide(originalContext))
      const id = `mc06-sdk-cold-${scenario.kind}`
      const hooks = yield* PluginHooks.Service.pipe(
        Effect.provide(Context.get(originalContext, LocationServiceMap.Service).get(f.root.location)),
      )
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* hooks.register("tool", "execute.after", (event) => {
        if (event.tool !== "task" || event.id !== id || event.status !== "completed") return Effect.void
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Deferred.succeed(f.resultGate, undefined)
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Complete the original readonly SDK Task",
          prompt: "Read the scoped input and return the complete Unicode result.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
        }),
        TestLLM.text("Consumed the original SDK output.", `${id}-original-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Run one SDK Task and preserve its original result." })
      yield* awaitWithTimeout(Deferred.await(entered), "SDK completion did not reach its after hook")
      const held = yield* mc07Result(f, id)
      expect(held.tool.state.status).toBe("running")
      const binding = (yield* Context.get(originalContext, KV.Service).scan({ prefix: "delegation:external:" })).entries
        .flatMap((entry) => {
          const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(entry.value)
          return Option.isSome(decoded) && decoded.value.source.id === id ? [decoded.value] : []
        })
        .at(0)
      if (!binding) return yield* Effect.die(new Error("Completed SDK Task has no original Binding"))
      expect(binding).toMatchObject({
        target: "claude-code",
        transport: "sdk",
        parentSessionID: f.root.id,
        source: { type: "tool", messageID: held.assistant.id, id },
        sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
        settlement: { status: "completed", text: f.text },
      })
      const originalTasks = yield* Context.get(originalContext, SessionTask.Service).get(f.root.id)
      expect(originalTasks).toHaveLength(1)
      expect(originalTasks[0]).toMatchObject({
        id: binding.parentTaskID,
        status: "completed",
        revision: binding.parentTaskRevision + 1,
      })
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-cold.sqlite`
      const database = Context.get(originalContext, Database.Service)
      yield* database.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original SDK parent did not finish")
      const original = yield* mc07Consumed(f, id)
      if (original.tool.state.status !== "completed")
        return yield* Effect.die(new Error("Original SDK Task did not complete"))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(original.tool.state.metadata?.externalReceipt)
      expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })

      const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
      const coldDatabase = Context.get(context, Database.Service)
      expect(coldDatabase).not.toBe(database)
      const sessions = Context.get(context, Session.Service)
      const root = yield* sessions.get(f.root.id)
      const local = Context.get(context, LocationServiceMap.Service).get(root.location)
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(f.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [f.metaModel, f.executorModel].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(Effect.provide(local))
      const opened = {
        ...f,
        sessions,
        root,
        llm: Context.get(context, TestLLM.Test),
        runs: Context.get(context, SessionExecution.Service),
      }
      const kv = Context.get(context, KV.Service)
      const tasks = Context.get(context, SessionTask.Service)
      const jobs = Context.get(context, Job.Service)
      const permission = yield* Permission.Service.pipe(Effect.provide(local))
      const key = DelegationReceipt.key(receipt)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))).toEqual(binding)
      expect(yield* tasks.get(root.id)).toEqual(originalTasks)
      expect((yield* mc07Result(opened, id)).tool.state.status).toBe("running")
      if (scenario.kind === "reclaimed") {
        expect(
          yield* tasks.patch({
            sessionID: root.id,
            id: binding.parentTaskID,
            status: "in_progress",
            expect: ["completed"],
            expectedRevision: binding.parentTaskRevision + 1,
          }),
        ).toMatchObject({ status: "in_progress", revision: binding.parentTaskRevision + 2 })
      }
      if (scenario.kind === "missing-settlement") {
        yield* kv.set(
          key,
          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
            new DelegationReceipt.Binding(Struct.omit(binding, ["settlement"])),
          ),
        )
        const retained = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))
        expect(retained.sdkMessage).toEqual(binding.sdkMessage)
        expect(retained.source).toEqual(binding.source)
        expect(retained.settlement).toBeUndefined()
      }
      const beforeTasks = yield* tasks.get(root.id)
      const beforeBinding = yield* kv.get(key)
      const beforeState = yield* Context.get(context, DelegationService.Service).foldState(binding.delegationID)
      const successes = coldDatabase.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, root.id),
            eq(
              EventTable.type,
              Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
            ),
          ),
        )
        .all()
        .pipe(Effect.map((events) => events.filter((event) => event.data.id === id)))
      const receipts = coldDatabase.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, root.id),
            eq(MetaAgentStepTable.tool_call_id, id),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
        .all()
      expect(yield* successes).toEqual([])
      expect(yield* receipts).toEqual([])
      expect(yield* jobs.get(key)).toBeUndefined()
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* permission.forSession(root.id)).toEqual([])
      const execution = Context.get(context, DelegationExecution.Service)
      const recovered = yield* execution.recoverPending
      expect(recovered).toMatchObject({
        scanAvailable: true,
        parents: scenario.kind === "complete" ? [root.id] : [],
      })
      const result = yield* mc07Result(opened, id)
      if (scenario.kind !== "complete") {
        expect(result.tool.state.status).toBe("running")
        yield* execution.recoverPending
        expect(yield* mc07Result(opened, id)).toEqual(result)
        expect(yield* successes).toEqual([])
        expect(yield* receipts).toEqual([])
        expect(yield* opened.runs.isActive(root.id)).toBe(false)
      }
      if (scenario.kind === "complete") {
        expect(result.tool.state.status).toBe("completed")
        if (result.tool.state.status !== "completed")
          return yield* Effect.die(new Error("Complete SDK checkpoint was not recovered"))
        expect(result.assistant.id).toBe(held.assistant.id)
        expect(result.tool.state.content).toEqual(original.tool.state.content)
        expect(result.tool.state.metadata?.truncated).toBe(false)
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(
          result.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        expect(output).toMatchObject({
          parentSessionID: root.id,
          parentTaskID: binding.parentTaskID,
          delegationID: binding.delegationID,
          participantID: binding.participantID,
          turnID: binding.turnID,
          sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
          status: "completed",
          output: f.text,
        })
        expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(result.tool.state.metadata?.externalReceipt)).toEqual(
          receipt,
        )
        const success = yield* successes
        const meta = yield* receipts
        expect(success).toHaveLength(1)
        expect(meta).toHaveLength(1)
        expect(success[0]?.data).toMatchObject({
          assistantMessageID: binding.source.messageID,
          id,
          content: result.tool.state.content,
          metadata: { externalReceipt: Schema.encodeSync(DelegationReceipt.Sdk)(receipt) },
        })
        expect(meta[0]).toMatchObject({
          status: "completed",
          event_id: success[0]?.id,
          assistant_message_id: binding.source.messageID,
          tool_call_id: id,
          provenance: { externalReceipt: Schema.encodeSync(DelegationReceipt.Sdk)(receipt) },
        })
        yield* execution.recoverPending
        expect(yield* mc07Result(opened, id)).toEqual(result)
        expect(yield* successes).toEqual(success)
        expect(yield* receipts).toEqual(meta)
        expect((yield* execution.wait(receipt)).text).toBe(f.text)
        yield* opened.llm.push(TestLLM.text("Consumed the complete recovered SDK output.", `${id}-cold-parent`))
        yield* opened.runs.resume(root.id)
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "Recovered SDK parent did not finish")
        expect((yield* mc07Consumed(opened, id)).text).toBe(original.text)
        expect(yield* successes).toEqual(success)
        expect(yield* receipts).toEqual(meta)
      }
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
      expect(yield* tasks.get(root.id)).toEqual(beforeTasks)
      expect(yield* kv.get(key)).toEqual(beforeBinding)
      expect(yield* Context.get(context, DelegationService.Service).foldState(binding.delegationID)).toEqual(
        beforeState,
      )
      expect(yield* jobs.get(key)).toBeUndefined()
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* permission.forSession(root.id)).toEqual([])
      expect((yield* sessions.list({ parentID: root.id })).data).toEqual([])
    }),
  )

effectTest.live("MC06 SDK background returns admitted ACK before the result and delivers full Unicode once", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup("Read", true, undefined, true)
    const id = "mc06-sdk-background-ack"
    const ack = yield* sdkTask(f, id, {
      description: "Run one background readonly SDK Task",
      prompt: "Read the scoped input and return the complete Unicode result.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
      background: true,
      attended: true,
    })
    expect(ack.tool.state.status).toBe("completed")
    if (ack.tool.state.status !== "completed") return yield* Effect.die(new Error("SDK background ACK failed"))
    const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)
    expect(admission).toMatchObject({ execution: "admitted", status: "running", parentSessionID: f.root.id })
    expect(admission).not.toHaveProperty("sdkMessage")
    expect(admission.externalThreadID).toBeUndefined()
    expect(admission.externalTurnID).toBeUndefined()
    expect(ack.tool.state.metadata?.externalReceipt).toBeUndefined()
    yield* awaitWithTimeout(Deferred.await(f.afterRead), "Background SDK did not perform its readonly input")
    expect(f.queries).toHaveLength(1)
    expect(f.state).toEqual({ reads: 1, closed: 0, hookCalls: 1 })
    const kv = yield* KV.Service
    const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
      (yield* kv.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries[0]?.value,
    )
    const key = DelegationReceipt.key(binding)
    const originalAck = JSON.stringify(ack.tool)
    expect(binding).toMatchObject({
      background: true,
      execution: "admitted",
      parentTaskID: admission.parentTaskID,
      source: { type: "tool", messageID: ack.assistant.id, id },
    })
    expect(binding.sdkMessage).toBeUndefined()
    expect(binding.settlement).toBeUndefined()
    expect(DelegationReceipt.matchesOutput(binding, admission)).toBe(true)
    expect(
      DelegationReceipt.matchesOutput(binding, new DelegationReceipt.PendingOutput({ ...admission, status: "queued" })),
    ).toBe(false)
    const codexPending = new DelegationReceipt.Binding({
      ...binding,
      target: "codex",
      transport: "app-server",
      execution: "queued",
      externalThreadID: "mc06-codex-pending-contract",
    })
    expect(
      DelegationReceipt.matchesOutput(
        codexPending,
        new DelegationReceipt.PendingOutput({
          ...admission,
          execution: "queued",
          externalThreadID: codexPending.externalThreadID,
        }),
      ),
    ).toBe(false)
    const tasks = yield* SessionTask.Service
    const jobs = yield* Job.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["in_progress"])
    expect((yield* jobs.get(key))?.status).toBe("running")
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    const database = yield* Database.Service
    const receipts = database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      .all()
    expect(yield* receipts).toEqual([])
    yield* f.llm.push(TestLLM.text("Consumed the full background SDK result.", `${id}-notice-parent`))
    yield* Deferred.succeed(f.resultGate, undefined)
    yield* awaitWithTimeout(f.llm.wait(3), "Parent did not consume the complete SDK background notice")
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK background completion did not settle")
    const completed = yield* f.sessions.context(f.root.id)
    const notices = completed.filter((message) => message.type === "synthetic" && message.metadata?.source === "task")
    expect(notices).toHaveLength(1)
    const notice = notices[0]
    if (notice?.type !== "synthetic") return yield* Effect.die(new Error("SDK background notice is missing"))
    expect(notice.id).toBe(
      DelegationReceipt.notificationID(DelegationFold.inputID(binding.delegationID, binding), binding.parentTaskID),
    )
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text)
    const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(notice.metadata?.externalReceipt)
    const settled = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))
    expect(output).toMatchObject({
      status: "completed",
      parentTaskID: binding.parentTaskID,
      sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
      output: f.text,
    })
    expect(settled.settlement).toEqual({ status: "completed", text: f.text })
    expect(settled.source).toEqual(binding.source)
    expect(DelegationReceipt.matches(settled, receipt)).toBe(true)
    expect(DelegationReceipt.matchesOutput(settled, admission)).toBe(true)
    expect(DelegationReceipt.isBackgroundAck(settled, (yield* mc07Result(f, id)).tool, admission)).toBe(true)
    expect(
      (yield* f.llm.requests())
        .at(-1)
        ?.messages.flatMap((message) => message.content)
        .some((part) => part.type === "text" && part.text.includes(notice.text)),
    ).toBe(true)
    const meta = yield* receipts
    expect(meta).toHaveLength(1)
    expect(meta[0]).toMatchObject({ status: "completed", tool_call_id: id })
    expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
    expect(
      yield* database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, f.root.id),
            eq(
              EventTable.type,
              Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
            ),
          ),
        ),
    ).toHaveLength(1)
    const execution = yield* DelegationExecution.Service
    expect((yield* execution.wait(receipt)).text).toBe(f.text)
    yield* execution.recoverPending
    yield* execution.recoverPending
    expect(yield* f.sessions.context(f.root.id)).toEqual(completed)
    expect(yield* receipts).toEqual(meta)
    expect(JSON.stringify((yield* mc07Result(f, id)).tool)).toBe(originalAck)
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed"])
    expect(f.queries).toHaveLength(1)
    expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
  }),
)

effectTest.live("MC06 SDK background two Tasks keep independent Read once and reject permissions", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup("Read", true, undefined, true)
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "*", effect: "ask" },
      ],
    })
    const kv = yield* KV.Service
    const tasks = yield* SessionTask.Service
    const results = yield* Effect.forEach(
      ["once", "reject"] as const,
      (reply, index) =>
        Effect.gen(function* () {
          const id = `mc06-sdk-background-read-${reply}`
          const ack = yield* sdkTask(f, id, {
            description: `Run the ${reply} background readonly Task`,
            prompt: "Read the same scoped input through this Task's own permission.",
            execution_type: "external-cli",
            cli_target: "claude-code",
            subagent_type: "claude-code",
            background: true,
            attended: true,
            new_delegation: index === 1,
          })
          expect(ack.tool.state.status).toBe("completed")
          if (ack.tool.state.status !== "completed") return yield* Effect.die(new Error("SDK readonly ACK failed"))
          const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)
          expect(admission).toMatchObject({ execution: "admitted", status: "running" })
          expect(ack.tool.state.metadata?.externalReceipt).toBeUndefined()
          const request = yield* pollWithTimeout(
            f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
            "Background SDK Read lost its owning permission after ACK",
          )
          expect(request).toMatchObject({
            action: "read",
            sessionID: f.root.id,
            source: { type: "tool", messageID: ack.assistant.id, id },
          })
          expect(f.queries).toHaveLength(index + 1)
          expect(f.state).toEqual({ reads: index, closed: index, hookCalls: index + 1 })
          yield* f.runs.interrupt(f.root.id)
          expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
          expect(f.state.closed).toBe(index)
          yield* f.llm.push(TestLLM.text(`Consumed the ${reply} SDK notice.`, `${id}-notice-parent`))
          yield* f.permission.reply({ requestID: request.id, reply })
          yield* Deferred.succeed(f.resultGate, undefined)
          yield* awaitWithTimeout(f.llm.wait((index + 1) * 3), "Parent did not consume its SDK readonly notice")
          yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Background readonly Task did not settle")
          const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
            (yield* kv.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries[0]?.value,
          )
          const notice = (yield* f.sessions.context(f.root.id)).find(
            (message) =>
              message.type === "synthetic" &&
              message.id ===
                DelegationReceipt.notificationID(
                  DelegationFold.inputID(binding.delegationID, binding),
                  binding.parentTaskID,
                ),
          )
          if (notice?.type !== "synthetic") return yield* Effect.die(new Error("Readonly SDK notice is missing"))
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(notice.text)
          const receipt = Schema.decodeUnknownSync(DelegationReceipt.Outcome)(notice.metadata?.externalReceipt)
          expect(output).toMatchObject({
            status: reply === "once" ? "completed" : "failed",
            parentTaskID: admission.parentTaskID,
          })
          if (reply === "once")
            expect(output).toMatchObject({
              sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
              output: f.text,
            })
          if (reply === "reject") {
            expect(binding.settlement?.status).toBe("failed")
            if (!binding.settlement) return yield* Effect.die(new Error("Rejected SDK Read has no saved settlement"))
            expect(output.output).toBe(binding.settlement.text)
            expect(output).toMatchObject({ execution: "admitted" })
            expect(output).not.toHaveProperty("sdkMessage")
            expect(receipt).toBeInstanceOf(DelegationReceipt.Pending)
            expect(binding.sdkMessage).toBeUndefined()
          }
          expect(binding.source).toEqual({ type: "tool", messageID: ack.assistant.id, id })
          expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
          expect(yield* f.permission.forSession(f.root.id)).toEqual([])
          expect(
            (yield* f.llm.requests())
              .at(-1)
              ?.messages.flatMap((message) => message.content)
              .some((part) => part.type === "text" && part.text.includes(notice.text)),
          ).toBe(true)
          return { id, admission, binding, receipt, requestID: request.id, ack: JSON.stringify(ack.tool) }
        }),
      { concurrency: 1 },
    )
    const first = results[0]
    const second = results[1]
    if (!first || !second) return yield* Effect.die(new Error("Both readonly SDK Tasks must settle"))
    expect(second.requestID).not.toBe(first.requestID)
    expect(second.admission.parentTaskID).not.toBe(first.admission.parentTaskID)
    expect(second.admission.delegationID).not.toBe(first.admission.delegationID)
    expect(yield* f.permission.reply({ requestID: first.requestID, reply: "once" }).pipe(Effect.flip)).toMatchObject({
      _tag: "Permission.NotFoundError",
    })
    expect(f.state).toEqual({ reads: 1, closed: 2, hookCalls: 2 })
    expect(f.queries).toHaveLength(2)
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "failed"])
    const database = yield* Database.Service
    const receipts = yield* database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(receipts).toHaveLength(2)
    expect(receipts.find((row) => row.tool_call_id === first.id)?.status).toBe("completed")
    expect(receipts.find((row) => row.tool_call_id === second.id)?.status).toBe("failed")
    for (const result of results) {
      expect(JSON.stringify((yield* mc07Result(f, result.id)).tool)).toBe(result.ack)
      expect(
        Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(result.binding))),
      ).toEqual(result.binding)
      expect(
        Schema.decodeUnknownSync(DelegationReceipt.Outcome)(
          receipts.find((row) => row.tool_call_id === result.id)?.provenance?.externalReceipt,
        ),
      ).toEqual(result.receipt)
    }
  }),
)

effectTest.live("MC06 SDK background retains a complete result before its admitted ACK is published", () =>
  Effect.gen(function* () {
    const f = yield* sdkTaskSetup("Read", true, undefined, true)
    const id = "mc06-sdk-background-early-result"
    const locations = yield* LocationServiceMap.Service
    const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(f.root.location)))
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* hooks.register("tool", "execute.after", (event) => {
      if (event.tool !== "task" || event.id !== id || event.status !== "completed") return Effect.void
      return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* f.llm.push(
      TestLLM.tool(id, TaskTool.name, {
        description: "Finish the SDK result while its ACK is held",
        prompt: "Return the complete readonly Unicode result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        background: true,
        attended: true,
      }),
      TestLLM.text("Accepted the original SDK background Task.", `${id}-ack-parent`),
      TestLLM.text("Consumed the early complete SDK result.", `${id}-notice-parent`),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Keep the original ACK while the SDK completes." })
    yield* awaitWithTimeout(Deferred.await(entered), "SDK ACK did not reach its after hook")
    const kv = yield* KV.Service
    const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
      (yield* kv.scan({ prefix: "delegation:external:" })).entries[0]?.value,
    )
    expect(binding.source.id).toBe(id)
    yield* Deferred.succeed(f.resultGate, undefined)
    const settled = yield* pollWithTimeout(
      kv.get(DelegationReceipt.key(binding)).pipe(
        Effect.map((value) => {
          const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(value)
          return Option.isSome(decoded) && decoded.value.settlement?.status === "completed" ? decoded.value : undefined
        }),
      ),
      "SDK result did not settle before the ACK release",
    )
    expect(settled.settlement).toEqual({ status: "completed", text: f.text })
    expect((yield* mc07Result(f, id)).tool.state.status).toBe("running")
    expect((yield* f.sessions.context(f.root.id)).some((message) => message.type === "synthetic")).toBe(false)
    const tasks = yield* SessionTask.Service
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed"])
    const database = yield* Database.Service
    const receipts = database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
      .all()
    expect(yield* receipts).toEqual([])
    yield* Deferred.succeed(release, undefined)
    const notice = yield* pollWithTimeout(
      f.sessions
        .context(f.root.id)
        .pipe(
          Effect.map((messages) =>
            messages.find((message) => message.type === "synthetic" && message.metadata?.source === "task"),
          ),
        ),
      "The result completed before ACK did not produce its notice",
    )
    if (notice.type !== "synthetic") return yield* Effect.die(new Error("Early SDK notice is missing"))
    yield* pollWithTimeout(
      f.llm
        .requests()
        .pipe(
          Effect.map((requests) =>
            requests.find((request) =>
              request.messages
                .flatMap((message) => message.content)
                .some((part) => part.type === "text" && part.text.includes(notice.text)),
            ),
          ),
        ),
      "Parent did not consume the complete early SDK notice",
    )
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Early SDK result did not release its parent")
    const ack = yield* mc07Consumed(f, id)
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)).toMatchObject({
      execution: "admitted",
      status: "running",
    })
    expect(ack.tool.state.status === "completed" && ack.tool.state.metadata?.externalReceipt).toBeUndefined()
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text).output).toBe(
      f.text,
    )
    expect((yield* f.sessions.context(f.root.id)).filter((message) => message.type === "synthetic")).toHaveLength(1)
    expect(yield* receipts).toHaveLength(1)
    expect((yield* receipts)[0]).toMatchObject({ status: "completed", tool_call_id: id })
    expect(f.queries).toHaveLength(1)
    expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
  }),
)

for (const scenario of [
  { kind: "permission", status: "cancelled", name: "cancellation at permission withdraws the original Read request" },
  {
    kind: "result",
    status: "cancelled",
    name: "cancellation after Read preserves the settled outcome against a late result",
  },
  {
    kind: "identity",
    status: "failed",
    name: "missing terminal UUID delivers the original failed settlement without a completed receipt",
  },
] as const)
  effectTest.live(`MC06 SDK background ${scenario.name}`, () =>
    Effect.gen(function* () {
      const f = yield* sdkTaskSetup("Read", scenario.kind !== "identity", undefined, true)
      const id = `mc06-sdk-background-terminal-${scenario.kind}`
      if (scenario.kind === "permission")
        yield* f.sessions.setPermissions({
          sessionID: f.root.id,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "ask" },
          ],
        })
      const ack = yield* sdkTask(f, id, {
        description: `Settle the background SDK ${scenario.kind} boundary`,
        prompt: "Read the input and preserve the original terminal result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        background: true,
        attended: true,
      })
      expect(ack.tool.state.status).toBe("completed")
      const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)
      expect(admission).toMatchObject({ execution: "admitted", status: "running" })
      const originalAck = JSON.stringify(ack.tool)
      const kv = yield* KV.Service
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        (yield* kv.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries[0]?.value,
      )
      const key = DelegationReceipt.key(binding)
      const asked =
        scenario.kind === "permission"
          ? yield* pollWithTimeout(
              f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
              "SDK background cancellation lost its pending Read",
            )
          : undefined
      if (scenario.kind !== "permission")
        yield* awaitWithTimeout(Deferred.await(f.afterRead), "SDK background Read did not reach its result boundary")
      yield* f.runs.interrupt(f.root.id)
      expect(f.state.closed).toBe(0)
      if (asked) {
        expect(asked.source).toMatchObject({ type: "tool", messageID: ack.assistant.id, id })
        expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
      }
      yield* f.llm.push(TestLLM.text("Consumed the original SDK terminal notice.", `${id}-notice-parent`))
      const execution = yield* DelegationExecution.Service
      if (scenario.kind !== "identity")
        yield* awaitWithTimeout(
          execution.interrupt({ delegationID: binding.delegationID, participantID: binding.participantID }),
          "SDK background cancellation retained its settlement lock",
          "5 seconds",
        )
      if (scenario.kind === "identity") yield* Deferred.succeed(f.resultGate, undefined)
      yield* awaitWithTimeout(f.llm.wait(3), "Parent did not consume the SDK failed or cancelled notice")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK terminal notice did not settle")
      const jobs = yield* Job.Service
      yield* pollWithTimeout(
        jobs.get(key).pipe(Effect.map((job) => (job === undefined ? true : undefined))),
        "SDK terminal observer did not release its Job",
      )
      const settled = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))
      expect(settled.settlement?.status).toBe(scenario.status)
      if (!settled.settlement) return yield* Effect.die(new Error("SDK terminal settlement is missing"))
      expect(settled.settlement.text.length).toBeGreaterThan(0)
      expect(settled.sdkMessage).toBeUndefined()
      const tasks = yield* SessionTask.Service
      const delegations = yield* DelegationService.Service
      const beforeTasks = yield* tasks.get(f.root.id)
      const beforeState = yield* delegations.foldState(binding.delegationID)
      expect(beforeTasks.map((task) => task.status)).toEqual([scenario.status])
      expect([...(beforeState?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual([
        scenario.status,
      ])
      const messages = yield* f.sessions.context(f.root.id)
      const notices = messages.filter((message) => message.type === "synthetic" && message.metadata?.source === "task")
      expect(notices).toHaveLength(1)
      const notice = notices[0]
      if (notice?.type !== "synthetic") return yield* Effect.die(new Error("SDK terminal notice is missing"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(notice.text)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(notice.metadata?.externalReceipt)
      expect(output).toMatchObject({
        execution: "admitted",
        status: scenario.status,
        parentTaskID: binding.parentTaskID,
        output: settled.settlement.text,
      })
      expect(output).not.toHaveProperty("sdkMessage")
      expect(receipt.execution).toBe("admitted")
      expect(receipt.externalThreadID).toBeUndefined()
      expect(receipt.source).toEqual(binding.source)
      expect(DelegationReceipt.matches(settled, receipt)).toBe(true)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      if (asked)
        expect(yield* f.permission.reply({ requestID: asked.id, reply: "once" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Permission.NotFoundError",
        })
      expect(
        (yield* f.llm.requests())
          .at(-1)
          ?.messages.flatMap((message) => message.content)
          .some((part) => part.type === "text" && part.text.includes(notice.text)),
      ).toBe(true)
      const database = yield* Database.Service
      const receipts = database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
        .all()
      const meta = yield* receipts
      expect(meta).toHaveLength(1)
      expect(meta[0]).toMatchObject({ status: "failed", tool_call_id: id })
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
      expect(meta.some((row) => row.status === "completed")).toBe(false)
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: scenario.kind === "permission" ? 0 : 1, closed: 1, hookCalls: 1 })
      expect(f.queries[0]?.options?.abortController?.signal.aborted).toBe(true)
      yield* Deferred.succeed(f.resultGate, undefined)
      yield* awaitWithTimeout(Deferred.await(f.nativeFinished), "The late SDK frame did not release its native stream")
      yield* execution.recoverPending
      expect(yield* tasks.get(f.root.id)).toEqual(beforeTasks)
      expect(yield* delegations.foldState(binding.delegationID)).toEqual(beforeState)
      expect(yield* kv.get(key)).toEqual(Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(settled))
      expect(yield* f.sessions.context(f.root.id)).toEqual(messages)
      expect(yield* receipts).toEqual(meta)
      expect(JSON.stringify((yield* mc07Result(f, id)).tool)).toBe(originalAck)
      expect(f.queries).toHaveLength(1)
    }),
  )

for (const scenario of [
  { kind: "complete", name: "cold recovery restores the complete original notice without querying SDK" },
  { kind: "missing-settlement", name: "cold recovery does not substitute identities or a Task summary for settlement" },
  { kind: "session-conflict", name: "cold recovery refuses a Binding session that conflicts with the SDK result" },
] as const)
  testEffect(Layer.empty).live(`MC06 SDK background ${scenario.name}`, () =>
    Effect.gen(function* () {
      const originalContext = yield* Layer.build(metaLayer(true))
      const f = yield* sdkTaskSetup("Read", true, undefined, true).pipe(Effect.provide(originalContext))
      const id = `mc06-sdk-background-cold-${scenario.kind}`
      const ack = yield* sdkTask(f, id, {
        description: "Complete the SDK background Task before its notification",
        prompt: "Read the scoped input and preserve the complete Unicode result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        background: true,
        attended: true,
      })
      const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)
      expect(admission).toMatchObject({ execution: "admitted", status: "running" })
      const originalAck = JSON.stringify(ack.tool)
      const originalKV = Context.get(originalContext, KV.Service)
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        (yield* originalKV.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries[0]?.value,
      )
      const key = DelegationReceipt.key(binding)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const unsubscribe = yield* Context.get(originalContext, Bus.Service).listen((event) => {
        if (event.type !== DelegationEvent.DeliveryCompleted.type) return Effect.void
        const completed = Schema.decodeUnknownSync(Schema.toType(DelegationEvent.DeliveryCompletedData))(event.data)
        if (DelegationReceipt.key(completed) !== key || completed.attempt !== binding.attempt) return Effect.void
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe)))
      yield* f.llm.push(TestLLM.text("Consumed the original complete SDK notice.", `${id}-original-parent`))
      yield* Deferred.succeed(f.resultGate, undefined)
      yield* awaitWithTimeout(
        Deferred.await(entered),
        "Completed SDK Delivery did not reach its committed notification checkpoint",
      )
      const completedBinding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* originalKV.get(key))
      expect(completedBinding.settlement).toEqual({ status: "completed", text: f.text })
      expect(completedBinding.sdkMessage).toEqual({ sessionID: "sdk-session-1", messageID: "sdk-result-1" })
      expect(completedBinding.source).toEqual({ type: "tool", messageID: ack.assistant.id, id })
      expect(JSON.stringify((yield* mc07Result(f, id)).tool)).toBe(originalAck)
      expect((yield* f.sessions.context(f.root.id)).some((message) => message.type === "synthetic")).toBe(false)
      expect((yield* f.sessions.inbox(f.root.id)).some((input) => input.type === "synthetic")).toBe(false)
      const originalTasks = yield* Context.get(originalContext, SessionTask.Service).get(f.root.id)
      expect(originalTasks).toHaveLength(1)
      expect(originalTasks[0]).toMatchObject({
        id: binding.parentTaskID,
        status: "completed",
        revision: binding.parentTaskRevision + 1,
      })
      const originalState = yield* Context.get(originalContext, DelegationService.Service).foldState(
        binding.delegationID,
      )
      expect(
        originalState?.deliveries.get(
          DelegationFold.deliveryKey(
            binding.turnID,
            binding.participantID,
            binding.deliveryOrigin,
            binding.senderParticipantID,
          ),
        ),
      ).toMatchObject({
        status: "completed",
        attempt: binding.attempt,
        summary: DelegationReceipt.outputDigest(f.text),
      })
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-background-cold.sqlite`
      const originalDatabase = Context.get(originalContext, Database.Service)
      yield* originalDatabase.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(f.llm.wait(3), "Original SDK background parent did not consume its notice")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original SDK background parent did not finish")
      yield* pollWithTimeout(
        Context.get(originalContext, Job.Service)
          .get(key)
          .pipe(Effect.map((job) => (job === undefined ? true : undefined))),
        "Original SDK background Job did not finish its notification",
      )
      yield* unsubscribe
      const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
      const database = Context.get(context, Database.Service)
      expect(database).not.toBe(originalDatabase)
      const sessions = Context.get(context, Session.Service)
      const root = yield* sessions.get(f.root.id)
      const local = Context.get(context, LocationServiceMap.Service).get(root.location)
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(f.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [f.metaModel, f.executorModel].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(Effect.provide(local))
      const opened = {
        ...f,
        sessions,
        root,
        llm: Context.get(context, TestLLM.Test),
        runs: Context.get(context, SessionExecution.Service),
      }
      const kv = Context.get(context, KV.Service)
      const tasks = Context.get(context, SessionTask.Service)
      const jobs = Context.get(context, Job.Service)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))).toEqual(completedBinding)
      expect(yield* tasks.get(root.id)).toEqual(originalTasks)
      expect(JSON.stringify((yield* mc07Result(opened, id)).tool)).toBe(originalAck)
      if (scenario.kind === "missing-settlement")
        yield* kv.set(
          key,
          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
            new DelegationReceipt.Binding(Struct.omit(completedBinding, ["settlement"])),
          ),
        )
      if (scenario.kind === "session-conflict")
        yield* kv.set(
          key,
          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
            new DelegationReceipt.Binding({
              ...completedBinding,
              externalThreadID: "sdk-conflicting-session",
            }),
          ),
        )
      const beforeBinding = yield* kv.get(key)
      const beforeState = yield* Context.get(context, DelegationService.Service).foldState(binding.delegationID)
      const receipts = database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, root.id), eq(MetaAgentStepTable.type, "receipt")))
        .all()
      const successes = database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, root.id),
            eq(
              EventTable.type,
              Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
            ),
          ),
        )
        .all()
      const originalSuccess = yield* successes
      expect(originalSuccess).toHaveLength(1)
      expect(yield* receipts).toEqual([])
      expect((yield* sessions.inbox(root.id)).filter((input) => input.type === "synthetic")).toEqual([])
      const execution = Context.get(context, DelegationExecution.Service)
      expect(yield* execution.recoverPending).toMatchObject({
        scanAvailable: true,
        parents: scenario.kind === "complete" ? [root.id] : [],
      })
      if (scenario.kind !== "complete") {
        yield* execution.recoverPending
        expect((yield* sessions.inbox(root.id)).filter((input) => input.type === "synthetic")).toEqual([])
        expect(yield* receipts).toEqual([])
        expect(yield* opened.runs.isActive(root.id)).toBe(false)
      }
      if (scenario.kind === "complete") {
        const pending = (yield* sessions.inbox(root.id)).filter((input) => input.type === "synthetic")
        expect(pending).toHaveLength(1)
        const notice = pending[0]
        if (notice?.type !== "synthetic") return yield* Effect.die(new Error("Cold SDK notice was not admitted"))
        expect(notice.id).toBe(
          DelegationReceipt.notificationID(DelegationFold.inputID(binding.delegationID, binding), binding.parentTaskID),
        )
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.payload.text)
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(notice.payload.metadata?.externalReceipt)
        expect(output).toMatchObject({
          status: "completed",
          parentTaskID: binding.parentTaskID,
          sdkMessage: { sessionID: "sdk-session-1", messageID: "sdk-result-1" },
          output: f.text,
        })
        expect(receipt.source).toEqual(binding.source)
        expect(DelegationReceipt.matches(completedBinding, receipt)).toBe(true)
        expect(yield* receipts).toEqual([])
        yield* execution.recoverPending
        expect((yield* sessions.inbox(root.id)).filter((input) => input.type === "synthetic")).toEqual(pending)
        expect((yield* execution.wait(receipt)).text).toBe(f.text)
        yield* opened.llm.push(TestLLM.text("Consumed the cold complete SDK notice.", `${id}-cold-parent`))
        yield* opened.runs.resume(root.id)
        yield* awaitWithTimeout(opened.llm.wait(1), "Cold SDK notice was not consumed by its original parent")
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "Cold SDK parent did not finish")
        expect(
          (yield* opened.llm.requests())[0]?.messages
            .flatMap((message) => message.content)
            .some((part) => part.type === "text" && part.text.includes(notice.payload.text)),
        ).toBe(true)
        const messages = yield* sessions.context(root.id)
        expect(messages.filter((message) => message.type === "synthetic" && message.id === notice.id)).toHaveLength(1)
        const meta = yield* receipts
        expect(meta).toHaveLength(1)
        expect(meta[0]).toMatchObject({ status: "completed", tool_call_id: id })
        expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
        yield* execution.recoverPending
        expect(yield* sessions.context(root.id)).toEqual(messages)
        expect(yield* receipts).toEqual(meta)
      }
      expect(yield* tasks.get(root.id)).toEqual(originalTasks)
      expect(yield* kv.get(key)).toEqual(beforeBinding)
      expect(yield* Context.get(context, DelegationService.Service).foldState(binding.delegationID)).toEqual(
        beforeState,
      )
      expect(yield* successes).toEqual(originalSuccess)
      expect(JSON.stringify((yield* mc07Result(opened, id)).tool)).toBe(originalAck)
      expect(yield* jobs.get(key)).toBeUndefined()
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(
        yield* Permission.Service.use((permission) => permission.forSession(root.id)).pipe(Effect.provide(local)),
      ).toEqual([])
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
  )

testEffect(Layer.empty).live(
  "MC06 SDK early C1 queued background recovers committed Task before Delivery without coordination replay",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(metaLayer(true))
      const f = yield* queuedSdkSetup().pipe(Effect.provide(context))
      f.outputs[1] = `MC06_SDK_QUEUE_1_${f.text}`
      expect(f.outputs[1].charCodeAt(4095)).toBe(0xd83d)
      const kv = Context.get(context, KV.Service)
      const tasks = Context.get(context, SessionTask.Service)
      const delegations = Context.get(context, DelegationService.Service)
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const unsubscribe = yield* Context.get(context, Bus.Service).listen((event) => {
        if (event.type !== SessionTask.Event.Updated.type) return Effect.void
        const data = Schema.decodeUnknownSync(Schema.toType(SessionTask.Event.Updated.data))(event.data)
        if (
          data.sessionID !== f.root.id ||
          !data.tasks.some(
            (task) =>
              task.id === f.queueBinding.parentTaskID &&
              task.status === "completed" &&
              task.revision === f.queueBinding.parentTaskRevision + 1,
          )
        )
          return Effect.void
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
      })
      yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.andThen(unsubscribe)))
      yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
      yield* awaitWithTimeout(
        Deferred.await(f.firstControl.afterRead),
        "The original SDK queue predecessor did not read",
      )
      yield* Deferred.succeed(f.firstControl.resultGate, undefined)
      yield* Deferred.succeed(f.firstControl.tailGate, undefined)
      const request = yield* pollWithTimeout(
        f.permission
          .forSession(f.root.id)
          .pipe(
            Effect.map((requests) =>
              requests.find(
                (request) => request.source?.type === "tool" && request.source.id === f.queueBinding.source.id,
              ),
            ),
          ),
        "The SDK early queued input did not reach its own permission",
      )
      expect(request.id).not.toBe(f.firstRequest.id)
      expect(request.source).toEqual(f.queueBinding.source)
      expect(f.queries).toHaveLength(2)
      expect(f.closedBeforeQuery).toEqual([0, 1])
      expect(f.queries[1]?.options?.resume).toBe("sdk-session-1")
      yield* f.permission.reply({ requestID: request.id, reply: "once" })
      yield* awaitWithTimeout(Deferred.await(f.queueControl.afterRead), "The SDK early queued input did not read")
      yield* Deferred.succeed(f.queueControl.resultGate, undefined)
      yield* Deferred.succeed(f.queueControl.tailGate, undefined)
      yield* awaitWithTimeout(
        Deferred.await(entered),
        "The queued SDK Task did not reach its committed Updated checkpoint",
      )
      const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(f.queueKey))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint))
      expect(checkpoint.settlement).toEqual({ status: "completed", text: f.outputs[1] })
      expect(checkpoint.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: "sdk-session-1", messageID: "sdk-result-2" }),
      )
      expect(checkpoint.execution).toBeDefined()
      const firstBinding = yield* kv.get(f.firstKey)
      const firstTask = (yield* tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)
      const firstDelivery = [
        ...((yield* delegations.foldState(f.admission.delegationID))?.deliveries.values() ?? []),
      ].find((delivery) => delivery.turnID === f.firstBinding.turnID)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === checkpoint.parentTaskID)).toMatchObject({
        status: "completed",
        revision: checkpoint.parentTaskRevision + 1,
      })
      expect(
        [...((yield* delegations.foldState(checkpoint.delegationID))?.deliveries.values() ?? [])].find(
          (delivery) => delivery.turnID === checkpoint.turnID,
        ),
      ).toMatchObject({ status: "running", attempt: checkpoint.attempt })
      expect((yield* f.sessions.inbox(f.root.id)).some((input) => input.id === f.noticeID)).toBe(false)
      const database = Context.get(context, Database.Service)
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-early-c1.sqlite`
      yield* database.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* Deferred.succeed(gate, undefined)
      yield* unsubscribe
      yield* pollWithTimeout(
        Context.get(context, Job.Service)
          .get(f.queueKey)
          .pipe(Effect.map((job) => (job === undefined ? true : undefined))),
        "The original queued SDK Job did not finish its notice",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original queued SDK notice parent did not finish")
      const originalNotice = (yield* f.sessions.context(f.root.id)).find((message) => message.id === f.noticeID)
      if (originalNotice?.type !== "synthetic")
        return yield* Effect.die(new Error("The original queued SDK notice is missing"))
      const opened = yield* sdkEarlyOpen(f, snapshot)
      expect(opened.database).not.toBe(database)
      const events = sdkEarlyEvents(opened, checkpoint)
      const beforeTask = (yield* opened.tasks.get(opened.root.id)).find((task) => task.id === checkpoint.parentTaskID)
      expect(yield* events.deliveries).toEqual([])
      expect(yield* opened.execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [opened.root.id] })
      expect(yield* opened.runs.isActive(opened.root.id)).toBe(false)
      const input = (yield* opened.sessions.inbox(opened.root.id)).find((input) => input.id === f.noticeID)
      if (input?.type !== "synthetic")
        return yield* Effect.die(new Error("The cold queued SDK notice was not durably admitted"))
      const notice = input.payload
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text)
      expect(output).toMatchObject({
        status: "completed",
        parentTaskID: checkpoint.parentTaskID,
        sdkMessage: receipt.sdkMessage,
      })
      expect(output.output).toBe(f.outputs[1])
      expect(notice.text).toBe(originalNotice.text)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(notice.metadata?.externalReceipt)).toEqual(receipt)
      expect((yield* opened.tasks.get(opened.root.id)).find((task) => task.id === checkpoint.parentTaskID)).toEqual(
        beforeTask,
      )
      expect((yield* opened.execution.wait(receipt)).text).toBe(f.outputs[1])
      expect(yield* events.deliveries).toHaveLength(1)
      expect(yield* opened.kv.get(f.firstKey)).toEqual(firstBinding)
      expect((yield* opened.tasks.get(opened.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)).toEqual(
        firstTask,
      )
      expect(
        [...((yield* opened.delegations.foldState(f.admission.delegationID))?.deliveries.values() ?? [])].find(
          (delivery) => delivery.turnID === f.firstBinding.turnID,
        ),
      ).toEqual(firstDelivery)
      const binding = yield* opened.kv.get(f.queueKey)
      yield* opened.execution.recoverPending
      expect((yield* opened.sessions.inbox(opened.root.id)).filter((input) => input.id === f.noticeID)).toHaveLength(1)
      expect(yield* opened.kv.get(f.queueKey)).toEqual(binding)
      expect(yield* events.deliveries).toHaveLength(1)
      yield* opened.llm.push(
        TestLLM.text("Consumed the original complete queued SDK checkpoint.", "mc06-sdk-early-c1-cold-parent"),
      )
      yield* opened.runs.resume(opened.root.id)
      yield* awaitWithTimeout(
        opened.runs.awaitIdle(opened.root.id),
        "The cold queued SDK parent did not consume its exact notice",
      )
      expect(
        (yield* opened.llm.requests()).some((request) =>
          request.messages.some(
            (message) =>
              message.role === "user" &&
              message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
          ),
        ),
      ).toBe(true)
      expect((yield* mc07Consumed(opened, checkpoint.source.id)).text).toBe(f.queued.text)
      const meta = yield* events.metas
      expect(meta).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
      expect(JSON.stringify((yield* mc07Result(opened, checkpoint.source.id)).tool)).toBe(JSON.stringify(f.queued.tool))
      const messages = yield* opened.sessions.context(opened.root.id)
      const finalTasks = yield* opened.tasks.get(opened.root.id)
      yield* opened.execution.recoverPending
      yield* opened.execution.recoverPending
      expect(yield* opened.sessions.context(opened.root.id)).toEqual(messages)
      expect(messages.filter((message) => message.id === f.noticeID)).toHaveLength(1)
      expect(yield* opened.tasks.get(opened.root.id)).toEqual(finalTasks)
      expect(yield* opened.kv.get(f.queueKey)).toEqual(binding)
      expect(yield* events.deliveries).toHaveLength(1)
      expect(yield* events.metas).toEqual(meta)
      expect(yield* opened.jobs.get(f.queueKey)).toBeUndefined()
      expect(f.queries).toHaveLength(2)
      expect(f.state).toEqual({ reads: 2, closed: 2, hookCalls: 2 })
    }),
)

testEffect(Layer.empty).live(
  "MC06 SDK early raw cold clones preserve changed claims, identities and owners before local writes",
  () =>
    Effect.gen(function* () {
      const f = yield* sdkEarlyReviewerStage("raw")
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === f.binding.parentTaskID)).toMatchObject({
        status: "in_progress",
        revision: f.binding.parentTaskRevision,
      })
      const directory = yield* tmpdirScoped()
      const snapshot = `${directory.path}/mc06-sdk-early-raw.sqlite`
      yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* f.release
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original raw SDK review did not finish")
      const baseline = yield* sdkEarlyOpen(f, snapshot)
      for (const kind of [
        "task-edit",
        "task-cancel",
        "delivery-cancel",
        "empty-session",
        "changed-session",
        "empty-message",
        "missing-message",
        "empty-text",
        "key-conflict",
        "provider-conflict",
        "parent-conflict",
        "source-conflict",
        "tool-ended",
        "active-parent",
      ] as const)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const clone = `${directory.path}/mc06-sdk-early-raw-${kind}.sqlite`
            yield* baseline.database.db.run(sql`VACUUM INTO ${clone}`)
            const opened = yield* sdkEarlyOpen(f, clone)
            expect(opened.database).not.toBe(baseline.database)
            const events = sdkEarlyEvents(opened, f.binding)
            if (kind === "task-edit" || kind === "task-cancel") {
              const changed = yield* opened.tasks.updateTask({
                sessionID: opened.root.id,
                id: f.binding.parentTaskID,
                expectedRevision: f.binding.parentTaskRevision,
                status: kind === "task-cancel" ? "cancelled" : "in_progress",
                ...(kind === "task-edit" ? { content: "The owner changed this raw SDK Task before recovery." } : {}),
              })
              expect(changed).toBeDefined()
            }
            if (kind === "delivery-cancel")
              yield* opened.delegations.recordDelivery({
                ...f.binding,
                status: "cancelled",
                summary: "The original SDK delivery was cancelled before recovery.",
              })
            if (
              [
                "empty-session",
                "changed-session",
                "empty-message",
                "missing-message",
                "empty-text",
                "key-conflict",
                "provider-conflict",
                "parent-conflict",
                "source-conflict",
              ].includes(kind)
            ) {
              const sdkMessage = f.sdkReceipt.sdkMessage
              const altered = {
                ...f.binding,
                target: kind === "provider-conflict" ? "codex" : f.binding.target,
                parentSessionID: kind === "parent-conflict" ? f.receipt.childSessionID : f.binding.parentSessionID,
                turnID: kind === "key-conflict" ? f.receipt.turnID : f.binding.turnID,
                source:
                  kind === "source-conflict"
                    ? { ...f.binding.source, id: "mc06-sdk-early-another-source" }
                    : f.binding.source,
                externalThreadID:
                  kind === "empty-session"
                    ? ""
                    : kind === "changed-session"
                      ? "sdk-other-session"
                      : f.binding.externalThreadID,
                settlement: kind === "empty-text" ? { status: "completed", text: " \n" } : f.binding.settlement,
              } satisfies ConstructorParameters<typeof DelegationReceipt.Binding>[0]
              if (kind === "missing-message") delete altered.sdkMessage
              if (["empty-session", "changed-session", "empty-message"].includes(kind))
                altered.sdkMessage = new DelegationReceipt.SdkMessage({
                  sessionID:
                    kind === "empty-session"
                      ? ""
                      : kind === "changed-session"
                        ? "sdk-other-session"
                        : sdkMessage.sessionID,
                  messageID: kind === "empty-message" ? "" : sdkMessage.messageID,
                })
              yield* opened.kv.set(
                f.key,
                Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
                  new DelegationReceipt.Binding(altered),
                ),
              )
            }
            if (kind === "tool-ended")
              yield* opened.bus.publish(SessionEvent.Tool.Failed, {
                sessionID: opened.root.id,
                assistantMessageID: f.binding.source.messageID,
                id: f.binding.source.id,
                error: {
                  type: "OwnerEndedTool",
                  message: "The original source Tool ended before raw checkpoint recovery.",
                },
                executed: false,
              })
            const ownerGate = yield* Deferred.make<void>()
            yield* Effect.addFinalizer(() => Deferred.succeed(ownerGate, undefined).pipe(Effect.asVoid))
            if (kind === "active-parent") {
              const started = yield* Deferred.make<void>()
              yield* opened.llm.push(
                Stream.fromEffect(
                  Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(ownerGate))),
                ).pipe(
                  Stream.flatMap(() =>
                    Stream.fromIterable(TestLLM.text("The new parent owner finished.", "mc06-sdk-early-raw-new-owner")),
                  ),
                ),
              )
              yield* opened.sessions.prompt({
                sessionID: opened.root.id,
                text: "Start a new owner before raw SDK checkpoint recovery.",
              })
              yield* awaitWithTimeout(Deferred.await(started), "The new raw-checkpoint parent owner did not start")
              expect(yield* opened.runs.isActive(opened.root.id)).toBe(true)
            }
            const before = yield* Effect.all({
              tasks: opened.tasks.get(opened.root.id),
              binding: opened.kv.get(f.key),
              state: opened.delegations.foldState(f.binding.delegationID),
              tool: mc07Result(opened, f.id),
              deliveries: events.deliveries,
              reviews: events.reviews,
              successes: events.successes,
              metas: events.metas,
            })
            const recovered = yield* opened.execution.recoverPending
            expect(recovered.scanAvailable).toBe(true)
            expect(recovered.parents).not.toContain(opened.root.id)
            yield* opened.execution.recoverPending
            expect(
              yield* Effect.all({
                tasks: opened.tasks.get(opened.root.id),
                binding: opened.kv.get(f.key),
                state: opened.delegations.foldState(f.binding.delegationID),
                tool: mc07Result(opened, f.id),
                deliveries: events.deliveries,
                reviews: events.reviews,
                successes: events.successes,
                metas: events.metas,
              }),
            ).toEqual(before)
            expect(before.deliveries).toEqual([])
            expect(before.reviews).toEqual([])
            expect(before.successes).toEqual([])
            expect(yield* opened.jobs.get(f.key)).toBeUndefined()
            expect(f.queries).toHaveLength(1)
            expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
            if (kind === "active-parent") {
              yield* Deferred.succeed(ownerGate, undefined)
              yield* awaitWithTimeout(
                opened.runs.awaitIdle(opened.root.id),
                "The new raw-checkpoint parent owner did not finish",
              )
            }
          }).pipe(
            Effect.catchCause((cause) => Effect.die(new Error(`Raw SDK checkpoint ${kind}: ${Cause.pretty(cause)}`))),
          ),
        )
    }),
  30_000,
)

effectTest.live(
  "MC06 SDK review keeps R1 rejection and R2 approval in one session through local completion and archive",
  () =>
    Effect.gen(function* () {
      const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt")
      const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk)) }
      sdk.outputs[0] =
        "MC06_SDK_REVIEW_0" +
        sdk.text +
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: f.digest,
          verdict: "rejected",
          findings: [{ file: "artifact.txt", severity: "blocking", summary: "Replace r1 with r2 and preserve base." }],
          summary: "R1 requires the requested repair.",
        })}</review>`
      expect(sdk.outputs[0].charCodeAt(4095)).toBe(0xd83d)
      yield* Deferred.succeed(sdk.resultGate, undefined)
      const first = yield* sdkTask(f, "mc06-sdk-review-r1", {
        description: "Review the real R1 with the SDK",
        prompt: "Read the bound artifact and return the complete typed review.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        intent: "review",
        attended: false,
        delegation_id: f.receipt.delegationID,
        revision_digest: f.digest,
      })
      if (first.tool.state.status !== "completed")
        return yield* Effect.die(
          new Error(
            `SDK R1 review did not complete: ${JSON.stringify(first.tool.state)}; SDK queries=${sdk.queries.length}; SDK state=${JSON.stringify(sdk.state)}`,
          ),
        )
      const r1 = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(first.text)
      const r1Receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(first.tool.state.metadata?.externalReceipt)
      expect(r1.output).toBe(sdk.outputs[0])
      expect(r1.governance).toMatchObject({
        kind: "review",
        status: "valid",
        reviewedRevisionDigest: f.digest,
        envelope: { verdict: "rejected" },
      })
      if (r1.governance?.kind !== "review" || r1.governance.status !== "valid")
        return yield* Effect.die(new Error("SDK R1 has no valid review governance"))
      expect(r1.governance.receipt).toEqual(r1Receipt)
      expect(r1Receipt.source).toEqual({ type: "tool", messageID: first.assistant.id, id: "mc06-sdk-review-r1" })
      expect(r1Receipt.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: "sdk-session-1", messageID: "sdk-result-1" }),
      )
      const rejected = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(rejected?.reviews.map((review) => review.verdict)).toEqual(["rejected"])
      expect(rejected?.delegation.rejectionBlocked).toBe(true)
      expect(rejected?.participants.get(r1Receipt.participantID)).toMatchObject({
        provider: "claude-code",
        role: "reviewer",
      })
      expect(rejected?.turns.get(r1Receipt.turnID)).toMatchObject({ kind: "review", revisionDigest: f.digest })
      const repairPrompt = `Apply this original SDK finding to R1.\n${r1.output}`
      const count = (yield* f.llm.requests()).length
      yield* f.llm.push(
        TestLLM.tool("mc06-sdk-review-repair", TaskTool.name, {
          description: "Repair the SDK rejection in the original child",
          prompt: repairPrompt,
          subagent_type: f.worker,
          delegation_id: f.receipt.delegationID,
          participant_id: f.receipt.participantID,
          task_id: f.receipt.childSessionID,
          command: "append",
          artifact_path: "artifact.txt",
        }),
        TestLLM.tool("mc06-sdk-review-repair-write", "write", { path: "artifact.txt", content: "base\nr2\n" }),
        TestLLM.text("R2 is ready in the original child.", "mc06-sdk-review-repair-child"),
        TestLLM.text("Consumed the complete R2 producer.", "mc06-sdk-review-repair-parent"),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Repair R1 in the same original producer." })
      yield* awaitWithTimeout(f.llm.wait(count + 4), "SDK R2 repair did not reach the original parent", "10 seconds")
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK R2 repair did not settle")
      const repair = yield* mc07Consumed(f, "mc06-sdk-review-repair")
      const producer = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationService.Governance))(
        repair.text.match(/<task_governance>([\s\S]*?)<\/task_governance>/)?.[1],
      )
      if (producer.kind !== "revision" || !("artifact" in producer))
        return yield* Effect.die(new Error("R2 producer proof is missing"))
      expect(producer.receipt.childSessionID).toBe(f.receipt.childSessionID)
      expect(producer.receipt.participantID).toBe(f.receipt.participantID)
      const digest = producer.artifact.revisionDigest
      expect(digest).not.toBe(f.digest)
      sdk.outputs[1] =
        "MC06_SDK_REVIEW_1_" +
        sdk.continuedText +
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: digest,
          verdict: "approved",
          findings: [],
          summary: "R2 preserves base and contains the requested repair.",
        })}</review>`
      expect(sdk.outputs[1].charCodeAt(4095)).toBe(0xd83d)
      const second = yield* sdkTask(f, "mc06-sdk-review-r2", {
        description: "Review R2 in the original SDK session",
        prompt: "Read the bound R2 and return its complete typed verdict.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        intent: "review",
        attended: false,
        delegation_id: f.receipt.delegationID,
        participant_id: r1Receipt.participantID,
        command: "append",
        revision_digest: digest,
      })
      if (second.tool.state.status !== "completed")
        return yield* Effect.die(new Error("SDK R2 review did not complete"))
      const r2 = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(second.text)
      const r2Receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(second.tool.state.metadata?.externalReceipt)
      expect(r2.output).toBe(sdk.outputs[1])
      expect(r2.governance).toMatchObject({
        kind: "review",
        status: "valid",
        reviewedRevisionDigest: digest,
        envelope: { verdict: "approved" },
      })
      expect(r2Receipt.participantID).toBe(r1Receipt.participantID)
      expect(r2Receipt.sdkMessage.sessionID).toBe(r1Receipt.sdkMessage.sessionID)
      expect(r2Receipt.sdkMessage.messageID).toBe("sdk-result-2")
      expect(r2Receipt.turnID).not.toBe(r1Receipt.turnID)
      expect(r2Receipt.source).toEqual({ type: "tool", messageID: second.assistant.id, id: "mc06-sdk-review-r2" })
      expect(r2.parentTaskID).not.toBe(r1.parentTaskID)
      expect(sdk.queries).toHaveLength(2)
      expect(sdk.queries[1]?.options?.resume).toBe(r1Receipt.sdkMessage.sessionID)
      const blocked = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(blocked?.reviews.map((review) => review.verdict)).toEqual(["rejected", "approved"])
      expect(blocked?.delegation.rejectionBlocked).toBe(true)
      const refusal = yield* sdkTask(f, "mc06-sdk-review-blocked-complete", {
        description: "Attempt completion with the original SDK blocker",
        prompt: "Complete only if the SDK rejection has been retracted.",
        subagent_type: f.worker,
        delegation_id: f.receipt.delegationID,
        command: "complete",
      })
      expect(refusal.tool.state.status).toBe("error")
      expect(yield* f.delegations.foldState(f.receipt.delegationID)).toEqual(blocked)
      const retracted = yield* sdkTask(f, "mc06-sdk-review-retract", {
        description: "Retract the original SDK R1 rejection",
        prompt: "R2 fixed R1 and the same SDK reviewer approved R2; retract the original rejection.",
        subagent_type: f.worker,
        delegation_id: f.receipt.delegationID,
        participant_id: r1Receipt.participantID,
        command: "retract_rejection",
      })
      expect(retracted.tool.state.status).toBe("completed")
      expect((yield* f.delegations.foldState(f.receipt.delegationID))?.delegation.rejectionBlocked).toBe(false)
      const kv = yield* KV.Service
      const originalBindings = yield* Effect.forEach([r1Receipt, r2Receipt], (receipt) =>
        kv.get(DelegationReceipt.key(receipt)),
      )
      const completed = yield* sdkTask(f, "mc06-sdk-review-complete", {
        description: "Complete and locally archive the SDK reviewed R2",
        prompt: "Complete the approved R2 and retain its SDK session history.",
        subagent_type: f.worker,
        delegation_id: f.receipt.delegationID,
        command: "complete",
      })
      expect(completed.tool.state.status).toBe("completed")
      const archived = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(archived?.delegation.status).toBe("archived")
      expect(archived?.archivedFrom).toBe("completed")
      expect(archived?.reviews).toEqual(blocked?.reviews)
      expect(yield* Effect.promise(() => Bun.file(`${f.root.location.directory}/artifact.txt`).text())).toBe(
        "base\nr2\n",
      )
      const database = yield* Database.Service
      for (const [index, receipt] of [r1Receipt, r2Receipt].entries()) {
        const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
          yield* kv.get(DelegationReceipt.key(receipt)),
        )
        expect(yield* kv.get(DelegationReceipt.key(receipt))).toEqual(originalBindings[index])
        expect(binding.archiveReceipts ?? []).toEqual([])
        expect(binding.review?.revisionDigest).toBe(index === 0 ? f.digest : digest)
        expect(binding.reviewText).toBe(index === 0 ? "base\nr1\n" : "base\nr2\n")
        expect(binding.settlement?.text).toBe(sdk.outputs[index])
        expect(binding.source).toEqual(receipt.source)
        expect(sdk.queries[index]?.prompt).toContain(
          JSON.stringify({ reference: binding.review, text: binding.reviewText }),
        )
        const meta = yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(
            and(
              eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
              eq(MetaAgentStepTable.tool_call_id, receipt.source.id),
              eq(MetaAgentStepTable.type, "receipt"),
            ),
          )
        expect(meta).toHaveLength(1)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
      }
      expect(sdk.state).toEqual({ reads: 2, closed: 2, hookCalls: 2 })
      expect(sdk.queries).toHaveLength(2)
    }),
  30_000,
)

for (const invalid of ["missing", "malformed", "wrong_digest"] as const)
  effectTest.live(`MC06 SDK review keeps ${invalid} envelope invalid while the parent consumes the full result`, () =>
    Effect.gen(function* () {
      const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt")
      const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk)) }
      sdk.outputs[0] =
        sdk.text +
        (invalid === "missing"
          ? "No typed review was returned."
          : invalid === "malformed"
            ? "<review>{not-json}</review>"
            : `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: `rev_${"0".repeat(64)}`, verdict: "approved", findings: [], summary: "A different artifact was reviewed." })}</review>`)
      yield* Deferred.succeed(sdk.resultGate, undefined)
      const id = `mc06-sdk-review-invalid-${invalid}`
      const result = yield* sdkTask(f, id, {
        description: "Review the current R1",
        prompt: "Read the real artifact and return the complete review.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        intent: "review",
        attended: false,
        delegation_id: f.receipt.delegationID,
        revision_digest: f.digest,
      })
      expect(result.tool.state.status).toBe("completed")
      if (result.tool.state.status !== "completed")
        return yield* Effect.die(new Error("Invalid SDK review lost its actual result"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(result.text)
      expect(output.output).toBe(sdk.outputs[0])
      expect(output.governance).toMatchObject({ kind: "review", status: "invalid", reason: invalid })
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(result.tool.state.metadata?.externalReceipt)
      expect(receipt.source).toEqual({ type: "tool", messageID: result.assistant.id, id })
      const kv = yield* KV.Service
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(receipt)))
      expect(binding.settlement?.text).toBe(sdk.outputs[0])
      expect(binding.settlement?.governance).toEqual(output.governance)
      expect(binding.review?.revisionDigest).toBe(f.digest)
      const state = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(state?.reviews).toEqual([])
      expect(state?.delegation.latestRevisionDigest).toBe(f.digest)
      expect(state?.revisions).toHaveLength(1)
      expect(yield* Effect.promise(() => Bun.file(`${f.root.location.directory}/artifact.txt`).text())).toBe(
        "base\nr1\n",
      )
      const database = yield* Database.Service
      expect(
        yield* database.db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.session_id, f.root.id)),
      ).toEqual([])
      expect(sdk.queries).toHaveLength(1)
      expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
  )

effectTest.live("MC06 SDK review denies the artifact read before Task admission or SDK query", () =>
  Effect.gen(function* () {
    const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt")
    const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk)) }
    const before = yield* f.delegations.foldState(f.receipt.delegationID)
    const tasks = yield* SessionTask.Service
    const beforeTasks = yield* tasks.get(f.root.id)
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "artifact.txt", effect: "deny" },
      ],
    })
    const result = yield* sdkTask(f, "mc06-sdk-review-read-deny", {
      description: "Attempt to review the denied R1",
      prompt: "Read and review the bound artifact under its current policy.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
      intent: "review",
      attended: false,
      delegation_id: f.receipt.delegationID,
      revision_digest: f.digest,
    })
    expect(result.tool.state.status).toBe("error")
    expect(yield* f.delegations.foldState(f.receipt.delegationID)).toEqual(before)
    expect(yield* tasks.get(f.root.id)).toEqual(beforeTasks)
    expect(sdk.queries).toEqual([])
    expect(sdk.state).toEqual({ reads: 0, closed: 0, hookCalls: 0 })
  }),
)

for (const terminal of ["cancelled", "missing-uuid"] as const)
  effectTest.live(`MC06 SDK review ${terminal} cannot approve from an incomplete or late terminal identity`, () =>
    Effect.gen(function* () {
      const sdk = yield* sdkTaskSetup("Read", terminal !== "missing-uuid", undefined, false, "artifact.txt")
      const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk)) }
      const id = `mc06-sdk-review-terminal-${terminal}`
      sdk.outputs[0] =
        sdk.text +
        `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: f.digest, verdict: "approved", findings: [], summary: "The artifact would otherwise be approved." })}</review>`
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Review before the terminal boundary",
          prompt: "Read R1 and return the complete typed review.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          intent: "review",
          attended: false,
          delegation_id: f.receipt.delegationID,
          revision_digest: f.digest,
        }),
        TestLLM.text("Consumed the stopped SDK review.", `${id}-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Review R1 before its final SDK identity is available." })
      yield* awaitWithTimeout(Deferred.await(sdk.afterRead), "SDK reviewer did not read the original artifact")
      const active = yield* f.delegations.foldState(f.receipt.delegationID)
      const participant = [...(active?.participants.values() ?? [])].find(
        (value) => value.provider === "claude-code" && value.role === "reviewer",
      )
      if (!participant) return yield* Effect.die(new Error("SDK reviewer is missing"))
      if (terminal === "cancelled")
        yield* awaitWithTimeout(
          DelegationExecution.Service.use((execution) =>
            execution.interrupt({ delegationID: f.receipt.delegationID, participantID: participant.id }),
          ),
          "SDK reviewer cancellation retained its settlement lock",
          "5 seconds",
        )
      if (terminal === "missing-uuid") yield* Deferred.succeed(sdk.resultGate, undefined)
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Stopped SDK review did not release its parent")
      if (terminal === "cancelled") {
        const count = (yield* f.llm.requests()).length
        yield* f.runs.resume(f.root.id)
        yield* awaitWithTimeout(f.llm.wait(count + 1), "Resumed parent did not consume the cancelled SDK review")
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Resumed SDK review parent did not finish")
      }
      const result = yield* mc07Consumed(f, id)
      expect(result.tool.state.status).toBe("error")
      if (result.tool.state.status !== "error")
        return yield* Effect.die(new Error("Stopped SDK review unexpectedly completed"))
      expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(result.tool.state.metadata?.governance).toBeUndefined()
      const before = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(before?.reviews).toEqual([])
      const delivery = [...(before?.deliveries.values() ?? [])].find((value) => value.participantID === participant.id)
      expect(delivery?.status).toBe(terminal === "cancelled" ? "cancelled" : "failed")
      const tasks = yield* SessionTask.Service
      const beforeTasks = yield* tasks.get(f.root.id)
      expect(beforeTasks.map((task) => task.status)).toEqual([
        "completed",
        terminal === "cancelled" ? "cancelled" : "failed",
      ])
      yield* Deferred.succeed(sdk.resultGate, undefined)
      yield* awaitWithTimeout(Deferred.await(sdk.nativeFinished), "Late SDK reviewer frame did not close")
      expect(yield* f.delegations.foldState(f.receipt.delegationID)).toEqual(before)
      expect(yield* tasks.get(f.root.id)).toEqual(beforeTasks)
      expect(sdk.queries).toHaveLength(1)
      expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
      expect(yield* Effect.promise(() => Bun.file(`${f.root.location.directory}/artifact.txt`).text())).toBe(
        "base\nr1\n",
      )
    }),
  )

for (const scenario of [
  { kind: "complete", name: "restores the original complete governance exactly once" },
  { kind: "conflict", name: "defers for a conflicting SDK session" },
  { kind: "invalid", name: "restores full text and invalid governance exactly once" },
  { kind: "owner", name: "defers when a new parent owner starts during finalization" },
] as const)
  testEffect(Layer.empty).live(`MC06 SDK review cold recovery ${scenario.name}`, () =>
    Effect.gen(function* () {
      const originalContext = yield* Layer.build(metaLayer(true))
      const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt").pipe(
        Effect.provide(originalContext),
      )
      const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk).pipe(Effect.provide(originalContext))) }
      const id = `mc06-sdk-review-cold-${scenario.kind}`
      sdk.outputs[0] =
        sdk.text +
        (scenario.kind === "invalid"
          ? "<review>{not-json}</review>"
          : `<review>${JSON.stringify({ kind: "aigcfroge.review.v1", reviewed_revision_digest: f.digest, verdict: "approved", findings: [], summary: "The original R1 is approved." })}</review>`)
      const locations = Context.get(originalContext, LocationServiceMap.Service)
      const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(f.root.location)))
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* hooks.register("tool", "execute.after", (event) => {
        if (event.tool !== "task" || event.id !== id || event.status !== "completed") return Effect.void
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Deferred.succeed(sdk.resultGate, undefined)
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Persist the SDK review before publishing its parent result",
          prompt: "Review the original bound R1 and preserve the complete verdict.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          intent: "review",
          attended: false,
          delegation_id: f.receipt.delegationID,
          revision_digest: f.digest,
        }),
        TestLLM.text("Consumed the original persisted SDK review.", `${id}-original-parent`),
      )
      yield* f.sessions.prompt({ sessionID: f.root.id, text: "Capture the real completed SDK review checkpoint." })
      yield* awaitWithTimeout(Deferred.await(entered), "SDK review did not reach its after hook")
      const originalKV = Context.get(originalContext, KV.Service)
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(
        (yield* originalKV.scan({ prefix: `delegation:external:${f.receipt.delegationID}:` })).entries[0]?.value,
      )
      expect(binding.source.id).toBe(id)
      expect(binding.settlement?.text).toBe(sdk.outputs[0])
      expect(binding.settlement?.governance).toMatchObject(
        scenario.kind === "invalid"
          ? { kind: "review", status: "invalid", reason: "malformed" }
          : { kind: "review", status: "valid", reviewedRevisionDigest: f.digest },
      )
      expect((yield* mc07Result(f, id)).tool.state.status).toBe("running")
      expect((yield* f.delegations.foldState(f.receipt.delegationID))?.reviews).toHaveLength(
        scenario.kind === "invalid" ? 0 : 1,
      )
      const originalDatabase = Context.get(originalContext, Database.Service)
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-review-cold.sqlite`
      yield* originalDatabase.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Original SDK review parent did not finish")
      const original = yield* mc07Consumed(f, id)
      if (original.tool.state.status !== "completed") return yield* Effect.die(new Error("Original SDK review failed"))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(original.tool.state.metadata?.externalReceipt)
      const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
      const database = Context.get(context, Database.Service)
      expect(database).not.toBe(originalDatabase)
      const sessions = Context.get(context, Session.Service)
      const root = yield* sessions.get(f.root.id)
      const local = Context.get(context, LocationServiceMap.Service).get(root.location)
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(f.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [f.metaModel, f.executorModel].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(Effect.provide(local))
      const opened = {
        ...f,
        sessions,
        root,
        llm: Context.get(context, TestLLM.Test),
        runs: Context.get(context, SessionExecution.Service),
      }
      const kv = Context.get(context, KV.Service)
      const key = DelegationReceipt.key(receipt)
      if (scenario.kind === "conflict")
        yield* kv.set(
          key,
          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
            new DelegationReceipt.Binding({ ...binding, externalThreadID: "sdk-conflicting-review-session" }),
          ),
        )
      const beforeBinding = yield* kv.get(key)
      const tasks = Context.get(context, SessionTask.Service)
      const beforeTasks = yield* tasks.get(root.id)
      const delegations = Context.get(context, DelegationService.Service)
      const beforeState = yield* delegations.foldState(f.receipt.delegationID)
      const metas = database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, root.id),
            eq(MetaAgentStepTable.tool_call_id, id),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
        .all()
      const successes = database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, root.id),
            eq(
              EventTable.type,
              Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
            ),
          ),
        )
        .all()
        .pipe(Effect.map((events) => events.filter((event) => event.data.id === id)))
      expect(yield* metas).toEqual([])
      expect(yield* successes).toEqual([])
      const execution = Context.get(context, DelegationExecution.Service)
      if (scenario.kind === "owner") {
        const before = Effect.all({
          result: mc07Result(opened, id),
          state: delegations.foldState(f.receipt.delegationID),
          tasks: tasks.get(root.id),
          binding: kv.get(key),
          metas,
          successes,
        })
        const observed = yield* Deferred.make<Effect.Success<typeof before>>()
        const held = yield* Deferred.make<void>()
        const ownerRelease = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(ownerRelease, undefined).pipe(Effect.asVoid))
        yield* opened.llm.push(
          Stream.fromEffect(Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(ownerRelease)))).pipe(
            Stream.flatMap(() =>
              Stream.fromIterable(TestLLM.text("The new parent owner completed.", `${id}-new-owner`)),
            ),
          ),
        )
        const coldHooks = yield* PluginHooks.Service.pipe(Effect.provide(local))
        yield* coldHooks.register("tool", "execute.after", (event) => {
          if (event.tool !== "task" || event.id !== id || event.status !== "completed") return Effect.void
          return Effect.gen(function* () {
            yield* opened.sessions.prompt({
              sessionID: root.id,
              text: "New parent input while the old SDK review is being finalized.",
            })
            yield* awaitWithTimeout(Deferred.await(held), "The new parent owner did not start")
            yield* Deferred.succeed(observed, yield* before)
          }).pipe(Effect.orDie)
        })
        yield* execution.recoverPending
        expect(yield* opened.runs.isActive(root.id)).toBe(true)
        expect(yield* before).toEqual(
          yield* awaitWithTimeout(Deferred.await(observed), "Cold SDK recovery did not observe the new owner"),
        )
        expect(sdk.queries).toHaveLength(1)
        expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
        yield* Deferred.succeed(ownerRelease, undefined)
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "The new parent owner did not finish")
        return
      }
      yield* execution.recoverPending
      if (scenario.kind === "conflict") {
        expect((yield* mc07Result(opened, id)).tool.state.status).toBe("running")
        yield* execution.recoverPending
        expect(yield* successes).toEqual([])
        expect(yield* metas).toEqual([])
      }
      if (scenario.kind !== "conflict") {
        const recovered = yield* mc07Result(opened, id)
        if (recovered.tool.state.status !== "completed")
          return yield* Effect.die(new Error("Cold SDK review was not recovered"))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(
          recovered.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        expect(output.output).toBe(sdk.outputs[0])
        expect(output.governance).toEqual(binding.settlement?.governance)
        expect(output.sdkMessage).toEqual(receipt.sdkMessage)
        expect(recovered.tool.state.content).toEqual(original.tool.state.content)
        expect((yield* execution.wait(receipt)).governance).toEqual(output.governance)
        yield* execution.recoverPending
        expect(yield* mc07Result(opened, id)).toEqual(recovered)
        yield* opened.llm.push(TestLLM.text("Consumed the complete cold SDK review proof.", `${id}-cold-parent`))
        yield* opened.runs.resume(root.id)
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "Recovered SDK review parent did not finish")
        expect((yield* mc07Consumed(opened, id)).text).toBe(original.text)
        const meta = yield* metas
        expect(meta).toHaveLength(1)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
        expect(yield* successes).toHaveLength(1)
        const messages = yield* sessions.context(root.id)
        yield* execution.recoverPending
        expect(yield* metas).toEqual(meta)
        expect(yield* successes).toHaveLength(1)
        expect(yield* sessions.context(root.id)).toEqual(messages)
      }
      expect(yield* delegations.foldState(f.receipt.delegationID)).toEqual(beforeState)
      expect(yield* tasks.get(root.id)).toEqual(beforeTasks)
      expect(yield* kv.get(key)).toEqual(beforeBinding)
      expect(sdk.queries).toHaveLength(1)
      expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
  )

effectTest.live(
  "MC06 SDK review requirement leaves an ordinary SDK implementer locally completable without a reviewer",
  () =>
    Effect.gen(function* () {
      const sdk = yield* sdkTaskSetup()
      yield* Deferred.succeed(sdk.resultGate, undefined)
      const result = yield* sdkTask(sdk, "mc06-sdk-review-ordinary-implementer", {
        description: "Run ordinary readonly SDK analysis",
        prompt: "Read the scoped input and return its complete analysis.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
      })
      if (result.tool.state.status !== "completed")
        return yield* Effect.die(new Error("Ordinary SDK implementer was blocked"))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(result.tool.state.metadata?.externalReceipt)
      const kv = yield* KV.Service
      const key = DelegationReceipt.key(receipt)
      const beforeBinding = yield* kv.get(key)
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(receipt.delegationID)
      expect(state?.participants.get(receipt.participantID)).toMatchObject({
        provider: "claude-code",
        role: "implementer",
      })
      expect(state?.reviews).toEqual([])
      const execution = yield* DelegationExecution.Service
      yield* execution.close({ delegationID: receipt.delegationID, requireComplete: true })
      yield* delegations.complete({
        delegationID: receipt.delegationID,
        summary: "The ordinary readonly analysis is complete.",
        source: receipt.source,
      })
      expect((yield* delegations.foldState(receipt.delegationID))?.delegation.status).toBe("archived")
      expect(yield* kv.get(key)).toEqual(beforeBinding)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key)).archiveReceipts ?? []).toEqual([])
      expect((yield* DelegationExecution.Service.use((execution) => execution.wait(receipt))).text).toBe(sdk.text)
      expect(sdk.queries).toHaveLength(1)
    }),
)

const queuedSdkSetup = Effect.fnUntraced(function* (continuedResult?: { sessionID?: string; messageID?: string }) {
  const f = yield* sdkTaskSetup("Read", true, continuedResult, true, undefined, true)
  yield* f.sessions.setPermissions({
    sessionID: f.root.id,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "ask" },
    ],
  })
  yield* f.llm.serve(() => TestLLM.text("Consumed the original SDK queue facts.", "mc06-sdk-queue-notice-parent"))
  const first = yield* sdkTask(f, "mc06-sdk-queue-first", {
    description: "Start the original SDK background Task",
    prompt: "Read the scoped input and preserve the complete first result.",
    execution_type: "external-cli",
    cli_target: "claude-code",
    subagent_type: "claude-code",
    attended: true,
    background: true,
  })
  if (first.tool.state.status !== "completed")
    return yield* Effect.die(new Error(`SDK queue first ACK failed: ${JSON.stringify(first.tool.state)}`))
  const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(first.text)
  expect(admission).toMatchObject({ execution: "admitted", status: "running" })
  const firstRequest = yield* pollWithTimeout(
    f.permission
      .forSession(f.root.id)
      .pipe(
        Effect.map((requests) =>
          requests.find((request) => request.source?.type === "tool" && request.source.id === "mc06-sdk-queue-first"),
        ),
      ),
    "The original SDK queue Read did not reach its owning permission",
  )
  const queued = yield* sdkTask(f, "mc06-sdk-queue-pending", {
    description: "Queue the default append in background",
    prompt: "Run this original queued SDK input after its successful physical predecessor.",
    execution_type: "external-cli",
    cli_target: "claude-code",
    subagent_type: "claude-code",
    attended: true,
    background: true,
    delegation_id: admission.delegationID,
    participant_id: admission.participantID,
  })
  if (queued.tool.state.status !== "completed")
    return yield* Effect.die(
      new Error(`SDK queue ACK failed: ${JSON.stringify(queued.tool.state)}; queries=${f.queries.length}`),
    )
  const queueAdmission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(queued.text)
  expect(queueAdmission).toMatchObject({
    execution: "queued",
    status: "queued",
    delegationID: admission.delegationID,
    participantID: admission.participantID,
  })
  const kv = yield* KV.Service
  const bindings = (yield* kv.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries.map((entry) =>
    Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value),
  )
  const firstBinding = bindings.find((binding) => binding.source.id === "mc06-sdk-queue-first")
  const queueBinding = bindings.find((binding) => binding.source.id === "mc06-sdk-queue-pending")
  const firstControl = f.controls[0]
  const queueControl = f.controls[1]
  if (!firstBinding || !queueBinding || !firstControl || !queueControl)
    return yield* Effect.die(new Error("SDK queue lost an original Binding or controlled query boundary"))
  expect(firstBinding.sdkMessage).toBeUndefined()
  expect(firstBinding.externalThreadID).toBeUndefined()
  expect(queueBinding.sdkMessage).toBeUndefined()
  expect(queueBinding.externalThreadID).toBeUndefined()
  expect(queueAdmission).not.toHaveProperty("sdkMessage")
  expect(queueAdmission.externalThreadID).toBeUndefined()
  expect(queueAdmission.externalTurnID).toBeUndefined()
  expect(queued.tool.state.metadata?.externalReceipt).toBeUndefined()
  expect(f.queries).toHaveLength(1)
  expect(f.state).toEqual({ reads: 0, closed: 0, hookCalls: 1 })
  const tasks = yield* SessionTask.Service
  expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["in_progress", "in_progress"])
  return {
    ...f,
    first,
    admission,
    firstRequest,
    queued,
    queueAdmission,
    firstBinding,
    queueBinding,
    firstControl,
    queueControl,
    firstKey: DelegationReceipt.key(firstBinding),
    queueKey: DelegationReceipt.key(queueBinding),
    noticeID: DelegationReceipt.notificationID(
      DelegationFold.inputID(queueBinding.delegationID, queueBinding),
      queueBinding.parentTaskID,
    ),
  }
})

effectTest.live(
  "MC06 SDK queue admits default and explicit appends without future identities and runs full results after each predecessor scope",
  () =>
    Effect.gen(function* () {
      const f = yield* queuedSdkSetup()
      const last = yield* sdkTask(f, "mc06-sdk-queue-last", {
        description: "Append with an explicit background queue delivery",
        prompt: "Run this third SDK input after the original queued input completes.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        attended: true,
        background: true,
        command: "append",
        delegation_id: f.admission.delegationID,
        participant_id: f.admission.participantID,
      })
      if (last.tool.state.status !== "completed")
        return yield* Effect.die(new Error(`The explicit SDK queue ACK failed: ${JSON.stringify(last.tool.state)}`))
      const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(last.text)
      expect(admission).toMatchObject({
        execution: "queued",
        status: "queued",
        participantID: f.admission.participantID,
      })
      expect(admission.externalThreadID).toBeUndefined()
      expect(admission.externalTurnID).toBeUndefined()
      expect(admission).not.toHaveProperty("sdkMessage")
      expect(last.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(f.queries).toHaveLength(1)
      const kv = yield* KV.Service
      const lastBinding = (yield* kv.scan({ prefix: `delegation:external:${admission.delegationID}:` })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find((binding) => binding.source.id === "mc06-sdk-queue-last")
      if (!lastBinding) return yield* Effect.die(new Error("The explicit queued SDK Binding is missing"))
      expect(lastBinding.sdkMessage).toBeUndefined()
      expect(lastBinding.externalThreadID).toBeUndefined()
      const acks = [f.first, f.queued, last]
      const bindings = [f.firstBinding, f.queueBinding, lastBinding]
      expect(new Set(bindings.map((binding) => binding.parentTaskID)).size).toBe(3)
      expect(new Set(bindings.map((binding) => binding.turnID)).size).toBe(3)
      const tasks = yield* SessionTask.Service
      const delegations = yield* DelegationService.Service
      const state = yield* delegations.foldState(f.admission.delegationID)
      expect([...(state?.turns.values() ?? [])].sort((a, b) => a.seq - b.seq).map((turn) => turn.delivery)).toEqual([
        "steer",
        "queue",
        "queue",
      ])
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual([
        "in_progress",
        "in_progress",
        "in_progress",
      ])
      const database = yield* Database.Service
      const metas = database.db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
        .all()
      expect(yield* metas).toEqual([])
      const permissionIDs: string[] = []
      for (const [index, binding] of bindings.entries()) {
        const control = f.controls[index]
        const ack = acks[index]
        if (!control || !ack) return yield* Effect.die(new Error("SDK queue lost its ordered boundary"))
        f.outputs[index] = `MC06_SDK_QUEUE_${index}_${f.text}`
        const request = yield* pollWithTimeout(
          f.permission
            .forSession(f.root.id)
            .pipe(
              Effect.map((requests) =>
                requests.find((request) => request.source?.type === "tool" && request.source.id === binding.source.id),
              ),
            ),
          "The queued SDK query did not keep its own Read permission source",
        )
        expect(request).toMatchObject({ action: "read", sessionID: f.root.id, source: binding.source })
        permissionIDs.push(request.id)
        expect(new Set(permissionIDs).size).toBe(index + 1)
        expect(f.queries).toHaveLength(index + 1)
        expect(f.closedBeforeQuery[index]).toBe(index)
        expect(f.queries[index]?.options?.resume).toBe(index === 0 ? undefined : "sdk-session-1")
        yield* f.permission.reply({ requestID: request.id, reply: "once" })
        yield* awaitWithTimeout(Deferred.await(control.afterRead), "The queued SDK Read did not finish")
        yield* Deferred.succeed(control.resultGate, undefined)
        yield* awaitWithTimeout(
          Deferred.await(control.afterResult),
          "The SDK terminal frame did not reach its held tail",
        )
        expect(f.state.closed).toBe(index)
        expect(f.queries).toHaveLength(index + 1)
        yield* Deferred.succeed(control.tailGate, undefined)
        const noticeID = DelegationReceipt.notificationID(
          DelegationFold.inputID(binding.delegationID, binding),
          binding.parentTaskID,
        )
        const notice = yield* pollWithTimeout(
          f.sessions
            .context(f.root.id)
            .pipe(
              Effect.map((messages) =>
                messages.find((message) => message.type === "synthetic" && message.id === noticeID),
              ),
            ),
          "The complete queued SDK result did not produce its original notification",
        )
        if (notice.type !== "synthetic") return yield* Effect.die(new Error("SDK queue notice is missing"))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text)
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(notice.metadata?.externalReceipt)
        const saved = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(binding)))
        expect(output).toMatchObject({
          status: "completed",
          parentTaskID: binding.parentTaskID,
          output: f.outputs[index],
          sdkMessage: { sessionID: "sdk-session-1", messageID: `sdk-result-${index + 1}` },
        })
        expect(saved.source).toEqual(binding.source)
        expect(saved.settlement).toEqual({ status: "completed", text: f.outputs[index] })
        expect(receipt.source).toEqual(binding.source)
        expect(DelegationReceipt.matches(saved, receipt)).toBe(true)
        yield* pollWithTimeout(
          f.llm
            .requests()
            .pipe(
              Effect.map((requests) =>
                requests.find((request) =>
                  request.messages.some(
                    (message) =>
                      message.role === "user" &&
                      message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
                  ),
                ),
              ),
            ),
          "The original parent did not consume the complete SDK queue notification as user content",
        )
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK queue notification consumer did not settle")
        const meta = (yield* metas).filter((row) => row.tool_call_id === binding.source.id)
        expect(meta).toHaveLength(1)
        expect(meta[0]?.status).toBe("completed")
        expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
        expect(JSON.stringify((yield* mc07Result(f, binding.source.id)).tool)).toBe(JSON.stringify(ack.tool))
        expect((yield* f.sessions.context(f.root.id)).filter((message) => message.id === noticeID)).toHaveLength(1)
      }
      expect(f.closedBeforeQuery).toEqual([0, 1, 2])
      expect(f.state).toEqual({ reads: 3, closed: 3, hookCalls: 3 })
      expect(f.queries).toHaveLength(3)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "completed", "completed"])
      expect(yield* metas).toHaveLength(3)
      const messages = yield* f.sessions.context(f.root.id)
      const receipts = yield* metas
      const execution = yield* DelegationExecution.Service
      yield* execution.recoverPending
      yield* execution.recoverPending
      expect(yield* f.sessions.context(f.root.id)).toEqual(messages)
      expect(yield* metas).toEqual(receipts)
      expect(f.queries).toHaveLength(3)
    }),
)

effectTest.live("MC06 SDK queue cancels one unstarted input precisely and keeps a later Read reject independent", () =>
  Effect.gen(function* () {
    const f = yield* queuedSdkSetup()
    const kv = yield* KV.Service
    const tasks = yield* SessionTask.Service
    const delegations = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const firstBinding = yield* kv.get(f.firstKey)
    const firstTask = (yield* tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)
    const firstDelivery = [
      ...((yield* delegations.foldState(f.admission.delegationID))?.deliveries.values() ?? []),
    ].find((delivery) => delivery.turnID === f.firstBinding.turnID)
    yield* awaitWithTimeout(
      execution.interrupt({
        delegationID: f.admission.delegationID,
        participantID: f.queueBinding.participantID,
        turnID: f.queueBinding.turnID,
      }),
      "Precise queued SDK cancellation retained the original Job lock",
      "5 seconds",
    )
    const cancelledNotice = yield* pollWithTimeout(
      f.sessions
        .context(f.root.id)
        .pipe(Effect.map((messages) => messages.find((message) => message.id === f.noticeID))),
      "The precisely cancelled SDK queue input did not notify its original parent",
    )
    if (cancelledNotice.type !== "synthetic")
      return yield* Effect.die(new Error("Cancelled SDK queue notice is missing"))
    const cancelled = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(
      cancelledNotice.text,
    )
    expect(cancelled).toMatchObject({
      execution: "queued",
      status: "cancelled",
      parentTaskID: f.queueBinding.parentTaskID,
    })
    expect(cancelled.externalThreadID).toBeUndefined()
    expect(cancelled).not.toHaveProperty("sdkMessage")
    yield* pollWithTimeout(
      f.llm
        .requests()
        .pipe(
          Effect.map((requests) =>
            requests.find((request) =>
              request.messages.some(
                (message) =>
                  message.role === "user" &&
                  message.content.some((part) => part.type === "text" && part.text.includes(cancelledNotice.text)),
              ),
            ),
          ),
        ),
      "The parent did not consume the exact SDK queue cancellation",
    )
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK queue cancellation consumer did not settle")
    expect(yield* kv.get(f.firstKey)).toEqual(firstBinding)
    expect((yield* tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)).toEqual(firstTask)
    expect(
      [...((yield* delegations.foldState(f.admission.delegationID))?.deliveries.values() ?? [])].find(
        (delivery) => delivery.turnID === f.firstBinding.turnID,
      ),
    ).toEqual(firstDelivery)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([f.firstRequest])
    expect(f.queries).toHaveLength(1)
    expect(f.state.closed).toBe(0)
    const later = yield* sdkTask(f, "mc06-sdk-queue-after-cancel", {
      description: "Queue a new independent input after the precise cancellation",
      prompt: "Read the scoped input using this new queued Task's own permission.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
      attended: true,
      background: true,
      command: "append",
      delegation_id: f.admission.delegationID,
      participant_id: f.admission.participantID,
    })
    if (later.tool.state.status !== "completed")
      return yield* Effect.die(new Error(`Later SDK queued ACK failed: ${JSON.stringify(later.tool.state)}`))
    const laterBinding = (yield* kv.scan({ prefix: `delegation:external:${f.admission.delegationID}:` })).entries
      .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
      .find((binding) => binding.source.id === "mc06-sdk-queue-after-cancel")
    if (!laterBinding) return yield* Effect.die(new Error("Later SDK queue Binding is missing"))
    yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
    yield* awaitWithTimeout(
      Deferred.await(f.firstControl.afterRead),
      "Original SDK Read did not finish after precise cancellation",
    )
    yield* Deferred.succeed(f.firstControl.resultGate, undefined)
    yield* awaitWithTimeout(Deferred.await(f.firstControl.afterResult), "Original SDK result did not reach its tail")
    expect(f.queries).toHaveLength(1)
    yield* Deferred.succeed(f.firstControl.tailGate, undefined)
    const request = yield* pollWithTimeout(
      f.permission
        .forSession(f.root.id)
        .pipe(
          Effect.map((requests) =>
            requests.find((request) => request.source?.type === "tool" && request.source.id === laterBinding.source.id),
          ),
        ),
      "The new SDK queue input did not get its independent Read request",
    )
    expect(request.id).not.toBe(f.firstRequest.id)
    expect(request.source).toEqual(laterBinding.source)
    expect(f.queries).toHaveLength(2)
    expect(f.queries[1]?.options?.resume).toBe("sdk-session-1")
    expect(f.closedBeforeQuery).toEqual([0, 1])
    expect(f.state.reads).toBe(1)
    yield* f.permission.reply({ requestID: request.id, reply: "reject" })
    yield* Deferred.succeed(f.queueControl.resultGate, undefined)
    yield* Deferred.succeed(f.queueControl.tailGate, undefined)
    const noticeID = DelegationReceipt.notificationID(
      DelegationFold.inputID(laterBinding.delegationID, laterBinding),
      laterBinding.parentTaskID,
    )
    const rejectedNotice = yield* pollWithTimeout(
      f.sessions
        .context(f.root.id)
        .pipe(
          Effect.map((messages) => messages.find((message) => message.type === "synthetic" && message.id === noticeID)),
        ),
      "The independent queued Read reject did not produce its failed notification",
    )
    if (rejectedNotice.type !== "synthetic")
      return yield* Effect.die(new Error("SDK queued Read reject notice is missing"))
    const rejected = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(
      rejectedNotice.text,
    )
    const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(rejectedNotice.metadata?.externalReceipt)
    expect(rejected).toMatchObject({
      execution: "start_unknown",
      status: "failed",
      parentTaskID: laterBinding.parentTaskID,
    })
    expect(rejected).not.toHaveProperty("sdkMessage")
    expect(receipt.source).toEqual(laterBinding.source)
    yield* pollWithTimeout(
      f.llm
        .requests()
        .pipe(
          Effect.map((requests) =>
            requests.find((request) =>
              request.messages.some(
                (message) =>
                  message.role === "user" &&
                  message.content.some((part) => part.type === "text" && part.text.includes(rejectedNotice.text)),
              ),
            ),
          ),
        ),
      "The parent did not consume the queued Read reject as user content",
    )
    yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Queued Read reject consumer did not finish")
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect(f.state).toEqual({ reads: 1, closed: 2, hookCalls: 2 })
    expect(f.queries).toHaveLength(2)
    expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "cancelled", "failed"])
    const database = yield* Database.Service
    const metas = yield* database.db
      .select()
      .from(MetaAgentStepTable)
      .where(and(eq(MetaAgentStepTable.meta_agent_session_id, f.root.id), eq(MetaAgentStepTable.type, "receipt")))
    expect(metas).toHaveLength(3)
    expect(metas.find((row) => row.tool_call_id === f.queueBinding.source.id)?.status).toBe("failed")
    const meta = metas.find((row) => row.tool_call_id === laterBinding.source.id)
    expect(meta?.status).toBe("failed")
    expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta?.provenance?.externalReceipt)).toEqual(receipt)
    for (const ack of [f.first, f.queued, later])
      expect(JSON.stringify((yield* mc07Result(f, ack.tool.id)).tool)).toBe(JSON.stringify(ack.tool))
  }),
)

effectTest.live(
  "MC06 SDK queue preserves an edited Task claim without starting its query or publishing a false receipt",
  () =>
    Effect.gen(function* () {
      const f = yield* queuedSdkSetup()
      const tasks = yield* SessionTask.Service
      const changed = yield* tasks.updateTask({
        sessionID: f.root.id,
        id: f.queueBinding.parentTaskID,
        expectedRevision: f.queueBinding.parentTaskRevision,
        status: "in_progress",
        content: "The owner changed this queued SDK Task before it could start.",
      })
      if (!changed) return yield* Effect.die(new Error("The queued SDK Task revision did not change"))
      yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
      yield* awaitWithTimeout(Deferred.await(f.firstControl.afterRead), "The original SDK Read did not finish")
      yield* Deferred.succeed(f.firstControl.resultGate, undefined)
      yield* Deferred.succeed(f.firstControl.tailGate, undefined)
      const jobs = yield* Job.Service
      yield* pollWithTimeout(
        jobs.get(f.queueKey).pipe(Effect.map((job) => (job?.status !== "running" ? true : undefined))),
        "The SDK queue kept running after its Task claim changed",
      )
      const firstNoticeID = DelegationReceipt.notificationID(
        DelegationFold.inputID(f.firstBinding.delegationID, f.firstBinding),
        f.firstBinding.parentTaskID,
      )
      const firstNotice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === firstNoticeID),
            ),
          ),
        "The original SDK result notice did not arrive after the queue claim changed",
      )
      if (firstNotice.type !== "synthetic") return yield* Effect.die(new Error("Original SDK result notice is missing"))
      yield* pollWithTimeout(
        f.llm
          .requests()
          .pipe(
            Effect.map((requests) =>
              requests.find((request) =>
                request.messages.some(
                  (message) =>
                    message.role === "user" &&
                    message.content.some((part) => part.type === "text" && part.text.includes(firstNotice.text)),
                ),
              ),
            ),
          ),
        "The parent did not consume the original SDK result after the queue claim changed",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Edited SDK queue parent did not settle")
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === changed.id)).toEqual(changed)
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
      expect((yield* f.sessions.context(f.root.id)).some((message) => message.id === f.noticeID)).toBe(false)
      expect(JSON.stringify((yield* mc07Result(f, f.queueBinding.source.id)).tool)).toBe(JSON.stringify(f.queued.tool))
      const database = yield* Database.Service
      expect(
        yield* database.db
          .select()
          .from(MetaAgentStepTable)
          .where(
            and(
              eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
              eq(MetaAgentStepTable.tool_call_id, f.queueBinding.source.id),
              eq(MetaAgentStepTable.type, "receipt"),
            ),
          ),
      ).toEqual([])
    }),
)

for (const terminal of ["failed", "cancelled"] as const)
  effectTest.live(`MC06 SDK queue keeps coordination facts and never queries after a ${terminal} predecessor`, () =>
    Effect.gen(function* () {
      const f = yield* queuedSdkSetup()
      const jobs = yield* Job.Service
      if (terminal === "cancelled")
        yield* awaitWithTimeout(
          jobs.cancel(f.firstKey),
          "The cancelled SDK predecessor retained its Job scope",
          "5 seconds",
        )
      if (terminal === "failed") {
        f.terminalErrors[0] = true
        yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
        yield* awaitWithTimeout(
          Deferred.await(f.firstControl.afterRead),
          "The failing SDK predecessor did not finish its Read",
        )
        yield* Deferred.succeed(f.firstControl.resultGate, undefined)
        yield* Deferred.succeed(f.firstControl.tailGate, undefined)
      }
      const notice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === f.noticeID),
            ),
          ),
        "The SDK queue did not retain its non-success predecessor coordination notice",
      )
      if (notice.type !== "synthetic") return yield* Effect.die(new Error("SDK queue coordination notice is missing"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(notice.text)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(notice.metadata?.externalReceipt)
      expect(output).toMatchObject({
        execution: "queued",
        status: "recovery_required",
        parentTaskID: f.queueBinding.parentTaskID,
      })
      expect(output.externalThreadID).toBeUndefined()
      expect(output.externalTurnID).toBeUndefined()
      expect(output).not.toHaveProperty("sdkMessage")
      expect(receipt.source).toEqual(f.queueBinding.source)
      yield* pollWithTimeout(
        f.llm
          .requests()
          .pipe(
            Effect.map((requests) =>
              requests.find((request) =>
                request.messages.some(
                  (message) =>
                    message.role === "user" &&
                    message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
                ),
              ),
            ),
          ),
        "The parent did not consume the SDK queue coordination result as user content",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "SDK queue predecessor failure consumer did not finish")
      const tasks = yield* SessionTask.Service
      const delegations = yield* DelegationService.Service
      const kv = yield* KV.Service
      const state = yield* delegations.foldState(f.admission.delegationID)
      expect(
        [...(state?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === f.queueBinding.turnID)?.status,
      ).toBe("recovery_required")
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual([
        terminal === "cancelled" ? "cancelled" : "failed",
        "failed",
      ])
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(f.queueKey))
      expect(binding.settlement?.text).toBe(output.output)
      expect(binding.sdkMessage).toBeUndefined()
      expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
      expect(f.queries).toHaveLength(1)
      expect(f.state.closed).toBe(1)
      const beforeTasks = yield* tasks.get(f.root.id)
      yield* Deferred.succeed(f.firstControl.resultGate, undefined)
      yield* Deferred.succeed(f.firstControl.tailGate, undefined)
      yield* awaitWithTimeout(
        Deferred.await(f.nativeFinished),
        "The stopped predecessor's late SDK iterator did not close",
      )
      const execution = yield* DelegationExecution.Service
      yield* execution.recoverPending
      expect(yield* tasks.get(f.root.id)).toEqual(beforeTasks)
      expect(yield* delegations.foldState(f.admission.delegationID)).toEqual(state)
      expect(f.queries).toHaveLength(1)
      expect(JSON.stringify((yield* mc07Result(f, f.queueBinding.source.id)).tool)).toBe(JSON.stringify(f.queued.tool))
      const database = yield* Database.Service
      const meta = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
            eq(MetaAgentStepTable.tool_call_id, f.queueBinding.source.id),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
      expect(meta).toHaveLength(1)
      expect(meta[0]?.status).toBe("failed")
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
    }),
  )

for (const invalid of [
  {
    name: "a different native session",
    result: { sessionID: "sdk-conflicting-queue-session" },
    error: "SDK continuation changed its native session",
  },
  {
    name: "the predecessor result UUID",
    result: { messageID: "sdk-result-1" },
    error: "SDK continuation reused its previous result message",
  },
])
  effectTest.live(`MC06 SDK queue rejects ${invalid.name} while retaining the original completed predecessor`, () =>
    Effect.gen(function* () {
      const f = yield* queuedSdkSetup(invalid.result)
      yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
      yield* awaitWithTimeout(Deferred.await(f.firstControl.afterRead), "The original SDK predecessor did not read")
      yield* Deferred.succeed(f.firstControl.resultGate, undefined)
      yield* Deferred.succeed(f.firstControl.tailGate, undefined)
      const request = yield* pollWithTimeout(
        f.permission
          .forSession(f.root.id)
          .pipe(
            Effect.map((requests) =>
              requests.find(
                (request) => request.source?.type === "tool" && request.source.id === f.queueBinding.source.id,
              ),
            ),
          ),
        "The invalid SDK queue result did not reach its own original Read permission",
      )
      expect(request.source).toEqual(f.queueBinding.source)
      expect(request.id).not.toBe(f.firstRequest.id)
      expect(f.queries[1]?.options?.resume).toBe("sdk-session-1")
      expect(f.closedBeforeQuery).toEqual([0, 1])
      const kv = yield* KV.Service
      const beforeBinding = yield* kv.get(f.firstKey)
      const tasks = yield* SessionTask.Service
      const beforeTask = (yield* tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)
      yield* f.permission.reply({ requestID: request.id, reply: "once" })
      yield* awaitWithTimeout(Deferred.await(f.queueControl.afterRead), "The queued SDK Read did not finish")
      yield* Deferred.succeed(f.queueControl.resultGate, undefined)
      yield* Deferred.succeed(f.queueControl.tailGate, undefined)
      const notice = yield* pollWithTimeout(
        f.sessions
          .context(f.root.id)
          .pipe(
            Effect.map((messages) =>
              messages.find((message) => message.type === "synthetic" && message.id === f.noticeID),
            ),
          ),
        "The conflicting queued SDK terminal identity did not produce its failed notice",
      )
      if (notice.type !== "synthetic") return yield* Effect.die(new Error("Conflicting SDK queue result is missing"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(notice.text)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(notice.metadata?.externalReceipt)
      expect(output).toMatchObject({
        execution: "start_unknown",
        status: "failed",
        parentTaskID: f.queueBinding.parentTaskID,
      })
      expect(output.output).toContain(invalid.error)
      expect(output).not.toHaveProperty("sdkMessage")
      expect(receipt.source).toEqual(f.queueBinding.source)
      yield* pollWithTimeout(
        f.llm
          .requests()
          .pipe(
            Effect.map((requests) =>
              requests.find((request) =>
                request.messages.some(
                  (message) =>
                    message.role === "user" &&
                    message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
                ),
              ),
            ),
          ),
        "The original parent did not consume its failed SDK queue identity proof",
      )
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "Failed SDK queue identity consumer did not finish")
      expect(yield* kv.get(f.firstKey)).toEqual(beforeBinding)
      expect((yield* tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)).toEqual(beforeTask)
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(f.queueKey))
      expect(binding.sdkMessage).toBeUndefined()
      expect(binding.externalThreadID).toBe("sdk-session-1")
      expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
      expect(f.queries).toHaveLength(2)
      expect(f.state).toEqual({ reads: 2, closed: 2, hookCalls: 2 })
      expect((yield* tasks.get(f.root.id)).map((task) => task.status)).toEqual(["completed", "failed"])
      const database = yield* Database.Service
      const meta = yield* database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, f.root.id),
            eq(MetaAgentStepTable.tool_call_id, f.queueBinding.source.id),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
      expect(meta).toHaveLength(1)
      expect(meta[0]?.status).toBe("failed")
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
      expect(JSON.stringify((yield* mc07Result(f, f.firstBinding.source.id)).tool)).toBe(JSON.stringify(f.first.tool))
      expect(JSON.stringify((yield* mc07Result(f, f.queueBinding.source.id)).tool)).toBe(JSON.stringify(f.queued.tool))
    }),
  )

for (const phase of ["queued", "start_unknown"] as const)
  testEffect(Layer.empty).live(
    `MC06 SDK queue cold recovery keeps ${phase} as coordination without replay or borrowed native identities`,
    () =>
      Effect.gen(function* () {
        const originalContext = yield* Layer.build(metaLayer(true))
        const f = yield* queuedSdkSetup().pipe(Effect.provide(originalContext))
        const originalBus = Context.get(originalContext, Bus.Service)
        const started = yield* Deferred.make<typeof DelegationEvent.DeliveryStartedData.Type>()
        const release = yield* Deferred.make<void>()
        const unsubscribe = yield* originalBus.listen((event) => {
          if (phase !== "start_unknown" || event.type !== DelegationEvent.DeliveryStarted.type) return Effect.void
          const data = Schema.decodeUnknownSync(DelegationEvent.DeliveryStartedData)(event.data)
          if (data.turnID !== f.queueBinding.turnID) return Effect.void
          return Deferred.succeed(started, data).pipe(Effect.andThen(Deferred.await(release)))
        })
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe)))
        if (phase === "start_unknown") {
          yield* f.permission.reply({ requestID: f.firstRequest.id, reply: "once" })
          yield* awaitWithTimeout(
            Deferred.await(f.firstControl.afterRead),
            "The original SDK Read did not finish before queued Started",
          )
          yield* Deferred.succeed(f.firstControl.resultGate, undefined)
          yield* Deferred.succeed(f.firstControl.tailGate, undefined)
          yield* awaitWithTimeout(
            Deferred.await(started),
            "The SDK queue did not commit its original start_unknown boundary",
          )
          expect(f.state.closed).toBe(1)
        }
        const originalKV = Context.get(originalContext, KV.Service)
        const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* originalKV.get(f.queueKey))
        expect(checkpoint.execution).toBe(phase)
        expect(checkpoint.sdkMessage).toBeUndefined()
        expect(checkpoint.externalTurnID).toBeUndefined()
        expect(checkpoint.externalThreadID).toBe(phase === "queued" ? undefined : "sdk-session-1")
        expect(f.queries).toHaveLength(1)
        expect(JSON.stringify((yield* mc07Result(f, f.queueBinding.source.id)).tool)).toBe(
          JSON.stringify(f.queued.tool),
        )
        const originalDatabase = Context.get(originalContext, Database.Service)
        const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-queue-${phase}.sqlite`
        yield* originalDatabase.db.run(sql`VACUUM INTO ${snapshot}`)
        if (phase === "start_unknown")
          yield* awaitWithTimeout(
            Context.get(originalContext, Job.Service).cancel(f.queueKey),
            "The original held SDK queue Job did not cancel before cold reopen",
            "5 seconds",
          )
        yield* Deferred.succeed(release, undefined)
        yield* awaitWithTimeout(
          Context.get(originalContext, DelegationExecution.Service).close({
            delegationID: f.admission.delegationID,
            reason: "Close the original fixture after its durable queue checkpoint.",
          }),
          "The original SDK queue fixture did not close after its checkpoint",
          "5 seconds",
        )
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original SDK queue fixture parent did not release")
        expect(f.queries).toHaveLength(1)

        const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
        const database = Context.get(context, Database.Service)
        expect(database).not.toBe(originalDatabase)
        const sessions = Context.get(context, Session.Service)
        const root = yield* sessions.get(f.root.id)
        const local = Context.get(context, LocationServiceMap.Service).get(root.location)
        yield* useOfflineCatalog([
          {
            info: Provider.Info.make({
              ...Provider.Info.empty(f.metaModel.providerID),
              activation: "enabled",
              package: "@aigcfroge/ai/providers/openai/responses",
            }),
            models: [f.metaModel, f.executorModel].map((ref) =>
              Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
            ),
          },
        ]).pipe(Effect.provide(local))
        const opened = {
          ...f,
          sessions,
          root,
          llm: Context.get(context, TestLLM.Test),
          runs: Context.get(context, SessionExecution.Service),
        }
        yield* opened.llm.serve(() =>
          TestLLM.text(
            "Consumed the original SDK queue coordination after restart.",
            `mc06-sdk-queue-cold-${phase}-parent`,
          ),
        )
        const kv = Context.get(context, KV.Service)
        const jobs = Context.get(context, Job.Service)
        const tasks = Context.get(context, SessionTask.Service)
        const delegations = Context.get(context, DelegationService.Service)
        expect(yield* jobs.get(f.queueKey)).toBeUndefined()
        expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(f.queueKey))).toEqual(checkpoint)
        const beforeTasks = yield* tasks.get(root.id)
        const beforeFirstTask = beforeTasks.find((task) => task.id === f.firstBinding.parentTaskID)
        const metas = database.db
          .select()
          .from(MetaAgentStepTable)
          .where(
            and(
              eq(MetaAgentStepTable.meta_agent_session_id, root.id),
              eq(MetaAgentStepTable.tool_call_id, f.queueBinding.source.id),
              eq(MetaAgentStepTable.type, "receipt"),
            ),
          )
          .all()
        expect(yield* metas).toEqual([])
        const execution = Context.get(context, DelegationExecution.Service)
        expect(yield* execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [root.id] })
        const pending = (yield* sessions.inbox(root.id)).find((input) => input.id === f.noticeID)
        if (pending?.type !== "synthetic")
          return yield* Effect.die(new Error("Cold SDK queue coordination notice was not admitted"))
        const notice = pending.payload
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(notice.text)
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(notice.metadata?.externalReceipt)
        const settled = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(f.queueKey))
        expect(output).toMatchObject({
          execution: phase,
          status: "recovery_required",
          parentTaskID: checkpoint.parentTaskID,
        })
        expect(output.externalThreadID).toBeUndefined()
        expect(output.externalTurnID).toBeUndefined()
        expect(output).not.toHaveProperty("sdkMessage")
        expect(receipt.externalThreadID).toBeUndefined()
        expect(receipt.source).toEqual(checkpoint.source)
        expect(settled.settlement).toEqual({ status: "recovery_required", text: output.output })
        expect(settled.sdkMessage).toBeUndefined()
        expect(DelegationReceipt.matches(settled, receipt)).toBe(true)
        expect(
          [...((yield* delegations.foldState(f.admission.delegationID))?.deliveries.values() ?? [])].find(
            (delivery) => delivery.turnID === checkpoint.turnID,
          )?.status,
        ).toBe("recovery_required")
        expect((yield* tasks.get(root.id)).find((task) => task.id === checkpoint.parentTaskID)).toMatchObject({
          status: "failed",
          revision: checkpoint.parentTaskRevision + 1,
        })
        expect((yield* tasks.get(root.id)).find((task) => task.id === f.firstBinding.parentTaskID)).toEqual(
          beforeFirstTask,
        )
        yield* opened.runs.resume(root.id)
        yield* pollWithTimeout(
          opened.llm
            .requests()
            .pipe(
              Effect.map((requests) =>
                requests.find((request) =>
                  request.messages.some(
                    (message) =>
                      message.role === "user" &&
                      message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
                  ),
                ),
              ),
            ),
          "The cold parent did not consume the original SDK queue coordination as user content",
        )
        yield* awaitWithTimeout(opened.runs.awaitIdle(root.id), "The cold SDK queue parent did not finish")
        expect((yield* mc07Consumed(opened, checkpoint.source.id)).text).toBe(f.queued.text)
        const meta = yield* metas
        expect(meta).toHaveLength(1)
        expect(meta[0]?.status).toBe("failed")
        expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
        expect(JSON.stringify((yield* mc07Result(opened, checkpoint.source.id)).tool)).toBe(
          JSON.stringify(f.queued.tool),
        )
        const messages = yield* sessions.context(root.id)
        const state = yield* delegations.foldState(f.admission.delegationID)
        const finalTasks = yield* tasks.get(root.id)
        const finalBinding = yield* kv.get(f.queueKey)
        yield* execution.recoverPending
        yield* execution.recoverPending
        expect(yield* sessions.context(root.id)).toEqual(messages)
        expect(messages.filter((message) => message.id === f.noticeID)).toHaveLength(1)
        expect(yield* metas).toEqual(meta)
        expect(yield* delegations.foldState(f.admission.delegationID)).toEqual(state)
        expect(yield* tasks.get(root.id)).toEqual(finalTasks)
        expect(yield* kv.get(f.queueKey)).toEqual(finalBinding)
        expect(yield* jobs.get(f.queueKey)).toBeUndefined()
        expect(f.queries).toHaveLength(1)
      }),
  )

testEffect(Layer.empty).live(
  "MC06 SDK early C0 foreground reviewer cold recovery preserves the full native checkpoint and original proof",
  () =>
    Effect.gen(function* () {
      const originalContext = yield* Layer.build(metaLayer(true))
      const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt").pipe(
        Effect.provide(originalContext),
      )
      const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk).pipe(Effect.provide(originalContext))) }
      const id = "mc06-sdk-early-c0-review"
      sdk.outputs[0] =
        "MC06_SDK_REVIEW_0" +
        sdk.text +
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: f.digest,
          verdict: "rejected",
          findings: [{ file: "artifact.txt", severity: "blocking", summary: "The original R1 requires repair." }],
          summary: "Preserve the complete original R1 review before local settlement.",
        })}</review>`
      expect(sdk.outputs[0].charCodeAt(4095)).toBe(0xd83d)
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, {
          description: "Persist the complete SDK R1 review before its Task CAS",
          prompt: "Read the original bound R1 and return its full typed review.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          intent: "review",
          attended: false,
          delegation_id: f.receipt.delegationID,
          revision_digest: f.digest,
        }),
        TestLLM.text("Consumed the original complete SDK early review.", `${id}-original-parent`),
      )
      yield* f.sessions.prompt({
        sessionID: f.root.id,
        text: "Capture the real SDK native result before its Task CAS.",
      })
      yield* awaitWithTimeout(Deferred.await(sdk.afterRead), "The original SDK reviewer did not read R1")
      const originalKV = Context.get(originalContext, KV.Service)
      const binding = (yield* originalKV.scan({ prefix: `delegation:external:${f.receipt.delegationID}:` })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find((entry) => entry.source.id === id)
      if (!binding) return yield* Effect.die(new Error("The original SDK early review Binding is missing"))
      const key = DelegationReceipt.key(binding)
      const originalTasks = Context.get(originalContext, SessionTask.Service)
      const patch = originalTasks.patch
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const held = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(originalTasks, "patch").mockImplementation((input, options) => {
            const result = patch(input, options)
            if (
              input.sessionID !== binding.parentSessionID ||
              input.id !== binding.parentTaskID ||
              input.expectedRevision !== binding.parentTaskRevision ||
              input.status !== "completed"
            )
              return result
            return Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(result),
            )
          }),
        ),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* Deferred.succeed(sdk.resultGate, undefined)
      yield* awaitWithTimeout(
        Deferred.await(entered),
        "The complete native SDK result did not reach its original Task CAS",
      )
      const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* originalKV.get(key))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint))
      expect(checkpoint.externalThreadID).toBe("sdk-session-1")
      expect(checkpoint.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: "sdk-session-1", messageID: "sdk-result-1" }),
      )
      expect(checkpoint.source).toEqual(binding.source)
      expect(checkpoint.settlement).toEqual({ status: "completed", text: sdk.outputs[0] })
      expect((yield* originalTasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toMatchObject({
        status: "in_progress",
        revision: binding.parentTaskRevision,
      })
      const beforeState = yield* f.delegations.foldState(f.receipt.delegationID)
      expect(
        beforeState?.deliveries.get(
          DelegationFold.deliveryKey(
            binding.turnID,
            binding.participantID,
            binding.deliveryOrigin,
            binding.senderParticipantID,
          ),
        ),
      ).toMatchObject({ status: "running", attempt: binding.attempt })
      expect(beforeState?.reviews).toEqual([])
      expect((yield* mc07Result(f, id)).tool.state.status).toBe("running")
      const originalDatabase = Context.get(originalContext, Database.Service)
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-early-c0.sqlite`
      yield* originalDatabase.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* Deferred.succeed(release, undefined)
      yield* Effect.sync(() => held.mockRestore())
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original SDK early reviewer parent did not finish")
      const original = yield* mc07Consumed(f, id)
      if (original.tool.state.status !== "completed")
        return yield* Effect.die(new Error("The original SDK early reviewer did not complete"))
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(original.tool.state.metadata?.externalReceipt)).toEqual(
        receipt,
      )
      expect(sdk.queries).toHaveLength(1)
      expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })

      const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
      const database = Context.get(context, Database.Service)
      expect(database).not.toBe(originalDatabase)
      const sessions = Context.get(context, Session.Service)
      const root = yield* sessions.get(f.root.id)
      const local = Context.get(context, LocationServiceMap.Service).get(root.location)
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(f.metaModel.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [f.metaModel, f.executorModel].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(Effect.provide(local))
      const delegations = Context.get(context, DelegationService.Service)
      const tasks = Context.get(context, SessionTask.Service)
      const kv = Context.get(context, KV.Service)
      const execution = Context.get(context, DelegationExecution.Service)
      const opened = {
        ...f,
        sessions,
        root,
        delegations,
        llm: Context.get(context, TestLLM.Test),
        runs: Context.get(context, SessionExecution.Service),
      }
      const beforeTasks = yield* tasks.get(root.id)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))).toEqual(checkpoint)
      expect((yield* mc07Result(opened, id)).tool.state.status).toBe("running")
      expect(Exit.isFailure(yield* Effect.exit(execution.wait(receipt)))).toBe(true)
      const deliveries = database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, binding.delegationID),
            eq(
              EventTable.type,
              Bus.versionedType(
                DelegationEvent.DeliveryCompleted.type,
                DelegationEvent.DeliveryCompleted.durable.version,
              ),
            ),
          ),
        )
        .all()
        .pipe(
          Effect.map((events) =>
            events.filter(
              (event) =>
                event.data.turnID === binding.turnID &&
                event.data.participantID === binding.participantID &&
                event.data.attempt === binding.attempt,
            ),
          ),
        )
      const reviews = database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, binding.delegationID),
            eq(
              EventTable.type,
              Bus.versionedType(DelegationEvent.ReviewRejected.type, DelegationEvent.ReviewRejected.durable.version),
            ),
          ),
        )
        .all()
        .pipe(
          Effect.map((events) =>
            events.filter(
              (event) => event.data.turnID === binding.turnID && event.data.participantID === binding.participantID,
            ),
          ),
        )
      const successes = database.db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, root.id),
            eq(
              EventTable.type,
              Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
            ),
          ),
        )
        .all()
        .pipe(Effect.map((events) => events.filter((event) => event.data.id === id)))
      const metas = database.db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_session_id, root.id),
            eq(MetaAgentStepTable.tool_call_id, id),
            eq(MetaAgentStepTable.type, "receipt"),
          ),
        )
        .all()
      expect(yield* deliveries).toEqual([])
      expect(yield* reviews).toEqual([])
      expect(yield* successes).toEqual([])
      expect(yield* metas).toEqual([])
      expect(yield* execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [root.id] })
      expect(yield* opened.runs.isActive(root.id)).toBe(false)
      const recovered = yield* mc07Result(opened, id)
      if (recovered.tool.state.status !== "completed")
        return yield* Effect.die(new Error("The cold SDK early reviewer did not recover its original Tool"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(
        recovered.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      )
      expect(output.output).toBe(sdk.outputs[0])
      expect(output.sdkMessage).toEqual(receipt.sdkMessage)
      expect(output.parentTaskID).toBe(binding.parentTaskID)
      expect(output.governance).toMatchObject({
        kind: "review",
        status: "valid",
        reviewedRevisionDigest: f.digest,
        envelope: { verdict: "rejected" },
      })
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(recovered.tool.state.metadata?.externalReceipt)).toEqual(
        receipt,
      )
      expect(recovered.tool.state.content).toEqual(original.tool.state.content)
      const settled = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))
      expect(settled.sdkMessage).toEqual(checkpoint.sdkMessage)
      expect(settled.source).toEqual(checkpoint.source)
      expect(settled.settlement).toEqual({ status: "completed", text: sdk.outputs[0], governance: output.governance })
      expect(yield* execution.wait(receipt)).toEqual({
        status: "completed",
        text: sdk.outputs[0],
        governance: output.governance,
      })
      const recoveredTasks = yield* tasks.get(root.id)
      expect(recoveredTasks.find((task) => task.id === binding.parentTaskID)).toMatchObject({
        status: "completed",
        revision: binding.parentTaskRevision + 1,
        outputDigest: DelegationReceipt.outputDigest(sdk.outputs[0]),
      })
      expect(recoveredTasks.filter((task) => task.id !== binding.parentTaskID)).toEqual(
        beforeTasks.filter((task) => task.id !== binding.parentTaskID),
      )
      const state = yield* delegations.foldState(binding.delegationID)
      expect(state?.reviews.map((review) => review.verdict)).toEqual(["rejected"])
      expect(state?.delegation.rejectionBlocked).toBe(true)
      expect(yield* deliveries).toHaveLength(1)
      expect(yield* reviews).toHaveLength(1)
      expect(yield* successes).toHaveLength(1)
      const beforeResumeMeta = yield* metas
      yield* execution.recoverPending
      expect(yield* mc07Result(opened, id)).toEqual(recovered)
      expect(yield* tasks.get(root.id)).toEqual(recoveredTasks)
      expect(yield* kv.get(key)).toEqual(Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(settled))
      expect(yield* deliveries).toHaveLength(1)
      expect(yield* reviews).toHaveLength(1)
      expect(yield* successes).toHaveLength(1)
      expect(yield* metas).toEqual(beforeResumeMeta)
      yield* opened.llm.push(TestLLM.text("Consumed the complete cold SDK early review proof.", `${id}-cold-parent`))
      yield* opened.runs.resume(root.id)
      yield* awaitWithTimeout(
        opened.runs.awaitIdle(root.id),
        "The cold SDK early reviewer parent did not consume its result",
      )
      expect((yield* mc07Consumed(opened, id)).text).toBe(original.text)
      const meta = yield* metas
      expect(meta).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
      const messages = yield* sessions.context(root.id)
      yield* execution.recoverPending
      yield* execution.recoverPending
      expect(yield* sessions.context(root.id)).toEqual(messages)
      expect(yield* tasks.get(root.id)).toEqual(recoveredTasks)
      expect(yield* delegations.foldState(binding.delegationID)).toEqual(state)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(key))).toEqual(settled)
      expect(yield* deliveries).toHaveLength(1)
      expect(yield* reviews).toHaveLength(1)
      expect(yield* successes).toHaveLength(1)
      expect(yield* metas).toEqual(meta)
      expect(yield* Context.get(context, Job.Service).get(key)).toBeUndefined()
      const permission = yield* Permission.Service.pipe(Effect.provide(local))
      expect(yield* permission.forSession(root.id)).toEqual([])
      expect(sdk.queries).toHaveLength(1)
      expect(sdk.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
)

const sdkEarlyOpen = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof metaSetup>>,
  snapshot: string,
) {
  const context = yield* Layer.build(Layer.fresh(metaLayer(true, snapshot)))
  const sessions = Context.get(context, Session.Service)
  const root = yield* sessions.get(fixture.root.id)
  const local = Context.get(context, LocationServiceMap.Service).get(root.location)
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(fixture.metaModel.providerID),
        activation: "enabled",
        package: "@aigcfroge/ai/providers/openai/responses",
      }),
      models: [fixture.metaModel, fixture.executorModel].map((ref) =>
        Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
      ),
    },
  ]).pipe(Effect.provide(local))
  return {
    ...fixture,
    sessions,
    root,
    local,
    database: Context.get(context, Database.Service),
    kv: Context.get(context, KV.Service),
    tasks: Context.get(context, SessionTask.Service),
    delegations: Context.get(context, DelegationService.Service),
    execution: Context.get(context, DelegationExecution.Service),
    jobs: Context.get(context, Job.Service),
    bus: Context.get(context, Bus.Service),
    llm: Context.get(context, TestLLM.Test),
    runs: Context.get(context, SessionExecution.Service),
  }
})

const sdkEarlyEvents = (
  fixture: Pick<Effect.Success<ReturnType<typeof sdkEarlyOpen>>, "database">,
  binding: DelegationReceipt.Binding,
) => ({
  deliveries: fixture.database.db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, binding.delegationID),
        eq(
          EventTable.type,
          Bus.versionedType(DelegationEvent.DeliveryCompleted.type, DelegationEvent.DeliveryCompleted.durable.version),
        ),
      ),
    )
    .all()
    .pipe(
      Effect.map((events) =>
        events.filter(
          (event) =>
            event.data.turnID === binding.turnID &&
            event.data.participantID === binding.participantID &&
            event.data.attempt === binding.attempt,
        ),
      ),
    ),
  reviews: fixture.database.db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, binding.delegationID),
        eq(
          EventTable.type,
          Bus.versionedType(DelegationEvent.ReviewRejected.type, DelegationEvent.ReviewRejected.durable.version),
        ),
      ),
    )
    .all()
    .pipe(
      Effect.map((events) =>
        events.filter(
          (event) => event.data.turnID === binding.turnID && event.data.participantID === binding.participantID,
        ),
      ),
    ),
  successes: fixture.database.db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, binding.parentSessionID),
        eq(
          EventTable.type,
          Bus.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
        ),
      ),
    )
    .all()
    .pipe(Effect.map((events) => events.filter((event) => event.data.id === binding.source.id))),
  metas: fixture.database.db
    .select()
    .from(MetaAgentStepTable)
    .where(
      and(
        eq(MetaAgentStepTable.meta_agent_session_id, binding.parentSessionID),
        eq(MetaAgentStepTable.tool_call_id, binding.source.id),
        eq(MetaAgentStepTable.type, "receipt"),
      ),
    )
    .all(),
})

const sdkEarlyReviewerStage = Effect.fnUntraced(function* (phase: "raw" | "delivery" | "legacy") {
  const context = yield* Layer.build(metaLayer(true))
  const sdk = yield* sdkTaskSetup("Read", true, undefined, false, "artifact.txt").pipe(Effect.provide(context))
  const f = { ...sdk, ...(yield* mc07Build("artifact.txt", "", true, sdk).pipe(Effect.provide(context))) }
  const id = `mc06-sdk-early-review-${phase}`
  sdk.outputs[0] =
    "MC06_SDK_REVIEW_0" +
    sdk.text +
    `<review>${JSON.stringify({
      kind: "aigcfroge.review.v1",
      reviewed_revision_digest: f.digest,
      verdict: "rejected",
      findings: [{ file: "artifact.txt", severity: "blocking", summary: "The original R1 requires repair." }],
      summary: "Retain the original complete review through local checkpoint recovery.",
    })}</review>`
  expect(sdk.outputs[0].charCodeAt(4095)).toBe(0xd83d)
  const entered = yield* Deferred.make<void>()
  const gate = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() =>
    Deferred.succeed(gate, undefined).pipe(Effect.andThen(Deferred.succeed(sdk.resultGate, undefined)), Effect.asVoid),
  )
  yield* f.llm.push(
    TestLLM.tool(id, TaskTool.name, {
      description: `Capture the original SDK review at ${phase}`,
      prompt: "Read the bound original R1 and preserve the full typed result.",
      execution_type: "external-cli",
      cli_target: "claude-code",
      subagent_type: "claude-code",
      intent: "review",
      attended: false,
      delegation_id: f.receipt.delegationID,
      revision_digest: f.digest,
    }),
    TestLLM.text("Consumed the original complete SDK checkpoint review.", `${id}-original-parent`),
  )
  yield* f.sessions.prompt({ sessionID: f.root.id, text: "Capture a real SDK review persistence boundary." })
  yield* awaitWithTimeout(Deferred.await(sdk.afterRead), "The original SDK checkpoint reviewer did not read R1")
  const kv = Context.get(context, KV.Service)
  const tasks = Context.get(context, SessionTask.Service)
  const binding = (yield* kv.scan({ prefix: `delegation:external:${f.receipt.delegationID}:` })).entries
    .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
    .find((entry) => entry.source.id === id)
  if (!binding) return yield* Effect.die(new Error("The SDK checkpoint review has no original Binding"))
  const seen: { type: string; key?: string; attempt?: number }[] = []
  const unsubscribe = yield* Context.get(context, Bus.Service).listen((event) => {
    seen.push({ type: event.type })
    if (event.type !== DelegationEvent.DeliveryCompleted.type) {
      return Effect.void
    }
    const data = Schema.decodeUnknownSync(Schema.toType(DelegationEvent.DeliveryCompletedData))(event.data)
    seen.push({ type: event.type, key: DelegationReceipt.key(data), attempt: data.attempt })
    if (
      phase === "raw" ||
      DelegationReceipt.key(data) !== DelegationReceipt.key(binding) ||
      data.attempt !== binding.attempt
    )
      return Effect.void
    return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
  })
  yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.andThen(unsubscribe)))
  const held =
    phase === "delivery"
      ? undefined
      : yield* Effect.acquireRelease(
          Effect.sync(() => {
            const patch = tasks.patch
            return spyOn(tasks, "patch").mockImplementation((input, options) => {
              const result = patch(input, options)
              if (
                input.sessionID !== binding.parentSessionID ||
                input.id !== binding.parentTaskID ||
                input.expectedRevision !== binding.parentTaskRevision ||
                input.status !== "completed"
              )
                return result
              // Legacy order is produced with the real event API before the original Task CAS.
              if (phase === "legacy")
                return f.delegations
                  .recordDelivery({
                    ...binding,
                    status: "completed",
                    summary: DelegationReceipt.outputDigest(sdk.outputs[0]),
                  })
                  .pipe(Effect.orDie, Effect.andThen(result))
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(result),
              )
            })
          }),
          (value) => Effect.sync(() => value.mockRestore()),
        )
  yield* Deferred.succeed(sdk.resultGate, undefined)
  yield* awaitWithTimeout(
    Deferred.await(entered),
    "The SDK review did not reach its exact persistence checkpoint",
  ).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        const saved = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(binding)))
        const call = (yield* mc07Result(f, id)).tool
        const task = (yield* tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)
        const delivery = (yield* f.delegations.foldState(binding.delegationID))?.deliveries.get(
          DelegationFold.deliveryKey(
            binding.turnID,
            binding.participantID,
            binding.deliveryOrigin,
            binding.senderParticipantID,
          ),
        )
        return yield* Effect.die(
          new Error(
            `SDK early checkpoint observation: ${JSON.stringify({
              phase,
              expectedKey: DelegationReceipt.key(binding),
              seen,
              sdk: sdk.state,
              queries: sdk.queries.length,
              iteratorFinished: yield* Deferred.isDone(sdk.nativeFinished),
              binding: {
                sdkMessage: saved.sdkMessage,
                settlementStatus: saved.settlement?.status,
                textLength: saved.settlement?.text.length,
              },
              task: task && { id: task.id, status: task.status, revision: task.revision },
              delivery: delivery && { status: delivery.status, attempt: delivery.attempt },
              tool: { status: call.state.status, error: call.state.status === "error" ? call.state.error : undefined },
            })}`,
          ),
        )
      }),
    ),
  )
  const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(binding)))
  expect(checkpoint.settlement?.text).toBe(sdk.outputs[0])
  expect(checkpoint.sdkMessage).toEqual(
    new DelegationReceipt.SdkMessage({ sessionID: "sdk-session-1", messageID: "sdk-result-1" }),
  )
  expect((yield* mc07Result(f, id)).tool.state.status).toBe("running")
  expect((yield* f.delegations.foldState(binding.delegationID))?.reviews).toEqual([])
  return {
    ...f,
    id,
    binding: checkpoint,
    sdkReceipt: Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint)),
    key: DelegationReceipt.key(binding),
    kv,
    tasks,
    database: Context.get(context, Database.Service),
    release: Deferred.succeed(gate, undefined).pipe(
      Effect.andThen(unsubscribe),
      Effect.andThen(Effect.sync(() => held?.mockRestore())),
    ),
  }
})

testEffect(Layer.empty).live(
  "MC06 SDK early CAS race preserves the edited Task after the original SDK pre-read and before its real CAS",
  () =>
    Effect.gen(function* () {
      const f = yield* sdkEarlyReviewerStage("raw")
      const events = sdkEarlyEvents(f, f.binding)
      const changed = yield* f.tasks.updateTask({
        sessionID: f.root.id,
        id: f.binding.parentTaskID,
        expectedRevision: f.binding.parentTaskRevision,
        status: "in_progress",
        content: "The owner edited this SDK Task after its native result and before the original CAS.",
      })
      expect(changed).toMatchObject({
        id: f.binding.parentTaskID,
        status: "in_progress",
        revision: f.binding.parentTaskRevision + 1,
      })
      const before = yield* Effect.all({
        tasks: f.tasks.get(f.root.id),
        binding: f.kv.get(f.key),
        state: f.delegations.foldState(f.binding.delegationID),
        tool: mc07Result(f, f.id),
        deliveries: events.deliveries,
        reviews: events.reviews,
        successes: events.successes,
        metas: events.metas,
      })
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(before.binding)).toEqual(f.binding)
      expect(before.tool.tool.state.status).toBe("running")
      expect(before.deliveries).toEqual([])
      expect(before.reviews).toEqual([])
      expect(before.successes).toEqual([])
      expect(before.metas).toEqual([])
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-early-cas-race.sqlite`
      yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
      yield* f.release
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original SDK CAS loser did not release its parent")
      const failed = yield* mc07Result(f, f.id)
      expect(failed.tool.state.status).toBe("error")
      if (failed.tool.state.status !== "error")
        return yield* Effect.die(new Error("The original SDK CAS loser did not fail its Tool"))
      expect(failed.tool.state.error.message).toContain("superseded or cancelled")
      expect(yield* f.tasks.get(f.root.id)).toEqual(before.tasks)
      expect(yield* f.kv.get(f.key)).toEqual(before.binding)
      expect(yield* f.delegations.foldState(f.binding.delegationID)).toEqual(before.state)
      expect(yield* events.deliveries).toEqual([])
      expect(yield* events.reviews).toEqual([])
      expect(yield* events.successes).toEqual([])
      const opened = yield* sdkEarlyOpen(f, snapshot)
      const coldEvents = sdkEarlyEvents(opened, f.binding)
      expect(opened.database).not.toBe(f.database)
      expect(yield* opened.execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [] })
      yield* opened.execution.recoverPending
      expect(
        yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.key),
          state: opened.delegations.foldState(f.binding.delegationID),
          tool: mc07Result(opened, f.id),
          deliveries: coldEvents.deliveries,
          reviews: coldEvents.reviews,
          successes: coldEvents.successes,
          metas: coldEvents.metas,
        }),
      ).toEqual(before)
      expect(yield* opened.runs.isActive(opened.root.id)).toBe(false)
      expect(yield* opened.jobs.get(f.key)).toBeUndefined()
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
)

testEffect(Layer.empty).live(
  "MC06 SDK early cleanup releases the real background waiter and preserves the committed full result after local failure",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(metaLayer(true))
      const f = yield* sdkTaskSetup("Read", true, undefined, true).pipe(Effect.provide(context))
      f.outputs[0] = `MC06_SDK_EARLY_0_${f.text}`
      expect(f.outputs[0].charCodeAt(4095)).toBe(0xd83d)
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "ask" },
        ],
      })
      const id = "mc06-sdk-early-local-failure"
      const ack = yield* sdkTask(f, id, {
        description: "Retain the original SDK background result through a later local failure",
        prompt: "Read the scoped original input and preserve the complete Unicode result.",
        execution_type: "external-cli",
        cli_target: "claude-code",
        subagent_type: "claude-code",
        attended: true,
        background: true,
      })
      expect(ack.tool.state.status).toBe("completed")
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)).toMatchObject({
        execution: "admitted",
        status: "running",
      })
      const kv = Context.get(context, KV.Service)
      const tasks = Context.get(context, SessionTask.Service)
      const jobs = Context.get(context, Job.Service)
      const database = Context.get(context, Database.Service)
      const execution = Context.get(context, DelegationExecution.Service)
      const delegations = Context.get(context, DelegationService.Service)
      const binding = (yield* kv.scan({ prefix: "delegation:external:" })).entries
        .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
        .find((entry) => entry.source.id === id)
      if (!binding) return yield* Effect.die(new Error("The SDK local-failure Task lost its admitted Binding"))
      const key = DelegationReceipt.key(binding)
      const committed = yield* Deferred.make<SessionTask.Info>()
      const gate = yield* Deferred.make<void>()
      const failure = new Error("Controlled local failure after the original SDK Task and Binding commit")
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(gate, undefined).pipe(
          Effect.andThen(Deferred.succeed(f.resultGate, undefined)),
          Effect.asVoid,
        ),
      )
      const held = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const patch = tasks.patch
          return spyOn(tasks, "patch").mockImplementation((input, options) => {
            const result = patch(input, options)
            if (
              input.sessionID !== binding.parentSessionID ||
              input.id !== binding.parentTaskID ||
              input.expectedRevision !== binding.parentTaskRevision ||
              input.status !== "completed"
            )
              return result
            return result.pipe(
              Effect.flatMap((task) => {
                if (!task) return Effect.die(new Error("The original SDK local-failure Task did not commit"))
                return Deferred.succeed(committed, task).pipe(
                  Effect.andThen(Deferred.await(gate)),
                  Effect.andThen(Effect.die(failure)),
                )
              }),
            )
          })
        }),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      const request = yield* pollWithTimeout(
        f.permission
          .forSession(f.root.id)
          .pipe(
            Effect.map((requests) =>
              requests.find((request) => request.source?.type === "tool" && request.source.id === id),
            ),
          ),
        "The SDK local-failure Read did not reach its original permission",
      )
      expect(request.source).toEqual(binding.source)
      yield* f.permission.reply({ requestID: request.id, reply: "once" })
      yield* awaitWithTimeout(Deferred.await(f.afterRead), "The SDK local-failure query did not read")
      yield* Deferred.succeed(f.resultGate, undefined)
      const task = yield* awaitWithTimeout(
        Deferred.await(committed),
        "The SDK local-failure Task did not reach its real committed checkpoint",
      )
      expect(task).toMatchObject({
        status: "completed",
        revision: binding.parentTaskRevision + 1,
        outputDigest: DelegationReceipt.outputDigest(f.outputs[0]),
      })
      const raw = yield* kv.get(key)
      const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(raw)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint))
      const noticeID = DelegationReceipt.notificationID(
        DelegationFold.inputID(checkpoint.delegationID, checkpoint),
        checkpoint.parentTaskID,
      )
      const events = sdkEarlyEvents({ database }, checkpoint)
      expect(checkpoint.settlement).toEqual({ status: "completed", text: f.outputs[0] })
      expect(checkpoint.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: "sdk-session-1", messageID: "sdk-result-1" }),
      )
      expect(checkpoint.source).toEqual(binding.source)
      expect(yield* events.deliveries).toEqual([])
      expect(yield* events.metas).toEqual([])
      expect(yield* events.successes).toHaveLength(1)
      expect((yield* f.sessions.inbox(f.root.id)).some((input) => input.id === noticeID)).toBe(false)
      // The real wait reads its parent immediately before adopting the active Job.
      const waitEntered = yield* Deferred.make<void>()
      const parentRead = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const get = f.sessions.get
          return spyOn(f.sessions, "get").mockImplementation((sessionID) =>
            get(sessionID).pipe(
              Effect.tap(() => (sessionID === f.root.id ? Deferred.succeed(waitEntered, undefined) : Effect.void)),
            ),
          )
        }),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      const scope = yield* Effect.scope
      const waiting = yield* execution.wait(receipt).pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(
        Deferred.await(waitEntered),
        "The real SDK background wait did not read its original parent",
      )
      yield* Effect.sync(() => parentRead.mockRestore())
      yield* Deferred.succeed(gate, undefined)
      const stopped = yield* awaitWithTimeout(
        Fiber.join(waiting),
        "The SDK local-failure cleanup did not release its real waiter",
      )
      if (Exit.isSuccess(stopped))
        return yield* Effect.die(new Error("The in-flight SDK wait unexpectedly succeeded after local failure"))
      expect(Cause.squash(stopped.cause)).toBe(failure)
      yield* Effect.sync(() => held.mockRestore())
      yield* pollWithTimeout(
        jobs.get(key).pipe(Effect.map((job) => (job === undefined ? true : undefined))),
        "The original SDK failed background Job did not finish cleanup",
      )
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The original SDK background parent did not remain idle after cleanup",
      )
      expect(yield* kv.get(key)).toEqual(raw)
      const beforeTasks = yield* tasks.get(f.root.id)
      expect(beforeTasks.find((value) => value.id === binding.parentTaskID)).toEqual(task)
      expect(
        [...((yield* delegations.foldState(binding.delegationID))?.deliveries.values() ?? [])].find(
          (delivery) => delivery.turnID === binding.turnID,
        ),
      ).toMatchObject({ status: "running", attempt: binding.attempt })
      expect(yield* events.deliveries).toEqual([])
      expect(yield* events.reviews).toEqual([])
      expect(yield* events.metas).toEqual([])
      expect((yield* f.sessions.context(f.root.id)).some((message) => message.id === noticeID)).toBe(false)
      expect((yield* f.sessions.inbox(f.root.id)).some((input) => input.id === noticeID)).toBe(false)
      expect(JSON.stringify((yield* mc07Result(f, id)).tool)).toBe(JSON.stringify(ack.tool))
      const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-early-local-failure.sqlite`
      yield* database.db.run(sql`VACUUM INTO ${snapshot}`)
      const opened = yield* sdkEarlyOpen(f, snapshot)
      const coldEvents = sdkEarlyEvents(opened, checkpoint)
      expect(opened.database).not.toBe(database)
      expect(yield* opened.execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [opened.root.id] })
      expect(yield* opened.runs.isActive(opened.root.id)).toBe(false)
      expect(yield* opened.tasks.get(opened.root.id)).toEqual(beforeTasks)
      expect(yield* opened.kv.get(key)).toEqual(raw)
      const pending = (yield* opened.sessions.inbox(opened.root.id)).find((input) => input.id === noticeID)
      if (pending?.type !== "synthetic")
        return yield* Effect.die(new Error("The cold SDK local-failure notice was not admitted"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(pending.payload.text)
      expect(output).toMatchObject({
        status: "completed",
        parentTaskID: binding.parentTaskID,
        sdkMessage: receipt.sdkMessage,
      })
      expect(output.output).toBe(f.outputs[0])
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(pending.payload.metadata?.externalReceipt)).toEqual(
        receipt,
      )
      expect(yield* opened.execution.wait(receipt)).toEqual({ status: "completed", text: f.outputs[0] })
      expect(yield* coldEvents.deliveries).toHaveLength(1)
      expect(yield* coldEvents.successes).toHaveLength(1)
      expect(yield* coldEvents.metas).toEqual([])
      yield* opened.execution.recoverPending
      expect((yield* opened.sessions.inbox(opened.root.id)).filter((input) => input.id === noticeID)).toHaveLength(1)
      expect(yield* opened.tasks.get(opened.root.id)).toEqual(beforeTasks)
      expect(yield* coldEvents.deliveries).toHaveLength(1)
      yield* opened.llm.push(
        TestLLM.text("Consumed the complete SDK result preserved after local failure.", `${id}-cold-parent`),
      )
      yield* opened.runs.resume(opened.root.id)
      yield* awaitWithTimeout(
        opened.runs.awaitIdle(opened.root.id),
        "The cold SDK local-failure parent did not consume its full notice",
      )
      expect(
        (yield* opened.llm.requests()).some((request) =>
          request.messages.some(
            (message) =>
              message.role === "user" &&
              message.content.some((part) => part.type === "text" && part.text.includes(pending.payload.text)),
          ),
        ),
      ).toBe(true)
      expect((yield* mc07Consumed(opened, id)).text).toBe(ack.text)
      expect(JSON.stringify((yield* mc07Result(opened, id)).tool)).toBe(JSON.stringify(ack.tool))
      const meta = yield* coldEvents.metas
      expect(meta).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Outcome)(meta[0]?.provenance?.externalReceipt)).toEqual(receipt)
      const messages = yield* opened.sessions.context(opened.root.id)
      const finalState = yield* opened.delegations.foldState(binding.delegationID)
      yield* opened.execution.recoverPending
      yield* opened.execution.recoverPending
      expect(yield* opened.sessions.context(opened.root.id)).toEqual(messages)
      expect(messages.filter((message) => message.id === noticeID)).toHaveLength(1)
      expect(yield* opened.tasks.get(opened.root.id)).toEqual(beforeTasks)
      expect(yield* opened.kv.get(key)).toEqual(raw)
      expect(yield* opened.delegations.foldState(binding.delegationID)).toEqual(finalState)
      expect(yield* coldEvents.deliveries).toHaveLength(1)
      expect(yield* coldEvents.successes).toHaveLength(1)
      expect(yield* coldEvents.metas).toEqual(meta)
      expect(yield* opened.jobs.get(key)).toBeUndefined()
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect(f.queries).toHaveLength(1)
      expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
    }),
)

for (const phase of ["delivery", "legacy"] as const)
  testEffect(Layer.empty).live(
    `MC06 SDK early ${phase === "delivery" ? "C3 review after Delivery commit" : "C2 legacy Delivery-first fixture"} recovers the same proof once`,
    () =>
      Effect.gen(function* () {
        const f = yield* sdkEarlyReviewerStage(phase)
        const beforeTasks = yield* f.tasks.get(f.root.id)
        expect(beforeTasks.find((task) => task.id === f.binding.parentTaskID)).toMatchObject({
          status: phase === "delivery" ? "completed" : "in_progress",
          revision: f.binding.parentTaskRevision + (phase === "delivery" ? 1 : 0),
        })
        const checkpointState = yield* f.delegations.foldState(f.binding.delegationID)
        if (!checkpointState) return yield* Effect.die(new Error("The SDK checkpoint Delegation state is missing"))
        expect(
          [...checkpointState.deliveries.values()].find((delivery) => delivery.turnID === f.binding.turnID),
        ).toMatchObject({ status: "completed", attempt: f.binding.attempt })
        if (phase === "delivery")
          expect(f.binding.settlement?.governance).toMatchObject({
            kind: "review",
            status: "valid",
            reviewedRevisionDigest: f.digest,
            envelope: { verdict: "rejected" },
          })
        if (phase === "legacy") expect(f.binding.settlement?.governance).toBeUndefined()
        const snapshot = `${(yield* tmpdirScoped()).path}/mc06-sdk-early-${phase}.sqlite`
        yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
        yield* f.release
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The original SDK checkpoint review did not finish")
        const original = yield* mc07Consumed(f, f.id)
        if (original.tool.state.status !== "completed")
          return yield* Effect.die(new Error("The original SDK checkpoint review did not complete"))
        const opened = yield* sdkEarlyOpen(f, snapshot)
        expect(opened.database).not.toBe(f.database)
        const events = sdkEarlyEvents(opened, f.binding)
        expect(yield* events.deliveries).toHaveLength(1)
        expect(yield* events.reviews).toEqual([])
        expect(yield* events.successes).toEqual([])
        expect(yield* opened.execution.recoverPending).toMatchObject({ scanAvailable: true, parents: [opened.root.id] })
        const recovered = yield* mc07Result(opened, f.id)
        if (recovered.tool.state.status !== "completed")
          return yield* Effect.die(new Error("The SDK review checkpoint was not recovered"))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(
          recovered.tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        expect(output.output).toBe(f.outputs[0])
        expect(output.sdkMessage).toEqual(f.sdkReceipt.sdkMessage)
        expect(output.governance).toMatchObject({
          kind: "review",
          status: "valid",
          reviewedRevisionDigest: f.digest,
          envelope: { verdict: "rejected" },
        })
        expect(recovered.tool.state.content).toEqual(original.tool.state.content)
        const task = (yield* opened.tasks.get(opened.root.id)).find((task) => task.id === f.binding.parentTaskID)
        expect(task).toMatchObject({
          status: "completed",
          revision: f.binding.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.outputs[0]),
        })
        if (phase === "delivery") expect(task).toEqual(beforeTasks.find((task) => task.id === f.binding.parentTaskID))
        expect((yield* opened.execution.wait(f.sdkReceipt)).governance).toEqual(output.governance)
        expect((yield* opened.delegations.foldState(f.binding.delegationID))?.delegation.rejectionBlocked).toBe(true)
        expect(yield* events.deliveries).toHaveLength(1)
        expect(yield* events.reviews).toHaveLength(1)
        expect(yield* events.successes).toHaveLength(1)
        yield* opened.llm.push(TestLLM.text("Consumed the recovered original SDK review.", `${f.id}-cold-parent`))
        yield* opened.runs.resume(opened.root.id)
        yield* awaitWithTimeout(
          opened.runs.awaitIdle(opened.root.id),
          "The cold SDK review parent did not consume its proof",
        )
        expect((yield* mc07Consumed(opened, f.id)).text).toBe(original.text)
        const before = yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.key),
          state: opened.delegations.foldState(f.binding.delegationID),
          deliveries: events.deliveries,
          reviews: events.reviews,
          successes: events.successes,
          metas: events.metas,
          messages: opened.sessions.context(opened.root.id),
        })
        expect(before.metas).toHaveLength(1)
        expect(
          Schema.decodeUnknownSync(DelegationReceipt.Outcome)(before.metas[0]?.provenance?.externalReceipt),
        ).toEqual(f.sdkReceipt)
        yield* opened.execution.recoverPending
        yield* opened.execution.recoverPending
        expect(
          yield* Effect.all({
            tasks: opened.tasks.get(opened.root.id),
            binding: opened.kv.get(f.key),
            state: opened.delegations.foldState(f.binding.delegationID),
            deliveries: events.deliveries,
            reviews: events.reviews,
            successes: events.successes,
            metas: events.metas,
            messages: opened.sessions.context(opened.root.id),
          }),
        ).toEqual(before)
        expect(f.queries).toHaveLength(1)
        expect(f.state).toEqual({ reads: 1, closed: 1, hookCalls: 1 })
      }),
  )

class JsonlPeerEvent extends Schema.Class<JsonlPeerEvent>("Test.JsonlPeerEvent")({
  event: Schema.String,
  pid: Schema.Int,
  callID: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  argv: Schema.optionalKey(Schema.Array(Schema.String)),
  frame: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.Int),
}) {}

const jsonlTaskSetup = Effect.fnUntraced(function* () {
  const directory = yield* tmpdirScoped()
  const files = yield* FSUtil.Service
  const peer = path.join(directory.path, "jsonl-peer.ts")
  const command = process.platform === "win32" ? path.join(directory.path, "jsonl-peer.cmd") : peer
  const logPath = `${directory.path}/jsonl-peer.jsonl`
  yield* files.writeFileString(logPath, "")
  yield* files.writeWithDirs(
    peer,
    [
      `#!${process.execPath}`,
      'import { appendFileSync, existsSync, watch } from "node:fs"',
      'import { dirname } from "node:path"',
      'import { createInterface } from "node:readline"',
      `const logPath = ${JSON.stringify(logPath)}`,
      String.raw`
let input
let callbackID
let answered = false
let emitted = false
const record = (event, fields = {}) => appendFileSync(logPath, JSON.stringify({ event, pid: process.pid, ...(input ? { callID: input.id } : {}), ...fields }) + "\n")
const emit = (frame) => process.stdout.write(JSON.stringify(frame) + "\n")
const waitForRelease = (file) => {
  if (!file || existsSync(file)) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = watch(dirname(file), () => {
      if (!existsSync(file)) return
      observer.close()
      resolve()
    })
    if (existsSync(file)) {
      observer.close()
      resolve()
    }
  })
}
record("spawn", { cwd: process.cwd(), argv: process.argv.slice(2) })
process.on("SIGTERM", () => {
  record("signal", { code: 143 })
  process.exit(143)
})
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
reader.on("line", async (line) => {
  const frame = JSON.parse(line)
  if (frame.type === "control_request" && frame.request.subtype === "initialize") {
    callbackID = frame.request.hooks.PreToolUse[0].hookCallbackIds[0]
    record("initialize", { frame })
    emit({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } })
    return
  }
  if (frame.type === "user") {
    input = JSON.parse(frame.message.content[0].text)
    record("input", { frame })
    emit({ type: "system", subtype: "init", session_id: "OLD_INIT_SESSION", uuid: "OLD_INIT_UUID" })
    emit({
      type: "control_request",
      request_id: "control-" + input.id,
      request: {
        subtype: "hook_callback",
        callback_id: callbackID,
        input: { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: input.readPath }, tool_use_id: "read-" + input.id, session_id: "jsonl-session-1" },
      },
    })
    return
  }
  if (frame.type !== "control_response" || frame.response.request_id !== "control-" + input.id) return
  if (answered) throw new Error("Duplicate parent permission answer")
  answered = true
  record("approval", { frame })
  if (frame.response.subtype !== "success" || frame.response.response.hookSpecificOutput.permissionDecision !== "allow") {
    record("blocked")
    emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "JSONL_READ_REJECTED", errors: ["The original parent did not authorize Read"], session_id: "jsonl-session-1", uuid: input.id + "-failed" })
    return
  }
  const content = await Bun.file(input.readPath).text()
  record("read", { content })
  await waitForRelease(input.gatePath)
  emitted = true
  record("result-first")
  emit({ type: "result", subtype: "success", is_error: false, result: "EARLY_RESULT_MUST_NOT_REPLACE_FULL_OUTPUT", session_id: "EARLY_RESULT_SESSION", uuid: input.id + "-early" })
})
reader.on("close", () => {
  record("stdinEOF")
  if (emitted) {
    const frame = {
      type: "result", subtype: "success", is_error: false, result: input.output,
      session_id: input.mode === "sid" ? "jsonl-other-session" : "jsonl-session-1",
      uuid: input.resultID ?? input.id + "-result",
    }
    if (input.mode === "missing") delete frame.uuid
    if (input.mode === "partial") frame.terminal_reason = "aborted_tools"
    if (input.mode === "error") {
      frame.is_error = true
      frame.subtype = "error_during_execution"
      frame.errors = ["Late native error"]
    }
    emit({ type: "prompt_suggestion", suggestion: "Keep reading stdout after User EOF", session_id: "OTHER_SUGGESTION_SESSION" })
    record("result-final", { frame })
    record("exit", { code: 0 })
    process.stdout.end(JSON.stringify(frame), () => process.exit(0))
    return
  }
  record("exit", { code: 0 })
  process.stdout.end(() => process.exit(0))
})
`,
    ].join("\n"),
    0o755,
  )
  if (process.platform === "win32")
    yield* files.writeFileString(command, `@echo off\r\n"${process.execPath}" "${peer}" %*\r\n`)
  expect(yield* ClaudeCodeAdapter.makeClaudeCodeAdapter(command).detect()).toBe(true)
  const fixture = yield* metaSetup(
    Agent.ID.make("keeper-worker"),
    true,
    Agent.ID.make("meta"),
    "jsonl",
    undefined,
    "",
    "work",
    undefined,
    "claude-code",
    10_000,
    command,
  )
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(fixture.root.location)
  const permission = yield* Permission.Service.pipe(Effect.provide(local))
  const presence = yield* ApprovalPresence.Service
  yield* presence.bindResponder({ location: fixture.root.location, custom: false })
  const readPath = `${fixture.root.location.directory}/jsonl-read.txt`
  const fileText = "Original parent JSONL input\n第二行🙂\n"
  yield* files.writeFileString(readPath, fileText)
  const outputs = [0, 1].map((index) => {
    const prefix = ` \nJSONL_${index}_`
    return prefix + "x".repeat(4095 - prefix.length) + "🙂" + "汉字🙂\n".repeat(15_000) + `_TAIL_${index}\n  `
  })
  const gatePath = `${directory.path}/result-release`
  yield* Effect.addFinalizer(() => files.writeFileString(gatePath, "released").pipe(Effect.orDie))
  return {
    ...fixture,
    files,
    local,
    permission,
    command,
    logPath,
    readPath,
    fileText,
    outputs,
    gatePath,
    database: yield* Database.Service,
    kv: yield* KV.Service,
    tasks: yield* SessionTask.Service,
    delegations: yield* DelegationService.Service,
    execution: yield* DelegationExecution.Service,
    jobs: yield* Job.Service,
    bus: yield* Bus.Service,
    events: files.readFileString(logPath).pipe(
      Effect.map((text) =>
        text
          .split("\n")
          .filter(Boolean)
          .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(JsonlPeerEvent))(line)),
      ),
    ),
  }
})

const jsonlInput = (
  f: Effect.Success<ReturnType<typeof jsonlTaskSetup>>,
  id: string,
  options: {
    index?: number
    mode?: string
    resultID?: string
    gated?: boolean
    previous?: DelegationReceipt.Jsonl
  } = {},
): typeof TaskTool.Input.Type => ({
  description: `Run the original JSONL Task ${id}`,
  prompt: JSON.stringify({
    id,
    readPath: f.readPath,
    output: f.outputs[options.index ?? 0],
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.resultID ? { resultID: options.resultID } : {}),
    ...(options.gated ? { gatePath: f.gatePath } : {}),
  }),
  execution_type: "external-cli",
  cli_target: "claude-code",
  subagent_type: "claude-code",
  attended: true,
  ...(options.previous
    ? {
        command: "append",
        delegation_id: options.previous.delegationID,
        participant_id: options.previous.participantID,
      }
    : {}),
})

const jsonlBinding = Effect.fnUntraced(function* (f: Effect.Success<ReturnType<typeof jsonlTaskSetup>>, id: string) {
  const binding = (yield* f.kv.scan({ prefix: "delegation:external:" })).entries
    .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
    .find((entry) => entry.source.id === id)
  if (!binding) return yield* Effect.die(new Error(`The original JSONL Task has no Binding: ${id}`))
  return binding
})

effectTest.live(
  "MC06 JSONL formal new and same-SID append keep independent approvals and complete last-frame Tool/Meta results",
  () =>
    Effect.gen(function* () {
      const f = yield* jsonlTaskSetup()
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "ask" },
        ],
      })
      const receipts: DelegationReceipt.Jsonl[] = []
      const bindings: DelegationReceipt.Binding[] = []
      const requests: string[] = []
      for (const index of [0, 1]) {
        const id = `mc06-jsonl-formal-${index}`
        yield* f.llm.push(
          TestLLM.tool(id, TaskTool.name, jsonlInput(f, id, { index, previous: receipts[0] })),
          TestLLM.text(`Consumed JSONL ${index} completely.`, `${id}-parent`),
        )
        yield* f.sessions.prompt({ sessionID: f.root.id, text: `Run the independent JSONL Task ${index}.` })
        const request = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "The configured JSONL Read did not reach its original parent Permission",
        )
        const call = yield* mc07Result(f, id)
        expect(request).toMatchObject({
          action: "read",
          resources: ["jsonl-read.txt"],
          sessionID: f.root.id,
          source: { type: "tool", messageID: call.assistant.id, id },
        })
        expect(yield* f.permission.forSession(f.root.id)).toHaveLength(1)
        expect((yield* f.events).filter((event) => event.event === "read")).toHaveLength(index)
        requests.push(request.id)
        yield* f.permission.reply({ requestID: request.id, reply: "once" })
        yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The formal JSONL Task did not settle", "10 seconds")
        const result = yield* mc07Consumed(f, id)
        if (result.tool.state.status !== "completed")
          return yield* Effect.die(new Error(`The formal JSONL Task failed: ${JSON.stringify(result.tool.state)}`))
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(result.tool.state.metadata?.externalReceipt)
        const binding = yield* jsonlBinding(f, id)
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.JsonlOutput))(result.text)
        expect(receipt.transport).toBe("jsonl")
        expect(receipt.jsonlMessage).toEqual(
          new DelegationReceipt.JsonlMessage({ sessionID: "jsonl-session-1", messageID: `${id}-result` }),
        )
        expect(receipt.externalTurnID).toBeUndefined()
        expect(binding.transport).toBe("jsonl")
        expect(binding.command).toBe(f.command)
        expect(binding.location).toEqual(f.root.location)
        expect(binding.source).toEqual(receipt.source)
        expect(binding.sdkMessage).toBeUndefined()
        expect(binding.sdkInput).toBeUndefined()
        expect(binding.acpPrompt).toBeUndefined()
        expect(binding.settlement).toEqual({ status: "completed", text: f.outputs[index] })
        expect(output.output).toBe(f.outputs[index])
        expect(output.output.length).toBeGreaterThan(50 * 1024)
        expect(output.output.charCodeAt(4095)).toBe(0xd83d)
        expect(output.jsonlMessage).toEqual(receipt.jsonlMessage)
        expect(result.tool.state.metadata?.truncated).toBe(false)
        expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
        expect(DelegationReceipt.matchesOutput(binding, output)).toBe(true)
        expect((yield* f.execution.wait(receipt)).text).toBe(f.outputs[index])
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toMatchObject({
          status: "completed",
          revision: binding.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.outputs[index]),
        })
        const events = sdkEarlyEvents(f, binding)
        expect(yield* events.deliveries).toHaveLength(1)
        expect(yield* events.successes).toHaveLength(1)
        const metas = yield* events.metas
        expect(metas).toHaveLength(1)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(metas[0]?.provenance?.externalReceipt)).toEqual(
          receipt,
        )
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
        expect((yield* f.jobs.wait({ id: DelegationReceipt.key(binding) })).timedOut).toBe(false)
        receipts.push(receipt)
        bindings.push(binding)
      }
      expect(requests[0]).not.toBe(requests[1])
      expect(receipts[0].jsonlMessage.sessionID).toBe(receipts[1].jsonlMessage.sessionID)
      expect(receipts[0].jsonlMessage.messageID).not.toBe(receipts[1].jsonlMessage.messageID)
      expect(receipts[0].source.id).not.toBe(receipts[1].source.id)
      expect(bindings[0].parentTaskID).not.toBe(bindings[1].parentTaskID)
      expect(DelegationReceipt.key(bindings[0])).not.toBe(DelegationReceipt.key(bindings[1]))
      expect(
        Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(DelegationReceipt.key(bindings[0]))),
      ).toEqual(bindings[0])
      expect(DelegationReceipt.matches(bindings[1], receipts[0])).toBe(false)
      const events = yield* f.events
      const starts = events.filter((event) => event.event === "spawn")
      expect(starts).toHaveLength(2)
      expect(starts[0].pid).not.toBe(starts[1].pid)
      expect(starts.map((event) => event.cwd)).toEqual([f.root.location.directory, f.root.location.directory])
      expect(starts[0].argv).toContain("stream-json")
      expect(starts[0].argv).toContain("--verbose")
      expect(starts[0].argv).not.toContain("--resume")
      const resumedArgs = starts[1].argv ?? []
      expect(resumedArgs).toContain("--resume")
      expect(resumedArgs[resumedArgs.indexOf("--resume") + 1]).toBe("jsonl-session-1")
      expect(events.filter((event) => event.event === "initialize")).toHaveLength(2)
      const users = events
        .filter((event) => event.event === "input")
        .map((event) =>
          Schema.decodeUnknownSync(
            Schema.Struct({
              type: Schema.Literal("user"),
              session_id: Schema.String,
              parent_tool_use_id: Schema.Null,
              uuid: Schema.optionalKey(Schema.Never),
              priority: Schema.optionalKey(Schema.Never),
              message: Schema.Struct({
                role: Schema.Literal("user"),
                content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
              }),
            }),
          )(event.frame),
        )
      expect(users).toHaveLength(2)
      expect(users.map((user) => user.session_id)).toEqual(["", ""])
      expect(
        users.map(
          (user) =>
            Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ id: Schema.String })))(
              user.message.content[0].text,
            ).id,
        ),
      ).toEqual(["mc06-jsonl-formal-0", "mc06-jsonl-formal-1"])
      expect(events.filter((event) => event.event === "read").map((event) => event.content)).toEqual([
        f.fileText,
        f.fileText,
      ])
      expect(events.filter((event) => event.event === "stdinEOF")).toHaveLength(2)
      expect(events.filter((event) => event.event === "exit").map((event) => event.code)).toEqual([0, 0])
      for (const index of [0, 1]) {
        const id = `mc06-jsonl-formal-${index}`
        const invocation = events.filter((event) => event.callID === id)
        expect(invocation.map((event) => event.event)).toEqual([
          "input",
          "approval",
          "read",
          "result-first",
          "stdinEOF",
          "result-final",
          "exit",
        ])
        const approval = Schema.decodeUnknownSync(
          Schema.Struct({
            type: Schema.Literal("control_response"),
            response: Schema.Struct({
              subtype: Schema.Literal("success"),
              request_id: Schema.String,
              response: Schema.Struct({
                hookSpecificOutput: Schema.Struct({
                  hookEventName: Schema.Literal("PreToolUse"),
                  permissionDecision: Schema.Literal("allow"),
                }),
              }),
            }),
          }),
        )(invocation.find((event) => event.event === "approval")?.frame)
        expect(approval.response.request_id).toBe(`control-${id}`)
        expect(approval.response.request_id).not.toBe(receipts[index].jsonlMessage.messageID)
        expect(approval.response.request_id).not.toBe(`read-${id}`)
      }
    }),
)

for (const mode of ["sid", "duplicate", "missing", "partial", "error"] as const)
  effectTest.live(`MC06 JSONL formal ${mode} successor result cannot complete or rewrite the exact predecessor`, () =>
    Effect.gen(function* () {
      const f = yield* jsonlTaskSetup()
      const firstID = `mc06-jsonl-formal-${mode}-original`
      const first = yield* sdkTask(f, firstID, jsonlInput(f, firstID))
      if (first.tool.state.status !== "completed")
        return yield* Effect.die(
          new Error(`The JSONL predecessor did not complete: ${JSON.stringify(first.tool.state.error)}`),
        )
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(first.tool.state.metadata?.externalReceipt)
      const original = yield* jsonlBinding(f, firstID)
      const originalTask = (yield* f.tasks.get(f.root.id)).find((task) => task.id === original.parentTaskID)
      const id = `mc06-jsonl-formal-${mode}-successor`
      const result = yield* sdkTask(
        f,
        id,
        jsonlInput(f, id, {
          index: 1,
          mode,
          previous: receipt,
          ...(mode === "duplicate" ? { resultID: receipt.jsonlMessage.messageID } : {}),
        }),
      )
      expect(result.tool.state.status).toBe("error")
      expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      const successor = yield* jsonlBinding(f, id)
      expect(successor.jsonlMessage).toBeUndefined()
      expect(successor.settlement?.status).not.toBe("completed")
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === successor.parentTaskID)?.status).not.toBe(
        "completed",
      )
      expect(
        Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(DelegationReceipt.key(original))),
      ).toEqual(original)
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === original.parentTaskID)).toEqual(originalTask)
      expect((yield* f.execution.wait(receipt)).text).toBe(f.outputs[0])
      expect((yield* mc07Consumed(f, firstID)).text).toBe(first.text)
      expect(yield* sdkEarlyEvents(f, successor).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, successor).metas).toEqual([])
      expect((yield* f.events).filter((event) => event.event === "spawn")).toHaveLength(2)
      expect((yield* f.events).filter((event) => event.event === "read")).toHaveLength(2)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    }),
  )

for (const decision of ["deny", "reject"] as const)
  effectTest.live(`MC06 JSONL formal original Read ${decision} produces no file side effect or success`, () =>
    Effect.gen(function* () {
      const f = yield* jsonlTaskSetup()
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: decision === "deny" ? "deny" : "ask" },
        ],
      })
      const id = `mc06-jsonl-formal-read-${decision}`
      yield* f.llm.push(
        TestLLM.tool(id, TaskTool.name, jsonlInput(f, id)),
        TestLLM.text("Consumed the original JSONL permission refusal.", `${id}-parent`),
      )
      yield* f.sessions.prompt({
        sessionID: f.root.id,
        text: "Read the original JSONL input with its owning approval.",
      })
      if (decision === "reject") {
        const request = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "The JSONL Read did not ask its original parent",
        )
        yield* f.permission.reply({ requestID: request.id, reply: "reject" })
      }
      yield* awaitWithTimeout(f.runs.awaitIdle(f.root.id), "The refused JSONL Task did not settle", "10 seconds")
      const result = yield* mc07Consumed(f, id)
      expect(result.tool.state.status).toBe("error")
      const binding = yield* jsonlBinding(f, id)
      expect(binding.settlement?.status).not.toBe("completed")
      const events = yield* f.events
      expect(events.filter((event) => event.event === "read")).toEqual([])
      expect(events.filter((event) => event.event === "blocked")).toHaveLength(1)
      const response = Schema.decodeUnknownSync(
        Schema.Struct({ response: Schema.Struct({ subtype: Schema.String, request_id: Schema.String }) }),
      )(events.find((event) => event.event === "approval")?.frame)
      expect(response.response.subtype).toBe(decision === "deny" ? "success" : "error")
      expect(response.response.request_id).toBe(`control-${id}`)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      expect(yield* sdkEarlyEvents(f, binding).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, binding).metas).toEqual([])
    }),
  )

effectTest.live("MC06 JSONL formal cancellation releases the original Read and child before any late approval", () =>
  Effect.gen(function* () {
    const f = yield* jsonlTaskSetup()
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "*", effect: "ask" },
      ],
    })
    const id = "mc06-jsonl-formal-cancel-read"
    yield* f.llm.push(
      TestLLM.tool(id, TaskTool.name, jsonlInput(f, id)),
      TestLLM.text("Consumed the cancelled JSONL Task.", `${id}-parent`),
    )
    yield* f.sessions.prompt({ sessionID: f.root.id, text: "Start a cancellable JSONL parent Read." })
    const request = yield* pollWithTimeout(
      f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
      "The original JSONL Read did not ask",
    )
    const binding = yield* jsonlBinding(f, id)
    yield* awaitWithTimeout(
      f.execution.interrupt({ delegationID: binding.delegationID, participantID: binding.participantID }),
      "JSONL cancellation retained its original lock or child",
      "5 seconds",
    )
    yield* awaitWithTimeout(
      f.runs.awaitIdle(f.root.id),
      "The cancelled JSONL Task did not release its parent",
      "10 seconds",
    )
    const before = yield* Effect.all({
      tasks: f.tasks.get(f.root.id),
      state: f.delegations.foldState(binding.delegationID),
      binding: f.kv.get(DelegationReceipt.key(binding)),
    })
    expect(before.tasks.map((task) => task.status)).toEqual(["cancelled"])
    expect([...(before.state?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
    expect((yield* f.jobs.wait({ id: DelegationReceipt.key(binding) })).timedOut).toBe(false)
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    expect((yield* mc07Result(f, id)).tool.state.status).toBe("error")
    const events = yield* f.events
    expect(events.filter((event) => event.event === "read")).toEqual([])
    expect(events.filter((event) => event.event === "spawn")).toHaveLength(1)
    expect(events.some((event) => event.event === "exit" || event.event === "signal")).toBe(true)
    yield* f.permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.exit)
    expect(
      yield* Effect.all({
        tasks: f.tasks.get(f.root.id),
        state: f.delegations.foldState(binding.delegationID),
        binding: f.kv.get(DelegationReceipt.key(binding)),
      }),
    ).toEqual(before)
    expect((yield* f.events).filter((event) => event.event === "read")).toEqual([])
    expect(yield* sdkEarlyEvents(f, binding).successes).toEqual([])
    expect(yield* sdkEarlyEvents(f, binding).metas).toEqual([])
  }),
)

const jsonlCheckpoint = Effect.fnUntraced(function* (phase: "binding" | "task" | "delivery" | "tool") {
  const f = yield* jsonlTaskSetup()
  const id = `mc06-jsonl-formal-checkpoint-${phase}`
  yield* f.llm.push(
    TestLLM.tool(id, TaskTool.name, jsonlInput(f, id, { gated: true })),
    TestLLM.text("Consumed the original JSONL checkpoint.", `${id}-parent`),
  )
  yield* f.sessions.prompt({ sessionID: f.root.id, text: "Capture the actual JSONL local persistence checkpoint." })
  yield* pollWithTimeout(
    f.events.pipe(Effect.map((events) => events.find((event) => event.event === "read"))),
    "The JSONL checkpoint did not complete its parent-authorized file read",
  )
  const binding = yield* jsonlBinding(f, id)
  const key = DelegationReceipt.key(binding)
  const entered = yield* Deferred.make<void>()
  const gate = yield* Deferred.make<void>()
  const patch = f.tasks.patch
  const held =
    phase === "binding" || phase === "task"
      ? yield* Effect.acquireRelease(
          Effect.sync(() =>
            spyOn(f.tasks, "patch").mockImplementation((input, options) => {
              const result = patch(input, options)
              if (
                input.sessionID !== binding.parentSessionID ||
                input.id !== binding.parentTaskID ||
                input.expectedRevision !== binding.parentTaskRevision ||
                input.status !== "completed"
              )
                return result
              const wait = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
              return phase === "binding" ? wait.pipe(Effect.andThen(result)) : result.pipe(Effect.tap(() => wait))
            }),
          ),
          (value) => Effect.sync(() => value.mockRestore()),
        )
      : undefined
  const unsubscribe = yield* f.bus.listen((event) => {
    if (phase === "delivery" && event.type === DelegationEvent.DeliveryCompleted.type) {
      const data = Schema.decodeUnknownSync(Schema.toType(DelegationEvent.DeliveryCompletedData))(event.data)
      if (DelegationReceipt.key(data) !== key || data.attempt !== binding.attempt) return Effect.void
      return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    }
    if (phase === "tool" && event.type === SessionEvent.Tool.Success.type) {
      const data = Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID, id: Schema.String }))(event.data)
      if (data.sessionID !== f.root.id || data.id !== id) return Effect.void
      return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
    }
    return Effect.void
  })
  yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.andThen(unsubscribe), Effect.asVoid))
  yield* f.files.writeFileString(f.gatePath, "released")
  yield* awaitWithTimeout(
    Deferred.await(entered),
    `The complete JSONL result did not reach its ${phase} checkpoint`,
    "10 seconds",
  )
  const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(key))
  const receipt = Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(DelegationReceipt.fromBinding(checkpoint))
  expect(checkpoint.settlement).toEqual({ status: "completed", text: f.outputs[0] })
  expect(checkpoint.jsonlMessage).toEqual(
    new DelegationReceipt.JsonlMessage({ sessionID: "jsonl-session-1", messageID: `${id}-result` }),
  )
  expect(checkpoint.source).toEqual(binding.source)
  expect((yield* f.events).filter((event) => event.event === "stdinEOF")).toHaveLength(1)
  expect((yield* f.events).filter((event) => event.event === "exit").map((event) => event.code)).toEqual([0])
  return {
    ...f,
    id,
    key,
    binding: checkpoint,
    receipt,
    release: Deferred.succeed(gate, undefined).pipe(
      Effect.andThen(Effect.sync(() => held?.mockRestore())),
      Effect.andThen(unsubscribe),
    ),
  }
})

for (const phase of ["binding", "task", "delivery", "tool"] as const)
  effectTest.live(
    `MC06 JSONL formal cold ${phase} checkpoint preserves full original Task/Tool/Meta once without spawning`,
    () =>
      Effect.gen(function* () {
        const f = yield* jsonlCheckpoint(phase)
        const task = (yield* f.tasks.get(f.root.id)).find((task) => task.id === f.binding.parentTaskID)
        expect(task).toMatchObject({
          status: phase === "binding" ? "in_progress" : "completed",
          revision: f.binding.parentTaskRevision + (phase === "binding" ? 0 : 1),
        })
        const snapshot = `${(yield* tmpdirScoped()).path}/jsonl-${phase}.sqlite`
        yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
        const opened = yield* sdkEarlyOpen(f, snapshot)
        expect(opened.database).not.toBe(f.database)
        expect(opened.execution).not.toBe(f.execution)
        expect(opened.tasks).not.toBe(f.tasks)
        expect(opened.delegations).not.toBe(f.delegations)
        expect(opened.jobs).not.toBe(f.jobs)
        expect(opened.runs).not.toBe(f.runs)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* opened.kv.get(f.key))).toEqual(f.binding)
        const peerBefore = yield* f.events
        yield* opened.llm.serve(() =>
          TestLLM.text("Consumed the original full cold JSONL result.", `${f.id}-cold-parent`),
        )
        yield* opened.execution.recoverPending
        yield* opened.sessions.prompt({
          sessionID: opened.root.id,
          text: "Consume the original persisted JSONL result through its original Tool source.",
        })
        yield* awaitWithTimeout(
          opened.runs.awaitIdle(opened.root.id),
          "The cold Meta parent did not consume the complete JSONL result",
          "10 seconds",
        )
        const consumed = yield* mc07Consumed(opened, f.id)
        if (consumed.tool.state.status !== "completed")
          return yield* Effect.die(new Error(`Cold JSONL ${phase} did not publish its original complete Tool result`))
        const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.JsonlOutput))(consumed.text)
        expect(output.output).toBe(f.outputs[0])
        expect(output.jsonlMessage).toEqual(f.receipt.jsonlMessage)
        expect(
          Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(consumed.tool.state.metadata?.externalReceipt),
        ).toEqual(f.receipt)
        expect((yield* opened.execution.wait(f.receipt)).text).toBe(f.outputs[0])
        const events = sdkEarlyEvents(opened, f.binding)
        const before = yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.key),
          state: opened.delegations.foldState(f.binding.delegationID),
          deliveries: events.deliveries,
          successes: events.successes,
          metas: events.metas,
          messages: opened.sessions.context(opened.root.id),
        })
        expect(before.tasks.find((value) => value.id === f.binding.parentTaskID)).toMatchObject({
          status: "completed",
          revision: f.binding.parentTaskRevision + 1,
          outputDigest: DelegationReceipt.outputDigest(f.outputs[0]),
        })
        expect(before.deliveries).toHaveLength(1)
        expect(before.successes).toHaveLength(1)
        expect(before.metas).toHaveLength(1)
        expect(Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(before.metas[0]?.provenance?.externalReceipt)).toEqual(
          f.receipt,
        )
        expect(yield* opened.jobs.get(f.key)).toBeUndefined()
        yield* opened.execution.recoverPending
        yield* opened.execution.recoverPending
        expect(
          yield* Effect.all({
            tasks: opened.tasks.get(opened.root.id),
            binding: opened.kv.get(f.key),
            state: opened.delegations.foldState(f.binding.delegationID),
            deliveries: events.deliveries,
            successes: events.successes,
            metas: events.metas,
            messages: opened.sessions.context(opened.root.id),
          }),
        ).toEqual(before)
        expect(yield* f.events).toEqual(peerBefore)
        yield* f.release
        yield* awaitWithTimeout(
          f.runs.awaitIdle(f.root.id),
          "The original JSONL checkpoint parent did not release",
          "10 seconds",
        )
        expect((yield* mc07Consumed(f, f.id)).text).toBe(consumed.text)
        expect((yield* f.events).filter((event) => event.event === "spawn")).toHaveLength(1)
      }),
  )

for (const status of ["in_progress", "cancelled"] as const)
  effectTest.live(
    `MC06 JSONL formal producer checkpoint respects the ${status} owner claim before the original Task CAS`,
    () =>
      Effect.gen(function* () {
        const f = yield* jsonlCheckpoint("binding")
        const changed = yield* f.tasks.updateTask({
          sessionID: f.root.id,
          id: f.binding.parentTaskID,
          expectedRevision: f.binding.parentTaskRevision,
          status,
          content: "The original owner changed this JSONL Task before result CAS.",
        })
        expect(changed).toMatchObject({ status, revision: f.binding.parentTaskRevision + 1 })
        const snapshot = `${(yield* tmpdirScoped()).path}/jsonl-cas-${status}.sqlite`
        yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
        const opened = yield* sdkEarlyOpen(f, snapshot)
        const before = yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          state: opened.delegations.foldState(f.binding.delegationID),
          binding: opened.kv.get(f.key),
          tool: mc07Result(opened, f.id),
        })
        yield* opened.execution.recoverPending
        yield* opened.execution.recoverPending
        expect(
          yield* Effect.all({
            tasks: opened.tasks.get(opened.root.id),
            state: opened.delegations.foldState(f.binding.delegationID),
            binding: opened.kv.get(f.key),
            tool: mc07Result(opened, f.id),
          }),
        ).toEqual(before)
        expect(yield* sdkEarlyEvents(opened, f.binding).deliveries).toEqual([])
        expect(yield* sdkEarlyEvents(opened, f.binding).successes).toEqual([])
        expect(yield* sdkEarlyEvents(opened, f.binding).metas).toEqual([])
        expect(yield* opened.jobs.get(f.key)).toBeUndefined()
        yield* f.release
        yield* awaitWithTimeout(
          f.runs.awaitIdle(f.root.id),
          "The original JSONL CAS loser did not release its parent",
          "10 seconds",
        )
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === f.binding.parentTaskID)).toEqual(changed)
        expect((yield* mc07Result(f, f.id)).tool.state.status).toBe("error")
        expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.key)).settlement).toEqual({
          status: "completed",
          text: f.outputs[0],
        })
        expect((yield* f.events).filter((event) => event.event === "spawn")).toHaveLength(1)
      }),
  )

effectTest.live(
  "MC06 JSONL formal unavailable execution modes fail before original Task admission or process launch",
  () =>
    Effect.gen(function* () {
      const f = yield* jsonlTaskSetup()
      for (const [index, mode] of [
        { background: true },
        { command: "steer" as const },
        { intent: "review" as const },
      ].entries()) {
        const id = `mc06-jsonl-formal-unavailable-${index}`
        const result = yield* sdkTask(f, id, {
          description: "Check the configured JSONL capability",
          prompt: "Use the selected transport capability.",
          execution_type: "external-cli",
          cli_target: "claude-code",
          subagent_type: "claude-code",
          ...mode,
        })
        expect(result.tool.state.status).toBe("error")
        expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      }
      expect(yield* f.events).toEqual([])
      expect(yield* f.tasks.get(f.root.id)).toEqual([])
      expect(yield* f.delegations.list({ parentSessionID: f.root.id })).toEqual([])
    }),
)

effectTest.live(
  "MC06 JSONL formal append rejects a predecessor Binding whose source has no committed original Tool",
  () =>
    Effect.gen(function* () {
      const f = yield* jsonlTaskSetup()
      const firstID = "mc06-jsonl-formal-source-original"
      const first = yield* sdkTask(f, firstID, jsonlInput(f, firstID))
      if (first.tool.state.status !== "completed")
        return yield* Effect.die(new Error("The source-check predecessor did not complete"))
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Jsonl)(first.tool.state.metadata?.externalReceipt)
      const original = yield* jsonlBinding(f, firstID)
      const key = DelegationReceipt.key(original)
      const originalTask = (yield* f.tasks.get(f.root.id)).find((task) => task.id === original.parentTaskID)
      const originalTool = yield* mc07Result(f, firstID)
      const changed = new DelegationReceipt.Binding({
        ...original,
        source: { ...original.source, id: "missing-jsonl-predecessor-tool" },
      })
      yield* f.kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(changed))
      const peerBefore = yield* f.events
      const id = "mc06-jsonl-formal-source-successor"
      const result = yield* sdkTask(f, id, jsonlInput(f, id, { index: 1, previous: receipt }))
      expect(result.tool.state.status).toBe("error")
      expect(result.tool.state.metadata?.externalReceipt).toBeUndefined()
      expect(yield* f.events).toEqual(peerBefore)
      expect((yield* f.events).filter((event) => event.event === "spawn")).toHaveLength(1)
      expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(key))).toEqual(changed)
      expect(changed.settlement).toEqual({ status: "completed", text: f.outputs[0] })
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === original.parentTaskID)).toEqual(originalTask)
      expect(yield* mc07Result(f, firstID)).toEqual(originalTool)
      expect((yield* mc07Consumed(f, firstID)).text).toBe(first.text)
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    }),
)

const sdkResultPairSetup = Effect.fnUntraced(function* (duplicate = false) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "1"
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          return
        }
        process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
      }),
  )
  const f = yield* metaSetup(
    Agent.ID.make("keeper-worker"),
    true,
    Agent.ID.make("meta"),
    "sdk",
    undefined,
    "",
    "work",
    undefined,
    "claude-code",
    30_000,
  )
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.root.location)
  const permission = yield* Permission.Service.pipe(Effect.provide(local))
  const presence = yield* ApprovalPresence.Service
  yield* presence.bindResponder({ location: f.root.location, custom: false })
  yield* f.sessions.setPermissions({
    sessionID: f.root.id,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "ask" },
    ],
  })
  yield* f.llm.serve(() => TestLLM.text("Consumed the original SDK pair result.", "mc06-sdk-result-pair-notice-parent"))
  const readPath = `${f.root.location.directory}/sdk-result-pair.txt`
  const fileText = "Independent SDK pair original parent bytes\n第二行🙂\n"
  yield* Effect.promise(() => Bun.write(readPath, fileText))
  const controls = yield* Effect.forEach([0, 1], () =>
    Effect.all({
      written: Deferred.make<void>(),
      hookAnswered: Deferred.make<void>(),
      inputFinished: Deferred.make<void>(),
    }),
  )
  const run = Effect.runPromiseWith(yield* Effect.context())
  const sessionID = randomUUID()
  const firstResultUUID = randomUUID()
  const resultUUIDs = [firstResultUUID, duplicate ? firstResultUUID : randomUUID()]
  const texts = [0, 1].map((index) => {
    const prefix = ` \nSDK_RESULT_PAIR_${index}_`
    return (
      prefix + "x".repeat(4095 - prefix.length) + "🙂" + "完整结果汉字🙂\n".repeat(10_000) + `_EXACT_TAIL_${index}\n  `
    )
  })
  const queries: Parameters<ClaudeCodeSdkAdapter.ClaudeSdk["query"]>[0][] = []
  const users: (typeof sdkSteerUser.Type)[] = []
  const state = { spawned: 0, closed: 0, returned: 0, reads: 0 }
  const reads: string[] = []
  class SdkPairProcess extends EventEmitter implements SpawnedProcess {
    killed = false
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    outputEnded = false
    buffer = ""
    callbackID = ""
    hookRequestID = randomUUID()
    stdout = new Readable({ read() {} })
    frames: Record<string, unknown>[] = []
    constructor(readonly index: number) {
      super()
      this.stdin.on("finish", () => {
        void run(Deferred.succeed(controls[index].inputFinished, undefined))
      })
    }
    send(frame: Record<string, unknown>) {
      this.stdout.push(`${JSON.stringify(frame)}\n`)
    }
    lifecycle(lifecycleState: "queued" | "started" | "completed") {
      this.send({
        type: "command_lifecycle",
        command_uuid: users[this.index]?.uuid,
        state: lifecycleState,
        uuid: randomUUID(),
        session_id: sessionID,
      })
    }
    stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.buffer += String(chunk)
        const lines = this.buffer.split("\n")
        this.buffer = lines.pop() ?? ""
        void lines
          .filter(Boolean)
          .reduce(
            (pending, line) =>
              pending.then(() =>
                this.receive(
                  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(line),
                ),
              ),
            Promise.resolve(),
          )
          .then(
            () => callback(),
            (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
          )
      },
    })
    async receive(frame: Record<string, unknown>) {
      this.frames.push(frame)
      if (frame.type === "control_request") {
        const init = Schema.decodeUnknownSync(
          Schema.Struct({
            request_id: Schema.String,
            request: Schema.Struct({
              subtype: Schema.Literal("initialize"),
              hooks: Schema.Struct({
                PreToolUse: Schema.Array(Schema.Struct({ hookCallbackIds: Schema.Array(Schema.String) })),
              }),
            }),
          }),
        )(frame)
        this.callbackID = init.request.hooks.PreToolUse[0]?.hookCallbackIds[0] ?? ""
        if (!this.callbackID) throw new Error("The independent SDK query has no actual hook callback ID")
        this.send({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: init.request_id,
            response: {
              commands: [],
              agents: [],
              output_style: "default",
              available_output_styles: ["default"],
              models: [],
              account: {},
            },
          },
        })
        return
      }
      if (frame.type === "user") {
        users[this.index] = Schema.decodeUnknownSync(sdkSteerUser)(frame)
        this.send({
          type: "system",
          subtype: "init",
          uuid: randomUUID(),
          session_id: sessionID,
          cwd: f.root.location.directory,
          tools: ["Read", "Grep", "Glob"],
          mcp_servers: [],
          model: "fixture",
          permissionMode: "default",
          slash_commands: [],
          apiKeySource: "none",
          claude_code_version: "2.1.220",
          agents: [],
          skills: [],
          plugins: [],
        })
        this.lifecycle("queued")
        this.lifecycle("started")
        this.send({
          type: "control_request",
          request_id: this.hookRequestID,
          request: {
            subtype: "hook_callback",
            callback_id: this.callbackID,
            tool_use_id: `sdk-result-pair-read-${this.index}`,
            input: {
              hook_event_name: "PreToolUse",
              session_id: sessionID,
              cwd: f.root.location.directory,
              transcript_path: "sdk-pair-memory-transcript",
              tool_name: "Read",
              tool_use_id: `sdk-result-pair-read-${this.index}`,
              tool_input: { file_path: readPath },
            },
          },
        })
        await run(Deferred.succeed(controls[this.index].written, undefined))
        return
      }
      if (frame.type !== "control_response") return
      const response = Schema.decodeUnknownSync(
        Schema.Struct({
          request_id: Schema.String,
          subtype: Schema.String,
          response: Schema.optionalKey(Schema.Unknown),
        }),
      )(frame.response)
      if (response.request_id !== this.hookRequestID) return
      const answer = Schema.decodeUnknownOption(
        Schema.Struct({ hookSpecificOutput: Schema.Struct({ permissionDecision: Schema.String }) }),
      )(response.response)
      if (Option.isSome(answer) && answer.value.hookSpecificOutput.permissionDecision === "allow") {
        reads.push(await Bun.file(readPath).text())
        state.reads += 1
      }
      await run(Deferred.succeed(controls[this.index].hookAnswered, undefined))
    }
    finish(code: number | null = 0, signal: NodeJS.Signals | null = null) {
      if (this.outputEnded) return
      this.outputEnded = true
      this.exitCode = code
      this.signalCode = signal
      this.stdout.push(null)
      this.emit("exit", code, signal)
    }
    kill(signal: NodeJS.Signals) {
      this.killed = true
      this.finish(null, signal)
      return true
    }
  }
  const peers: SdkPairProcess[] = []
  yield* Effect.addFinalizer(() => Effect.sync(() => peers.forEach((peer) => peer.finish())))
  const { query } = yield* Effect.promise(() => import("@anthropic-ai/claude-agent-sdk"))
  const previous = CliAdapter.getCliAdapter("claude-code")
  const adapter = ClaudeCodeSdkAdapter.makeClaudeCodeSdkAdapter({
    query: (input) => {
      const index = queries.length
      queries.push(input)
      const owner = query({
        prompt: input.prompt,
        options: {
          ...input.options,
          pathToClaudeCodeExecutable: "/sdk-result-memory-peer/claude",
          env: { CLAUDE_CONFIG_DIR: f.root.location.directory, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" },
          spawnClaudeCodeProcess: () => {
            state.spawned += 1
            const peer = new SdkPairProcess(index)
            peers.push(peer)
            return peer
          },
        },
      })
      const close = owner.close.bind(owner)
      const iterator = owner[Symbol.asyncIterator]()
      const returned = iterator.return.bind(iterator)
      owner.close = () => {
        state.closed += 1
        close()
      }
      iterator.return = async (...args: Parameters<typeof iterator.return>) => {
        const result = await returned(...args)
        state.returned += 1
        return result
      }
      return owner
    },
  })
  CliAdapter.registerCliAdapter("claude-code", adapter)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => CliAdapter.registerCliAdapter("claude-code", previous ?? ClaudeCodeSdkAdapter.adapter)),
  )
  const result = (index: number): SDKResultSuccess => ({
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: texts[index],
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: "standard",
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    },
    modelUsage: {},
    permission_denials: [],
    terminal_reason: "completed",
    uuid: resultUUIDs[index],
    session_id: sessionID,
    user_message_uuid: users[index]?.uuid,
  })
  return {
    ...f,
    permission,
    controls,
    sessionID,
    resultUUIDs,
    texts,
    queries,
    users,
    state,
    reads,
    peers,
    fileText,
    result,
    kv: yield* KV.Service,
    tasks: yield* SessionTask.Service,
    jobs: yield* Job.Service,
    delegations: yield* DelegationService.Service,
    execution: yield* DelegationExecution.Service,
    database: yield* Database.Service,
  }
})

const sdkResultPairStart = Effect.fnUntraced(function* (f: Effect.Success<ReturnType<typeof sdkResultPairSetup>>) {
  const id = "mc06-sdk-result-pair-a"
  const ack = yield* sdkTask(f, id, {
    description: "Start the independent SDK A",
    prompt: "Read A's original parent bytes.",
    execution_type: "external-cli",
    cli_target: "claude-code",
    subagent_type: "claude-code",
    attended: true,
    background: true,
  })
  yield* awaitWithTimeout(
    Deferred.await(f.controls[0].written),
    "The first installed SDK Query did not write its actual User",
  )
  const request = yield* pollWithTimeout(
    f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
    "The first SDK Query did not ask its own parent Read",
  )
  yield* f.permission.reply({ requestID: request.id, reply: "once" })
  yield* awaitWithTimeout(
    Deferred.await(f.controls[0].hookAnswered),
    "The first SDK Query did not receive the original parent permission response",
  )
  f.peers[0].send({ ...f.result(0) })
  f.peers[0].lifecycle("completed")
  yield* awaitWithTimeout(
    Deferred.await(f.controls[0].inputFinished),
    "The first installed SDK input did not end after its own result",
  )
  f.peers[0].finish()
  const binding = yield* pollWithTimeout(
    f.kv
      .scan({ prefix: "delegation:external:" })
      .pipe(
        Effect.map((entries) =>
          entries.entries
            .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
            .find((entry) => entry.source.id === id && entry.settlement?.status === "completed"),
        ),
      ),
    "The original SDK A result did not persist",
  )
  const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(binding))
  expect((yield* f.execution.wait(receipt)).text).toBe(f.texts[0])
  yield* pollWithTimeout(
    sdkEarlyEvents(f, binding).metas.pipe(Effect.map((events) => (events.length === 1 ? true : undefined))),
    "The original SDK A notification did not reach its Meta parent",
  )
  yield* awaitWithTimeout(
    f.runs.awaitIdle(f.root.id),
    "The original SDK A parent did not consume its full notification",
  )
  return { ...f, firstAck: ack, firstBinding: binding, firstReceipt: receipt, firstRequest: request }
})

for (const duplicate of [false, true])
  effectTest.live(
    `MC06 SDK result independent installed Query append ${duplicate ? "rejects predecessor UUID reuse" : "preserves new UUID and complete result"}`,
    () =>
      Effect.gen(function* () {
        const f = yield* sdkResultPairSetup(duplicate).pipe(Effect.flatMap(sdkResultPairStart))
        const firstTask = (yield* f.tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)
        const id = "mc06-sdk-result-pair-b"
        yield* f.llm.push(
          TestLLM.tool(id, TaskTool.name, {
            description: "Append the independent SDK B",
            prompt: "Read B's original parent bytes.",
            execution_type: "external-cli",
            cli_target: "claude-code",
            subagent_type: "claude-code",
            attended: true,
            background: true,
            command: "append",
            delegation_id: f.firstReceipt.delegationID,
            participant_id: f.firstReceipt.participantID,
          }),
          TestLLM.text("Consumed the independent SDK B admission.", `${id}-parent`),
        )
        yield* f.sessions.prompt({
          sessionID: f.root.id,
          text: "Continue the completed SDK session with an independent background Query.",
        })
        yield* awaitWithTimeout(
          Deferred.await(f.controls[1].written),
          "The second installed SDK Query did not write its independent User",
        )
        yield* awaitWithTimeout(
          f.runs.awaitIdle(f.root.id),
          "The background SDK B did not return its original admission ACK",
        )
        const ack = yield* mc07Consumed(f, id)
        const admission = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(ack.text)
        expect(admission).toMatchObject({ execution: "admitted", status: "running" })
        expect(admission).not.toHaveProperty("sdkMessage")
        const request = yield* pollWithTimeout(
          f.permission.forSession(f.root.id).pipe(Effect.map((pending) => pending[0])),
          "The second SDK Query did not ask its own parent Read",
        )
        expect(request.id).not.toBe(f.firstRequest.id)
        expect(Schema.decodeUnknownSync(Permission.ToolSource)(request.source).id).toBe(id)
        expect(f.queries).toHaveLength(2)
        expect(typeof f.queries[1]?.prompt).toBe("object")
        expect(f.queries[1]?.options?.resume).toBe(f.sessionID)
        expect(f.users[1]?.session_id).toBe(f.sessionID)
        expect(f.users[0]?.uuid).not.toBe(f.users[1]?.uuid)
        expect(f.state.reads).toBe(1)
        yield* f.permission.reply({ requestID: request.id, reply: "once" })
        yield* awaitWithTimeout(
          Deferred.await(f.controls[1].hookAnswered),
          "The second installed SDK Query did not receive its original Read answer",
        )
        yield* f.llm.push(TestLLM.text("Consumed the complete original SDK B notification.", `${id}-notice-parent`))
        f.peers[1].send({ ...f.result(1) })
        f.peers[1].lifecycle("completed")
        yield* awaitWithTimeout(
          Deferred.await(f.controls[1].inputFinished),
          "The successor's own result did not end its SDK input",
        )
        f.peers[1].finish()
        const binding = yield* pollWithTimeout(
          f.kv
            .scan({ prefix: `delegation:external:${f.firstReceipt.delegationID}:` })
            .pipe(
              Effect.map((entries) =>
                entries.entries
                  .map((entry) => Schema.decodeUnknownSync(DelegationReceipt.Binding)(entry.value))
                  .find((entry) => entry.source.id === id && entry.settlement !== undefined),
              ),
            ),
          "The background SDK B did not persist its original outcome",
        )
        const noticeID = DelegationReceipt.notificationID(
          DelegationFold.inputID(binding.delegationID, binding),
          binding.parentTaskID,
        )
        const notice = yield* pollWithTimeout(
          f.sessions
            .context(f.root.id)
            .pipe(
              Effect.map((messages) =>
                messages.find((message) => message.type === "synthetic" && message.id === noticeID),
              ),
            ),
          "The background SDK B did not publish its original terminal notice",
        )
        if (notice.type !== "synthetic")
          return yield* Effect.die(new Error("The SDK pair terminal notice has another message type"))
        yield* pollWithTimeout(
          sdkEarlyEvents(f, binding).metas.pipe(Effect.map((events) => (events.length === 1 ? true : undefined))),
          "The background SDK B terminal notice did not reach its Meta parent",
        )
        yield* awaitWithTimeout(
          f.runs.awaitIdle(f.root.id),
          "The independent background SDK append did not release its parent",
          "10 seconds",
        )
        expect(binding.source).not.toEqual(f.firstBinding.source)
        expect(binding.parentTaskID).not.toBe(f.firstBinding.parentTaskID)
        const metas = yield* sdkEarlyEvents(f, binding).metas
        expect(metas).toHaveLength(1)
        if (duplicate) {
          const text = "SDK result reused a message identity already owned by its predecessor or another input"
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.PendingOutput))(notice.text)
          const receipt = Schema.decodeUnknownSync(DelegationReceipt.Pending)(notice.metadata?.externalReceipt)
          expect(output).toMatchObject({ status: "failed", output: text, parentTaskID: binding.parentTaskID })
          expect(output).not.toHaveProperty("sdkMessage")
          expect(binding.sdkMessage).toBeUndefined()
          expect(binding.settlement).toEqual({ status: "failed", text })
          expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
          expect(metas[0]?.status).toBe("failed")
          expect(Schema.decodeUnknownSync(DelegationReceipt.Pending)(metas[0]?.provenance?.externalReceipt)).toEqual(
            receipt,
          )
          expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)?.status).toBe(
            "failed",
          )
        }
        if (!duplicate) {
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text)
          const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(notice.metadata?.externalReceipt)
          expect(output.output).toBe(f.texts[1])
          expect(output.output.charCodeAt(4095)).toBe(0xd83d)
          expect(output.sdkMessage).toEqual(
            new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: f.resultUUIDs[1] }),
          )
          expect(binding.settlement).toEqual({ status: "completed", text: f.texts[1] })
          expect(DelegationReceipt.matches(binding, receipt)).toBe(true)
          expect((yield* f.execution.wait(receipt)).text).toBe(f.texts[1])
          expect(metas[0]?.status).toBe("completed")
          expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(metas[0]?.provenance?.externalReceipt)).toEqual(
            receipt,
          )
        }
        expect(
          (yield* f.llm.requests()).some((request) =>
            request.messages.some(
              (message) =>
                message.role === "user" &&
                message.content.some((part) => part.type === "text" && part.text.includes(notice.text)),
            ),
          ),
        ).toBe(true)
        expect((yield* mc07Result(f, id)).tool).toEqual(ack.tool)
        expect(yield* sdkEarlyEvents(f, binding).successes).toHaveLength(1)
        expect((yield* f.jobs.wait({ id: DelegationReceipt.key(binding) })).timedOut).toBe(false)
        expect(
          Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(DelegationReceipt.key(f.firstBinding))),
        ).toEqual(f.firstBinding)
        expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === f.firstBinding.parentTaskID)).toEqual(
          firstTask,
        )
        expect((yield* mc07Result(f, "mc06-sdk-result-pair-a")).tool).toEqual(f.firstAck.tool)
        expect((yield* f.execution.wait(f.firstReceipt)).text).toBe(f.texts[0])
        expect(f.reads).toEqual([f.fileText, f.fileText])
        expect(f.state).toEqual({ spawned: 2, closed: 2, returned: 2, reads: 2 })
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      }),
  )

for (const duplicate of [false, true])
  effectTest.live(
    `MC06 SDK result same installed Query ${duplicate ? "rejects another input's result UUID" : "preserves normal complete A and B separately"}`,
    () =>
      Effect.gen(function* () {
        const f = yield* sdkSteerSetup(30_000, false).pipe(
          Effect.flatMap(sdkSteerStart),
          Effect.flatMap((started) => sdkSteerAdmit(started)),
        )
        yield* f.permission.reply({ requestID: f.aRequest.id, reply: "once" })
        yield* awaitWithTimeout(
          Deferred.await(f.gates.aHookAnswered),
          "Normal A did not receive its original owning Read permission",
        )
        yield* sdkSteerAnswer(f)
        if (!f.aBinding.sdkInput || !f.bBinding.sdkInput)
          return yield* Effect.die(new Error("Normal A/B lost their actual input UUIDs"))
        const aText = " \nNORMAL_A_FULL_" + "A结果🙂\n".repeat(15_000) + "_A_TAIL\n  "
        const aUUID = randomUUID()
        f.emit({ ...f.result(f.aBinding.sdkInput.uuid, aText), uuid: aUUID })
        f.lifecycle(f.aBinding.sdkInput.uuid, "completed")
        yield* pollWithTimeout(
          f.kv
            .get(f.aKey)
            .pipe(
              Effect.map((raw) =>
                Schema.decodeUnknownSync(DelegationReceipt.Binding)(raw).settlement?.status === "completed"
                  ? true
                  : undefined,
              ),
            ),
          "Normal A did not persist its own complete result",
        )
        expect(f.state.inputFinished).toBe(false)
        f.emit({ ...f.result(f.bBinding.sdkInput.uuid), ...(duplicate ? { uuid: aUUID } : {}) })
        f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
        yield* awaitWithTimeout(
          Deferred.await(f.gates.inputFinished),
          "Normal A/B native termination did not end their original feed",
        )
        f.peer.finish()
        yield* awaitWithTimeout(
          f.runs.awaitIdle(f.root.id),
          "Normal A/B did not finish their original Query cleanup",
          "10 seconds",
        )
        const a = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.aKey))
        const b = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
        const consumed = yield* mc07Consumed(f, "mc06-sdk-steer-b")
        expect(a.settlement).toEqual({ status: "completed", text: aText })
        expect(a.sdkMessage).toEqual(new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: aUUID }))
        const notice = (yield* f.sessions.context(f.root.id)).find(
          (message) =>
            message.type === "synthetic" &&
            message.metadata?.source === "task" &&
            message.metadata.externalReceipt &&
            Schema.decodeUnknownSync(DelegationReceipt.Outcome)(message.metadata.externalReceipt).source.id ===
              "mc06-sdk-steer-a",
        )
        if (notice?.type !== "synthetic")
          return yield* Effect.die(new Error("Normal A lost its own complete background notification"))
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(notice.text).output).toBe(
          aText,
        )
        expect((yield* mc07Result(f, "mc06-sdk-steer-a")).tool).toEqual(f.first.tool)
        if (duplicate) {
          expect(consumed.tool.state.status).toBe("error")
          expect(b.sdkMessage).toBeUndefined()
          expect(b.settlement?.status).toBe("failed")
          expect(yield* sdkEarlyEvents(f, b).metas).toEqual([])
        }
        if (!duplicate) {
          if (consumed.tool.state.status !== "completed")
            return yield* Effect.die(new Error("Normal B did not keep its complete independent result"))
          const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(consumed.text)
          expect(output.output).toBe(f.text)
          expect(b.sdkMessage).toEqual(
            new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: f.resultUUID }),
          )
          expect(yield* sdkEarlyEvents(f, b).metas).toHaveLength(1)
        }
        expect(f.state.reads).toBe(2)
        expect(f.queries).toHaveLength(1)
        expect(f.state).toMatchObject({ spawned: 1, closed: 1, returned: 1, inputFinished: true, outputEnded: true })
        expect(yield* f.permission.forSession(f.root.id)).toEqual([])
      }),
  )

effectTest.live(
  "MC06 SDK result first visible success Binding is complete before Task CAS and cold recovery consumes it once",
  () =>
    Effect.gen(function* () {
      const f = yield* sdkSteerSetup().pipe(
        Effect.flatMap(sdkSteerStart),
        Effect.flatMap((started) => sdkSteerAdmit(started)),
      )
      yield* sdkSteerAnswer(f)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const writes: DelegationReceipt.Binding[] = []
      const set = f.kv.set
      const held = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(f.kv, "set").mockImplementation((key, value) => {
            const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(value)
            if (
              key !== f.bKey ||
              Option.isNone(decoded) ||
              !decoded.value.sdkInput?.observations.some(
                (observation) =>
                  observation instanceof DelegationReceipt.SdkResultObservation && observation.uuid === f.resultUUID,
              )
            )
              return set(key, value)
            writes.push(decoded.value)
            const result = set(key, value)
            if (writes.length !== 1) return result
            return result.pipe(
              Effect.tap(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))),
            )
          }),
        ),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("The first write test lost B's input UUID"))
      f.emit({ ...f.result(f.bBinding.sdkInput.uuid) })
      f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
      yield* awaitWithTimeout(
        Deferred.await(entered),
        "The actual first SDK success Binding write did not finish before CAS",
      )
      const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
      expect(writes).toHaveLength(1)
      expect(checkpoint).toEqual(writes[0])
      expect(checkpoint.settlement).toEqual({ status: "completed", text: f.text })
      expect(checkpoint.sdkMessage).toEqual(
        new DelegationReceipt.SdkMessage({ sessionID: f.sessionID, messageID: f.resultUUID }),
      )
      expect(
        checkpoint.sdkInput?.observations.find(
          (observation) => observation instanceof DelegationReceipt.SdkResultObservation,
        ),
      ).toMatchObject({ user_message_uuid: f.bBinding.sdkInput.uuid, result: f.text, uuid: f.resultUUID })
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === checkpoint.parentTaskID)).toMatchObject({
        status: "in_progress",
        revision: checkpoint.parentTaskRevision,
      })
      expect(yield* sdkEarlyEvents(f, checkpoint).deliveries).toEqual([])
      const snapshot = `${(yield* tmpdirScoped()).path}/sdk-result-first-write.sqlite`
      yield* f.database.db.run(sql`VACUUM INTO ${snapshot}`)
      const opened = yield* sdkEarlyOpen(f, snapshot)
      expect(opened.database).not.toBe(f.database)
      expect(opened.execution).not.toBe(f.execution)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(DelegationReceipt.fromBinding(checkpoint))
      yield* opened.llm.serve(() =>
        TestLLM.text("Consumed the first complete persisted SDK result.", "mc06-sdk-result-first-write-cold-parent"),
      )
      yield* opened.execution.recoverPending
      yield* opened.sessions.prompt({
        sessionID: opened.root.id,
        text: "Consume the original first persisted SDK B result.",
      })
      yield* awaitWithTimeout(
        opened.runs.awaitIdle(opened.root.id),
        "The cold first-write SDK parent did not consume B",
        "10 seconds",
      )
      const consumed = yield* mc07Consumed(opened, "mc06-sdk-steer-b")
      if (consumed.tool.state.status !== "completed")
        return yield* Effect.die(new Error("Cold first-write SDK B has no original complete Tool result"))
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(consumed.text).output).toBe(
        f.text,
      )
      expect(Schema.decodeUnknownSync(DelegationReceipt.Sdk)(consumed.tool.state.metadata?.externalReceipt)).toEqual(
        receipt,
      )
      const events = sdkEarlyEvents(opened, checkpoint)
      const before = yield* Effect.all({
        tasks: opened.tasks.get(opened.root.id),
        binding: opened.kv.get(f.bKey),
        state: opened.delegations.foldState(checkpoint.delegationID),
        successes: events.successes,
        metas: events.metas,
        deliveries: events.deliveries,
        messages: opened.sessions.context(opened.root.id),
      })
      expect(before.successes).toHaveLength(1)
      expect(before.metas).toHaveLength(1)
      expect(before.deliveries).toHaveLength(1)
      expect((yield* opened.execution.wait(receipt)).text).toBe(f.text)
      yield* opened.execution.recoverPending
      yield* opened.execution.recoverPending
      expect(
        yield* Effect.all({
          tasks: opened.tasks.get(opened.root.id),
          binding: opened.kv.get(f.bKey),
          state: opened.delegations.foldState(checkpoint.delegationID),
          successes: events.successes,
          metas: events.metas,
          deliveries: events.deliveries,
          messages: opened.sessions.context(opened.root.id),
        }),
      ).toEqual(before)
      expect(f.queries).toHaveLength(1)
      yield* Deferred.succeed(release, undefined)
      yield* Effect.sync(() => held.mockRestore())
      yield* awaitWithTimeout(
        Deferred.await(f.gates.inputFinished),
        "The original first-write SDK feed did not finish after release",
      )
      f.peer.finish()
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The original first-write SDK parent did not finish",
        "10 seconds",
      )
    }),
)

effectTest.live(
  "MC06 SDK result matching native error preserves full text and ends its own failed input after lifecycle completion",
  () =>
    Effect.gen(function* () {
      const f = yield* sdkSteerSetup().pipe(
        Effect.flatMap(sdkSteerStart),
        Effect.flatMap((started) => sdkSteerAdmit(started)),
      )
      yield* sdkSteerAnswer(f)
      if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("The matching SDK error lost B's actual input UUID"))
      const errors = [
        " \nMATCHED_NATIVE_ERROR_" + "完整原生错误🙂\n".repeat(12_000) + "_FIRST_ERROR_TAIL\n ",
        "\nSECOND_ERROR\n  ",
      ]
      const text = errors.join("\n")
      f.emit({
        ...f.result(f.bBinding.sdkInput.uuid),
        subtype: "error_during_execution",
        is_error: true,
        result: undefined,
        errors,
        terminal_reason: "api_error",
      })
      f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
      yield* awaitWithTimeout(
        Deferred.await(f.gates.inputFinished),
        "The matched native error did not release its original SDK feed",
      )
      f.peer.finish()
      yield* awaitWithTimeout(
        f.runs.awaitIdle(f.root.id),
        "The matched native SDK error did not release its parent waiter",
        "10 seconds",
      )
      const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
      const consumed = yield* mc07Consumed(f, "mc06-sdk-steer-b")
      expect(binding.settlement).toEqual({ status: "failed", text })
      expect(binding.sdkMessage).toBeUndefined()
      expect(
        binding.sdkInput?.observations.find(
          (observation) => observation instanceof DelegationReceipt.SdkResultObservation,
        ),
      ).toMatchObject({ user_message_uuid: f.bBinding.sdkInput.uuid, errors, is_error: true })
      expect(consumed.tool.state.status).toBe("error")
      if (consumed.tool.state.status !== "error")
        return yield* Effect.die(new Error("The matched SDK error was delivered as a success"))
      expect(consumed.tool.state.error.message).toContain(text)
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)?.status).toBe("failed")
      expect(yield* sdkEarlyEvents(f, binding).successes).toEqual([])
      expect(yield* sdkEarlyEvents(f, binding).metas).toEqual([])
      expect(f.state).toMatchObject({ spawned: 1, closed: 1, returned: 1, inputFinished: true, outputEnded: true })
      expect(yield* f.permission.forSession(f.root.id)).toEqual([])
    }),
)

effectTest.live("MC06 SDK result completed B survives a nonzero original Query exit with its complete identity", () =>
  Effect.gen(function* () {
    const f = yield* sdkSteerSetup().pipe(
      Effect.flatMap(sdkSteerStart),
      Effect.flatMap((started) => sdkSteerAdmit(started)),
    )
    yield* sdkSteerAnswer(f)
    if (!f.bBinding.sdkInput) return yield* Effect.die(new Error("The tail failure test lost B's actual input UUID"))
    f.emit({ ...f.result(f.bBinding.sdkInput.uuid) })
    f.lifecycle(f.bBinding.sdkInput.uuid, "completed")
    yield* awaitWithTimeout(
      Deferred.await(f.gates.inputFinished),
      "B's complete native result did not end the original feed",
    )
    const checkpoint = Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))
    expect(checkpoint.settlement).toEqual({ status: "completed", text: f.text })
    f.peer.finish(7)
    yield* awaitWithTimeout(
      f.runs.awaitIdle(f.root.id),
      "The completed SDK result did not survive its original Query exit",
      "10 seconds",
    )
    const consumed = yield* mc07Consumed(f, "mc06-sdk-steer-b")
    if (consumed.tool.state.status !== "completed")
      return yield* Effect.die(new Error(`B was lost after nonzero exit: ${JSON.stringify(consumed.tool.state)}`))
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.SdkOutput))(consumed.text)
    const receipt = Schema.decodeUnknownSync(DelegationReceipt.Sdk)(consumed.tool.state.metadata?.externalReceipt)
    expect(output.output).toBe(f.text)
    expect(checkpoint.sdkMessage).toEqual(output.sdkMessage)
    expect((yield* f.execution.wait(receipt)).text).toBe(f.text)
    expect(Schema.decodeUnknownSync(DelegationReceipt.Binding)(yield* f.kv.get(f.bKey))).toEqual(checkpoint)
    expect(yield* sdkEarlyEvents(f, checkpoint).metas).toHaveLength(1)
    expect(f.peer.exitCode).toBe(7)
    expect(f.state).toMatchObject({ spawned: 1, closed: 1, returned: 1, outputEnded: true })
    expect(yield* f.permission.forSession(f.root.id)).toEqual([])
  }),
)
