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
| §3 Custom Mode 平台（PR #33）   | ADR-17 评审 + Roadmap M0-M5                                     | M0 Phase A-F 已获准连续执行，M1 仍分阶段 |
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
| M2 | 多 Agent 与编排 | Agent 池、Command、Workflow、进度、取消、部分成功 | M1 | 远期 |
| M3 | MCP 与审批 | scoped registration、凭证、健康、统一审批入口（含 once/Session/Location grant model） | M1 + Tool Registry 扩展 | 远期 |
| M4 | Trusted Runtime Extension | Host/Agent/Client 分面、信任、停止、隔离、回滚 | M3 + Plugin 生命周期 ADR | 远期 |
| M5 | Code Presentation | `run_code` + 受限 SDK，共用 Effective Tool Set | M3/M4 稳定 | 远期 |

> 与权限档位的接口约定：Custom M0/M1 必须定义 mode ceiling 与 Snapshot allowlist；应用级审批入口与 grant model 属 Custom M3（权限档位计划明确"不自动批准"）。

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

---

## 5. 已闭环

| 负债 | 闭环日期 | 闭环提交/分支 |
|---|---|---|
| Chat 模式下 meta 默认权限依赖前置拦截（fail-open 信封） | 2026-08-16 | `session-permission-tier`（meta V1/V2 基线 fail-closed + `PermissionEffective`） |
| meta 非 coding 模式委派 build 死路 | 2026-08-16 | `session-permission-tier`（Phase 5） |
| Custom M0 de-scope：`createCompositionSkillCatalog` seam 无生产 caller | 2026-08-19 | `custom-rollout`（M1 Runner 接线消费：skill tool lookup 与 skill steer 均走 Snapshot-local catalog，缺行/解码失败/漂移 fail-closed） |
