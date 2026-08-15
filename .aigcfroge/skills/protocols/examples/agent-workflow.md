# 智能体协议索引使用实例

> 配合 `SKILL.md` 的 Phase 1（任务路由）和 Phase 2（影响面）使用。

## 实例 1: 加一个 HttpApi 端点

**任务**: 给 instance API 加一个 `taskReorder` 端点。

**Step 1 - 路由**: 触发信号 `packages/aigcfroge/src/server/routes/instance/httpapi/` 命中 Phase 1 第 3 行。
- L1 必读: `packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`
- L2 按需: `AGENTS.md`->Effect · `ARCHITECTURE.md` §6
- L3 深度: `packages/aigcfroge/test/server/AGENTS.md`

**Step 2 - 影响面**: 改 `httpapi/AGENTS.md` 时查 Phase 2。
- `ARCHITECTURE.md` -> `httpapi/AGENTS.md`(§6) 单向：架构文档路由表可能需同步
- 无真双向对涉及 httpapi

**Step 3 - 执行**: 读 L1+L2，按 `HttpApiBuilder.group(...)` 模式实现端点，错误用显式 `Schema.ErrorClass`。

**Step 4 - 复审**: Phase 1 验证已读 `httpapi/AGENTS.md`；Phase 2 确认无遗漏影响面。

---

## 实例 2: 改 LLM 适配器（双向必同读）

**任务**: 在 `native-request.ts` 加一个新 provider 的请求构造。

**Step 1 - 路由**: 触发信号 `packages/aigcfroge/src/session/llm/` 命中 Phase 1 第 6 行。
- L1 必读: `packages/llm/AGENTS.md` **⇄** `packages/aigcfroge/src/session/llm/AGENTS.md`（双向必同读！）
- L2 按需: `ARCHITECTURE.md` §4.9

**Step 2 - 影响面**: Phase 2 真双向第 1 对。
- 改 `session/llm/AGENTS.md` 必查 `packages/llm/AGENTS.md`（integration point 互指）
- `ARCHITECTURE.md` §4.9 单向指向两者

**关键约束**（来自 `session/llm/AGENTS.md`）: 只有 `native-request.ts` 可构造 `LLM.request(...)` / `Message.*` / `SystemPart` / `ToolCallPart` / `ToolResultPart` / `ToolDefinition`。其他文件不得越界。

---

## 实例 3: 改数据库 schema

**任务**: 给 session 表加一列。

**Step 1 - 路由**: 触发信号 `*.sql.ts` / `migration/*.ts` 命中 Phase 1 第 2 行。
- L1 必读: `packages/aigcfroge/AGENTS.md`->Database
- L2 按需: `skills/database/SKILL.md`
- L3 深度: `ARCHITECTURE.md` §4.8 · `packages/effect-drizzle-sqlite/AGENTS.md`

**Step 2 - 影响面**: 数据库簇（Quick Reference 主题簇），三文档无显式互引但主题关联。

**Step 3 - 执行**: 按 `skills/database/SKILL.md` Phase 1-4（schema -> 迁移文件 -> 注册 `migration.gen.ts` -> 验证 typecheck+test）。

---

## 实例 4: 改 Session V2 内部（三方互引闭环）

**任务**: 修改 `SessionExecution` 的 drain 逻辑。

**Step 1 - 路由**: 触发信号 `packages/core/src/session/` 命中 Phase 1 第 5 行。
- L1 必读: `AGENTS.md`->V2 Session Core · `CONTEXT.md`
- L2 按需: `ARCHITECTURE.md` §4.1
- L3 深度: `specs/v2/session.md` · `docs/architecture/system-blueprint.md` §11

**Step 2 - 影响面**: Phase 2 真双向第 2 对 + 主题簇 V2 Session。
- `AGENTS.md`(V2 Core) ⇄ `ARCHITECTURE.md` §4.1 ⇄ `CONTEXT.md` 三方互引
- 改 drain 语义时三份都必须同步检查：`AGENTS.md` 的 8 条不变量、`CONTEXT.md` 的 Session Drain 定义、`ARCHITECTURE.md` §4.1 的子系统指针

**关键约束**（来自 `AGENTS.md` V2 Session Core）: drain 无 durable 身份；`SessionExecution` 进程全局且按 Session ID；每 provider turn 恰一次 `llm.stream`。

---

## 实例 5: 校验索引完整性

协议文档改名/删除后：
```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
```
输出 `MISS` 的路径需更新 `SKILL.md` 的 Phase 1/2 引用。CI 或 pre-push 可接入此脚本防漂移。
