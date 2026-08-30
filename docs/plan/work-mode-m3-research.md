# Work 模式 M3 调研报告：Mermaid 内嵌图表（L1）

> 状态：**Approved**（L1 收窄，L2 延后为 M3.5 远期，2026-08-07 决策）
> 日期：2026-08-07
> 依据：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §5、[Work 路线图](work-mode-roadmap.md) §3.5、CSP 现状（[ui.ts](packages/aigcfroge/src/server/shared/ui.ts)）、Mermaid 图表能力、三竞品反编译（[Accio](../Accio竞品反编译分析报告.md) / [Antigravity](../Antigravity反编译分析报告.md) / [Cherry-Studio](../Cherry-Studio反编译分析报告.md)）
> 关联：[Work M1.5 计划](work-mode-execution-layer-m1.5.md)（已合入）、[Work M2 计划](work-mode-execution-layer-m2.md)（已合入）

---

## 1. M3 功能定义（大白话）

**M1-M2**：Work 模式让非编程用户生成 Markdown 文档（分镜/PRD/文献综述/公文）-- 纯文字交付。

**M3（L1）**：让 Markdown 候选稿支持 **Mermaid 图表内嵌**（`\`\`\`mermaid` 代码块 -> SVG），当文字表达不清时用图表增强。

**典型场景**：

- PRD 嵌入业务流程图 / 需求依赖拓扑 / 路线图甘特
- 文献综述嵌入对比矩阵 / 文献结构思维导图
- 数据洞察嵌入趋势图 / 占比饼图
- 架构 ADR 嵌入系统拓扑 / ER 图 / 时序图

**为什么 Mermaid**：Markdown 内嵌图表的事实标准，渲染为 SVG（无 inline script，无 XSS/CSP 问题），15+ 图表类型覆盖全部高频真实需求。

---

## 2. 需求来源

### 2.1 PRD §5 真伪需求矩阵

[PRD §5](../prd/work-mode-execution-layer.md) 12 工种 + 5 泛人群的真需求交付物**全部是 Markdown**，但多个工种交付物天然需要图表：

- PO：PRD / WSJF 评估表（需流程图/拓扑/甘特）
- BA：SRS / 业务流程图（需流程图）
- 架构师：ADR（需拓扑/ER/时序）
- 数据分析师：Data Insights（需趋势/占比）
- Growth：Experiment Proposal（需漏斗/对比）
- SRE：Postmortem（需事故时间线）

**结论**：图表是 Markdown 交付物的增强，不是独立 HTML 产出。M3 聚焦 Mermaid 内嵌。

### 2.2 三竞品无参考

| 竞品          | 图表 HTML 产出 | 相关能力                  |
| ------------- | -------------- | ------------------------- |
| Accio         | ❌ 无          | Task 体系 / 多平台消息    |
| Antigravity   | ❌ 无          | gRPC 流式 / PartialArg    |
| Cherry-Studio | ❌ 无          | SSE / 多模型 / 知识库 RAG |

**M3 是 AigcForge 差异化**（三竞品均无），但也无参考实现。L1 Mermaid 低风险自研（标准库 + SVG），L2 独立 HTML 高风险（无参考 + CSP 评审）。

---

## 3. L1/L2 分层决策（2026-08-07）

| 层     | 范围                                                                                                                | 安全门槛                  | 频率 | 估时 | 决策             |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---- | ---- | ---------------- |
| **L1** | Markdown 内嵌 Mermaid（流程/拓扑/时序/甘特/数据/思维导图/状态机/旅程/时间线/ER/C4/象限/饼/条形/桑基/Git/需求/类图） | **低**（SVG，无 CSP）     | 高频 | ~3d  | ✅ **M3**        |
| **L2** | 独立 HTML 图表产出（全栈可视化 4 模块 / 数据大屏）                                                                  | 高（iframe sandbox 评审） | 低频 | ~7d  | ⏸ **M3.5 远期** |

**决策依据**：

- **极致减法**：L1 复用 Mermaid 库（SVG，0 新增负债）；L2 新增 iframe sandbox + CSP 评审（新增负债）
- **方案对冲**：L1 简单实现优先（Mermaid SVG），L2 健壮架构待 Security 评审
- **真实需求**：L1 覆盖 15+ 图表类型满足全部高频场景；L2 低频汇报场景
- **三竞品**：均无图表产出，L1 低风险自研，L2 高风险延后

---

## 4. Mermaid 图表类型覆盖（L1 能力清单）

| 分类      | 类型        | 语法                      | Work 场景                  |
| --------- | ----------- | ------------------------- | -------------------------- |
| 流程/结构 | 流程图      | `graph TD/LR`             | BA 业务流程、QA 测试流程   |
| 流程/结构 | 思维导图    | `mindmap`                 | PO 需求拆解、架构方案脑暴  |
| 流程/结构 | 块图        | `block-beta`              | 系统组成概览               |
| 时序/交互 | 时序图      | `sequenceDiagram`         | 架构师 API 交互、BE 调用链 |
| 时序/交互 | 状态图      | `stateDiagram-v2`         | QA 状态机、订单生命周期    |
| 架构/关系 | 类图        | `classDiagram`            | 架构师领域模型             |
| 架构/关系 | ER 图       | `erDiagram`               | BE 数据库设计              |
| 架构/关系 | C4 架构图   | `C4Context`/`C4Container` | 架构师 ADR 内嵌            |
| 架构/关系 | 需求图      | `requirementDiagram`      | PO 需求追溯                |
| 数据/统计 | 饼图        | `pie`                     | 数据分析师占比             |
| 数据/统计 | 条形/折线图 | `xychart-beta`            | 数据趋势、Growth A/B 对比  |
| 数据/统计 | 桑基图      | `sankey-beta`             | Growth 用户漏斗流向        |
| 数据/统计 | 象限图      | `quadrantChart`           | PO 优先级矩阵（WSJF）      |
| 时间/计划 | 甘特图      | `gantt`                   | PO 路线图、DevOps 排期     |
| 时间/计划 | 时间线      | `timeline`                | SRE 事故时间线             |
| 用户体验  | 用户旅程    | `journey`                 | UI/UX 用户旅程             |
| 版本控制  | Git 图      | `gitGraph`                | DevOps 发布流程            |

**结论**：Mermaid 一个库覆盖 M3 全部高频真实需求，不需要 Chart.js/Vis.js（那些是 L2 范畴）。

---

## 5. CSP 现状（L1 不受影响）

### 5.1 server 端 CSP

[ui.ts:11](packages/aigcfroge/src/server/shared/ui.ts)：

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' [可选sha256]; ...
```

- 不允许 inline script（只允许 'self' + hash 白名单）

### 5.2 DOMPurify 现状

[markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) 用 DOMPurify sanitize markdown 渲染。

### 5.3 L1 为什么不受 CSP 影响

- Mermaid 渲染为 **SVG**（静态 XML，无 `<script>`）
- DOMPurify 保留 SVG 元素（已有配置）
- Mermaid 渲染器是 app 自有脚本（self），不是 inline script
- **L1 不需要 CSP 评审 / Security owner / iframe sandbox**

### 5.4 L2（M3.5）才需 CSP 评审

L2 独立 HTML 图表含 inline script（Vis.js/Chart.js），需 iframe sandbox 隔离 -- 留给 M3.5 远期评审。

---

## 6. L2（M3.5）延后条件

L2 独立 HTML 图表产出延后，待：

1. **产品确认**：汇报场景需求（团队全景/数据大屏）是否真实高频
2. **Security 评审**：iframe sandbox 方案（`sandbox="allow-scripts"` 不加 `allow-same-origin`）
3. **图表库选型**：Vis.js（拓扑）/ Chart.js（数据图）/ ECharts
4. **需求矛盾澄清**：PRD §5"Markdown Data Insights" vs 路线图"图表 HTML"（L1 后可重新评估）

L2 的 CSP/iframe sandbox 方案对比保留在 [M3.5 远期调研](#)（待立项）。

---

## 7. 可行性评估

**M3（L1）具备直接启动条件**：

| 条件     | 状态                                            |
| -------- | ----------------------------------------------- |
| 需求明确 | ✅ PRD §5 交付物都 Markdown，Mermaid 增强       |
| 安全方案 | ✅ Mermaid SVG，无 CSP 问题                     |
| 图表库   | ✅ Mermaid（标准库，15+ 类型）                  |
| 复用链路 | ✅ 候选稿=消息正文（M1 D1）+ 存为资产（M2）不变 |
| 竞品参考 | ❌ 无（但 L1 低风险自研）                       |

**无阻塞项**，可直接编写实施计划。

---

## 8. M3（L1）启动前需澄清

### 8.1 已确认（本报告决策）

- M3 = L1 Mermaid 内嵌
- L2 延后 M3.5
- Mermaid 接入：SYSTEM_PROMPT 通用教 + guidance 示例聚焦 PRD/文献综述

### 8.2 实施时确认

- Mermaid 库版本 + 渲染器集成方式（app 端 markdown-cache.tsx 改造）
- DOMPurify 配置是否需调整（保留 Mermaid SVG 元素）
- work-orchestrator SYSTEM_PROMPT Mermaid 指引文案
- 4 个 preset guidance 哪些加 Mermaid 示例（推荐 PRD/文献综述加，视频分镜/行政公文不加）

---

## 9. 建议

1. **M3（L1）直接启动**：编写 [M3 实施计划](work-mode-execution-layer-m3.md)（像 M1.5/M2 那样审批 + TDD prompt）
2. **L2 标 M3.5 远期**：路线图加 M3.5，待产品/Security 评审后立项
3. **Mermaid 接入**：SYSTEM_PROMPT 通用 + guidance 示例聚焦 PRD/文献综述
4. **参考全栈可视化文档**：[全栈项目团队与流程可视化](../全栈项目团队与流程可视化.md) 的 4 模块是 L2 形态范例（M3.5 参考，非 M3）

---

## 10. 与 M1/M1.5/M2 的关系

| 维度       | M1                   | M1.5                       | M2                           | M3（L1）                       |
| ---------- | -------------------- | -------------------------- | ---------------------------- | ------------------------------ |
| 产出格式   | Markdown             | -                          | prompt 资产                  | **Markdown + Mermaid SVG**     |
| 候选稿载体 | 消息正文             | -                          | CandidateInfo                | **消息正文（不变）**           |
| 安全边界   | 原子写入 + 路径校验  | -                          | 复用 Chat apply              | **Mermaid SVG（无 CSP 问题）** |
| 复用链路   | Preset + 澄清 + 落盘 | SessionTodoProgress + Task | Chat propose candidate store | **M1 渲染链路 + Mermaid 库**   |

M3（L1）继承 M1 的候选稿=消息正文载体，只加 Mermaid 渲染能力 + SYSTEM_PROMPT 指引。最小侵入。

---

## 11. 关联文档

- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - §5 真伪需求矩阵
- [Work 路线图](work-mode-roadmap.md) - §3.5 M3（L1）+ M3.5（L2 远期）
- [全栈项目团队与流程可视化](../全栈项目团队与流程可视化.md) - L2 形态范例（M3.5 参考）
- [Accio 竞品反编译](../Accio竞品反编译分析报告.md) / [Antigravity](../Antigravity反编译分析报告.md) / [Cherry-Studio](../Cherry-Studio反编译分析报告.md) - 三竞品均无图表产出
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts) - CSP 现状
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) - DOMPurify + Mermaid 集成点
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
