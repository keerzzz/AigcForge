# Custom Mode 组合平台实施计划

> 状态：**Draft v1.1 - 基于 `main@e0e0f970f` 的代码实证，等待 ADR-17 / Custom PRD 审批后执行**
> 日期：2026-08-18
> 目标阶段：M0 治理与契约 + M1 单 Agent 可恢复闭环；M2-M5 只定义准入 Gate，不提前实现
> Owner：Product / Schema+SDK / Core / Security / App
> 依据：[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[CONTEXT.md](../../CONTEXT.md)、[DESIGN.md](../../DESIGN.md)、[ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md)、[Custom PRD](../prd/custom-mode-composition-platform.md)、[Custom Roadmap](../roadmap/custom-mode-roadmap.md)、[Session V2](../../specs/v2/session.md)、[V2 Tools](../../specs/v2/tools.md)
> 命中 skills：`protocols`、`effect`、`database`、`frontend-theming`、`enterprise-code-standard`、`reuse-first-refactor`、`quality-to-pr`

---

## 0. 执行结论

### 0.0 M 节点实施计划

| M   | 独立实施计划                                                             | 对应本计划切片       | 启动条件                                  |
| --- | ------------------------------------------------------------------------ | -------------------- | ----------------------------------------- |
| M0  | [治理与组合底座](custom-mode-m0-composition-foundation.md)               | PR 0-4               | ADR-17 / Custom PRD 正式批准              |
| M1  | [单 Agent 可恢复运行闭环](custom-mode-m1-single-agent-runtime.md)        | PR 5-8               | M0 + G2/G3/G4                             |
| M2  | [多 Agent 与 Workflow 编排](custom-mode-m2-multi-agent-workflow.md)      | 独立 ADR + gated PRs | M1 稳定 + Workflow Execution ADR          |
| M3  | [MCP 与统一审批](custom-mode-m3-mcp-approval.md)                         | 独立 ADR + gated PRs | M1 稳定 + Registration/Grant ADR          |
| M4  | [Trusted Runtime Extension](custom-mode-m4-trusted-runtime-extension.md) | 独立 ADR + gated PRs | M3 稳定 + Threat/Lifecycle/Capability ADR |
| M5  | [Code Presentation](custom-mode-m5-code-presentation.md)                 | 独立 ADR + gated PRs | M3/M4 稳定 + Sandbox/Equivalence ADR      |

可复制的执行入口见 [Custom Mode M0-M5 TDD 执行提示词](prompt-custom-mode-composition-platform.md)。M0/M1 的边界以表中 PR 映射为准，消除 Roadmap 中“Schema/Resolver 同时属于 M0/M1”的表达重叠：M0 交付可预览但不可运行的组合底座，M1 交付原子冻结后的真实运行闭环。

### 0.1 业务目标

Custom 不是第八套 Agent 配置，也不是动态注册任意 Product Mode。它解决的根问题是：Chat 已能管理七类资产，但用户无法把一个用户 Agent、Prompt 和 Skill 解析成一份可解释、可冻结、可恢复且不随文件变化漂移的运行组合。

M1 的唯一运行拓扑为：

```text
Product Mode = custom
root Session agent = meta
Snapshot allowlist = exactly one current-Location user Agent
assets = zero or more Prompt / Skill bindings
presentation = native
runtime = existing Session V2 + ToolRegistry + PermissionV2
```

### 0.2 第一性原理收敛

| 步骤     | 结论                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 识别假设 | “七类资产已能直接运行”“加一个 `custom` 枚举即可”“Plan 可在前端确认后直接启动”均不成立                                                   |
| 追溯本源 | 缺少的是 Session-owned 不可变组合真源、运行时 Agent/Skill 桥接、Snapshot 约束下的工具与委派门禁                                         |
| 重构方案 | 新增一个 Location-scoped Resolver 和一个 Session-owned Snapshot owner，扩展现有 Session/Tool/Permission/ModeWorkspace，不创建第二运行时 |
| 精简输出 | 先完成 G0-G3 与 8 个可独立合并的 M0/M1 代码 PR；M2-M5 不进入首个实现分支                                                                |

### 0.3 当前阻塞

任何生产代码开始前必须满足：

1. ADR-17 从 Proposed 变为 Accepted，并明确 supersede / amend ADR-11、ADR-12、ADR-13 §4、ADR-15 及旧 My Agents / Assistant PRD 条款。
2. Product/Core/App/Security 审批本计划 §3 的 owner 与真源决策。
3. Schema/API/SDK 审批 §4 的旧客户端兼容矩阵。
4. Product 确认 M1 严格范围，不把 MCP、Workflow execution、Plugin runtime、Code Presentation 或多 Agent 塞入 M1。

审批前允许：协议修订、Schema 草案、失败模型、测试设计和 benchmark 基线。审批前禁止：把 `custom` 加入运行时枚举、创建 Custom Session、开放 UI 入口。

### 0.4 执行 Gate

| Gate       | 通过标准                                                                                                                 | 阻塞范围                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| G0 治理    | ADR-17 / Custom PRD Approved，旧 ADR/PRD supersede/amend 清楚                                                            | 所有代码 PR                   |
| G1 兼容    | capable-client、unsupported-mode、数据库/event/API/SDK 迁移矩阵获批并有红灯测试                                          | `custom` enum、公开 API、入口 |
| G2 V2 运行 | Custom 强制走 V2-native create/prompt/resume/interrupt/fork；V2 auth、消息 shape、Tool/Permission 路径在 Custom 场景通过 | Snapshot start 与真实执行     |
| G3 安全    | Snapshot/Context Epoch 真源、stable tool fingerprint、Custom ceiling、task+child 双门禁通过 Core/Security 评审           | Runner、Beta                  |

Gate 只按证据通过，不以“feature flag 默认关闭”替代。flag 可以降低发布风险，不能掩盖错误数据、提权或不可恢复状态。

---

## 1. 当前基线事实

### 1.1 五层真实调用链

| 层                           | 当前 owner                                                                  | 代码事实                                                                                         | Custom 缺口                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| L1 Schema / wire             | `packages/schema`、OpenAPI、`packages/sdk/js`                               | `ProductMode.ID` 只有四值；`AssetKindId` 有七值；Session mode 缺字段时默认 Coding                | 缺 `custom`、`custom-profile`、AssetRef / Plan / Snapshot / Diagnostics、显式 unsupported-mode 契约               |
| L2 Core domain / persistence | `packages/core`                                                             | Session mode 已持久化；资产 registry 有 revision/watcher；前五类资产有 typed transaction service | 缺 Profile owner、Resolver、Snapshot 表、原子启动、反向引用；Workflow/Plugin 事务仍是已知内联债                   |
| L3 HTTP / SDK                | `packages/aigcfroge/.../httpapi`、`packages/server`、SDK generator          | App 的 `/session` create 即使 V2 flag 开启仍固定走 V1 `SessionShare.create`                      | 缺 Plan/Profile/Start/Snapshot API；缺 capable-client 协商；不能先 create 再补写 Snapshot                         |
| L4 App / ModeWorkspace       | `MODE_DEFINITIONS`、`MODE_SURFACES`、`ModeWorkspace`、Session side panel    | 四个 slot render-all + `display:none`；Draft 首次提交把 mode/agent 传给通用 session.create       | 缺 Custom typed slot、Builder/Preview、Draft composition identity、只读 Snapshot panel、状态/i18n/a11y            |
| L5 execution / security      | `SessionRunner`、`ToolRegistry`、`PermissionV2`、`task`、`SessionV2.create` | Tool materialize 只按权限和 intent 过滤；非 CLI task 只按 Mode 检查 Agent；child 继承 mode       | 缺 Snapshot allowlist、Custom ceiling、Agent/Skill Snapshot 输入、task + child create 双层门禁、CLI/Judge M1 拒绝 |

### 1.2 已确认的关键代码事实

1. `packages/schema/src/product-mode.ts` 是四值固定枚举；数据库 `session.mode` 是普通 `text`，增加枚举值本身不需要改列，但所有 Schema、API、SDK、App exhaustiveness 和测试都要同步。
2. `packages/app/src/context/mode.test.ts` 当前明确断言 `isMode("custom") === false`；入口尚未实现，这是正确基线。
3. `ModeWorkspace` 的 slot 数组和 `MODE_SURFACES` 都是四项；Custom 必须加入同一 registry，不能新增 `/custom/*` 平行外壳。
4. App 首次提交先调用 `client.session.create(...)`，成功后才调用 prompt API。通用 create handler 固定走 V1 create，因此 Snapshot 不能依赖现有两请求顺序。
5. `AgentAsset` 读取 `.aigcfroge/agents/*.md`，但 `AgentV2.fileLayer` 只读取 `.claude/agents/*.agent.md`；当前没有 AgentAsset -> AgentV2 的运行时桥接。
6. `SkillAsset` 与 `SkillV2` 也是两个 owner。Config plugin 能从 `.aigcfroge/skills` 发现 Skill，但 M1 仍需按 Snapshot 限制“哪些 Skill 可见”，不能把整个 Location 的 Skill 自动暴露给组合。
7. `ToolRegistry.materialize(permissions, intent)` 没有 allowlist 参数；权限过滤只能判断 action 是否整体 deny，不能表达“这个 Session 只允许 Snapshot 中的有效工具集合”。
8. `ProductModeAgentPolicy.checkPrimaryAgent(mode, agent)` 是 Mode 级纯策略，无法表达每个 Custom Session 不同的 Agent allowlist。
9. `SessionV2.create` 在 child create 时继承 parent mode，但没有可插入的 Snapshot allowlist 判定；`task` 执行点和 child create 点需要同一 Session-owned 判定 owner。
10. 当前 App 对未知 Session mode 有 Coding fallback：`SessionModeBadge` 和若干列表用 `isMode(...) ? ... : "coding"`。如果服务端直接向旧 App 返回 `custom`，会发生协议明确禁止的错误分类。
11. `AIGCFROGE_V2_RUNTIME` 当前默认 false，且通用 create 固定走 V1；Custom 的 Snapshot/Runner 安全契约不能依赖 V1 fallback，必须拥有一个唯一的 V2-native runtime 路由决定。
12. ToolRegistry 的有效 registration identity 当前是进程内对象引用，只能在一个 provider turn 内做 stale rejection，不能直接持久化为跨进程 Snapshot identity。

### 1.3 已有资产成熟度不能被高估

| 能力                                               | 可复用 owner                                                    | 结论                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| registry / revision / invalid projection / watcher | Prompt、Skill、MCP、Command、Agent、Workflow、Plugin registry   | 复用结构与 watcher 生命周期                                               |
| CAS / atomic write / reload / readback / rollback  | Prompt/Skill/MCP/Command/Agent `*AssetService` + `FileMutation` | Custom Profile 必须按该形态实现                                           |
| Workflow / Plugin apply-delete                     | HTTP handler 内联事务                                           | 不作为第八类资产的模板；技术债不向 Custom 传播                            |
| AssetKind registry                                 | `packages/core/src/asset-kind.ts`                               | 当前仅保存 schema/ownerDir，注册覆盖也无重复保护；M0 需补强后再注册第八类 |
| Session classification                             | Session V1/V2 + shared SQL                                      | 复用 mode 字段、继承和列表过滤                                            |
| immutable system context                           | Context Epoch                                                   | 不存组合身份；只继续存实际模型可见上下文                                  |
| tool execution                                     | canonical ToolRegistry                                          | 只扩展物化过滤，不新增 executable registry                                |
| authorization                                      | PermissionEffective / PermissionV2                              | 运行时逐次判断；Snapshot digest 只审计，不授权                            |

### 1.4 main 历史与基线结论

Custom 不是在静态骨架上施工。以下 main 历史决定了实施顺序和可复用 owner：

| 提交                                        | 已形成的基座                                                                  | 对 Custom 的影响                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `660a00d31` / `eb9a683b4`                   | V2 canonical Tool architecture 与 hardening                                   | M1/M3/M5 必须扩现有 ToolRegistry，不能新增 executor registry                            |
| `526257edf`                                 | Meta Agent V2、handoff、tool permission、Agent hot reload、MCP contributor    | root=`meta` 与 Agent bridge 有现成 owner，但 MCP contributor 不等于 scoped registration |
| `63c7982f1` / `7c5b97469`                   | Product Mode 持久分类与统一导航 registry                                      | `custom` 必须扩固定枚举与同一 registry，并处理旧客户端                                  |
| `6fa57a49a` 及后续 Chat 资产提交            | Prompt Asset typed owner、Chat 创建/管理资产闭环                              | Profile 复用 typed service/CAS/watcher 形态，不复制旧 handler 事务                      |
| `0105b3649`                                 | ADR-15 ModeWorkspace typed slot                                               | Custom 复用共享 shell/timeline/composer，不建平行页面                                   |
| `8d4f20398`                                 | ADR-17/PRD/Roadmap proposal 合入                                              | 当前只有提案和范围，不构成生产代码授权                                                  |
| `42cf6d950` 前的 permission-tier 提交链     | PermissionEffective、Session override、fail-closed 修订                       | Custom ceiling 和未来 grant 必须进入唯一 Permission owner                               |
| `c9d1a58ef`..`eb505210f`，merge `44912a774` | Mode 页面 Phase 1-7：home owner、Location owner、共享右栏、mode launch helper | App 计划必须以归一化后的 owner 为基座，旧路径锚点失效                                   |
| `bdf821d0d` / `e0e0f970f`                   | CI/文档与 CLI wrapper 修订                                                    | 不改变 Custom domain，但证明开工前仍需审计 `main`/`origin/main` 差异                    |

基线结论：

1. 本计划的代码实证记录在 `main@e0e0f970f`；这是分析锚点，不是未来所有分支的固定起点。
2. 只有 M0 Phase A 可以从当前最新 main 启动治理草案。M0 代码 PR 必须等待治理批准并包含已合入的前置文档。
3. M1 必须从 M0 全部合入后的最新 main 开始；M2-M5 分别从其前置 M 合入并复审后的最新 main 开始，不能今天并行切六个长期分支。
4. 同一 M 内的多个 PR 也默认逐个合入 main 后再开下一分支。只有 owner 明确批准 stacked branches 时可临时堆叠，且每层合并后必须同步 main 并重跑门禁。
5. 文档/ADR 研究可以并行，但不能提前修改未批准的 runtime contract，也不能让并行文档产生互相竞争的 owner。

---

## 2. 范围与非目标

### 2.1 M0 交付范围

- 治理修订链与 Schema/API 兼容矩阵。
- `custom-profile` 文件契约及 typed owner。
- `AssetRef`、binding、provenance、revision、health、diagnostic、Plan、Snapshot Schema。
- `CompositionResolver` 接口、纯解析顺序、失败语义和缓存键。
- Session Snapshot 独立持久化设计与原子启动协议。
- Custom Mode ceiling、task/child create 双层门禁设计。
- 当前 AgentAsset/SkillAsset 到运行时 owner 的桥接契约。

### 2.2 M1 交付范围

- 固定第五 Product Mode `custom`，入口 `/mode/custom`。
- 当前 Location 内 exactly one Agent；零个或多个均为阻断诊断。
- Prompt/Skill 显式绑定到 `orchestrator` 或 `agents/<id>`；未连接资产不加载。
- 临时组合和保存 Profile 两条路径。
- Plan 四视图：Instructions / Capabilities / Permissions / Diagnostics。
- 首次启动服务端重新解析并原子冻结 Snapshot。
- root=`meta`；只允许委派 Snapshot Agent；CLI/Judge/background multi-agent 不开放。
- Profile/资产变化只更新 health/version drift，不修改已运行 Snapshot。
- Snapshot 查询、历史查看、依赖缺失阻断、采用新版时 fork/new Session。
- feature flag、指标、内部 50 次基线、10% Beta 前置证据。

### 2.3 M1 非目标

- 多 Agent、并行/串行 Workflow execution、Command binding。
- MCP dynamic registration、凭证可用性生命周期、统一审批中心。
- Plugin Host/Client 执行、任意页面或 DOM/CSS 接管。
- `run_code`、模型生成代码执行、第二 ToolRegistry。
- Global/Cross-Location assets、绝对路径引用、隐式全局工作区。
- Session 内原地编辑组合或静默采用最新 revision。
- Profile 历史版本浏览器；M1 只要求当前文件 revision + Session Snapshot 可恢复。

---

## 3. Owner 与真源决策

### 3.1 Profile 文件契约

建议在 M0 批准以下固定格式：

```text
owner directory: <Location>/.aigcfroge/custom-profiles/
file extension:   .yaml
asset kind:       custom-profile
identity:         (Location, relativePath, revision)
```

推荐最小 YAML：

```yaml
kind: custom-profile
name: release-review
description: Review a release against project policy
agents:
  - kind: agent
    relativePath: reviewer.md
    revision: <sha256>
bindings:
  orchestrator:
    prompts: []
    skills: []
  agents/reviewer:
    prompts:
      - kind: prompt
        relativePath: release-policy.md
        revision: <sha256>
    skills:
      - kind: skill
        relativePath: review-checklist.md
        revision: <sha256>
presentation: native
requestedCapabilities: []
```

约束：

- 使用结构化 YAML parser + Effect Schema 解码，不用字符串切割或 Markdown frontmatter 承载嵌套 bindings。
- Profile 只存引用，不内嵌 Agent/Prompt/Skill 正文。
- M1 `agents.length === 1`；`presentation === "native"`；仅允许 `agent|prompt|skill` 引用。
- `relativePath` 相对对应资产 owner root，而不是 Location 根；拒绝绝对路径、`..`、符号链接越界和跨 Location。
- Profile revision 是规范化文件 bytes 的 SHA-256；composition digest 是 Resolver 对规范化 Plan 输入计算的独立 digest。

### 3.2 Schema owner

新增建议：

```text
packages/schema/src/custom-profile.ts
  Profile / Candidate / Summary / Info / Frontmatter

packages/schema/src/composition.ts
  AssetRef / Consumer / Binding / Provenance
  Health / Diagnostic / Plan / Snapshot / Digest
```

规则：

- 多字段对象使用 `Schema.Class`，ID/revision/digest 使用 brand，错误使用 `Schema.TaggedErrorClass` 并实现 `message`。
- `AssetRef.kind` 在 M1 收窄为 `agent|prompt|skill`；不要把长期七类 union 当成 M1 运行许可。
- Snapshot Schema 带显式 `version: 1`，后续只做可兼容加字段；破坏性演进走新版本 union 和迁移/读取策略。
- `AssetKindId` 增加 `custom-profile`；App 的资产类型、Chat feature 和 insert/delete 分支必须 exhaustively 更新。

### 3.3 Core owner

新增两个不同生命周期的 owner，禁止合并成万能服务：

| Owner                                    | Scope      | 职责                                                                                | 非职责                                  |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| `CustomProfile` + `CustomProfileService` | Location   | 文件 registry、watcher、CAS apply/delete、readback、health 输入                     | 不创建 Session、不执行工具              |
| `CompositionResolver`                    | Location   | 解析 Profile/临时输入、引用/绑定/revision/冲突/能力交集、生成 Plan/Snapshot 候选    | 不持久化审批、不执行工具、不加载 Plugin |
| `SessionComposition`                     | Session/DB | 原子 attach、读取不可变 Snapshot、child/fork 继承判定、运行依赖检查、allowlist 查询 | 不读取最新 Profile 替换旧 Snapshot      |

`CompositionResolver` 的推荐接口：

```ts
interface Interface {
  readonly plan: (input: PlanInput) => Effect.Effect<Composition.Plan, Composition.ResolveError>
  readonly freeze: (input: FreezeInput) => Effect.Effect<Composition.Snapshot, Composition.ResolveError>
}
```

`freeze` 必须重新读取所有 registry revision 和 effective capability facts；不得把客户端返回的 Plan 当成可信输入。

### 3.4 Snapshot 物理存储

采用独立表，不塞入 `session.metadata`、transcript、Context Epoch 或 Profile 文件：

```text
session_composition_snapshot
  session_id       text primary key references session(id) on delete cascade
  version          integer not null
  digest           text not null
  profile_path     text null
  profile_revision text null
  data             text(json) not null
  time_created     integer not null
```

理由：

1. Snapshot 是 Session identity 的运行事实，查询和约束都需要 typed owner。
2. `session.metadata` 是自由形状且会被普通 update 覆盖，不适合作为安全门禁真源。
3. Context Epoch 可以在 move/compaction 时重建，语义与不可变组合身份不同。
4. 独立表可通过 FK 保证生命周期，通过主键保证一个 Session 一个 Snapshot。

内容型与运行型事实分层存入 `data`：

- 内容型：Agent system、Prompt text、Skill guidance/body 的冻结内容或可完整重建记录。
- 运行型：Agent registration identity、工具 registration identity/digest、Location policy facts。恢复时必须匹配，缺失则阻断。
- 凭证只保存 opaque reference；M1 不支持 MCP，因此不应出现秘密字段。

### 3.5 原子 Session 启动

新增 Custom 专用启动 API，不扩展现有通用 `session.create` 为多义接口：

```text
POST /custom-composition/start
input: location + temporary composition OR profile path/revision + optional session id
server:
  freeze latest facts
  -> verify feature gate and exact M1 scope
  -> create mode=custom, root agent=meta Session
  -> insert immutable Snapshot in same durable transaction
output: Session Info + Snapshot summary
```

实现要求：

- Core 提供一个原子 `createCustom` domain operation；HTTP handler 只解码、调用、映射 typed errors。
- 复用 EventV2 durable publish 的 transaction commit hook，把 Snapshot insert 与 `session.created` projection 放入同一 SQLite transaction；不得先创建 Session 再由客户端 PATCH Snapshot。
- 将 `SessionV2.create` 的 Session 构造/投影步骤收敛为一个内部可复用路径，`createCustom` 只增加 freeze、digest 对账和 Snapshot commit；禁止复制一份平行 Session create 实现。
- 并发 exact retry 使用调用方 session id + composition digest 对账。相同输入返回同一 Session；同 id 不同 digest 返回 conflict，不能采用当前通用 create 的“忽略不同参数返回旧 Session”语义。
- create 成功后 App 再走现有 prompt admission。Snapshot 不存在时 Custom Session 不允许 prompt/resume。

Custom 一律使用 V2-native 执行。新增一个服务端 runtime policy owner（纯函数即可）统一决定 create/prompt/resume/interrupt/fork 路径：`mode=custom` 必须走 V2，其余模式继续遵守现有全局迁移策略。不得在多个 handler 中散落 `AIGCFROGE_V2_RUNTIME || mode === "custom"`。如果 G2 的 V2 auth/shape 问题未闭环，capabilities 必须报告 Custom 不可用，start 必须 fail closed。

### 3.6 child / fork / move

| 操作           | M1 规则                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| task child     | child 继承 `mode=custom`；以 parent Snapshot 判定目标 Agent；child 保存 `source_session_id` 或复制不可变 Snapshot 行，具体实现以一个查询 owner 为准 |
| fork           | 创建新 Session + 复制源 Snapshot bytes/digest，之后可显式“采用新版”生成另一份新 Snapshot；不能指向可变 Profile 充当继承                             |
| resume         | 读取现有 Snapshot，检查精确运行依赖；Profile 是否删除不影响历史读取                                                                                 |
| move           | Snapshot bytes 保留；Context Epoch reset；目标 Location 重新检查运行依赖，缺失则 `dependency_missing` 阻断                                          |
| delete Session | FK cascade 删除 Snapshot；删除 Profile/资产绝不级联删除 Session/Snapshot                                                                            |

M1 推荐每个 root、child、fork 都拥有独立 Snapshot 行，避免运行判定需要递归追父且父删除后失去真源。child 可复制相同 digest，但 row identity 独立。

---

## 4. Product Mode 与旧客户端兼容

### 4.1 兼容根因

历史“字段缺失 -> Coding”只适用于没有 `mode` 的旧数据，不适用于新值 `custom`。旧 App 当前会把未知值显示成 Coding，因此仅扩展服务端 enum 是不安全的。

### 4.2 协议方案

新增 capable-client 声明，推荐复用 SDK wrapper 的统一 headers：

```text
x-aigcfroge-capabilities: product-mode-custom-v1
```

并扩展 `/experimental/capabilities`：

```json
{
  "customMode": true,
  "productModes": ["chat", "coding", "work", "assistant", "custom"],
  "customCompositionVersion": 1
}
```

两者职责不同：响应 capabilities 控制新 App 是否显示入口；请求 header 告诉服务端该调用方能安全理解 Custom Session。

### 4.3 兼容矩阵

| 客户端 / 服务端                        | 行为                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 新 client + flag on                    | 可发现、创建、列出、读取、恢复 Custom                                                                                           |
| 新 client + flag off                   | 不显示入口、不能新建；已有 Profile/Snapshot/Session 不删除，历史仍可读                                                          |
| 旧 client + 新 server                  | list/search/global event 不暴露 Custom；按 ID 读取 Custom 返回 typed `UnsupportedProductMode`（建议 HTTP 409），不返回伪 Coding |
| 新 client + 旧 server                  | capabilities 无 Custom，隐藏入口；普通四模式保持可用                                                                            |
| 数据库旧 row mode missing              | 继续解码 Coding                                                                                                                 |
| 数据库 row mode custom + 不支持 client | 明确 unsupported，不做 decoding default                                                                                         |

需要覆盖的公共面：legacy `/session`、V2 `/api/session`、global/experimental list、children/fork、SSE `session.created|updated`、share/readback、SDK V1/V2 generated types。不能只修 App badge。

### 4.4 Feature flag 与回滚

- 新增 `AIGCFROGE_EXPERIMENTAL_CUSTOM_MODE`，控制入口、Profile 新建和 Custom start；不控制既有数据解码。
- 增加独立 fail-closed execution kill switch 或等价部署策略；出现 allowlist 绕过、跨 Location 读取、静默升级或 Snapshot 损坏时，阻断 Custom prompt/resume，但仍允许历史读取和导出。
- 关闭入口不得改写 `mode`、删除 Profile、删除 Snapshot 或把 Custom Session 迁为 Coding。

---

## 5. Resolver 与能力模型

### 5.1 确定性解析顺序

```text
decode input/profile
-> validate M1 cardinality and allowed kinds
-> resolve canonical current-Location references
-> verify provenance/path/revision
-> parse Agent config into AgentV2.Info candidate
-> resolve Prompt/Skill consumer bindings
-> detect duplicate/unconnected/conflicting refs
-> compute requested/effective/denied capabilities
-> build ordered instructions and skill catalog
-> calculate content digest + runtime identity digest
-> return Plan
```

稳定指令顺序：

```text
Platform baseline
-> Custom mode instruction
-> selected executor Agent instruction
-> bound Prompt assets in profile order
-> bound Skill guidance in profile order
-> chronological Session context
```

同一规范输入必须生成相同 digest；对象 key 排序、数组顺序和换行策略必须在 Schema/serializer tests 固定。

### 5.2 AgentAsset -> AgentV2 桥接

不新增 Agent registry。复用 `AgentV2.transform`，新增由 AgentAsset registry 驱动的 transform：

1. `AgentAsset.config` 先用仓库现有 YAML parser（`js-yaml` 已是 Core 直接依赖）解析为 unknown，再用 `ConfigAgent.Info` Schema 解码；不用 `JSON.parse` 或字符串猜测。空 config 解码为空配置，非 plain object 或 excess/invalid fields 形成 diagnostic。
2. Agent id 来自资产 `name`；system 来自 `source`；mode M1 必须可作为 subagent 使用，hidden/disabled/invalid 均阻断 Plan。
3. revision/provenance 保留在 resolver projection，不污染 AgentV2 公共执行字段。
4. watcher reload 后重放 AgentV2 transforms；运行中 Session 继续使用 Snapshot allowlist 与冻结 system，不自动换 revision。
5. name conflict、AgentV2 config decode error 和不可用模型分别形成结构化 diagnostic。

### 5.3 SkillAsset -> Snapshot skill catalog

- 复用 SkillAsset registry 的 content/revision，不把整个 Location 的 `SkillV2.list()` 自动加入 Custom。
- Resolver 只把已绑定 Skill 生成 Snapshot-local catalog。
- Runner 的 Skill guidance 和 `skill` tool lookup 对 Custom Session 必须读取 Snapshot catalog；非 Custom 继续现有 SkillV2 路径。
- Skill 仍不能授予工具权限；其正文按需加载，首次 provider turn 的 guidance 只列名称和描述。

### 5.4 Tool materialization

扩展现有接口，而不是新建 registry：

```ts
materialize({
  permissions,
  intent,
  allowlist?: ReadonlySet<string>,
})
```

要求：

- allowlist 过滤和 permission/intent 过滤共同作用于 advertised definitions。
- 返回的 `settle` 只可执行本次 materialization 捕获且在 allowlist 内的 registration；不存在定义/执行不一致。
- PermissionV2 leaf assert 仍是最终授权；allowlist 不能产生 allow。
- 当前进程内 registration object 继续负责 provider-turn stale rejection；它不能序列化进 Snapshot。
- M0 新增稳定 `ToolRegistrationFingerprint` 契约。M1 只覆盖 shipped native tools，fingerprint 至少包含 placement、tool name、规范化 definition/schema digest 和 `InstallationVersion`；不能包含 executor、凭证或进程内对象。Snapshot 保存 name+fingerprint 及 aggregate catalog digest。
- 新 provider turn 重新计算 fingerprint 并与 Snapshot 匹配；不一致时明确阻断或报告 dependency drift，不切到同名新 executor。M3/M4 在开放 MCP/Extension 前必须为各自 registration 定义更强的 server/extension revision fingerprint。
- 非 Custom caller 不传 allowlist，行为与现有 tests 完全一致。

### 5.5 Custom Mode ceiling

M1 建议 fail-closed ceiling：

```text
root meta: read/glob/grep/webfetch/websearch/question/task/skill
executor: Snapshot Agent 自身 permissions ∩ Location/Session policy
explicitly denied: external-cli, judge, command/shell prompt, MCP, Plugin runtime,
                   workflow execution, run_code, task recursion
```

最终权限：

```text
Custom ceiling
∩ root/executor Agent rules
∩ Snapshot requested/effective tool catalog
∩ Location policy
∩ Session tier/attended/override rules
∩ current PermissionV2 decision
```

在 `PermissionEffective` 中新增 `custom` 分支时仍保持一个 effective rules owner；不要在 Resolver、Runner 和 App 各写一份 permission merge。

### 5.6 委派双层门禁

新增 `SessionComposition.assertAgentAllowed(parentSessionID, agentID)`，由两个点调用：

1. `task` tool 在 permission assert 和 `TaskDriver.createChild` 前调用，失败返回 typed ToolFailure。
2. `SessionV2.create({ parentID, agent })` 在写 Session 前再次调用，防止绕过 task 直接创建 child。

此外：

- M1 `execution_type=external-cli|judge` 在 task 分支显式拒绝。
- resume `task_id` 必须同时验证 child 属于 parent 且 child Snapshot digest 与 parent 允许的事实一致。
- allowlist 不写入 Prompt 充当安全边界；Prompt 只解释，Core service 强制。

---

## 6. HTTP / SDK 契约

建议新增一个 `custom-composition` HttpApi group，避免把业务规则塞入 session handler：

| Endpoint                                | 作用                                          | 关键错误                                        |
| --------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `GET /custom-profile`                   | list summaries + health                       | unsupported / flag / location                   |
| `GET /custom-profile/content`           | 读取 typed Profile                            | not_found / invalid                             |
| `POST /custom-profile/apply`            | CAS apply                                     | stale / overwrite / readback / rollback         |
| `POST /custom-profile/delete`           | CAS delete + reverse refs                     | stale / referenced / rollback                   |
| `POST /custom-composition/plan`         | 临时/Profile 解析                             | missing / stale / conflict / invalid_binding    |
| `POST /custom-composition/start`        | 服务端 re-freeze + 原子 Session/Snapshot 创建 | stale_plan / dependency / permission / conflict |
| `GET /session/:id/composition`          | 只读 Snapshot + dependency status             | unsupported / not_found                         |
| `POST /session/:id/composition/upgrade` | 显式 fork/new Session + 新 Snapshot           | stale / dependency / conflict                   |

规则：

- endpoints 使用 `HttpApiBuilder.group`；handlers 构建时 yield stable services，内部不 `Effect.provide(layer)`。
- Location 来自 middleware，Profile/Resolver service 从 `LocationServiceMap` 获取；业务错误在 HTTP 边界映射为公开 `Schema.ErrorClass`。
- start 不接收客户端构造的 Snapshot；只接 composition input/profile ref + expected Plan digest/revisions。
- legacy Session endpoints 对 Custom 调用统一委托 V2 runtime policy；不得为 Custom 复制 prompt/abort/fork endpoints。
- SDK 通过 `./packages/sdk/js/script/build.ts` 生成，禁止手改 `openapi.json` 或 generated files。
- `specs/v2/schema-changelog.md` 记录数据库、HTTP、SDK、兼容和事件版本影响。

---

## 7. App 实施

### 7.1 复用边界

| 需求         | 复用                                                                | 禁止                          |
| ------------ | ------------------------------------------------------------------- | ----------------------------- |
| 模式入口     | `MODE_DEFINITIONS` / `modeHref` / `ModeSwitcher`                    | 第五套导航 rail               |
| 页面外壳     | `ModeRoute` / `ModeWorkspace` / existing providers                  | `/custom/*` 平行 shell        |
| Location     | 评审后复用现有 mode Location owner；不可误用 CodingSelectionCtx     | Custom 自建 Project store     |
| Session 列表 | `loadSessions(...,{mode:"custom"})` + shared rows/openSessionRecord | 新 Session identity/cache     |
| 控件         | `packages/ui` v2 primitives、icons、TabsV2、drawers/dialogs         | 新 icon 库、硬编码颜色        |
| Session 详情 | timeline/composer + typed side panel                                | Custom timeline/composer copy |

### 7.2 Draft 状态

扩展 `DraftTab`：

```ts
composition?: {
  source: "temporary" | "profile"
  profilePath?: string
  profileRevision?: string
  planDigest: string
  draft: CompositionInput
}
```

这只是可恢复 UI 草稿，不是运行真源。首次提交调用 `/custom-composition/start`；服务端重新 freeze。普通四模式 Draft 不带该字段。

### 7.3 Custom surface

在 `MODE_SURFACES` 注册：

```text
CustomSidebar
  Location / Profile search / health filters / recent

CustomCompositionMain
  asset catalog -> composition list/bindings -> preview

CustomSessionPanel
  Composition / Dependencies / Run History (M1 前两项，Run History 可先只显示启动事实)
```

宽屏可三列；当前共享 workspace 只有 Sidebar/Main 两列，因此 Builder 内部的 catalog/list/preview 应为主区 unframed layout，不能把整页改成平行 shell。窄屏使用 step/tabs + drawer，不能压缩三列。

### 7.4 UI 状态

必须独立呈现：

```text
loading
empty-location
empty-profile
invalid-selection
permission-required
dependency-missing
version-drift
resolver-failed
stale-before-start
starting
read-only-snapshot
unsupported-server
```

不得把全部错误折叠成“无法启动”，不得在错误时自动选择默认 Agent 或最新 revision。

### 7.5 i18n / a11y / styling

- `mode.custom`、Builder、preview tabs、diagnostics、health、Snapshot actions 加入 app 18 个 locale；parity test 必须通过。
- 新 UI 使用 `--v2-*` token，无 hardcoded hex/rgb/px 视觉常量；组件 CSS 使用 data attributes。
- 资产选择使用 listbox/checkbox，consumer 切换使用 segmented/tabs/menu，health 用语义 icon+text；icon-only 按钮有 `aria-label` 和必要 tooltip。
- 验证键盘选择、焦点返回、drawer trap、错误关联、桌面/640px 窄屏、light/dark、English/Chinese overflow。

---

## 8. 分阶段 PR 序列

### 8.0 M0/M1 归属与 main 基线

- M0 = PR 0-4；退出时 Custom 可被安全协商、管理和解析，但不能创建或执行 Custom Session。
- M1 = PR 5-8；退出时完成 Snapshot、执行安全、App 和灰度闭环。
- 每个 PR 从**前置 PR 已合入后当时最新、已同步、干净的 `main`**创建短分支；不是所有 PR 都从 `main@e0e0f970f` 并行切出。
- 文档/ADR 研究可以并行，但涉及同一协议真源时也必须在提交前同步最新 main 并解决语义冲突。
- 只有 owner 明确批准 stacked branches 时才允许临时堆叠；每层合并后必须 rebase/merge 最新 main 并重跑受影响门禁。

每个 PR 必须可独立验证并保持未开入口；不要用一个巨型 PR 同时修改五层。

### PR 0 - 治理与兼容决策

**目标**：完成 G0；只改协议文档。

- Accept ADR-17，修订 ADR-11/12/13/15、CONTEXT、ARCHITECTURE、DESIGN、Session spec、Custom PRD/Roadmap。
- 固化 Profile 路径/格式、Snapshot 表、capable-client、Custom ceiling、M1 scope。
- 更新 technical debt 状态和 schema changelog 预告。

退出：协议引用检查通过，四方 owner 签字，未修改运行时 enum。

### PR 1 - Schema 与 capable-client

**目标**：定义 wire contract，但 feature flag 默认关闭。

- 增加 `custom`、`custom-profile`、composition Schemas/errors/version。
- 扩展 capabilities response 和 SDK request capability header。
- 实现 unsupported-mode read/list/event gating，并同步 CORS allowed headers / proxy preservation。
- 更新 Schema tests、HTTP compatibility tests、SDK 生成。

退出：新旧客户端矩阵自动化通过；旧 client 无任何 Custom -> Coding 路径。

### PR 2 - Custom Profile typed owner

**目标**：完成 Profile 文件生命周期，不开放运行。

- path helper、YAML codec、registry/watcher/invalid projection。
- CAS propose/apply/delete、FileMutation、reload/readback/rollback。
- AssetKind 注册补强、重复注册错误、Chat 第八类管理入口和 HTTP/SDK。

退出：clean/existing Location、并发 CAS、symlink/path escape、rollback tests 全绿。

### PR 3 - Agent/Skill runtime bridge

**目标**：让 Chat 创建的 M1 资产可被 Resolver 正确消费。

- AgentAsset -> AgentV2 transform；ConfigAgent Schema decode；revision/provenance projection。
- Snapshot-local Skill catalog/guidance lookup seam。
- watcher reload 与正在运行 Snapshot 隔离 tests。

退出：Agent asset 可作为 subagent resolve；invalid/hidden/disabled/changed revision 均有结构化结果。

### PR 4 - Resolver 与 Plan API

**目标**：完成选择 -> 解析 -> 预览，不创建 Session。

- CompositionResolver、deterministic digest、diagnostics、health cache。
- `/custom-composition/plan`、Profile health/reverse refs。
- TOCTOU/stale/cycle/binding/cardinality tests。

退出：同 input digest 稳定；零/多 Agent、跨 Location、未连接、stale 均 fail closed。

### PR 5 - Snapshot persistence 与原子 start

**目标**：完成 freeze -> Session/Snapshot 原子创建。

- migration + schema.gen/migration.gen；SessionComposition owner。
- Event transaction commit hook 或等价 Core transaction 组合。
- start/get Snapshot APIs、exact retry conflict、fork/move/resume rules、Custom V2 runtime policy。

退出：任何故障下不存在 Custom Session without Snapshot，也不存在 orphan Snapshot。

### PR 6 - Runner / Tool / Permission / delegation

**目标**：完成真实执行安全闭环。

- ToolRegistry materialize options + allowlist + stable native-tool fingerprint。
- Custom ceiling 进入 PermissionEffective 唯一 owner。
- Runner 加载 Snapshot instructions/skills/tools。
- task execution + child create 双层 allowlist；CLI/Judge M1 deny。
- dependency identity/stale rejection/interruption tests。

退出：未授权委派=0；definitions/settle 一致；asset watcher 不改变 running digest。

### PR 7 - Custom Mode App surface

**目标**：完成 Location -> Builder -> Preview -> Draft -> start -> canonical Session route。

- MODE_DEFINITIONS/MODE_SURFACES/ALL_SLOTS/side panel。
- Draft composition state、Profile save/delete、Plan tabs、diagnostics、recent Sessions。
- i18n/a11y/responsive/theme/empty-loading-error。
- feature flag 隐藏入口但保留历史 Session readback。

退出：App unit + Playwright + geometry benchmark；无 remount/data refetch regression。

### PR 8 - 内部基线、灰度与文档收口

**目标**：达到 M1 exit Gate。

- 50 次内部启动矩阵、隐私安全指标、failure injection。
- 10% Beta 配置、stop rules、rollback drill、operator runbook。
- 更新 Roadmap、technical debt、README、schema changelog、API docs。

退出：PRD §13/§15 指标与测试达标，Security/App/Core 复审通过。

---

## 9. TDD 与测试矩阵

### 9.1 L1 Schema

- ProductMode 五值；缺字段仍默认 Coding；未知显式值拒绝。
- Profile exact-one Agent、allowed kinds、consumer grammar、native-only、revision/digest brands。
- Snapshot version union、secret-shaped field 禁止、diagnostic exhaustiveness。
- AssetKind 第八类及 duplicate registration。

命令：

```bash
bun --cwd packages/schema test
bun --cwd packages/schema typecheck
```

### 9.2 L2 Core / database

- Profile valid/invalid/conflict/watcher/CAS/apply/delete/rollback/concurrent write。
- Resolver success、zero/multi agent、missing/stale ref、cross-location、bad binding、unconnected asset、deterministic ordering。
- Agent config YAML parse + Schema decode、hidden/disabled、Skill catalog restriction。
- clean database + existing database migration；Session/Snapshot atomicity and FK cascade。
- child/fork copy digest；move dependency recheck；deleted Profile historical read。
- exact retry same digest idempotent，不同 digest conflict。

命令：

```bash
bun --cwd packages/core test path/to/focused.test.ts
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
```

### 9.3 L3 HTTP / SDK

- all endpoints declared in HttpApi exerciser coverage/auth。
- capable new client full flow；old client list/event exclusion；direct get typed unsupported。
- API error mapping 不泄露 Prompt/Skill body、credential、full permission resources。
- start stale revision / flag off / missing dependency / conflict status。
- Custom 请求在全局 V2 flag true/false 两种进程配置下都由唯一 runtime policy 走同一 V2-native路径；G2 未满足时 capabilities/start fail closed。
- regenerate SDK and typecheck App consumer。

命令：

```bash
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun --cwd packages/aigcfroge test path/to/httpapi-custom-composition.test.ts --timeout 30000
bun --cwd packages/aigcfroge run test:httpapi
bun --cwd packages/aigcfroge typecheck
```

### 9.4 L4 App

- mode registry/href/draft root meta；invalid route。
- Custom slot render-all + display:none；ModeWorkspace 不复制、不 remount。
- Builder selection/binding/preview/diagnostics/profile CAS conflict。
- start stale 保留 Draft 和用户输入；成功 promote Draft 并进入 canonical Session route。
- Snapshot panel read-only；upgrade creates fork/new Session。
- flag off/old server/empty/error/dependency/version drift。
- 18 locale parity、keyboard/focus、light/dark、desktop/640px、English/Chinese overflow。

命令：

```bash
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun --cwd packages/app run test:e2e e2e/regression/custom-mode.spec.ts
bun --cwd packages/app run test:bench
bun --cwd packages/storybook build
```

### 9.5 L5 execution / security

- root always meta；direct root Agent replacement rejected。
- task allows only Snapshot Agent；task precheck 和 child create 后防线都单独测试。
- forged child create、foreign resume id、changed Agent registry identity、deleted runtime dependency rejected。
- CLI/Judge/background multi-agent denied in M1。
- Tool definitions equal Snapshot effective set；settle unknown/stale/removed registration never executes。
- process-local identity 变化保留现有 turn-level stale rejection；跨进程/升级时 stable fingerprint mismatch 阻断继续。
- Permission deny cannot be raised by Profile/requestedCapabilities/saved approval/presentation。
- root interruption stops child/tool fibers；不发布伪成功；tests 使用 Deferred/Latch/SessionStatus，不使用 sleep。
- two Sessions from one Profile have independent Snapshot rows and approvals。

### 9.6 全局交付门禁

```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
git diff --check
bun typecheck
bun run lint
```

测试永不从根目录运行；`bun typecheck`/lint 是最终跨包门禁，不是替代包级行为测试。

---

## 10. 指标、日志与隐私

允许记录：

```text
resolver duration bucket
profile/session/snapshot opaque IDs or digests
asset kind counts
diagnostic tags
start success/failure category
version drift count
delegation rejection count
dependency recheck outcome
```

禁止记录：

```text
Prompt/Skill/Agent正文
用户文件内容
credential/token/Authorization
完整 permission resources
模型请求 headers/body
未脱敏 absolute user paths
```

M1 指标：Plan 成功率 >=98%，preview->start >=95%，Snapshot 一致率 100%，未授权委派/静默升级/缺依赖回退均为 0，P50 首次可运行组合 <=3 分钟。

---

## 11. 风险与对冲

| 风险                     | 根因                                       | 简单方案                 | 选择的健壮方案                                                             |
| ------------------------ | ------------------------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| 旧客户端误解 Custom      | App unknown fallback Coding                | 直接扩 enum              | capable-client gating + typed unsupported + event/list 隔离                |
| Session 无 Snapshot      | 当前 create/prompt 两请求                  | create 后 PATCH metadata | 专用原子 start + 独立 Snapshot table                                       |
| Custom 跌回 V1           | 全局 V2 flag 默认 false且 handler 分叉分散 | 要求用户手工开 flag      | 唯一 runtime policy，Custom 强制 V2；G2 未过则不发布 capability            |
| Builder 能选不能跑       | AgentAsset 与 AgentV2 未桥接               | task 时临时 parse 文件   | AgentV2 transform + Snapshot frozen executor facts                         |
| Skill 越界曝光           | SkillV2 是 Location-wide                   | 只在 UI 隐藏             | Snapshot-local skill catalog + Runner/tool lookup seam                     |
| allowlist 只在 Prompt    | Mode policy 不含 Session facts             | 提示 meta 不要调用       | SessionComposition owner + task/child 双层门禁                             |
| Tool 定义/执行漂移       | materialize 无 allowlist                   | 只过滤 definitions       | 同 Materialization 捕获 allowlist registration 和 settle                   |
| Snapshot 保存伪 identity | 当前 registration identity 是进程对象      | 序列化 name 或对象字符串 | M1 native-tool stable fingerprint + turn-level object stale rejection 分层 |
| Profile 演变成权限系统   | requestedCapabilities 容易被误当 allow     | 预览写“仅请求”           | PermissionEffective 唯一 owner + leaf runtime assert                       |
| 已知资产事务债扩散       | Workflow/Plugin 内联写                     | 复制最近代码             | 按前五类 typed service + FileMutation 原语实现                             |
| Snapshot/Epoch 重复      | 两者都含模型相关数据                       | 合并一张表               | Snapshot=组合身份；Epoch=实际模型上下文，生命周期分离                      |
| 大 PR 难回滚             | 五层强耦合                                 | 一次交付 M1              | 8 个 gated vertical PR，入口最后开                                         |

### 11.1 停止灰度条件

任一命中立即隐藏入口并阻断新 start；安全类命中同时启用 execution kill switch：

- 跨 Location 资产读取。
- 非 Snapshot Agent 委派成功。
- Profile/asset watcher 改变运行中 Snapshot digest。
- 缺失依赖时自动使用默认 Agent 或最新 revision。
- Permission deny 被 requestedCapabilities、saved approval 或 presentation 提升。
- Session 已创建但 Snapshot 缺失/不可解码。
- 旧客户端把 Custom 展示或查询为 Coding。

---

## 12. M2-M5 准入 Gate

| 阶段                 | 只在满足以下条件后启动                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| M2 多 Agent/Workflow | M1 allowlist/取消/部分失败稳定；Workflow definition/execution owner 与 durable task identity 已批准                         |
| M3 MCP/审批          | canonical Session/Location scoped tool registration、credential reference、revocation、unattended 和唯一 grant owner 已批准 |
| M4 Trusted Extension | provenance/digest/trust/revision、owner Scope、mount-stop-quarantine-rollback 和跨端降级 ADR 已批准                         |
| M5 Code Presentation | Native/Code 能力等价、run_code 无 executor 引用、资源限制、中断和审计映射验证通过                                           |

这些 Gate 不允许通过“先塞进 Profile Schema 但 UI 隐藏”的方式绕过。M1 Schema 可以为版本演进保留 version 字段，但不能接受或静默忽略未实现 runtime kinds。

---

## 13. 验收清单

### 治理

- [ ] ADR-17 Accepted，supersede/amend 链清楚。
- [ ] Custom PRD Approved，M1 scope 与本计划一致。
- [ ] Product/Core/App/Security/Schema+SDK owner 签字。

### 架构

- [ ] 没有第二 Session route、ToolRegistry、Permission service、Agent registry 或 ModeWorkspace shell。
- [ ] Profile、Plan、Snapshot、Context Epoch、Draft 的真源和生命周期不重叠。
- [ ] Custom Profile 使用 typed registry + file，Snapshot 使用 Session-owned typed DB owner。

### 安全

- [ ] task + child create 双层 allowlist。
- [ ] Tool materialization + settlement 同一 effective set。
- [ ] runtime PermissionV2 重评估，Snapshot digest 不授权。
- [ ] 路径 containment、CAS、rollback、secret redaction、unattended fail-closed。

### 行为

- [ ] 临时组合和保存 Profile 均可启动。
- [ ] 同 Profile 两 Session 拥有独立 Snapshot。
- [ ] revision TOCTOU 返回 stale 并保留 Draft。
- [ ] 文件变化/删除不修改 running Snapshot；缺运行依赖明确阻断。
- [ ] upgrade 只能通过 fork/new Session。
- [ ] 旧客户端不把 Custom 解码为 Coding。

### UI

- [ ] 复用 shared ModeWorkspace/timeline/composer/side panel owners。
- [ ] desktop/narrow、light/dark、keyboard/focus、18 locales、全部状态通过。
- [ ] 新 UI 只用 v2 token，无 overlap、clipping、nested page cards。

### 交付

- [ ] affected package tests/typechecks、HttpApi exerciser、SDK generation、Playwright、benchmark、lint 全绿。
- [ ] 内部 50 次启动基线达标。
- [ ] rollout/rollback drill、stop metrics、operator notes 就绪。
- [ ] `docs/technical-debt.md`、Roadmap、schema changelog 与实际状态同步。

---

## 14. 执行入口

审批后的第一项工作不是创建实现分支，而是完成 **PR 0 治理与兼容决策**。PR 0 通过后：

```text
branch: custom-contracts
first code slice: PR 1 Schema + capable-client
commit/PR title: feat(schema): add custom composition contracts
```

`custom-mode` 可以作为历史路线图中的总称，但不建议作为承载 M0/M1 五层改动的长期巨型分支。每个后续 PR 都从前置提交合入后的最新 `main` 创建不超过三个词的短分支，使用 conventional commit；进入远程交付前按 `quality-to-pr` Gate 重新确认 issue、remote、最终 diff 和全部验证证据。
