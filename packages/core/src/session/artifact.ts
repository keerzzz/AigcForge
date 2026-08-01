export * as WorkArtifact from "./artifact"

import { Schema } from "effect"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"

/**
 * M1 Artifact 契约（D2 定案：内存态事件，不落库，对齐 ADR-15 §5）。
 * 落盘成功后发 `work.artifact_applied` 事件，App 侧监听更新 Artifact Tab。
 * 跨刷新丢失可接受（M1），M2 存为资产时转 Chat 资产持久化。
 */
export const ArtifactRecord = Schema.Struct({
  id: Schema.String.annotate({ description: "稳定 Artifact ID" }),
  sessionID: SessionSchema.ID,
  kind: Schema.Literal("document").annotate({ description: "M1 固定" }),
  title: Schema.String,
  mediaType: Schema.Literal("text/markdown"),
  relativePath: Schema.String.annotate({ description: "相对 Session Location，规范化后不得越界" }),
  status: Schema.Literals(["available", "missing"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkArtifact.ArtifactRecord" })
export type ArtifactRecord = typeof ArtifactRecord.Type

export const Event = {
  ArtifactApplied: EventV2.define({
    type: "work.artifact_applied",
    schema: {
      sessionID: SessionSchema.ID,
      artifactID: Schema.String,
    },
  }),
}
