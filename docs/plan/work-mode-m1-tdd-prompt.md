# Work 模式 M1 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work M1。
> **来源**：[M1 实施计划](work-mode-execution-layer-m1.md)（v1.1）、[Work 路线图](work-mode-roadmap.md)、[Work PRD v4.1](../prd/work-mode-execution-layer.md)
> **分支**：`work-m1`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 模式 M1：预设驱动文档闭环](docs/plan/work-mode-execution-layer-m1.md)（v1.1）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`packages/core/AGENTS.md`、`packages/app/AGENTS.md`、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

---

## 0. 你的任务（一句话）

让非编程用户在 `/mode/work` 看到官方预设卡片库，点预设 → 答问卷 → 生成 Markdown 候选稿 → 右栏只读预览（含 Context Tab）→ 同名冲突询问 → 原子落盘到当前 Session Location，并建立 Artifact 投影。

## 1. 范围真源与不可逾越的边界

### 1.1 范围（M1 只做这些）

- Preset Catalog：4 个高置信预设（视频分镜脚本 / 撰写 PRD / 文献对比综述 / 撰写行政公文），4 分类（IT 研发 / 视频创作 / 学术科研 / 行政通用）
- work-orchestrator agent（类比 chat-orchestrator）
- question tool 问卷式澄清（小白模式强制问卷）
- 右栏双 Tab：Context Tab（对齐 Code）+ Artifact Tab（只读预览 + 应用按钮）
- 同名冲突询问（重命名/覆盖 + Diff 确认）
- 原子写入当前 Location + Artifact 投影（内存态，不落库）

### 1.2 禁区（违反即返工，绝对不做）

- ❌ 不实现 ProgressLedger Schema/Service、步骤追踪、断点恢复（属 M1.5，依赖 Todo 分支 Task 模型）
- ❌ 不新建全局 Work 工作区（ADR-14：产出落用户选择的 Location）
- ❌ 不内嵌富文本/代码编辑器（修改一律走对话）
- ❌ 不创建自定义 Preset 持久化（归 Chat 模式）
- ❌ 不开放 Shell/浏览器自动化/未授权网络写
- ❌ 不新增数据库 migration（M1 无新表，Artifact 内存态）

## 2. 关键设计决策（已定案，必须遵守）

### 2.1 D1 候选稿载体 = assistant 消息正文

- work-orchestrator 将候选 Markdown 作为 **assistant 消息正文**产出，**不是文件**
- 右栏 Artifact Tab 渲染该消息
- 用户点"应用到当前项目"时，Core 从消息正文读取内容写入目标文件
- **work-orchestrator 无 `edit` 工具**——杜绝 agent 直接改文件绕过冲突确认

### 2.2 D2 Artifact 状态流 = 内存态事件

- 落盘成功后发 `work.artifact_applied` 事件（参照 `SessionTodo` 发 `todo.updated` 的 EventV2 bridge 模式：`packages/core/src/session/todo.ts:20-27`）
- App 侧监听更新 Artifact Tab
- 跨刷新丢失可接受（M2 存为资产时转 Chat 资产持久化）

## 3. 代码锚点（已核实，直接用）

| 能力                                 | 位置                                                                                                                         | 动作                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MODE_SURFACES work 注册              | `packages/app/src/components/mode-surfaces.tsx:316-319`                                                                      | 替换 `PlaceholderSidebar`/`PlaceholderMain`/`PlaceholderPanel`                                      |
| Main slot 组件                       | `packages/app/src/pages/mode-workspace-slots.tsx:524`（`PlaceholderMain`）                                                   | 新增 `WorkPresetCatalogMain` + `WorkProjectColumnSidebar`                                           |
| Context Tab（mode-agnostic，零改动） | `packages/app/src/components/session/session-context-tab.tsx`（442 行）                                                      | 直接挂载，改路径是 `components/session/` 不是 `pages/session/`                                      |
| 右栏集成点                           | `packages/app/src/pages/session/session-side-panel.tsx:482-487`（work 渲染 `PlaceholderPanel`）                              | Artifact Tab 与 Context Tab 并列；内容由 `MODE_SURFACES.RightPanel` 注册的 `WorkArtifactPanel` 渲染 |
| V2 question tool（LLM-facing）       | `packages/core/src/tool/question.ts`                                                                                         | 问卷澄清复用；V1 实现 `aigcfroge/src/question/` 勿碰                                                |
| chat-orchestrator 范式               | `packages/core/src/agent/prompt/chat-orchestrator.ts`（system prompt 结构）                                                  | 类比创建 work-orchestrator                                                                          |
| agent 注册                           | `packages/core/src/plugin/agent.ts:299-300`（`AgentV2.ID.make("chat-orchestrator")` fail-closed）                            | 类比注册 work-orchestrator                                                                          |
| **mode 强制绑定**                    | `packages/core/src/product-mode-agent-policy.ts`：`resolvePrimaryAgent:40`、`checkPrimaryAgent:67`、`checkCommandAllowed:91` | **必须改**：work→work-orchestrator；work deny shell/command（PRD §6.2）                             |
| 原子写入事务范式                     | Chat M1 `prompt-asset-service.ts:219-388`（target 级锁 + writeAtomic）                                                       | 类比 Artifact 原子写入                                                                              |
| Diff 确认组件                        | `packages/app/src/pages/session/review-tab.tsx` + `packages/app/src/utils/diffs.ts`                                          | 同名冲突 Diff 展示（仓内无 LCS 实现，勿搜）                                                         |
| 预设注册                             | `packages/core/src/tool/builtins.ts`（`TodoWriteTool.layer:51` 注册范式）                                                    | 新增 work-preset 注册                                                                               |

## 4. 新增文件清单

```
packages/schema/src/work-preset.ts              Preset Schema + 4 预设数据
packages/core/src/session/work-preset.ts        Preset Registry（硬编码）
packages/core/src/session/artifact.ts           Artifact 内存态记录 + work.artifact_applied 事件
packages/core/src/tool/work-preset.ts           LLM 读预设指引 tool
packages/core/src/agent/prompt/work-orchestrator.ts   Work 专属 agent（system prompt）
packages/app/src/pages/mode-workspace-slots.tsx      WorkPresetCatalogMain + WorkProjectColumnSidebar
packages/app/src/pages/session/session-side-panel.tsx   Artifact Tab + WorkArtifactPanel
```

## 5. TDD 工作流（红 → 绿 → 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 → 实现最小代码到测试通过 → 重构去重**。禁止"写完再补测试"。

### Phase A — 契约（先行，写测试驱动）

1. **红**：写 `packages/schema/test/work-preset.test.ts`（Preset/Artifact Schema 类型负测试——错误类型应 decode 失败）+ `packages/core/test/work-preset.test.ts`（4 预设数据完整、字段合法）
2. **绿**：实现 `work-preset.ts`（Schema）+ `session/work-preset.ts`（Registry 硬编码）
3. **重构**：确认 4 预设与 M1 计划 §3.1 清单逐字段一致
4. **Phase A 退出**：Schema 评审通过（D1/D2 决策已在契约中注释）

### Phase B — Agent + 强制绑定

1. **红**：写 `packages/core/test/product-mode-agent-policy.test.ts`（work→work-orchestrator 解析、非 work-orchestrator 拒绝、work deny shell）+ `work-orchestrator` system prompt 结构测试
2. **绿**：实现 `work-orchestrator.ts` + `work-preset` tool + `plugin/agent.ts` 注册 + `product-mode-agent-policy.ts` 三处修改
3. **重构**：确认 work-orchestrator 工具集 = work-preset + question + read（**无 edit/task/shell**）
4. **Phase B 退出**：tool 单测 + 策略测试通过

### Phase C — Surface UI

1. **红**：写 `packages/app` 组件测试——`WorkPresetCatalogMain` 渲染 4 分类 + 预设卡片、`MODE_SURFACES.work` 注册指向新组件（而非 Placeholder）
2. **绿**：实现 `mode-workspace-slots.tsx` 两个组件 + `mode-surfaces.tsx:316-319` 替换
3. **重构**：UI 全用 v2 token（`--v2-*`，禁硬编码颜色/间距/圆角，见 frontend-theming skill）
4. **Phase C 退出**：`/mode/work` 显示 Preset Catalog；预留预设卡片显示"即将上线"且**无创建入口**

### Phase D — 澄清闭环

1. **红**：写端到端 `packages/core/test/work-orchestrator.test.ts`——`it.effect` 下：预设→缺关键信息→question tool 问卷→补齐→生成候选消息
2. **绿**：实现 work-orchestrator 澄清流程 + work-preset guidance 注入 + 候选稿作为消息正文
3. **重构**：小白模式（`guided: true`）强制问卷，不生成空泛模板
4. **Phase D 退出**：选预设→答问卷→出预览（右栏渲染候选消息）

### Phase E — 落盘

1. **红**：写 `packages/core/test/artifact.test.ts`——`it.instance`（真实 tmpdir + 实例）：原子写入、`relativePath` 规范化（禁 `..`/绝对路径/符号链接越界）、同名冲突检测、Diff 确认后覆盖、`work.artifact_applied` 事件发布
2. **绿**：实现 Artifact 原子写入 + 冲突询问（question tool）+ Diff 确认 + 事件
3. **重构**：确认写入内容从候选消息正文读取（D1），路径校验对齐 ADR-14 §1
4. **Phase E 退出**：内部 50 次测试达标（PRD §13 M1 准入）

### Phase F — 打磨

- i18n：`packages/app/src/i18n/en.ts` + `zht.ts` 补 `work.*` 文案（**18 locale 受 `i18n/parity.test.ts` 键值 parity 约束**，不是改 3 个文件）
- 埋点：`work_task_started` / `work_preview_ready` / `work_artifact_applied`（PRD §12）
- E2E：`/mode/work` 选预设→澄清→预览→落盘全流程（Playwright）

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）

```bash
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test --timeout 30000
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck   # 若 app 有 typecheck 脚本
bun run lint
```

### 6.2 三模式选择

| 模式          | 何时用                                             |
| ------------- | -------------------------------------------------- |
| `it.effect`   | TestClock + TestConsole，Effect Service/Layer/并发 |
| `it.live`     | 真实时间/文件系统 mtime/子进程                     |
| `it.instance` | 真实 tmpdir + 实例（落盘测试用这个）               |

### 6.3 硬性规则

- 用 `testEffect(...)`（`test/lib/effect.ts`）不要手写 runtime；`Layer.mock` 代替手写 stub
- 禁止 `Effect.sleep(N)` 等 fiber——用 readiness 信号（`pollWithTimeout`/`Deferred`/`SessionStatus`）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试

## 7. Effect 编码规范（引用 AGENTS.md §Effect + effect skill）

- `Effect.gen(function* () {})` 组合；命名效果用 `Effect.fn("Work.xxx")`
- 失败用 `yield* new MyError(...)`（`Schema.TaggedErrorClass`），不用 `Effect.fail(new ...)`
- 禁 `Effect.fork`/`forkDaemon`；用 `Effect.forkIn(scope)`
- 时间用 `DateTime.nowAsDate`；`Effect.void` 优先于 `Effect.succeed(undefined)`
- 边界（文件/网络/子进程）必须 Catch Everything：`Effect.try`/`catchTag`，禁未处理 Promise 和静默失败
- 外部输入先判空/收窄，禁无理由非空断言

## 8. 分支与提交规范

- 分支：`work-m1`（≤3 词连字符，无 `feat/` 前缀）
- commit：`type(scope): summary`；scope 用包名（`core`/`app`/`schema`）
- 每完成一个 Phase 一个 commit（`feat(core): ...` / `feat(app): ...`），不批量
- `.husky/pre-push` 会跑 `bun typecheck`——push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）

- [ ] `/mode/work` 显示 4 分类 Preset Catalog，预留预设无虚假创建入口
- [ ] 点"视频分镜脚本"→ 创建 mode=work Draft（agent=work-orchestrator，经 policy 强制绑定）
- [ ] 缺关键信息 → 问卷（≤5 题），小白模式强制问卷
- [ ] 候选 Markdown 作为消息正文 → Artifact Tab 只读预览
- [ ] Context Tab 与 Code 模式一致（文件引用 + Token 占用透明）
- [ ] 目标路径同名 → 询问重命名/覆盖 → Diff 确认后才落盘
- [ ] 原子写入当前 Location + `work.artifact_applied` 事件 + Artifact 投影 `status=available`
- [ ] 修改走对话指令（无内嵌编辑器）
- [ ] 未授权写入/跨界读取 = 0（安全审计）
- [ ] typecheck / lint / 全包 test 绿

## 10. 改完即审（每 Phase 结束必须执行）

1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything / No Null Pointer / Security First（路径穿越、符号链接、命令注入）
3. 整洁复查：No Cheating / Reusability / Clean Logs（不输出 API key/token/完整 prompt）
4. 数据流追踪：每个 Effect 的 Layer 依赖已 provide；import 真实存在；条件分支两端有执行路径
5. 输出复查结论：

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:
- 剩余风险:
```

## 11. 禁止事项（八荣八耻）

- 禁瞎猜接口——查 `codegraph`（MCP）或 grep 确认后再写
- 禁模糊执行——任务不清停下来问，不自我感动式盲目执行
- 禁创造接口——先查 owner module 能否复用（question tool / chat-orchestrator / review-tab diff / v2 token 都有现成）
- 禁跳过验证——改完必须跑对应包 test
- 禁破坏架构——遵循 ADR-11~15 + AGENTS.md 分层；新代码用 `export * as Foo from "./foo"` 自导出
- 禁假装理解——未知技术栈承认并向人类求助
- 禁长注释——默认无注释，仅 WHY 非显然处加一行
- 禁把工作流执行/ProgressLedger 混进 M1——那属于 M1.5 和 Todo 分支

<!-- PROMPT END -->

---

## 使用说明

| 项             | 值                                                                      |
| -------------- | ----------------------------------------------------------------------- |
| 复制范围       | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                        |
| 新对话 model   | 默认（工程执行建议主力模型）                                            |
| 新对话打开文件 | `docs/plan/work-mode-execution-layer-m1.md`（范围真源）+ 本文件         |
| 开工顺序       | 通读 CLAUDE.md/AGENTS.md/skills → git 切 `work-m1` → Phase A 红测试开始 |
| 卡住时         | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁）       |
