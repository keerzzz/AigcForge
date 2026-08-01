# Work Mode

> 状态：PLANNED — 当前代码库无实现（占位 Phase）
> 权威 PRD：[Work 模式 - 非编程执行层](../../prd/work-mode-execution-layer.md)（v4.1，2026-07-31 Approved）

---

## 定位

Work 模式是产品的**非编程执行层**——通过硬编码系统预设（Presets）引导非编程用户完成结构化交付任务。Work 消费 Chat 模式注册的资产（含工作流定义），自身不直接创建或管理可复用资产。

## 核心能力（PRD v4.0 定义）

- **Presets Catalog**：按场景/职业分类的硬编码预设，覆盖 12 大 IT 工种 + 5 类泛办公人群
- **Progress Ledger**：实时进度账本，展示阶段状态，支持增量断点恢复 (Resume)
- **只读安全预览**：右栏 Markdown 预览，修改通过对话指令完成
- **同名冲突询问**：落盘前自动检测并触发 LLM 澄清/覆盖确认
- **存为资产**：产出消息提供一键跳转 Chat 资产工作室通道

## 布局

Work 复用 ADR-12/15 的共享 `ModeWorkspace`，主区为 Work typed slot。

```
┌────┬──────────────┬─────────────────────────┬─────────────────┐
│Left│SecondarySide │ Main = Work slot        │ Right slot      │
│Nav │(项目导航)    │  - Presets Catalog      │  - Context Tab  │
│    │              │  - Session 消息流       │  - Artifact Tab │
│    │              │  - Progress Ledger      │                 │
└────┴──────────────┴─────────────────────────┴─────────────────┘
```

## 架构前提

- ADR-11/12：四类 Product Mode 持久分类 + `/mode/work` 入口
- ADR-13 + Amendment-1：Work 负责消费执行，Chat 负责资产创建（含工作流定义）
- ADR-14：产出真源 = Location 文件，Artifact 存身份投影不存正文
- ADR-15：主区 = Work typed slot

## 当前状态

代码层全占位（PlaceholderMain / PlaceholderSidebar），M0 契约（Artifact + Progress Ledger Schema）未启动。详见权威 PRD §13 里程碑。
