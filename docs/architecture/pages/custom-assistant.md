# Custom Assistant Mode

> 状态：**SUPERSEDED（2026-09-03）** — 本页原写「PLANNED — 当前代码库无实现」，但它描述的能力（动态装配 Tools + Knowledge + Persona Prompt、工具白名单、目录绑定、路径校验）已由 **Custom 模式**实现，且三条「实现前置条件」全部满足。
> 当前事实源：[ADR-17 Custom Mode Composition Platform](../adr/ADR-17-custom-mode-composition-platform.md) · [Custom PRD](../../prd/custom-mode-composition-platform.md) · [Custom 路线图](../../roadmap/custom-mode-roadmap.md) · [Mode Switcher](mode-switcher.md)
> 个人助理（Assistant）模式是**另一个**模式，见 [Assistant PRD](../../prd/assistant-mode-personal-agent.md)。

---

本页不再维护，以免与 ADR-17 一线文档产生第二套说法。原始计划内容已被下列落地事实取代：

| 原计划条目                                        | 当前实现                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 动态装配：Tools + Knowledge + Persona Prompt 组合 | Custom 组合 Builder + 冻结 Snapshot（`packages/core/src/composition-resolver.ts`、`packages/schema/src/composition.ts`） |
| 安全隔离：工具白名单、目录绑定、路径校验          | Snapshot per-consumer binding + Location 作用域 + ADR-20 `ScopedGrant`；Custom 执行失败即 fail closed                    |
| 面向开发者与非技术用户                            | `/mode/custom` 入口 + Custom Profile；资产由 Chat 资产工作室创建，Custom 只消费                                          |
| 前置条件：Mode Switcher 就绪                      | 已就绪，`MODE_DEFINITIONS` 五档含 `custom`（`packages/app/src/context/mode.tsx:6`）                                      |
| 前置条件：安全隔离模型定义                        | ADR-20 scoped grant + `permission-tier`                                                                                  |
| 前置条件：动态 Tool 注册机制                      | Snapshot 冻结的 tool allowlist（ADR-17 §运行时）                                                                         |
