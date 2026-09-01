# 五模式运行时与组合平台代码族修整 TDD 实施方案

> **状态**：REVISED DRAFT — 已吸收有条件批准的修订要求；待用户最终批准；未授权修改生产代码
> **日期**：2026-08-30
> **基线**：`main` / `origin/main` = `0ed9e6ed91ca24689e089d945ceb80b8a3787d85`
> **适用模式**：Chat、Coding、Work、Assistant（个人助理）、Custom（自定义）
> **覆盖层**：Schema → Core → canonical Server → legacy AigcForge HTTP adapter → SDK/OpenAPI → App → Persistence → Tests → Docs/Skills
> **实施原则**：识别假设 → 追溯本源 → 重构方案 → 精简输出；复用 → 删除 → 归并 → 重构 → 新增
> **TDD 规则**：每个 Slice 独立完成 RED → GREEN → REFACTOR → 包级门禁 → 数据流复查；未通过不得进入下一 Slice

---

## 0. 审批摘要

### 0.1 复审结论

原方案对 `prompt_async`、Custom Command、Custom Draft 和 App 纯测试边界的判断基本正确，但还不足以直接进入实施。逐层复核后确认，多个现象共享更深的代码族根因：

1. **V2 Snapshot 同时保存 per-consumer bindings 与全局扁平投影，Runtime 却消费全局投影。**
   - Prompt、Skill、Command 的 consumer 隔离没有真正闭环。
   - `orchestrator`、`agents/<agent>` 目前更多是审计元数据，而不是运行时唯一事实源。
2. **Durable admission 没有一个能够原子持有 selection + Prompt + synthetic + 单次 wake 的 Core owner。**
   - legacy adapter 只能手写降级。
   - exact retry、部分失败、并发重试和 wake 边界无法由 HTTP 层可靠组合。
3. **Product Mode policy 在 mutation/admission 前与 provider turn 之间分裂。**
   - 可预期拒绝被 `Effect.die` 转为 defect。
   - `switchAgent` 可先写入非法状态，下一轮 Runner 才失败。
4. **同一资产和 transport 存在多套手写转换。**
   - Command 冻结丢 `invocation/args`。
   - Snapshot → Draft 丢 Skill path/revision。
   - Command Composer 只发送图片，丢文件、Agent mention 和评论上下文。
5. **Location 被 Router 参数、裸目录、server scope、workspaceID 和 SDK directory 多种表示割裂。**
   - Custom Draft、Provider、Custom Profile/Composition transport 都可能使用错误 owner。
6. **测试验证模块形状，而不是跨层行为。**
   - 源码字符串断言、UI/Router 污染纯测试、测试复制生产逻辑，使“配置存在但不可运行”长期假绿。

### 0.2 有条件批准后的实施前提

本方案的**诊断结论获有条件批准**：D1、D2、D3、D4、D6、D7、D8、D9、D10、D11、D12、D14 的方向可进入证据扫描；D5、D13 的原表述撤回并按第 6 节重写。

**已完成的裁决与实施（截至 2026-09-01，分支 `five-mode-tdd`）**：

| 项             | 状态                 | 证据                                                                                                                                                                                                                                                                                                          |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4-A + D5-A    | **已实施并合入分支** | 提交 `74487f934`：`bindings` 三态解码、`AgentInfo.consumerKey` 派生、`CompositionConsumerView` 的 `Scope` 判别式取代 `string \| undefined`、三处扁平回退删除、orchestrator 无条件产出条目、resolve/freeze TOCTOU 根治、完整性校验拆到 `assertDependency`（结构）与 freeze（落地）。全仓 `bun typecheck` 15/15 |
| S0 RED 基线    | **已落盘**           | 提交 `d24b7035a`：9 条断言，8 绿 1 红（`SyntheticAdmitted` 属 S3，正确保持红）。`SyntheticAdmitted` 那条已自证可满足（临时加入 `DurableDefinitions` → 变绿 → 还原）                                                                                                                                           |
| 增量 lint 门禁 | **已加固**           | 提交 `7a431619c`：`guardedRules` 增加 `no-unnecessary-type-assertion` 与 `no-unused-vars`（仅新增行），立即抓出 `tool/skill.ts` 一处死 import                                                                                                                                                                 |
| D13            | **已裁决**           | 见 §6 D13：功能保留，改用 `switchAgent` + `prompt`；fork modifier 删除；提权走现成三档交互                                                                                                                                                                                                                    |
| owner 仲裁     | **已裁决**           | S2/S6 owner 归本计划，三份未开工计划（`v2-architecture-governance-slice-0-3`、`v2-ux-trust-foundation`、`mode-page-unification-v2`）的重叠切片折叠进来，各自保留非重叠部分。依据：极致减法的「归并」优于「选赢家让另一方 rebase」，且本计划已有可复现产物、那三份分支均不存在                                 |
| D2 对冲        | **已裁决**           | 对冲条款必须点名 `EventV2.publish` 跨连接写 deadlock（`docs/technical-debt.md` 已登记债）为具体阻塞点，不得写成含糊的「若现有事务边界无法承载」                                                                                                                                                               |

在 S-1 结束、下列前提完成且用户作出最终批准前，**不得修改生产代码或创建实施分支**：

1. 明确 Snapshot V1、pre-binding V2 和新 consumer-runtime Snapshot 的兼容边界；不能把缺失 `bindings` 解码后的 `{}` 误判为一个合法空 catalog。
2. 新建稳定 machine consumer key，不能用受 Unicode 限制的 key 反向限制 Agent 的展示名称。
3. 将 handoff 的 `fork + prompt + agent` 静默失效登记为 P1，并在“原子实现”与“端到端删除”之间作产品裁决；过渡期请求必须 typed fail closed，禁止 2xx 忽略字段。
4. 在 S-1 ledger 裁定本计划与 `v2-architecture-governance-slice-0-3.md`、`v2-ux-trust-foundation.md`、`mode-page-unification-v2.md` 的代码 owner、文件范围和合并顺序。
5. 完成 SDK/OpenAPI 生成链证据：tracked spec、V1 gen、V2 gen 的 owner、再生命令和冻结/迁移策略必须可验证。
6. 先解除会固化既有缺陷的测试契约，并以独立进程验证 `custom-preview-column` 的测试隔离事实。

正确实施顺序调整为：

```text
S-1 代码族 owner/reuse + 计划归属证据扫描
→ S0 冻结行为、协议决策与 RED 基线
→ S0.5 测试解锁：移除 false contract 与全局 mock 泄漏
→ S1 Consumer-scoped Snapshot Runtime
→ S2 Durable Admission Kernel + Atomic Submission
→ S3 Policy / Event / Timestamp / Mutation Correctness
→ S4 Prompt Adapter + Attachment Materialization
→ S5 Snapshot Command Runtime
→ S6 App Location / Draft / Provider / Navigation / Round-trip
→ S7 Canonical API / Legacy Adapter / SDK / OpenAPI
→ S8 测试体系收敛与覆盖扩展
→ S9 删除、归并、注释与文档同步
→ S10 全量回归与交付审查
```

### 0.3 本轮不是无边界全仓清理

“逐行扫描”在本计划中定义为：

- 对五模式相关代码族逐模块读取 owner、调用方、注册、持久化、错误和最近测试；
- 对触达文件逐行检查重复转换、吞错、无效配置、死分支、unsafe escape hatch 和过时注释；
- 不声称人工逐字审计全仓所有无关包；
- 范围外发现进入 backlog，不借本计划机械翻译全仓注释或删除未证明无消费者的兼容代码。

---

## 1. 强制协议、Skills 与事实源

### 1.1 开工前必读

| 事实源                                                            | 本计划采用的约束                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                       | 第一性原理、根因收敛、方案对冲、改完即审；不能以 typecheck 代替行为验证                                 |
| `AGENTS.md`                                                       | V2 durable admission 与 model execution 分离；exact retry；Location-scoped Runner；测试不得从根目录运行 |
| `ARCHITECTURE.md` §4.1/§4.4/§4.6/§4.10                            | Session V2、Composition、Location、Product Mode、Context owner                                          |
| `CONTEXT.md`                                                      | Session/Location/root-child/Snapshot 关系和客户端 capability 语义                                       |
| `DESIGN.md`                                                       | loading/empty/error、i18n、a11y、窄屏、稳定布局和 token                                                 |
| `docs/testing.md`                                                 | 红→绿→重构；禁止源码字符串行为断言；禁止固定 sleep；包内真实命令                                        |
| `packages/aigcfroge/AGENTS.md`                                    | Effect 服务、self-export、数据库和运行时 owner                                                          |
| `packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md` | legacy typed HttpApi、错误映射和 service owner                                                          |
| `packages/aigcfroge/test/AGENTS.md`                               | `testEffect`、`it.effect/live/instance`、`Layer.mock`、ready signal                                     |
| `packages/app/AGENTS.md`                                          | Solid owner、browser-safe import、App module boundary                                                   |
| `.aigcfroge/skills/protocols/SKILL.md`                            | 跨文档路由、ADR/spec/包级协议加载顺序                                                                   |
| `.aigcfroge/skills/effect/SKILL.md`                               | Effect error channel、service/layer、callback/interruption 规则                                         |
| `.aigcfroge/skills/database/SKILL.md`                             | Schema/migration/持久化兼容边界                                                                         |
| `.aigcfroge/skills/enterprise-code-standard/SKILL.md`             | 明确 owner、typed boundary、可观测错误、最小职责                                                        |
| `.aigcfroge/skills/reuse-first-refactor/SKILL.md`                 | 先证明调用关系，再 keep/reuse/delete/merge/simplify                                                     |
| `.aigcfroge/skills/quality-to-pr/SKILL.md`                        | 测试、生成物、安全、文档和 PR 证据门禁                                                                  |
| `.aigcfroge/skills/frontend-theming/SKILL.md`                     | UI 状态、token、主题、i18n、响应式和交互门禁                                                            |

### 1.2 事实源优先级

不得再写成“运行时代码/Schema 自动高于 Accepted ADR”。正确处理是：

1. **当前已实现事实**：以 `main` 代码、数据库 Schema 和真实行为测试为证据。
2. **预期规范语义**：以根协议、Accepted ADR、PRD/spec 和后续批准记录为依据。
3. 二者冲突时：登记 drift，暂停实现，取得 owner/用户审批。
4. 代码不能静默 supersede Accepted ADR；历史 ADR 正文也不能覆盖后续已批准并合入 `main` 的新决策。

### 1.3 测试纪律

- 不从仓库根运行测试。
- `bun --cwd <pkg> <script>`；`--cwd` 后不要加 `run`。
- 不用 `Effect.sleep(N)` / `setTimeout` 等待并发。
- 不用源码 `toContain(...)` 代替行为测试。
- 不复制生产 filter/reduce/parser 到测试 helper。
- 不新增 `any`、无说明的 `@ts-ignore`、`globalThis.*` 测试逃生口。
- 任何 2xx/204 “accepted” 返回前，测试必须能读取对应 durable state。

---

## 2. S-1：代码族 owner/reuse 证据扫描

### 2.1 目的

在写 RED 前先完成受影响代码族的 owner map，避免：

- 把 endpoint 加到错误的 Server 层；
- 新建已有 owner 的平行 helper；
- 把兼容层当 canonical domain owner；
- 把“手写代码”泛化为全部删除；
- 根据过时行号或历史计划修改错误文件。

### 2.2 强制证据表

每个候选符号/模块必须记录：

| 字段            | 要求                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `candidate`     | 候选符号、模块或数据结构                                                   |
| `definition`    | 唯一定义和 canonical owner                                                 |
| `callers`       | 上游入口和下游消费者                                                       |
| `registration`  | HttpApi、Layer、registry、SDK/OpenAPI 注册点                               |
| `persistence`   | 表、event、snapshot、local storage 或 query owner                          |
| `nearest tests` | 最近的真实行为测试                                                         |
| `compatibility` | V1/V2、旧 Snapshot、旧 SDK、迁移要求                                       |
| `decision`      | keep / reuse / delete / merge / simplify / owner-decision / false-positive |
| `reason`        | 证据、风险和替代方案                                                       |

### 2.3 必扫代码族

| 层               | 必扫 owner                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Schema           | `product-mode`、`prompt`、`session-input`、`composition`、`command-asset`、`custom-profile`、错误 Schema                |
| Core Session     | `SessionV2`、`SessionInput`、`SessionEvent`、Projector、Store、Runner、Execution、Composition Snapshot                  |
| Core Composition | Resolver、digest、Asset services、Skill guidance/tool/catalog、Product Mode policy                                      |
| Canonical API    | `packages/server/src/groups/session.ts`、`packages/server/src/handlers/session.ts`、errors/middleware                   |
| Legacy Adapter   | `packages/aigcfroge` SessionPrompt、legacy HttpApi group/handler、workspace routing、custom composition/profile         |
| SDK/OpenAPI      | tracked OpenAPI、V1 gen、V2 gen、client transport、generation script                                                    |
| App              | Composer、command parser、prompt part builder、Custom Draft、Snapshot panels、ModeWorkspace、Provider owner、navigation |
| Persistence      | `session_input`、Session event/message tables、Snapshot rows、Custom Draft persist key/migration                        |
| Tests            | Core/AigcForge/App/SDK nearest tests、源码字符串测试、broad mocks、E2E 缺口                                             |
| Docs/Skills      | 根协议、ADR-11～21、pages、PRD/roadmap、testing、technical debt、protocols skill                                        |

### 2.4 S-1 产物、owner ledger 与停止条件

产物直接补在实施 PR 的描述或本计划附录，不强制新增平行文档；但以下两张表为**开始任何 GREEN 前的硬产物**。

#### A. 代码族证据表

按 2.2 的字段记录每个候选 owner 的定义、调用方、注册、持久化、最近测试、兼容边界和 keep/reuse/delete/merge 决定。

#### B. Owner 与顺序 ledger

| 代码族                             | 唯一实施 owner                                                         | 允许触达文件                                                                              | 其他计划角色                          | 前置条件                          | 合并顺序                                          |
| ---------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------- | ------------------------------------------------- |
| durable admission / lifecycle      | 本计划 S2 **或** `v2-architecture-governance-slice-0-3.md`，必须二选一 | `session/input.ts`、`session.ts`、`session/event.ts`、`session/projector.ts` 及其最小邻接 | 未获 owner 的计划只引用和验收，不实现 | Snapshot consumer contract 已冻结 | Core owner 合并后才允许 adapter 改动              |
| Custom Draft / Provider / Location | 本计划 S6 **或** `v2-ux-trust-foundation.md`，必须二选一               | `custom-draft.tsx`、`use-providers.ts`、Custom 面板及最小导航 owner                       | 另一计划只定义 UX 验收或复用结果      | typed API/Location contract 明确  | API/Core 语义稳定后                               |
| ModeWorkspace                      | `mode-page-unification-v2.md` **或** 本计划 S6，必须二选一             | `mode-workspace*`、slots、相关页面 owner                                                  | 另一计划不得借机重写 render-all 语义  | S0.5 已删 false contract          | Custom Location contract 后                       |
| SDK/OpenAPI                        | 本计划 S7                                                              | root generator、tracked spec、V1/V2 gen、SDK transport                                    | 其他计划不得手工编辑 generated files  | 生成链 ledger 完整                | canonical API 同 PR 或紧随其后的独立 generated PR |

出现以下情况必须停止并请求裁决：

- canonical owner 不唯一，或上述三个计划的文件范围未裁定；
- Accepted ADR 与 `main` 行为相反；
- 需要新增 Snapshot version/migration，但没有 backward decode、数据识别和回滚策略；
- 无法区分“旧 V2 缺 bindings”与“新 V2 的合法空 binding”；
- 无法证明待删符号没有生产消费者；
- 新测试只能靠源码字符串、固定 sleep 或全局 mutable mock 才能写。

---

## 3. 复审后的问题清单

> 这里的 P0 表示“方案审批阻断”，不等同于线上安全事故等级。

## 3.1 P0：审批前必须明确的架构问题

### MODE-P0-1：Snapshot per-consumer contract 未闭环

证据链：

- `packages/schema/src/composition.ts` 同时定义 `bindings` 和顶层 `instructions/prompts/skills/commands`。
- `packages/core/src/composition-resolver.ts` 按 consumer 解析资产，同时又聚合成全局数组。
- `packages/core/src/session/runner/llm.ts` 把 `snapshot.data.instructions` 注入所有 Custom agent。
- `packages/core/src/skill/guidance.ts`、`packages/core/src/tool/skill.ts`、Runner skill promotion 使用 `snapshot.data.skills`。

影响：

- root `meta` 可见仅绑定给 child 的 Prompt/Skill。
- child 可见其他 child 的资产。
- Command consumer boundary 即使补 runtime，也会被扁平 catalog 绕过。

根治：建立唯一 **Composition Runtime View / Consumer Catalog Resolver**：

```text
(snapshot, session root/child identity, selected agent)
→ consumer key
→ instructions/prompts/skills/commands
```

Snapshot v2 Runtime 禁止回退顶层扁平字段；v1 使用单独兼容路径。

### MODE-P0-2：Durable submission 没有 Core-owned batch owner

当前 selection、Prompt、Synthetic、wake 分散在：

- `SessionV2.switchAgent/switchModel`
- `SessionV2.prompt`
- `SessionV2.injectSynthetic`
- `SessionExecution.wake`

无法可靠保证：

- selection + Prompt + N synthetic 全部验证后一次提交；
- 任一失败时零部分 durable side effect；
- batch exact retry；
- concurrent retry 只提交一次；
- 全部 admission 完成后只 wake 一次。

根治：Core 新增或扩展现有 owner，提供一个 typed **Durable Submission**；HTTP/App 只构造输入，不实现幂等和 wake。

### MODE-P0-3：旧 Snapshot Command 获得新执行能力的兼容策略未审批

旧 Snapshot 只冻结 `name/description/relativePath/revision/template`，没有 `invocation/args`，且当时 Runtime 不执行 Command。

若升级应用后自动把旧 Snapshot 解释成可执行 Command，会改变历史 Snapshot 的能力。推荐：

- 旧 Snapshot 继续可读；
- Command fail closed；
- 用户通过 fork/upgrade 冻结新 Snapshot 后获得 Command runtime。

不得默认从 live/global catalog 补字段。

### MODE-P0-4：Canonical V2 API owner 必须锁定为 `packages/server`

仓库已存在 canonical V2 Session API：

- `packages/server/src/groups/session.ts`
- `packages/server/src/handlers/session.ts`

`packages/aigcfroge` HttpApi 是 legacy/compatibility surface。Custom Snapshot Command、durable submission、typed error 和 capability 不能只加在 legacy handler 中，否则会形成第三套事实源。

## 3.2 P1：已确认的运行时/数据身份缺陷

### MODE-P1-1：legacy `prompt_async` 有损且吞错

`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts` 的 V2 分支：

- 只取第一个 text part；
- 丢 `messageID/model/agent/variant`；
- 丢多 text、files/images/PDF、Agent mention、synthetic comment；
- 纯附件请求可能不 admission 仍返回 204；
- `Effect.ignore` 吞 Snapshot、conflict、disabled 等错误。

### MODE-P1-2：附件保真只完成 admission，未完成 provider lowering

`packages/core/src/session/runner/to-llm-message.ts` 把 `Prompt.files[].uri` 原样放进 `ContentPart.media.data`；Provider lowering 只接受 canonical base64/data URL，不会读取 `file://`。

因此“把 legacy file part 直接塞入 V2 Prompt”仍会导致：

- `file://` 被当 base64，provider request 失败；
- `text/plain`/PDF 与 provider 支持矩阵不一致；
- V1 中已有的 file/MCP resource/materialization 规则被绕过。

### MODE-P1-3：Product Mode policy 被转换为 defect

`ProductModeAgentPolicy.enforcePrimary` 对可预期拒绝使用 `Effect.die`。Shell/Command policy 在多个入口也以 defect 传播。

结果：

- HTTP 无法稳定映射 400/409；
- 正常策略拒绝进入 defect/log path；
- `prompt_async` 更容易返回假成功。

### MODE-P1-4：`switchAgent` 可持久化非法状态

`SessionV2.switchAgent`：

- 非 Custom 未统一执行五模式 primary-agent policy；
- Custom root 只验证 agent 在 Snapshot pool 中，未保持 root=`meta`；
- `AgentSwitched` 先持久化，Runner 下一轮才执行 primary policy。

非法操作必须在 event/row mutation 前 fail typed，并断言零 durable side effect。

### MODE-P1-5：Skill promotion timestamp 与 admission 不一致

Runner 注释要求使用 `admitted.timeCreated`，实现却使用 `DateTime.now`。Projector/SessionInput equivalence 会比较 admission timestamp，真实时钟下可能触发 lifecycle conflict。

### MODE-P1-6：`SyntheticAdmitted` 声明 durable，却不在 Durable/All union

数据库可持久化该事件，但：

- `SessionV2.events()` durable stream 看不到；
- replay/audit 和通用消费者无法解码；
- exact retry tests 只查底层表，未查公开 event stream。

### MODE-P1-7：Custom Command 是“可配置、可冻结、不可运行”的死表面

当前：

- CommandAsset 有 `invocation/args/source`；
- Snapshot `CommandInfo` 丢字段；
- Resolver 有两份重复转换；
- Builder 可绑定 Command；
- Runtime 不消费 bindings command；
- App Slash catalog 仍用 live directory command；
- legacy Custom `/command` 被拒绝。

### MODE-P1-8：Custom Draft 跨 Server/Directory 泄漏

`packages/app/src/context/custom-draft.tsx`：

- `directory()` 首次读取；
- module-global `sharedStores`；
- key 只有裸目录；
- 所有 store 使用同一个 `Persist.global("custom-draft")`；
- Sidebar/Main 双 Provider。

### MODE-P1-9：Snapshot → Draft Skill identity 有损

`loadFromSnapshot` 把 Skill：

- `relativePath` 改成 `name`；
- `revision` 清空。

Upgrade 再把这份有损 Draft 作为 CompositionInput 提交，破坏 Snapshot → Draft → Plan round-trip。

### MODE-P1-10：Custom Start/Upgrade 打开错误 Draft

后端返回准确 Session ID 后，App 调用 `launchModeSession(...)`，其语义是新建 Draft，而不是打开返回的 Session。可能造成不可见 Session 和重复 Start/Upgrade。

### MODE-P1-11：Command Composer 丢上下文

普通 Prompt 复用 `buildRequestParts`，而 immediate/queued Command 两条路径各自只 `images.map(...)`，丢：

- 文件 pill/selection；
- Agent mention；
- prompt.context；
- review/file comment；
- synthetic comment note；
- 评论中的文件 mention。

### MODE-P1-12：Provider 选择绑定 Router `params.dir`，不是当前 SDK Location

New Session Draft 的真实目录来自 Draft/SDK；`useProviders()` 仍从 Router 参数推导 workspace。Provider query 与实际 Provider selector 可能读取不同 owner。

### MODE-P1-13：Custom “Primary Agent” 是假配置

App Draft/UI 维护 `primaryAgent`，但 CompositionInput 没有该字段，Custom root 协议固定为 `meta`。该状态不能影响 Runtime，属于误导用户的死配置。

### MODE-P1-14：handoff 的 `fork + prompt + agent` 静默失效

App 和 TUI 的 handoff 调用向 V2 fork payload 传递 `prompt/agent`，但 V2 handler 只 lower `messageID`。结果是 child Session 可被创建并导航，初始 prompt 没有 admission、agent 没有选择或切换，用户只看到一个“成功”的空 child。

这是活功能的静默失效，不能按「未消费死字段」单独删除。已按 D13 裁决（2026-09-01）：功能保留但改建在 `switchAgent` + `prompt` 上，fork 的这两个字段作为错误原语删除。过渡期不得返回成功后忽略字段。

证据链：`packages/server/src/groups/session.ts:367-370` 声明 `prompt?`/`agent?`；`packages/server/src/handlers/session.ts:607-630` 只读 `ctx.params.sessionID`，从不读 `ctx.payload`；调用方 `packages/app/src/pages/session.tsx:1572-1595`（经 `session/timeline/message-timeline.tsx:1223-1230` 的 `HandoffButton`）与 `packages/tui/src/routes/session/subagent-footer.tsx:77-87`；配置源 `packages/schema/src/agent.ts:32` 的 `handoffs: Array<{label, agent, prompt, send?, model?}>`。

附带缺陷（同一根因，S3 一并修）：`packages/core/src/agent/file-loader.ts:61-64` 的 filter 只校验 `label/agent/prompt`，静默丢弃 `send` 与 `model`；`packages/schema/src/agent-asset.ts` 没有 `handoffs` 字段，`agent/asset-bridge.ts:67` 只能读 `config?.handoffs`，因此经资产工作室创建的 agent 无处填写 handoff —— 这是该功能至今零使用的真正原因。

## 3.3 P2：高风险一致性和可观测性问题

以下条目纳入 S-1 复现矩阵；RED 证明确认后进入对应 Slice：

1. `freeze()` 在 `resolve()` 后二次读取 live Prompt/Skill/Command，资产变化时可能生成半空 Snapshot。
2. canonical API 对不支持 Custom capability 返回 404，而不是 typed unsupported mode。
3. canonical Server 对 Custom `interrupt/wait/compact/share/switch*` 使用过时 blanket gate，而不是 operation policy。
4. fork modifier 的过渡 typed fail-closed、SDK migration 和 handoff UI 隐藏/删除范围未覆盖。
5. legacy external share-link 与 canonical context share 同名，legacy V2 分支疑似调用错误语义 owner。
6. Custom create/upgrade 在 canonical 与 legacy surface 的状态码和错误 body 漂移。
7. Custom Profile 路径含 `sessionID`，handler 却不使用；workspaceID 可能被降级为 directory-only Location。
8. OpenAPI/SDK 通过 `/api/` 路径前缀判断 canonical/compatibility，非 `/api` typed Custom API 可能被错误转换。
9. OpenAPI tracked spec、V1 gen、V2 gen 不在同一完整生成链。
10. Custom Sidebar 五类 asset 请求 catch-all 返回空数组，把失败伪装为 empty。
11. Custom Snapshot 请求失败被伪装成“无 Snapshot”。
12. Plan loading/error/无 digest 时 `canStart` 仍可能为 true。
13. “Create starter agent”只向 Draft 添加空 revision 引用，没有创建真实资产。
14. ModeWorkspace render-all 保留 UI state 的同时持续运行隐藏模式网络/SDK/Persist 副作用。
15. Session model variant 缺省值 DB round-trip 变成 `"default"` sentinel。
16. MCP stale revision 未进入 `Health.staleRevisions`。
17. Custom kill switch 对 admission/resume/provider turn 的语义不统一。
18. typed error 缺稳定 message；unknown defect 被 catch-all 伪装成 4xx。
19. Prompt decode log 记录完整 `part`，可能泄漏文本、data URL/base64 和文件正文。

## 3.4 P3：测试、死代码和注释债务

- `custom-builder-contract.test.ts`、`mode-workspace.test.tsx`、`session-todo-progress.test.tsx` 等源码字符串测试不能证明行为。
- `custom-preview-column.test.ts` 从 `.tsx` 导入纯 classifier，触发 Router/client-only 错误。
- `submit.test.ts` broad mocks 没有验证完整 SDK payload。
- Custom Preview tests 复制 production grouping/count 逻辑。
- `isV2Mode` 等 helper 只有测试消费者，需在 S-1 证明后删除。
- `sharedStores` 是仍有生产读写的迁移/cutover owner，不与真死代码混列；test-only Provider catch、失效外层 catch、重复 `commands ?? []` 才是待证实的减法候选。
- `@ts-ignore + globalThis.AI_SDK_LOG_WARNINGS` 不能进入新 admission 模块，需迁移到 typed bootstrap 或保留为显式技术债。
- 触及范围内中文、日期和 `HIGH-*`/`MEDIUM-*`/`M1` 审计编号注释需处理。
- Legacy Command/Skill migration 和 Plugin 消费的 Command owner未证明无消费者，禁止误删。

---

## 4. 根因收敛与目标架构

### R1：Composition 存在双事实源

**现状**：`bindings` 与顶层 `instructions/prompts/skills/commands` 并存，Runtime 选择后者。

**目标**：

```text
Snapshot v2 canonical owner = bindings
Runtime View = resolve(snapshot, consumer identity)
Top-level flat arrays = compatibility/read-only projection only
```

所有以下消费者必须复用 Runtime View：

- system custom instructions；
- Skill guidance；
- Skill tool lookup；
- Skill steer promotion；
- Snapshot Command catalog；
- App Snapshot panel/Slash catalog。

### R2：Transport 与 durable submission 无唯一 owner

**目标 owner 分层**：

```text
App Composer normalization
→ Legacy payload adapter / Canonical API decode
→ Core DurableSubmission
→ SessionInput/Event transaction
→ commit
→ SessionExecution.wake(sessionID)
```

- App 不实现 exact retry。
- HTTP 不直接调用裸 `SessionInput.admit*`。
- Core 复用 `SessionV2` 的 equivalence/conflict 合同。
- wake 只发生在 durable commit 完成后。

### R3：Policy 在 mutation 与 execution 之间分裂

**目标**：

- mutation/admission 前执行 typed policy；
- provider turn 继续 defense in depth，但不能成为首次拒绝点；
- capability、runtime kill switch、operation policy、agent policy 分开；
- 正常拒绝使用 typed error，不用 defect。

### R4：资产转换存在多个 owner

建立唯一转换器/视图：

- CommandAsset → frozen CommandInfo；
- Snapshot SkillInfo → CustomDraftSkill；
- Prompt parts → canonical durable submission；
- command invocation parser；
- Location identity；
- API domain error → transport error。

### R5：Location algebra 不统一

目标 identity：

```text
LocationIdentity = {
  serverKey,
  serverScope,
  normalizedDirectory,
  workspaceID?
}
```

Router、SDK、Provider、Persist、Query、Custom Composition/Profile 都消费同一 owner，不再各自拼 key。

### R6：测试 owner 与生产 owner 不一致

目标测试分层：

- pure model `.ts` tests；
- Core Effect behavior；
- canonical/legacy HTTP parity；
- SDK generated contract；
- App component/Location integration；
- Playwright 主路径和错误态；
- 不以源码结构作为验收标准。

---

## 5. 目标 owner 地图

| 责任                               | Canonical owner                                                     | Compatibility/consumer            |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| Product Mode Schema                | `packages/schema`                                                   | Core/App/SDK 只消费               |
| Composition Snapshot contract      | `packages/schema/src/composition.ts`                                | Resolver/Session/App              |
| Runtime consumer view              | `packages/core` 新近邻模块或现有 composition owner                  | Runner/Skill/Command/App API 投影 |
| Durable submission                 | `packages/core/src/session.ts` + `session/input.ts`/Event owner     | Server/legacy adapter             |
| Canonical V2 API                   | `packages/server`                                                   | SDK V2                            |
| Legacy HTTP compatibility          | `packages/aigcfroge` HttpApi                                        | 旧 SDK/App compatibility          |
| Legacy Prompt part materialization | `packages/aigcfroge/src/session/prompt.ts` 近邻可复用 owner         | V1 与 legacy→V2 adapter           |
| Provider history lowering          | `packages/core/src/session/runner/to-llm-message.ts` + LLM protocol | Runner                            |
| Custom Draft Location owner        | App 上层 Custom surface + `Persist.serverWorkspace`                 | Sidebar/Main                      |
| Session 成功导航                   | App 现有 exact-session open owner                                   | Start/Upgrade                     |
| OpenAPI/SDK generation             | repository SDK build script + explicit surface metadata             | tracked spec、V1/V2 gen           |
| Docs current state                 | 根协议 + Accepted ADR status note                                   | pages/roadmap/technical debt      |

禁止新增：

- handler 内平行 Runner；
- Session-ID keyed Layer；
- live/global Command fallback；
- module-global Draft store map；
- 第三套 OpenAPI/SDK transport；
- Router-specific Provider truth source。

---

## 6. 需要审批的决策 D1–D14

### D1：synthetic comment 的 durable 表示

**推荐**：保留独立 synthetic admission，稳定 identity 与主 message ID 关联；不拼入普通 Prompt 文本。

原因：保留来源边界、可独立 replay/audit，并与现有 V1→V2 projection 语义接近。

### D2：Durable Submission 采用原子批次还是可恢复批次

**推荐：原子批次；明确以 EventV2 跨连接 publish deadlock 为实施阻塞点。**

同一数据库 transaction 必须完成：

- selection；
- Prompt/Command/Shell/Skill/Synthetic 的 durable input row；
- 对应 durable event row；
- exact retry/conflict 的唯一性判断。

commit **之后**才可以执行 publish、subscriber notification 和最多一次 `SessionExecution.wake(sessionID)`。publish/wake 失败不能把已提交 admission 伪装成未成功，也不能在 commit 前 wake。

当前四个 `SessionInput.admit*` 不接收 transaction，且 EventV2 publish 存在已登记的跨连接 deadlock 风险。因此 S2 必须先写 RED 证明：事务内多 admission 不会跨连接死锁、commit 前不暴露 wake、post-commit delivery 可幂等重试。不得简单把 N 个既有 admit 调用包进 transaction。

若无法做到上述 atomic write + post-commit delivery 边界，必须暂停并提交“可恢复批次”的明确状态机、重放规则、用户可见状态和技术债；不得由 HTTP handler 猜测完成状态。

### D3：Custom root 与 Agent mention

**推荐**：

- Custom root 只允许 `meta`；
- child 只允许父 Snapshot pool 中与自身 provenance 匹配的 agent；
- Agent mention 仅作为 Prompt context，不切 root；
- 非法 mutation 在 durable write 前返回 typed 400。

### D4：Runtime consumer key 规则

**推荐：展示名称与 consumer machine identity 分离。**

- root Session → `orchestrator`；
- child Session → `agents/<frozen-consumer-key>`；
- `AgentAsset.Name` 是用户可见名称，可包含 Unicode、空格和点，不得为适配 ConsumerKey 被收窄；
- Snapshot AgentInfo 或其近邻 frozen runtime record 持有稳定、受约束、可持久化的 `consumerKey`；不得从 display name 临时拼接；
- mapping 必须在 resolve/freeze 时唯一确定，并由 Snapshot 直接读取；
- 缺失、重复、无法反解或 child 不在 Snapshot pool 的 mapping 必须 fail closed；
- 对新 consumer-runtime Snapshot，无 binding 返回空 catalog，不回退顶层 flat projection。

S1 必须决定该 machine key 的来源、迁移策略和是否新增 Snapshot schema 字段，禁止只靠 name slugify 产生不可逆或碰撞的 key。

### D5：Snapshot consumer runtime graph 与 flat fields 兼容策略

**撤回“所有 V2 Runtime 立即禁止读取 flat fields”的原表述。**目标仍是单一 frozen graph，但必须先补齐可执行数据和版本识别。

新 consumer-runtime Snapshot 的每个 consumer view 至少完整持有：

- stable consumer identity 与 frozen selected-agent identity；
- agent/system instructions 与 binding-derived instructions；
- prompts、skills、commands；
- 必要的 frozen refs/revisions，且可供 Runner、SkillGuidance、SkillTool、promotion、Command runtime 共用。

实施顺序：

1. 补齐 `SnapshotBindingData.instructions`（或等价的完整 runtime-view Schema），并显式保留 agent source/system instruction 的归属；不能只迁 Prompt template 而遗漏 agent instructions。
2. 添加可识别的 runtime-graph version/marker，区分 V1、pre-binding V2、以及新 consumer-runtime Snapshot；不得让 `bindings` 的 decoding default `{}` 抹去这一区别。
3. 对 V1 和 pre-binding V2 建立**显式 legacy compatibility view**，保持历史语义；不得把它们当成新 Snapshot 的空 binding，也不得伪造 per-consumer identity。
4. 仅当 Snapshot 明示 consumer-runtime graph 已完整时，Runtime 禁读顶层 `instructions/prompts/skills/commands`；缺 consumer 则 fail closed。
5. App 不能把 flat fields 当新 V2 的 canonical catalog；flat projection 仅可作为 backward decode/API read compatibility，后续版本才决定物理删除。

V1 compatibility 不等于从 live/global catalog 回填；旧 Snapshot 仍不得获得创建时不存在的新 Command 能力。

### D6：旧 Snapshot Command 能力

**推荐**：旧 Snapshot Command fail closed；要求 fork/upgrade 生成新 Snapshot。

不推荐自动从 `name/template` 推导完整 invocation，也不允许 live/global catalog 回填。

### D7：Snapshot Command durable 表示

**推荐**：新增独立 `SessionInput` command kind，而不是只保存展开后的普通 Prompt。

建议 durable 字段至少包含：

- message/idempotency ID；
- command canonical name/relativePath/revision；
- consumer key；
- raw arguments；
- canonical context Prompt（files/agents）；
- deterministic synthetic inputs；
- delivery/resume；
- Snapshot digest 或等价 frozen identity。

promotion 时从当前 Session 的 frozen Snapshot 解析并静态展开，保留审计和 exact-conflict 语义。

### D8：Custom Command attachment contract

**推荐**：Command 与普通 Composer 复用同一个 context normalization：

- files/images/PDF；
- Agent mention；
- selection/source；
- review/file comments；
- synthetic note。

Command 只改变文本模板来源，不降低附件语义。

### D9：Canonical Command API

**推荐**：

- owner：`packages/server`；
- 路径：V2 Session API 家族中的独立 async/durable endpoint；
- 成功响应沿用 `{ data: SessionInput.Admitted }` 或新增 command admission union；
- typed 400/404/409；
- legacy `/session/:id/command` 保持同步 V1 `WithParts` 语义且 Custom 继续拒绝；
- legacy App/SDK 通过明确 adapter 调 canonical application service，不偷渡同步返回。

### D10：V1 Snapshot → Draft → Upgrade 策略

**推荐**：V1 缺少精确 AssetRef 时 fail closed，并要求用户重新选择资产或使用明确历史 resolver；禁止伪造空 revision。

V2 必须保证：

```text
Snapshot V2 → Draft → CompositionInput → Plan
```

资产 identity 和 consumer binding 语义等价。

### D11：Legacy global Custom Draft 迁移

**推荐**：首次获得明确 Location 且目标没有新 Draft 时，原子迁移到该 Location，写迁移标记后删除 legacy key；不 fan-out。

没有明确 Location 时延迟迁移。

### D12：Custom kill switch

**推荐**：定义为真正的执行 kill switch：

- read/export/history 允许；
- create/admission/resume/wake/provider turn/command fail closed；
- 所有入口复用同一 typed policy；
- 关闭时不得留下部分 durable mutation。

### D13：handoff 的原语选择与提权交互（已裁决 2026-09-01）

**两次撤回。** 初版写「删除未消费死字段」是错的（有真实调用方）；复审版写「原子实现 fork+prompt+agent 或端到端移除」二选一也是错的 —— 它把实现偏差当成了产品选项。

**产品裁决（用户 2026-09-01）：功能必须保留。**

**架构裁决：handoff 用 `switchAgent` + `prompt`，不用 fork。**

设计出处 `docs/plan/vscode-alignment-meta-agent.md` P3 写的目标是「让 agent 之间可以显式切换（如 Plan → Implement）」——**切换**。实现却选了 fork，这是实现偏离设计，不是设计有两个选项。`SessionV2.switchAgent`（`core/src/session.ts:761`）已存在且已 durable，`SessionV2.prompt` 同样，所以正确解法是组合两个既有原语：

|            | fork + agent + prompt（旧方案）     | switchAgent + prompt（裁决） |
| ---------- | ----------------------------------- | ---------------------------- |
| 需要的原语 | 3 操作原子提交，须等 S2 建出 kernel | 两个**已有** durable 原语    |
| 能否现在做 | 不能，卡 S2                         | 能，S3 即可闭合              |
| 导航       | 需打开子会话，撞 MODE-P1-10         | 不动导航，完全绕开           |
| 失败退化   | prompt 失败留下空 child 孤儿        | 未发出，用户自行补一句       |
| 语义       | 分叉                                | 接棒，与 handoff 一词一致    |
| 会话历史   | 断成两条                            | 一条线连续可读               |

想「从同一方案分叉两种实施」时，`fork` 本身是独立且正确的功能：用户先 fork 再 handoff。**组合已有能力，不为一个用例焊出新原语。**

因此 fork 端点的 `prompt`/`agent` **确认删除** —— 它们是错误的原语承载，而非要保留的功能。删除的同时功能在 switchAgent 上做通，满足「必须保留」。

**残留原子性问题远小于 S2**：`switchAgent` 必须先提交，`prompt` 才能进 admission，否则这句话会跑在旧 agent 上。两步顺序问题，两步各自已有冲突语义，不需要三方事务。

**提权与 `send` 的交互（复用现成范式，零新增交互）**

`plan` 声明为 "Disallows all edit tools"（`aigcfroge/src/agent/agent.ts:276`），`build` 按配置执行工具（`:259`）。所以 `plan → build` 是明确提权，而它正是 handoff 主用例。一个 `.agent.md` 写 `send: true` 就静默从只读跳进可写并自动发指令，不可接受。

仓库已有三档交互强度，不新建：

| 现成范式    | 位置                                                                      | 强度                                                             |
| ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 档位切换    | `app/src/pages/session/composer/permission-tier-selector.tsx`             | 最轻，`aria-pressed` 按钮组，点即生效                            |
| 逐工具询问  | `app/src/context/permission.tsx:21` + `core/src/permission.ts:57` `Reply` | 中，`once` / `always` / `reject` 三态，有持久化通道              |
| break-glass | `app/src/pages/session/composer/session-permission-override-dialog.tsx`   | 最重，Dialog + 强制勾选 + 30s 续租 60s 租约 + 仅根会话且有人值守 |

裁决规则：

1. **提权判定 owner = `PermissionEffective.effectiveV2`**（`core/src/permission.ts:223`），不新建判断逻辑。
2. **未提权（同级或收窄）+ `send: true`** → 直接 switchAgent 并发出。
3. **提权 + `send: true`** → 降级为预填，显示提权明细，走逐工具询问的 `once` / `always` / `reject` 三态。选 `always` 则记住该 handoff（label+目标 agent），下次直接兑现 `send`。
4. **`send: false`** → 一律预填等用户确认，不论权限。
5. **唯一走 break-glass 的例外**：目标 agent 的有效权限含 `bash` 且当前会话为 `propose` 档 —— 等于一步从「只提议」跳到「可执行任意命令」，与 `session-permission-override-dialog` 守同一风险面，必须复用它。
6. **不按工具危险度分档**：逐工具询问本就按具体工具问，危险度已内建在权限表中。handoff 只需在切换那一刻问一次。

「自动发」= 未提权或已 `always` 授权；「填好等交互」= 提权且未授权。两种真实需求落在同一机制，**由权限裁决而非配置裁决**。

**`agent-asset.ts` 必须补 `handoffs` 字段。** `packages/schema/src/agent-asset.ts` 当前没有该字段，`asset-bridge.ts:67` 只能从 `config?.handoffs` 取 —— 所以经资产工作室创建的 agent 根本无处填写 handoff。这是该功能至今无人使用的真正原因，而不是功能不被需要。

**`file-loader.ts:61-64` 的 filter 只校验 `label/agent/prompt`**，静默丢弃 `send` 与 `model`。`send` 必须做通（两种交互都依赖它）；`model` 与模型选择 owner 纠缠，本轮不做，登记技术债。

**切片归属**：S3 = handoff 走 switchAgent+prompt、fork modifier 改 typed 拒绝、提权判定、`send` 兑现、修 file-loader；schema = `agent-asset.handoffs`；S6 = Builder handoff 编辑器 + HandoffButton 提权明细与三态 + break-glass 例外；**S2 不涉及**。

过渡期（S3 GREEN 前）唯一允许的中间状态：服务端对携带 modifier 的 fork 返回稳定 typed error，App/TUI 同步禁用 handoff。禁止 2xx 成功后忽略字段。

### D14：Session share 术语和 owner

**推荐**：拆分：

- `SessionPublication.shareLink/unshareLink`：公开链接；
- `SessionContextShare.shareInto`：Session → Session 上下文。

legacy `/session/:id/share` 只能调用前者；canonical `/api/session/:id/share` 只能调用后者。

---

## 7. 分阶段 TDD 工作流

## S0：冻结五模式行为矩阵与协议 RED

### 目标

在修改生产代码前，把已确认缺陷和 D1–D14 变成可执行 RED。

### RED 矩阵

#### 五模式 × runtime/capability/operation

```text
chat / coding / work / assistant / custom
×
create / read / prompt / command / shell / switchAgent / switchModel
/ interrupt / wait / compact / share / fork / resume
×
legacy surface / canonical surface
×
capability present / missing
×
kill switch on / off
```

断言：

- session missing 才是 404；
- capability missing 是 typed unsupported；
- runtime disabled 是 typed disabled；
- operation-specific policy；
- typed rejection 不调用 provider、不写 event、不改 row。

#### Custom root/child consumer matrix

- root 只见 `orchestrator`。
- child 只见 `agents/<frozen-consumer-key>`，展示名含空格、点或中文时 key 仍稳定且不碰撞。
- 两个 child 互不见 Prompt/Skill/Command/agent instructions。
- unbound asset 不可见、不可加载、不可执行。

#### Baseline 探针

- `prompt_async` 多 text/附件/messageID 当前失败。
- Skill admission 后推进时钟再 drain 当前失败。
- `SessionEvent.Durable` 当前不能 decode `SyntheticAdmitted`。
- Start/Upgrade 当前打开新 Draft。
- handoff 传 `prompt/agent` 后 child 当前没有对应 durable selection/prompt admission。
- Custom Preview 单文件、独立进程测试的 Router/client-only 失败或全局 mock 泄漏必须有可重复证据。

### 本 Slice 禁止修改生产代码

只允许：

- 新增/修订 RED；
- 记录真实命令与失败摘要；
- 修正计划中已过时的 owner/行号。

### 停止条件

若关键 RED 在未改生产代码前通过，说明假设过时；暂停并修订计划。

---

## S0.5：测试解锁——先移除 false contract 与测试污染

### 目标

在触及 S6、ModeWorkspace 或 Custom Preview 生产 owner 前，先删除“源码包含某字符串”式伪契约和跨测试进程状态泄漏，避免已有 bug 被测试钉死。

### RED

1. 对 `mode-launch-contract.test.ts`、`location-owner-contract.test.tsx` 及相邻源码字符串测试，逐项证明其断言的是实现文本而非用户行为。
2. 将 `custom-preview-column.test.ts` 以**单文件、独立 Bun 进程**运行；记录全量 suite 与隔离运行是否分叉，以及相关 `@solidjs/router` mock 的来源。
3. 为导航、Location identity、`classifyPlanFailure` 建立 browser-safe pure owner 或窄集成测试，测试真实输入/输出，不读源码文件。
4. 任何保留的 contract test 都必须断言 public API、可观察 state 或用户行为，不能断言 helper 名称。

隔离运行命令必须从 App 包执行，例如：

```bash
bun --cwd packages/app test --preload ./happydom.ts ./src/components/custom/custom-preview-column.test.ts
bun --cwd packages/app test --preload ./happydom.ts ./src/pages/mode-launch-contract.test.ts ./src/pages/location-owner-contract.test.tsx
```

### GREEN

- 删除或改写会将 `launchModeSession`、Router 实现细节或当前错误导航钉成契约的源码字符串测试；
- `classifyPlanFailure` 从 UI/Router owner 分离到 browser-safe `.ts` owner，或以真实组件边界覆盖；
- 每个 Custom Preview 测试自包含 mock/setup/teardown，互不依赖执行顺序；
- 将修订后的最近测试纳入 S6 文件清单和门禁。

### 验收

- 隔离运行与全量运行的测试结果一致；
- S6 能替换导航/Location owner 而不受源码文本断言阻塞；
- 不新增全局 mutable mock、fixed sleep 或 test-only production catch。

---

## S1：Consumer-scoped Snapshot Runtime 与单一 Frozen Graph

### 目标

将 Snapshot 收敛为完整、可识别版本的 frozen consumer runtime graph；只让新 graph 的 Runtime 消费 per-consumer view，同时为 V1 与 pre-binding V2 保留显式兼容路径，消除 `resolve()` → `freeze()` 二次读取 live assets 的 TOCTOU。

### RED

优先扩展最近 owner tests：

- `packages/core/test/composition-resolver.test.ts`
- `packages/core/test/session-runner-custom-composition.test.ts`
- `packages/core/test/custom-child-provider-turn.test.ts`
- `packages/core/test/composition-skill-catalog.test.ts`
- `packages/core/test/session-composition.test.ts`

至少覆盖：

1. root provider request 只包含 orchestrator 的 agent/system instructions、Prompt、Skill、Command。
2. child provider request 只包含自身 frozen consumer view。
3. 展示名包含 Unicode/空格/点的 Agent 仍获得唯一、稳定、可持久化 consumer key；不得被 key validation 拒绝或碰撞。
4. Skill guidance/tool/steer promotion 和 Command runtime 都读取同一 consumer view。
5. 对标记为完整 graph 的新 Snapshot，empty binding 返回空；缺 consumer/mapping 返回 typed fail-closed，绝不 fallback flat arrays。
6. V1 和 pre-binding V2 走可观察、明确的 legacy compatibility view，不能被默认 `{}` bindings 误判成新空 catalog。
7. 新 Snapshot 未承载 agent instruction 或 binding instructions 时 decode/resolve fail closed，不能静默丢 system prompt。
8. same asset 可绑定多个 consumer，但每个 consumer 独立可见。
9. resolve 与 freeze 之间修改/删除 Prompt/Skill/Command，不得产生半空 Snapshot。
10. Command conversion 保留完整字段，MCP stale revision 进入 Health 明细。

### GREEN

1. 在 Core Composition 近邻 owner 建立 `CompositionRuntimeView`（最终命名以 S-1 owner map 为准），输入 Snapshot + Session root/child identity，输出当前 consumer 的完整 frozen view。
2. 为新 graph 增加可识别的 version/marker；不得以 `bindings` default `{}` 推断新旧语义。
3. 将稳定 `consumerKey` 与 display name 分离，resolve/freeze 时唯一确定并冻结。
4. Resolver 一次解析生成完整 frozen graph；freeze 只持久化，不再回查 live asset service。
5. Runner、SkillGuidance、SkillTool、Skill promotion 和 Command runtime 只共用该 view。
6. flat projection 由 frozen graph 确定性派生，仅给 backward decode/API read compatibility；V1/pre-binding V2 只走显式 compatibility owner。

### REFACTOR

- 归并两份 CommandAsset → CommandInfo conversion。
- 复用 Schema `Prompt.equivalence`，删除重复 JSON stringify equality。
- 复核不可达 `invalid_ref_kind` 防御；仅在证明所有入口经过 Schema decode 后删除。
- 不删除 Plugin 仍消费的 legacy Command owner。

### 验收

- Core focused tests 全绿。
- Snapshot digest/compat decode 不漂移，且 legacy/new Snapshot 的识别可观测。
- 新 consumer-runtime Snapshot 的 Runtime 无读取 flat `instructions/prompts/skills/commands`；V1/pre-binding V2 不通过 live/global fallback 获得新能力。

## S2：Durable Admission Kernel 与 Atomic Submission

### 目标

建立 Core-owned、typed、原子的 durable submission，统一 Prompt/Shell/Skill/Synthetic/Command admission 的等价、冲突、投影和 wake 边界。

### RED

优先扩展：

- `packages/core/test/session-prompt.test.ts`
- `packages/core/test/session-shell.test.ts`
- `packages/core/test/session-projector.test.ts`
- `packages/core/test/session-runner.test.ts`

表驱动覆盖：

1. Prompt/Shell/Skill/Synthetic/Command exact retry。
2. 同 ID 跨 Session、kind、delivery 或 payload 冲突。
3. historical projected prompt retry。
4. visible history collision。
5. selection + Prompt + N synthetic 全成功后只 wake 一次。
6. 任一 synthetic conflict/failure → 零部分 row/event/selection mutation。
7. concurrent exact retry 只提交一个 batch。
8. `resume:false` 完整 admission 后不 wake。
9. provider crash 前后不重新 admission。
10. 每个 durable write 边界做故障注入。
11. transaction 内多 admission/event write 不触发 EventV2 跨连接 deadlock。
12. commit 前无 wake/consumer 可见的“已提交”状态；post-commit publish/wake 失败可幂等补偿，且不会伪造 admission 失败。

### GREEN

1. 内部归并 discriminated admission kernel，但保持 typed 外部 API。
2. batch 复用 `SessionV2` equivalence + conflict 合同；禁止 handler 直接用裸 `SessionInput.admit*` 判 exact success。
3. transaction 只提交 selection、durable inputs 和 durable events；commit 后才调用 publish 与 `SessionExecution.wake(sessionID)`。
4. post-commit delivery 具幂等 identity/重试边界；不得用跨连接 EventV2 publish 参与 admission transaction。
5. deterministic synthetic IDs 由主 message ID + 稳定序号/内容 identity 派生。
6. batch identity 包含 Session、selection、Prompt/Command、delivery 和 synthetic order。

### REFACTOR

- 删除各 kind 重复的 insert/select/retry 流程，仅保留 kind-specific payload。
- 统一 tagged error message。
- 日志只记录 ID、kind、数量和 operator ref，不记录 prompt/file 内容。

### 验收

- 不新增第二个 execution loop。
- `SessionExecution` 仍只接收 Session ID。
- 同一 Session drain serialization 和不同 Session 并发不变量保持。

---

## S3：Policy、Mutation、Event 与 Timestamp Correctness

### 目标

在 durable mutation 前完成五模式 typed policy；修复 Skill timestamp、Synthetic event union 和 selection round-trip。

### RED

1. 五模式 Agent switch table：允许/拒绝集合按正式协议。
2. Custom root 只能 `meta`；Custom child 只能 frozen pool agent。
3. 非法 switch：零 `AgentSwitched`、零 row update、零 provider call。
4. `enforcePrimary` 等正常拒绝出现在 typed error channel，不是 defect。
5. Skill `resume:false` → 推进 TestClock → drain 成功。
6. `SyntheticAdmitted` 可由 Durable/All decode，并出现在 `SessionV2.events()`。
7. model variant 缺省/显式 DB round-trip。
8. kill switch 对 admission/resume/provider turn 的统一矩阵。

### GREEN

- policy 分为 capability、runtime、operation、agent、command/shell 五类。
- mutation owner 先 policy 后 event。
- Runner 保留 defense in depth，但不是首次拒绝点。
- Skill promotion 使用 `admitted.timeCreated`。
- `SyntheticAdmitted` 加入 Durable/All。
- 明确 `undefined` 与显式 `default` variant 的协议语义。

### REFACTOR

- 删除粗粒度 `checkCommandAllowed`，拆 Shell/legacy Command/Snapshot Command policy。
- 删除过时 M1/M2 policy 文案。
- 证明后删除仅测试消费的死 helper。

---

## S4：Legacy Prompt Adapter 与 Attachment Materialization

### 目标

建立唯一 legacy PromptPayload → canonical durable submission 适配器，并保证附件不仅“写入了”，还能够被 Runner/provider 消费。

### RED

AigcForge/HTTP：

1. 多普通 text 顺序稳定。
2. synthetic 与普通 text 分离。
3. explicit `messageID` 保留。
4. file/image/PDF、filename、mime、source/selection 保真。
5. Agent mention/source 保真。
6. 空 text + attachments 合法；真正空 payload typed 400。
7. model/variant selection 在 wake 前 durable。
8. Custom 非 `meta` root typed reject。
9. Snapshot missing/decode、disabled、conflict 不再 204。
10. 任何 204 返回前 durable submission 可读取。

Provider lowering：

1. `file://` 不直接进入 provider base64 validator。
2. text file 按已有 read/materialization 语义变成文本上下文。
3. image data URL canonical 化。
4. PDF 按 provider 支持矩阵显式支持或 typed reject。
5. MCP resource blob 大小/MIME 规则保持。
6. remote/managed URI 未实现时 fail typed，不悄悄当 media bytes。
7. logs 不包含原文、data URL 或 base64。

### GREEN

1. 从 `SessionPrompt.createUserMessage` 的既有 part resolution/normalization 提取近邻可复用 owner。
2. V1 path 和 legacy→V2 adapter 共用，不复制第二份 mapping。
3. materialization 位于具有 Location/FileSystem/MCP service 的 effect boundary。
4. canonical Core Prompt 只接收 provider-lowerable data 或明确可延迟解析的 typed URI。
5. handler 删除 first-text cast/find 和 `Effect.ignore`。

### REFACTOR

- `globalThis.AI_SDK_LOG_WARNINGS` 不迁入新模块；单独迁移 typed bootstrap 或记录技术债。
- 复核 V1→V2 dual-write：若保留，必须复用客户端 message identity；若删除，先证明无消费者并记录退出条件。

---

## S5：Snapshot Command Fidelity、Runtime、API 与 Composer

### 目标

闭合：

```text
CommandAsset
→ frozen consumer binding
→ durable command admission
→ static expansion
→ canonical Prompt/context
→ Runner
```

### RED

#### Snapshot fidelity

- 冻结 `name/description/relativePath/revision/invocation/args/source`。
- 同一 Command 可绑定多个 consumer，但互不泄漏。
- asset 修改/删除后既有新 Snapshot 行为不变。
- 旧 Snapshot Command fail closed。

#### 参数解析

- 单引号、双引号、Unicode、空参数。
- `$1..$N`。
- 最后一个 positional placeholder 消费剩余参数。
- `$ARGUMENTS` 保留 raw arguments。
- 无 placeholder 追加 arguments。
- 缺参/多参/schema 不匹配 typed reject。
- Shell fence 保持文本或 fail closed，绝不执行。
- subtask、agent/model override 不进入 Custom runtime。

#### Durable runtime

- explicit message ID exact retry。
- 同 ID 改 command/args/context/consumer/delivery → 409。
- unbound/global/ambiguous command fail closed。
- Command 不增加 Tool/Permission。
- Shell 仍拒绝。

#### App

- Slash popover 读取当前 Session Snapshot consumer catalog。
- immediate 与 queued followup 复用一个 parser/sender。
- Command 完整保留 files/agents/comments/synthetics。
- Snapshot panel 展示 Command 和 consumer binding。

### GREEN

- Schema 新增 command admission/frozen fields，保持 backward decode。
- Core runtime 只使用 Composition Runtime View。
- canonical endpoint 加在 `packages/server`。
- legacy `/command` 不改变同步 V1 合同。
- App 不再只查 `sync().data.command` 判断 Custom Snapshot Command。

### REFACTOR

- 删除两处 `images.map(...)` command adapter。
- 删除重复 `text.split(" ")` parser。
- 保留 Builder binding UI；删除的是“绑定后必拒绝”的 runtime path 和源码字符串测试。

---

## S6：App Location、Draft、Provider、Navigation 与 Snapshot Round-trip

### 目标

统一 App Location owner，并把 Snapshot 视为可逆冻结契约，而不是展示 DTO。

### RED

#### Draft Location

1. 同 Server 不同 Directory 隔离。
2. 不同 Server 相同 Directory 隔离。
3. directory 空→真实值不创建/迁移空 key。
4. Sidebar/Main 同一 Provider。
5. dispose 后旧 store 不复用。
6. A→B→A 恢复各自 Draft。
7. legacy key 单次迁移、不 fan-out。

#### Provider Location

- New Session Draft 使用 `sdk.directory`。
- Draft project 切换后 Provider/model 列表切换。
- Server A/B 同目录不共享 Provider。
- child fallback 对 global provider 更新保持 reactive。
- 不重复启动只用于 loading、却不消费数据的 query。

#### Start/Upgrade navigation

- Start 返回 Session A → 打开并选中 A。
- Upgrade 返回 Session B → 打开并选中 B。
- `mode-launch-contract.test.ts`、`location-owner-contract.test.tsx` 的替代行为测试不依赖 `launchModeSession` 字符串。
- 成功路径不调用 `tabs.newDraft`。
- placement 使用返回 Session 的真实 Location。
- 导航失败后可从列表恢复，不重复创建 Session。

#### Snapshot round-trip

```text
Snapshot V2 → loadFromSnapshot → toCompositionInput → Plan
```

保持 Agent/Workflow/Prompt/Skill/Command refs、revision、consumer binding、capabilities。

V1 缺 refs 时 fail closed，不伪造空 revision。

#### UI 状态

- plan loading/error/undefined/no digest/blocking → Start disabled。
- asset partial failure 显示 typed error + Retry，不显示 empty。
- Snapshot 404/网络/decode 分开。
- Starter Agent 要么创建真实资产取得 revision，要么删除按钮。

### GREEN

- 以新 Location identity key 替换 `sharedStores`：先迁移/标记/验证，再在无生产消费者后删除旧 Map。
- Custom 上层只保留一个 Provider。
- 复用 `Persist.serverWorkspace(...)` 和统一 Location identity。
- `useProviders` 消费 SDK/Location owner，不解析 Router 作为事实源。
- Start/Upgrade 复用 exact-session open owner。
- 删除无 Runtime 意义的 `primaryAgent` 状态/UI/tests。

### REFACTOR

- persisted decode/migration 边界一次补齐 `commands` shape，删除 toggle 中多处 `commands ?? []`。
- 统一 AssetRef ↔ Draft conversion。
- render-all 若保留，只保留 UI state；网络/SDK/Persist effect 受 active signal 控制。

### UI 验收

- v2 token；
- light/dark；
- en/zh/zht 与英文 fallback；
- keyboard/focus；
- loading/empty/error/partial-error；
- narrow viewport；
- 模式切换无错误 remount/状态串线。

---

## S7：Canonical API、Legacy Adapter、Error、Share、Profile 与 SDK/OpenAPI

### 目标

消除 canonical/legacy 双 owner 漂移，形成单一 API application service 和可再生 SDK contract。

### RED

#### Capability/operation

- 缺 Custom capability → typed unsupported，不是 404。
- runtime disabled → typed disabled。
- session missing → 404。
- canonical/legacy 对相同能力保持 parity。

#### Fork / handoff

- App 与 TUI 传 `prompt/agent` 的 handoff 当前必须 RED：child 创建后不存在对应 durable selection/prompt admission。
- 若产品选择原子实现：fork、selection、Prompt/synthetic、post-commit wake 必须具有可观察的单一 durable contract，失败不遗留半完成 child。
- 若产品选择端到端移除：Schema/OpenAPI/SDK、App/TUI、HandoffButton 与配置必须一并消失并通过编译/行为测试。
- 裁决前：携带 modifier 的请求返回 typed unsupported/validation error，绝不 2xx 忽略字段。

#### Share

- legacy share 生成 URL，不产生 synthetic self-injection。
- share/unshare 对称。
- canonical context share 只写目标 Session。

#### Custom create/profile

- resolve 422；CAS/conflict 409；missing 404；I/O/rollback typed 500。
- unknown defect 不伪装 4xx。
- Custom profile 的 sessionID/Location owner 按批准策略真实生效。
- directory + workspaceID 隔离。
- invalid asset kind 使用统一 Schema typed 400。

#### OpenAPI/SDK

- canonical/compatibility 使用显式 annotation，不用路径前缀猜测。
- request body required/optional 语义测试。
- `missing !== null` semantic tests。
- operation ID 唯一。
- error response union 与 endpoint 声明一致。
- security scheme/reference 与运行时 middleware 一致。
- `bun ./script/generate.ts` 重建 tracked OpenAPI 与 V2 gen；运行前后记录 generated diff。
- V1 `src/gen` 必须在 S-1 ledger 明确为“有再生 owner”或“冻结/迁移中的兼容产物”；未裁决不得宣称三产物一次命令重建。
- tracked spec 的历史漂移刷新单独 commit 审查，不与行为变更混合。
- generation patch 精确命中一次。

### GREEN

1. `packages/server` 持有 canonical V2 endpoint 和 shared error mapping。
2. `packages/aigcfroge` 只做 legacy decode/response adapter。
3. capability、runtime、operation policy 分离。
4. custom composition/profile 复用完整 `Location.Ref`。
5. external publication 与 context share 拆 owner/命名。
6. OpenAPI pipeline 使用 explicit surface metadata，并把 tracked spec、V1 gen、V2 gen 的 owner/再生策略写入 ledger。

### REFACTOR

- 归并 legacy/canonical 重复错误 mapper 和 schema middleware；兼容层可保留 legacy shape，不复制 domain error family。
- 归并 V1/V2 SDK client transport；消除 `any/@ts-ignore` timeout hack，或记录 generator/runtime 限制。
- 删除 no-op OpenAPI workaround 前先用最小复现证明上游已修。

---

## S8：测试体系收敛与覆盖扩展

### 目标

在 S0.5 已解除 false contract 的基础上，补齐跨层用户行为、错误态、并发和 Playwright 主路径；不再验证源码形状。

### 必改

1. 审计本代码族剩余源码字符串测试；只有行为等价的 public contract 才可保留。
2. `submit.test.ts` 使用记录真实 payload 的窄 fake，不 broad mock 全模块。
3. Provider/Location 用窄集成测试，真实 Solid owner/dispose。
4. Preview count/filter/grouping 测试必须调用 production pure owner，不复制实现。
5. 任何 Custom Preview 测试必须独立进程可运行，setup/teardown 不依赖兄弟测试泄漏。
6. 新测试优先扩展最近 owner 文件；新建文件必须在 S-1 ledger 说明原因。

### Playwright 主路径

至少增加：

- Custom Composer text/file/image/agent/comment；
- admission error/409 可见且不假成功；
- Snapshot Command popover/submit/unbound deny/Shell deny；
- Start/Upgrade 打开准确 Session；
- Server A/B 相同目录 Draft 隔离；
- asset partial error + Retry；
- handoff 选择后的真实成功路径，或 disabled/removed 的可见路径；
- light/dark、窄屏、en/zh/zht 主流程。

### 并发测试

使用：

- `pollWithTimeout`；
- `awaitWithTimeout`；
- `llm.wait(n)`；
- Event/Bus + Latch；
- Deferred + timeout。

禁止 fixed sleep。

## S9：删除、归并、注释与文档同步

### 9.1 可删除候选

只在 RED/GREEN、S-1 消费者证据和兼容退出条件都满足后删除：

- legacy handler first-text cast/find 和 `Effect.ignore`；
- 无 Runtime 意义的 `primaryAgent` 状态/UI/tests；
- command 两处 image-only adapter 和重复 parser；
- test-only missing GlobalProvider catch；
- asset discovery 失效外层 catch；
- 未使用 `refetchAssets?`；
- fake Starter Agent button（若不实现真实创建）；
- 已被 S0.5 替代的源码字符串行为 tests；
- persisted migration 完成后的重复 `commands ?? []`；
- 证明仅测试消费的 dead helper，例如 `isV2Mode`；
- 证明无消费者的重复 Source 类型。

### 9.2 必须迁移/替换后才能删除

- `sharedStores`：先迁移至 Server + normalized directory + workspaceID 的 key、写 migration marker、验证 Sidebar/Main 单 owner 和 legacy key 清理条件；随后删除旧 Map，不把它误报为真死代码。
- CustomDraftProvider：只有证明确实存在重复 Provider、且替代 owner 已覆盖所有调用方时才合并/删除。
- V1/pre-binding Snapshot flat projection：新 runtime graph 覆盖、兼容读取和退出版本全部满足后才考虑物理删除。
- V1 SDK gen：只有明确 generator owner 或兼容终止计划后才能移除。

### 9.3 必须归并

- Prompt/Command Composer context normalizer；
- Durable admission kernel；
- Composition Runtime View；
- Command frozen conversion；
- SkillInfo → CustomDraftSkill；
- Location identity；
- Provider query/selector；
- exact-session navigation；
- typed asset resource state；
- domain error → canonical/legacy transport mapping；
- SDK transport/generation pipeline。

### 9.4 暂不得删除

- Plugin 仍消费的 legacy Command owner；
- legacy command/skill first-run migration；
- V1→V2 dual-write，直到 S-1 证明消费者和退出条件；
- `invalid_ref_kind` 等防御分支，直到证明所有入口 Schema-decode；
- Snapshot flat fields 的 backward decode；
- 历史 ADR 的论证正文。

### 9.5 注释治理

本计划只治理触及和邻接 owner：

- 新增/修改生产注释统一使用必要、简洁英文；
- 中文用户文案保留在 i18n，不受此规则影响；
- 删除显而易见控制流注释；
- 删除 `HIGH-*`、`MEDIUM-*`、`re-review`、`M1/M2` 等不可追溯审计编号；
- 日期/计划章节讨论移到 ADR/plan；
- 保留 non-obvious fail-closed、timestamp、transaction、Location 约束。

触及候选包括：

- `packages/core/src/product-mode-agent-policy.ts`；
- `packages/aigcfroge/src/session/prompt.ts`；
- `packages/aigcfroge` legacy Session HttpApi；
- `packages/server/src/handlers/session.ts`；
- App Composer/Location owner 邻接文件。

### 9.6 文档同步与 issue/PR 关联

至少复核并同步：

- `CLAUDE.md`；
- `AGENTS.md`；
- `ARCHITECTURE.md`；
- `CONTEXT.md`；
- `DESIGN.md`；
- `docs/testing.md`；
- `docs/technical-debt.md`；
- ADR-11～21 的 current/superseded status note；
- `docs/architecture/pages/mode-switcher.md`；
- `docs/architecture/pages/coding.md`；
- `docs/architecture/pages/work.md`；
- `docs/architecture/pages/custom-assistant.md`；
- Custom/Assistant/Work PRD 与 roadmap；
- `.aigcfroge/skills/protocols/SKILL.md`。

文档按其类型更新，不能一条“历史正文不重写”规则覆盖全部：

| 文档类型             | 更新规则                                                              |
| -------------------- | --------------------------------------------------------------------- |
| ADR                  | 保持历史论证，只补 current/superseded note，不回写当时决策。          |
| 技术债台账           | 遵守其自身规则：闭环项移入“已闭环”表，记录日期、提交和关联 issue/PR。 |
| 协议/架构/页面主文档 | 更新当前事实；失效操作指引不得继续作为现行规则。                      |
| 实施计划             | 保留决策轨迹，标记 accepted/rejected/superseded 和对应证据。          |

每个实施 PR 按 `CONTRIBUTING.md` 建立或关联 issue/PR；即使 CI 因成员白名单未拦截，也不得把“未拦截”当成免除流程。

## S10：全量回归、故障注入与交付审查

### 五模式回归矩阵

| 能力                    | Chat                   | Coding           | Work                   | Assistant                   | Custom                       |
| ----------------------- | ---------------------- | ---------------- | ---------------------- | --------------------------- | ---------------------------- |
| root agent policy       | meta/chat-orchestrator | 协议允许集合     | meta/work-orchestrator | meta/assistant-orchestrator | root=meta；child=frozen pool |
| prompt admission        | 保真                   | 保真             | 保真                   | 保真                        | 保真 + Snapshot              |
| shell                   | deny                   | 保持现状         | deny                   | 保持现状                    | deny                         |
| legacy command          | deny                   | 保持现状         | deny                   | 保持现状                    | deny                         |
| Snapshot command        | N/A                    | N/A              | N/A                    | N/A                         | consumer-scoped static only  |
| Skill catalog           | mode policy            | mode policy      | mode policy            | mode policy                 | consumer-scoped Snapshot     |
| Draft/Provider Location | server+directory       | server+directory | server+directory       | server+directory            | server+directory+workspace   |
| capability missing      | typed                  | typed            | typed                  | typed                       | typed unsupported            |
| kill switch             | N/A/协议               | N/A/协议         | N/A/协议               | N/A/协议                    | execution fail closed        |

### 故障注入

- resolve/freeze 之间资产修改/删除；
- Snapshot missing/decode/corrupt；
- 第 N 个 synthetic insert 失败；
- concurrent exact/conflicting retry；
- event publish 成功、projection/transaction rollback；
- wake 失败；
- skill admission 与 promotion 跨时钟；
- file read/MCP resource/provider media failure；
- workspaceID mismatch；
- asset partial API failure；
- Start 成功后 navigation failure；
- OpenAPI generation patch 0 次或多次命中；
- SDK generated required/nullability drift。

### 性能/生命周期

- ModeWorkspace 隐藏 slot 不产生额外网络/Persist/SDK effect；
- Global/Server/Directory Solid owner dispose；
- Session drains 无额外 provider turn；
- Prompt/Command normalizer 不重复读取文件；
- App Composer/Timeline 改动运行 `test:bench` 并记录相对基线，不设机器相关硬阈值。

---

## 8. 建议文件与代码族变更范围

### Schema

- `packages/schema/src/composition.ts`
- `packages/schema/src/session-input.ts`
- `packages/schema/src/prompt.ts`
- `packages/schema/src/command-asset.ts`
- `packages/schema/src/product-mode.ts`
- 相关 schema tests/changelog

### Core

- `packages/core/src/composition-resolver.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/input.ts`
- `packages/core/src/session/event.ts`
- `packages/core/src/session/projector.ts`
- `packages/core/src/session/composition.ts`
- `packages/core/src/session/runner/llm.ts`
- `packages/core/src/session/runner/to-llm-message.ts`
- `packages/core/src/skill/guidance.ts`
- `packages/core/src/tool/skill.ts`
- `packages/core/src/skill/composition-catalog.ts`
- `packages/core/src/product-mode-agent-policy.ts`
- 最近 owner tests

### Canonical Server

- `packages/server/src/groups/session.ts`
- `packages/server/src/handlers/session.ts`
- `packages/server/src/errors.ts`
- middleware/API annotations

### Legacy AigcForge Adapter

- `packages/aigcfroge/src/session/prompt.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts`
- custom composition/profile groups/handlers
- workspace routing/error middleware
- server tests/httpapi exercise

### SDK/OpenAPI

- `packages/sdk/openapi.json`
- `packages/sdk/js/script/build.ts`
- `packages/sdk/js/src/gen`
- `packages/sdk/js/src/v2/gen`
- V1/V2 client transport

### App

- `packages/app/src/components/prompt-input/build-request-parts.ts`
- `packages/app/src/components/prompt-input/submit.ts`
- Slash popover owner
- `packages/app/src/context/custom-draft.tsx`
- Custom builder/sidebar/preview/snapshot panels
- `packages/app/src/hooks/use-providers.ts`
- ModeWorkspace/Location owner
- exact-session navigation owner
- related unit/E2E tests

### Docs/Skills

按 S9.6 清单。

---

## 9. PR 与提交切片

实施时不在 `main` 直接开发。分支名遵守最多三个单词、短横线、无 slash。

推荐拆分：

1. `test-contract-release`
   - `test(app): replace false source contracts`
2. `composition-runtime-view`
   - `refactor(core): add consumer snapshot runtime view`
3. `durable-admission`
   - `refactor(core): unify durable session admission`
4. `mode-policy-errors`
   - `fix(core): reject invalid mode mutations before persistence`
5. `prompt-admission`
   - `fix(aigcfroge): preserve async prompt submissions`
6. `custom-command-runtime`
   - `feat(core): admit snapshot commands durably`
7. `custom-location-owner`
   - `fix(app): scope custom state to location`
8. `mode-api-contracts`
   - `fix(server): align session capability contracts`
9. `sdk-spec-refresh`
   - `chore(sdk): refresh tracked OpenAPI contract`
   - 仅在 S-1 明确 V1/V2 生成策略后提交，单独审查 generated diff。
10. `mode-test-cleanup`
    - `test(app): extend behaviour coverage`
11. `mode-doc-sync`
    - `docs: synchronize five-mode runtime contracts`

每个 PR：

- 只包含一个根因族；
- 不把行为修复和大规模 namespace/import cleanup 混在一起；
- 提交真实 RED/GREEN 证据；
- generated diff 单独审查；
- 不提交 unrelated user changes。

---

## 10. 验证命令

> 测试不得从仓库根运行；`--cwd` 后不要加 `run`。

### Schema

```bash
bun --cwd packages/schema test
bun --cwd packages/schema typecheck
```

### Core focused

```bash
bun --cwd packages/core test test/composition-resolver.test.ts --timeout 30000
bun --cwd packages/core test test/session-runner-custom-composition.test.ts --timeout 30000
bun --cwd packages/core test test/custom-child-provider-turn.test.ts --timeout 30000
bun --cwd packages/core test test/session-prompt.test.ts --timeout 30000
bun --cwd packages/core test test/session-projector.test.ts --timeout 30000
bun --cwd packages/core test test/custom-mode-security.test.ts --timeout 30000
bun --cwd packages/core typecheck
```

### Canonical Server / Legacy HTTP

```bash
bun --cwd packages/server typecheck
bun --cwd packages/aigcfroge test test/server/httpapi-promptasync-context.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-session.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/v2-session-capability.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-custom-composition.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-custom-profile.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-public-openapi.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-session-adapter.test.ts --timeout 30000
bun --cwd packages/aigcfroge typecheck
```

### HttpApi exercise

硬门禁：

```bash
(
  cd packages/aigcfroge
  bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
  bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip
)
```

当前 CI advisory，必须记录但 main 既有失败不自动归因于本 PR：

```bash
(
  cd packages/aigcfroge
  bun run script/httpapi-exercise.ts --mode effect
)
```

### App

```bash
bun --cwd packages/app test:unit
bun --cwd packages/app test:virtualizer
bun --cwd packages/app test:e2e <affected-spec>
bun --cwd packages/app typecheck
bun --cwd packages/app build
```

性能敏感 Composer/Timeline/ModeWorkspace：

```bash
bun --cwd packages/app test:bench
```

### SDK/OpenAPI

先在干净工作树或独立 generated commit 中运行：

```bash
bun ./script/generate.ts
bun --cwd packages/sdk/js typecheck
git diff -- packages/sdk/openapi.json packages/sdk/js/src/gen packages/sdk/js/src/v2/gen
```

`script/generate.ts` 当前会重建 tracked OpenAPI 与 V2 gen；V1 `src/gen` 在 S-1 未裁定“可再生 / 冻结 / 迁移”前，不得把上述 diff 误称为三产物零漂移门禁。

对已完成且提交的生成链，重新在干净树运行其完整 owner command 后才可以使用：

```bash
git diff --exit-code -- \
  packages/sdk/openapi.json \
  packages/sdk/js/src/gen \
  packages/sdk/js/src/v2/gen
```

### 文档、格式与最终门禁

```bash
npx prettier --check docs/plan/five-mode-runtime-remediation-tdd-workflow-2026-08-30.md
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bun run lint
bun typecheck
git diff --check
git status --short --branch
```

若 UI story 新增或修改，再运行对应 Storybook build；不要把当前不存在的 story coverage 伪装成已执行门禁。

---

## 11. 每个 Slice 的 RED→GREEN 证据模板

```text
Slice:
基线提交:
影响代码族:
canonical owner:
compatibility owner:

S-1 EVIDENCE:
- definitions:
- callers:
- registrations:
- persistence:
- nearest tests:
- keep/reuse/delete/merge decision:

RED:
- 新增/修改测试:
- 未改生产代码时命令:
- 实际 pass/fail/assertion:
- 原始失败摘要:
- 是否命中预期根因:

GREEN:
- 最小实现:
- 同一测试命令:
- 实际结果:
- durable/event/API/App 最终状态:

REFACTOR:
- 删除代码:
- 归并 owner:
- 保留兼容代码及原因:
- 重构后复跑结果:

门禁:
- package tests:
- package typecheck:
- HTTP exercise:
- App E2E/build:
- SDK/OpenAPI diff:
- lint/protocol/diff-check:

改完即审:
1. 影响文件
2. 命中协议/skills
3. 安全门禁
4. 工程门禁
5. 数据流追踪
6. 已运行命令和真实结果
7. 剩余风险/技术债
```

不得写“应该通过”“理论上没问题”。

---

## 12. 停止条件

出现以下任一情况必须暂停并请求审批：

1. 需要改变 Custom root=`meta` 或 V2 durable admission/execution 分离不变量。
2. 需要让 Snapshot Command 执行 Shell、子进程、subtask 或绕过 Permission。
3. 需要从 live/global catalog 补救 Snapshot 未绑定/旧 Command。
4. 需要把 Session ID 注入 Location Layer或创建平行 Runner。
5. 原子 Durable Submission 无法在现有 transaction/event boundary 实现。
6. 需要让旧 Snapshot 自动获得创建时不存在的执行能力。
7. 需要 fan-out legacy global Draft。
8. 测试只能依赖固定 sleep、全局 mutable mock 或源码字符串。
9. canonical/legacy API owner 无法收敛。
10. OpenAPI/SDK 的 tracked spec、V1 gen、V2 gen 无法明确 owner、再生或冻结/迁移策略。
11. RED 失败原因与计划不同。
12. 发现新的共享 P0/P1 且跨越当前 Slice。
13. 需要删除未证明无消费者的 migration、Plugin Command 或兼容 Schema。
14. 用户数据/Prompt/base64 可能进入日志或测试快照。

---

## 13. 回滚策略

### Snapshot Runtime View

- 新 Runtime 只切换读取 owner，不改旧 Snapshot 数据。
- 回滚时保留 V1/pre-binding V2 的显式 compatibility view；不得重新启用跨 consumer flat fallback 作为“临时修复”。
- 新 graph 的 version/marker 保持可识别；不得把缺失 bindings 默认成新语义的空 catalog。

### Durable Submission

- 新 Schema/migration 必须可 backward decode。
- 回滚不能丢已 admission input；旧版本若不能理解新 command kind，必须在 rollout 前使用 capability/version gate。

### Prompt Adapter

- legacy endpoint 保留；任何回滚都不得恢复“204 丢数据”。
- attachment materialization failure 必须 typed 返回，不降级为 silent no-op。

### Command

- 独立 capability/version gate；关闭后只禁用 Snapshot Command，新旧 Prompt/Skill 不受影响。
- 旧 Snapshot 始终 fail closed。

### App Draft

- legacy key 在迁移成功和写标记前不删除。
- 回滚不得把多个 workspace Draft 合并回 global key。

### SDK/OpenAPI

- generated artifacts 与服务端 commit 同 PR/同版本发布。
- 不能只回滚生成物或只回滚服务端。

---

## 14. Definition of Done

### Composition / Consumer

- [ ] 新 consumer-runtime Snapshot 只消费当前完整 consumer view。
- [ ] root/child 的 Agent instructions、Prompt、Skill、Command 互不泄漏。
- [ ] display name 与稳定 consumerKey 分离；Unicode 名称不导致不可绑定或碰撞。
- [ ] V1、pre-binding V2、新 graph 可可靠识别；只有新 graph 禁止 Runtime 读取 flat fields。
- [ ] flat fields 仅作 compatibility/API read，不再是新 Runtime owner。
- [ ] resolve/freeze 不产生 TOCTOU 半空 Snapshot。

### Admission / Events / Policy

- [ ] selection + Prompt/Command + synthetic 原子提交。
- [ ] exact/conflict/concurrent retry 有行为测试。
- [ ] commit 后最多一次 wake。
- [ ] Skill promotion 使用 admission timestamp。
- [ ] `SyntheticAdmitted` 出现在 Durable/All/public stream。
- [ ] 非法 switch/policy 拒绝零 durable side effect。
- [ ] 正常策略拒绝走 typed error，不是 defect。

### Prompt / Attachment

- [ ] legacy `prompt_async` 保留 message ID、多 text、附件、Agent、synthetic、model/variant。
- [ ] 纯附件合法，真空 payload typed reject。
- [ ] `file://` 在 provider lowering 前 materialize 或 typed reject。
- [ ] image/PDF/MCP resource 按明确支持矩阵处理。
- [ ] 日志不包含 prompt、base64、文件正文。

### Command

- [ ] Snapshot 冻结完整 Command contract。
- [ ] 旧 Snapshot Command fail closed。
- [ ] Command durable admission 可 exact retry/audit/replay。
- [ ] Slash popover、submit、runtime 使用同一 consumer catalog。
- [ ] Command 保留完整 Composer context。
- [ ] Shell/subprocess/subtask/额外 Permission 始终拒绝。

### App / Location

- [ ] Draft 按 Server + normalized directory + workspace 隔离。
- [ ] Sidebar/Main 单 owner；`sharedStores` 先完成有证据的 key migration/cutover，再删除旧 Map。
- [ ] Provider 使用 SDK Location，不使用 Router 作为唯一事实源。
- [ ] Start/Upgrade 打开后端返回的准确 Session。
- [ ] Snapshot V2 round-trip 保留所有 AssetRef。
- [ ] V1 缺 refs 时 fail closed。
- [ ] `primaryAgent` 假配置已删除或协议化。
- [ ] loading/empty/error/partial-error/Retry 行为完整。

### API / SDK

- [ ] canonical owner 为 `packages/server`。
- [ ] capability/runtime/operation error typed 且状态码稳定。
- [ ] handoff fork modifier 要么原子产生 durable effect，要么与 SDK/App/TUI/Handoff UI 端到端移除；过渡期 typed fail closed。
- [ ] external share 与 context share 语义拆分。
- [ ] custom profile/composition 使用完整 Location identity。
- [ ] OpenAPI/SDK 单一生成链、required/null/security/error semantic tests 全绿。

### Tests / Docs / Hygiene

- [ ] S0.5 已移除/替换会固化缺陷的源码字符串行为测试；剩余契约测试只断言可观察行为。
- [ ] 纯 model tests 不导入 Router/UI。
- [ ] 并发测试无 fixed sleep。
- [ ] package tests/typechecks、App E2E/build、HTTP hard gates 全绿。
- [ ] 触及范围中文/历史审计注释已处理。
- [ ] 删除/归并清单逐项有证据。
- [ ] 根文档、ADR/pages、testing、technical debt、protocols skill 同步；技术债闭环记录日期、提交和关联 issue/PR。
- [ ] protocol refs、lint、`git diff --check`、全仓 typecheck 通过。

---

## 15. 最终审批清单

本方案已经吸收“有条件批准”的全部修订要求。请确认以下事项后，才允许创建实施分支并进入 S-1：

- [ ] D1：synthetic 保持独立 durable admission。
- [ ] D2：采用原子 durable transaction，并以 EventV2 跨连接 publish deadlock 为显式 RED/阻塞点；publish/wake 必须 post-commit。
- [ ] D3：Custom root=`meta`，Agent mention 不切 root。
- [ ] D4：root=`orchestrator`，child=`agents/<frozen-consumer-key>`；display name 与 machine key 分离。
- [ ] D5：先补完整 consumer runtime graph、版本/marker 和 V1/pre-binding V2 compatibility view；仅新 graph 的 Runtime 禁读 flat fields。
- [ ] D6：旧 Snapshot Command fail closed，需 fork/upgrade。
- [ ] D7：Command 使用独立 durable admission kind。
- [ ] D8：Command 支持与普通 Prompt 相同的 Composer context。
- [ ] D9：canonical Command API 位于 `packages/server`；legacy `/command` 不改同步合同。
- [ ] D10：V1 Snapshot 缺精确 refs 时 fail closed。
- [ ] D11：legacy global Draft 只迁移到首个明确 Location，不 fan-out。
- [ ] D12：Custom kill switch 阻止执行型入口，但保留 read/export。
- [x] D13（已裁决 2026-09-01）：handoff 功能保留，改用 `switchAgent` + `prompt`（不 fork）；fork 的 `prompt`/`agent` 字段删除；提权走 `PermissionEffective.effectiveV2` 判定 + 逐工具询问的 `once`/`always`/`reject` 三态；`bash` × `propose` 走 break-glass；`agent-asset.ts` 补 `handoffs`。
- [ ] D14：external share 与 context share 拆分 owner/命名。
- [ ] S-1 owner ledger 已裁定本计划与三个并行计划的 Core/App/ModeWorkspace owner 和合并顺序。
- [ ] SDK/OpenAPI ledger 已裁定 tracked spec、V1 gen、V2 gen 的再生或冻结/迁移策略。
- [ ] S0.5 已完成，false contract 与测试隔离问题不再阻塞 S6。

**建议最终批准语句**：

```text
批准 docs/plan/five-mode-runtime-remediation-tdd-workflow-2026-08-30.md 修订版；
同意 D1–D14 的修订表述，并授权先执行 S-1、S0、S0.5 的只读证据扫描和 RED 测试。
在 owner ledger、Snapshot compatibility、handoff 产品裁决、SDK generation ledger、
以及测试解锁均提交真实证据前，不得进入任何生产代码 GREEN，也不得创建平行 owner。

后续每个 Slice 必须提交真实 RED→GREEN 证据、删除/归并清单、关联 issue/PR、
包级门禁结果和 generated diff 审查；不得回退到 live/global Snapshot 兜底、
legacy Runner、2xx 忽略 handoff modifier 或无边界全仓清理。
```
