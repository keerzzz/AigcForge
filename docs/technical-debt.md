# AigcForge 技术债与后期任务清单

> 统一入口文档：所有已声明但未闭环的技术债、延后任务与待启动规划的归档地。
> CLAUDE.md「已知技术负债」为本文的精简引用；`docs/review/` / `docs/audit/` 为缺陷证据源。
> 更新规则：每闭环一项移入「已闭环」表并记录日期与提交；新增债必须写来源（PR/审计/计划）与触发条件。

---

## 0. 快速索引

| 分类 | 内容 | 状态 |
|---|---|---|
| §1 权限档位遗留（PR #32） | M1/M2/M3/M5/D5 五项 | 待专项处理 |
| §2 页面归一化延后（PR #34） | 960px 主列、Assistant scope、Chat Location 抽取、全仓 import 债 | 计划外延后 |
| §3 Custom Mode 平台（PR #33） | ADR-17 评审 + Roadmap M0-M5；§3.1 Custom M2 遗留 10 项；§3.2 Custom M3 Phase B/D 遗留、F0 剩余裁定项与 ADR-21 排除项 | M0/M1/M2 已完成并合入（M2 = PR #46 / `a11b50020`）；M3 Phase A/B/D 已交付，F0 preflight 待最终复审闭环，Phase C 待 ADR-21 裁定；M4-M5 远期 |
| §4 全局存量债（CLAUDE.md 迁移） | dompurify、doom_loop 统计、资产路由等 | 按到期日跟进 |

---

## 1. 权限档位遗留债（来源：PR #32 `session-permission-tier`）

> 计划：`docs/plan/mode-scoped-permission-overlay.md`（已实施）；验收 §11 全绿，以下为 PR 描述声明的非阻塞遗留。

| 编号 | 负债 | 包 | 风险 | 触发/到期条件 |
|---|---|---|---|---|
| M1 | V2 Runner 系统提示硬编码 override 未激活：Permission Context 不反映当前 break-glass 激活态，模型看不到临时全开 | core | 模型可能误解自身权限边界，误以为仍受限于档位 | 系统提示重构时 |
| M2 | V1 每 turn 权限快照 vs 60s 租约收权粒度：V1 快照化裁决，收权粒度粗于 V2 | aigcfroge | V1 路径下用户刚收窄权限可能到下一 turn 才生效 | V1 路径再调整时 |
| M3 | break-glass 无持久审计日志：临时全开动作不留审计记录 | core / app | 越权取证困难 | 审计基础设施建设时 |
| M5 | 基线 wildcard deny 在提升路径被丢弃：代码有注释钉死，语义未完整收敛 | core | 未来新增工具可能漏过 deny 语义 | PermissionEffective 演进时 |
| D5 | effect skill 吞错反模式条目拆出：`Effect.catch(() => Effect.void)` / `orDie` / `ignore` 覆盖缺口 | docs（skill） | 分支审查无法引用统一反模式规范 | 下次 skill 更新时 |

---

## 2. 4 模式页面归一化延后项（来源：PR #34 `mode-page-unification-v2.md`）

> 计划：`docs/plan/mode-page-unification-v2.md`（Phase 1-7 待执行，执行提示词 `docs/plan/prompt-mode-page-unification-v3.md`）。
> 以下均为该计划明确排除、需另立专项的项。

| 负债 | 说明 | 触发/到期条件 |
|---|---|---|
| 实际 `960px` 主列 | 计划 G2：宽度清理只做"等价才删分支"，不实现 960px；产品要求则另开 PRD/视觉变更，重评窄屏、Assistant 密度、滚动与容器宽度 | 产品提出需求时 |
| Assistant `global\|project` 知识库 scope 选择器 | 由 Assistant 独立计划负责，不在归一化计划实现 | Assistant 专项启动时 |
| Chat Location 底层 primitive 抽取 | Chat 仍由 `ChatFeatureSidebar` 内联持有 Location + feature tree/counts；是否抽取更低层 primitive 计划明确不强制决定 | 行为等价测试证明后 |
| 全仓 legacy import 债 | ~249 个 star imports + ~123 个 alias imports（AGENTS.md 已禁止新增，存量不迁移） | 全仓清理专项时 |

---

## 3. Custom Mode 平台任务（来源：PR #33 `custom-mode-docs`）

> 文档：ADR-17 `docs/architecture/adr/ADR-17-custom-mode-composition-platform.md`（Accepted for M0/M1 implementation v1.2，由用户授权 AI 代理代签）、
> PRD `docs/prd/custom-mode-composition-platform.md`（Approved for M0/M1 implementation v1.2）、路线图 `docs/roadmap/custom-mode-roadmap.md`（Approved for M0/M1 implementation v1.2）。

| 阶段 | 名称 | 核心范围 | 关键依赖 | 状态 |
|---|---|---|---|---|
| —    | **ADR-17 正式评审**       | Product/Core/App/Security/Schema+SDK 五方评审与签字                                   | —                        | 已完成（用户授权 AI 代理代签，2026-08-18） |
| M0   | 治理与组合底座            | 第五 Mode、Profile/Plan/Snapshot、AssetRef、Resolver                                  | ADR-17 批准              | 已完成（Phase A-F） |
| M1 | 单 Agent 可恢复闭环 | `meta` + 一个用户 Agent + Prompt/Skill + native + Upgrade + UI Phase E + 50 轮稳定性矩阵 | M0 | 已完成（Waves W1-W4，2026-08-19） |
| M2 | 多 Agent 与编排 | Agent 池、Command、Workflow、进度、取消、部分成功 | M1 | 已完成并合入 `main`（PR #46，合并提交 `a11b50020`，2026-08-22；R5 独立专项复审已取得并整改，复审 APPROVED，见 [Custom M2 复审报告](review/AigcForge_CUSTOM_M2_REVIEW.md)，遗留项见 §3.1） |
| M3 | MCP 与审批 | scoped registration、凭证、健康、统一审批入口（含 once/Session/Location grant model） | M2 + Tool Registry 扩展 | 进行中：G3-1（[ADR-19](architecture/adr/ADR-19-mcp-scoped-registration.md) Accepted v1.0）与 G3-2（[ADR-20](architecture/adr/ADR-20-scoped-grant-model.md) Accepted v1.2）已批准，Phase A 已合入 `main`（`7a2804624`）；Phase B（placement + MCP 命名/冲突 owner）与 Phase D（ScopedGrant + attended ask 天花板）均已交付并经独立复审整改。**G3-3 已通过**（[ADR-21](architecture/adr/ADR-21-mcp-credential-custody.md) Accepted v1.0，2026-08-24 人类裁定 §2.5 加密排除；因由复审方起草，Phase C **必须以 Slice 0 独立事实复核为前置**，这是起草/批准分离的补偿控制）；F0 preflight 已交付待合入，Phase B/D 遗留与 Phase C/F 输入见 §3.2。计划 [custom-mode-m3-mcp-approval.md](plan/custom-mode-m3-mcp-approval.md)，执行提示词 [prompt-custom-mode-m3-mcp-approval.md](plan/prompt-custom-mode-m3-mcp-approval.md) |
| M4 | Trusted Runtime Extension | Host/Agent/Client 分面、信任、停止、隔离、回滚 | M3 + Plugin 生命周期 ADR | 远期 |
| M5 | Code Presentation | `run_code` + 受限 SDK，共用 Effective Tool Set | M3/M4 稳定 | 远期 |

> 与权限档位的接口约定：Custom M0/M1 必须定义 mode ceiling 与 Snapshot allowlist；应用级审批入口与 grant model 属 Custom M3（权限档位计划明确"不自动批准"）。

### 3.1 Custom M2 遗留项（来源：[Custom M2 复审报告](review/AigcForge_CUSTOM_M2_REVIEW.md) R4 + R5，2026-08-22）

M2 已合入 `main`（PR #46 / `a11b50020`）。以下为判定为「部分闭环」或「已知残留」的项；全部 P0/P1 阻断项的闭环证据见复审报告 §2（R5 的 3 项 P0 与 8 项 P1 见 §2.5）。标注「M3 范围」的两项是 M3 开工 Gate 的输入，见 [M3 计划](plan/custom-mode-m3-mcp-approval.md) §1。

| 负债 | 包 | 说明与根治方向 | Owner | 触发条件 |
|---|---|---|---|---|
| Custom kill switch 无「关闭即中断在飞 child」的进程内通知 | core / aigcfroge | 已实现：`assertRuntimeSupported()` 对 custom 关时 fail-closed（`product-mode-policy.ts:77`，覆盖 `session.ts` 6 处入口 + `handlers/session.ts:146`）；`WorkflowRunner` 每轮调度前与每个 step dispatch 前各查一次，落 `custom_mode_disabled`（R5-3 已修正该检查用过期 revision 做 CAS 的缺陷）。仍缺：`isCustomModeEnabled()` 只读环境值，无「开关变化」通知入口，关闭开关无法中断已在 Provider 请求中途的 child，最坏多跑到当前 step 结束。根治：加显式进程内 disable 通知，调用 `WorkflowExecution.interrupt` 与 `SessionExecution` 中断并等 finalizer settle 后返回 | TBD | 运营级 kill switch 实装时 |
| durable handoff 状态未持久化，「已投递 / 已丢失」不可区分 | core | R5-18 已删除 `WorkflowRunInfo` 上恒缺的 `handoffDigest` / `handoffStatus` / `handoffErrorCategory` 与 `WorkflowHandoffStatus`（契约谎报），但根因未解：`injectSynthetic` 失败只落一条带 `defectTag` 的 `Effect.logError`，run 仍报 `completed`，无持久状态、无重试。根治需要为终态 run 的 handoff 记账在 ADR-18 §2.2「终态不可变」上开一个显式例外，并新增列 + 迁移 | TBD | 需要 handoff 可观测性时 |
| `MAX_STEPS` 等图不变量不在解码期与资产写入期强制 | core / schema | `validateGraph` 唯一非测试调用方是 `composition-resolver.ts:257`，因此 YAML 加载（`workflow-asset.ts loadDir`）与 `workflow-asset/apply`（`propose-workflow-asset.ts validateContent`）会接受超大 step 数组、环、重复 id、悬空 `next`、`branches`+`continue`，资产还会被报成 valid；只有 `freeze` 才拒绝。ADR-18 §2.5.3 写的是「解析期拒绝」，需对齐实现（改代码，不是改 ADR）。另 `Schema.Array(StepDef)` 在三处解码点均无长度上界 | TBD | 资产写入面加固时 |
| `timeoutSeconds` 省略即无超时 | schema / core | `StepDef.timeoutSeconds` 没有 `withDecodingDefaultKey`（相邻 `maxAttempts` / `failurePolicy` 都有），`workflow-runner.ts` 字段缺失时直接 `return yield* delegated`，于是 `failurePolicy: retry` + `maxAttempts: 8` 每次 attempt 都无墙钟上限——比 ADR 宣传的 86400 上限严格更差。加默认值会静默截断合法长任务，属产品决策 | TBD | 需要资源上限硬保证时 |
| `packages/app/e2e` 不在 typecheck 项目内，且带 29 个存量类型错误 | app | `app/tsconfig.json` 的 `include` 只有 `["src"]`，`e2e/tsconfig.json` 从不被 `tsgo -b` 或 CI 执行。实测 `tsgo --noEmit -p e2e/tsconfig.json` 报 29 个错误，全为存量。这直接放大了 R4 P0-B 的潜伏期——e2e 是当时唯一能发现浏览器白屏的手段，却因门禁缺位而长期不跑。根治：修完 29 个错误后把 e2e 纳入 `tsgo -b` 与 CI | TBD | e2e 门禁强化时 |
| Storybook 构建 OOM | storybook | `bun run build` 在 Vite transform 阶段 OOM，`--max-old-space-size` 4096 与 6144 均崩。移除新增 story 后照样 OOM，属分支既有。后果：Custom M2 的视觉截图门禁无法取得。根治：拆分 stories 入口或降低 preview 构建期内存占用（参考 `manualChunks` 边界既有约束） | TBD | 需要视觉回归证据时 |
| `packages/sdk/openapi.json` 长期未随路由再生成 | sdk | 该文件由 `script/generate.ts` 第 2 步写出，最后一次更新在品牌迁移期；2026-08-22 实测与实际 spec 差 **72 个 path / 172 个 schema**，绝大多数来自 M2 之前已合并的里程碑。无代码消费方（`packages/sdk/js/script/build.ts` 自己写临时 `openapi.json` 并在结束时删除），故只是发布/参考产物过期，不造成运行时或类型漂移。故意不在 `workflow-surface` 上再生成：会把约 470KB 与 M2 无关的产物混进 M2 diff。注意 `script/generate.ts` 末步会 prettier 格式化全仓，不能整体跑。根治：单独一次提交刷新，并给 CI 加 spec drift 门禁 | TBD | 独立产物刷新提交时 |
| spawn 子进程 / 实例引导测试对机器负载敏感 | aigcfroge | `test/project/instance-bootstrap.test.ts`、`test/cli/acp/initialize-auth.test.ts`、`test/cli/acp/skills.test.ts`、`test/cli/run/run-process.test.ts` 在并行跑 lint / typecheck / 子代理时集体 `TimeoutError`（单例 15–59s），空载单独重跑全绿。同类现象还见于 Playwright `session-timeline.spec.ts:33`（全量 59 例失败 1 例，单跑 5 passed）与 exerciser auth（重负载 282/2，空载 284/0）。CI 上表现为间歇失败，容易被误判为回归。根治：为这些文件设更宽的独立超时，或在 CI 中与重负载步骤串行化 | TBD | CI 稳定性专项时 |
| exerciser 对 3 个 workflow mutation 端点只覆盖 404 路径 | aigcfroge | `cancelRun` / `cancelStep` / `retryStep` 在 exerciser 里只注册了「run 不存在 -> 404」场景，没有 200/202 成功路径与 409 stale revision。覆盖门禁按 `METHOD path` 计数，故 `.missing` 场景名同样满足门禁——「已覆盖」不等于「行为已测」。成功路径当前由 core 单测与 Playwright（mock server）覆盖。根治：补三条成功路径与一条 409 场景 | TBD | exerciser 场景扩充时 |
| Custom Builder 资产列表把失败渲染成空态 | app | `custom-sidebar.tsx:32-50` 对 5 个资产 list 同时用 per-call `.catch(() => ({data:{assets:[]}}))` 与外层 `catch {}`，任何失败都渲染成与「0 个资产」无法区分的空态，无错误提示也无重试，违反「禁止静默失败」。该模式在 `main` 上对 agents/prompts/skills 已存在，`workflow-surface` 只是扩展到 workflows/commands，按「不顺手修无关代码」未在 M2 范围内修。根治：区分 loading / empty / error 三态并提供重试 | TBD | Custom Builder 下次改动时 |
| Custom 快照面板与 Builder 的 token / i18n 残留 | app | `custom-snapshot-panel.tsx` 新增的 Workflow / Agent Pool 卡片硬编码 Tailwind 调色板（`bg-amber-500/10`、`text-blue-300` 等）并直出英文字面量（`Workflow (...)`、`{n} steps`、`Agent Pool (...)`），违反「颜色走 `--v2-*` token、文案走 i18n」；`workflowStatusKey()` 用服务端状态拼动态 i18n key 且无兜底，超出契约的状态会渲染空 badge 文案。`custom-draft` 的 store 按目录 memo 但 persist 用单一 global key，跨项目会互相覆盖，且 SDK 未就绪时全部落在 `""` key 上 | TBD | Custom Builder 下次改动时 |
| `createChild` defect 收敛为 `executor_unavailable`，丢失原因分类 | core | allowlist 拒绝已修为 `agent_not_allowed`（dispatch 前 + 创建后 parent 不匹配），但 `TaskDriver.createChild` 的 defect 仍无差别归 `executor_unavailable`，与「driver 真的缺失」不可区分。当前靠 `defectTag` 日志保留可诊断性；`TaskDriver` 改 root-scoped 后「走错 root」这一主要成因已消除，故降级为诊断质量问题。根治：为 createChild 定义 typed failure 而非 defect | TBD | TaskDriver seam 再次改动时 |

### 3.2 Custom M3 Phase B / Phase D 遗留（来源：Phase B 与 Phase D 独立复审，2026-08-23，分支 `mcp-registration` / `scoped-grants`）

Phase B 的 placement 维度与 MCP 命名/冲突 owner 已交付，两项 P1（占用检查 placement-盲、settle 与 definitions 的 placement 未绑定）已在复审中整改并红先行验证。Phase D 的 ScopedGrant owner、grant 咨询、ask TTL、无应答方即时拒绝与 attended 天花板改判已交付，两项 P0（presence 未接线导致全模式 ask 硬拒、grant store 用 `provideMerge` 导出出第二个 Database 实例）已在复审中整改（`6be7d4b7c`）。Phase F0 retention/import preflight 已实现，仍在最终复审。以下为 Phase C/F 输入或刻意不在本轮拍定的债。

| 负债 | 包 | 说明与根治方向 | Owner | 触发条件 |
|---|---|---|---|---|
| HttpApi exerciser 的 auth 硬门禁无有效信号 | aigcfroge | **来源：Custom M3 Phase F2 审批复核，2026-08-26。** `--mode auth --fail-on-missing --fail-on-skip` 当时为 **0 pass / 285 fail**；连公开的 `/global/health` 也统一报 `TaskDriver runtime state is not provided`。因此共同根因在 auth probe 的 runtime 装配而非 permission 路由，不能归为 F2 回归。**因果：** `workflow-surface` 已正确将 `TaskDriver.active()` 从进程级「最后写入者胜」注册栈改为 `Context.Reference` runtime（§5 已闭环项，2026-08-22）；`runAuth` / `callAuthProbe` 没有提供该 runtime state，旧的全局兜底消失后才确定地暴露为 fail-closed，不是「auth 一直坏着」。`docs/testing.md` §3 仍把 auth 列为硬门禁，当前全红既不能验证认证边界，也不能可靠阻断回归。根治：为 `runAuth`/`callAuthProbe` 复用或补齐与正常 exerciser 相同的 TaskDriver runtime 生命周期，并恢复 public/protected 探针的有效断言。 | TBD | 修 HttpApi exerciser auth runtime 装配时；在把 auth 结果作为 merge blocker 前 |
| Credential 静态加密（明文存储）—— ADR-21 明确排除在 M3 之外 | core | `credential.value` 是 `text({mode:"json"})` 明文（`credential/sql.ts:9`），`auth.json` / `mcp-auth.json` 同为明文 JSON（但均 `0o600` 落盘）。[ADR-21](architecture/adr/ADR-21-mcp-credential-custody.md) §2.5 裁定：真正的静态加密需先定密钥来源（用户口令 / OS keychain / KMS）、跨平台差异（macOS Keychain / Windows DPAPI / Linux Secret Service）与「忘记口令即丢全部凭据」的产品语义，是独立专项，**不在 G3-3 内假装解决**。M3 只做两项止血：① DB 文件 chmod `0o600` 与既有文件存储对齐（**反直觉现状：秘密最集中的 SQLite 库无任何 chmod，`global.ts:36-42` 只 mkdir**）② `McpServerBinding` 解码期拒绝秘密字面量。根治：加密专项立项 | TBD | 企业级/合规要求提出时 |
| 三个 secret 存储并存，「唯一 secret owner」不成立 | core / aigcfroge | DB `credential` 表、`auth.json`（provider API keys）、`mcp-auth.json`（MCP OAuth token/clientInfo/codeVerifier/oauthState）各有在役消费方。ADR-19 §2.1 已裁定 V1 MCP 与 canonical 并存不合并、迁移归 M4；[ADR-21](architecture/adr/ADR-21-mcp-credential-custody.md) §2.6 令凭据收敛服从同一裁定——否则 M3 会被拖进 V1 全量消费方迁移。**Phase C 不得为了「统一」去改 `mcp/v2-auth.ts` 或 `auth/index.ts` 的在役语义** | TBD | M4 Gate 输入（与 V1→canonical 迁移评估同批） |
| `credential.active` 列在 V2 服务零引用 | core | 该列与 `credential_connector_active_idx` 唯一索引（`migration/20260611035744_credential.ts:21`）来自 V1 连接器时代；`credential.ts` 内 `active` 0 命中。它是一个**撤销形状的列而没有消费方**——ADR-21 §2.6 刻意不动它，避免在决定「采纳还是删除」之前先发明第三套撤销机制（极致减法：复用 → 删除 → 归并 → 重构 → 新增）。根治：确认 V1 面无消费方后删列 + 迁移，或在绑定层撤销之外正式采纳它 | TBD | 下次 credential 层清理时 |
| once grant 无签发 Session 归属 | core / app | F0 已闭环保留策略：签发不再触发清扫；默认 30 天窗口由 Location owner Scope 立即+每小时调用 `prune`，失败分类记录并继续调度；`findValid` 不可见、once 二次消费失败。仍开放：once grant 当前不保存签发 Session，因此 `list({sessionID})` 明确排除 once；Phase F 若需会话级 once 历史，需在人类裁定后选择新增独立归属列+迁移，或保持“未归属”展示。 | TBD | **Custom M3 Phase F 开工时（与审批中心历史视图同一 slice）** |
| Agent 资产通配 allow 警示已接入但需持续验证消费链 | core / app / schema / sdk | 已部分闭环：复用 `PermissionEffective` 真源；propose metadata 与独立 apply `{asset,warnings}` 均由 App 消费；警示不阻断且不改内容。仍需产品/复审确认最终展示位置与真实浏览器矩阵，当前有 Core/schema/metadata 单测、HTTP apply 响应测试与 ChatRightPanel 消费实现；真实浏览器对 apply 成功警示、empty/loading/error、desktop/narrow、light/dark、三语矩阵仍未形成完整行为证据，不能将实现入口记作覆盖。 | TBD | **Custom M3 Phase F0 复审完成时** |
| MCP 冲突域不是 Location-scoped（`ApplicationTools` 进程全局） | core | `registry` 的 `local` 闭包按 Location 隔离（`location-layer.ts:267` 以 `Layer.fresh` 收尾，绕过 MemoMap 按 Layer 对象引用的记忆化，已复核），但 `ApplicationTools.layer` 位于 LayerMap `dependencies`（`location-layer.ts:289`）→ 进程全局单实例，而它并入 ADR-19 §2.4 的占用域。后果：Location A 注册的应用工具会占掉 Location B 的同名 MCP 工具名，报 collision。方向是 fail-closed（不会遮蔽、不会跨 Location 泄漏工具），且应用工具本就是 app 级全局概念，故非安全缺陷；但它让 §2.7「跨 Location 隔离」对冲突域不成立，多 Location 并用同一 MCP server 时可能出现无法解释的伪冲突。根治：占用检查区分「Location-scoped 域」与「全局应用工具域」，或把 ApplicationTools 收敛为 per-Location | TBD | 多 Location 并发绑定同一 MCP server 出现伪冲突时 |

---

## 4. 全局存量债（迁移自 CLAUDE.md 债表）

| 负债 | 包 | 风险 | Owner | 到期日 |
|---|---|---|---|---|
| @ai-sdk/google patch 未上游化 | root patches/ | 功能补丁可能滞后 | TBD | 上游监控 |
| dompurify 锁定 3.4.6 | session-ui | 残留 moderate advisory（IN_PLACE/setConfig/hook 污染类，本仓静态配置+单 hook 用法不可达）；≥3.4.7 与 happy-dom 探针环境不兼容（p/a/svg 被误剥、foreignObject 误放），升级前须先迁移探针到真实浏览器环境 | TBD | 2026-08-27 |
| 工具活动 doom_loop 拦截统计依赖 runner 错误文案匹配（"blocked by doom_loop approval"） | app | `session/runner/llm.ts` 文案变更会静默漏计；且只覆盖 denied/rejected，CorrectedError 反馈不计入。根治：事件层为 tool error 加结构化标记（如 `cause: "doom-loop"`），UI 按字段判断 | TBD | 事件层加标记时 |
| 工具活动统计随会话压缩缩水 | app | 统计基于消息 parts，compaction 重写历史后旧 part 被丢弃，计数仅反映当前上下文窗口。根治：event/DB 层聚合持久统计，UI 只读 | TBD | 需要持久指标时 |
| 多文件不符合 Prettier 格式规范 | 全仓 | 仓库无 pre-commit format hook，部分文件（如 `verifier.ts`、`reference-checker.ts`）在 main 就不符合 prettier 格式；分支审查时难以区分新旧格式问题。根治：统一跑 `prettier --write` 全仓格式化一次，配合 CI 加 format check 门禁 | TBD | 下次全仓 lint 清理时 |
| workflow/plugin 未建 typed service 而是 handler 内联写事务 | aigcfroge | 虽已复用 FileMutation 与 KeyedMutex 恢复 5 大不变量，但未在 core 层封装为标准 Service | TBD | 统一资产服务重构时 |
| chat 模式下 repeat-detection 启发式分词与语言支持不完备 | app | 采用混合分词与单 token 旁路，长文本混合场景可能存在边界漂移 | TBD | 意图识别升级时 |
| Import-parser 多候选同名时依赖后缀 disambiguation | core | 导入包含多个同名未命名代码块时生成序号后缀，需依赖后续用户在 UI 侧重命名 | TBD | 导入流增强时 |
| 资产 apply/delete 缺非会话路由，工作台伪造 sessionID | aigcfroge / app | 路由为 `/session/:sessionID/<kind>-asset/...`，模式首页无会话上下文，前端填 `"ses-home-delete"`；`SessionID` 只校验 `startsWith("ses")` 故静默通过，审计归属链断裂（PRD §8.3.1 已声明 sessionID 非写边界前提，故非安全缺陷）。范围与决定见 [Chat PRD §20.6](../docs/prd/chat-mode-creation-layer.md) | TBD | 下次资产端点改动时 |
| P1-10: `resolveSecurePath` 零调用者死代码 | core | `fs-util.ts:257` 的 `resolveSecurePath(worktree, target)` 全仓无调用者（2026-08-14 审计点名），是 fs 工具层的历史残留；可能误导后续路径安全实现去复用一个未经验证的封装。根治：确认无消费方后删除，或纳入统一路径安全封装 | TBD | 下次 fs 层清理时 |
| 存量 `catch (e: any)` 3 处 | core / aigcfroge | main 既有（非分支新增，不违反 No Cheating 新增门禁）：`fs-util.ts:234` 用 `e?.code === "ENOENT"`（ErrnoException）；`session/llm.ts:143` 用 `e.message ?? String(e)`（LLM SDK 可能抛带 `.message` 的普通对象，`instanceof Error` 改写会变 `[object Object]`，须保留 `.message` 访问语义）；`cli/cmd/github.handler.ts:631` 本体已内部 instanceof 收窄，近乎免费。根治：逐 site 核对语义后改 `instanceof Error` + 类型守卫 | TBD | 下次各自模块清理时 |
| E2E 矩阵门禁在 `docs/testing.md` §4 有声明但全仓从未实现 | app | **来源：Custom M3 Phase F4 复核，2026-08-26。** §4 原写「必须覆盖：桌面与窄视口、light/dark、en/zh/zht 三语、键盘 focus、加载/空/错误态」，实测 18 个 `e2e/regression/*.spec.ts`：**dark 0/18、i18n（zh/zht）0/18、keyboard 2/18**，viewport 仅 10 个文件各有 1-2 处 `setViewportSize`（多为设桌面尺寸而非测窄视口）；配置层也无兜底——`packages/app/playwright.config.ts:43` 只有单个 `chromium` / Desktop Chrome project，无 theme / locale / 窄视口 project。**风险是双向的**：一是明暗、三语、键盘可达性回归无任何拦截；二是这条纸面「必须」会被用来卡个别 PR，而全仓中位数从未达标，造成不一致执法。§4 措辞已同步改为「当前实际执行标准 / 目标」两段。根治：在 config 加 theme / locale / 窄视口 project（一次加上会照亮全部 18 个既有 spec，需配套修复预算），或为矩阵另立可执行门禁 | TBD | 做 e2e 矩阵专项时；在把 §4 当作 PR blocker 之前 |
| `SessionExecution.setBusySeamForTesting` 全局测试 seam 位于生产模块 | core | `session/execution.ts` 模块级可变状态，`execution/local.ts` 真实 `isActive` 每次调用都经过该 seam；仅测试可设置且有 finalizer 复位，但生产代码路径携带测试后门，误用会让 busy 判定说谎。根治：实例 HttpApi 测试装配（`HttpApiApp.routes`）暴露 SessionExecution 注入点，或 busy 场景改用真实 drain 构造（挂起 LLM stub + busy 信号轮询） | TBD | 测试装配层改造时 |

---

## 5. 已闭环

| 负债 | 闭环日期 | 闭环提交/分支 |
|---|---|---|
| Chat 模式下 meta 默认权限依赖前置拦截（fail-open 信封） | 2026-08-16 | `session-permission-tier`（meta V1/V2 基线 fail-closed + `PermissionEffective`） |
| meta 非 coding 模式委派 build 死路 | 2026-08-16 | `session-permission-tier`（Phase 5） |
| Custom M0 de-scope：`createCompositionSkillCatalog` seam 无生产 caller | 2026-08-19 | `custom-rollout`（M1 Runner 接线消费：skill tool lookup 与 skill steer 均走 Snapshot-local catalog，缺行/解码失败/漂移 fail-closed） |
| `TaskDriver.active()` 用进程全局「最后写入者胜」选实现，可跨 composition root 误选 | 2026-08-22 | `workflow-surface`（未提交）：`tool/task-driver.ts` 删除进程级注册栈，改 `Context.Reference` `Runtime` + 私有 `RuntimeState` Ref，`active()` 只解析当前 Context，缺失即 `Effect.die` fail-closed；`installForTesting` 仅返回值、须由测试自行 `provide`，不再改全局选择。证据：`packages/core/test/task-driver-fill.test.ts:622` "isolates simultaneous composition roots through the runtime context"、`:648` "fails closed when no composition root runtime is provided" |
| Custom 委派 child 在真实 provider turn 上不可用（R6-0 P0）及拟修复自身三缺陷（R6-1/R6-2/R6-3） | 2026-08-23 | 已合入 `main`（合并提交 `b9c6d1077`，复审通过：复审方以纯函数探针独立复跑确认三项翻转，合并后 core 全量 2061 pass / 2 skip / 0 fail）：`runner/llm.ts` per-turn 主 agent 门禁豁免收窄为 `mode==="custom"` child（create 期 assertAgentAllowed + 派发期 allowlist 双门禁为依据）；`permission/effective.ts` unattended custom 天花板改只读白名单（glob/grep/list_assets/read，ADR-20 §2.6）且 base 显式非通配 deny 保留并排在白名单之后。证据：`test/custom-child-provider-turn.test.ts` "non-meta custom child completes one real provider turn without dying"、"non-custom children stay subject to the per-turn primary gate (R6-3)"；`test/permission-effective.test.ts` R6 整改块 3 例（read .env deny 与 coding 配对 / task_spawn+webfetch deny / 未收录 action 默认 deny） |
| attended custom 资产自授权限绕过审批（§3.1 R6 残留的 attended 半边） | 2026-08-23 | 分支 `scoped-grants`（待复审合入）：产品裁定重写目标为 **`ask`** 而非 deny（ADR-20 §2.6，与 2026-08-16 meta 裁决同型），`effective.ts` 对 `mode === "custom"` 的非白名单资产来源 allow 改判 ask 并保证位序（改判 ask 前置 → 白名单 allow → 显式非通配 deny），saved 追加来源不受影响；`llm.ts` 每轮 provider turn 校验 agent 注册表条目的 `originRelativePath`+`originRevision` 与绑定资产一致，否则 `AgentProvenanceError` fail closed（堵同名冒名变体）。配套落地 ADR-20 §2.7 的 `ApprovalPresence` 连接事实服务与「无应答方即时拒绝」，否则改判只会把安全洞换成挂到 TTL 的可用性事故。证据：`permission-effective.test.ts` Phase D 块、`permission-ask-bounds.test.ts` 「custom ceiling × responder facts (composed)」三例、`custom-child-provider-turn.test.ts` provenance 两例 |
| canonical 工具名共享 64 字符预算，无截断/哈希策略 | 2026-08-25 | `mcp-remote`（短名保持原样；长名固定为 `mcp_<server-prefix>_<tool-prefix>_<hash16>`，hash 覆盖完整 server/tool 身份；最终 registry collision 仍 typed fail-closed。依据为 12 个实际 MCP 配置目录的盘点，最长 server key 为 `openai-api-key-local-confirmation`(33)，并保留 `azure-devops-work-items` + `list_work_item_comments_with_expansion`(66) 越界回归。） |
