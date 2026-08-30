# Work 模式 M2 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work M2。
> **来源**：[M2 实施计划](work-mode-execution-layer-m2.md)（Approved）、[Work 路线图](work-mode-roadmap.md)、[Work PRD v4.1](../prd/work-mode-execution-layer.md)、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)
> **分支**：`work-m2`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 模式 M2：资产沉淀联动](docs/plan/work-mode-execution-layer-m2.md)（Approved）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`packages/app/AGENTS.md`、`.aigcfroge/skills/protocols/SKILL.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

---

## 0. 你的任务（一句话）

Work 会话生成候选稿后，用户点击"存为资产"按钮，Work 将候选稿映射为 prompt 资产 CandidateInfo，注入 Chat 已有的 propose candidate store，切换到 Chat 模式后右栏自动显示候选审查 UI，用户确认后 apply 落盘，新会话可复用该资产。

## 1. 范围与禁区

### 1.1 范围（M2 只做这些）

- 新建 `work-asset-capture.ts`：`captureWorkArtifactAsCandidate(content)` 纯函数（候选稿 -> prompt kind CandidateInfo）
- WorkArtifactContent 加"存为资产"按钮（与"应用到当前项目"并列）
- 点击按钮 -> setProposeCandidate + showToast（不自动切 mode，见 D5）
- i18n（en/zh/zht）+ 埋点 work_asset_saved

### 1.2 禁区（违反即返工，绝对不做）

- ❌ 不新建资产类型（复用 prompt 资产，template 字段）
- ❌ 不新建 propose 工具 / HTTP 端点 / Service（复用 Chat 已有 PromptAssetService + propose candidate store + Chat 右栏审查 + applyAssetCandidate）
- ❌ 不新建审查 UI / apply 链路（复用 chat-right-panel.tsx + asset-insert.ts）
- ❌ 不门控 Flag（G4：Flag 只门控 Core LLM propose 工具，Work 不经 LLM 工具，对齐 Chat 资产 App UI 不门控）
- ❌ 不改 M1 候选稿载体（候选稿=assistant 消息正文，不变）
- ❌ 不做 Work 模式内的资产编辑器（修改走 Chat 资产工作室）
- ❌ 不依赖 M1.5（ProgressLedger/Resume 是独立轨道）
- ❌ 不新建数据库 migration
- ❌ 不新建路由（不调 setCurrentMode，见 D5：session effect 锁回）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 资产类型 = prompt 资产

- `kind = "prompt"`，`template = 候选稿正文`，`name = 首行标题`，`description = 首段摘要（≤300 chars）`

### 2.2 D2 全链路复用 Chat

- Work 只做"按钮 + 映射 + 注入 + 切 mode"，审查/apply 全复用 Chat

### 2.3 D3 propose 策略 = 方案 A（直接构造 CandidateInfo，不调 propose）

- Work 不调 LLM propose 工具，直接构造 CandidateInfo + setProposeCandidate
- 代码验证：apply 从 `candidate.name` 经 `nameToRelativePath` 计算路径（prompt-asset-service.ts:207），不用传入的 relativePath
- 代码验证：chat-right-panel.tsx:165 `if (!c?.exists) return null`--exists=false 时不读 relativePath
- 技术债：无冲突预检（apply 时 OverwriteRequired 兜底）、无路径预览

### 2.4 D4 按钮位置 = 右栏 Artifact Tab

- 放 WorkArtifactContent（work-artifact-panel.tsx:68），与"应用到当前项目"并列
- 显隐：`candidate() !== null && !appliedCurrent()`，**不读 Flag**

### 2.5 D5 跨 mode 路由 = setProposeCandidate（不自动切 mode）

- 点击 -> captureWorkArtifactAsCandidate -> setProposeCandidate -> showToast
- 不调 setCurrentMode：session effect 锁回 session.mode（自动切 chat 无效）；ChatRightPanel render-all 常驻，store 注入后 DOM 就绪，靠 toast 引导用户手动切 Chat

### 2.6 D6 不门控

- Flag AIGCFROGE_EXPERIMENTAL_CHAT_ASSET 只门控 Core 端 LLM propose 工具（propose-prompt-asset.ts:26）
- Work 不经 LLM 工具，与 Chat 资产 App UI 同层不门控

## 3. 代码锚点（已核实，直接用）

| 能力                             | 位置                                                               | 动作                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CandidateInfo 完整结构**       | `packages/app/src/components/chat/prompt-asset-candidate.ts:9-25`  | **必读**：CandidateBase = { name, description, **content**, relativePath, exists, revision, nameConflict, pathConflict, **status** }；status 由 statusFrom(exists, nameConflict, pathConflict) 派生（"valid"/"conflict"/"exists"）；prompt kind 的 content = template |
| CandidateInfo 类型联合           | `packages/app/src/components/chat/prompt-asset-candidate.ts:27-35` | CandidateByKind prompt: `{ kind: "prompt"; candidate: Omit<PromptAssetCandidate, "relativePath"> }`（candidate 不含 relativePath）                                                                                                                                    |
| propose candidate store          | `packages/app/src/components/chat/prompt-asset-store.ts`           | `setProposeCandidate(sessionID, candidate)` / `useProposeCandidate()` / `clearProposeCandidate()`                                                                                                                                                                     |
| Chat 右栏审查 UI                 | `packages/app/src/components/chat/chat-right-panel.tsx:36`         | useProposeCandidate 读取后自动渲染；:165 exists=false 不读 relativePath；:322 status="valid" 分支显示 apply 按钮                                                                                                                                                      |
| applyAssetCandidate prompt 分支  | `packages/app/src/components/chat/asset-insert.ts:42`              | 末尾 `return client.promptAsset.apply({ ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } })`                                                                                                                                    |
| PromptAssetService.apply         | `packages/core/src/prompt-asset-service.ts:207`                    | apply 用 `PromptAssetPath.nameToRelativePath(input.candidate.name)` 计算路径，不用传入 relativePath；OverwriteRequiredError 兜底冲突                                                                                                                                  |
| WorkArtifactContent（M2 集成点） | `packages/app/src/pages/work-artifact-panel.tsx:68`                | 加"存为资产"按钮；已有 apply 函数 + appliedCurrent 状态 + 冲突 dialog 参考                                                                                                                                                                                            |
| Work 候选稿提取                  | `packages/app/src/pages/work-artifact-extract.ts`                  | `findLatestAssistantMarkdown` + `draftFilename`（首行 # 标题 -> 文件名）；extractTitle 可与其归并                                                                                                                                                                     |
| mode 切换                        | `packages/app/src/context/mode.tsx:69-70`                          | `useMode()` 返回 `{ currentMode, setCurrentMode }`                                                                                                                                                                                                                    |
| work.artifact_applied 事件范式   | `packages/core/src/session/artifact.ts:32-40`                      | 参考：work_asset_saved 事件定义（EventV2.define）                                                                                                                                                                                                                     |
| i18n parity                      | `packages/app/src/i18n/parity.test.ts`                             | 约束 en/zh/zht 三 locale                                                                                                                                                                                                                                              |
| 现有 i18n key                    | `packages/app/src/i18n/en.ts` + `zh.ts` + `zht.ts`                 | 已有 `work.artifact.*`（M1），M2 加 `work.asset.*`                                                                                                                                                                                                                    |

## 4. 修改文件清单

```
packages/app/src/pages/work-asset-capture.ts           新增：captureWorkArtifactAsCandidate 纯函数（含 content + status 字段）
packages/app/src/pages/work-asset-capture.test.ts      新增：映射纯函数单测（TDD 红测试）
packages/app/src/pages/work-artifact-panel.tsx          修改：WorkArtifactContent 加"存为资产"按钮 + onSaveAsset
packages/app/src/pages/work-artifact-extract.ts         修改（可选）：extractFirstHeading 归并
packages/app/src/i18n/en.ts + zh.ts + zht.ts            修改：work.asset.save / work.asset.save.success 文案
```

**不改的文件**：artifact.ts / prompt-asset-service.ts / prompt-asset.ts / groups/prompt-asset.ts / propose-prompt-asset.ts / prompt-asset-candidate.ts / prompt-asset-store.ts / chat-right-panel.tsx / asset-insert.ts / mode.tsx / flag.ts。

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase A - 候选映射（1d）

1. **红**：新建 `packages/app/src/pages/work-asset-capture.test.ts`：`captureWorkArtifactAsCandidate` 对含标题/无标题/超长描述/空内容的候选稿，产出**完整合法** CandidateInfo：
   - kind="prompt"
   - name ≤80 code points（PromptAsset.Name 约束）
   - description ≤300 chars（PromptAsset.Description 约束）
   - template 1-100000 bytes（PromptAsset.Template 约束）
   - **content = template**（CandidateBase.content，展示文本）
   - **status = "valid"**（statusFrom(false, false, false)）
   - relativePath = ""，exists = false，revision = null，nameConflict = false，pathConflict = false
   - candidate = { kind: "prompt", name, description, template }（**不含 relativePath**，Omit<PromptAssetCandidate, "relativePath">）
2. **绿**：实现 `work-asset-capture.ts`（extractTitle + extractSummary + captureWorkArtifactAsCandidate，含 content + status 字段）
3. **重构**：extractTitle 与 work-artifact-extract.ts 的 draftFilename 首行提取归并为共享 helper `extractFirstHeading(markdown): string | null`
4. **退出**：`bun --cwd packages/app test` 绿；`bun --cwd packages/app typecheck`（tsgo -b）绿

### Phase B - 存为资产按钮 + 跨 mode 路由（2d）

1. **红**：组件测试：WorkArtifactContent 在候选存在 + 未 applied 时显示"存为资产"按钮；applied 后隐藏；点击后调用 setProposeCandidate + showToast。**不测 Flag**（D6 不门控）；**不调 setCurrentMode**（D5：session effect 锁回）
2. **绿**：`work-artifact-panel.tsx` WorkArtifactContent 加按钮（`<Show when={candidate() !== null && !appliedCurrent()}>` + onSaveAsset）；接入 `setProposeCandidate` + `showToast`（work.asset.save.success）
3. **重构**：onSaveAsset 顺序：构造 -> null 守卫 -> setProposeCandidate -> showToast；不调 setCurrentMode（session effect 锁回，见 D5）
4. **退出**：组件测试绿；点击后 Chat 右栏能读到 candidate（store 注入验证）

### Phase C - 审查集成验证（1d）

1. **红**：集成测试：Work 注入 candidate（status="valid", relativePath=""）-> 切 chat -> chat-right-panel 渲染候选（status="valid" 分支显示 apply 按钮，名称/描述/模板预览）-> apply -> 落盘 -> clearProposeCandidate
2. **绿**：验证 chat-right-panel 对 Work 来源 candidate（空 relativePath + status="valid"）渲染正常；若有缺陷修补（应无需改，:165 exists=false 不读 relativePath）
3. **重构**：确认 applyAssetCandidate prompt kind 分支已支持（asset-insert.ts 末尾已有）
4. **退出**：Work -> Chat 审查 -> apply 端到端通；apply 按钮可见（status="valid" 分支命中）

### Phase D - 端到端（1.5d）

1. **红**：新建/扩展 `packages/app/e2e/` spec：Work 选预设 -> 生成候选 -> 点"存为资产" -> 切 Chat -> 审查（status="valid" + apply 按钮可见）-> apply -> Chat 资产工作室列表出现该 prompt 资产 -> 新会话插入 Composer 复用
2. **绿**：端到端联调；修 mode 切换、store 时序问题
3. **重构**：E2E 复用现有 mock-server fixture（参考 `packages/app/e2e/regression/session-todo-progress.spec.ts`）
4. **退出**：端到端通过；资产落盘可复用

### Phase E - 打磨（1d）

- i18n：`en.ts` + `zh.ts` + `zht.ts` 补 `work.asset.save`/`work.asset.save.success`（**parity.test.ts 约束 en/zh/zht 三 locale**）
- 埋点：`work_asset_saved` 事件（参考 PRD §12，对齐 `work.artifact_applied` 事件定义模式 `artifact.ts:32-40`）
- 测试补齐
- **退出**：`tsgo -b`（app）+ `bun run lint` + 全包 test 绿；parity 通过；改完即审 7 步全过

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）

```bash
bun --cwd packages/app test
bun --cwd packages/app typecheck       # tsgo -b
bun run lint
```

### 6.2 三模式选择

| 模式        | 何时用                                                    |
| ----------- | --------------------------------------------------------- |
| 普通 `it`   | 纯函数单测（captureWorkArtifactAsCandidate 是同步纯函数） |
| `it.effect` | 若涉及 Schema encode/decode 验证                          |
| E2E         | Work -> Chat 端到端                                       |

### 6.3 硬性规则

- 纯函数用普通 `it`，不手写 Effect runtime
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试
- 禁止 `Effect.sleep(N)` 等 fiber--用 readiness 信号

## 7. SolidJS / Effect 编码规范

- M2 主要写纯函数 + SolidJS 组件，基本不写 Effect 代码
- SolidJS：优先 `createStore` / `createMemo` / `createSignal`；用 `<Show>` 守卫
- 按钮 UI 全用 v2 token（`--v2-*`，禁硬编码颜色/间距/圆角，见 frontend-theming skill）
- 新代码用 `export * as Foo from "./foo"` 自导出；禁 namespace/别名 import/star import
- 若涉及 Effect：`Effect.gen` 组合，`Effect.fn("Domain.method")` 命名，`yield* new MyError(...)` 失败，禁 fork/forkDaemon

## 8. 分支与提交规范

- 分支：`work-m2`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `app`
- 每完成一个 Phase 一个 commit（`feat(app): ...`），不批量
- `.husky/pre-push` 会跑 `bun typecheck`--push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）

- [ ] Work 候选稿存在 + 未 applied 时，右栏 Artifact Tab 显示"存为资产"按钮
- [ ] applied 后按钮隐藏
- [ ] 点击"存为资产" -> 构造 prompt kind CandidateInfo（content=template, status="valid"）-> setProposeCandidate
- [ ] 点击后 setProposeCandidate + toast 提示；用户手动切 Chat 后右栏显示候选审查 UI（status="valid" 分支，apply 按钮可见）
- [ ] 用户 apply -> PromptAssetService.apply 从 name 计算 relativePath 落盘到当前 Location
- [ ] apply 后 clearProposeCandidate，Chat 资产工作室列表出现该 prompt 资产
- [ ] 新会话可插入该 prompt 资产到 Composer 复用
- [ ] 候选稿无标题时用通用名（"Work 产出"）
- [ ] description 超长时截断 300 chars
- [ ] CandidateInfo 字段完整（content + status + candidate 不含 relativePath）
- [ ] work-orchestrator 仍无 edit/shell（M2 不改 agent 权限）
- [ ] 埋点 `work_asset_saved` 上报
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck + lint + test 全绿

## 10. 改完即审（每 Phase 结束必须执行）

1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything / No Null Pointer / Security First
3. 整洁复查：No Cheating / Reusability / Clean Logs（不输出 API key/token/完整 prompt）
4. 数据流追踪：CandidateInfo 字段完整（content + status）；mode 切换前 candidate 已入 store；import 真实存在
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

## 11. 禁止事项（八荣九耻）

- 禁瞎猜接口--查 `codegraph`（MCP）或 grep 确认后再写。**特别是 CandidateInfo 结构**（prompt-asset-candidate.ts:9-25），必含 content + status
- 禁模糊执行--任务不清停下来问，不自我感动式盲目执行
- 禁创造接口--先查 owner module 能否复用（setProposeCandidate / applyAssetCandidate / chat-right-panel / useMode 都有现成）
- 禁跳过验证--改完必须跑对应包 test
- 禁破坏架构--遵循 ADR-11~15 + AGENTS.md 分层；新代码用 `export * as Foo` 自导出
- 禁假装理解--未知技术栈承认并向人类求助
- 禁长注释--默认无注释，仅 WHY 非显然处加一行
- 禁把 M1.5（ProgressLedger/Resume）/ M3（图表产出）混进 M2
- 禁门控 Flag--G4 已定不门控，Flag 与 Work 无关
- 禁新建 Service/HTTP/审查 UI/apply 链路--全复用 Chat

<!-- PROMPT END -->

---

## 使用说明

| 项             | 值                                                                        |
| -------------- | ------------------------------------------------------------------------- |
| 复制范围       | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                          |
| 新对话 model   | 默认（工程执行建议主力模型）                                              |
| 新对话打开文件 | `docs/plan/work-mode-execution-layer-m2.md`（范围真源）+ 本文件           |
| 开工顺序       | 通读 CLAUDE.md/AGENTS.md/skills -> git 切 `work-m2` -> Phase A 红测试开始 |
| 卡住时         | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁）         |
| 与 M1.5 并行   | M2 与 work-m1.5 分支互不依赖，可同时开发，合并时无冲突（不同文件）        |
