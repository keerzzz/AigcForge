# P2.2T / S1 方案限定审批

日期：2026-10-29。结论：**允许按[任务单](v2-implementation-task-2026-10-29-proposal-entry.md)实施一个小节**。这不是代码完成、全仓架构通过或桌面验收通过的声明。

补充独立评审：route_review已核对任务、架构、renderer全文、file MenuItem示例与SDK声明，同意本节保持Home/Mode/Draft/Session及候选/库存隔离，恢复原几何合同，无文档层阻断；MenuItem无enabled/when约束已落实。调度因旧对话连续HTTP400切换至[实施者记录](v2-implementation-owner-2026-10-29.json)中的新对话，审批技术范围不变。

## 审查依据与范围

依据默认CLAUDE协议的复用、根因、真实测试要求，目标V2根/GUI/App/E2E包规则，以及[架构记录](../research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md)。主调度起草，`global_ui_status`独立只读核对真实SDK、宿主、renderer、panel与测试接线后给出限定批准；主调度核对并采纳以下修正。

## 决定函数与复用结论

- `packages/gui-extensions/src/sdk/registries.ts:77` 的SessionPanelMenuItem提供`menu: session.panel`和run；没有enabled字段。
- `packages/app/src/runtime/extension/side-region.tsx:71`收集排序菜单，第325/351行由原AddMenu执行。只替换扩展登记，无需修改宿主。
- `packages/app/src/runtime/extension/host-apis.tsx:641/661/681`的layout.open走现有Panel.list及面板状态owner；`shell/state/session-tabs.ts:48/66`处理已存在标签，不能另造缓存。
- `skill-proposals/renderer.tsx:32`起已有稳定PanelTab/Command/mobile与恢复预加载；`panel.tsx:49/63`仍按传入Session scope和消息读取候选。首节不修改候选业务owner。
- `mobile.tsx:29`与`session/screen.tsx:206`按每个Panel的独立键选择窄屏视图；该路径不经桌面SideRegion。

生产写入仅为一个renderer，七个标题资产Slot移除，七类菜单接入现有侧栏“+”。保留稳定Panel/Command ID、lazy生命周期与原业务操作。它满足用户标题禁令，也保留候选入口。

## 已纳入任务单的审批修正

1. MenuItem用响应式登记返回undefined控制可用性；run时重读当前Session，不缓存旧路由闭包。
2. 窄屏保留原mobile菜单，不让桌面helper点击隐藏SideRegion。
3. 标题无资产入口断言只检查标题区域；不把侧栏菜单计入禁止范围。
4. 原几何测量修改未被认可为等价断言，本节精准恢复并验证；仍失败需回报，不放宽阈值。
5. 已有窄屏Command可能选首个Panel的静态风险独立登记至现有账本，不由本节限定审批掩盖。

## 已核验前置证据

主调度验证fixture交付的两个源码hash、完整patch和12份日志hash匹配，独立fixture运行5 pass/0 fail/13 assertions。生产前基准3次完成（40历史/40delta/CPU1/minimal），3197个源码hash和3314个产物hash及产物副本保存于 `/home/keer/task-backups/shared-foundation-review-20261029/`。minimal不采集几何。

默认协议check-refs脚本exit0（32路径）；新架构/任务/调查附件的8个本地链接存在，所改已跟踪文档diff-check exit0。上述均不等于生产修改或桌面测试通过。

## 交付控制

主调度发送正式任务后实施。关联对话只执行允许文件与测试，保留原失败、最终结果及源码身份。交付后冻结停止；主调度完成同源复审、原几何keeper、生产基准比较与真实Electron/DeepSeek Flash验收，失败退回同一节。

全局导航/底栏、模式宿主、库存CRUD、组合实现身份、Custom/Meta、Workflow/Delegation、旧库和发布仍开放，不在本审批内。审查中如发现本节无法维持现有合同的阻断，立即暂停本节派发/写入并由主调度修订具体范围。
