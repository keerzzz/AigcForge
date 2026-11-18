export * as CompositionFixture from "./composition"

import { Effect } from "effect"
import { Agent } from "@aigcfroge/core/agent"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { Composition } from "@aigcfroge/schema/composition"

/** Persist a runnable frozen policy without replacing any permission owner. */
export const attach = Effect.fn("CompositionFixture.attach")(function* (
  sessionID: Session.ID,
  info: Agent.Info,
  options: { orchestrator?: Agent.Info; tools?: Composition.SnapshotToolInfo } = {},
) {
  const compositions = yield* SessionComposition.Service
  const revision = Composition.Revision.make("a".repeat(64))
  const relativePath = `${info.id}.md`
  const consumerKey = `agents/${info.name}`
  const data = new Composition.SnapshotDataV2({
    orchestrator:
      options.orchestrator ??
      Agent.Info.make({
        ...Agent.Info.empty(Agent.ID.make("meta")),
        mode: "primary",
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      }),
    agents: [
      new Composition.AgentInfo({
        id: info.id,
        name: info.name,
        description: info.description ?? "Permission fixture executor",
        relativePath,
        revision,
        consumerKey,
      }),
    ],
    executors: [
      new Composition.SnapshotExecutorData({
        id: info.id,
        relativePath,
        revision,
        info: Agent.Info.make({ ...info, originRelativePath: relativePath, originRevision: revision }),
      }),
    ],
    bindings: {
      orchestrator: new Composition.SnapshotBindingData({ instructions: [], prompts: [], skills: [], commands: [] }),
      [consumerKey]: new Composition.SnapshotBindingData({ instructions: [], prompts: [], skills: [], commands: [] }),
    },
    instructions: [],
    prompts: [],
    skills: [],
    // assertDependency rejects an empty catalog; the policy fixture needs one
    // captured tool even though these tests call Permission directly.
    tools:
      options.tools ??
      CompositionDigest.captureTools(
        [
          {
            type: "tool",
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            outputSchema: { type: "string" },
            placement: "direct",
            options: { codemode: false, permission: "read" },
          },
        ],
        "/project",
        "test",
      ),
    mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
  })
  yield* compositions.attach(
    sessionID,
    new Composition.SnapshotV2({
      version: 2,
      digest: CompositionDigest.computeDigest(data),
      sessionID,
      createdAt: 1_790_000_000_000,
      data,
    }),
  )
  return yield* compositions.assertDependency(sessionID)
})
