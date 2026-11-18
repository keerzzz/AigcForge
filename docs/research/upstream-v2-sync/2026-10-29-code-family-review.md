# 2026-10-29 两套工作区代码族与逻辑核对

本文件是[唯一现行实施计划](2026-10-25-v2-alignment-execution-plan.md)的调查附件，不是第二份计划或债务账本。状态：**调查进行中，整体架构未闭环**。目录清单、静态阅读、历史测试和当前真实验收分别记录。

2026-10-29 文档线路更新：先读本仓 [CLAUDE](../../../CLAUDE.md)与[架构入口](../../../ARCHITECTURE.md)，下一批 B01 将本附件及现有剩余清单汇入完整能力矩阵。批次/提示词见[执行附件](2026-10-29-migration-batch-plans.md)和[提示词目录](2026-10-29-migration-session-prompts.md)；不按页面/包机械复制。以下行号/状态属于相应调查时点，正式任务先复核源码；本轮不重跑历史测试或取得 S1 权限。

## 当前人类要求

- 所有模式对齐固定 OpenCode V2 架构。Coding 与其他模式共同使用公共底座，Custom 复用既有能力组合、快照和会话生命周期，不另造运行系统。
- Session 详情标题栏不放任何资产按钮，包括单一资产入口或溢出按钮。先读默认工作区实际功能，再确定 V2 正确入口，不能由 Slot 可用性推导产品设计。
- 默认工作区新增独立 Home。必须核对 Home、模式工作区、Draft、已有 Session 的路由、导航、数据归属和完整会话逻辑。
- 原 S1 规划/实施/最终验收按[原 owner 与冻结记录](../../review/v2-implementation-owner-2026-10-29.json)和当前任务核对。本轮文档协作者只收口 B00 入口/路线；后续实施者由具体模块/合同任务明确，不自主增加设计、范围或接管其它小节。
- 理解代码同时评估逻辑合理性；发现不合理逻辑需优化，不机械移植。模糊、相互冲突或未理解的产品语义，由规划对话给出具体场景和选项向用户澄清。
- 新增架构记录见[统一底座与能力组合](2026-10-29-shared-foundation-decision.md)。用户已确定行为能力定义更新不改变旧会话组合；新版经新建/分叉采用。组合冻结与运行时授权、允许池内的Agent/Model选择分开。
- 调研完成具体小节后独立审查，再由主调度下发；实施期间可继续下一节只读调查，不能提前实施下一节。源码审查、包级测试、生产基准与真实桌面验收分别记账。
- S1当前执行者以[实施者记录](../../review/v2-implementation-owner-2026-10-29.json)为准；旧与第一替代App对话的HTTP400终止均已核实，写入授权已撤回。当前gpt-6.1-sol/max关联对话已交付S1并冻结，过渡子智能体恢复只读调查。真实窄屏验收发现共享Panel身份缺口，待独立审查补充任务；历史身份不构成额外并行写入权。

## 比较对象与覆盖边界

追加来源：《DeepSeek Harness 仓库架构分析》全文已读，官方dsh文档按明确commit核对；[研究映射H01–H18](2026-10-29-deepseek-harness-alignment.md)分离已证事实、构想、旧产品与错误推断。B01需将其纳入能力矩阵的来源/可信度、定义/提供者/消费者、版本/生命周期/验收字段，不能当作当前V2代码已实现或新授权；不因强化五模式而新增AgentNode/总线/轨迹库。

默认工作区 `/home/keer/workspace/aigcfroge`：HEAD `edbe67383d830aa40269ddf453c7f5617c940b46`，当前 WIP 也是参考，保持只读。实施工作区 `/home/keer/workspace/aigcfroge-v2`：当前 HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`。固定上游：`4617210822bdbb31e5749751afbfb4584ccedac8`。固定上游、V2 迁移增量和默认产品必须分别判断。

已生成默认17包、V2当前25包的文件与内部依赖清单，并保存固定上游文件清单。原始材料在 `/home/keer/task-backups/desktop-acceptance-coordination-20261029/` 的 `workspace-coverage-inventory.json`、`default-file-inventory.txt`、`v2-file-inventory.txt`、`fixed-upstream-file-inventory.txt`。这只是覆盖范围，不表示已逐行阅读或完成验证。

按以下代码族完成“产品合同 → 入口 → 决定函数 → 数据/状态 owner → 副作用/错误/恢复 → 测试 → V2 对应点”核对，每族记录已读与未读范围：

1. **Home、模式导航、Draft、Session、Tabs**：默认 App 的 app/HomeOverview/ModeWorkspace/layout helpers/tabs/session-route；V2 App 的 shell/routes、home、new-session、session-resolution、session/model、shell/tabs 与 Client Session 数据。优先完成跨 server/project/directory、child、刷新/前进后退、旧/未知路由和模式继承。
2. **共享 UI 与窗口**：App、session-ui、ui、theme、gui-extensions、storybook。核对 Shell、侧面板、Composer、Timeline、状态栏、主题/i18n/无障碍和局部 loading/error；保留焦点、滚动、恢复及性能合同。
3. **Chat 与七资产/导入**：默认工作台、ChatAssetsProvider、Feature/Session 导航、右栏预览、捕获/导入/插入；两边 Schema/Core 的 typed asset、文件/registry/CAS/引用和 Server/Client 消费。管理、Session 候选和运行消费分别核对。
4. **共同会话执行与持久化**：Core Session 准入、inbox、投影、execution/runner、Instructions、compaction、event feed、权限、存储、数据库与恢复。保持固定 V2 first-admission-wins、Step/Physical Attempt 和启动恢复语义，不能回植旧循环。
5. **模型与工具运行**：默认 llm/aigcfroge/plugin，对照 V2 ai/core/codemode/plugin/plugin-browser；核对模型能力、工具构建/注册/执行、MCP/秘密/连接、Skill/Command 消费及插件生命周期。
6. **Custom/Meta**：Profile、Builder、plan/start、immutable snapshot、资产引用、权限/能力、注册与恢复。核对真实用户入口如何进入共同 Session，区分冻结内容和实时运行能力。
7. **Work/Task/Delegation/Workflow/Assistant**：分别核对进度、调度/时区、child 与调用快照、委托与工作流生命周期、个人记忆/Notes/KB/提醒及可见域。Meta 记忆不替代个人记忆，Assistant schedule 不替代 Work Task。
8. **公开传输与跨端**：默认 schema/server/sdk/js/aigcfroge，对照 V2 schema/protocol/server/client/httpapi-codegen/cli；核对公开生成与运行依赖、HTTP/事件/认证/分享/外部 CLI 和兼容消费者。
9. **桌面与交付依赖**：desktop/cli/tui/script/latex/merman、http-recorder/simulation/util，以及默认 effect-drizzle-sqlite/effect-sqlite-node 桥接。核对 bundled CLI、服务发现/复用、IPC/storage、PTY、发布更新、旧库副本、配对性能与平台。generated/vendor 以生成源、依赖和消费边界核对，不随意重写。

## 已完成的首批源码核对

### Home 和会话归属

- 默认 `packages/app/src/app.tsx:739` 的 `Routes` 将 `/` 映射到 `HomeOverview`、`/mode/:mode` 映射到 `ModeRoute`、`/new-session` 映射到 `DraftRoute`，已有 Session 走 `/server/:serverKey/session/:id`。旧 ADR-15 根路径重定向文字已被当前实现及 ADR-16 后续决定取代。
- 默认 `HomeOverview`（`packages/app/src/pages/home-overview.tsx:50`）拥有当前 server 的项目/模式筛选与会话聚合；`openSession:150` 调用 `openSessionRecord`。后者在 `packages/app/src/pages/layout/helpers.ts:293` 解析项目并调用 `openSessionByID`，不复制 Session runtime。
- 默认 `TargetSessionRoute`（`packages/app/src/app.tsx:132`）检查目标 server；`ResolvedTargetSessionRoute:231` 读取 Session、root 和目录，成功后才添加 tab 并使 mode 跟随 Session。V2 应使用自身 Session/Location/cache owner 实现相符的用户归属保证，不能复制旧缓存为第二真源。
- V2 `AppRoutes`（`packages/app/src/shell/routes/routes.tsx:43`）已有独立 Home/Draft/canonical Session，`AppLayout:86` 统一挂载 Shell；当前没有默认工作区模式工作台路由。Home 筛选不等于模式工作台完成。
- V2 `ResolvedTargetSessionRoute`（`packages/app/src/session/route.tsx:115`）经 `createSessionResolution` 解析 Location；`SessionPage:183` 统一进入 `SessionScreenView`。共同底座已存在，不能为“提取 Coding”另造 BaseSession 或平行 runtime。
- V2 `createNewSessionComposerAdapter`（`packages/app/src/new-session/composer-adapter.ts:23`）在 `start:50` 捕获 mode，第111行调用共同 `data.session.create`，agent/model 独立传入。`NewSessionView:49` 只列普通模式；Custom 必须继续既有 composition start/freeze。
- Home的列表筛选与新建选择目前分开：`home/model.ts:78`的openProjectNewSession只传server/directory，`home/sessions/controller.tsx:397`直接复用它；Draft由自身mode和`TabStorage.genericMode:75`解析。后者只对真正省略字段的旧Draft默认Coding，不把未知/Custom持久值改成Coding。模式工作台未来的新建动作需明确携自身mode，不能借修改Home筛选状态实现。

### 共同会话执行入口

- V2 `Session.prompt`（`packages/core/src/session/session.ts:156`）统一执行 reconcile、prepare、admit；第187行只在 `resume !== false` 时 wake。模式在运行支持检查处参与，不产生第二套 prompt 入口。
- V2 `SessionExecution.drain`（`packages/core/src/session/execution.ts:89`）从 SessionStore 取 Session，第98行调用共同 runner，并由 `instances.provide(session)` 解析执行范围；没有按普通模式另选 runner。
- V2 `startCustom`（`packages/core/src/session.ts:392`）先 freeze，发布公共 SessionEvent.Created，其 commit 回调第432行写 snapshot；`createCustom:548` 转入此路径，后续 prompt 仍进入共同 admission。
- V2 `SessionContext.select`（`packages/core/src/session/context.ts:150`）普通模式按 Session.agent 选择，Custom 取冻结选择；统一组装权限、工具 snapshot 和 Instructions，Custom 加入冻结约束。权限关系由 `PermissionEffective.compute`（`packages/core/src/permission/effective.ts:56`）决定。
- 当前生产调用与遗留策略文件必须区分：`core/src/product-mode-agent-policy.ts`仍声明旧的按模式Agent/command限制，但对packages内TS/TSX的引用检查只找到该模块自身、一个测试和Schema注释。真实普通Session选择仍由上述SessionContext决定；Custom约束由SessionComposition执行。该旧纯函数测试不能证明这些限制已接到当前普通会话链。后续公共组合/预设迁移应确定能力约束owner，不能为了“统一”直接把旧meta根约束施加给Coding或删除现有Agent/Model选择器。本轮未修改策略或运行新行为复现。

以上是当前工作树的静态调用链证据，权限等文件含既有未提交增量；固定上游差异、默认旧入口和所有生命周期分支仍在继续核对。本次未据此宣布全模式行为或桌面验证完成。

### 2026-10-29 补充生命周期与导航核对

- 固定V2与迁移树的 `SessionInbox.matches:69` / `reconcile:155` 保持同Session/type first-admission-wins；`promote:501`决定steer优先与idle一次一个queue。`SessionRunCoordinator`与固定commit无diff；`resume:false`只跳过wake，不取消持久准入。
- `core/src/session.ts:454` 普通创建保留调用方Agent并按parent/input/default决定mode；普通fork关系由 `session/projector.ts:156` 的projectFork决定，独立fork无parent，内部child选项才产生linked child。Fork继承最新Instructions，不能宣称恢复任意历史配置时点。claim/release/restart预算仍在原owner；Workflow/Delegation恢复扩展内部状态机尚未穷尽。
- 默认公共旧promptAsync链为 `aigcfroge/.../handlers/session.ts:858` → `session/prompt.ts:1730/1759` → `core/session.ts:803 admitWithSelection`。原子提交由 `core/event.ts:503 publishBatch` 第525行一个事务决定，第548行后才通知；旧注释的“剩余崩溃窗口”与实现不符。未证明整个选择流程有按Session串行锁；不得由Effect.uninterruptible推导串行化。旧exact-retry不搬入固定V2。
- 默认 `components/mode-switcher.tsx:61` 只navigate，`app.tsx:710` ModeRoute将参数写入独立展示mode；`DraftRoute:343/369`按draftId读取自己的mode；`ResolvedTargetSessionRoute:246/280`从实际Session恢复展示mode。V2 `new-session/screen.tsx:118`才是具体Draft模式选择入口。导航不是修改DraftTab.mode。
- 默认 `session-side-panel.tsx:222/377`经active gate挂载ChatRightPanel；Coding与Chat分别消费同一SessionRightPanel。V2 `runtime/extension/panels.tsx:98`按region解析Panel，`side-region.tsx:38/72`拥有标签和MenuItem菜单，适合候选入口归位的限定调查。

这些补充是静态核对结论；没有把旧公共facade中的mode/parentID丢弃问题归咎于V2原样转发的Server create，也没有据此改变现有选择器行为。

### 已确认的产品澄清

默认 `buildHomeSessionRecords`（`packages/app/src/pages/home-sessions.ts:63`）遍历已打开项目目录、丢弃无法归属的记录；V2 同名函数（`packages/app/src/home/sessions/records.ts:18`）在无目录筛选时保留当前服务器索引，允许为尚未打开的项目构造显示记录。用户已明确选择**当前服务器的所有会话，包含尚未打开的项目，沿用 V2 现有范围**，见[原问题与答复](p1-home-scope-decision-2026-10-29.json)。模式/项目筛选和 Session 自身身份归属继续保留；不把本次选择扩大成跨服务器聚合或更改其他 Session 可见性、保留规则。迁移不得恢复默认工作区的已打开项目限制。

### 默认工作区主区和资产边界

- 默认 `modeSurface`（`packages/app/src/components/mode-surfaces.tsx:208`）按 `MODE_SURFACES` 返回 Sidebar/Main。Chat 使用 ChatFeatureSidebar/ChatAssetWorkbenchMain，Coding 使用项目栏/Session 列表，其余模式也通过同一映射进入共享工作区。
- 默认 `ModeWorkspace`（`packages/app/src/pages/mode-workspace.tsx:74`）按 Chat 激活控制 ChatAssetsProvider 输入；`ModeWorkspaceBody:126` 将同一资产 owner 交给侧栏和主区，第158/177行渲染共享 slots。当前代码已归并资源，旧审查“三路 resource”的历史事实不能直接套用。
- 默认 Chat PRD 第23行区分资产管理中心和跨模式捕获，第275行起描述 canonical Session 右栏与 Coding 的共享关系。生产右栏/候选/捕获链仍在逐函数核对，PRD 不作为已实现证明。
- V2 七入口由 `packages/gui-extensions/src/skill-proposals/renderer.tsx:119` 等七处注册到 `session.header`；`packages/app/src/runtime/extension/render.tsx:33` 按 slot 排序全部渲染。真实1280px Electron窗口中七按钮合计约867px，标题约155px；该入口不因保存链通过而合格。
- V2 `packages/app/src/shell/shell.tsx:89` 的 `window.bottom` 当前仅接默认隐藏 DebugBar；默认 `packages/app/src/pages/layout.tsx:95` 和第132行实际挂载 ModeSwitcher/StatusBar。旧 status-bar.md 的“无实现”页头已过时。

### 已发现需要优化或适配的真实逻辑

- 默认 `ChatAssetsProvider`（`packages/app/src/components/chat/chat-assets.tsx:83`）已将七类列表收敛到同一资源；`currentList:211` 检查请求归属，`merged:217` 使用同一合并结果，`counts:243` 从该结果派生。决定遮蔽关系的是 `mergeAssets`（`packages/app/src/components/chat/asset-workbench.tsx:147`）：以 kind + NUL + name 去重，项目资产遮蔽同种同名系统资产。这一现有归一化应保留，不能在 V2 再为侧栏计数单独造请求和缓存。
- 默认 `ChatAssetWorkbenchMain`（`packages/app/src/pages/mode-workspace-slots.tsx:442`）的新建和导入分别在第460/477行启动标准 Chat Draft，携初始内容；第569行通过 AssetSessionSelector 插入资产。这些入口不能被 Session 标题按钮替代。
- 默认 `onDeleteAsset`（同文件第503行）向七类删除方法传固定 `sessionID: "ses-home-delete"`（第511行）。V2 `AssetLocation.atSessionLocation`（`packages/server/src/handlers/asset-location.ts:27`）读取真实 Session，并在第43行核对 directory/workspaceID；`PromptAssetHandler` 第78行的删除使用此边界。直接移植旧占位 ID 会触发拒绝，这是根据当前决定函数得出的静态结论，尚未宣称跑过该 UI→V2 失败链。正确迁移必须查清管理页的 Location 级 mutation/授权合同并复用现有 typed owner，不能填假 ID、隐式造会话或取消 Session 归属校验来凑通。
- V2 `createSessionResolution`（`packages/app/src/session/session-resolution.ts:37`）以当前 store + Session ID 管理请求失效，并用独立 metadata/message/pending 读取避免路由 transition 被 resource 悬挂。默认旧页面的 createResource/placement 机制不能机械复制；需保留用户归属行为并沿 V2 当前解析 owner 实现。

## 逻辑评估与优化规则

### 全局导航与底栏的补充核对

- 默认 `context/mode.tsx:8` 的 MODE_DEFINITIONS 是五个模式的 href/icon/i18n/surface 映射；`components/mode-switcher.tsx:61` 只导航。`pages/layout.tsx:95` 在 Home 隐藏 rail，第132行始终挂载 StatusBar。全局模式入口不能以改 Home 的筛选代替，也不能在导航时修改已经存在的 Draft/Session mode。
- 图标本体也尚未迁入：默认 `ui/src/v2/components/icon.tsx:88` 起已有五个rail图形及assistant small变体；V2当前IconName目录没有这些名称。应将需要的既有SVG接入V2 `ui/src/icons/catalog.ts`及其getIcon/现有sprite渲染链，不复制旧Icon组件或另建sprite。默认图形为16×16；V2 additionalIconViewBox第114行还区分16/20视框，必须保留正确视框，不能直接塞入默认20视框后凭肉眼缩放。具体消费者和小尺寸变体随导航小节审查。
- 默认 `components/status-bar/current-session-source.ts:67` 以 server + leafID 核对当前路由贡献；第118行取的是当前 Session 自有 cost，第152行 allMetrics 派生指标。V2 `client/src/solid/data.ts:1422` 的 cost() 对root遍历family累加，对child返回自有cost；二者范围不同，底栏不能直接换用该聚合方法。
- 默认同文件第248–259行把无明确health的http/sidecar显示为online；V2 `app/src/runtime/extension/host-apis.tsx:440` 的 ServerRef.connected 读真实SDK连接状态。迁移应保留可确认的连接语义，不能把默认乐观fallback当成真实在线证据。
- V2固定宿主已有 `window.bottom`；`gui-extensions/src/sdk/host-apis.ts:1008` 的Servers只提供list/get，没有Home当前选中server接缝。底栏需沿现有Home选择、Draft和Session身份决定scope；不能由最后会话推断Home server，也不能跨extension读取私有Context指标、重复建统计缓存或增加轮询来拼出状态。

以上是静态代码与决定函数核对，底栏/模式导航仍未迁移或验收。候选方案应比较App层直接消费现有owner与既有SDK最小只读接缝的成本，不能先建第二WorkspaceContext或万能状态源。

### 后续模式与组合调查补充（尚未批准实施）

- 默认 `MODE_SURFACES`（`components/mode-surfaces.tsx:185`）把五模式的Sidebar/Main放在同一映射内。Work Main实际是 `WorkPresetCatalogMain`（`pages/mode-workspace-slots.tsx:619`），Assistant Main是 `AssistantDashboardMain`（`pages/assistant-dashboard.tsx:40`）；CustomSessionListMain（`mode-workspace-slots.tsx:885`）虽然命名为列表，实际渲染配置和Plan预览。不能仅按符号名认定产品职责。
- Work的 `startPreset:748` 通过共同launch创建Draft，并显式携preset/revision/output的WorkContract。`startWorkflow:704`在content成功时生成workflowDraft，在失败时自动启动无workContract的ad-hoc澄清Draft（第730行catch）。这是现有行为，不是本轮批准复制的合理性结论；迁移到该用户链前需核对失败体验、迟到响应和相应PRD/keeper。
- Assistant从当前server SDK读取schedule.pending、delivery.recent、memory.list、kb.list，`assistant-dashboard.tsx:80`的activity gate限制隐藏模式请求；`runMutation:57/69`将错误归属约束到未卸载的相同scope，KB保存另用editorVersion保护具体编辑实例。个人记忆、提醒和知识库不是剪贴板工具或Meta记忆的同义物。此处已读数据入口/动作/主要渲染，尚未审完后端所有消费者。
- V2 Desktop `renderer/window/route-storage.ts:19` 的acceptedLastActiveUrl仅允许Home、Settings、Draft和canonical Session；MemoryRouter确实消费它。引入模式路由还必须审核preload、route分类和窗口恢复，不能只改AppRoutes。该白名单与固定上游同形。
- 公共组合的现实反例：`core/src/composition-resolver.ts:65/135`解析时要求平台meta，`core/src/session/composition.ts:637`要求Custom根meta及child执行Agent；把普通Coding build根直接接入会违反现有选择约束。先分出共同捕获/消费与Custom策略，不新增执行系统。
- **实现身份冻结缺口**：`core/src/plugin.ts:89/108/125`以Plugin ID/revision替换作用域；`core/src/tool.ts:240/289`将JSON目录与执行闭包分开。`composition/digest.ts:45/51`只捕获工具目录和host build，`validateCurrentTools:150/160/167`未比较独立Plugin generation。现有 `core/test/tool-registry.test.ts:201/214/216`明确新snapshot会取得同定义的新执行者，旧advertised snapshot仍用旧执行者。因此请求内稳定不证明Session范围固定实现。已读Custom漂移测试覆盖host/schema/catalog/MCP，但未发现这一Session联动断言；未全仓排除间接覆盖，尚未运行复现。此项需在全模式组合公共化前通过现有owner补证和处理。
- 实现来源的复用候选：`core/src/plugin/host.ts:478`目前直接暴露`tools.transform`，实际Generation身份没有随该边界传入工具贡献。`plugin/src/source.ts:19/22/53`已保存被观察文件/目录的digest用于缓存与reload，可在此owner考虑稳定内容标识，但它尚未输出跨重启源图身份。loader的时钟、计数或reload token不能当持久内容版本；实际成功Generation及其fallback必须与请求加载版本区分。add A/update B的贡献链也不能只保留最后写入者。
- 上述候选只覆盖被观察源图，不证明动态依赖、外部hooks、npm或SDK/instance来源的完整执行身份。后续应先跑真实Plugin→Tool snapshot→SessionContext红证，再设计缺证/漂移阻断；不保留旧Plugin Scope、不建第二registry、不回算历史snapshot。`CompositionDigest`的capture虽然存JSON，`CapturedTool`解码/校验边界仍必须随来源字段核对，不能仅向JSON追加字段就宣称冻结成立。本轮没有实现或验证这些扩展。

每条链分别记录：现有逻辑、必要约束、可信失败场景、共同根因、复用候选、优化方案与验证。检查单一身份/状态归属、重复请求/缓存、调用顺序、竞态、权限与副作用、错误恢复、取消和性能，不把“能编译”或“与旧版相同”当作合理性证明。

优先复用 → 删除重复 → 归并 → 重构 → 必要新增。对比简单实现与更完整方案，选择简单方案时明确真实未覆盖范围和解除条件；不为假设性风险提前造框架。产品语义存在冲突时，由主规划对话整理具体问题向用户澄清，辅助对话不自行猜测。

## 实施顺序与辅助任务边界

完整 P0–P6 保留。当前 P2.2T 继续开放，不再按资产类别继续增加标题入口。

1. 先完成 Home → 模式工作区 → Draft/已有 Session → 共享 screen/panels，以及准入/执行/恢复的双工作区映射，生成文件/函数级任务单。
2. 修当前桌面问题：去掉所有标题栏资产入口，正确入口按已核实默认职责与 V2 宿主接入；保留七族现有后端。布局修复后先运行原始两条几何断言，再决定是否保留测量修改。fixture codec wire 问题单独根治。
3. 按现行 P2.1/P2.2 完成模式/资产用户链：独立 Home 与全局模式入口、共享工作区、Chat 管理与 Session 预览/资产面板、剩余 placement/编辑/导入/引用消费者。
4. 按依赖补 P3/P4/P5：Custom/Meta/Assistant、Work/Task/Delegation/Workflow、全局统计/搜索/Sync/分享与兼容消费者。状态栏使用真实 V2 数据，不能只恢复空壳。
5. 完成 P6：消除重复与无消费者兼容层、旧库副本不变量、packaged/native/恢复/平台及配对性能，最后按授权边界处理 Cutover。

辅助任务单固定包含：具体目的；两边已读决定函数；允许修改文件和禁止扩项；不变量；适用测试/生成/类型/lint；失败回报条件；源码/产物身份；主对话桌面场景。范围外发现先回传，不自行增加 UI、路由、Schema、抽象或执行系统。

主对话在冻结源码/依赖/产物后操作隔离桌面，使用 DeepSeek Flash 真实对话验证本小节。包测试和桌面证据分开；失败返回原任务修复，复验通过才派下一小节。纯研究/文档检查不冒称桌面验收。

## 当前闭环判断

整体架构尚未闭环。闭环要求每条产品链具有真实入口、单一状态/持久化 owner、相符的权限/错误/取消/重试/恢复行为、实际下游消费者及匹配的测试和真实桌面证据。模式工作台、正确资产入口、全局状态栏、Custom 完整产品链及多项恢复/平台范围仍不满足这些条件；默认工作区自身未验证项也不能继承为绿色证据。


### 2026-10-29 追加：冻结/分叉与模式路由关系核对

本节是只读源码和现有测试的审阅，未运行对应测试，尚未授权实现。子智能体报告由根核对以下关键决定函数。

- 普通Custom fork保持原冻结。V2 `core/src/session.ts:576/661`在Forked事务直接insertSnapshot，不调用Composition.copy；`session/composition.ts:383`的copy本身也只替换sessionID。非Custom fork当前不附Composition Snapshot，不能据此声称所有模式的行为定义已冻结。Instructions另按`session.ts:639`继承父Session最新值，不是历史边界值。
- 两库upgrade语义相反：默认`core/src/session.ts:627`只接受Custom源；V2 `assertUpgradeSource:375`拒绝Custom源，只允许普通源升级为独立Custom根。两者都不是保留历史并重新冻结的fork。默认UI `custom-snapshot-panel.tsx:138`不能直接搬到V2 API。既有V2 start/freeze可支持新建采用定义；保留历史的显式重新冻结分叉仍缺入口/合同。
- 默认draft从Snapshot加载时保留资产revision；V2 `composition-resolver.ts:209/672`对stale revision拒绝freeze。重新计算计划不等于自动采用当前文件；需要用户明确更新引用。原冻结可继续使用，以及冻结池内Agent选择和Model选择应继续保留，不能因冻结需求删selector。
- 模式路由应联动V2 `shell/routes/routes.tsx:30/43`的preload/AppRoutes、`shell/state/layout.tsx:50`的LayoutRoute分类和Desktop `renderer/window/route-storage.ts:19`恢复白名单。目前`/mode/chat`分别缺入口、抛错和退回Home；不能只新增页面。
- Home `setMode`是列表筛选，`home/model.ts:78`创建Draft只传server/directory；`tabs.tsx:267`不推断mode，`schema.ts:75`只对真正缺失字段采用Coding兼容值。模式工作区创建必须显式传mode，全局New Session的`titlebar.tsx:326`也需模式分支，不能从Home筛选或已有Session的显示模式猜测。
- Draft owner、异步提交前捕获mode、promoteDraft和canonical Session解析链已存在；模式工作区不得覆盖已有Session的server/Location/mode。Custom不进入普通Draft兼容分支。新增模式路由的接受→分类→桌面恢复需要联动断言；现有Desktop白名单仅验路径形状，接受的server段不一定通过currentRoute的base64校验，静态差异尚未运行复现。
