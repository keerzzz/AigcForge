# Work 模式 M3 调研报告：扩展产出（DataAnalysis / 图表 HTML）

> 状态：**调研报告**（M3 不具备直接启动条件，本报告供产品 / Security 评审）
> 日期：2026-08-07
> 依据：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §5/§13、[Work 路线图](work-mode-roadmap.md) §3.5、CSP 现状（[ui.ts](packages/aigcfroge/src/server/shared/ui.ts)）、5 份调研文档、DOMPurify 现状
> 关联：[Work M1.5 计划](work-mode-execution-layer-m1.5.md)（已合入）、[Work M2 计划](work-mode-execution-layer-m2.md)（已合入）

---

## 1. M3 功能定义（大白话）

**M1-M2**：Work 模式让非编程用户生成 **Markdown 文档**（分镜脚本 / PRD / 文献综述 / 行政公文）-- 纯文字交付。

**M3**：扩展到需要**图表 / 可视化**的场景，产出**交互式 HTML**（不只是文字）。

**典型场景**：
- 数据分析师做数据洞察报告（漏斗图 / 趋势图 / 对比图）
- 项目流程可视化（RACI 矩阵 / 协作拓扑图）
- 任何用文字表达不清、需要图形化展示的交付

**为什么需要 M3**：有些交付物用纯文字 Markdown 表达不清（数据趋势、协作拓扑），需要交互式图表。

**为什么 M3 难**：HTML 图表含 JS 脚本（Vis.js / Chart.js 等），有 XSS 风险，必须安全隔离（CSP 门禁）。

---

## 2. 需求来源

### 2.1 PRD §5 真伪需求矩阵

[PRD §5 :74](../prd/work-mode-execution-layer.md) 数据分析师（Data）：
- 真需求："基于 Schema 字典强校验的 SQL 分析与因果推断"
- 交付物："Markdown Data Insights"
- 低阶陷阱："只报不析的看板"（被拒绝的伪需求）

### 2.2 5 份调研文档与 M3 关联

| 文档 | 主题 | 与 M3 关联 |
|---|---|---|
| [Open Source AI Agent Research](../Open%20Source%20AI%20Agent%20Research.md) | 12 工种研运协同 + 开源 Agent 工具 | 数据分析师职责（CUPED / 归因 / 看板）+ PandasAI Text-to-SQL |
| [Agentic Workspace PRD Research](../Agentic%20Workspace%20PRD%20Research.md) | Micro-Pod 多智能体 PRD | 12 工种终端流仿真（数据分析师场景） |
| [高级顾问角色深度调研](../高级顾问角色深度调研.md) | 20 年顾问认知框架 | "向上提维度"思维（M3 高阶数据洞察 vs 低阶看板） |
| [数字人 Agent 架构调研](../数字人%20Agent%20架构调研.md) | 数字人（NeRF / 3DGS / 口型驱动） | 无直接关联（M3 不涉及数字人） |
| [全栈项目团队与流程可视化](../全栈项目团队与流程可视化.md) | 12 工种 + RACI + 可视化预览 | **M3 图表 HTML 的具体形态范例**（见 §2.3） |

### 2.3 全栈可视化文档 = M3 图表 HTML 的完整范例

[全栈项目团队与流程可视化.md](../全栈项目团队与流程可视化.md) 后半部分是一个完整的"单文件 HTML 全景交互系统"提示词，包含 4 个交互模块：

| 模块 | 内容 | 技术栈 |
|---|---|---|
| 模块一：12 工种卡片图鉴 | 网格卡片 + 侧边面板（Drawer） | HTML/CSS/JS |
| 模块二：研运协同流 | 时间轴交互卡片 | HTML/CSS/JS |
| 模块三：RACI 矩阵 | HTML Table + 行列滤镜 + 弹窗 | HTML/CSS/JS |
| 模块四：协作拓扑网络图 | 节点 + 连线 + 物理引擎 | **Vis.js** |

该文档明确要求："输出具备生产环境级别的、精美至极的单文件 HTML 全景交互系统代码"。

**这就是 M3 图表 HTML 产出的目标形态**：LLM 根据用户需求生成单文件交互式 HTML（含 JS + 图表库）。

---

## 3. 需求矛盾分析

| 来源 | 说法 | 交付格式 |
|---|---|---|
| PRD §5 :74 | 数据分析师交付"Markdown Data Insights" | Markdown |
| 路线图 §3.5 | M3"图表 HTML 产出" | HTML |
| 全栈可视化文档 | "高保真交互式可视化预览页面" | 单文件 HTML |

**矛盾**：PRD 说 Markdown，路线图 + 可视化文档说 HTML。

**可能解读**：
- 数据分析师 preset 的核心交付是 Markdown Data Insights（文字洞察报告）
- M3 扩展产出是额外的 HTML 图表（可视化增强）
- 即 Markdown 为主 + HTML 图表为辅（像 M1 候选稿=消息正文 + M2 存为资产的双载体）

**需产品确认**：M3 是新增"图表 HTML"preset，还是给数据分析师 preset 加 HTML 图表产出？

---

## 4. CSP 现状（严格）

### 4.1 server 端 CSP

[ui.ts:11](packages/aigcfroge/src/server/shared/ui.ts)：
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' [可选sha256]; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; ...
```
- **不允许 inline script**（只允许 'self' + 可选 hash 白名单）
- `cspForHtml(body)` 为含 inline script 的 HTML 生成 sha256 hash（仅限 theme preload 固定脚本）
- 图表 HTML 的脚本动态生成（LLM 产出），hash 不固定 -> **无法用 hash 白名单**

### 4.2 DOMPurify 现状

[markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx)：
- `sanitizeMarkdown(html)` 移除危险元素（含 script）
- 用于 markdown 渲染（marked.parse -> sanitize）
- 图表 HTML 靠 inline script 渲染 -> **DOMPurify 会清掉图表脚本**，图表无法渲染

**结论**：现有 CSP + DOMPurify 都不允许 inline script 图表 HTML 直接在 app 内渲染。需要隔离方案。

---

## 5. 安全方案对比

| 方案 | 做法 | 可行性 | 代价 |
|---|---|---|---|
| A: sha256 hash 白名单 | CSP 允许固定 hash 的 inline script | ❌ 不可行 | 图表脚本 LLM 动态生成，hash 不固定 |
| B: iframe sandbox | 跨域 iframe 隔离，允许 inline script | ✅ **最可行** | 需 sandbox 属性 + 跨域隔离 |
| C: server 渲染 SVG/PNG | server 端渲染图表为静态图 | ✅ 可行 | 失去交互性（hover/click） |
| D: 图表库 self-host + CSP allowlist | script-src 允许 self 托管的图表库 | ⚠️ 限制大 | 只能用预置图表库，LLM 不能自由生成 |

**推荐 B（iframe sandbox）**：图表 HTML 在 sandbox iframe 内渲染，允许 inline script 但跨域隔离（无法访问父窗口 / cookie / storage）。可选 C（SVG 降级）作为无 JS 时的 fallback。

**iframe sandbox 方案要点**：
- `<iframe sandbox="allow-scripts" srcdoc="...">`（不加 allow-same-origin，隔离域）
- 图表 HTML 作为 srcdoc 或 blob URL 注入
- 父页面与 iframe 通过 postMessage 通信（若需交互）
- 需 Security owner 评审 srcdoc/sandbox 边界

---

## 6. 可行性评估

**M3 暂不具备直接启动条件**：

| 阻塞项 | 说明 |
|---|---|
| 需求不明确 | PRD（Markdown）vs 路线图（HTML）矛盾，数据分析师 preset 本身没做（M1 只做 4 个高置信预设） |
| 安全方案未定 | iframe sandbox 需 Security owner 评审（srcdoc/sandbox 边界、postMessage 通信） |
| 图表库选型未定 | Vis.js（拓扑）/ Chart.js（数据图）/ ECharts / 自研？ |
| preset 范围未定 | M3 只做数据分析师，还是含其他可视化场景（如全栈可视化文档的 RACI 矩阵）？ |

---

## 7. 启动前需澄清（产品 + Security）

### 7.1 产品确认
1. M3 交付格式：Markdown Data Insights / HTML 图表 / 两者？
2. M3 是新增"图表 HTML"preset，还是给数据分析师 preset 加 HTML 产出？
3. preset 范围：只数据分析师，还是含其他可视化（RACI/拓扑/流程图）？
4. 图表交互性要求：纯展示（SVG 够）/ 需交互（hover/click/滤镜，需 HTML+JS）？

### 7.2 Security 评审
1. iframe sandbox 方案是否可接受？`sandbox="allow-scripts"` 不加 `allow-same-origin` 是否足够隔离？
2. srcdoc vs blob URL vs 落盘文件，哪个安全边界更优？
3. 图表 HTML 的 LLM 产出如何校验（防 XSS 注入）？sandbox 隔离 + DOMPurify 预清（保留 script）？
4. 是否需要 CSP 报告头（report-uri）监控违规？

### 7.3 技术选型
1. 图表库：Vis.js（拓扑）/ Chart.js（数据图）/ ECharts（综合）/ 自研轻量？
2. 图表 HTML 产出载体：消息正文（M1 D1 模式）/ 落盘文件（M1 apply 模式）/ iframe 预览？
3. 复用 M1-M2 链路：候选稿=消息正文 -> 右栏预览（M1）+ 存为资产（M2）？还是新载体？

---

## 8. 建议推进路径

1. **产品确认需求**（§7.1）-- 决定 M3 交付格式 + preset 范围
2. **Security 评审 iframe sandbox**（§7.2）-- 决定安全隔离方案
3. **技术选型**（§7.3）-- 图表库 + 产出载体
4. 三者落地后，编写 [M3 实施计划](work-mode-execution-layer-m3.md)（像 M1.5/M2 那样审批 + TDD prompt）
5. 参考全栈可视化文档作为 M3 图表 HTML 的形态范例

---

## 9. 与 M1/M1.5/M2 的关系

| 维度 | M1 | M1.5 | M2 | M3 |
|---|---|---|---|---|
| 产出格式 | Markdown | - | prompt 资产 | **HTML 图表（待定）** |
| 候选稿载体 | 消息正文 | - | CandidateInfo | **待定（消息/文件/iframe）** |
| 安全边界 | 原子写入 + 路径校验 | - | 复用 Chat apply | **CSP + iframe sandbox（新增）** |
| 复用链路 | Preset + 澄清 + 落盘 | SessionTodoProgress + Task | Chat propose candidate store | **待定（可能复用 M1 预览 + M2 资产）** |

M3 继承 M1 的 Preset + 澄清 + 落盘骨架，但产出格式从 Markdown 升级为 HTML，引入 CSP 安全隔离新维度。

---

## 10. 关联文档

- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - §5 真伪需求矩阵、§13 M3 准入
- [Work 路线图](work-mode-roadmap.md) - §3.5 M3 阶段定义
- [全栈项目团队与流程可视化](../全栈项目团队与流程可视化.md) - M3 图表 HTML 形态范例
- [Open Source AI Agent Research](../Open%20Source%20AI%20Agent%20Research.md) - 数据分析师工种职责
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts) - CSP 现状
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) - DOMPurify 现状
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
