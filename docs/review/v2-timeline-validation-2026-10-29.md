# 桌面布局诊断与时间线夹具修复

本项来自 P2.2T 桌面 DeepSeek Flash 续验后的开发日志检查。生产时间线与标题布局未修改。当前状态为夹具行为修复已获定向绿证，整文件 lint 收敛与最终复审仍在进行，不能标为整项通过。

## ResizeObserver 的实际边界

主线程在真实 Electron 同一持久会话中添加临时观察回调诊断，然后发送一条额外的 DeepSeek Flash 表格回复请求。诊断获得 6 次 `ResizeObserver loop completed with undelivered notifications`；每次最后回调均为 TanStack 的虚拟行 observer。流式行的已记录高度递增，没有捕获到尺寸来回振荡。这是诊断样本，不是所有内容的稳定性证明。原始来源与目标尺寸见 `evidence/v2-desktop-startup-2026-10-29/resize-diagnostic-red.json`；临时注入已经移除。

`packages/app/src/session/timeline/virtualizer.tsx:318` 的 pendingSizes 微任务批次将实际行尺寸交给 TanStack，再更新祖先 virtualContent 高度。`packages/app/src/session/timeline/interaction.ts:326` 的内容 observer 只安排已有 rAF 的状态更新，不直接写尺寸。独立只读子智能体确认现有证据支持同帧更新被观察祖先后，较浅通知被浏览器延后，尚无持续振荡或功能损坏证据。

`packages/desktop/src/renderer/diagnostics.ts:5` 已在 DEV 对这条精确消息调用 `preventDefault`，文件与固定 `upstream/v2` 字节相同。Vite 的开发运行时仍会打印它；这解释了桌面 pageerror 记录为空而日志存在，不证明警告被新修复消除。

没有启用 `useAnimationFrameWithResizeObserver`。TanStack 当前文档说明该选项会延后测量约一帧，可能产生过期几何，通常不应打开；现有几何 keeper 还要求折叠组下一次 paint 前完成重测。未以日志归零为目标改变上游测量时序。

## 生产基线与首次失败

在改动任何时间线源码之前，对生产构建运行 3 次现有流式基准：40 条历史、40 次 delta、CPU throttle=1、minimal=true，全部完成；记录无 row/markdown remount。minimal 不采集视觉/几何，所以本结果只作为运行性能与完成基线。见 [清单](evidence/v2-resize-observer-2026-10-29/validation-manifest.json)。生产代码最终没有改动，未用前后同代码重复跑分声称性能优化。

随后完整几何 keeper 首轮 7 pass / 1 fail。唯一失败在发送测试事件之前：`SchemaError: Expected Workspace.ID at ["location"]["workspaceID"]`，不是几何断言。`makeEvent` 返回解码后的 Event；Location.Ref 为本地默认补出 `workspaceID: undefined`；`timelineEvents` 再把它当编码值解码。`packages/schema/src/schema.ts:18` 的 optional codec 允许键省略而不允许在 wire 中显式 undefined，因此第二次解码失败。

修复在测试夹具统一边界 `validateTimelineEvent`：实际公共 Event codec 校验后再编码回 SSE wire，`makeEvent` 复用该边界。没有放宽生产 Schema 或伪造 Workspace ID。修复后同一几何 keeper 8 pass / 0 fail，E2E 类型退出 0。

## Header 几何测量

扩展流式 keeper 首轮 42 pass / 2 fail，均在既有子会话标题几何断言。

- Working indicator 移除时，祖先面包屑会重新得到 flex 空间。以视口绝对坐标假定标题必须减少 24px，会把祖先位移也算进本组件动画。测试改为在子标题 h1 内测 24px 收缩，同时保留绝对坐标持续向左的断言与原 0.5px 精度。
- `Range.getBoundingClientRect()` 包含被 ellipsis 裁剪的全文。标题被七个资产入口压缩后，原测量得到 -64.9375px，但可见文字与计数并未重叠。测试改为把文本边界限制在标签 content box 内，再断言原 8px 间距。

上述两项定向重跑 2 pass / 0 fail；未改 CSS、动画、视口尺寸或数值阈值。原失败截图与日志保留，不能把前轮 42 加本轮 2 写成一次全量 44 pass。

## 剩余门禁

共享夹具被本轮修改后，仓库 `lint:changed` 要求整文件无告警。首次 scoped lint 为 53 warnings / 0 errors，其中本轮新增的间距/断言说明已修正；随后增量门禁仍报原夹具 50 条告警，主要是未知字典值、手写 JSON 归一化与条件空对象 spread。该文件正进行限定收敛；没有禁用规则，也没有把 exit 1 当绿色。

本项待收齐最终类型、fixture 单测、几何与流式 keeper、整文件 lint 和独立复审后，再完成限定提交。整个目标继续保留 Agent/MCP/Plugin/Workflow placement 与后续 P3–P6；没有因为增加诊断而缩减原计划范围。
