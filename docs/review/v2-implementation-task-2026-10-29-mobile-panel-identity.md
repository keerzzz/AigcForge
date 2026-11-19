# P2.2T / S1 验收退回：共用窄屏 Panel 身份

状态：主调度完成限定方案审批；正式派发后按本文开工。依据根的真实红证/源码核对与关联聊天的独立只读可行性核对；专项审查子智能体尚未返回完整结论，不冒称它已批准。其后续阻断必须在交付前解决，并保留独立差异复审。S1尚未通过，本修复属于同一节验收退回，不是下一实施小节。主调度正式消息和[实施者记录](v2-implementation-owner-2026-10-29.json)决定开工权。

依据：[现行实施计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)、[原 S1 任务](v2-implementation-task-2026-10-29-proposal-entry.md)、默认 CLAUDE 协议的共同根因与复用规则。范围仍是 S1 的可用候选入口，不迁移模式工作区或资产库存。

## 真实失败与已排除项

2026-10-29，真实 Electron 44.4.5、390×844、同一个 Chat Session：

1. More → Prompt proposals → More → Skill proposals：菜单 aria-pressed 指向 Skill，主区 h2 仍是 Prompt。等正确 h2 的 25 秒就绪检查失败。
2. 返回会话使旧 mobile 内容卸载，再打开命令面板，明确选择 Workflow proposals：主区显示 Skill proposals。此链独立于上一条组件保留问题。

原始事实、源码 hash 和截图在 `/home/keer/task-backups/shared-foundation-review-20261029/s1-mobile-real-failures.json`。当时 S1 renderer 的 SHA256 为 `c8c0772ba8092138f411fe38ddcfec0bcb38c1737007c63ba72b69184802102a`。

更早的 lazy import 失败另有根因：开发服务热更新发生 Rolldown panic，导致 full-build module graph 不存在。相同源码和隔离环境冷启动后抽屉加载成功，再复现以上两个产品失败。不要把两类问题混为一类，也不要通过依赖升级、关闭 bundledDev/overlay 或重启次数掩盖产品错误。

## 已读合同和决定函数

- SDK `registries.ts:230`：Panel.id 在 extension 内唯一，mobile key 为 extension + Panel.id；`PanelProps:220` 的 Session/tab 是响应式 getter。Panel.render 在其生命周期内一次构建，内部继续响应更新。
- `runtime/extension/mobile.tsx:29` 为每个 Panel 生成独立 entry；第160行附近菜单按 entry.key 调用 onSelect。
- `session/screen.tsx:206` 写入 mobile selection；第330行非 keyed Match 复用 MobilePanel。
- `runtime/extension/panels.tsx:545` 的 MobilePanel 通过 Contribution 调用具体 provider.render。
- `runtime/extension/render.tsx:12` 的 Contribution 按 extension context keyed，并在第26行 untrack(children)。同一 extension 内换 provider 不会因此重建内容。
- `runtime/extension/host-apis.tsx:575` 的 provider(key) 当前只按 extension 选首个 side Panel；open 第642/668行据此选择 mobile view。close/state/toggle 也消费这个决定函数。listed 第603行起已经调用真实 Panel.list，不能另建 tab registry。

## 最小修复方案及边界

先复用共享宿主，不能把七类拆成七个扩展、在资产组件里特殊判断、移除命令或返回会话来规避切换。

1. MobilePanel 的内容生命周期以稳定的 extension + provider.id 为边界。相同 provider 内 Session 和动态 tab 更新继续使用响应式 getter；不要按瞬时对象引用或 tab key 无条件重建，也不要改变所有 Contribution 的生命周期。
2. layout 的 provider 解析以真实 tab 所属 Panel 为准。复用现有 Panel.list/已解析 entry；Panel.id 与 tab.id 不是一般等价关系。mounted时优先使用实际list结果；只保留可证明的单provider兼容路径。多provider无法确定归属时不得回退首项。保留单provider动态文件、dock、非当前Session与Location延迟写入已有受支持行为。
3. 相关 open/close/state/toggle 使用同一归属规则，避免只修窄屏显示却仍把 close 回调发给首个 Panel。保留 append/select/preview/background、transient/pinned/first、跨 Session 和已知 Location 延迟写入语义。

简单的资产特判能通过当前七按钮，却给后续自由组合留下相同缺陷，因此不采用。上述方案只修真实共享身份边界，不增加新的 Shell、状态总线、注册器或运行系统。

当前实现边界已获实施聊天只读核对：多Panel集中在七个固定候选tab，所有菜单/Command同步重读current Session；Files/Browser/BTW的动态tab均属于单provider。未发现“未挂载Session + 多provider + 动态tab”的真实调用者。listed只有mounted Session/screen才能执行，该场景按已有SDK表达限制登记，不为尚无消费者的组合新增API。不得以此限制为由保留当前会话已能解析却误选首项的行为。

## 候选允许文件

生产只允许 `packages/app/src/runtime/extension/panels.tsx` 和 `host-apis.tsx`。是否需要共享既有 helper，由独立复审先确定；其它生产文件须回报，不自行扩大。

测试优先 `packages/app/e2e/regression/mobile-extensions.spec.ts` 的既有 keeper；如需要观测 close/state/toggle 等内部公开宿主合同，可扩展既有 `component-tests/extension-host.spec.ts` 与其 fixture，避免与 E2E 重复证明。复用已有 fixture 和命令面板入口；任何测试 helper 的写入也须列入最终审批。

本次正式允许的测试写入仅为 `mobile-extensions.spec.ts`；现有component fixture的layout是替身，不能用它证明真实attachment。若必须增加fixture或其它测试文件，先给具体合同、真实owner接线与最小路径，主调度批准后再改。不得为读取不到的回调记录伪造绿色断言。

S1 已冻结 renderer 与五份交付源码、timeline fixture 两文件、数据库五文件保持原样。默认工作区只读。禁止改 CSS、SDK 合同、依赖锁、Schema/Core/Server/Client、生成物、文档、账本、DB，禁止 Git 提交/推送/重置和服务操作。

## 红绿与验收

- 在修改生产代码前，用真实 keeper 得到两个独立红证：同一 extension 的不同 provider 连续切换；从会话直接执行某个非首 Panel 的命令。所有七类放在一个有限表中，必须断言选中内容的准确身份，不能只断言菜单出现。
- 相同 provider 的动态 Files 标签、已有 dock/抽屉、Session 切换不回归；按实际实现给 close/state/toggle 的精确归属提供最强边界测试，不复制实现。
- package cwd，`script/bun`，workers=1/retries=0，串行执行受影响 mobile keeper、side-panels/session-header、extension host/graph、原 timeline-stream/geometry；App typecheck/typecheck:e2e、格式、原增量 lint 和修改文件 lint。保留各轮失败与最终源码身份，数字不得跨轮累加。
- 若代码改动使范围或测试成本增加，先回报具体原因与最小需要范围，不把跑过其它套件当作本合同通过。
- 生产前性能基准可复用原 S1 的 benchmark-after 与 after-source-hashes（本次失败前无生产修改）；主调度核对身份后执行修复后对比。
- 实施方冻结交付后，主调度在真实 Electron 重做两条失败链、七类切换/命令、Session 隔离、窄屏键盘与必要的明暗截图，并用 DeepSeek Flash 完成真实对话和显式发送。不使用 mock 代替最终验收。

本修订交付前 S1 保持未通过；全局 icon/底栏、Home/Mode/Draft 路由、组合实现身份与 P0–P6 其余任务继续只读调查。
