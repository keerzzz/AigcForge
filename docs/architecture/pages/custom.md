# Custom Mode 架构

> 状态：**IMPLEMENTED / DEFAULT-OFF（2026-09-20）**
> 事实源：`packages/app/src/components/mode-surfaces.tsx`、`packages/app/src/pages/mode-workspace-slots.tsx`、`packages/app/src/components/custom/`、`packages/core/src/session/session-identity.ts`、`packages/core/src/flag/flag.ts`、[ADR-17 Custom Mode Composition Platform](../adr/ADR-17-custom-mode-composition-platform.md)、[Custom PRD](../../prd/custom-mode-composition-platform.md)、[Custom 路线图](../../roadmap/custom-mode-roadmap.md)。
> 本页是该模式的独立页面文档。此前的 `custom-assistant.md` 已标记 SUPERSEDED，其内容描述的是 Custom 能力，本页取代它的“当前事实源”角色。

## 1. 定位与职责

Custom 是动态装配 Tools + Knowledge + Persona 的组合平台，默认关闭：

- `/mode/custom` 复用共享 `ModeWorkspace` typed slot。
- 主区是 `CustomSessionListMain`（`mode-workspace-slots.tsx:870-877`），渲染 `CustomCompositionConfig`（组合 Builder）与 `CustomPlanPreviewColumn`（预览列）。
- 左栏是 `CustomProjectColumnSidebar`（`mode-workspace-slots.tsx:863-867`），渲染 `custom/custom-sidebar.tsx`。
- 运行时通过 **冻结 Snapshot** 约束工具集与消费者绑定；漂移即 fail closed。
- 资产由 Chat 资产工作室创建，Custom 只消费。

## 2. 当前组件与数据流

```text
ModeRoute(/mode/custom)
  -> ModeWorkspace
     -> CustomProjectColumnSidebar (components/custom/custom-sidebar.tsx)
        -> Location / 项目 / 资产导航
     -> CustomSessionListMain
        -> CustomCompositionConfig (components/custom/custom-builder-main)
        -> CustomPlanPreviewColumn
  -> Session（mode=custom）
     -> SessionComposition snapshot（冻结 tool allowlist + 消费者绑定）
     -> SessionExecutionLocal 在每次 drain 前 assertRuntimeSupported
```

## 3. Owner 边界

| Owner | 职责 | 禁止替代方案 |
| --- | --- | --- |
| `SessionComposition`（core） | Snapshot 的创建、冻结、解码、漂移判定 | 页面内重建组合或放宽 allowlist |
| `ProductModePolicy`（core） | kill switch 判定（`AIGCFROGE_CUSTOM_MODE`），fail-closed | UI 自行决定模式是否可用 |
| `SessionIdentityProjection`（core） | custom 的 snapshot digest + policy capability | 从 URL / 本地状态推断 capability |
| Custom Builder（app） | 组合编辑与预览 | 直接写 Session 执行状态 |
| canonical Session page | 消息、工具、权限 | Custom 首页内嵌执行链 |

## 4. current / target / verified

| 维度 | current（代码事实） | target | verified（证据） |
| --- | --- | --- | --- |
| 默认开关 | **默认关闭**；`AIGCFROGE_CUSTOM_MODE` 控制（`core/src/flag/flag.ts:82`） | 不变 | kill-switch 单测；`ProductModePolicy.assertRuntimeSupported` |
| 负向 gate | 关闭时 UI 显示 flag 警告，drain 前置 assert 失败且 inbox 行保持 pending | 不变 | E3 `custom-builder-states.spec.ts`、`home-custom-new-session.spec.ts`；core `kill-switch-drain.test.ts` |
| 组合生命周期 | Snapshot 冻结 + 漂移即 fail closed | 不变 | core `custom-mode-lifecycle`、`custom-mode-drift`、`custom-mode-security`、`custom-mode-upgrade`、`custom-composition-start` |
| 身份投影 | digest + policy；关闭时 capability `blocked` 且 reason 为 `custom-mode-disabled` | 不变 | `session-identity.ts:220-240`；schema `custom projection carries the snapshot digest only` |
| 子会话 | 子会话按父 Snapshot allowlist 授权，per-turn 仍校验 | 不变 | core `custom-child-provider-turn.test.ts`、`session-runner-custom-composition.test.ts` |
| 正向 E4（启用后的真实执行） | 已获 Owner 裁决“补全”，但**未在本机取证** | 启用后有真实 provider turn 的 E4 | 无本机证据 |

## 5. 当前未闭环项

1. **正向执行 E4**：启用 kill switch 后的真实 provider turn 尚未有 E4 证据；缺口契约绿色**不计作**运行成功。
2. **V2 execution 依赖**：custom 始终走 V2 路径，因此受 `v2-runtime-execution-gap` 影响（见 coverage manifest）。
3. **升级与历史保持**：`custom-mode-upgrade.test.ts` 覆盖升级路径，但历史 Session 的跨版本可读性需 E4。
4. **snapshot 生命周期**：`httpapi-custom-composition.test.ts` 的 snapshot-lifecycle 用例曾因 `presetCategoryId`/`time.archived` 序列化为 `null` 而 decode 失败；属独立修复单元。

## 6. 验收门禁

- 默认关闭时不得宣称应用内可运行 Custom；负向 gate 必须 fail closed 且可诊断。
- 启用后必须有真实 provider turn 的 E4，且 snapshot 漂移、消费者绑定缺失、子会话越权三类失败都有 typed 拒绝。
- capability reason code 稳定；`custom-mode-disabled` 不得被 UI 静默吞掉。
- 不新增第二套资产真源；组合只消费 Chat 资产。
