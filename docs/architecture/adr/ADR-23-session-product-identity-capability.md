# ADR-23: Session Product Identity 与 Capability 只读投影

> 状态：**Accepted**（2026-09-14 Owner 放行 S6 并批准文本；S1 起草于 2026-09-13）
> 接受依据（逐条可核）：**① 状态词汇表**（datum 级 `ready|missing|unsupported` / capability 级 `ready|degraded|blocked`，reason code 为稳定协议）；**② 聚合规则可执行化**（决策 1 的 Schema filter：贡献 floor + reasons 折叠 + `Identity` 上的强制，含**贡献映射**与「**身份事实不贡献**」——coding 的 vcs、work 的 artifact、chat 的 assetCounts 缺失是正常态而非降级）；**③ Work contract 三元联合**（workflow 今日即 ready、preset 留槽待 S9A、ad-hoc 显式）。**实现与文本零漂移**：`packages/schema/src/session-identity.ts` 落地，schema 全量 240 例测试通过（含 7 例聚合规则负向与 3 例 i18n 键覆盖门禁）。
> S6 起本 ADR 不再受「文本获批前不创建 endpoint」的限制：按计划 §4.3 逐项落地组合服务、instance HttpApi endpoint 与 SDK 生成，硬门见计划 §9 与 S6 九条边界。
> Date: 2026-09-13
> Amends: [ADR-13](ADR-13-chat-work-mode-boundary.md)、[ADR-14](ADR-14-persistence-and-scope-strategy.md)、[ADR-15](ADR-15-mode-workspace-main-area-slot.md)、[ADR-17](ADR-17-custom-mode-composition-platform.md)
> 关联：[全局壳产品闭环计划](../../plan/global-shell-product-closure-2026-09-13.md) §4、D2/D3/D4/D5 裁决、[ADR-11](ADR-11-product-mode-session-classification.md)、[ADR-17](ADR-17-custom-mode-composition-platform.md)、[ADR-20](ADR-20-scoped-grant-model.md)
> 实现 owner：Schema `packages/schema/src/session-identity.ts`（S1 已落地，17 例 RED→GREEN）；组合服务 `packages/core`（S6）；传输复用 `packages/aigcfroge` 现有 instance HttpApi group（S6）；App 只消费 SDK projection（S6/S7）

## 背景

S0 基线（2026-09-13，185/13/198 fixme 后回绿）确认：产品身份与能力状态目前由 UI 各自推断——底栏无任何权限状态可读（`StatusBarSource` 无 session-info 访问器）、Composer Agent picker 可见性被设置项整体关闭、Custom 诊断与门禁按钮各自计算 health、Work 会话空态假定"基于预设"。计划 D2 裁决建立单一只读投影 SessionProductIdentity；本 ADR 把 D2/D3/D4 折进可实施的契约。

投影是**只读组合**，不是第二 Session 表：领域表与既有 owner（SessionV2、PermissionEffective、session-override、composition snapshot store、WorkPreset/WorkflowAsset、schedule）仍是唯一真源。

## 决策 1：状态词汇表（两级 + 一条聚合规则）

三套历史词汇（capability `ready|blocked|degraded`、缺失数据 `missing|degraded`、D4 的 `unsupported/degraded` 并列）统一为两级：

| 层            | 词汇                              | 语义                                                                                                                                                                                                         |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| datum 级      | `ready \| missing \| unsupported` | `ready` 携带 `value`；`missing` = owner 对该 Session 无数据（历史 Session 早于 detail owner）；`unsupported` = 设计上延后（WorkPreset revision 未落地、Assistant Memory/KB 属 M2），必须携带稳定 reason code |
| capability 级 | `ready \| degraded \| blocked`    | `blocked` = 策略性 fail-closed（Custom kill switch、capability header 不匹配）；`degraded` 必须携带 typed reasons                                                                                            |

**聚合规则（全仓唯一，`Identity` 的 Schema filter 可执行强制）**：任一**贡献 datum/capability** 非 `ready` ⇒ 顶层 capability 不得为 `ready`，health 不得低于贡献者 floor（任一贡献者 `blocked` ⇒ 顶层必须 `blocked`，否则 `degraded`），且其 reasons 必须折叠贡献者的全部 code。**贡献映射**：`detail.missing`、work 契约 preset revision `unsupported`、assistant 的 reminders/memory/knowledge 三个 Capability、custom 的 policy Capability **贡献**；coding 的 vcs datum、work 的 artifact datum、chat 的 assetCounts 是**身份事实，不贡献**——无 VCS、尚未产出 artifact 是正常态而非降级。反向不约束：无贡献者时 `blocked` 仍可由策略门独立成立（如 custom kill switch）。`health: "ready"` 配任何非 ready 贡献者的组合在解码期直接失败。Header、列表、StatusBar、disabled 按钮、Custom diagnostics 只消费这条规则，不得各自计算 health（计划 §9.2）。

**Reason code 是协议不是文案**：`^[a-z][a-z0-9]*(-[a-z0-9]+)*$` kebab-case brand，不随 locale 翻译；展示文案由消费端 i18n 解析。恢复动作同理（`ActionCode`）。当前注册表：`mode-detail-not-projected`、`work-preset-revision-pending`、`assistant-reminders-unavailable`、`assistant-memory-m2-pending`、`assistant-kb-m2-pending`、`custom-mode-disabled`。扩展是加法；改名是协议破坏。`assistant-reminders-unavailable` 的触发条件由 S9B owner 定义，在此之前任何代码不得发射该 code（占位保护，防止语义被既成事实定义）。

`mode-detail-not-projected` 的语义（S6 修订）：**该模式的 detail 尚未投影**，覆盖两种情况——①历史 Session 早于 detail owner；②S6 期该模式尚无 owner（`chat` 的资产计数待 S3 的单一资源 owner、`work` 的 contract 属 S9A、`assistant` 的 scope/reminders 属 S9B）。组合服务用同一 code 表达二者，消费端据此显示 degraded；S9A/S9B 落地后仅剩情况 ①。此修订是把已在实现的用法写进文本，避免 §7.2 式的隐性拉伸。

## S6 的显式边界（记录在案，非惊喜）

S6 交付的组合服务只声称有 owner 的 detail：`common`/`permission`（session 行 + `PermissionV2.effectiveRules`，后者是工具门禁同一 owner）、`custom`（snapshot digest + kill switch policy）、`coding`（`Git.find` 的 worktree 根 + `Git.branch`，非 Git Location 两者皆 `missing`）。**显式不在 S6**：`chat` 的 assetCounts（待 S3 把三路读取归并为单一资源 owner 后接线）、`work` 的 contract/artifact（S9A，artifact 目前为非持久内存态）、`assistant` 的 scope/reminders（S9B）。三者一律返回 `mode-detail-not-projected` + capability degraded，**不伪造零计数、空列表或 ready**。S12 审计据此判读，不视为遗漏。

## 决策 2：Owner 拓扑

| 层                | Owner                                                                   | 本 ADR 约束                                                                                     |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Schema            | `packages/schema/src/session-identity.ts`（`SessionIdentity` 命名空间） | 全部类型 `annotate({ identifier })`；OpenAPI snapshot 稳定                                      |
| 组合服务          | `packages/core`（S6）                                                   | 只读组合既有 owner；不复制授权算法；不新建领域表                                                |
| 传输              | `packages/aigcfroge` 现有 instance HttpApi group/handler（S6）          | endpoint 必须带 `OpenApi.annotations({ identifier })`；生成走 `packages/sdk/js/script/build.ts` |
| App               | SDK projection 消费（S6 Header/StatusBar/S7/S9）                        | 只投影，不持久化 projection；不并行请求第二真源                                                 |
| `packages/server` | 不因本计划新增业务 projection                                           | —                                                                                               |

**S6 硬约束**（Schema RED 无法覆盖的生成物风险）：projection endpoint 落地时必须有一条断言证明生成后的 SDK 方法存在且可调用——缺 identifier 时 hey-api 把方法平铺到父类、`client.<group>.<sub>.<method>` 变 `undefined` 且无门禁报错（S1 不生成 SDK，此断言随 S6 交付）。

## 决策 3：投影形状

**Common**（全部 Session）：`sessionID`、`mode`（ProductMode 五值）、`location`（Location.Ref）、`projectID`、`agent`、`model{providerID,modelID}`、`permission{declaredTier, effect}`、`capability`、`detail`。

**Detail availability**：`{ status: "ready", detail } | { status: "missing", reason }`——历史 Session 缺 detail 时返回 typed missing 并把 capability 降级，不伪造 ready（计划 §4.2）。

**五模式 detail（判别字段 `source`，必须等于 `mode`——Schema filter 强制）**：

| mode        | detail 字段                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coding`    | `vcs{branch, worktree}`：datum(string)。非 Git Location 返回 `missing`，不返回空串（S8 语义的 schema 面）                                                                                                                                                                                                     |
| `chat`      | `assetCounts[{kind,count}]`：七类资产计数（prompt/skill/mcp/command/agent/workflow/plugin），不含资产正文                                                                                                                                                                                                     |
| `work`      | `contract`（见下）+ `artifact`：datum(Revision)，Applied artifact 的内容 revision                                                                                                                                                                                                                             |
| `assistant` | `scope{personal} \| {project, projectID}` + `reminders/memory/knowledge` 三个 Capability（D4；Memory/KB 在 M2 前为 `degraded` + `assistant-*-m2-pending`，不改 `personal_memory`/`kb_note` 表——"Cross-project by design" 注释所代表的决策不动）。三者非 ready 时必须折叠进顶层 capability（§决策 1 贡献映射） |
| `custom`    | `snapshot{digest}`（引用 `Composition.Digest`，指向 snapshot store）+ `policy` Capability；**类型上不存在** instruction/credential 字段，round-trip 丢弃未知字段（RED 已证）                                                                                                                                  |

**Work contract（D3 终版：判别式跟来源走，不跟实现走）**：

```text
contract =
  | { source: "workflow", revision }            // WorkflowAsset.Revision，今天就是 ready
  | { source: "preset",
      revision: { status: "ready", revision }   // S9A 落地 WorkPreset revision 字段后填充
               | { status: "unsupported", reason: "work-preset-revision-pending" } }
  | { source: "ad-hoc" }                        // 计划 §12.2：无预设的 Work Session 显式标记
```

workflow 来源**现在**就有真 revision（`workflow-asset.ts:30-36`，YAML 字节 SHA-256），不得因 preset 实现缺口而谎报 unsupported；preset 槽位填充时 `work-preset.ts` 的改动属 S9A，本投影契约不变。`session.metadata` 的 `presetCategoryId` 降级为兼容字段（读取走显式 compat decoder，S6）。

## 决策 4：权限语义

`permission.declaredTier` 是声明档位（`PermissionTier`：propose/full），`permission.effect` 是既有 `PermissionEffective` owner 计算的有效决策（`Permission.Effect`：allow/ask/deny）的**脱敏摘要**。投影不复制授权算法、不把 break-glass lease 变成第二真源（服务端 60s lease 与客户端 30s renew 仍归 `core/src/permission/session-override.ts` 与 App override dialog）；override 可见性作为 capability reason 呈现，lease 生命周期不进投影。

## 决策 5：缓存与安全

投影缓存不得跨 server / location / authorization 边界复用；权限过滤发生在返回前，同一请求内保持一致快照。日志与投影载荷不得出现：composition snapshot 的 instruction 正文、credential（只有 `credentialRef` 在 snapshot store 内）、memory/KB 正文。`SnapshotRef` 类型上不存在可携带这些内容的字段。

## 决策 6：对既有 ADR 的修正

- **ADR-13**（Work 边界）：Work contract 身份源三元化（workflow/preset/ad-hoc）由本 ADR §4 定型；`presetCategoryId` 降为兼容读取。预设/工作流归属裁决不变。
- **ADR-14**（持久化边界）：投影**零新增表、零新增列、零 migration**——只组合既有 owner；WorkArtifact 仍是非持久事件，artifact summary 投影的是当前内存态。
- **ADR-15**（ModeWorkspace）：Session Header/StatusBar 成为投影消费端（S6/S7），slot 语义不变；权限状态归位（默认 propose 不常驻底栏）是 App 消费策略，不是本 ADR 的 schema 问题。
- **ADR-17**（Custom 平台）：snapshot store 仍是唯一 owner；投影只暴露 digest 引用 + runtime policy health；kill switch（`AIGCFROGE_CUSTOM_MODE`，fail-closed）经 `custom-mode-disabled` reason 表达为 `blocked`。

## Slice 边界与 RED 对账

S1 交付（本 ADR + schema + 17 例测试）：common 字段完整、五判别式 source 配对强制（Schema filter）、capability 聚合规则可执行（贡献 floor + reasons 折叠，Schema filter + 贡献映射）、历史 Session typed missing、Custom 快照 ref-only round-trip 丢密、reason code 稳定（拒中文/拒空格）、Work contract 三分支 + 64-hex revision 校验、未知字段容忍（旧 SDK 兼容面）。显式不在 S1：OpenAPI snapshot 与 SDK 生成断言（S6）、endpoint 与组合服务（S6）、App 消费（S6/S7）、preset revision 字段实现（S9A）、Memory/KB scope（M2 独立 gate）。
