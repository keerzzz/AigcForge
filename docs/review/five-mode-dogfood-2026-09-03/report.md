# AigcForge 五模式真实用户端到端测试报告

- **测试日期**：2026-09-03（Asia/Shanghai）
- **测试方式**：真实 Chromium 浏览器 + `agent-browser`（Playwright 驱动），结合真实本地后端；不是静态代码审查替代品。
- **正常测试地址**：前端 `http://127.0.0.1:4445`，后端 `http://127.0.0.1:4096`
- **Custom 专用测试地址**：前端 `http://127.0.0.1:4446`，后端 `http://127.0.0.1:4097`，后端启用 `AIGCFROGE_CUSTOM_MODE=true`
- **测试素材**：一次性 Git 项目位于 `/home/keer/Desktop/aigcfroge-e2e-fixture-20260903-Ii9Kwz`，Custom 素材项目位于 `/home/keer/Desktop/aigcfroge-custom-fixture-20260903-rbNlGH`

## 结论摘要

当前分支具备较完整的五模式 UI 外壳和大量回归测试，但**不能作为五模式完整可用版本交付**。最严重的问题集中在 Custom 的创建/快照链路，以及 Chat 导入结果链路；Assistant 的真实模型无响应时也没有超时、错误或重试出口。

- 非性能 Playwright E2E：**26 个文件、100 个用例**。
- 首轮按 6 worker 并行运行：31 通过，6 个首次导航超时；这 6 个在单 worker、独立端口下全部重跑通过。
- 因此在稳定测试条件下，现有 100 个 E2E 用例均得到通过证据。
- 真实后端/真实浏览器探索发现 **8 个需要修复的问题**，另有多项技术债/测试覆盖债。
- 未修改产品源代码；报告与证据复制到本目录。工作树中另有一个测试文件的外部未提交修改，见文末。

## P0 / 阻断级问题

### BUG-CUSTOM-START：Custom 启动成功后前端丢失返回的 Session

**严重度**：P0 / Blocker
**分类**：功能、数据流、Custom 模式

**复现步骤**：

1. 打开 Custom 模式。
2. 选择真实 Agent `qa-reviewer`。
3. 等待计划接口成功，确认“启动会话”变为可用。
4. 输入标题 `Custom QA Reviewer Session`，点击“启动会话”。
5. 在新建草稿中输入任意请求并点击发送。

**预期**：启动接口返回的真实 Session 被打开，用户在该 Session 中继续发送消息。
**实际**：

- `POST /custom-composition/start` 返回 200，并创建 `ses_f9802d2d5ffe2hUpbmVXsoUhHI`。
- 前端只导航到 `/new-session?draftId=...`，页面是空白普通草稿。
- 点击发送后又调用普通 `POST /session`，返回 400。
- Custom Session 的原子创建结果没有被绑定到当前 Tab/路由。

**根因线索**：`/media/win_data/aigcfroge/packages/app/src/components/custom/custom-preview-column.tsx:105-112` 只检查 `res.data.session.id`，随后调用不带 `sessionID` 的通用 `launchModeSession(...)`；该 helper 会创建普通草稿，而不是打开返回的 Session。

**证据**：

- `dogfood-output/screenshots/75-custom-agent-selected.png`
- `dogfood-output/screenshots/76-custom-detail-immediate.png`
- `dogfood-output/screenshots/77-custom-send.png`
- 网络记录：`dogfood-output/artifacts/custom-tabs-final.txt` 及浏览器网络输出中 `custom-composition/start 200`、随后 `session 400`。

**建议**：使用 start 响应中的 Session ID 直接 `addSessionTab/select` 或复用 `openSessionRecord` 语义；增加端到端断言：`start 200 -> 路由进入 session/:id -> 不再调用普通 POST /session`。

### BUG-CUSTOM-SNAPSHOT：Custom 详情页无法解析服务端刚创建的快照

**严重度**：P0 / Blocker
**分类**：功能、Schema/协议兼容性、详情页

**复现步骤**：

1. 使用上一个问题中创建的 Custom Session，直接打开其 canonical Session URL。
2. 观察右侧“自定义快照”区域。
3. 点击发送并等待至少 65 秒。

**预期**：显示快照摘要、根 Agent、绑定的指令/技能/命令，并显示运行状态。
**实际**：

- `session.composition` 返回 200，响应含 `version: 1`、digest 和 `data.agentID: qa-reviewer`。
- 前端显示“无法加载该会话的组合：服务端返回的组合本客户端无法解析”。
- UI 显示 digest 为 `-`、根智能体为 `-`、提示词/技能为空。
- `prompt_async` 返回 204，但用户看不到任何明确的组合运行上下文。

**已验证根因**：`/media/win_data/aigcfroge/packages/app/src/components/custom/custom-snapshot-panel.tsx:45-63` 使用当前 `Snapshot` 解码器；对真实响应运行同一 Schema 解码后得到 `SchemaError(Expected string | undefined, got null at ["profilePath"])`。服务端 V1 snapshot 返回 `profilePath: null` / `profileRevision: null`，客户端 Schema 将其声明为 optional string，而不是 nullable string，导致合法 200 响应被拒绝。

**证据**：

- `dogfood-output/screenshots/78-custom-canonical-detail.png`
- `dogfood-output/screenshots/80-custom-canonical-result.png`
- 真实响应已保存到 `dogfood-output/artifacts/custom-snapshot-response.json`：`version: 1`、digest `8f3dc2ad...`、`agentID: qa-reviewer`。
- Schema 复现：`profilePath: null` 触发 `Expected string | undefined, got null`。

**建议**：统一服务端与客户端的 nullability：要么服务端省略 profile 字段，要么 SnapshotV1 接受 `null`；随后明确 V1/V2 snapshot 的读取兼容矩阵，并加 schema-contract E2E 覆盖两种响应。

## P1 / 高优先级问题

### BUG-CHAT-IMPORT：Chat 导入解析成功后结果视图永远不显示

**严重度**：P1
**分类**：功能、Chat 模式、导入流程

**复现步骤**：

1. 打开 `/mode/chat`。
2. 点击“导入”。
3. 选择“粘贴文本”。
4. 粘贴一段非空素材。
5. 点击“在 Chat 中审阅”。

**预期**：接口返回候选资产后，弹窗切换到“解析结果”，显示候选、警告、错误，并提供“导入并应用”。
**实际**：

- `POST /import-asset/parse` 返回 200。
- UI 仍停留在输入弹窗，文本和按钮原样保留。
- 等待数秒或再次点击均不进入结果页，用户无法继续导入。

**根因线索**：`/media/win_data/aigcfroge/packages/app/src/components/chat/chat-import-dialog.tsx:342` 在组件函数体中用非响应式 `if (state.phase === "result") return <ResultView />`。Solid 组件函数不会因 store 字段变化重新执行；`setState({ phase: "result" })` 虽然执行，但渲染分支不重新计算。

**补充观察**：对同一素材直接调用接口返回候选 `kind: prompt`，说明后端解析请求本身已经成功。

**证据**：

- `dogfood-output/screenshots/85-chat-import-stable.png`
- `dogfood-output/screenshots/86-chat-import-review.png`
- `dogfood-output/screenshots/88-chat-import-parse-settled.png`

**建议**：用 `<Show when={state.phase === "result"} fallback={...}>` 或把两个阶段放在同一响应式 JSX 树中；补一条真实浏览器测试，断言 200 后出现“解析结果”和“导入并应用”。

### BUG-CHAT-ASSISTANT-STALL：Chat/Assistant 真实模型无响应时永久停留在“思考中”

**严重度**：P1
**分类**：功能、可靠性、Chat 与 Assistant 详情页

**复现步骤**：

1. 从 Assistant 首页点击“新建助手对话”，或从 Chat 模式点击“新建会话”。
2. 输入一个不需要工具的简单问题。
3. 发送并等待 40-75 秒以上。

**预期**：收到回复，或在模型不可用/超时后显示失败、重试、切换模型等明确出口。
**实际**：

- 会话创建成功，专属“提醒”审查标签打开。
- 页面一直显示“思考中”，没有 assistant 回复、错误、超时或重试按钮。
- 浏览器没有 JS error；发送请求被接受，但用户无法判断是否仍在运行。

**限制说明**：本次后端使用的实际模型/提供商是否在该时刻可用无法由 UI 单独证明，因此“模型本身无响应”不判定为提供商故障；**可判定的产品问题是无超时/失败降级状态**。

**证据**：

- `dogfood-output/screenshots/67-assistant-detail.png`
- `dogfood-output/screenshots/96-chat-detail-immediate.png`
- `dogfood-output/screenshots/97-chat-detail-result.png`
- Assistant/Chat 详情页等待后的 snapshot 和网络记录。

**建议**：为 provider turn 建立可见超时和 retry 状态；将“请求已接收但尚无输出”与“执行失败”分开；提供停止后可重试/切换模型的动作。

### BUG-WORK-PERMISSION-DENY：Work 权限拒绝后静默停止

**严重度**：P1
**分类**：功能、权限 UX、Work 详情页

**复现步骤**：

1. Work 首页选择“撰写 PRD”。
2. 发送预设自动注入的启动请求。
3. 对第一次 shell 请求选择“允许一次”。
4. 对随后递归读取用户全局目录的 shell 请求选择“拒绝”。

**预期**：任务继续而不需要该权限，或明确显示拒绝原因、影响范围和“重试/改用无工具模式”。
**实际**：Shell 卡片变为“失败”，Artifact 仍为空；没有错误说明、重试建议或任务终止原因。用户只能手工重新输入完整需求才能恢复。

**证据**：

- `dogfood-output/screenshots/46-work-after-20s.png`
- `dogfood-output/screenshots/47-work-after-permission.png`
- `dogfood-output/screenshots/48-work-after-deny.png`

**风险补充**：PRD 预设还请求了 `ls -la /home/keer`、`.aigcfroge`、`.agents` 等用户全局目录读取，超出用户只要求起草 PRD 的最小权限范围，建议缩小启动探索范围或先向用户解释用途。

## P2 / 中低优先级问题

### BUG-MODE-REENTRY：模式工作区在冷加载/刷新/窄视口下可能只剩顶栏

**严重度**：P2（对 Work 可升级为 P1，取决于发生率）
**分类**：可靠性、性能、响应式布局

**复现步骤**：

1. 使用真实浏览器打开模式工作区并在模式之间切换。
2. 在 390×844 窄视口下从 Chat 进入 Work，或直接刷新 `/mode/work`。
3. 等待 10-30 秒。

**实际**：某次冷路径下 URL 已是 `/mode/work`，但主区只有顶栏和上一个会话标题，Work 预设列表缺失；无错误提示。之后从 Assistant 正确点击 Work 可恢复。

**观测数据**：

- 首次从旧页面进入 Work 的主区可见耗时约 10,065 ms。
- 另一次直接刷新后等待 10 秒仍无主区。
- 390×844 下 `scrollWidth === clientWidth === 390`，因此不是水平溢出，而是内容未挂载/未完成。

**根因线索**：模式工作区采用 render-all + hidden slots；首次冷加载会同时涉及多模式懒加载和资源请求。浏览器网络中还观测到跨模式的 Assistant、Chat、Custom 资源请求以及重复请求。现有代码注释已承认 fallback-less Suspense 和隐藏槽位副作用隔离是敏感点。

**证据**：

- `dogfood-output/screenshots/41-work-home.png`
- `dogfood-output/screenshots/92-work-narrow-after-wait.png`
- `dogfood-output/screenshots/93-work-desktop-recheck.png`
- `dogfood-output/screenshots/95-work-after-correct-reentry.png`
- `dogfood-output/artifacts/work-load-time.txt`

**建议**：为每个模式主区提供本地 loading/error fallback；记录 slot load duration；确认隐藏槽位不会触发不必要资源请求；将路由可见状态与 slot ready 状态分离。

### BUG-RESET-NO-CONFIRM：详情页“重置到此点”立即回滚

**严重度**：P2
**分类**：UX、数据安全

**复现步骤**：在 Coding 详情页点击“重置到此点”。

**实际**：没有确认对话框，消息立即被回滚，原提示词和附件被放回输入框。对用户来说这是破坏性且可能丢失后续对话的操作。

**证据**：`dogfood-output/screenshots/30-coding-reset-confirmation.png`（实际显示回滚后的状态，不是确认框）。

**建议**：首次/有后续消息时增加确认；明确说明会移除哪些消息；提供撤销或恢复入口。

### BUG-HOME-EMPTY-NEW：无项目时首页“新建会话”无反馈

**严重度**：P2
**分类**：UX、空状态

**复现步骤**：在没有打开项目/会话的首页点击“新建会话”。

**实际**：点击后没有导航、toast 或说明；用户不知道必须先添加项目。

**证据**：`dogfood-output/screenshots/00-home-initial.png`、`dogfood-output/screenshots/01-home-new-session.png`。

**建议**：在无项目时进入项目选择器，或显示“请先添加项目”的明确引导。

## 已确认的技术债与工程风险

### 依赖安装与开发服务器并发会破坏运行环境

测试过程中另一个进程在 2026-09-03 21:09:37 执行 `bun install`，运行中的 Vite 随后出现：

- `Cannot find module .../node_modules/vite/dist/node/chunks/dist.js`
- `Failed to fetch dynamically imported module ... wasm-RTMEAGTG.js`
- `Failed to resolve import "@pierre/theming"`
- `Failed to resolve import "hast-util-to-html"`
- `Failed to resolve import "oniguruma-to-es"`
- 前端 500/504、纯黑空白或 HMR 后挂死。

这不是五模式业务逻辑单独造成的错误，但说明当前开发/测试流程没有保证 `node_modules` 与运行中进程的一致性。建议：禁止在活动 dev server 上原地 install；CI 先完成 frozen install 再启动；开发脚本对依赖布局变化做 fail-fast 检测；不要把“加 timeout”当根治。

### 重复命令注册与 Solid 生命周期清理警告

多个真实详情页操作后稳定出现：

- `duplicate command id "tab.close" registered; keeping first entry`
- `cleanups created outside a createRoot or render will never be run`
- `computations created outside a createRoot or render will never be disposed`

这不会立即阻断当前操作，但暗示 render-all/路由切换下命令注册和响应式资源没有完全按 mount/unmount 生命周期归属，后续可能造成重复快捷键、内存泄漏或重复请求。

### 当前已有技术债文档与实际观察的交集

`/media/win_data/aigcfroge/docs/technical-debt.md` 已记录以下与本次实测直接相关的项目：

- E2E 尚未覆盖窄视口、浅色主题、多语言、完整键盘焦点矩阵。
- E2E 曾不在完整 typecheck/CI 门禁中，测试基础设施本身需要强化。
- Custom Builder 的错误/加载态和 render-all slot 副作用隔离是高敏感区。
- Custom 资产创建和快照/运行时协议仍有后续演进债务。
- Agent handoff 的 `model` 字段仍被 file-loader 静默丢弃。

本次真实浏览器测试新增加的重点是：Custom start 返回值丢失、V1 snapshot 投影失败、Chat import phase 非响应式渲染和 Assistant/Work 无响应降级。

## 功能覆盖记录

### 首页

已操作：

- 空项目首页加载和空状态。
- “新建会话”入口。
- “添加项目”弹窗、目录加载、搜索输入、项目打开。
- 首页会话搜索。
- Chat/Coding/Work/Assistant 模式筛选。
- 项目列表和项目会话计数。
- 首页会话行打开详情。

结果：主体功能可用；无项目新建反馈和目录搜索行为存在 UX 问题。

### Chat 模式

已操作：

- Chat 功能导航：提示词、技能、MCP、命令、智能体、工作流、插件。
- 七类资产列表加载和数量展示。
- 资产搜索/无结果输入。
- 新建提示词入口，验证其注入新会话草稿。
- 导入弹窗：粘贴文本、文件/文件夹入口、解析请求和失败路径。

结果：资产导航可用；导入解析结果视图阻断；Chat 详情真实请求在本次默认模型下同样没有超时/失败出口。

### Coding 模式与详情页

已操作：

- Coding 模式首页、项目/会话空态。
- 新建 Coding 会话。
- 上传真实 TypeScript 附件。
- 真实模型读取文件并返回函数分析。
- 模型选择器、思考级别选择器。
- 上下文标签页、工具调用展开、缓存诊断。
- 复制消息/复制回复点击。
- “重置到此点”。
- 临时全权访问确认弹窗。
- 审查栏折叠/展开。
- 项目侧栏打开、附件移除、回滚消息展开。
- 打开文件入口。

结果：真实只读分析链路可用；重置缺少确认、动态 worker/生命周期警告、非 Git 项目“打开文件”无反馈。

### Work 模式与详情页

已操作：

- 四个分类及预设卡片。
- “撰写 PRD”预设启动。
- 真实模型生成 Markdown PRD 候选稿。
- Artifact/上下文标签切换。
- Shell 权限请求：允许一次、拒绝。
- 候选稿生成、应用入口和无候选稿空态。
- Work 任务列表/工作流/Artifact 相关既有 E2E 场景。

结果：预设和候选稿主链路可用；权限拒绝后无降级，Artifact 依赖异常时会出现黑屏/空白。

### Assistant 模式与详情页

已操作：

- Assistant 仪表盘。
- 提醒、记忆、知识库、悬空链接导航。
- 新建笔记。
- 笔记保存、打开编辑、修改标题和正文、删除。
- 新建 Assistant 会话。
- 详情页专属提醒面板、历史投递区域。

结果：知识库笔记 CRUD 可用；真实 Assistant 请求无响应时没有可见失败出口。

### Custom 模式与详情页

已操作：

- Custom 项目资产导航和分类筛选。
- 空资产态、搜索、使用方选择。
- 创建初始智能体入口。
- 合法 Agent 资产加载。
- 选择真实 Agent，验证 plan 200 和 Start 门禁。
- 工作流计划、指令、能力、权限、MCP、诊断标签。
- 启动 Custom composition。
- canonical Custom Session 详情页。
- 自定义快照、升级/编辑按钮、工作流运行状态、重新加载。
- Custom prompt_async 提交。

结果：Builder 的合法计划链路可用；启动跳转、快照解析和运行状态链路阻断。

## 既有 E2E 回归结果

### 批次一：模式/Home/Assistant/Custom Builder

- 19/19 passed
- 运行时间：约 2.9 分钟

覆盖：五模式 owner/slot、Home 跨模式会话、Assistant dashboard、Custom Builder 资产失败/重试/Start 门禁。

### 批次二：详情页、权限、工作流、Artifact、时间线

- 44/44 passed
- 运行时间：约 5.5 分钟

覆盖：审批、Assistant session panel、Work Artifact、Workflow runtime、任务中心、定时任务、评论、权限档位、时间线、附件。

### 批次三：剩余回归

并行冷启动首次结果：31 passed、6 个 `page.goto` timeout。失败全部发生在首次导航，不是断言失败。

单 worker、独立端口重跑结果：

- agent-asset-warning：1/1 passed
- builder-mcp-health：6/6 passed
- markdown-sanitize：3/3 passed
- session-list-path-loading：1/1 passed
- session-open-navigation：1/1 passed
- session-timeline-collapse-state：3/3 passed

因此三批合计覆盖的 **100 个非性能 Playwright 用例均有通过证据**；并行冷启动超时应作为测试/开发环境稳定性信号保留，而不是静默忽略。

## 未覆盖或不能宣称已验证的范围

- 未实际连接外部生产 MCP、第三方账号或远程服务器。
- 未在真实桌面 Electron 容器中完成同等全量走查。
- 浅色主题、全部语言、系统级键盘焦点矩阵未形成完整覆盖；这与现有技术债文档一致。
- 未把真实模型的每个 provider/model 组合都跑一遍。
- 未将发现的 Bug 自动修复；本次目标是测试、证据和根因收敛。

## 证据目录

本目录（`docs/review/five-mode-dogfood-2026-09-03/`）收了报告与**文本化**证据（14 个交互记录 + 2 个响应 JSON，共约 200KB）。

- 97 张截图（约 7.3MB）**没有入库**：体量与仓库价值不匹配，且只在配合本报告阅读时有意义。运行期原始目录为 `dogfood-output/`（已加入 `.gitignore`），如需复现请重跑 dogfood 流程。
- 原始运行目录里的相对路径为 `dogfood-output/screenshots/` 与 `dogfood-output/artifacts/`。

## 工作树状态

测试过程中没有修改产品源代码。测试期间 `git status` 显示的那个外部未提交修改：

- `packages/aigcfroge/test/server/httpapi-custom-composition-upgrade.test.ts`

已于 2026-09-04 由 S10 回归确认通过（4 pass / 0 fail）后提交（`98bacf376`）：它把 capability 缺失的断言从泛化的 `InvalidRequestError` 收紧为 typed `UnsupportedProductModeError` + `mode: "custom"`。
