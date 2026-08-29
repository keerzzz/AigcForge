# AigcForge V2 架构治理与发布路线图

> **发布裁决**：**有条件批准架构方向；不批准宣布 V2 完成；不批准直接把 `AIGCFROGE_V2_RUNTIME` 翻为默认开启。** 保留 Effect + SQLite + EventV2 + Location-scoped Runner 的总体方向，先修复 Session 生命周期 owner、桌面 sidecar 恢复与 V1/V2 端点迁移，再做装配收敛和 runner 提纯。
>
> **日期**：2026-08-29
>
> **当前基线**：`main@eeaec64f2`，已与 `origin/main` 核对一致；PR #60 已合并。
>
> **Owner**：Core Session/Event/Execution、App API/Runtime、Desktop、UI/QA、Security、Product/Architecture；各 Slice 的 DRI 见第 7 节。
>
> **来源交付物**：`/home/keer/.cursor/projects/media-win-data-aigcfroge/canvases/aigcfroge-v2-architecture-review.canvas.tsx`
>
> **研究材料**：完整智能体历史 `33cc3ae3-bbc0-48e6-86fc-53cdee5c2850` 与 `f9d543d2-60af-4c5b-bc48-b5b0d92a8032` 的全量日志；对应路径分别为 `/home/keer/.gemini/antigravity/brain/33cc3ae3-bbc0-48e6-86fc-53cdee5c2850/.system_generated/logs/transcript_full.jsonl` 与 `/home/keer/.gemini/antigravity/brain/f9d543d2-60af-4c5b-bc48-b5b0d92a8032/.system_generated/logs/transcript_full.jsonl`。

---

## 1. 文档状态与裁决边界

本文件把架构 Canvas 的批判、证据、根因和发布门禁整理成一份可执行路线图。它是治理和发布依据，不是“已完成能力”清单；未来方案必须在对应 ADR、代码、测试和故障注入证据完成后，才可从提案升级为事实。

### 1.1 结论分层

| 层级 | 含义 | 本路线图中的处理 |
| --- | --- | --- |
| **已证实** | 由当前代码、文档、内存 SQLite 探针或明确运行行为复核 | 直接进入治理计划；若影响数据一致性或发布承诺则阻断 |
| **较高概率** | 静态装配图或历史回归显示风险，但尚未由当前运行时身份测试证实 | 先做最小 probe；未证实前不做大规模重构或绝对化定罪 |
| **待验证** | 需要压力、故障注入、跨平台或真实环境才能判断 | 形成验证项，不把假设写成结论 |

### 1.2 发布总裁决

| 发布范围 | 裁决 | 必须满足 |
| --- | --- | --- |
| 当前架构方向 | **保留** | Effect、SQLite、EventV2、Session V2 durable admission、Location-scoped Runner 的边界继续演进 |
| Custom/V2 面向普通用户 | **阻断** | F1 生命周期全绿；sidecar-dead 可恢复；关键 fault injection 有证据 |
| `AIGCFROGE_V2_RUNTIME=true` 默认开启 | **阻断** | F1–F4 关闭；逐端点 contract matrix 与 owner identity 通过 |
| 企业 / 合规发行 | **阻断** | F5 Secret Vault 或等价的跨平台静态保护、备份、迁移与降级语义完成 |
| 显式实验/开发版本 | **可继续，但必须披露** | destructive endpoint 门控；不宣传 crash-safe、自动恢复或 encrypted-at-rest |

---

## 2. 当前架构骨架

### 2.1 保留的方向

```text
Desktop / App / TUI / API clients
                │
                ▼
        App API + Runtime / sidecar
                │
                ▼
      Composition Root + Location graph
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
 SessionV2  EventV2  SessionExecution
       │        │        │
       ▼        ▼        ▼
 Projection  Replay   process-local drain
       │                 │
       └──────┬──────────┘
              ▼
          SQLite / FileSystem / Provider / Tools
```

以下边界本身是合理的：

- durable prompt admission 与 provider execution 分离；
- `SessionV2.prompt(...)` 先写入 durable `session_input`，再由 `SessionExecution.wake(sessionID)` 触发 process-local drain；
- SessionRunner、模型解析、工具注册、权限和文件系统按 Location 作用域组织；
- EventV2 replay、Projection 与 Session-owned history/context epoch 有明确的目标分工；
- 本地 Session drain 在 clustering 前保持 process-local，不为了尚未出现的规模证据提前引入 Kafka、微服务或 PostgreSQL。

### 2.2 当前不能宣称的能力

- V2 不是全端点、全运行时的单一 canonical contract；
- Session 删除、重命名、消息删除已经与 EventV2 replay 等价；
- sidecar 崩溃后可以安全地自动重试所有工作；
- V2 已具备 durable execution identity、lease、fencing 或 crash-safe provider/tool settlement；
- 当前 SQLite 已被证明是严重锁瓶颈；
- opaque credential reference 等于静态加密；
- Composition Root 已被当前 runtime identity probe 证明只有一个实例；
- `runner/llm.ts` 需要一个新的通用 `TurnMiddleware` 框架。

---

## 3. 已证实问题与高概率风险

## F1：V2 Session 破坏性写入绕过事件生命周期，重放不再等价

**级别**：P1　　**置信度**：已证实　　**发布影响**：阻断 V2 破坏性端点与默认 runtime flip

### 证据

- `packages/core/src/session.ts:773-790`：`remove`、`removeMessage`、`setTitle` 直接写投影表。
- `packages/core/src/event.ts:519-528`：Event 流已有独立 remove owner，但 V2 remove 没有调用它。
- `packages/core/src/session/projector.ts:220-265`：已有 Created/Updated/Deleted 事件投影路径。
- `packages/aigcfroge/src/session/session.ts:650-680`：V1 会递归删除 child、发送 Deleted 并移除事件流，说明两条生命周期语义并不等价。
- `packages/core/src/session/sql.ts:25-35`：`parent_id` 没有自引用 FK 或级联约束。

内存 SQLite 探针复现了以下结果：

```text
删除前：SessionTable = 1，EventSequence = 1，EventTable = 1
V2 remove 后：SessionTable = 0，EventSequence = 1，EventTable = 1
同 ID 重建：产生两个 session.created.1，replay 失败
setTitle：当前投影为 renamed，EventV2 只有 created，重放后回到 first
父 Session 删除：子 Session 仍存在，parent_id 指向已删除父 ID
```

### 根因、影响与触发条件

- **共享根因**：命令面、事件流、投影视图和父子关系没有唯一的 Session lifecycle owner。
- **影响**：删除后事件仍存在；同 ID 重建制造重复 created；重放部分恢复后失败；标题在当前查询和历史重放之间不一致；子会话变成孤儿。
- **触发条件**：Custom/V2 会话执行删除、重命名或消息删除；导出、重放、恢复或审计依赖 EventV2 时，数据不一致会暴露。

### 分阶段处理

- **最小修复**：立即禁用或门控 V2 `delete`、`deleteMessage`、`rename`；复用现有 Event/Projector；把删除、重命名、消息删除纳入同一事务语义；补父子递归清理和重放测试。
- **健壮演进**：先用 ADR 裁定 delete 是 purge 还是可审计 tombstone；建立唯一 Session lifecycle command owner；所有调用面禁止直接写 `SessionTable`、`SessionMessageTable` 或 `EventTable`。
- **ADR**：需要。删除、审计、ID 复用和重放语义必须固化。
- **退出条件**：`create → rename → message delete → session delete → ID reuse → replay` 全程等价；无 partial replay；无 orphan `parent_id`。

## F2：Desktop sidecar 崩溃后只有日志，没有恢复 owner

**级别**：P1　　**置信度**：已证实　　**发布影响**：阻断“自动恢复/长任务可靠”承诺；生产级桌面 V2 阻断

### 证据

- `packages/core/src/session/run-coordinator.ts:17-105`：active owner 主要是进程内 Map/Fiber。
- `packages/core/src/session/runner/llm.ts:65-108`：代码明确列出 durable status/recovery 尚未闭环。
- `packages/core/src/file-mutation.ts:268-277`：tool side effect 与 settlement 之间的恢复仍是 TODO。
- `packages/desktop/src/main/server.ts:92-202`：sidecar exit 可观测，但没有 listener restart 契约。
- `packages/desktop/src/main/index.ts:224-230,339-375`：退出只记日志；启动逻辑只执行一次。

### 根因、影响与触发条件

- **共享根因**：durable admission 与 process-local execution 已分离，但启动恢复、运行身份、sidecar 监督和副作用 settlement 尚未形成控制平面。
- **影响**：sidecar 退出后不会自动重建后端，也不会将运行中 Session 标记为 `recovery_required`；用户只能重启应用；pending inbox 只有未来显式 wake/resume 才可能继续。
- **触发条件**：Provider、原生依赖、插件或内存压力导致 utility process 退出，或主机在 tool side effect 与 durable settlement 之间被中断。

### 分阶段处理

- **最小修复**：先提供持久化或可重建的 `server-dead` 终态与一键安全重启；启动时扫描 pending input；对不确定的 provider/tool 工作标记 `recovery_required`；由用户选择继续，不盲目自动重试。
- **健壮演进**：复用已有 WorkflowRun 的 `recovery_required` / CAS 经验，为 provider turn 建立 durable attempt、lease/fencing 和按副作用类别划分的 retry policy。
- **ADR**：需要。崩溃恢复、幂等性、外部副作用和 at-least-once 语义必须独立记录。
- **退出条件**：强杀 sidecar 后没有静默挂起；安全输入可继续 drain；未知副作用不自动重放；shell/file/MCP/plugin 的处理结果可解释。

## F3：V1/V2 双运行时迁移仍是当前主架构

**级别**：P1　　**置信度**：已证实　　**发布影响**：阻断 V2 默认开启；显式实验版本可继续但必须披露

### 证据

- `packages/aigcfroge/src/effect/app-runtime.ts:84-121`：V2 默认关闭，注释列出 auth/shape 尚未闭环。
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:372-442`：`messages/create` 固定走 V1。
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:802-889`：`prompt/command/shell` 固定走 V1，Custom 另有拒绝/强制规则。
- `packages/core/src/product-mode-policy.ts:102-109`：Custom 强制 V2，其他模式受全局 flag 影响。
- `specs/v2/todo.md:184-198`：V1 retirement 与 default flip 仍处在未来阶段。

### 根因、影响与触发条件

- **共享根因**：同一 Session API 同时承担 legacy 同步返回契约、V2 durable admission 和 Custom 强制 V2 三种语义。
- **影响**：`create/messages/prompt/command/shell` 仍固定走 V1；`delete/title/fork/permission/summary` 等按 mode/flag 分流；测试和 SDK 需要长期维护两套形状；任何 flag flip 都可能改变同一路由的数据源和 wire shape。
- **触发条件**：开启 `AIGCFROGE_V2_RUNTIME`、修改 Session handler、升级 generated SDK 或继续扩展 Product Mode。

### 分阶段处理

- **最小修复**：建立逐端点迁移矩阵，记录 canonical owner、输入/输出 schema、事件源、compat adapter、切换门槛和删除日期；矩阵全绿前不 flip 默认值。
- **健壮演进**：App 只消费一个 generated V2 contract；legacy 兼容留在 server edge；领域服务不得继续理解 V1 HTTP shape；按端点删除路径，不做一次性大爆炸迁移。
- **ADR**：优先更新既有 V2 retirement 计划；只有改变兼容承诺时新增 ADR。
- **退出条件**：同一路由只有一个 canonical shape；generated SDK 与服务端契约一致；旧 adapter 可删除且 wire shape/data source 语义不变。

## F4：Composition Root 有多套装配语言，owner 身份容易分叉

**级别**：P2　　**置信度**：较高概率，未证实　　**发布影响**：阻断多 listener、远程 placement 与 default flip；身份测试通过前不做大规模 Layer 重构

### 证据

- `packages/aigcfroge/src/server/server.ts:113-139`：listener 再次 `provideMerge AppLayer`。
- `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts:149-247,278-377`：route graph 同时装配 legacy 与 V2 roots。
- `packages/aigcfroge/src/effect/app-runtime.ts:123-253`：存在第二套 V1+V2 AppLayer 组合。
- `packages/core/src/location-layer.ts:96-306`：Location graph 继续组装大量共享与局部服务。
- `packages/core/src/session/execution.ts:18-30`：生产模块携带全局测试 seam。

### 处理

- **根因**：`AppLayer`、`LayerNode`、`LocationServiceMap`、HTTP routes 与 listener 都在部分组装重叠的 Database、EventV2、SessionExecution、TaskDriver、ApprovalPresence。
- **影响**：历史上已有 second Database、TaskDriver runtime missing、ApprovalPresence 重复实例等回归；当前是否仍有重复实例不能仅凭静态代码断言。
- **最小验证**：为上述五个 process owner 写 runtime identity probe，覆盖 instance/server/global 三面和两个 listener；先证明哪些实例必须共享、哪些实例必须按 Location 分离。
- **目标架构**：指定 `Server.listen()` 为唯一生产 composition root，route 只声明 requirements；V1 退役后只保留一套 LayerNode/graph builder；LocationMap 只构造 Location-scoped 服务，process-scoped owner 全由 root 注入。
- **ADR**：需要。process / location / session scope 与唯一 composition root 应固化。

## F5：凭据材料仍有三个明文 owner，现有止血不等于静态加密

**级别**：P2　　**置信度**：已证实　　**发布影响**：企业/合规版阻断；单用户本地 alpha 可作为已披露债务继续

### 证据

- `packages/core/src/credential/sql.ts:5-13`：`credential.value` 是明文 JSON。
- `packages/aigcfroge/src/auth/index.ts:10-35,73-88`：`auth.json` 明文存储，写入 mode 0600。
- `packages/aigcfroge/src/mcp/v2-auth.ts:9-36,77-82`：MCP OAuth 材料写入 `mcp-auth.json`。
- `packages/core/src/database/database.ts:22-94`：数据库/目录权限是止血措施；Windows 不等价于 owner-only。
- `docs/architecture/adr/ADR-21-mcp-credential-custody.md:17-115`：项目已正式承认明文与专项边界。

### 处理

- **根因**：Credential DB、provider `auth.json`、MCP `mcp-auth.json` 分别拥有秘密材料；opaque ref 只隔离 MCP binding，不保护材料本身。
- **影响**：本地文件读取、备份或导出泄漏时可能直接获得 API key/OAuth token；Linux/macOS 权限降低同机读取风险，但不等价于静态加密；Windows chmod 不能提供同等 owner-only 语义。
- **最小修复**：维持 ADR-21 的 fail-closed binding 与日志扫描；补 Windows ACL、备份、导出和恢复验证；产品文案明确“不保证 encrypted at rest”。
- **健壮演进**：另立 Secret Vault 专项，评估 OS Keychain / DPAPI / Secret Service 后端、opaque ref、版本化迁移、回滚、密钥丢失与跨平台降级。
- **ADR**：需要，产品与 Security 联合决策。

## F6：Session runner 是高变更冲突面，但不应再造 Middleware 框架

**级别**：P2　　**置信度**：已证实　　**发布影响**：不阻断当前实验发布；阻断继续向 `llm.ts` 直接追加大型职责

### 证据与处理

- `packages/core/src/session/runner/llm.ts:65-149`：集中 provider turn、snapshot drift、MCP、permission、tool settlement、verification、compaction、shell 和 input promotion 等职责。
- `packages/core/src/session/runner/llm.ts:151-1039`：turn/tool/shell/promotion 共同驻留；文件约 1043 行、约 49KB、依赖超过 20 个 collaborator。
- `AGENTS.md:207-219`：要求每个 provider turn 保留一个显式 `llm.stream(request)`，且 SessionRunner、模型、工具和权限保持 Location-scoped。

**根因**是功能增长速度快于边界提纯速度；继续堆 recovery、Plugin UI、M4/M5 或 provider-specific 分支会放大回归半径。

**最小修复**：保持唯一显式 `llm.stream`；按真实概念提取 Snapshot verification、Turn assembly、Tool settlement、Input promotion、Shell drain、Compaction transition；优先提取无副作用函数与既有 Service。

**健壮演进**：只有至少两个稳定扩展点证明出现重复后，才评估 typed phase algebra；任何 pipeline/middleware 扩展模型都需要 ADR、性能基线和不变量测试。

**ADR**：当前拆分不需要；新建可插拔执行框架才需要。

## F7：架构文档与真实仓库状态发生漂移

**级别**：P3　　**置信度**：已证实　　**发布影响**：不直接阻断运行时发布，但阻断把当前文档作为架构验收证据

### 证据与处理

- `ARCHITECTURE.md:68-113,196-211,265-277`：包数与 Custom 状态已过期。
- `docs/architecture/system-blueprint.md:129-183`：列出已不存在的 21 包拓扑。
- `packages/schema/src/product-mode.ts:5-19`：真实 `ProductMode` 已含 `custom`。
- `packages/app/src/pages/mode-workspace.tsx:1-30`：真实工作台已注册五模式。
- `packages/core/src/plugin/provider/aigcfroge.ts:1-15`：Core 从 generated SDK 导入 `CredentialValue`，反向泄漏契约 owner。

**最小修复**：校准 `ARCHITECTURE.md`、specs、blueprint；包清单从 workspace manifest 生成；Core 的 `CredentialValue` 改用 schema/core owner。

**健壮演进**：CI 校验文档中的包清单、ProductMode 集合、已实现阶段和依赖方向；禁止 generated SDK 成为 Core 类型真源。

**ADR**：不需要；这是事实源治理和边界修复。

---

## 4. 共享根因收敛

| 根因 | 关联问题 | 共同前提 | 一击必杀的治理动作 |
| --- | --- | --- | --- |
| **R1 · 生命周期 owner 不唯一** | F1 | `SessionTable`、EventV2、Projector 与 parent/child 可被不同入口独立修改 | 统一 lifecycle command；禁止调用面直写 projection/event 表；补重放等价测试 |
| **R2 · 执行身份不持久** | F2 | durable inbox 已有，但 drain、sidecar、job、status 主要 process-local | 先做 `server-dead` + `recovery_required` 人工恢复边界，再按副作用建设 attempt/lease/fencing |
| **R3 · 迁移期存在多套真理** | F3、F4、F7 | V1/V2 API、AppLayer/LayerNode、文档/代码同时重复表达系统 | endpoint matrix + 单 composition root + executable inventory |
| **R4 · 秘密 custody 分裂** | F5 | 三个材料 owner；opaque ref 只解决引用隔离 | 先分级安全目标，再做跨平台 Vault 迁移 |
| **R5 · 编排面持续吸收职责** | F6 | 功能增长速度超过边界提纯速度 | 复用已有服务，删除/归并优先；不先造 TurnMiddleware |

最关键的架构判断：**Event sourcing 本身不是问题，绕开唯一 command owner 才是问题；SQLite 本身也不是问题，没有 durable execution identity 才让崩溃后的“该不该重试”无法回答。**

---

## 5. V1/V2 端点迁移矩阵

迁移矩阵是 Slice 4 的唯一准入材料。以下是当前观察到的初始版本，实施时必须逐端点补齐真实 schema、测试和删除日期。

| 端点/能力 | 当前观察 | 目标 canonical owner | 兼容策略 | 默认切换门槛 |
| --- | --- | --- | --- | --- |
| `create` | 当前仍走 V1 | Session V2 admission / canonical SDK | server edge adapter；保持客户端可解释的返回 shape | create、event、projection、replay 等价 |
| `messages` | 当前仍走 V1 | Session history / V2 read model | 读路径兼容；不让领域服务理解 V1 HTTP shape | 历史选择、权限与分页契约一致 |
| `prompt` | 当前仍走 V1 | `SessionV2.prompt(...)` durable admission | V1 edge 适配到 V2 输入契约，或保留明确实验标识 | prompt ID 重试、delivery mode、resume 语义全绿 |
| `prompt_async` | 部分采用 V2 durable admission | V2 admission + advisory wake | 保留 edge compatibility，明确 `resume:false` admit-only | exact retry 与 Session/Prompt/delivery 匹配校验通过 |
| `command` | 当前仍走 V1 | V2 Session input / command owner | 按命令类型逐批迁移 | 命令输入、权限、取消和恢复契约一致 |
| `shell` | 当前仍走 V1 | Location-scoped execution + V2 status | 高风险副作用保留显式 gate | side effect 与 settlement 的恢复策略可证 |
| `delete` / `deleteMessage` | V2 破坏性路径已复现问题 | 唯一 lifecycle owner | 在 Slice 0/1 前禁用或门控 | purge/tombstone、递归 child、event/replay 全绿 |
| `setTitle` / rename | 目前投影可变但 EventV2 不完整 | lifecycle mutation command | 兼容旧读；写入只能进入事件化 owner | 当前读与 replay 标题一致 |
| `fork` | 按 mode/flag 分流 | V2 Session lifecycle/fork owner | edge adapter；明确 parent/child 与 snapshot 关系 | parent/child、权限、事件和重放一致 |
| `permission` | 按 mode/flag 分流 | Permission/Approval canonical owner | 保持 scope/expiry/revocation 的明确语义 | 不把 Project `always` 改名为 Session grant |
| `summary` | 按 mode/flag 分流 | Session history/context owner | 兼容已存在摘要 shape | reload history 与 durable continuation 一致 |

### 5.1 矩阵必填字段

每个端点必须记录：

```text
endpoint
canonical owner
input schema / output schema
V1 source / V2 source
event source and projection behavior
idempotency / retry behavior
permission and Location scope
compatibility adapter
contract tests / generated SDK parity
feature gate / rollout plan
removal date for legacy path
```

在矩阵未完成前，任何“V2 已全量”“默认 flag 可翻转”的声明均不成立。

---

## 6. 崩溃恢复与副作用策略

### 6.1 先诚实恢复，再自动恢复

第一阶段的目标不是让所有任务自动重跑，而是让系统在不确定时**明确告诉用户发生了什么**：sidecar 是否死亡、哪些输入已 durable admission、哪个 provider turn 可能已发出请求、哪些外部副作用无法证明未发生。

| 工作类别 | 崩溃后的最小策略 | 是否允许无确认自动重试 |
| --- | --- | --- |
| durable `session_input` 已提交但尚未 drain | 启动 sweep 后安全继续 drain；按 prompt ID 去重 | 允许，前提是 admission/idempotency 已证实 |
| provider 请求尚未发出且有可靠边界证据 | 继续 provider turn | 仅在边界证据可靠时允许 |
| provider 请求可能已发出但结果未 settlement | 标记 `recovery_required`，展示不确定性与下一步 | 不允许盲重试 |
| 只读工具且执行边界可证 | 依据工具契约恢复 | 需要工具级幂等证据 |
| 文件写入、shell、MCP、Plugin 等外部副作用 | 记录未知副作用，保留诊断、影响范围与人工确认动作 | 默认不允许 |
| sidecar 进程死亡 | UI 显示 `server-dead`；安全重启；启动 sweep；恢复可安全工作的输入 | 不以“重启成功”代替任务恢复证明 |

### 6.2 健壮恢复目标

在产品明确 SLA 后，再引入：

- durable provider-turn attempt；
- lease、owner epoch 与 fencing，防止旧进程继续提交；
- 副作用分类与幂等键；
- provider/tool settlement 的 CAS；
- `recovery_required`、`resumable`、`unknown_side_effect` 等持久化状态；
- 故障注入矩阵：provider 前/中/后、`Tool.Called` 后、side effect 后、settlement 前强杀。

没有这些契约之前，不允许以“自动恢复”作为产品卖点。

---

## 7. 分阶段治理路线

估算是架构复审层面的相对量级，不是承诺；每个 Slice 进入开发前仍需按仓库协议建立短分支、ADR/契约和受影响包验证。

| Slice | DRI（建议） | 范围 | 依赖 | 估算 | 退出条件 | 发布影响 |
| --- | --- | --- | --- | --- | --- | --- |
| **Slice 0 · 红线止血** | Core Session + App API + Product/Release | 禁用/门控 V2 delete、deleteMessage、rename；修正文档中的错误“已完成”声明 | 无 | 0.5–1 天 | 破坏性路径不再继续制造不可重放状态 | 立即阻断默认 flip |
| **Slice 1 · Lifecycle 一击必杀** | Core Session/Event/DB + QA | 确定 purge/tombstone；统一 parent/child、event、projection 删除；title/message mutation 事件化；补 replay probe | Slice 0 | 3–5 天 | create→rename→delete/recreate→replay 等价；孤儿数为 0 | F1 关闭前不发布 V2 destructive endpoints |
| **Slice 2 · Recovery 边界** | Desktop + Core Execution + App UI | `server-dead` UI、startup sweep、unknown side effect 分类；只恢复安全工作 | Slice 1 的状态命名可并行 | 4–7 天 | 强杀 sidecar 后无静默挂起；不盲重跑 shell/file/MCP | 阻断生产级长任务承诺 |
| **Slice 3 · Composition identity** | Architecture + App Runtime + Core | 为 Database/EventV2/SessionExecution/TaskDriver/ApprovalPresence 加 identity probe；确定唯一 root；移除生产 busy seam | Slice 0；可与 Slice 2 并行 | 3–5 天 | 三条 API surface 共享正确 owner；测试可正规注入 | 阻断多 listener、远程 placement 与 default flip |
| **Slice 4 · V2 retirement matrix** | App API + SDK + Core + QA | 逐端点记录 owner/schema/adapter/gate；App 改为一个 canonical SDK；删除已完成 shim | F1/F2/F3/F4 | 按端点分批 | flag 切换不改变 wire shape 或数据源语义；legacy 可按端点删除 | 阻断默认 runtime flip |
| **Slice 5 · Runner 提纯** | Core Session Runner | 抽取 snapshot、settlement、turn assembly、promotion、shell drain 边界；不改行为 | Slice 2–4 的状态/契约稳定 | 3–6 天 | `llm.ts` 缩小；关键不变量测试不降；无新通用框架 | 不阻断当前实验发布；阻断继续堆大职责 |
| **Slice 6 · Secret Vault 决策** | Security + Product + Core Credential + Desktop | 产品安全等级、OS 后端、迁移/回滚/丢失恢复 ADR | ADR-21 与产品安全分级 | 专项 | 企业版达到 encrypted-at-rest；本地版降级语义明确 | 企业/合规版阻断 |

### 7.1 推荐执行顺序

```text
Slice 0 红线止血
       ↓
Slice 1 Session lifecycle owner ───┐
       ↓                           │
Slice 2 Recovery boundary ─────────┤
                                   ▼
                         Slice 3 Composition identity
                                   ↓
                         Slice 4 V2 retirement matrix
                                   ↓
                         Slice 5 Runner 提纯
                                   ↓
                         Slice 6 Secret Vault 专项
```

Slice 2 与 Slice 3 可以在 Slice 1 完成明确的状态命名后并行，但不能用并行开发跳过 F1 的数据一致性止血。

---

## 8. 方案对冲与技术债声明

### 8.1 简单实现：先恢复诚实性

**方案**：

- 门控 V2 破坏性端点；
- 用现有事件/Projector 复用实现最小生命周期修复；
- sidecar 只提供 `server-dead`、安全重启、启动 sweep 和人工 `recovery_required`；
- 用 endpoint matrix 逐端点迁移；
- 加 runtime identity probe；
- 按真实概念拆分 `runner/llm.ts`，不引入新框架；
- 暂时保留现有凭据文件，但明确权限止血不等于加密。

**技术债声明**：该方案允许“重启后人工恢复”，不能声称 crash-safe；未知 provider/tool 副作用不会自动重试；本地凭据仍不是 encrypted-at-rest；V1/V2 兼容层在端点退休前仍然存在。

**适用条件**：本地 alpha、显式实验、没有生产级长任务 SLA 的阶段。

### 8.2 健壮架构：为生产恢复建立持久化控制平面

**方案**：

- 唯一 Session lifecycle owner 与事件/投影事务边界；
- durable execution attempt、lease、owner epoch、fencing 和 CAS settlement；
- 按副作用类别建立幂等与人工确认策略；
- 唯一 composition root，严格区分 process/location/session scope；
- App 只消费 canonical V2 contract，legacy 留在 edge 并按端点删除；
- Secret Vault 覆盖 OS keychain、跨平台降级、迁移、回滚和备份；
- Runner 在真实扩展点成熟后再引入 typed phase algebra（如果证据证明需要）。

**成本声明**：会增加 schema、迁移、故障注入、运维告警、兼容期和跨平台测试成本；没有产品 SLA、恢复目标和安全分级时，不应提前建设全部复杂度。

---

## 9. 被否决或尚未成立的方案

| 命题 | 当前裁决 | 原因与正确替代 |
| --- | --- | --- |
| SQLite 已构成严重锁瓶颈 | **当前不能成立** | 已有 WAL、NORMAL、`busy_timeout=5000`、64MB cache 与单连接 Semaphore；先做 1/4/16 Session 基准，不凭感觉换数据库 |
| Event + Projection 必然导致双重真理 | **已收窄** | 正常 durable publish 会把 projector、commit hook、sequence、event 放在同一事务；根因是绕过 publish 的 mutation |
| 当前一定存在重复 Database 实例 | **较高风险，未证实** | 装配图重叠且历史上发生过，但 Layer identity/memoMap 可能共享；先做 runtime identity probe |
| ProductMode 污染 Core，应删除 | **否决** | ProductMode 是已接受的一等领域分类；保留 durable classification，约束散落路由判断，把 execution routing 收敛到 policy owner |
| 必须新增 TurnMiddleware | **否决** | 已有 SessionCompaction、DoomLoop、Verifier、ReferenceChecker、ToolRegistry 等 collaborator；先提纯和复用，重复扩展点出现后再评估 |
| 所有 sidecar 崩溃工作都应自动重试 | **危险** | Provider、文件、shell、MCP、Plugin 的幂等性不同；安全输入可继续 drain，未知副作用进入 `recovery_required`，高风险动作需要用户确认 |

---

## 10. 发布门禁

| 门禁 | 验证场景 | 通过标准 | 级别 |
| --- | --- | --- | --- |
| 数据一致性 | `create → rename → message delete → session delete → ID reuse → replay` | 投影与事件等价；无 partial replay；无 orphan `parent_id` | **阻断** |
| 崩溃恢复 | provider 前/中/后、`Tool.Called` 后、side effect 后、settlement 前强杀 | 不重复未知副作用；出现可解释 `recovery_required` | **生产级 V2 阻断** |
| Composition | Database/EventV2/SessionExecution/TaskDriver/ApprovalPresence identity | 所有 API surface 使用正确的同一 process owner；Location 服务不跨域泄漏 | **阻断 flag flip** |
| API 迁移 | 逐端点 contract matrix + generated SDK parity | 同一路由只有一个 canonical shape；legacy adapter 可删除 | **阻断 flag flip** |
| 安全 | Linux/macOS mode、Windows ACL、备份/导出、日志扫描 | 安全等级与降级行为有证据；企业版静态保护满足目标 | **企业版阻断** |
| 性能 | 1/4/16 Session、事件重放、大历史 | 用 p95/p99、busy 错误、checkpoint 时长与错误率决定 SQLite 是否需要后续动作 | 非阻断，先测 |
| 工程 | 受影响包 typecheck/test/lint；不从根目录运行 test；git diff/format | 协议门禁全绿；无无关 diff；测试验证实际实现 | **阻断** |

### 10.1 运行时故障注入矩阵

至少覆盖：

1. provider 请求前进程终止；
2. provider 请求中进程终止；
3. provider 返回后、durable settlement 前终止；
4. `Tool.Called` 已持久化但 tool 未完成；
5. 文件写入、shell、MCP 或 Plugin 外部副作用后终止；
6. sidecar 退出后 Desktop 仍保持窗口；
7. 恢复后重复提交旧 owner 的 fencing 场景；
8. Session 删除、ID 重建和 EventV2 replay 场景。

每个场景都必须回答：**数据是否已提交、外部副作用是否可能发生、能否安全重试、用户需要看到什么、审计记录在哪里。**

---

## 11. ADR 与事实源治理计划

### 11.1 建议新增或更新的 ADR

| ADR | 主题 | 进入条件 |
| --- | --- | --- |
| 建议 ADR：Session lifecycle semantics | purge vs tombstone、父子递归、ID 复用、事件与投影等价 | Slice 0/1 开始前 |
| 建议 ADR：Execution crash recovery | attempt、lease/fencing、recovery_required、外部副作用与 at-least-once | Slice 2 需要生产级恢复承诺时 |
| 建议 ADR：Composition scopes | process/location/session scope、唯一 composition root、runtime identity | Slice 3 前 |
| 建议 ADR：Secret Vault | OS 后端、跨平台降级、迁移、回滚、备份与丢失恢复 | Slice 6 前 |
| 更新 V2 retirement plan | 逐端点迁移、generated SDK parity、legacy 删除日期 | Slice 4 前 |

编号由项目维护者按现有 ADR 序列确定，不在路线图中预先占用正式编号。

### 11.2 文档与代码事实源

- 包清单由 workspace manifest 生成或由 CI 校验，不能手工维护多份互相漂移的拓扑；
- `ProductMode` 集合、已完成阶段和 dependency direction 进入可执行检查；
- `ARCHITECTURE.md`、`system-blueprint.md` 与 `specs/v2/todo.md` 必须在对应 Slice 中同步；
- Core 不应从 generated SDK 反向取得领域类型真源；Credential 类型应回到 schema/core owner；
- 文档只能记录已经有证据的能力，提案必须保留“提案/待验证”标识。

---

## 12. 复查记录

### 12.1 已运行的验证

- `bun --cwd packages/core typecheck`：通过。
- `bun --cwd packages/aigcfroge typecheck`：通过。
- `bun --cwd packages/desktop typecheck`：通过。
- `git status --short --branch`、`git log -1 --oneline --decorate`、`git diff --check`、`git diff --stat origin/main...HEAD`：通过/无生产代码未提交改动。
- 内存 SQLite 探针：验证 V2 delete 未清理 EventSequence/EventTable、同 ID 重建造成重复 created/replay 失败、setTitle 未进入 EventV2、删除父 Session 后子 Session 成为孤儿。

### 12.2 验证边界

- 探针使用内存 SQLite，没有写入项目数据库。
- 没有从仓库根目录运行测试。
- 没有重启应用或服务。
- 没有修改生产代码。
- `F4` 的当前重复实例风险仍需 runtime identity probe；不能把历史回归直接写成当前已发生事实。
- SQLite 锁性能、真实 sidecar fault injection、Windows ACL 和 Secret Vault 仍需专门验证。

---

## 13. 关联文件

### 13.1 执行协议

- `CLAUDE.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `DESIGN.md`

### 13.2 既有架构与路线

- `docs/architecture/adr/ADR-11-product-mode-session-classification.md`
- `docs/architecture/adr/ADR-12-product-mode-entry-routing.md`
- `docs/architecture/adr/ADR-14-persistence-and-scope-strategy.md`
- `docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md`
- `docs/architecture/adr/ADR-17-custom-mode-composition-platform.md`
- `docs/architecture/adr/ADR-18-custom-mode-workflow-execution.md`
- `docs/architecture/adr/ADR-19-mcp-scoped-registration.md`
- `docs/architecture/adr/ADR-20-scoped-grant-model.md`
- `docs/architecture/adr/ADR-21-mcp-credential-custody.md`
- `docs/roadmap/custom-mode-roadmap.md`
- `docs/roadmap/assistant-mode-roadmap.md`
- `docs/roadmap/work-mode-roadmap.md`
- `docs/roadmap/external-cli-dispatch-roadmap.md`

### 13.3 关键代码路径

- `packages/core/src/session.ts`
- `packages/core/src/event.ts`
- `packages/core/src/session/projector.ts`
- `packages/core/src/session/sql.ts`
- `packages/core/src/session/run-coordinator.ts`
- `packages/core/src/session/runner/llm.ts`
- `packages/core/src/file-mutation.ts`
- `packages/aigcfroge/src/effect/app-runtime.ts`
- `packages/aigcfroge/src/server/server.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/desktop/src/main/server.ts`
- `packages/desktop/src/main/index.ts`
- `packages/core/src/credential/sql.ts`
- `packages/aigcfroge/src/auth/index.ts`
- `packages/aigcfroge/src/mcp/v2-auth.ts`
- `packages/core/src/database/database.ts`
- `packages/schema/src/product-mode.ts`
- `packages/core/src/plugin/provider/aigcfroge.ts`

---

## 14. 复审结论

AigcForge 的 V2 架构**方向正确但交付尚未闭环**。当前最重要的不是换技术栈，而是让一个 Session 的命令、事件、投影、执行身份、恢复状态和 UI 反馈拥有一致的真源与生命周期。

执行顺序必须是：

```text
先止血破坏性路径
→ 统一 Session lifecycle owner
→ 建立诚实的 sidecar / recovery 边界
→ 用 identity probe 收敛 Composition Root
→ 按端点退休 V1
→ 提纯 runner
→ 再为企业安全与生产恢复建设 Vault / durable attempt
```

在上述门禁通过前，产品、文档和 UI 均不得把 V2 描述为“全量完成”“自动恢复”或“静态加密已完成”。
