你是 AigcForge 项目的高级全栈开发顾问和高级产品总监。请按已批准的实施计划，完成会话 UI 上游对齐与统一右侧栏的本期实施，持续推进到 RS00–RS08 完成并验证。

一、工作区与当前状态

- 实施目录：/home/keer/workspace/aigcfroge-v2
- 当前分支：v2-dev
- 提示词生成时 HEAD：0486d8bd06a13b5c9797fb976124f60af300662f
- 默认目录 /home/keer/workspace/aigcfroge 位于 main，保留旧包结构和未提交修改。本期在 V2 worktree 实现与验证，完成后再安排默认工作区集成，不把合并 main 变成此次 UI 开工的前置。
- Meta 原定 12 节已经完成原范围接受。此次是后继 UI 工作，复用其 Task、Delegation、Meta、Workflow、Client Data 和执行链。
- 已批准计划与审批文档目前保留在工作树中，生产 UI 尚未实施。保留这些文档和历史证据，不清理、覆盖或自动纳入无关提交。
- 首先读取实际 Git 状态和相关差异。HEAD 若已有合法后继提交，沿当前状态续接，不回退到上述快照。

二、必读依据

先读当前 V2 工作区的 CLAUDE.md、AGENTS.md、ARCHITECTURE.md、DESIGN.md、docs/testing.md，以及受影响的 App/GUI/E2E 指南。不要用默认目录的旧实现和规则替代 V2 合同。

批准计划：
/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-09-unified-right-sidebar-implementation-plan.md

审批记录：
/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-approval-2026-11-09-unified-right-sidebar.md

唯一未交付账本：
/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md

核查源码、决定函数、真实消费者和现有测试后实现。已核对的上游 v2 版本为 4617210822bdbb31e5749751afbfb4584ccedac8；若上游或本地输入改变，只处理与本任务有关的差额。

三、第一性原理与减法

1. 页面空间有限。把持续管理内容移出主对话列，保留对话主导地位。
2. 复用现有 Extension Host、Panel、createRegion、SideRegion、RegionContent。默认一个 session-management 扩展贡献五个独立 Panel，分别有菜单、显示偏好与 UI 状态。
3. 只有出现独立发布、硬依赖或整个扩展独立启禁的真实需求时，再拆扩展。不要新建注册表、事件总线、布局缓存、模型循环或通用 UI 解释器。
4. 新共享抽象需要两个已无抽象运行且验证过的真实用例；复用现有宿主不设置两用例门槛。
5. 每项防御绑定实际触发与证据，保留 owning boundary 的现有校验，不在内部重复解码或权限判断。
6. 审批已经完成，进入具体实施，不重新立项或逐模块反复确认。信息缺口先核代码；可逆实现选择采用显式假设并验证。

四、明确页面位置

- 左侧：项目树、会话列表与现有导航。
- 中间顶部：会话标题、运行状态、正在运行的子智能体/命令入口。
- 中间主体：Timeline 对话、工具结果与原 SSE 更新。
- 中间底部：询问、权限、联网选择、待发送消息队列、普通/Shell Composer 与附件。
- 右侧顶部：标签栏、现有加号菜单、当前模块操作与收起入口。
- 右侧主体：任务、协作、Meta、工作流运行、产物五个独立 Panel；文件、审阅、浏览器、上下文和候选审阅复用现有入口。
- 右侧辅助区：保留现文件树 Slot 与全部/变更两个页签。
- 右侧下部或用户选择的工作区底部：保留原 Terminal DockRegion 和 PTY。
- 会话详情保留现标题入口与窄窗抽屉，不为统一底座额外新增桌面详情标签。

五、实施顺序

本期九项，后继 Custom 一项，保持 RS 编号：
RS00 → RS01/RS02 → RS03 → RS06 → RS04 → RS05 → RS07 → RS08。

- RS00：记录当前源码/产物与 streaming、主列几何基线，按实际差额核上游；保护现有工作树与用户桌面。
- RS01/RS02：两个 SDK 接缝随首个实际 Panel 同片接入。迁任务和协作的 CRUD、控制、全文结果、导航和状态，产出右侧可操作路径，迁入的旧主列分支同片退出。
- RS03：在同一管理扩展接入现 Meta、WorkflowRun、WorkArtifact，保留真实模式、根/子会话、来源和版本条件。
- RS06：五类功能均可从右侧访问后，立即移除 screen 的主列 TaskPanel 与无消费者旧聚合 UI，不等待资源盘点或完整设置页。
- RS04：核对 File/Review/Browser/Context/候选入口、文件树和终端在同一工作区的实际行为。
- RS05：模块显示设置放到现 SettingsPage 的 General/General rows；完成单例、排序、关闭、显示/隐藏和恢复。
- RS07：完成窄窗、活动面板宽度、长内容、滚动、明暗主题、键盘与 i18n。
- RS08：完成定向回归、同条件前后基准与同源桌面验收，更新原账本。
- RS09：Custom 有明确 producer 与实际输出后，复用 File/Browser/Artifacts 验证该输出链。这是后继功能，不阻挡本期九项。

六、核心代码落点

- /home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/panels.tsx
- /home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/side-region.tsx
- /home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/host-apis.tsx
- /home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/mounted-session.ts
- /home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/sdk/registries.ts
- /home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/sdk/host-apis.ts
- /home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/session-management/（计划新增的真实管理扩展）
- /home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/renderer.ts（现内置登记边界）
- /home/keer/workspace/aigcfroge-v2/packages/app/src/session/screen.tsx
- /home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/ 下已有 TaskPanel、Meta、WorkflowRun、WorkArtifact 组件
- /home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts：继续使用原 session.task/delegation/meta/workflow/artifact 等数据操作。

GUI 不反向导入 App 私有路径。复用 SDK 的 ServerRef.client/data/connected、File/Links、ctx.t/plural 与现响应式工具，迁移 CSS 为 Style 贡献。SDK 只补真实缺口：关联会话导航委托原路由记忆；连接代次读取原 attempt，各 ServerRef 工厂一致接入。同步 SDK 文档与现有契约测试。

七、必须保持的行为

- Task 与 Todo 同源；用户输入 Queue、业务 Task、后台 Job 分别沿原 owner。
- Question/WebSearch 选择一种 Form，Permission 独立可并存；任何 pending request 仍 blocked。问题最小化不解除阻塞，请求关闭后恢复草稿与光标。
- 收起右栏或关闭管理 Panel 不取消业务。草稿、在飞 token/pending、ACK 和失败结果按 session.key 保留在比 render 更长的 UI owner；在飞状态不另存成持久执行日志。
- 隐藏普通管理模块保留已存标签与顺序，恢复沿原 selection/fallback，尊重期间的新选择。
- Browser/File 的显示偏好参与原 canOpen/Command/链接路由。隐藏浏览器后 HTML 沿原 File fallback，明确目标已隐藏时提供可恢复入口。
- 保留原 CAS、迟到响应身份、连接代次、局部 Suspense、可见性与清理；不复制 Data/SSE 或把浏览器/终端隐藏误作资源销毁。
- WorkArtifact 仍按 Work 的真实来源消费；Custom 支持不能靠放宽 mode 判断完成。
- 可序列化草稿与偏好沿现 storage；现有英文保持字节与翻译，新增文案使用 i18n。

八、验证与工程执行

直接完成本期所需的代码、定向测试、私有构建与隔离窗口验收；测试/构建串行。保留当前用户手测桌面和 Source，不重启、导航或替换它们。

测试从 package 目录运行。主要复用 session-header、side-panels、review、session-request-docks、session-queue 和 extension-host/graph keeper，按本次改动选用例；原共享源码未变时不按模块重复跑同一宿主套件。

App 类型从 /home/keer/workspace/aigcfroge-v2/packages/app 运行 bun run typecheck 与 bun run typecheck:e2e；GUI 类型从对应包运行。公开 Protocol/HttpApi 若确实改变，沿正式 Client generate，不能手改生成文件。

Session/Timeline 修改前后跑匹配源码/产物的 production streaming 与主列几何检查；改变路由/缓存/挂载时补 tabs，改变启动/首屏加载时补 entry。不设机器相关硬阈值，不把采样当性能改善证明。

没有执行层改变时，不重验全部 MC，不增加模型路由预检或真实模型请求。若发现确需改执行语义，明确具体差额并回到原 owner，不静默扩项。

九、交付要求

持续完成本期，不停留在再写一份方案。每片说明实际变更、理由、运行命令/退出码和有效证据。最终交付统一侧栏五模块、主列无 TASKS、即时 dock 正常、状态与原业务保持、同源 UI 验收。

只关闭已验证的合同；后继 RS09 及实际未交付项沿原账本记录 owner/解除条件。使用真实绝对路径链接，Git 提交清单由命令生成；保留原分支与 WIP，合并默认目录、推送和发布另行处理。

现在从实际工作区检查与 RS00 开始，然后进入 RS01/RS02 的首个右侧可操作纵链。
