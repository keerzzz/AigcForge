# v2 五模式 UX 收敛：S0 行为基线

- 基线 SHA：`53800bb8549443372243e5ba37b8277e225cf4df`
- 分支：`five-mode-ux`
- 日期：2026-09-22
- 性质：S0 只记录现状与可执行判据，不改生产代码。

## 1. 圆角现状

```text
packages/app/src rounded-[Npx]
2px  x1
3px  x10
4px  x15
6px  x40
8px  x6
10px x6
12px x3
1px  x3
合计 84；无争议映射 68；孤儿值 16。

packages/ui/src/v2 border-radius: Npx
2px    x6
3px    x1
4px    x17
6px    x14
8px    x1
9999px x3
合计 42；无争议映射 38；孤儿值 4。

无争议映射合计 106；孤儿值合计 20。
```

权威值位于 `packages/ui/src/styles/theme.css:45-49`。另 5 个字面量位于 `packages/ui/src/styles/tailwind/index.css:59-63`；S1 spike 必须先证明 alias 方案的运行时值与构建物一致性，再允许替换。

## 2. 三态现状

```text
Chat:
  packages/app/src/components/chat/asset-workbench.tsx
  rows().length === 0 -> promptAsset.panel.noAssets
  `list` resource 的 loading 尚未通过 ModeWorkspaceAssetContext 暴露给 workbench。

Work:
  packages/app/src/pages/work-artifact-panel.tsx
  appliedCurrent -> candidate -> work.artifact.empty
  sync().status 已是 "loading" | "partial" | "complete"，但没有进入渲染分支。

Custom:
  custom-asset-catalog.ts 已有 loading / ready / partial / error
  custom-sidebar.tsx 的 rows==0 fallback 仍直接显示 custom.sidebar.noAgents。
```

## 3. 复用与挂载现状

```text
SessionRightPanel 生产消费者：4
- chat-right-panel.tsx
- work-artifact-panel.tsx
- assistant-session-panel.tsx
- session-side-panel.tsx（coding）

Custom 分支消费者：CustomSessionPanel（尚未包 SessionRightPanel）。

WorkflowRuntimePanel 生产挂载：1
- custom-snapshot-panel.tsx:188
```

## 4. 无障碍与错误可见性现状

```text
asset-load-error.tsx:
  横幅存在 data-slot 与危险色 token，但没有 role="alert"。

assistant-dashboard.tsx:
  confirm/reject/remove/save/cancel/markRead 等 mutation 都走 .catch(console.error)，
  用户只能看到最终通用 loadError 或什么都看不到。
```

## 5. S0 判定

- S1 的 RED/SPIKE 必须证明运行时计算值，而不是只数源码声明。
- S2a 只处理 106 处无争议映射；20 处孤儿值保持原样。
- S4b 需要先把同一 `list` resource 的 loading 暴露给 workbench，不能另建请求状态。
- S4c 使用已经存在的 `sync().status`，不伪造异步窗口。
- S5a 的 RED 必须证明 `CustomDraftProvider` 数据链未被包装层打断。
- S8a/S9b 使用可观察行为测试或 e2e，不以源码文本作为断言。
