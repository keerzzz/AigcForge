# S9A Work Review-Lifecycle 契约（APPROVED 2026-09-20 — 状态机已落地，producer/E4 待续）

> **性质**：Owner 已批准的契约 + 已实现的纯状态机。剩余生产实现（producer + 持久化字段 + E4 lifeline）见 §6。
> **状态**：APPROVED（Owner 裁决 2026-09-20）。已落地:`WorkReview.Review` schema + 纯状态机 `WorkReviewMachine`（`transition`/`isVerdictCurrent`）+ 12 断言（6 迁移 + I1-I4 + 持久化 round-trip）12 pass/0 fail，schema+core typecheck exit=0。Owner 裁决:复用 `open`+`reopenedFrom`（不设第 5 态）、metadata JSON 无迁移;Assistant M2 scope 不立、转后期。
> **日期**：2026-09-20 ｜ 分支 `global-shell-e2e`
> **前置已落地**：`803300877 feat(work): persist a durable Work contract snapshot`（`WorkContract.Snapshot` + `WorkPreset.Revision`，无迁移，metadata JSON）。本草案在其之上补 review 生命周期。

---

## 1. 为什么需要 Owner 拍板（不能我自己定）

`docs/prd/work-mode-execution-layer.md` **未定义** review 生命周期状态。`open→fix_requested→responded→resolved/reopened` 来自更早的审批口径（S9A owner unlock），**不是已批准的产品契约**。因此本文只提议，不落地。三处需要 Owner 决定：

1. **状态集与允许的迁移**（§3）——是否就是这 5 态，还是增减。
2. **schema 归属**（§4）——review 状态挂在 `WorkArtifact.ArtifactRecord` 上，还是独立 `WorkReview` schema。
3. **持久化**（§5）——沿用 metadata JSON（无迁移，我倾向），还是要 durable 列（需迁移 + 你另行批准）。

## 2. 复用现状（不新造平行实现）

| 已有 owner | 现状 | 本草案如何复用 |
|---|---|---|
| `WorkArtifact.ArtifactRecord`（`packages/core/src/session/artifact.ts:21`） | `status: available\|missing`，无 review 态 | 提议在其**旁**加 review 态，不改 `status` 语义 |
| `WorkContract.Snapshot`（`packages/schema/src/work-contract.ts`） | preset\|workflow\|ad-hoc + `contractVersion:1` | review 生命周期引用 `contractVersion` 做版本门 |
| `WorkArtifact.ArtifactSnapshot`（`artifact.ts:67`） | `{ artifact, revision }` in-memory | reviewer revision 复用同一 `revision` 概念 |
| session `metadata` JSON | 已存 `workContract`/`presetCategoryId` | review 态同法存入，**无迁移** |

## 3. 提议状态机（待批）

```
        submit for review
  (none) ─────────────────▶ open
                              │
              reviewer asks   │  reviewer approves
              for changes     ▼
    fix_requested ◀───────── open ──────────▶ resolved
        │  author responds            reopen │ ▲
        ▼                                     ▼ │
    responded ───────────▶ open          (resolved) 
                reviewer                   author/reviewer
                re-reviews                 reopen
```

- `open`：已提交待评审。
- `fix_requested`：评审要求修改（附 reviewer revision，钉住被评审的 artifact 版本）。
- `responded`：作者已回应，回到评审。
- `resolved`：评审通过（终态，但可 `reopen`）。
- `reopened`：从 `resolved` 重新打开 → 语义上回到 `open`（是否单列为态由 Owner 定；我倾向复用 `open` + 一个 `reopenedFrom` 标记，少一个态）。

**不变量（RED spec 将钉死）**：
- I1 迁移必须显式，非法迁移（如 `resolved→responded`）拒绝。
- I2 每个 `fix_requested`/`resolved` 必须携带**被评审的 artifact revision**——review 结论只对该 revision 有效（防止"审的是旧版、改的是新版"漂移）。
- I3 artifact 内容更新后，未 `responded` 的 review 结论不得自动生效（对齐 `WorkContract` 的 revision 门）。
- I4 无 review 记录的 Work session 是合法的 ad-hoc（不强制 review）。

## 4. 提议 schema 形状（待批，示意非最终）

```ts
// packages/schema/src/work-review.ts （草案，尚未创建）
export const ReviewState = Schema.Literals(["open", "fix_requested", "responded", "resolved"])
export const Review = Schema.Struct({
  contractVersion: WorkContract.ContractVersion,      // 复用，不新造
  state: ReviewState,
  artifactRevision: WorkflowAsset.Revision,           // I2：钉住被评审版本
  reopenedFrom: Schema.optional(ReviewState),         // reopen 用，避免第 5 态
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkReview.Review" })
```

挂载点（二选一，待 Owner）：(a) `Session.Info.workReview`（同 `workContract`，metadata JSON，无迁移）；(b) `ArtifactRecord.review`（与 artifact 同源）。**我倾向 (a)**——review 是 session 级契约态，和 `workContract` 同层，复用已验证的 metadata 路径。

## 5. E4 MVP scope 决策（回答"CI / 缩 MVP"）

**结论：MVP 广度 + CI(ext4) 执行。** 依据实读的 `.github/workflows/test.yml` E4 job：

- **可行**：E4 job 跑在 `ubuntu-latest`（ext4），正是 FUSE 阻断的解锁面。
- **MVP 允许**（诚实 scope-cut，Chat E4 §5.2 先例）：先跑**单 backend 一条 happy-path** contract→review→artifact 生命线；把 `identity-e4-cross-server-and-historical` 的第二 backend + 历史 seed + 失败矩阵**登记为 post-MVP**（owner/unlock 保留）。
- **红线不砍**：每条 E4 仍真 backend + 真 SQLite + 真 provider turn + 持久化恢复；不降断言、不加 sleep/retry、不 mock 冒充 E4。砍广度不砍深度。
- **两个 CI 前提**（配置实读）：
  1. E4 job `if: github.event_name != 'pull_request'` → `pull_request` 跳过；本分支非 `dev`，需 `workflow_dispatch` 手动触发或确认 push 触发覆盖。
  2. "Run E4 — V2 variant" step **缺 `if: always()`** → 默认 runtime step 失败则 V2 被跳过。若要"无论默认结果都取 V2 证据"，先补 `if: always()` 或明确接受该语义。

## 6. 待批清单（Owner 逐条）

- [x] §3 状态集与迁移 — 批准:复用 `open`+`reopenedFrom`（不设第 5 态）。已实现于 `WorkReviewMachine.transition`。
- [x] §4 schema 归属 — 批准 `WorkReview.Review`（独立 schema，复用 `WorkContract.ContractVersion` + `WorkflowAsset.Revision`）。
- [x] §5 持久化 — 批准 metadata JSON 无迁移;schema round-trip 断言已过。
- [ ] §5 E4 MVP scope（单 backend happy-path now，cross-server/历史/失败矩阵 post-MVP）— **待续**，需 CI/ext4。
- [ ] CI：补 V2 step 的 `if: always()` 与触发方式 — **待续**。

**已落地（本单元）**：`packages/schema/src/work-review.ts`、`packages/core/src/session/work-review.ts`、`packages/core/test/work-review-lifecycle.test.ts`（12 pass/0 fail）、`schema/index.ts` 导出。
**仍待续（下一单元，需 producer）**：调用 `transition()` 并把结果写入 session `metadata.workReview` 的 producer + `Session.Info.workReview` 读字段 + `info.fromRow` 解码（**故意未落**，避免"有读无写"半切片）;单 backend E4 lifeline（CI/ext4）。状态机是纯函数、可调用，但尚无调用方。**未 push。**
