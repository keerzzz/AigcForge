# S9A Work Review-Lifecycle 契约（APPROVED 2026-09-20；当前实施进展见 §7–8）

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

| 已有 owner                                                                  | 现状                                           | 本草案如何复用                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `WorkArtifact.ArtifactRecord`（`packages/core/src/session/artifact.ts:21`） | `status: available\|missing`，无 review 态     | 提议在其**旁**加 review 态，不改 `status` 语义 |
| `WorkContract.Snapshot`（`packages/schema/src/work-contract.ts`）           | preset\|workflow\|ad-hoc + `contractVersion:1` | review 生命周期引用 `contractVersion` 做版本门 |
| `WorkArtifact.ArtifactSnapshot`（`artifact.ts:67`）                         | `{ artifact, revision }` in-memory             | reviewer revision 复用同一 `revision` 概念     |
| session `metadata` JSON                                                     | 已存 `workContract`/`presetCategoryId`         | review 态同法存入，**无迁移**                  |

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
  contractVersion: WorkContract.ContractVersion, // 复用，不新造
  state: ReviewState,
  artifactRevision: WorkflowAsset.Revision, // I2：钉住被评审版本
  reopenedFrom: Schema.optional(ReviewState), // reopen 用，避免第 5 态
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

## 7. 2026-10-06 B4 / S06 producer amendment（2026-10-07 API/data 本地验证，未批准发布）

本节由冻结的智能体交互/UI R2 §3、S06 及用户本轮 B4 续作授权决定，替代上文仍写“待 producer”的当前实施边界；上文日期、12 项旧断言与当时未交付事项是历史记录，不回写为新合同已验收。B4 实现与最终验证状态见 `docs/technical-debt.md` §15.7；S07 UI/真实 provider E4 仍是后续批次。

- **单一持久化 owner**：`WorkReviewService` Location-scoped，接收 Session ID；`metadata.workReview` 只有一份 Review。`WorkArtifact` 通过原 `FileMutation`/`LocationMutation` 写文件后保存 `metadata.workArtifact` 的 `{ artifact, revision }` 引用；不存正文、不新增数据库表。真实读回重新验证 Session/Location、路径、符号链接与内容 hash；内存 Map 不再是产物真源。
- **直接升级 schema**：Review 仍为 `open / fix_requested / responded / resolved`，新增必需 `artifactID` 与正整数 `revision`。`artifactRevision` 是内容 hash；`revision` 是唯一并发版本；`updatedAt` 不是版本。只有无记录才接受 expected 0；损坏/缺字段 Review 是 unavailable，不补旧数据默认值。
- **受检命令**：公开 POST 只接收 action、expectedReviewRevision 及该动作的 artifactID/expectedArtifactRevision；拒绝 next state、actor/owner、Location、任意 metadata。submit 建立绑定；approve/request_changes 只能评价当前绑定；respond 保留绑定；re_review/reopen 显式重绑。新增已批准的 stale-open → open re_review 自转换；未过期 open 不能借此跳过生命周期。
- **一致性边界**：`WorkReviewMachine.isVerdictCurrent` 同时比较 ID 与内容 revision；相同内容的新产物不继承旧批准。事务内读取/校验 Review、条件更新 revision，保持其它 metadata 键；scope 锁不替代 SQLite CAS。Artifact 保持 Session/真实目标协调，锁内文件读写与绑定校验；文件系统与 SQLite 不是一个原子事务，部分失败必须显式可恢复。事务已提交而产物后验检查失败时，HTTP storage 错误保留 `committedRevision` 并要求权威 GET；提交前失败不报告已提交修订号。
- **其它写入者**：通用 Session metadata 创建/更新不能伪造 Review/Artifact；WorkContract 创建仍走当前真实 draft/metadata 路径并校验。Session 更新投影保留事务中已有的 Work owner 键，迟到 full-info 事件不能覆盖 Review；fork 不复制 Review/Artifact 身份。审批不调用 permission grant、provider 或自动恢复。
- **读取合同**：GET 返回 none、ready（Review + 当前 Binding + current）或 unavailable（可解释原因）；这些是可用性而非第五生命周期态。 SQL NULL（无元数据）与 JSON 文本 `null`（损坏元数据）保持区分；后者不能伪装成没有 Review。两条当前 Session GET/生成 SDK 直接读取规范 `workReview`，无旧外观转换。摘要不是批准当前内容的证明，详情必须重新核验真实文件。
- **HTTP**：在现有 `server.session` 上提供 GET/POST `/api/session/:sessionID/work-review`，identifier 为 `v2.session.workReview.get` / `v2.session.workReview.transition`。复用 Authorization 与持久化 SessionLocation；后者仅定位，不是角色授权。启用认证时缺/错凭证 401；没有新增“只许人类审批”的身份保证。
- **生成 SDK**：已由官方生成器确认 `client.v2.session.workReview.get({ sessionID })` 与 `client.v2.session.workReview.transition({ sessionID, workReviewCommand })`；`workReviewCommand` 是生成客户端的参数名，实际 HTTP 正文仍为规范 Command，不新增外层 body 或手写客户端。实际调用结果以 B4 验证记录为准。
- **通知**：`work.review.updated` 只带 sessionID、Review.revision 与规范 Review，不带正文；沿 EventV2/既有 SSE。保存成功后通知失败返回可解释的 committedRevision，GET 恢复权威结果。重复/低版本事件与迟到 Session snapshot 不能回退已见修订号；通知不是第二真源。
- **回退/交付**：不做旧格式自动迁移、双写或兼容壳；不自动清库、删除用户文件或执行 DDL down。B4 可交付可审查 API 切片，不等于 S07 UI/E4、全模式运行时或远端发布获批。

## 8. 2026-10-08 S07 UI 与 JSON 合同续作

本节更新实施事实，不回写 §1–6 的历史审批记录，也不自动勾选尚未批准的 MVP scope-cut。当前本地验证与未交付范围以 `docs/technical-debt.md` §15.10 为准。

- `WorkArtifactContent` 使用已有侧栏与生成 SDK 展示唯一 Review；`WorkReviewPanel` 是受控展示，不持有第二套审批状态机。打开、刷新、六种显式动作均由服务端读回/返回值决定结果。
- 读取、写入和 Session 生命周期各自有请求版本标识；关闭/重开或换 Session 后的迟到响应不能覆盖当前视图。读取失败会清除旧的可操作状态，冲突不会自动重发写命令。Review 操作不代替 Question/Permission，也不调用 provider 或修改 Mode/Agent。
- 未提交 Review 时的 `None.artifact` 只提供 `WorkArtifact` owner 核验过的当前绑定；它不是批准。`Session.Info.workReview` 摘要缺失也不替代详情的 none/ready/unavailable 判断。
- `optionalOmitUndefined`（`packages/schema/src/schema.ts`）统一决定上述可选 JSON 字段的省略行为。V1 Session schema 和 WorkReview 读结果/公开错误不再把显式 undefined 编成合同外的 null；E4 不再通过 null 归一化掩盖违约。
- 真实 WorkReview 生命线仍复用隔离 E4 orchestrator：provider 产物经 UI apply 后执行六动作，另验证 reload 与 harness-owned backend restart。追踪、GET、SQLite backup、manifest/version 与 teardown 必须属于同一次 run；不重启用户服务。
- 单机 WorkReview、双后端 Question/Permission 和服务入口播种的 Assistant 提醒是不同证据。后者不证明自然语言/provider 创建提醒；以上均不能代替 Custom/V2 正向执行、所有跨平台矩阵或远端发布批准。
