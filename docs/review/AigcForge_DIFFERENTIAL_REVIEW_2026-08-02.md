# AigcForge `todo-task` 修复后复审报告

- **复审日期**：2026-08-02（星期日）
- **基线**：`main` (`a041ca617315`)
- **目标**：`todo-task` (`5b0a9b24164b`)
- **完整范围**：`main..HEAD`，8 commits，39 files，`+2616/-134`
- **修复范围**：`ff5a62268..HEAD`，2 commits
- **结论**：❌ **REJECT / 暂不批准合并**
- **总体风险**：HIGH

## 1. Executive Summary

| Severity    | Count |
| ----------- | ----: |
| 🔴 CRITICAL |     0 |
| 🟠 HIGH     |     2 |
| 🟡 MEDIUM   |     3 |
| 🟢 LOW      |     1 |

原审批的并发 append、PATCH WriteInfo、后台 success/failure/cancel settle、跨 Session patch、createdAt、迁移 normalize、taskwrite deny 等主修复均已落地并通过测试。

但复审完整上下游后发现两个新的兼容状态流阻断：

1. 当前默认运行时仍是 V1，`/todo` 却无条件改读 TaskTable，导致当前默认路径的 V1 `todowrite` 数据不可见；
2. V2 旧 `todowrite` 转发到 Task 时会为全列表重新生成 ID，破坏正在运行的 background task 与稳定 task ID 的关联，settle patch 随后静默 no-op。

此外，`Schema.Class` 豁免理由经 Effect 官方源码和 exact-version 实测不成立；后台失败 digest 使用 `Cause.pretty` 也不符合“错误摘要 + Clean Logs”要求。

## 2. 原审批项闭环矩阵

| 原 Finding                    | 状态                                              | 证据                                                   |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| HIGH-1 双真源无兼容桥         | ⚠️ 部分关闭，引入 V1 默认路径回归与旧工具 ID 丢失 | `session/todo.ts` 转发已实现，但兼容边界不完整         |
| HIGH-2 并发轨 B 丢任务        | ✅ 关闭                                           | `SessionTask.append` 单连接事务串行；并发测试通过      |
| HIGH-3 PATCH 无法最小负载创建 | ✅ 关闭                                           | payload=`WriteInfo[]`，SDK 生成 `SessionTaskWriteInfo` |
| HIGH-4 background 不 settle   | ✅ 主路径关闭                                     | Exit 状态机 + success/failure/cancel tests             |
| MEDIUM patch 跨 Session       | ✅ 关闭                                           | scoped UPDATE + scoped SELECT                          |
| MEDIUM createdAt 被重置       | ✅ 关闭                                           | existing `time_created` 被保留                         |
| MEDIUM migration 自由字符串   | ✅ 关闭                                           | unknown status/priority → pending/medium               |
| MEDIUM taskwrite deny         | ✅ 关闭                                           | V1 subagent permissions + V2 general agent 均补齐      |
| MEDIUM resume 映射            | ⏳ 合理延期到 M2，但代码注释仍错误                | outputDigest 尚未持久化                                |
| MEDIUM Schema/Effect 协议     | ⚠️ DateTime 已关闭；Schema.Class 仍未关闭         | 当前仍使用 Struct                                      |

## 3. Blocking Findings

### 🟠 HIGH-1：默认 V1 runtime 的 `/todo` 读取路径被破坏

**Evidence**

- `packages/aigcfroge/src/effect/app-runtime.ts:L83-L91`：`AIGCFROGE_V2_RUNTIME` 默认 `false`，且注释明确 V2 仍有 401/shape bug；
- `packages/aigcfroge/src/tool/registry.ts:L14,L106`：默认 V1 工具注册仍使用 `packages/aigcfroge/src/tool/todo.ts`；
- `packages/aigcfroge/src/session/todo.ts:L43-L79`：V1 `todowrite` 继续写/读 legacy `TodoTable`；
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:L116-L121`：修复后 `/todo` 无条件读取 Core `SessionTodo`，即 TaskTable 投影；
- `docs/plan/todo-task-system-upgrade.md:L485-L487`：明确 M1-M5 不改 V1，V1 在 M5 后才 deprecated。

**Failure Flow**

```text
默认 AIGCFROGE_V2_RUNTIME=false
  → V1 model/tool 调用 packages/aigcfroge TodoWrite
  → 写入 TodoTable
  → GET /session/:id/todo
  → 无条件读取 Core SessionTodo → TaskTable
  → 返回 [] / 旧状态
```

迁移只在升级时回填一次；进程运行后新增的 V1 TodoTable 写入不会再次同步到 TaskTable。

**Proof**

复审临时测试直接向 TodoTable 写入一条 V1 todo，随后调用当前 Core `SessionTodo.get`，结果为 `[]`。现有 HTTP 测试只覆盖“先写 TaskTable，再 GET /todo”，没有覆盖默认 V1 写入路径。

**Impact**

当前默认生产路径上的 todo UI/hydration 会读不到刚写入的数据。这违反现行 runtime 注释、M1-M5 V1 不退役约束和兼容 Gate。

**Required Fix**

二选一，但当前阶段推荐方案 A：

- **A：恢复 runtime 分支**：`AIGCFROGE_V2_RUNTIME=false` 时继续 `Todo.Service.get`；true 时读 Task 投影；增加两个独立 runtime 模式测试。
- **B：完整迁移 V1 写路径**：把 `packages/aigcfroge/src/session/todo.ts` 和 V1 tool 一并迁移到 TaskTable，然后才允许 `/todo` 无条件读 Task。该方案扩大范围，必须先验证所有 V1 callers。

---

### 🟠 HIGH-2：旧 `todowrite` 转发会重建 ID，破坏 background task settle 关联

**Evidence**

- `packages/core/src/tool/builtins.ts:L52-L54`：`task`、`taskwrite`、`todowrite` 同时对模型开放；
- `packages/core/src/session/todo.ts:L61-L65,L78-L83`：legacy todo 被映射成不含 `id/parentID` 的 `WriteInfo`；
- `packages/core/src/session/task.ts:L135-L177`：无 ID 条目生成新 `tsk_` ID，并删除 omitted 旧 row；
- `packages/core/src/tool/task.ts:L226-L243`：background Track B 的 settle callback 持有创建时的稳定 task ID。

**Failure Flow**

```text
background task 自动 append → linked id = tsk_A
  → parent 下一轮调用 legacy todowrite（仍是 built-in）
  → SessionTodo.update 把全列表转成无 id WriteInfo
  → SessionTask.update 新建 tsk_B，删除 tsk_A
  → child settle 后 patch(tsk_A)
  → 返回 undefined，但 asVoid 视为成功
  → 新 task tsk_B 永久停留 in_progress
```

**Proof**

复审临时测试：先 `SessionTask.append` 得到 linked ID，再使用 `SessionTodo.update` 写同一条 todo；最终 TaskTable 中 ID 与 linked ID 不同。

**Impact**

兼容工具会直接重新引入原 HIGH-4：“子会话结束，但 todo 仍显示 in_progress”。这不是单纯历史 ID 变化，而是破坏正在运行的状态机引用。

**Required Fix**

不要在 legacy adapter 中调用通用全量 `update` 并丢弃 ID。增加 Task owner 内部事务方法，例如 `replaceLegacy`：

- 以 legacy 的 `(session_id, position)` 语义复用同位置 existing task 的 `id/parent_id/time_created`；
- 新增位置才 mint ID；
- 删除越界尾部；
- 全过程单事务，避免 read-modify-reconcile 竞争；
- 新增“background task 启动 → legacy todowrite → settle 仍更新原 ID”的回归测试。

## 4. Medium Findings

### 🟡 MEDIUM-1：`Cause.pretty` 不是“错误摘要”，可能把完整敏感错误送入事件

`packages/core/src/tool/task-driver.ts:L489-L490`：

```ts
const digest = Cause.pretty(exit.cause)
```

计划要求“错误摘要入 outputDigest”，`CLAUDE.md:L99` 和执行提示词要求不得输出 token、Authorization、完整 prompt、用户文件内容或错误原文。`Cause.pretty` 保留原始 error message 和 stack；exact-version 本地 smoke test确认包含的 `Authorization: Bearer ...` 和 prompt 文本会原样存在。

该 digest 随 `task.updated` EventV2 发布，可能进入 SSE/plugin/UI 消费链。

**Fix**：使用固定分类 + 截断、脱敏后的短摘要；不要持久化/发布 `Cause.pretty`。测试至少覆盖 Authorization、API key、prompt/file content 被移除。

### 🟡 MEDIUM-2：Schema.Class 豁免理由不成立，新增领域 Schema 仍违反本仓强制协议

当前仍使用：

- `packages/schema/src/session-task.ts:L29-L64`：`TaskRecurrence`、`Info` 为 `Schema.Struct`；
- `packages/core/src/session/task.ts:L23-L40`：`WriteInfo`、`TodoProjection` 为 `Schema.Struct`。

仓库根 `AGENTS.md` 明确规定多字段记录使用 `Schema.Class<T>("Name")({...})`。已有 legacy Struct 混用属于技术债，不能豁免新代码。

**联网与 exact-version 验证**

- Effect 官方 `effect@4.0.0-beta.83` 源码中，`Schema.Class` 构造器基于 Struct 验证，并明确支持 schema-derived decoding/encoding；
- exact-version 本地 `Schema.decodeUnknownSync(Class)(plainObject)` 成功并返回 Class instance；
- `Schema.decodeUnknownSync(Schema.Array(Class))([plainObject])` 成功；
- `HttpApiEndpoint` 使用 `Schema.Array(Class)` 后 `OpenApi.fromApi` 成功生成 request body schema；
- 仓库已有 `ImportParser.Candidate/Result` 等 Class 从 plain object decode 的通过测试，并用于 HttpApi success/nested payload。

真正需要修复的是：Class schema 的 Type 侧编码要求 Class instance，因此 `toInfo`、service response/event 应使用 `new Info({...})`，而不是返回伪装成 Class 的 plain object。

**Fix**：按正确 Class 声明和构造方式实现；若确有无法规避的框架 bug，必须提供最小复现并先在 `AGENTS.md`/ADR 中审批明确例外，不能以仓库存在 legacy Struct 为由自行放宽规则。

### 🟡 MEDIUM-3：resume 注释与延期后的规范仍不一致

`packages/core/src/tool/task.ts:L220-L223` 仍声明“resuming a child reuses the todo the original delegation created”，但 resume 时 `taskID` 仅来自新的 `parent_task_id`，没有持久映射；当前文档已把 outputDigest 持久化和 resume 恢复放入 M2。

另外 `specs/v2/todo.md:L73`、`specs/v2/schema-changelog.md:L18` 仍写 M1.5，与主计划“M1.5 折入 M2”不一致。

**Fix**：删除当前代码中的虚假保证，统一 specs 为 M2；M2 实现后再恢复该注释和行为。

## 5. Low Finding

### 🟢 LOW-1：修复报告称伪造字段“被拒”，实际行为是忽略未知字段

HTTP 测试 `PATCH ... cannot inject another session's id` 实际期望 200，并验证 body 中 `sessionID/createdAt/updatedAt` 被 Schema 剥离、路径 Session 成为 owner。这是安全行为，但应描述为“ignored/stripped”，不是“rejected”，避免误导 API 调用方。

## 6. “是否可以删除兼容内容”的结论

**当前不可以。**

原因不是通用偏好，而是本仓已有明确约束：

1. `AIGCFROGE_V2_RUNTIME` 默认 false，V2 runtime 注释明确仍有未解决缺陷；
2. V1 Todo tool/service 仍在默认 composition 中；
3. 计划 §9.1 要求旧 API/Tool/Event/Data 兼容；
4. 计划 §9.2 明确 M1-M5 不退役 V1；
5. 审批 Gate 5 就是“兼容与迁移”。

若要删除兼容层，必须另立 breaking-change 方案，至少先：关闭 V2 401/shape bugs、默认启用 V2、迁移全部 V1 callers、更新 SDK/文档、定义数据 cutover/rollback，并修改已审批计划。不能在本 M1 修复中直接省略。

## 7. Verification

| 验证                                      | 结果                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| Schema/Core/AigcForge/SDK typecheck       | ✅                                                   |
| `bun run lint`                            | ✅ 0 warnings / 0 errors                             |
| Schema 全量测试                           | ✅ 39 pass                                           |
| Core 全量测试                             | ✅ 1401 pass                                         |
| Session HttpApi 定向测试                  | ✅ 23 pass                                           |
| AigcForge task tool 测试                  | ✅ 21 pass                                           |
| subagent permission 测试                  | ✅ 6 pass                                            |
| migration `--check`                       | ✅                                                   |
| SDK build/idempotency                     | ✅ 无差异                                            |
| `git diff --check main..HEAD`             | ✅                                                   |
| Schema.Class plain-object decode smoke    | ✅                                                   |
| Schema.Array(Class) decode smoke          | ✅                                                   |
| Schema.Array(Class) HttpApi/OpenAPI smoke | ✅                                                   |
| 复审兼容临时测试                          | ✅ 复现 V1 TodoTable 不可见、legacy update ID 被替换 |

现有测试全部通过，但新增测试仍缺：

- 默认 V1 write → `/todo` read；
- background Track B → legacy `todowrite` → settle；
- failed digest 脱敏；
- Class schema 的 HTTP decode + response/event encode。

## 8. Required Actions Before Next Review

### Blocking

- [ ] 修复默认 V1 `/todo` 读取回归，并覆盖 runtime false/true；
- [ ] legacy Todo adapter 在全量替换时保留稳定 ID/parent linkage；
- [ ] 增加 background + legacy todowrite + settle 端到端测试。

### Protocol closure

- [ ] `Cause.pretty` 替换为脱敏、截断的错误摘要；
- [ ] 按 `Schema.Class` 正确实例化领域对象，或先审批正式例外；
- [ ] 修正 resume 虚假注释和 M1.5/M2 文档漂移。

## 9. Methodology

- 审查 39/39 changed files；
- 对两个修复提交逐 diff 审查；
- 沿 Task/SessionTodo/V1 Todo/HTTP/App/TUI/Tool registry/BackgroundJob/SDK/DB migration 追踪上下游；
- 使用 Effect 官方 exact-version 源码、联网官方 API 文档、仓库既有 Class 用例和本地 runtime/OpenAPI smoke test交叉验证；
- 临时复现测试执行后已删除，源码工作区未修改；当前仅本报告为未跟踪文件。

**Confidence：HIGH**
