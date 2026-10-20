# 智能体交互与 UI · B1 Task 单契约 TDD 执行提示词（连续执行手册）

> **用途**：交给实施智能体连续完成 B1；既适用于新对话，也适用于当前执行者续跑。复制 PROMPT START/END 之间的正文。
> **结构参考**：[M4 执行提示词](/media/win_data/aigcfroge/docs/plan/prompt-todo-task-m4.md)的“认知加载→明确范围→复用资产→TDD 循环→实施步骤→数据流→批末审批”。不继承其旧分支、兼容要求、逐 Step 提交或历史测试通过声明。
> **范围真源**：[R2 实施计划](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-tdd-implementation.md)，本次仅 S00＋S01，八个 S01 需求全部完成，不自行裁剪，也不扩到 B2。
> **审批**：[原计划审批](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-tdd-approval-2026-09-30.md)＋[本次执行规则澄清](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-execution-clarification-2026-09-30.md)。R2 与 main 基线未改变。
> **节奏**：Step 内自行处理常规问题；Step 验证后直接下一 Step；整个 B1 完成才停止交审。没有每步提交、每步请示或只交预检模板的要求。

<!-- PROMPT START -->

你是 AigcForge 的高级全栈实施工程师。**你现在执行任务，不是编写计划或申请开工。B1＝S00＋S01 已获实施授权。** 在现有实施工作树完成准备、基线、Task 单契约切换和验证，最后一次性交回 B1 证据。

源仓库：`/home/keer/workspace/aigcfroge`。实施工作树：`/home/keer/workspace/aigcfroge-agent-ui-tdd-impl`。实施分支：`agent-ui-tdd`，已从源仓库本地 main 的冻结提交创建；本次优先**续跑**，不要再次创建分支或工作树。

**连续执行规则：读完材料就执行真实命令；缺依赖就按本手册初始化；测试失败就先定位、在授权范围内修复并重跑。不要因完成预检、安装依赖、通过一个测试或完成一个 Step 而询问“是否继续”。** 只在 §6 的真实阻断或整个 B1 完成时交回。

## 0. 认知加载（先读，读后立即执行）

### 0.1 权威与当前状态

先读 R2 的 §0.3、§2.1、§4、S00/S01、§7–10，以及原审批和本次澄清。它们是范围与验收依据；本手册是施工顺序，不另造业务契约。

开工核验一次并保存输出：

```bash
export SOURCE=/home/keer/workspace/aigcfroge
export ROOT=/home/keer/workspace/aigcfroge-agent-ui-tdd-impl
export MAIN_BASE_COMMIT=260e8275b9b0af9d0b445e5acfb6f4d3545eac7b
export RUN="$(mktemp -d /tmp/agent-ui-b1.XXXXXX)"

sha256sum "$SOURCE/docs/plan/agent-interaction-ui-tdd-implementation.md"
git -C "$SOURCE" rev-parse refs/heads/main
git -C "$ROOT" branch --show-current
git -C "$ROOT" rev-parse HEAD
git -C "$SOURCE" rev-parse --path-format=absolute --git-common-dir
git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir
git -C "$ROOT" merge-base --is-ancestor "$MAIN_BASE_COMMIT" HEAD
git -C "$SOURCE" status --porcelain=v1
git -C "$ROOT" status --porcelain=v1
```

- 实际 R2 SHA256 必须匹配审批记录；本轮预期为 `23ee8ddcc012a76fe72540ccbda0e5178cd2130c4e3c0db4daa8151dcee657c5`。以真实文件和审批记录交叉核验，不修改它们来凑一致。
- 本地 main 必须等于获批冻结值。实施目录须关联同一 Git common dir，分支为 `agent-ui-tdd`，冻结提交须为其祖先。首次创建时的 HEAD 相等证据已经有主审验证的 reflog；续跑不重复检查“分支必须不存在”。
- 当前分支已有本任务修改时核对执行账本、diff 和归属后继续；不因为自己上一步的修改导致 dirty 就再次停下来。发现未确认的他人同文件修改才停对应写集。
- 源工作树的未跟踪文档保持原样。计划/审批从 SOURCE 只读；源码、依赖、生成和测试只在 ROOT 操作，不混用两个 checkout 的结果，不把 SOURCE 的 node_modules 或源码复制成实施依赖。
- 如果现有实施目录确实丢失或身份不匹配，不重建覆盖现场；报告实际差异。不要把此异常路径当作正常续跑流程。

主审最近一次实测：分支和基线成立；工作树未安装依赖，Core/App/TUI 都在导入或 preload 阶段退出 1。见 [基线实测证据](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-s00-baseline-2026-09-30.json)。这是环境失败，不是业务 RED，也不是 S00 通过。启动时复查；若执行者已经补好依赖，直接重跑测试，不重复安装。

### 0.2 必读协议与代码

读取实施 checkout 的 CLAUDE、AGENTS、ARCHITECTURE、CONTEXT、DESIGN、受影响目录协议，以及 Effect、database、frontend-theming、reuse-first-refactor、quality-to-pr 的适用章节。读取 R2 指定的测试指南、Todo/Task 方案及 M7 规则。已读且未变的内容做针对性复核，不反复展开整仓调研。

B1 的既有 owner 和资产优先读取：

- [Task 契约](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/schema/src/session-task.ts)、[SessionTask](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/src/session/task.ts)、[旧 Todo facade](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/src/session/todo.ts)、[taskwrite](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/src/tool/taskwrite.ts)。
- [进度模型](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/app/src/pages/session/timeline/session-todo-progress-model.ts)及其生产调用方；从现有 Task HTTP group/handler、SDK、事件 reducer、AgentTaskHub 和 TUI 实际注册处追踪上下游。
- [Core Task 测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/test/session-task-service.test.ts)、[工具写入测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/test/tool-taskwrite.test.ts)、[工具更新测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/test/tool-task-update.test.ts)、[任务进度测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/core/test/task-progress.test.ts)。
- [App 进度测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts)、[TUI Task 测试](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/tui/test/plugin/task-todo-project.test.ts)、[既有 E3](/home/keer/workspace/aigcfroge-agent-ui-tdd-impl/packages/app/e2e/regression/session-todo-progress.spec.ts)。

符号/调用链查正确项目的 codegraph；字符串查全文。索引不可用时改用精确文件读取并说明，不因为缺少可替代的检索工具就请求业务审批。

## 1. 目标与范围（B1 全量，不自行缩减）

本批完成当前 Task 家族的一次直接切换：生产者/工具→Core→HTTP→生成 SDK→App/TUI→事件与回读都使用现有规范 Task 契约。

必须完整覆盖 R2 的八个需求：

- `AI-TDD-S01-R01`：真实 agentID 归属；未分配不冒充 Session agent。
- `AI-TDD-S01-R02`：task.updated 更新当前视图，保留折叠/焦点，不创建 session_todo 旁路。
- `AI-TDD-S01-R03`：六态写回不失真；expectedRevision 冲突明确报错并重取权威状态。
- `AI-TDD-S01-R04`：当前写入口/工具只产出规范 Task，不发布旧 todo.updated/三字段投影。
- `AI-TDD-S01-R05`：HTTP、生成 SDK、App、TUI/CLI 同一合同；退役入口不保留 alias/redirect/fallback。
- `AI-TDD-S01-R06`：清空、迟到 GET、失效连接回调、切 Session/Location 不复活或串入旧任务。
- `AI-TDD-S01-R07`：当前仍活跃的默认执行链经真实注册路径读写 Task，不只是前端变绿。
- `AI-TDD-S01-R08`：拒绝退役的 todos 包装/旧端点，非法状态由当前 Schema 拒绝；规范创建仍允许服务端生成 ID，不能以拒绝兼容为由破坏合法创建。

保住六态、稳定 ID/revision、schedule/DAG、agentID、outputDigest、子任务结算，以及 M7 标题下轨道/默认折叠/idle 留存。历史工具展开显示当次记录，不拿当前 Task store 重绘过去。

明确不做：S02–S09、WorkReview producer/API/UI、新的权限/问题状态机、默认 runtime/provider loop 重构、全仓 legacy 清理、新 Task API/SessionPlan/视觉专用事件、AgentHub M4 重做。

## 2. 可复用资产与禁止带入

- 唯一持久化 owner 是现有 SessionTask/TaskTable；复用现有 session.task API 和 task.updated，不造平行模型。
- 优先复用查询失效/重取、请求与连接代际、现有 UI/Token/i18n/Effect 测试 fixture。
- 当前消费者改齐后，同批退役 SessionTodo、TodoProjection/TodoUpdated、仅供兼容的 replaceLegacy、session_todo、双源时间戳、pickProgressTodos 和无用 sameTodoList。先查实际引用与业务校验；保留的业务校验归回 Task owner。
- 不从其他功能分支 checkout/cherry-pick 资产；本手册中的 M4 文件只是写作模板，不是依赖或代码来源。
- **不做兼容代码**。不因模型习惯、历史 payload、回退方便而留旧接口别名、版本分支、双写、双 store 或默认补旧字段。
- v1/v2 名称不是删除依据。当前默认运行链必须保住；不得为它新建兼容桥，也不得扩大为整条 runtime 的迁移。

## 3. TDD 强制循环（Step 内闭环，Step 间直接继续）

```text
精读本 Step + 复用/影响面确认
→ C：实际运行正确行为基线
→ R：写目标行为测试，确认真实业务断言 RED
→ 最小生产实现 GREEN
→ REFACTOR，原测试持续 GREEN
→ 焦点/相关家族 + 受影响包 typecheck + 增量 lint
→ 按 CLAUDE 改完即审，记录证据检查点
→ 自行进入下一 Step
→ 整个 B1 完成后才停下来交审批
```

- C 原先失败先分组找共因；缺依赖/导入/fixture 故障不算新需求 RED。
- R 必须用真实 owner/注册工具/DOM/HTTP 验行为与副作用；新模块可有类型正确最小外壳。usage、零测试、缺模块、expect(false)、源码字符串包含测试都不是有效 RED。
- 按 R2 留下可反证证据：仅在自己精确 patch 上验证正确实现可绿、撤回它再红；不能 reset/覆盖别人的工作。R 一开始已绿，如实归 C，不造失败。
- 失败先在本 Step 授权写集内修复，不把每个失败都升级为“等用户”。涉及真实数据/用户服务风险时先停止危险操作，再按 §6 判断是否需要交回。
- 测试用既有 testEffect/Layer/DOM fixture；不改测试成弱断言，不新装测试库，不用固定 sleep 或延长 timeout 掩盖问题。
- 新可独立测试逻辑按 R2 记录覆盖率（目标新增行至少 85%），关键负路径不能用覆盖率或 skip 替代。
- 本批用证据检查点代替模板的逐 Step commit。**未授权 commit/push/PR/发布，不自行提交。**

## 4. 实施步骤

### Step 1 — 续跑检查、环境初始化与 S00 基线

完成 §0 的身份核对，复用已核验的分支来源，不再反复创建/请示。保存关键代码核对、Bun 版本、实际 scripts、文件系统和测试端口记录。

**缺少 node_modules 是正常的工作树准备项，不是需要再次审批的问题。** 已授权在 ROOT 使用当前锁文件安装实施所需依赖；不允许改依赖版本、修改锁文件、复制另一分支 node_modules、全局安装或提权。

先定义日志函数（返回的是真实命令退出码，不是 tee 的退出码）：

```bash
run_check() {
  local name="$1" cwd="$2" rc=0
  shift 2
  printf 'cwd=%s\n' "$cwd" > "$RUN/$name.command"
  printf '%q ' "$@" >> "$RUN/$name.command"
  printf '\n' >> "$RUN/$name.command"
  (cd "$cwd" && "$@") > "$RUN/$name.log" 2>&1 || rc=$?
  printf '%s\n' "$rc" > "$RUN/$name.exit"
  printf '%s exit=%s log=%s\n' "$name" "$rc" "$RUN/$name.log"
  tail -n 25 "$RUN/$name.log"
  return "$rc"
}
```

依赖尚未安装时，执行而不是只列出：

```bash
sha256sum "$ROOT/bun.lock" "$ROOT/package.json" > "$RUN/dependencies-before.sha256"
run_check install "$ROOT" env HUSKY=0 bun install --frozen-lockfile
sha256sum -c "$RUN/dependencies-before.sha256"
git -C "$ROOT" status --porcelain=v1
```

当前 root prepare=husky；单次命令 HUSKY=0 用来避免改共享 Git hooks 配置，不是跳过产品测试或最终 hooks。保留仓库既有 postinstall/trusted native 依赖准备，不用忽略所有 scripts 冒充安装完整。普通缓存/网络临时错误先读实际日志，在不改锁文件/凭证/系统配置的范围内排查并有限重试；确实需要提权、秘密凭证、变更依赖或外部状态才能继续时再交回。

安装成功后实际运行以下既有 C；测试仍只在包内执行：

```bash
run_check C-core "$ROOT/packages/core" bun test --no-install --timeout 30000 \
  test/session-task-service.test.ts test/tool-taskwrite.test.ts \
  test/tool-task-update.test.ts test/task-progress.test.ts
run_check C-app "$ROOT/packages/app" bun run test:unit:file --no-install --timeout 30000 \
  src/pages/session/timeline/session-todo-progress-model.test.ts
run_check C-tui "$ROOT/packages/tui" bun test --no-install --timeout 30000 \
  test/plugin/task-todo-project.test.ts
```

每条命令都要读日志与统计；三条命令的退出码不得只看最后一条。遇到失败先修当前环境/fixture 共因，重跑至基线明确；不能开始写实现后倒补“原先绿色”。基线含后来将退役的兼容断言时保留历史结果，并在切换时迁移其有价值的业务场景，不要求旧合同永远绿。

按 S00 记录 D-D、待决排序、流内摘要/Composer 作答的已批准契约（本批不实现它们），提供文件定位。核实 E4 隔离/存储/provider/CI 条件；仅属于未来 B5 的依赖登记 X，不因为 B5 尚不可运行而阻断无依赖的 B1，也不提前执行 B5。

**在修改 App session/timeline 前，依包协议执行生产 benchmark 基线并保存结果**；沿用现有测试 harness，不启动/重启用户服务。B1 必需验证的前提缺失时在安全范围内准备，确实不可满足按 §6 报具体阻断。

S00 所需分支、C、契约与环境证据齐全后，直接进入 Step 2，**不要输出“等主审允许 S01”**。

### Step 2 — 生产者到消费者的单契约整体切换

对应 R04/R05/R07/R08。先查全 Task/Todo 的生产者、工具/提示词、HTTP/Schema、SDK、App query/event/store/Hub、TUI/CLI 与 fixtures，记录真正的 owner 和消费者。

**红**：从实际工具注册/HTTP/SDK 入口验证规范 Task 读写；退役入口不再适配；默认当前执行链能调用；非法状态拒绝；服务端生成新 Task ID 仍合法。新增 API 测试计划路径为 `packages/aigcfroge/test/server/httpapi-session-task.test.ts`，这是 ROOT 下拟新增文件，先创建才能运行。

**绿**：在同一个 Step 改齐调用链，规范 Task 一份 owner/store；移除被替代端点、工具/提示词与投影，不留下中间兼容桥。生成 SDK/OpenAPI，不手改生成物。业务校验、调度和权限仍属于原 owner。

**重构/验证**：移除无消费者的旧路径，迁移仍有业务价值的测试，查退役名称的实际剩余用途；历史文档/负例不是在线兼容。焦点/API/SDK、受影响包测试与 typecheck 过后继续 Step 3，不对这个中间步骤单独申请交付。

### Step 3 — 当前 Task 展示、真实归属与写回

对应 R01/R02/R03。

**红**：真实 agentID/未归属展示；task.updated 更新不重置折叠/焦点；六态写回完整；revision 冲突显示失败并重取权威结果。

**绿**：复用既有轨道/组件与规范 Task，cancelled 不计 completed，scheduled/failed 不压成 pending。默认折叠、idle 留存、键盘与当前焦点不退化；历史工具展开继续显示当次内容。

**重构/验证**：仅一份当前 Task store，文案/i18n parity 与 Token 合规；真实 DOM/生产组件/工具消费者测试，不用 story 或 helper-only 替代接线。焦点与受影响包门禁通过后继续 Step 4。

### Step 4 — 清空、并发与 scope 隔离

对应 R06，并回归 R02/R03。

**红**：空列表合法清空；迟到 GET/旧连接回调不复活任务；切 Session/Location 不串台；请求冲突与重取不抹掉较新状态。

**绿**：复用当前 query、连接/请求代际。单行 Task.revision 不是列表版本，不能用 max(row.revision) 判定空列表新旧。transport 缺少顺序保证时，通知只使 query 失效并合并重取，不再造双源 timestamp 仲裁。

**重构/验证**：给出决定顺序/归属的实际函数与测试，不只引用调用点；用 Deferred/Latch/现有 waits 协調竞争，不用 sleep 猜完成。通过后继续 Step 5。

### Step 5 — B1 全链验证、文档同步与交回

按 R2 §7 的命令、当前 scripts 与本批写集执行，不为了省时降级验收：

- R01–R08 的有效 RED、同测试 GREEN、重构后回归逐条有证据；规范 Task 实际 HTTP/生成 SDK/App/TUI/默认当前链贯通。
- 受影响包行为测试、tsgo typecheck；增量 lint 使用 `LINT_BASE_REF="$MAIN_BASE_COMMIT"`，不要拿移动的 main/origin/main 自比。新增文件另作 lint/格式检查，不能因 untracked 不在 diff 就算绿。
- HTTP/Schema 变更按 R2 再生 SDK、查 OpenAPI drift，coverage/auth exerciser 按适用硬门禁执行；effect advisory 单列，不豁免自己的新路径。
- 运行本批 Task 相关 E3；核实 spec 被选中、实际组件/用户动作执行，保存 trace。B1 必需 E3 不能登记成“以后再说”而宣称交付。
- 对本批 session/timeline 修改跑同口径 benchmark after，与 Step 1 before 对比；不冒充完成整个 B6。
- 对照原 Todo/Task owner 文档同步本批事实；适用契约记录同步现有 changelog。R2 冻结不改，执行状态写独立账本。
- 本批未交付项按现有 coverage-manifest/technical-debt 记录 owner、原因、unlock；登记不是自行缩减范围的批准。

结束时按 CLAUDE 做安全、整洁、数据流和差分复查，**整个 B1 完成后一次性交审**。不自行进入 B2，不提交、推送、创建 PR 或发布。

## 5. 数据流全貌（本次 B1）

```text
当前工具/生产者/用户写入
        ↓
SessionTask + TaskTable（六态、ID/revision、schedule/DAG/归属）
        ↓
现有 Task HTTP / 生成 SDK
        ↓
App/TUI 当前 Task 消费者 ← task.updated → 当前 query 失效/权威重取
        ↓
轨道 / Task 详情 / Agent 归属 / 当前写回

历史工具展开 ← 当次 ToolPart 记录（不由当前 store 覆写）

旧 Todo facade / projection / endpoint / store：在同批当前调用方切齐后退役
```

## 6. 强制规则、真正的停止条件与交付格式

### 6.1 不需要再询问的事项

- 核验并续跑已创建的本任务分支；在 ROOT 初始化锁定依赖、使用现有缓存、执行本批构建/生成/测试/基准、保存日志。
- 在已批准写集内编辑代码、补测试、修正自己导致的编译/行为失败、复用既有工具进行定位；Step 完成后进入下一 Step。
- 在当前执行轮次给简短进度说明并继续工具操作。**进度说明不等于结束回复，不是等待批准。**

### 6.2 只有以下情况交回用户决策

1. 实际计划/审批/main 基线不匹配，或工作树身份/他人改动归属不清；不能靠改审批记录、reset 或覆盖现场消除差异。
2. 正确实现确需超出 B1 写集、改变批准业务/架构/权限契约，或只能靠兼容层才能完成。
3. 需要真实数据删除/迁移、提权、未提供凭证、用户服务操作、远程发布等未授权动作。
4. 当前批次必需环境或外部依赖经过具体、有限、安全的排查后仍无法获得；报告实际尝试与原始错误，不只说“缺环境”。
5. 发现可能造成跨 scope/权限/数据风险的情况：先停止危险动作；能在本批安全隔离修复的先修复，只有无法保证安全或需要额外决策时才交回。

普通缺依赖、某个 RED/C 失败、检索工具不可用、自己的代码尚未编译通过、未来 B5 的依赖未就绪，**本身不构成向用户询问是否继续的理由**。但它们绝不能被标成通过。持续定位修复，不用增加等待/兼容代码或降低断言来撞绿。

### 6.3 工程与安全红线

- 不做旧版本兼容；不清库；不自动 fetch/pull/rebase/cherry-pick/reset/stash；不覆盖源工作树，不更换实施起点。
- 保持 Task/Permission/Question/WorkReview 各 owner、Location/Session scope 和 V2 admission/runner 不变量；不因目录名删除仍活跃路径。
- Effect/Schema/模块导出遵循协议；不 as any、不 @ts-ignore、不吞预期错误；没有第二持久化/审批/任务真源。
- 安装依赖与运行测试不代表允许操作用户服务、上传用户数据或调用未批准的外部 provider。测试使用既有隔离 fixture；只有测试 harness 自己的资源可清理。
- 不自动联系其他聊天、创建周期任务或提交发布。由用户转交最终证据。

### 6.4 最终回复只交付真实结果

正常最终回复只有两种：**B1 已完成、可交审**，或**B1 受具体阻断、需决策**。不是让执行者在已有真实阻断时沉默，也不是允许未完成硬说完成。

证据包括：分支/工作树/基线；真实改动文件；R01–R08→生产 owner→测试映射；每条 C/RED/GREEN/REFACTOR 的完整命令、cwd、exit、pass/fail/skip、日志；包检查/API/SDK/E3/benchmark；未交付与风险；CLAUDE 复查结论。

没有执行就写未执行，有环境错误就写环境受阻；禁止“已记录待执行＝C 完成”“未运行＝门禁通过”“没有证据＝风险无”。分支和哈希的既有证据可以引用，不必每次重复一整页；重点交付新增运行结果。

现在从当前真实状态继续：**核验既有工作树→缺依赖则按锁文件安装→实际运行 C→补齐 S00→连续实施 S01→B1 整批交审**。不要回复“准备好了，是否继续”。

<!-- PROMPT END -->

## 使用说明

将标记之间的正文完整交给执行者；续跑时无需重建分支。原执行者正在使用旧提示词时，明确要求“以本版替换旧的执行流程，并保留已经完成的有效工作”。审批仍按 B1–B6 的原批次边界进行，本版没有授权执行后续批次。
