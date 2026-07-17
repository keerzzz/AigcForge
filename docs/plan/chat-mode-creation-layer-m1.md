# Chat 模式 M1 实施计划：提示词资产创建闭环

> 状态：REVIEW READY v3（2026-07-16 修订；**尚未批准实施**）
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/app` + `packages/sdk/js`
> 关联：[Chat PRD v3](../prd/chat-mode-creation-layer.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10/§7、[CONTEXT.md](../../CONTEXT.md)
> 依据：`CLAUDE.md`、根/包级 `AGENTS.md`、`effect`/`database`/`frontend-theming` skills、实际 V1/V2 Session/Agent/Tool/API/App 代码
> 最后更新：2026-07-16

---

## 0. 审批状态与执行 Gate

本版本吸收上一轮审批的阻断项，取消原 v2 的“全量推进、无 Gate 阻塞”结论。任何实现开始前必须确认下表。

| Gate             | 条件                                                                                                                                      | 阻塞范围                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **G0 文档真源**  | ADR-13/14 的 Accepted 状态与 `ARCHITECTURE.md` 变更已提交/合并；Chat PRD 不再写“ADR 提出”并明确本 M1 的内部 Agent 不属于“创建 Agent 资产” | 全部 Phase                          |
| **G1 产品契约**  | 产品确认字段上限、文件名规则和默认路径；本计划建议值见 §3.1                                                                               | Phase A-F                           |
| **G2 安全边界**  | Core/Security owner 接受：Chat M1 只允许 chat-orchestrator；`prompt_asset_apply` 是独立的用户确认权限，不复用模型 `edit` 权限             | Phase C-F                           |
| **G3 灰度/分析** | 明确 10% Beta 的外部分桶 owner、产品分析事件 owner 和 7 日归因设施                                                                        | 仅 Phase F Beta；不阻塞内部闭环开发 |

截至 2026-07-16，G0 在当前工作区仅表现为未提交修改，`HEAD/main` 仍将 ADR-13/14 列为 Proposed；因此本文状态只能是 Review Ready，不能标记 Approved。

---

## 1. 目标、非目标与本次收敛

### 1.1 M1 目标

用户从 `/mode/chat` 显式点击“新建提示词”，进入绑定 `mode=chat`、`agent=chat-orchestrator` 的 Draft/Session，通过对话生成候选，经只读预览、路径/冲突校验和明确应用确认后写入当前 Location 的 `.aigcfroge/prompts/`。应用成功后必须从 registry 重新查询到资产，并能在当前或新 Session 的 Composer 中插入复用。

### 1.2 非目标

- 不创建 Skill、Command、MCP、用户 Agent、工作流或协议文件资产。
- 不新增 EventV2 领域事件，不修改 `DraftTab.type`，不新增数据库 migration。
- 不注入 System Context，不提供表单编辑器、版本管理、归档、全局资产或导入导出。
- 不在 M1 实现 meta 跨模式自动委派。ADR-13 将跨模式委派列为后续独立决策，本期只做直接主路径。
- 不伪造 10% 分桶或 7 日分析设施；G3 未通过前只允许内部灰度。

### 1.3 相对 v2 的收敛

| v2 方案                                  | v3 决策                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Chat 默认 meta，软引导其 task 委派       | **删除**。新建提示词显式绑定 chat-orchestrator，服务端执行边界校验                    |
| chat-orchestrator 允许任意 task          | **删除**。task 默认 deny，避免间接委派 build 绕过写边界                               |
| 前端隐藏实现 Agent/Mode 限制             | **升级为服务端硬约束**；前端过滤只负责 UX                                             |
| apply 复用 `edit` 权限                   | **改为 `prompt_asset_apply` 独立动作**，避免与 chat-orchestrator `edit deny` 自相矛盾 |
| `writeAtomic` 锁住单次 rename 即视为事务 | **增加 PromptAssetService 目标级事务锁、revision/CAS 和安全回滚**                     |
| 只从 tool result 插入候选                | **增加 registry list/search API**；reload 后从 registry 重新查询再插入                |
| ConfigPromptPlugin 注入目录              | **删除**。M1 只有固定项目级 owner 目录，由 Location-scoped registry 直接加载          |
| 只列 V2 Agent/Tool                       | **补齐 V1/V2 双适配**；当前 App Session create 仍走 V1 handler                        |

---

## 2. 已核实的代码现状

| 领域                           | 现状                                                                                         | 结论                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Product Mode 路由/Session 分类 | `/mode/chat`、Draft mode、Session mode 已存在                                                | 复用，不新建路由体系                                      |
| App Session create             | `submit.ts` 当前只传 `mode`，HTTP create 始终走 V1 `Session.create`                          | 必须传 `agent` 并覆盖 V1 路径                             |
| V2 Session                     | `SessionV2.create({mode, agent})`、child mode 继承已存在                                     | 增加相同 Mode/Agent policy，防未来切换路径回归            |
| Agent                          | V1 Agent 与 V2 AgentPlugin 是两套注册路径                                                    | chat-orchestrator 必须双注册，共用 prompt 文本            |
| Tool                           | V1 `packages/aigcfroge/src/tool/registry.ts` 与 V2 `packages/core/src/tool/builtins.ts` 并存 | propose 工具必须提供双 adapter，共用 Core service         |
| Tool result                    | V1 ToolPart metadata 与 V2 `state.structured` 形态不同                                       | App 增加纯 normalization helper，不直接散落判断           |
| Registry                       | `State.create`、Agent watcher 模式可复用                                                     | PromptAsset 直接绑定固定 Location owner root              |
| 路径边界                       | `LocationMutation.resolve` 只保证不越过 Location                                             | 还必须验证 canonical target 位于 Prompt owner root        |
| 文件修改                       | `FileMutation` 只有方法级 KeyedMutex                                                         | PromptAssetService 增加覆盖完整 apply 生命周期的目标级锁  |
| HTTP API                       | group contract 与 handler 分文件，Location service 通过 `LocationServiceMap.get(...)` 注入   | 新建独立 prompt-asset group/handler，不只改 session group |
| Feature flag                   | 现有 `RuntimeFlags` + `/experimental/capabilities`                                           | 复用，不创建猜测性的 `feature-flag.ts`                    |
| 产品分析                       | 未发现可承担 7 日归因的既有 owner                                                            | G3 前不进入外部 Beta                                      |

---

## 3. 不变量与契约

### 3.1 Prompt Asset 数据契约

G1 建议值如下；产品若调整，必须在 Phase A 前一次性定稿，测试与 API 同步使用同一 schema。

```ts
export class Summary extends Schema.Class<Summary>("PromptAsset.Summary")({
  kind: Schema.Literal("prompt"),
  name: Name, // 1..80 Unicode code points，Location 内唯一
  description: Description, // 0..300 Unicode code points
  relativePath: RelativePath, // 1..240 UTF-8 bytes，位于 .aigcfroge/prompts/，以 .md 结尾
  revision: Revision, // 最终 bytes 的 SHA-256，仅服务端生成，不写入文件
}) {}

export class Info extends Schema.Class<Info>("PromptAsset.Info")({
  ...Summary.fields,
  template: Template, // 1..100_000 UTF-8 bytes
}) {}
```

规则：

- `Summary`、`Info`、`Frontmatter`、API payload 均使用 `Schema.Class`；错误使用 `Schema.TaggedErrorClass`，HTTP 错误单独使用 `Schema.ErrorClass`。
- `packages/schema` 只声明纯数据/长度约束，不依赖 Core 的 `FSUtil`、Location 或文件系统。
- 默认相对路径为 `.aigcfroge/prompts/<normalized-name>.md`：只做 Unicode NFKC、首尾空白裁剪；若名称本身不是合法文件段则返回 invalid，不静默删除字符或生成随机文件名。
- relativePath 总长不超过 240 UTF-8 bytes，每个文件段为 1..100 UTF-8 bytes。文件段禁止空值、`.`、`..`、控制字符和 Windows 禁用字符 `<>:"/\\|?*`；禁止绝对路径；统一 `/` 作为 wire path 分隔符。
- 路径语义校验由 Core 执行：lexical path 与 canonical path 都必须包含在 owner root 内。
- canonical identity 是 `(Location, relativePath)`；`name` 是 Location 内额外唯一约束，不替代 canonical identity。
- registry 生成 `revision`；客户端不得指定或伪造最终 revision。
- canonical 文件格式固定为 frontmatter `kind/name/description` + template body；`relativePath/revision` 为派生字段，不写入 frontmatter。序列化统一使用一个 PromptAsset serializer，正文末尾保留单个换行。

### 3.2 Chat Agent/Tool 不变量

- Chat M1 根 Session 唯一允许的主 Agent 是 `chat-orchestrator`。
- 新建 Chat Session 必须显式携带该 Agent；缺失或其他 Agent 返回 typed error，不回退 meta/build。
- `chat-orchestrator` 使用 fail-closed 权限：先 `* deny`，再仅允许 `read`、`glob`、`grep`、`question`、`propose_prompt_asset`、`prompt_asset_apply`。
- `task`、`edit`、`write`、`apply_patch`、`bash/shell` 均不可用；不能靠子 Agent 间接写盘。
- V1 prompt/command/shell 和 V2 create/switch/runner 都必须调用同一纯 `ProductModeAgentPolicy`，避免只保护一种运行时。
- 前端 Agent 过滤不是安全边界，只是避免展示无效选择。

### 3.3 propose/apply 边界

- `propose_prompt_asset`：模型可调用，只做 decode、规范化、路径验证、文件系统/registry 冲突检测，**不写盘**。
- `apply`：只有已认证客户端的显式用户操作可调用；服务端从 Session 读取 mode、agent、Location，不接受客户端伪造这些字段。
- apply 使用独立权限动作 `prompt_asset_apply`。它不复用 `edit`，也不向模型暴露 apply 工具。
- apply 必须重新执行全部校验，不能信任 tool result 或前端状态。

### 3.4 完整事务不变量

每个 target 的 apply 在同一个 PromptAssetService KeyedMutex 临界区内执行：

```text
validate request again
→ resolve owner-root target
→ read current bytes / revision
→ compare baseRevision
→ enforce overwrite confirmation
→ atomic write temp+rename
→ registry.reload
→ registry get-by-path + parse + revision compare
→ success
```

失败恢复规则：

- 新文件：只有当前 bytes 仍等于本次写入 bytes 时才删除。
- 覆盖文件：只有当前 bytes 仍等于本次写入 bytes 时才原子恢复旧 bytes。
- 当前 bytes 已被外部修改时，不得回滚覆盖外部修改，返回 `concurrent_modification`。
- 目标级锁覆盖 write、reload、readback、rollback 全过程；`writeAtomic` 自身的方法级锁只是第二层保护。
- `writeAtomic` 接受 `string | Uint8Array`，保证旧文件可以字节级恢复。

---

## 4. 用户与系统流程

```text
/mode/chat
  → 用户点击“新建提示词”
  → DraftTab { mode: "chat", agent: "chat-orchestrator" }
  → submit 创建 Session 时同时传 mode + agent
  → V1/V2 服务端 ProductModeAgentPolicy 校验
  → chat-orchestrator 询问必要信息
  → propose_prompt_asset（只读）
  → App normalization helper 提取候选
  → 右栏预览 + 冲突 diff
  → 用户点击应用；覆盖时显式二次确认
  → POST apply { candidate, baseRevision, overwrite }
  → PromptAssetService 完整事务
  → 返回 registry reload 后的最终资产
  → App invalidate/refetch PromptAsset list
  → 从 registry 结果插入 Composer
  → 页面 reload / 新 Session 后仍可搜索并插入
```

M1 不包含 meta task 子 Session，因此不存在 childSessionId 候选追踪、子 Session 权限 UI 或跨模式路由复杂度。

---

## 5. Phase 详细计划

### Phase A：Schema、路径契约与原子文件能力

#### 改动文件

| 文件                                              | 操作 | 说明                                                       |
| ------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `packages/schema/src/prompt-asset.ts`             | 新增 | `Info`、`Candidate`、`Frontmatter`、`BaseRevision` schema  |
| `packages/schema/src/index.ts`                    | 修改 | 导出 `PromptAsset` namespace                               |
| `packages/core/src/prompt-asset/path.ts`          | 新增 | owner root、wire path 规范化、安全文件名和双重 containment |
| `packages/core/src/file-mutation.ts`              | 修改 | 增加 `writeAtomic({target, content})`，支持 bytes          |
| `packages/core/test/prompt-asset-path.test.ts`    | 新增 | 纯路径/文件名测试                                          |
| `packages/core/test/file-mutation-atomic.test.ts` | 新增 | 原子写、旧 bytes 保留、temp 清理、并发串行                 |

#### 实现要求

- `writeAtomic` 复用现有 FileMutation KeyedMutex；temp 位于 target 同目录，名称包含 pid + monotonic/random suffix。
- rename 前确保父目录存在；任何失败都尝试清理本次 temp，但不覆盖原始错误原因。
- 不把 `FSUtil` 引入 `packages/schema`。
- 不创建单次使用的 config/plugin 抽象。

#### TDD

- 合法中文名称、默认路径、嵌套子目录。
- 拒绝空名称、超限字段、绝对路径、`..`、非法字符、非 `.md`、owner root 外路径。
- 拒绝 owner root 内符号链接指向 root 外；Location 内但 owner root 外同样拒绝。
- temp 写失败不创建/修改 target；rename 失败旧 bytes 一致；bytes BOM 保持。
- 同 target 并发 `writeAtomic` 串行；不同 target 可并发。

#### 验证

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
```

---

### Phase B：Location-scoped PromptAsset Registry

#### 改动文件

| 文件                                               | 操作 | 说明                                               |
| -------------------------------------------------- | ---- | -------------------------------------------------- |
| `packages/core/src/prompt-asset.ts`                | 新增 | registry Service、State、load/list/get/find/reload |
| `packages/core/src/location-layer.ts`              | 修改 | 将 PromptAsset layer 接入每个 Location             |
| `packages/core/test/prompt-asset-registry.test.ts` | 新增 | load/reload/watcher/去重/revision                  |
| `packages/core/test/location-layer.test.ts`        | 修改 | 证明 LocationServiceMap 提供 PromptAsset           |

#### Interface

```ts
interface PromptAsset.Interface {
  list(): Effect.Effect<ReadonlyArray<PromptAsset.Info>>
  getByPath(relativePath: string): Effect.Effect<PromptAsset.Info, PromptAsset.NotFoundError>
  findByName(name: string): Effect.Effect<PromptAsset.Info | undefined>
  reload(): Effect.Effect<void>
}
```

#### 实现要求

- 固定 source：`<Location.directory>/.aigcfroge/prompts/`；不新增 ConfigPromptPlugin，不读取全局 config directory。
- 复用 `State.create`；load 使用 `ConfigMarkdown.parseOption` + typed frontmatter decode。
- `relativePath` 从 Location 计算；`revision` 使用现有 `Hash.sha256` 对最终 bytes 计算。
- 无效文件跳过并记录脱敏 warning：只记相对路径和 error tag，不记 template/旧内容。
- 同 path 不可能重复；同 name 多文件视为 registry conflict，不能依赖加载顺序静默覆盖。
- watcher 只响应 owner root 下 `.md` 的 add/change/unlink；禁止“所有 `.md` 都 reload”。
- watcher 使用 `forkIn(scope)`；测试使用 `pollWithTimeout`，禁止固定 sleep。

#### TDD

- 空目录、单资产、中文 frontmatter、无效 frontmatter、同名冲突。
- reload 后新增/修改/删除可见；revision 随 bytes 改变。
- Location A/B registry 隔离。
- owner root 外 Markdown 变化不触发 registry reload。

#### 验证

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
```

---

### Phase C：PromptAssetService 完整事务

#### 改动文件

| 文件                                              | 操作 | 说明                                                                            |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `packages/core/src/prompt-asset-service.ts`       | 新增 | propose/apply、目标级事务锁、revision/CAS、回滚                                 |
| `packages/core/src/location-layer.ts`             | 修改 | 接入 PromptAssetService，提供 registry/FileMutation/Permission/LocationMutation |
| `packages/core/test/prompt-asset-service.test.ts` | 新增 | 完整故障注入与并发测试                                                          |

#### Domain Interface

```ts
interface PromptAssetService.Interface {
  propose(input: PromptAsset.Candidate): Effect.Effect<PromptAsset.ProposeResult, PromptAsset.Error>
  apply(input: {
    candidate: PromptAsset.Candidate
    baseRevision: string | null
    overwrite: boolean
    sessionID: SessionID.ID
  }): Effect.Effect<PromptAsset.Info, PromptAsset.Error>
}
```

`agent`、Location 和 Product Mode 不在客户端 payload 中：service/handler 通过 `sessionID` 查询真值。

#### 错误分类

- `invalid_candidate`
- `path_escape`
- `owner_root_escape`
- `name_conflict`
- `path_conflict`
- `stale_revision`
- `overwrite_confirmation_required`
- `permission_denied`
- `write_failed`
- `reload_failed`
- `readback_mismatch`
- `rollback_failed`
- `concurrent_modification`

错误 message 不包含 template、旧文件正文或完整敏感内容。

#### 实现要求

- propose 同时检查 registry 和真实文件系统。目标存在但无法解析为 PromptAsset，仍返回 path conflict。
- apply 进入锁后重新 decode、resolve、检查 owner root 和冲突；不信任前端传来的 status/existing。
- `baseRevision=null` 代表 propose 时目标不存在；apply 时若已出现文件，返回 stale。
- 覆盖必须满足 `overwrite=true` 且 baseRevision 等于当前 bytes revision。
- 写后 reload 必须通过 registry `getByPath` 读取最终资产，比较字段与 revision。
- 回滚使用旧 bytes；回滚前先验证当前 bytes 仍为本次写入 revision。
- apply 使用独立 `prompt_asset_apply` 权限动作；用户点击是明确确认，不再触发重复的通用 edit permission dock。

#### TDD

- 正常创建、中文名称、同名/同路径冲突、覆盖确认。
- registry 外已有文件不允许静默覆盖。
- propose 后外部创建/修改目标，apply 返回 stale。
- write/reload/parse/readback 失败：新文件不存在或旧 bytes 一致。
- A 写入后校验失败、B 成功写入时，A 不得回滚覆盖 B。
- 当前文件被外部修改后 rollback 返回 concurrent，不覆盖外部内容。
- Permission deny 不写盘；错误/log 不含 template。
- service 重建后 registry 仍可加载资产。

#### 验证

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
```

---

### Phase D：chat-orchestrator、双 Tool Adapter 与 Mode 硬边界

#### 改动文件

| 文件                                                                  | 操作      | 说明                                            |
| --------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| `packages/core/src/product-mode-agent-policy.ts`                      | 新增      | V1/V2 共用纯 policy                             |
| `packages/core/src/agent/prompt/chat-orchestrator.ts`                 | 新增      | V1/V2 共用 system prompt 文本                   |
| `packages/core/src/plugin/agent.ts`                                   | 修改      | V2 chat-orchestrator 注册和权限                 |
| `packages/aigcfroge/src/agent/agent.ts`                               | 修改      | V1 chat-orchestrator 注册和等价权限             |
| `packages/core/src/tool/propose-prompt-asset.ts`                      | 新增      | V2 Tool adapter                                 |
| `packages/core/src/tool/builtins.ts`                                  | 修改      | 注册 V2 propose tool                            |
| `packages/aigcfroge/src/tool/propose-prompt-asset.ts`                 | 新增      | V1 Tool adapter，调用同一 Core service          |
| `packages/aigcfroge/src/tool/registry.ts`                             | 修改      | 注册 V1 propose tool                            |
| `packages/core/src/session.ts`                                        | 修改      | V2 create/switch policy                         |
| `packages/core/src/session/runner/llm.ts`                             | 修改      | provider turn 前 fail-closed policy guard       |
| `packages/aigcfroge/src/session/session.ts`                           | 修改      | V1 create policy                                |
| `packages/aigcfroge/src/session/prompt.ts`                            | 修改      | V1 prompt/command/shell 执行前 policy guard     |
| `packages/app/src/context/tabs.tsx`                                   | 修改      | `DraftTab.agent?: string`，迁移保持 spread      |
| `packages/app/src/components/prompt-input/submit.ts`                  | 修改      | create 同时传 mode + draft/current agent        |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | 修改      | Chat 仅展示 chat-orchestrator；非 Chat 不展示它 |
| V1/V2 Agent/Tool/Session 测试                                         | 新增/修改 | 双路径一致性                                    |

#### ProductModeAgentPolicy

M1 规则：

```text
mode=chat:
  root primary agent 必须是 chat-orchestrator
  shell/command 拒绝
  prompt agent 必须是 chat-orchestrator
other modes:
  chat-orchestrator 不可作为 primary agent
```

- child/fork 继承 Product Mode；M1 chat-orchestrator 无 task，所以不会创建资产委派 child。
- 对历史错误状态的 Chat Session，runner 返回明确 typed error，不静默回退 meta/build。
- App 隐藏无效 Agent，但服务端仍独立校验。

#### chat-orchestrator Prompt

单一职责：

```text
询问受众/输入/输出/约束
→ 调 propose_prompt_asset
→ 告知用户在右栏预览和应用
→ 绝不调用通用写入、shell 或 task
```

不得包含 meta 的 “Delegate or Do It Yourself” 或“简单文件自己 Write”指令。

#### Tool Adapter 输出

- Core service 返回统一 `ProposeResult`。
- V2 adapter 将其写入 structured output。
- V1 adapter 将同一结构写入 ToolPart metadata，文本 output 只给模型短摘要。
- V1 adapter 从 `InstanceState.context` 取得当前 directory，通过 `LocationServiceMap.get(Location.Ref)` 提供 `PromptAssetService`；`ToolRegistry.defaultLayer/node` 只在组合根增加一次 `LocationServiceMap.layer`，不在 execute 内重建 LayerMap。
- 两个 adapter 都不写盘，不复制校验逻辑。

#### TDD

- V1/V2 Agent 都注册、非 hidden、primary、权限等价。
- `edit/write/apply_patch/bash/task` 均被拒，且不弹通用写权限确认。
- propose 在 V1/V2 都返回等价结构且文件系统无变化。
- Chat create 缺 agent、传 meta/build 均失败；传 chat-orchestrator 成功。
- Coding/Work/Assistant 不能选择 chat-orchestrator。
- V1 prompt 伪造 agent=build 被拒；V2 switch/runner 同样被拒。
- App Draft create 请求真实包含 `mode=chat, agent=chat-orchestrator`。

#### 验证

```bash
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
```

---

### Phase E：Prompt Asset HTTP API、SDK 与 Chat Surface

#### 改动文件

| 文件                                                                             | 操作 | 说明                                                             |
| -------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts`   | 新增 | typed list/apply API 和显式 API errors                           |
| `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts` | 新增 | LocationServiceMap 注入、session 真值查询、domain→API error 映射 |
| `packages/aigcfroge/src/server/routes/instance/httpapi/api.ts`                   | 修改 | 挂载 PromptAsset API group                                       |
| `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts`                | 修改 | 提供 promptAssetHandlers                                         |
| `packages/sdk/js/src/v2/gen/*`                                                   | 生成 | list/apply SDK                                                   |
| `packages/app/src/components/chat/prompt-asset-candidate.ts`                     | 新增 | V1/V2 tool result normalization 纯函数                           |
| `packages/app/src/components/chat/chat-right-panel.tsx`                          | 新增 | 预览/已保存资产/上下文入口                                       |
| `packages/app/src/components/chat/chat-preview-tab.tsx`                          | 新增 | 候选预览、冲突 diff、应用                                        |
| `packages/app/src/components/chat/chat-prompt-assets.tsx`                        | 新增 | registry search/list/insert                                      |
| `packages/app/src/components/mode-surfaces.tsx`                                  | 修改 | chat RightPanel 接入                                             |
| `packages/app/src/pages/home.tsx`                                                | 修改 | “新建提示词”创建带 agent 的 Draft                                |
| `packages/app/src/i18n/*.ts`                                                     | 修改 | 18 locale 完整键值，不依赖英文 fallback 通过 parity              |
| `packages/app/src/i18n/parity.test.ts`                                           | 修改 | 新 key 全 locale 存在且非空                                      |
| App/API 测试                                                                     | 新增 | normalization、状态机、错误映射、交互                            |

#### API 契约

```text
GET  /prompt-asset?search=<optional>
  → 当前 Location 的 PromptAsset.Summary[]，不批量返回 template

GET  /prompt-asset/content?path=<relativePath>
  → 单个 PromptAsset.Info

POST /session/:sessionID/prompt-asset/apply
  payload: { candidate, baseRevision, overwrite }
  → reload 后的 PromptAsset.Info
```

要求：

- handler 从 path sessionID 查询 Session，验证 `mode=chat`、agent policy，并确认 Session Location 与当前 Instance/Workspace 路由一致；不得使用其他 Location 的 sessionID 驱动当前目录写入。
- API error 使用稳定 name/reason/message wire shape；domain service 不依赖 HttpApi 类型。
- list/get 是读取能力，feature flag 关闭后仍保留；apply/create UI 受 flag 控制。list 只返回 Summary，选择/插入时再按 path 获取完整 Info，避免批量传输模板正文。
- apply 成功后 App invalidate list query，并只使用 API 返回/registry refetch 的最终资产更新 UI。

#### UI 要求

- 预览展示 name、description、完整 template、Location、relativePath。
- 候选无效时应用按钮 disabled；pending 时尺寸稳定且防重复提交。
- 冲突展示旧/新 diff；只有二次确认后发送 `overwrite=true`。
- “插入”先从 registry list 选择 Summary，再通过 get-by-path 读取最终 Info；不从未持久化 candidate 执行。
- 页面 reload、新 Session 都能搜索已保存资产并插入。
- 使用 v2 token，无硬编码颜色；键盘焦点、ARIA、窄屏和明暗主题遵循 `DESIGN.md`。
- 测试沿用仓库现有 Bun + happy-dom/纯 controller 模式；不凭空引入 `@solidjs/testing-library`。若确需引入，先单独评审依赖。

#### 验证

```bash
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun run lint
```

---

### Phase F：E2E、feature flag、内部灰度与 Beta Gate

#### 改动文件

| 文件                                                                             | 操作      | 说明                                         |
| -------------------------------------------------------------------------------- | --------- | -------------------------------------------- |
| `packages/core/src/flag/flag.ts`                                                 | 修改      | `AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET`   |
| `packages/aigcfroge/src/effect/runtime-flags.ts`                                 | 修改      | 暴露 runtime capability                      |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/experimental.ts`   | 修改      | capabilities 增加 `chatPromptAsset`          |
| `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/experimental.ts` | 修改      | 返回 capability                              |
| `packages/core/src/tool/propose-prompt-asset.ts`                                 | 修改      | flag=false 时不注册/不暴露 propose           |
| `packages/aigcfroge/src/tool/registry.ts`                                        | 修改      | V1 registry 按 capability 排除 propose       |
| `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts` | 修改      | flag=false 时 apply fail-closed，list 可用   |
| `packages/app/src/components/chat/*`、`packages/app/src/pages/home.tsx`          | 修改      | capability 控制创建/apply UI，读取入口保留   |
| `packages/aigcfroge/test/prompt-asset/e2e.test.ts`                               | 新增      | 默认 V1 生产路径完整闭环                     |
| `packages/core/test/prompt-asset-v2-smoke.test.ts`                               | 新增      | V2 Agent/Tool/Session/Location service smoke |
| 结构化日志/分析 adapter                                                          | G3 后确定 | 不记录正文                                   |

#### Feature flag 语义

- flag=false：隐藏新建/应用入口，propose tool 不进入 Agent 可见工具集；已保存资产 list/get/search/insert 仍可用。
- flag=true：启用内部创建闭环。
- 仓库内只实现 boolean capability；10% 用户分桶由 G3 指定的部署/实验平台完成，不在客户端用随机数伪造。

#### E2E

默认生产路径：

```text
Chat 首页新建
→ Draft mode+agent
→ V1 Session create
→ V1 propose tool
→ 预览
→ apply API
→ reload/refetch registry
→ 页面 reload
→ 新 Session search + insert
```

补充：

- V2 adapter/service smoke，确保未来打开 `AIGCFROGE_V2_RUNTIME` 不绕过 policy。
- flag 关闭后创建入口消失但已有资产仍可 list/get/插入。
- 故障注入后无半写；旧 bytes 保持；日志不含 template。

#### 指标与 Beta

内部阶段可以记录不含正文的结构化操作日志：`operation`、`result`、`reason`、`duration_ms`、`version`。以下产品事件只有 G3 明确 owner 后才能实现并用于 Beta：

- `chat_prompt_draft_started`
- `chat_prompt_preview_ready`
- `chat_prompt_apply_requested`
- `chat_prompt_applied`
- `chat_prompt_apply_failed`
- `chat_prompt_inserted`

7 日复用率必须使用 `(installation/user scope, Location, relativePath/revision)` 的经批准匿名关联方案；没有归因设施时不得用 Session 文本或 template 代替。

#### 验证

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app test
bun typecheck
bun run lint
```

测试仍必须从具体包执行；上面的 `bun typecheck` 是仓库允许的全仓类型检查，不是根目录测试。

---

## 6. 依赖图与执行顺序

```text
G0 + G1 + G2
      │
      ▼
Phase A schema/path/writeAtomic
      │
      ▼
Phase B registry + Location layer
      │
      ▼
Phase C transaction service
      │
      ├──────────────┐
      ▼              ▼
Phase D dual runtime Phase E API/App shell 可先做 mock contract
      └──────┬───────┘
             ▼
Phase E integration + SDK
             │
             ▼
Phase F E2E/internal flag
             │
          G3 passed
             ▼
          10% Beta
```

| Phase |   预估 | 说明                                   |
| ----- | -----: | -------------------------------------- |
| A     | 1-1.5d | Schema、owner path、bytes atomic write |
| B     | 1-1.5d | Registry、watcher、Location layer      |
| C     | 2-2.5d | 完整事务、CAS、故障注入                |
| D     | 2-2.5d | V1/V2 Agent/Tool/Session policy        |
| E     | 2.5-3d | API、SDK、App 查询/预览/插入           |
| F     | 1.5-2d | 双路径验证、flag、内部 E2E             |

**工程估算：10-13d，不含 G0/G1/G2 等待和 G3 分析设施建设。** 原 v2 的 6.5d 未覆盖双运行时、API handler、registry 复用入口和完整事务，作废。

---

## 7. 影响范围

| 包/区域              | 主要修改                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/schema`    | PromptAsset schema + export                                                                    |
| `packages/core`      | path、registry、service、FileMutation、LocationServiceMap、V2 Agent/Tool、Session policy、flag |
| `packages/aigcfroge` | V1 Agent/Tool/Session guard、PromptAsset HTTP group/handler、RuntimeFlags、E2E                 |
| `packages/app`       | Draft agent、Session create payload、Agent 过滤、Chat panel、registry search/insert、i18n      |
| `packages/sdk/js`    | OpenAPI 生成结果                                                                               |
| 文档                 | ADR/ARCHITECTURE/PRD 状态同步属于 G0，不与功能代码混在同一“已批准”假设中                       |

明确不修改：

- EventV2 schema/table
- `DraftTab.type`
- System Context registry
- DB migrations
- preRoute/intent/engine-selector
- PROMPT_META 跨模式路由
- ConfigPromptPlugin/global prompt source

---

## 8. 验收清单

### 架构/安全

- [ ] G0/G1/G2 有明确 owner 审批记录。
- [ ] Chat 根 Session 只能使用 chat-orchestrator；服务端 V1/V2 均 enforce。
- [ ] chat-orchestrator 无 task/edit/write/apply_patch/bash/shell 能力。
- [ ] propose 不写盘；apply 不作为模型工具暴露。
- [ ] apply 使用 `prompt_asset_apply`，不复用被 deny 的 `edit`。
- [ ] target lexical/canonical 都位于 `.aigcfroge/prompts/`。

### 数据/事务

- [ ] 正常创建、中文名称、同名/同路径冲突、取消、覆盖确认、连续点击。
- [ ] 绝对路径、`..`、非法字符、owner root 外路径、符号链接越界、超限模板全部拒绝。
- [ ] registry 外已有文件不会被静默覆盖。
- [ ] propose→apply 间文件变化返回 stale。
- [ ] 写入/reload/readback 失败后，新文件不存在或旧 bytes 一致。
- [ ] 并发失败回滚不会覆盖另一成功写入或外部修改。
- [ ] 重建 Location service/页面 reload 后仍可检索资产。

### App/复用

- [ ] Draft create 请求同时携带 `mode=chat` 与 `agent=chat-orchestrator`。
- [ ] 预览、diff、pending、error、empty 状态完整。
- [ ] apply 后从 registry refetch，插入使用最终持久化资产。
- [ ] 新 Session 可 search/insert 已保存资产。
- [ ] 桌面/窄屏、键盘、ARIA、明暗主题、中英文溢出通过。
- [ ] 18 locale 新 key 完整。

### 工程

- [ ] 受影响包 typecheck/test 通过；没有从仓库根目录执行 `bun test`。
- [ ] 无 `any`、无不必要 alias/star import、无 raw fs/fetch 绕过 Effect service。
- [ ] 新 Effect 模块自导出；错误为 typed schema；后台 watcher 使用 `forkIn(scope)`。
- [ ] 日志/API error 不含 template 或旧文件正文。
- [ ] SDK 通过正式脚本重新生成。

---

## 9. 灰度、回滚与监控

- 内部 flag 首先验证 50 次有效 apply 尝试；G3 未通过前不进入外部 10% Beta。
- 关闭 flag 只隐藏创建/apply/propose，保留已有资产读取和插入。
- 应用代码回滚不删除用户资产；单事务失败仅按 §3.4 安全恢复。
- 任一 owner-root escape、未确认覆盖、旧内容被错误覆盖、日志正文泄露均立即停止内部灰度。
- 24h 成功率阈值和 7 日复用率只有在 G3 数据口径落地后才作为 Beta Gate；未落地前不得宣称已测量。

---

## 10. 每 Phase 改完即审模板

```text
复查结论:
- Phase / 影响文件:
- 命中协议/skills:
- V1 路径验证:
- V2 路径验证:
- 安全边界:
- 事务/并发验证:
- 已运行命令:
- 未运行命令及原因:
- 剩余 Gate/风险:
```

---

## 11. 剩余开放问题

1. **G0 文档提交顺序**：ADR/ARCHITECTURE/PRD 必须先形成一致真源，再批准功能计划。
2. **G1 字段上限**：本计划给出建议值；产品只需确认或一次性调整，禁止实现中散落 magic number。
3. **G2 apply 授权**：建议 `prompt_asset_apply` 为用户显式操作动作；若 Security owner 要求额外 dock，必须使用该独立动作，仍不可复用 `edit`。
4. **跨进程竞争**：M1 使用进程内目标锁 + revision 检测 + 不覆盖外部修改的回滚规则。若要求严格跨进程 CAS，需要独立文件锁/事务 ADR，不在实现中临时发明。
5. **G3 分析设施**：需要确定外部分桶和 7 日归因 owner；未确定不阻塞内部闭环，但阻塞 Beta。
6. **未来 meta 委派**：另立设计，必须解决跨模式 owner、child candidate 可见性、权限继承和审计；M1 不预埋半成品。

---

## 12. 重新审批结论模板

```text
审批结论: APPROVED / CHANGES REQUESTED
G0 文档真源: PASS / FAIL
G1 产品契约: PASS / FAIL
G2 安全边界: PASS / FAIL
G3 Beta 基础设施: PASS / DEFERRED / FAIL
Core owner:
Security owner:
App owner:
允许启动的 Phase:
附加条件:
```
