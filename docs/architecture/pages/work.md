# Work Mode

> 状态：**M1 – M3.5 已实现**（2026-09-03 按代码复核）— M1 预设/澄清/只读预览/同名冲突/原子落盘（2026-08-01 合入 `a041ca617`）、M1.5 步骤账本 + 断点恢复、M2 存为资产、M3 Mermaid 图、M3.5 HTML artifact 沙箱
> 权威 PRD：[Work 模式 - 非编程执行层](../../prd/work-mode-execution-layer.md)（v4.1，2026-07-31 Approved）
> 实施计划：[M1](../../plan/work-mode-execution-layer-m1.md) · [M1.5](../../plan/work-mode-execution-layer-m1.5.md) · [M2](../../plan/work-mode-execution-layer-m2.md) · [M3](../../plan/work-mode-execution-layer-m3.md) · [M3.5](../../plan/work-mode-execution-layer-m3.5.md) · [会话页左右栏归一](../../plan/work-mode-session-sidebar-plan.md)

---

## 定位

Work 模式是产品的**非编程执行层**——通过硬编码系统预设（Presets）引导非编程用户完成结构化交付任务。Work 消费 Chat 模式注册的资产（含工作流定义），自身不直接创建或管理可复用资产。

## 核心能力与落地状态（PRD v4.1 定义）

| 能力                                                                                             | 状态                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Presets Catalog**（4 分类预设卡片库，覆盖 12 大 IT 工种 + 5 类泛人群，M1 落地 4 个高置信预设） | ✅ M1 已实现                                                                                                      |
| **work-orchestrator 澄清**（question tool 问卷 ≤5 题，`guided` 预设强制问卷）                    | ✅ M1 已实现                                                                                                      |
| **只读安全预览**（候选稿 = assistant 消息正文，右栏 Artifact Tab 渲染，无编辑入口）              | ✅ M1 已实现                                                                                                      |
| **同名冲突询问**（orchestrator 询问重命名/覆盖 + 新旧 Diff 确认）                                | ✅ M1 已实现                                                                                                      |
| **原子落盘 + Artifact 投影**（内存态记录 + `work.artifact_applied` 事件，ADR-15 §5 不落库）      | ✅ M1 已实现                                                                                                      |
| **首页会话历史**（mode=work 历史列表 + 点开继续）                                                | ✅ 已实现（`mode-workspace-slots.tsx` 的 work session 列表 + `openSessionRecord`）                                |
| **用户工作流资产**（Chat workflow 资产进首页卡片，引导降级执行）                                 | ✅ 已实现（`mode-workspace-slots.tsx:667` 的 `workflowAssets`）                                                   |
| Progress Ledger 步骤账本 + 断点恢复 (Resume)                                                     | ✅ M1.5 已实现（`session/timeline/session-todo-progress.tsx`，Resume 发 `work.resume.prompt`）                    |
| 存为资产 → Chat 资产工作室                                                                       | ✅ M2 已实现（`pages/work-asset-capture.ts` → Chat propose store，门禁 `e2e/regression/work-asset-save.spec.ts`） |
| Mermaid 图内联渲染                                                                               | ✅ M3 已实现（门禁 `e2e/regression/work-mermaid-artifact.spec.ts`）                                               |
| HTML artifact 沙箱预览                                                                           | ✅ M3.5 已实现（iframe 三重防线，门禁 `e2e/regression/work-html-artifact.spec.ts`）                               |

## 布局

Work 复用 ADR-12/15 的共享 `ModeWorkspace`，主区为 Work typed slot。

**首页（/mode/work）三段式主区**：

```
┌──────────────────────────────────────────────────┐
│ ① 继续工作：最近 mode=work 会话，点开续接          │
│ ② 开始新任务 · 官方预设：4 分类卡片网格            │
│ ③ 你的工作流资产：Chat workflow 资产，引导模式      │
└──────────────────────────────────────────────────┘
左栏：Location 选择器（产出落点）+ 新建任务
```

**会话详情页三栏**：

```
┌────┬──────────────────────┬───────────────────────────┐
│ 左 │ 中：消息流 + 澄清      │ 右：Artifact Tab（预览/应用）│
│ 栏 │                      │    + Context Tab（对齐 Code）│
└────┴──────────────────────┴───────────────────────────┘
```

## 架构前提

- ADR-11/12：Product Mode 持久分类 + `/mode/work` 入口（`ProductMode.ID` 现为含 `custom` 的五值）
- ADR-13 + Amendment-1：Work 负责消费执行，Chat 负责资产创建（含工作流定义）；工作流执行引擎归 Work、独立于 Chat 资产层
- ADR-14：产出真源 = Location 文件，Artifact 存身份投影不存正文
- ADR-15：主区 = Work typed slot

## 当前状态

M1 – M3.5 已实现（预设 → 澄清 → 只读预览 → 原子落盘 → 步骤账本/Resume → 存为资产 → Mermaid → HTML 沙箱）。会话详情页左右栏归一见 [会话页归一计划](../../plan/work-mode-session-sidebar-plan.md)。
