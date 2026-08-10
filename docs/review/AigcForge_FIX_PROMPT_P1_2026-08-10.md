# AigcForge main 第二轮审批 P1 修复提示词（执行智能体用）

> 来源：`docs/review/AigcForge_MAIN_APPROVAL_2026-08-10.md` 的 4 项 P1 放行条件。
> 执行约束：严格遵循 `/media/keer/办公/aigcfroge/CLAUDE.md` 与 `AGENTS.md`——无 `else`（early return）、无 `as any`/`@ts-ignore`、Effect 错误用 `Schema.TaggedErrorClass`、禁止裸 `Effect.fork`（用 `forkIn(scope)`/`forkScoped`）、测试禁 `Effect.sleep(N)` 等待（用 `pollWithTimeout`/`Deferred`）、测试用 `testEffect` + `Layer.mock`、新模块自导出、无新增 star/alias import。
> 分支建议：`fix-review-p1`（短名、连字符，符合分支规约）。提交信息用 conventional 格式，每项 P1 一个独立 commit。
> 禁止顺手改无关代码；每项修复只做最小改动。

---

## 任务 1：iframe `csp` 属性与 meta CSP 对齐（P1-1）

**问题**：`packages/session-ui/src/components/html-artifact.tsx:15` 的 `IFRAME_CSP` 为
`"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';"`，缺 `style-src` 与 `img-src`。iframe `csp` 属性作用于 srcdoc 文档且与 meta CSP 取交集，导致回落 `default-src 'none'`——Chromium 下内联样式容器高度塌陷为 0、`data:` 图片不加载，LLM 产物图表（vis-network 等）渲染塌陷。

**修复**：把 `IFRAME_CSP` 与 `packages/session-ui/src/components/html-artifact-srcdoc.ts:27` 的 `CSP_META` 对齐，即补 `style-src 'unsafe-inline'; img-src 'self' data:'`：
```
"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none';"
```
两条策略同时生效，安全姿态不变（多 CSP 取交集，用户注入 meta 无法放宽）。不要新增其他任何指令。

**测试**：
- 更新 `html-artifact.test.ts` 中对 `IFRAME_CSP` 的契约断言。
- e2e `packages/app` 的 `work-html-artifact.spec.ts` 增加一条断言：srcdoc 内带内联 `style="height:NNpx"` 的容器 computed height > 0（现有 e2e 因 canvas 默认 300×150 兜底而未暴露该缺陷）。

**验证**：`bun --cwd packages/session-ui test`、`bun --cwd packages/session-ui typecheck`（若无 typecheck 脚本则跳过并注明）。

---

## 任务 2：`v2InfoToV1` 补顶层 `presetCategoryId`（P1-2）

**问题**：`packages/aigcfroge/src/server/routes/instance/httpapi/session-adapter.ts:20-45`。返回类型用交叉类型声明了顶层 `presetCategoryId?: ...`，但对象字面量只写了 `metadata: { presetCategoryId }`，顶层字段从未赋值。children（`handlers/session.ts:112`）、revert/unrevert（`:709/:719`）三条响应路径静默丢字段，客户端据此刷新 store 时会话掉入"未分类"。

**修复**：在字面量中补 `presetCategoryId: info.presetCategoryId`（与类型声明一致；若该字段实际应从 metadata 解码，则保持与 `fromRow` 相同的解码口径）。不改 wire contract 的其他部分。

**测试**：新增/扩展 adapter 层测试，断言 `v2InfoToV1` 返回值顶层含 `presetCategoryId`，且与 metadata 内值一致；children/revert/unrevert 路径若已有 handler 测试，补一条字段透传断言。

**验证**：`bun --cwd packages/aigcfroge typecheck`、`bun --cwd packages/aigcfroge test <相关测试文件> --timeout 30000`。

---

## 任务 3：修复 BLOCKER-1 空转回归测试（P1-3）

**问题**：`packages/core/test/session-task-service.test.ts:898-905` 的 "two independently-built services still serialize (BLOCKER-1)" 并未真正跨实例：在 `Effect.provide(mergedLayer)` 环境内 `Layer.build(SessionTask.layer...)` 会复用外层 Layer 构建的 memo map，两个"独立"服务实为同一实例（探针实证 `same service: true`）。把 `writeLock` 改回实例级 Semaphore，该测试照样绿——虚假安全感。

**修复**：第二次构建改用 `Layer.fresh(SessionTask.layer)` 绕过 memo 去重，并通过 `Layer.succeed(Database.Service, …)` 向两个 SessionTask 实例注入**同一个** Database 实例（而非各建一个 `Database.defaultLayer`），复现"不同 SessionTask 实例 + 同一 DB"的真实生产形态。注意：两个独立 `Database.defaultLayer` 在 `:memory:` 下互不共享，会导致第二实例报 `no such table`——必须共享同一 Database。

**测试**：修复后的测试必须满足两个自检：① 当前实现（模块级 writeLock）下通过；② 把 writeLock 临时改回 `Layer.gen` 内实例级时**失败**（本地验证后即还原，不提交还原后的破坏态）。用并发 append/patch 交叉断言序列化，禁 `Effect.sleep` 等待，用 `Deferred`/`TestClock` 或就绪信号。

**验证**：`bun --cwd packages/core test test/session-task-service.test.ts --timeout 30000`、`bun --cwd packages/core typecheck`。

---

## 任务 4：config CLI agent 的 resume hint 委托修复（P1-4）

**问题**：`packages/core/src/tool/cli-config-adapter.ts:38-50` 的 `parseResumeHint` 只匹配 `type === "session.resume_hint" && sessionID`。但真实输出格式：`claude-jsonl` 是 `{"type":"result","session_id":...}`（内置 adapter `claude-code.ts:50-61` 已处理），`codex-jsonl` 是 `thread.started.thread_id`（`codex.ts:56`）。config 定义的 CLI agent 永不匹配 → `external_cli_session` 永不写入 → resume 特性静默失效。

**修复**：按 `parseOutput` 的既有委托方式，把 config adapter 的 `parseResumeHint` 按 output 类型委托到 `claudeCodeAdapter.parseResumeHint` / `codexAdapter.parseResumeHint`；未知 output 类型保持现状（返回空/undefined）。复用现有模块，不新建平行解析逻辑。

**测试**：为 `claude-jsonl` 与 `codex-jsonl` 两种 output 各加一条用例：喂真实格式行，断言 `external_session_id` 被正确捕获并写入（沿用该文件现有测试的 fixture 风格）；再加一条未知类型不误匹配的用例。

**验证**：`bun --cwd packages/core test <cli-config-adapter 相关测试> --timeout 30000`、`bun --cwd packages/core typecheck`。

---

## 收尾门禁（全部完成后执行）

1. `LINT_BASE_REF=main bun run script/lint-changed.ts` — 退出码 0 且无新增 warning。
2. `bun --cwd packages/core typecheck`、`bun --cwd packages/aigcfroge typecheck`、`bun --cwd packages/session-ui typecheck`（如有脚本）、`bun --cwd packages/app typecheck`（app 用 `tsgo -b`，受其影响时跑）。
3. 受影响包测试：`bun --cwd packages/core test --timeout 30000`、`bun --cwd packages/session-ui test`、`bun --cwd packages/aigcfroge test <adapter 相关文件>`、`bun --cwd packages/app test <work-html-artifact 相关>`。**禁止从仓库根目录跑 bun test。**
4. `git diff --check`（针对本次改动范围）无空白错误。
5. 按 CLAUDE.md「改完即审」输出复查结论（影响文件 / 命中 skills / 安全门禁 / 工程门禁 / 已运行命令 / 剩余风险）。

## 不在本次范围（明确禁止夹带）

- P1-5（d72605311 提交信息流程问题）不可通过代码修复，跳过。
- 全部 P2 项（记忆服务层长度 guard、`search` LIMIT、`as unknown as` 双重断言、SDK 静态实例化、release 脚本 fetch 捕获等）另立任务，本次不修。
- 不顺手重构、不改提交历史、不动 `docs/review/` 下审批报告。
