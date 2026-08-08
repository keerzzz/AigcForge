# Work 模式 M3 实施计划：Mermaid 内嵌图表（L1）

> 状态：**Approved**（L1，2026-08-07；本版为代码级核验修订版，纠正初稿 D1/D2 技术误判，见 §0 修订说明）
> 日期：2026-08-07
> Owner：Core + App + Session-UI
> 范围：`packages/ui`（marked-shiki highlight 拦截）+ `packages/session-ui`（Mermaid 渲染 + 独立 sanitize）+ `packages/core`（SYSTEM_PROMPT + preset guidance）+ `packages/app`（i18n）
> 关联：[M3 调研报告](work-mode-m3-research.md)（L1/L2 分层决策）、[Work 路线图](work-mode-roadmap.md) §3.5（M3 L1）、[Work M1 计划](work-mode-execution-layer-m1.md)（候选稿载体 D1）、[Work M1.5 计划](work-mode-execution-layer-m1.5.md)（SYSTEM_PROMPT 步骤化）、[Work M2 计划](work-mode-execution-layer-m2.md)（存为资产）、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)（TDD 范式）、[frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md)（v2 token 对齐）
> 分支：**work-m3**（从最新 main 切出；连字符分隔、≤3 词、无斜杠无类型前缀，符合 AGENTS.md Branch 规范）
> 最后更新：2026-08-07

---

## 0. 审批状态与执行 Gate

### 0.1 修订说明（本版相对初稿的代码级核验纠正）

初稿（commit `b45edd4c0`）已 Approved，但 D1/D2 基于未核验的渲染管线假设。本版逐文件核验 5 层代码后纠正两处技术误判，Gate 与范围不变：

| 项 | 初稿假设（未核验） | 代码核验结论 | 影响 |
|---|---|---|---|
| **D1 拦截点** | "marked 自定义 renderer：code 代码块，language=mermaid 时调 mermaid.render" | marked-shiki v1.2.1 用 `walkTokens` 在 marked renderer 之前把 code token 转成 html token（[marked-shiki/dist/index.js:5-15](../../node_modules/marked-shiki/dist/index.js)）；marked renderer **永远看不到 mermaid code token**。真正拦截点是 marked-shiki 的 `highlight(code, lang)` 回调（[marked.tsx:488](packages/ui/src/context/marked.tsx)） | D1 重写 |
| **D2 DOMPurify** | "config 已保留 svg/path，SVG 已支持，无需改" | config 仅 `ADD_TAGS: ["svg","path"]`，**无 svg profile**（[markdown-cache.tsx:14](packages/session-ui/src/components/markdown-cache.tsx)）；`SANITIZE_NAMED_PROPS: true`（:15）会给 id 加 `user-content-` 前缀，**打断 Mermaid 内部 `url(#id)` 引用**（箭头标记/渐变消失）；[sanitize-regression.test.tsx:11](packages/session-ui/src/components/sanitize-regression.test.tsx) 显式断言 `<foreignObject>` 被剥 | D2 重写为方案对比 + 推荐 B+ |
| **渲染流** | "marked.parse(block.src) -> code renderer -> mermaid.render -> SVG -> sanitizeMarkdown" | 非流式（Work 面板路径）下 `stream(text, false)` 返回单 `mode:"full"` 块（[markdown-stream.ts:53](packages/session-ui/src/components/markdown-stream.ts)），marked.parse 处理全文含 mermaid；但 markedShiki walkTokens 先把 mermaid code token 转 html token，**highlight 返回值即最终 HTML**（无 `<pre><code>` 包裹） | §4.1 流程重画 |

### 0.2 执行 Gate

| Gate | 条件 | 状态 | 阻塞范围 |
|---|---|---|---|
| **G0 范围真源** | [M3 调研报告](work-mode-m3-research.md) Approved（L1 收窄，L2 延后 M3.5） | ✅ 已满足 | 全部 Phase |
| **G1 依赖就绪** | M1-M2 已合入 main：候选稿=消息正文（M1 D1）+ work-orchestrator SYSTEM_PROMPT 步骤化（M1.5）+ 存为资产（M2，[work-artifact-panel.tsx:199-209](packages/app/src/pages/work-artifact-panel.tsx) 已落地） | ✅ 已满足 | 全部 Phase |
| **G2 拦截点** | marked-shiki `highlight(code, lang)` 回调（[marked.tsx:488](packages/ui/src/context/marked.tsx)）是 mermaid 语言信息唯一保留点--未知 lang 回退 "text" 前（:494）拦截 | ✅ 已核验 | Phase A |
| **G3 preset 范围** | PRD/文献综述 guidance 加 Mermaid 示例；视频分镜/行政公文不加（[work-preset.ts](packages/core/src/session/work-preset.ts) 4 预设已核验） | ✅ 已确认 | Phase B |
| **G4 安全** | Mermaid SVG 无 inline script（CSP `script-src 'self'` 不触发，[ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)）；方案 B+ 用独立 DOMPurify config sanitize SVG，不动全局 config，无 Security 评审阻塞 | ✅ 已确认 | 无需 Security 评审 |

**与 M3.5（L2）的边界**：M3 只做 Mermaid 内嵌（SVG，安全）。**不做** iframe sandbox / 独立 HTML 图表 / Chart.js·Vis.js·ECharts / CSP 评审 -- 那是 M3.5 远期范围。

---

## 1. 目标、非目标与本次收敛

### 1.1 M3（L1）目标

Work 候选稿（Markdown 消息正文）支持 **Mermaid 图表内嵌**：LLM 在候选稿中写 ` ```mermaid ` 代码块，右栏 Artifact Tab 只读预览渲染为 SVG 图表。覆盖流程/拓扑/时序/甘特/数据/思维导图等 15+ 类型（见 [调研报告 §4](work-mode-m3-research.md)）。

### 1.2 非目标

- ❌ 不做独立 HTML 图表产出（M3.5 L2，需 iframe sandbox + CSP 评审）
- ❌ 不引 Chart.js / Vis.js / ECharts（L2 范畴）
- ❌ 不改 M1 候选稿载体（候选稿=assistant 消息正文，[work-artifact-extract.ts:7](packages/app/src/pages/work-artifact-extract.ts) 不变）
- ❌ 不改 M1 落盘模型（原子写入 + 路径校验，[work-artifact-panel.tsx:103-158](packages/app/src/pages/work-artifact-panel.tsx) 不变）
- ❌ 不改 M2 存为资产链路（prompt 资产 template=候选稿，Mermaid 代码块作为 template 一部分自然携带，[work-asset-capture.ts](packages/app/src/pages/work-asset-capture.ts) 不变）
- ❌ 不动全局 DOMPurify config（方案 B+ 用独立 mermaid sanitize config，[markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx) 不改）
- ❌ 不新增 CSP 评审 / Security owner（Mermaid SVG 安全）
- ❌ 不新建数据库 migration（无新表）
- ❌ 不给所有 preset 强加 Mermaid（视频分镜/行政公文不加）
- ❌ 不改流式渲染管线（流式中 mermaid 显示为代码，完整后渲染 SVG，见 D6）

### 1.3 相对 PRD/路线图的收敛

| 原 PRD/路线图 | M3（L1）收敛 |
|---|---|
| M3 = DataAnalysis / 图表 HTML 产出（路线图 §3.5 原） | **收窄为 Mermaid 内嵌**（L1）；HTML 图表延后 M3.5 |
| PRD §5 数据分析师交付"Markdown Data Insights" | Mermaid 在 Data Insights 内嵌数据图表（pie/xychart），仍是 Markdown |
| 全栈可视化文档的 4 模块（独立 HTML） | 归 M3.5（L2），M3 不做 |

---

## 2. 背景与当前状态

### 2.1 已就绪基座（5 层代码核验，复用）

| 层 | 能力 | 位置 | 状态 |
|---|---|---|---|
| **① Prompt** | work-orchestrator SYSTEM_PROMPT（6 步 + Resume + Constraints + Preset Guidance） | [work-orchestrator.ts:13-44](packages/core/src/agent/prompt/work-orchestrator.ts) | ✅ M1.5 已步骤化；步骤5 "Produce the candidate"（:23）是 Mermaid 指引插入点 |
| **② Preset** | 4 预设（storyboard-video/write-prd/literature-review/official-document）+ guidance 字段 | [work-preset.ts:5-75](packages/core/src/session/work-preset.ts) | ✅ M1 已实现；M3 加 Mermaid 示例到 PRD/文献综述 guidance |
| **③ 提取** | findLatestAssistantMarkdown + extractFirstHeading + draftFilename | [work-artifact-extract.ts:7-39](packages/app/src/pages/work-artifact-extract.ts) | ✅ M1/M2 已实现（不变） |
| **④a 流分块** | `project(prev, text, live)` / `stream(text, live)`：`live=false` -> 单 `mode:"full"` 块（marked.parse 处理全文）；`live=true` -> code token 分离为 `mode:"code"`（走 shiki，不经 marked.parse） | [markdown-stream.ts:52-110](packages/session-ui/src/components/markdown-stream.ts) | ✅ 核验：Work 面板 `live=false`，mermaid 块经 marked.parse |
| **④b 渲染主循环** | Markdown 组件 createResource async：code 块走 `code()`->shiki worker（:327-341）；非 code 块走 `sanitizeMarkdown(await marked.parse(block.src))`（:352）；`updateBlock` 设 `innerHTML=block.html`（:485）后 `decorate()`（:486）后处理 DOM | [markdown.tsx:278-507](packages/session-ui/src/components/markdown.tsx) | ✅ 核验：mermaid 拦截在 marked.parse 内（markedShiki highlight），sanitize 在 :352 |
| **④c sanitize** | DOMPurify config：`USE_PROFILES:{html,mathMl}`（无 svg）+ `SANITIZE_NAMED_PROPS:true` + `ADD_TAGS:["svg","path"]` + `ADD_ATTR:["d","viewBox",...]` | [markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx) | ✅ 核验：**当前 config 会剥 Mermaid SVG 绝大部分元素 + 打断内部引用**，方案 B+ 绕开 |
| **④d marked 配置** | MarkedProvider（JS parser 路径，无 nativeParser）+ `marked.use({renderer:{link}}, markedKatex, markedShiki)`；markedShiki `async highlight(code, lang)`（:488-505）未知 lang 回退 "text" | [marked.tsx:471-522](packages/ui/src/context/marked.tsx) + [app.tsx:359](packages/app/src/app.tsx) | ✅ 核验：`<MarkedProvider>` 无 nativeParser -> JS 路径；highlight 是 mermaid 拦截点 |
| **④e marked-shiki** | v1.2.1 `walkTokens`：调 `highlight(code, lang, langArgs)`，返回值 `r` 作 raw HTML（`o = container ? ... : r`，无 container 即 `o=r`），code token -> html token `text:o` | [marked-shiki/dist/index.js:1-17](../../node_modules/marked-shiki/dist/index.js) | ✅ 核验：highlight 返回 SVG/占位符即最终 HTML，无 `<pre><code>` 包裹 |
| **⑤ CSP** | `script-src 'self' 'wasm-unsafe-eval'`（无 inline script） | [ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts) | ✅ Mermaid SVG 无 script，CSP 不触发 |
| **⑥ 呈现** | WorkArtifactContent `<Markdown text={candidate()!} />`（无 streaming prop -> 非流式） | [work-artifact-panel.tsx:187](packages/app/src/pages/work-artifact-panel.tsx) | ✅ M1/M2 已实现（不变） |

### 2.2 需新建/修改

| 交付物 | 位置 | 动作 |
|---|---|---|
| Mermaid 库依赖 | [session-ui/package.json](packages/session-ui/package.json) | 新增：`mermaid` 依赖（动态 import，不进首屏包） |
| marked-shiki highlight mermaid 拦截 | [marked.tsx:488](packages/ui/src/context/marked.tsx) | 修改：`highlight` 开头加 `if (lang === "mermaid") return mermaidPlaceholder(code)`（返回占位符 div，不引 mermaid 库） |
| Mermaid 渲染模块 | `packages/session-ui/src/components/mermaid.ts` | 新增：`getMermaid()`（动态 import + initialize strict）+ `renderMermaidBlocks(html)`（DOMParser 找占位符 -> render -> 独立 sanitize -> 替换）+ `sanitizeMermaidSvg(svg)`（独立 DOMPurify config） |
| markdown.tsx 接入 renderMermaidBlocks | [markdown.tsx:343-354](packages/session-ui/src/components/markdown.tsx) | 修改：sanitizeMarkdown 后对 cache 命中/未命中两条路径统一 `await renderMermaidBlocks(html)` |
| work-orchestrator SYSTEM_PROMPT Mermaid 指引 | [work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改：步骤5 Produce 加"文字表达不清时用 Mermaid"通用指引 |
| PRD preset guidance Mermaid 示例 | [work-preset.ts:30-31](packages/core/src/session/work-preset.ts) | 修改：PRD guidance 加流程/拓扑/甘特示例 |
| 文献综述 preset guidance Mermaid 示例 | [work-preset.ts:47-48](packages/core/src/session/work-preset.ts) | 修改：文献综述 guidance 加对比/思维导图示例 |
| i18n（可选） | [en.ts](packages/app/src/i18n/en.ts) + zh.ts + zht.ts | 修改（若需图表加载/错误降级提示文案） |

---

## 3. 范围与设计决策

### 3.1 D1：Mermaid 拦截点 = marked-shiki `highlight` 回调（非 marked renderer）

**根因追溯**（CLAUDE.md「拒绝表面回答 -> 追溯根因」）：

初稿假设"marked 自定义 code renderer 拦截 mermaid"。但代码核验发现 marked-shiki v1.2.1 用 `walkTokens`（[marked-shiki/dist/index.js:5-15](../../node_modules/marked-shiki/dist/index.js)）：

```js
async walkTokens(t) {
  if (t.type !== "code" || typeof e != "function") return;
  const [a = "text", ...l] = t.lang?.split(" ") ?? [];
  const r = await e(t.text, a, l);          // 调 highlight(code, lang)
  const o = n ? n.replace("%s", r) : r;     // 无 container -> o = r（返回值即 HTML）
  Object.assign(t, { type: "html", block: true, text: `${o}\n` });  // code token -> html token
}
```

- markedShiki 在 marked renderer **之前**把 code token 转成 html token
- marked renderer 永远看不到 mermaid code token（已是 html token）
- `highlight(code, lang)` 返回值 = 该代码块的最终 HTML（无 `<pre><code>` 包裹）

**结论**：拦截点只能是 `highlight` 回调（[marked.tsx:488](packages/ui/src/context/marked.tsx)）。在 `if (!(lang in bundledLanguages)) lang = "text"`（:494）回退**之前**加 mermaid 分支，否则 "mermaid" 语言信息丢失（变成 shiki "text" 高亮，无法事后识别）。

**拦截实现**（packages/ui，不引 mermaid 库，只产占位符）：

```ts
// marked.tsx highlight 回调开头
async highlight(code, lang) {
  if (lang === "mermaid") return mermaidPlaceholder(code)  // 占位符 div，源码转义进 data 属性
  // ... 现有 shiki 逻辑（lang 回退 text -> codeToHtml）
}
```

`mermaidPlaceholder(code)` 返回 `<div data-mermaid="<escaped>"></div>`，源码 HTML 转义后进 `data-mermaid` 属性。packages/ui 不依赖 mermaid 库（占位符是纯字符串），实际渲染在 session-ui。

**为什么占位符而非直接 SVG**：见 D2 方案 B+。packages/ui 的 marked context 若直接调 `mermaid.render`，则 packages/ui 依赖 mermaid（~500KB），且 SVG 经全局 sanitizeMarkdown 会被剥（D2）。占位符把"识别 mermaid"和"渲染 SVG"解耦：ui 只识别+占位，session-ui 渲染+独立 sanitize。

### 3.2 D2：SVG 安全策略 = 方案 B+（占位符 + 后渲染 + 独立 sanitize）

**问题根因**：Mermaid SVG 含大量元素（`g/text/rect/circle/path/line/polygon/defs/marker/tspan/ellipse` 等）+ 属性（`fill/stroke/transform/x/y/cx/cy/r/width/height/font-*` 等）+ 内部 `url(#id)` 引用（箭头标记、渐变）。全局 DOMPurify config（[markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx)）：

1. `USE_PROFILES: { html: true, mathMl: true }` -- **无 svg profile**，`ADD_TAGS: ["svg","path"]` 只放行 2 个标签，`g/text/rect/...` 全被剥
2. `SANITIZE_NAMED_PROPS: true` -- 给 `id`/`name` 加 `user-content-` 前缀，**打断 `url(#arrowhead)` 引用**（箭头/渐变消失）
3. [sanitize-regression.test.tsx:11-14](packages/session-ui/src/components/sanitize-regression.test.tsx) 显式断言 `<foreignObject>` 被剥 -- 开 svg profile 会放行 foreignObject，破坏回归测试

**方案对比**：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A（简单）** | highlight 直接返 SVG；全局 config 加 `svg:true` + `SANITIZE_NAMED_PROPS:false` | 改动小（highlight + 2 行 config） | 全局安全 config 回退（DOM clobbering 保护移除，影响**所有** markdown）；回归测试需改（foreignObject 放行）；SANITIZE_NAMED_PROPS:false 需安全论证 |
| **B+（推荐）** | highlight 返占位符 div；sanitizeMarkdown 后 `renderMermaidBlocks` 用**独立** DOMPurify config（`svg:true, SANITIZE_NAMED_PROPS:false, FORBID_TAGS:["foreignObject","script"]`）sanitize SVG | 不动全局 config（零回归风险）；独立 config 精确匹配 mermaid 安全需求；foreignObject 显式禁；defense-in-depth（mermaid strict + 独立 sanitize） | 多 ~50 行（mermaid.ts 模块）；mermaid 在 cache 命中时重渲染（技术债，见 §11） |

**选 B+ 的协议依据**：CLAUDE.md「Security First」+「以破坏架构为耻」。方案 A 为单个功能改动全局安全 config，违反安全门禁隔离原则；方案 B+ 把 mermaid 安全策略隔离到独立 sanitize config，不污染全局。

**方案 B+ 的独立 sanitize config**（session-ui/mermaid.ts）：

```ts
const mermaidSvgConfig = {
  USE_PROFILES: { svg: true },              // 放行 SVG 全系元素/属性
  SANITIZE_NAMED_PROPS: false,              // 保留 id/name，mermaid 内部 url(#id) 引用不断
  FORBID_TAGS: ["foreignObject", "script"], // 显式禁 foreignObject（XSS 向量）+ script
  FORBID_ATTR: ["onload", "onclick", "onerror"],  // 禁事件处理器
}
```

- `svg:true` 放行 `g/text/rect/circle/...` 全系，DOMPurify 仍剥 `<script>`/`javascript:`/事件处理器
- `SANITIZE_NAMED_PROPS:false` 保留 mermaid 内部引用（安全：mermaid `securityLevel:"strict"` 不产 clobbering 向量；SVG id 不覆盖 window 属性）
- `FORBID_TAGS:["foreignObject"]` 显式禁 foreignObject（mermaid strict 不用，禁了更安全）
- 全局 `afterSanitizeAttributes` hook（[markdown-cache.tsx:23-32](packages/session-ui/src/components/markdown-cache.tsx)，给 `target=_blank` 加 noopener）对 SVG 无影响（SVG 无此类锚点），复用安全

### 3.3 D3：占位符格式与 data 属性存活验证

**占位符**：`<div data-mermaid="<HTML 转义后的源码>"></div>`

- DOMPurify `USE_PROFILES:{html:true}` 放行 `<div>` + 所有 `data-*` 属性（DOMPurify 默认放行 data-*）
- `data-mermaid` 属性值经 HTML 转义（`&<>"'`），sanitizeMarkdown 不改 data-* 值
- 浏览器 DOM 解析自动反转义属性值：`element.getAttribute("data-mermaid")` 返回原始 mermaid 源码
- 占位符经全局 sanitizeMarkdown 存活 -> `renderMermaidBlocks` 找到 -> 渲染 SVG 替换

**转义实现**（packages/ui，marked context 内联，不新建工具函数--单处使用）：

```ts
function mermaidPlaceholder(code: string): string {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
  return `<div data-mermaid="${escaped}"></div>`
}
```

### 3.4 D4：work-orchestrator SYSTEM_PROMPT Mermaid 指引

在 [work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 "Produce the candidate" 后加通用 Mermaid 指引（不绑特定 preset）：

```
5. **Produce the candidate**: Write the full Markdown document as your assistant message body following the preset guidance. Do not write it to a file and do not call edit/write tools.

   **Use Mermaid diagrams when text alone is unclear** - flowchart for processes, sequenceDiagram for API interactions, gantt for timelines, mindmap for structure, pie/xychart for data, erDiagram for DB schema. Wrap diagrams in ```mermaid fenced code blocks. Only use a diagram when it genuinely clarifies; do not force diagrams into every document.
```

**通用指引**：教 LLM"文字表达不清时用 Mermaid"，不强制每文档加图表。不改其他步骤（Plan/Execute/Resume 保持 M1.5）。

### 3.5 D5：preset guidance Mermaid 示例

| preset | Mermaid 示例 | 理由 |
|---|---|---|
| PRD（write-prd） | 流程图（业务流程）+ 拓扑（依赖）+ 甘特（排期） | PRD 天然需流程/拓扑/排期图 |
| 文献综述（literature-review） | 思维导图（文献结构）+ 对比用原生表格（不加 mermaid） | 综述需结构图，对比用表格更清晰 |
| 视频分镜（storyboard-video） | **不加** | 双栏分镜表已够（M1 D1） |
| 行政公文（official-document） | **不加** | 公文是规范文字，图表无必要 |

**guidance 改造**（[work-preset.ts](packages/core/src/session/work-preset.ts)）：

PRD guidance（:30-31）末尾加：
```
涉及业务流程时用 ```mermaid flowchart TD 绘制；涉及需求依赖时用 graph 绘制拓扑；涉及排期时用 gantt。仅在文字表达不清时使用，不强制。
```

文献综述 guidance（:47-48）末尾加：
```
涉及文献结构时用 ```mermaid mindmap 绘制；文献对比用原生 Markdown 表格（不用 mermaid）。仅在文字表达不清时使用，不强制。
```

视频分镜/行政公文 guidance **不改**。

### 3.6 D6：流式 vs 非流式渲染时序

**核验**（[markdown-stream.ts:52-85](packages/session-ui/src/components/markdown-stream.ts)）：

| 阶段 | `live` | mermaid 块 mode | 路径 | 显示 |
|---|---|---|---|---|
| 流式中（消息未完成） | `true` | `mode:"code"`（[markdown-stream.ts:67-69](packages/session-ui/src/components/markdown-stream.ts)） | `code()` -> shiki worker（[markdown.tsx:327-341](packages/session-ui/src/components/markdown.tsx)），lang "mermaid" 回退 "text" | shiki 代码高亮（源码） |
| 流式完成/非流式 | `false` | `mode:"full"`（单块，[markdown-stream.ts:53](packages/session-ui/src/components/markdown-stream.ts)） | `marked.parse` -> markedShiki highlight 拦截 -> 占位符 -> sanitizeMarkdown -> renderMermaidBlocks -> SVG | **SVG 图表** |

**Work 面板**（[work-artifact-panel.tsx:187](packages/app/src/pages/work-artifact-panel.tsx)）`<Markdown text={candidate()!} />` 无 `streaming` prop -> `live=false` -> 始终走 SVG 路径。

**Chat 消息流**：流式中显示源码（shiki），消息完成后 `live` 转 `false` 整体重渲，mermaid 渲染为 SVG。**可接受**（对齐 GitHub/GitLab 行为：mermaid 仅在完整块后渲染）。

**决策**：不改流式管线（`code()`/shiki worker 不动）。mermaid 仅在非流式 `mode:"full"` 块经 marked.parse 时拦截渲染。

---

## 4. 关键设计

### 4.1 Mermaid 渲染流程（代码核验版）

```
work-orchestrator 生成候选稿（含 ```mermaid 代码块）
  -> findLatestAssistantMarkdown 提取候选稿（M1，不变）
  -> WorkArtifactContent <Markdown text={candidate()!} />（非流式，不变）
  -> project(prev, text, false) -> 单 mode:"full" 块（markdown-stream.ts:53）
  -> createResource async（markdown.tsx:305）:
       marked.parse(block.src)
         -> marked.lexer 分词（含 mermaid code token）
         -> markedShiki walkTokens: mermaid code token -> highlight(code, "mermaid")
              -> mermaidPlaceholder(code) -> <div data-mermaid="<escaped>"></div>
              -> code token 转 html token（text = 占位符 HTML）
         -> marked renderer 输出含占位符的 HTML
       sanitizeMarkdown(html)  // 全局 config，占位符 div + data-* 存活，SVG 元素会被剥但此时无 SVG
       renderMermaidBlocks(safeHtml)  // 新增：DOMParser 找 [data-mermaid] -> mermaid.render -> sanitizeMermaidSvg -> 替换占位符
       -> block.html = 含 SVG 的最终 HTML
  -> updateBlock: next.innerHTML = block.html（:485）+ decorate（:486，pre 加 copy 按钮，不影响 SVG）
  -> 右栏 Artifact Tab 显示含 SVG 图表的 Markdown
```

### 4.2 Mermaid 模块（session-ui/src/components/mermaid.ts，新增）

```ts
import DOMPurify from "dompurify"

let mermaidReady: Promise<typeof import("mermaid")> | undefined

/** 动态 import mermaid（~500KB，不进首屏包）+ initialize securityLevel=strict。 */
function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",            // 对齐 v2 token（Phase C 调优，见 §4.4）
        securityLevel: "strict",  // 禁 mermaid 内 HTML/script（defense-in-depth 第 1 层）
      })
      return m.default
    })
  }
  return mermaidReady
}

const mermaidSvgConfig = {
  USE_PROFILES: { svg: true },
  SANITIZE_NAMED_PROPS: false,               // 保留 id，不断 url(#id) 引用
  FORBID_TAGS: ["foreignObject", "script"],  // 显式禁 foreignObject + script
  FORBID_ATTR: ["onload", "onclick", "onerror"],
}

/** 独立 sanitize mermaid SVG（defense-in-depth 第 2 层，不动全局 config）。 */
function sanitizeMermaidSvg(svg: string): string {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, mermaidSvgConfig)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * 找 HTML 中 [data-mermaid] 占位符 -> mermaid.render -> 独立 sanitize -> 替换。
 * 无占位符时直接返回（零开销）。语法错误降级为 <pre><code> 源码（不崩）。
 */
export async function renderMermaidBlocks(html: string): Promise<string> {
  if (!html.includes("data-mermaid")) return html  // 快速跳过无 mermaid 的块
  const mermaid = await getMermaid()
  const doc = new DOMParser().parseFromString(html, "text/html")
  const placeholders = doc.querySelectorAll<HTMLDivElement>("[data-mermaid]")
  if (placeholders.length === 0) return html
  for (const el of placeholders) {
    const src = el.getAttribute("data-mermaid") ?? ""
    try {
      const id = `mermaid-${crypto.randomUUID()}`
      const { svg } = await mermaid.render(id, src)
      el.outerHTML = sanitizeMermaidSvg(svg)
    } catch (error) {
      console.error("[mermaid] render failed, fallback to source", error)
      el.outerHTML = `<pre><code class="language-mermaid">${escapeHtml(src)}</code></pre>`
    }
  }
  return doc.body.innerHTML
}
```

**要点**：
- `getMermaid` 动态 import + cached（mermaid.initialize 一次）
- `securityLevel: "strict"` defense-in-depth 第 1 层（mermaid 自身禁 HTML/script）
- `sanitizeMermaidSvg` 独立 config defense-in-depth 第 2 层（DOMPurify svg profile，foreignObject/script 显式禁）
- `renderMermaidBlocks` 用 DOMParser（非 regex）找占位符，浏览器自动反转义 `data-mermaid` 属性
- 语法错误降级 `<pre><code>` 源码（decorate 会给它加 copy 按钮，可复制源码重试）
- `crypto.randomUUID()` 生成唯一 render id（避免多图表 id 冲突）

### 4.3 markdown.tsx 接入（:343-354 重构）

现有代码（[markdown.tsx:343-354](packages/session-ui/src/components/markdown.tsx)）在非 code 块路径有 cache 命中早返回（:347）和未命中两条路径，都需接 `renderMermaidBlocks`。重构为统一出口：

```ts
// markdown.tsx 非代码块路径（原 :343-354）
const hash = checksum(block.raw)
let html: string
const cached = key ? getCachedMarkdown(key) : undefined
if (cached?.raw === block.raw) {
  touchCachedMarkdown(key!, cached)
  html = cached.html  // cache 存的是含占位符的 sanitized HTML
} else {
  html = sanitizeMarkdown(await Promise.resolve(marked.parse(block.src)))
  if (key && hash) touchCachedMarkdown(key, { raw: block.raw, hash, html })
}
const finalHtml = await renderMermaidBlocks(html)  // 新增：占位符 -> SVG（cache 命中/未命中都跑）
return { key: blockKey, mode: block.mode, raw: block.raw, hash: hash ?? "", html: finalHtml }
```

**cache 策略**：cache 存 sanitized 含占位符 HTML（`html`），不存 SVG（`finalHtml`）。`renderMermaidBlocks` 每次跑（cache 命中也跑）。理由：SVG 经独立 sanitize，不宜入全局 markdown cache（混入两套 sanitize 语义）。技术债：mermaid 在 cache 命中时重渲染（见 §11）。

**`renderMermaidBlocks` 性能**：无 `data-mermaid` 时 `html.includes("data-mermaid")` 快速跳过（零 DOMParser 开销），非 mermaid 块无影响。

### 4.4 Mermaid 主题对齐 v2 token（Phase C）

[frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md) 要求新 UI 用 `--v2-*` token。mermaid `theme: "base"` 支持 `themeVariables` 自定义配色。Phase C 调优：

```ts
m.default.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    // 从 CSS 变量读值（getComputedStyle），映射 mermaid themeVariables
    primaryColor: "var(--v2-background-bg-accent)",   // 节点填充
    primaryTextColor: "var(--v2-text-text-base)",      // 节点文字
    primaryBorderColor: "var(--v2-border-border-base)", // 节点边框
    lineColor: "var(--v2-text-text-muted)",             // 连线
    background: "var(--v2-background-bg-base)",         // 画布背景
    // ... 其余 mermaid themeVariables
  },
  securityLevel: "strict",
})
```

**注意**：mermaid themeVariables 接受 CSS var 字符串（SVG fill 属性支持 `var()`，浏览器解析）。Phase C 需验证 light/dark 切换时 mermaid 重新 initialize（主题切换需重新 render 已渲染图表--技术债见 §11）。

### 4.5 SYSTEM_PROMPT 改造（work-orchestrator.ts）

见 §3.4 D4。步骤5 Produce 加 Mermaid 通用指引段落。不改 Plan/Execute/Resume 步骤。

### 4.6 不改的链路（复用验证点）

- **候选稿载体**（[work-artifact-extract.ts:7](packages/app/src/pages/work-artifact-extract.ts)）：findLatestAssistantMarkdown 不变，mermaid 代码块是消息正文一部分自然提取
- **落盘**（[work-artifact-panel.tsx:103-158](packages/app/src/pages/work-artifact-panel.tsx)）：apply 写候选稿全文（含 mermaid 源码）到 .md 文件，不变
- **存为资产**（[work-asset-capture.ts](packages/app/src/pages/work-asset-capture.ts)）：captureWorkArtifactAsCandidate 映射候选稿为 prompt 资产 template，mermaid 源码自然携带，不变
- **全局 DOMPurify config**（[markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx)）：方案 B+ 不改，sanitize-regression.test.tsx 不改
- **流式渲染管线**（[markdown.tsx:327-341](packages/session-ui/src/components/markdown.tsx) code 路径 + markdown-stream.ts）：不变，mermaid 仅非流式拦截
- **CSP**（[ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)）：mermaid SVG 无 script，不触发

---

## 5. 阶段划分（TDD：红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。对齐 [M1 TDD 手册](work-mode-m1-tdd-prompt.md) §5 范式。

### Phase A - Mermaid 渲染集成（估时 1.5d）

| 步骤 | 内容 |
|---|---|
| **红** | 新建 `packages/session-ui/src/components/mermaid.test.ts`（`it.live`，真实 async + happy-dom DOM）：① `renderMermaidBlocks` 对含 `<div data-mermaid="graph TD; A-->B">` 的 HTML -> 输出含 `<svg>` 且**保留 `url(#` 内部引用**（箭头标记不丢）；② 非占位符 HTML 原样返回（`includes` 快速跳过）；③ mermaid 语法错误（如 `graph TD; A->>B->>A` 循环或非法语法）-> 降级 `<pre><code class="language-mermaid">` 不崩；④ `sanitizeMermaidSvg` 剥 `<script>` 和 `<foreignObject>` 但保留 `<g>/<text>/<rect>/<path>` + `id` 属性。新建 `packages/ui/src/context/marked.test.ts`（或扩展现有）：`mermaidPlaceholder("graph TD")` 返回 `<div data-mermaid="graph TD">`（转义验证：含 `"` `<` 的源码正确转义） |
| **绿** | `bun add mermaid` in session-ui；新建 `mermaid.ts`（getMermaid + renderMermaidBlocks + sanitizeMermaidSvg + escapeHtml，§4.2）；marked.tsx highlight 加 `if (lang === "mermaid") return mermaidPlaceholder(code)`（§3.1）+ 内联 `mermaidPlaceholder`；markdown.tsx :343-354 重构接 `renderMermaidBlocks`（§4.3） |
| **重构** | 确认 `getMermaid` cached（initialize 一次）；`renderMermaidBlocks` 无 mermaid 时零开销跳过；`mermaidPlaceholder` 转义完整（`&<>"'`）；marked.tsx 的 `mermaidPlaceholder` 与 mermaid.ts 的 `escapeHtml` 若逻辑同则提取共享 helper（跨包：放 session-ui mermaid.ts 导出，ui 包 import--评估依赖方向后定，可能 ui 内联更合理避免 ui 反向依赖 session-ui） |
| **退出** | `bun --cwd packages/session-ui test --timeout 30000` 绿；`bun --cwd packages/session-ui typecheck` 绿；`bun --cwd packages/ui typecheck` 绿；mermaid 代码块经全链路渲染为 SVG 且内部引用保留 |

### Phase B - SYSTEM_PROMPT + preset guidance（估时 0.5d）

| 步骤 | 内容 |
|---|---|
| **红** | 扩展 [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts)：SYSTEM_PROMPT 含 "Mermaid" + "```mermaid" + "when text alone is unclear"（对齐现有 string-contains 断言范式）。扩展 [work-preset.test.ts](packages/core/test/work-preset.test.ts)：write-prd guidance 含 mermaid + flowchart；literature-review guidance 含 mermaid + mindmap；storyboard-video guidance 不含 mermaid；official-document guidance 不含 mermaid |
| **绿** | work-orchestrator.ts 步骤5 加 Mermaid 指引（§3.4 D4）；work-preset.ts PRD/文献综述 guidance 加 Mermaid 示例（§3.5 D5）；视频分镜/行政公文不改 |
| **重构** | SYSTEM_PROMPT Mermaid 指引通用（不绑 preset）；guidance 示例精准（PRD 流程/拓扑/甘特，文献 mindmap） |
| **退出** | `bun --cwd packages/core test --timeout 30000` 绿；`bun --cwd packages/core typecheck` 绿；prompt 结构 + guidance 内容测试通过 |

### Phase C - 端到端 + 主题对齐 + 打磨（估时 1d）

| 步骤 | 内容 |
|---|---|
| **红** | 扩展 `packages/app/e2e/`（Playwright，现有 regression/smoke 目录）spec：Work 选 write-prd 预设 -> 生成候选稿含 ```mermaid 代码块 -> 右栏 Artifact Tab 渲染 `<svg>`（`toBeVisible` 或 `toBeAttached`）；文献综述同理；视频分镜候选稿不含 mermaid（无 `<svg>` from mermaid）。新建 session-ui 集成测试：完整 Markdown（含 mermaid + 普通代码块 + 表格）经 Markdown 组件渲染 -> mermaid 块出 SVG，普通代码块仍 shiki 高亮 |
| **绿** | 端到端联调；修 mermaid.render 时序（async createResource）、动态 import、主题对齐 v2 token（§4.4）；i18n 补图表加载/错误提示（若需，en/zh/zht parity） |
| **重构** | mermaid 动态 import 不阻塞首屏（getMermaid cached + 仅 mermaid 块时触发）；主题对齐 v2 token（`--v2-background-bg-base` 等，frontend-theming skill）；M1 候选稿载体/落盘/M2 存为资产无回归验证 |
| **退出** | 端到端通过；`tsgo -b`（app）+ `tsgo --noEmit`（core/session-ui/ui）+ `bun run lint` + 全包 test 绿；改完即审 7 步 |

---

## 6. 关键文件

| 文件 | 动作 | 说明 |
|---|---|---|
| [session-ui/package.json](packages/session-ui/package.json) | 修改 | 新增 `mermaid` 依赖 |
| `packages/session-ui/src/components/mermaid.ts` | 新增 | getMermaid（动态 import + initialize strict）+ renderMermaidBlocks（DOMParser + render + 独立 sanitize）+ sanitizeMermaidSvg + escapeHtml |
| `packages/session-ui/src/components/mermaid.test.ts` | 新增 | Mermaid 渲染单测（TDD 红测试，it.live 真实 async + DOM） |
| [markdown.tsx](packages/session-ui/src/components/markdown.tsx) | 修改 | :343-354 重构：sanitizeMarkdown 后统一 `await renderMermaidBlocks(html)`（cache 命中/未命中两路径） |
| [marked.tsx](packages/ui/src/context/marked.tsx) | 修改 | :488 highlight 加 `if (lang === "mermaid") return mermaidPlaceholder(code)` + 内联 mermaidPlaceholder（不引 mermaid 库） |
| [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改 | :23 步骤5 Produce 加 Mermaid 通用指引 |
| [work-preset.ts](packages/core/src/session/work-preset.ts) | 修改 | PRD/文献综述 guidance 加 Mermaid 示例 |
| [en.ts](packages/app/src/i18n/en.ts) + [zh.ts](packages/app/src/i18n/zh.ts) + [zht.ts](packages/app/src/i18n/zht.ts) | 修改（可选） | 图表加载/错误降级提示文案（若需，parity.test.ts 约束三 locale） |

**不改的文件**（复用 + 验证）：
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx)（全局 DOMPurify config，方案 B+ 不改；sanitize-regression.test.tsx 不改）
- [markdown-stream.ts](packages/session-ui/src/components/markdown-stream.ts)（流分块，不改）
- [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)（M1/M2 候选预览 + 落盘 + 存为资产，不变）
- [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts)（候选提取，不变）
- [work-asset-capture.ts](packages/app/src/pages/work-asset-capture.ts)（M2 资产映射，不变）
- [artifact.ts](packages/core/src/session/artifact.ts)（WorkArtifact Service，不变）
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts)（CSP，mermaid SVG 不触发）

---

## 7. 测试策略

### 7.1 新建测试

| 测试文件 | 覆盖 |
|---|---|
| `packages/session-ui/src/components/mermaid.test.ts` | `renderMermaidBlocks`：① 含 `data-mermaid` 占位符 -> SVG（含 `<svg>`，保留 `url(#` 引用）；② 无占位符原样返回（`includes` 跳过）；③ 语法错误降级 `<pre><code>`；④ `sanitizeMermaidSvg` 剥 script/foreignObject，保留 g/text/rect/path + id。用 `it.live`（真实 async + happy-dom DOM，mermaid.render 是 async） |
| `packages/app/e2e/` spec | Work 选 write-prd -> 候选含 mermaid -> 右栏渲染 `<svg>`；视频分镜不含 mermaid |

### 7.2 扩展现有测试

| 现有测试 | 扩展 |
|---|---|
| [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts) | SYSTEM_PROMPT 含 "Mermaid" + "```mermaid" + "when text alone is unclear"（string-contains 范式） |
| [work-preset.test.ts](packages/core/test/work-preset.test.ts) | write-prd guidance 含 mermaid/flowchart；literature-review 含 mermaid/mindmap；storyboard-video/official-document 不含 mermaid |
| [sanitize-regression.test.tsx](packages/session-ui/src/components/sanitize-regression.test.tsx) | **不改**（方案 B+ 不动全局 config，回归测试全保留；新增 mermaid SVG sanitize 测试在 mermaid.test.ts 用独立 config） |

### 7.3 命令（CLAUDE.md / AGENTS.md 测试规范，永不从根跑）

```bash
bun --cwd packages/session-ui test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/ui test --timeout 30000    # 若新增 marked.test.ts
bun --cwd packages/app test
bun --cwd packages/session-ui typecheck       # tsgo --noEmit
bun --cwd packages/core typecheck
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck              # tsgo -b
bun run lint
```

### 7.4 硬性规则

- `mermaid.render` 是 async，测试用 `it.live`（真实 async + happy-dom DOM，[AigcForge testing gotchas](../../home/keer/.claude/projects/-media-keer----aigcfroge/memory/aigcfroge-testing-and-effect-gotchas.md)：it.effect 用 Test Clock 会挂起并发 drain）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际渲染输出（SVG 元素存在 + 内部引用保留），**不 mock mermaid**（AGENTS.md「Avoid mocks」）
- 禁止 `Effect.sleep(N)` 等待（不适用此处，mermaid.render 用 await）
- happy-dom 20.11.1 支持 DOMParser + crypto.randomUUID（[bunfig.toml](packages/session-ui/bunfig.toml) preload happy-dom-setup.ts）

---

## 8. 验收清单

- [ ] `bun add mermaid` 装入 session-ui（动态 import，不进首屏包）
- [ ] marked.tsx highlight 拦截 `lang === "mermaid"` -> 占位符 div（mermaid 语言信息不丢）
- [ ] `renderMermaidBlocks` 找占位符 -> mermaid.render -> SVG（flowchart/sequence/gantt/pie 至少 4 种）
- [ ] Mermaid SVG **内部 `url(#id)` 引用保留**（箭头标记/渐变不丢，SANITIZE_NAMED_PROPS:false 验证）
- [ ] 非 mermaid 代码块仍渲染为 shiki 高亮 `<pre><code>`（不被拦截）
- [ ] Mermaid 语法错误时降级显示原代码块 `<pre><code>`（不崩，decorate 加 copy 按钮）
- [ ] `sanitizeMermaidSvg` 剥 `<script>` + `<foreignObject>`，保留 `g/text/rect/circle/path` + `id` 属性
- [ ] 全局 DOMPurify config（markdown-cache.tsx）**未改**，sanitize-regression.test.tsx 全绿
- [ ] Mermaid 动态 import 不阻塞首屏（getMermaid cached + 仅 mermaid 块时触发）
- [ ] mermaid.initialize `securityLevel: "strict"`（defense-in-depth 第 1 层）
- [ ] work-orchestrator SYSTEM_PROMPT 含 Mermaid 通用指引（步骤5 Produce）
- [ ] PRD preset guidance 含 Mermaid 示例（流程/拓扑/甘特）
- [ ] 文献综述 preset guidance 含 Mermaid 示例（mindmap）
- [ ] 视频分镜/行政公文 guidance 不含 Mermaid
- [ ] Work 选 write-prd -> 候选含 Mermaid -> 右栏渲染 SVG（E2E）
- [ ] M1 候选稿载体/落盘/M2 存为资产链路无回归
- [ ] 流式中 mermaid 显示为代码，完成后渲染 SVG（D6 时序验证）
- [ ] typecheck（tsgo -b app + tsgo --noEmit core/session-ui/ui）+ lint + test 全绿

---

## 9. 估算

| Phase | 估时 |
|---|---|
| A Mermaid 渲染集成（marked.tsx 拦截 + mermaid.ts 模块 + markdown.tsx 接入 + 测试） | 1.5d |
| B SYSTEM_PROMPT + guidance | 0.5d |
| C 端到端 + 主题对齐 + 打磨 | 1d |
| **总计** | **3d** |

（M1.5 7.5d / M2 6.5d；M3 L1 复用 M1-M2 链路 + Mermaid 标准库，范围最小。方案 B+ 比初稿方案 A 多 ~0.5d（独立 sanitize 模块），但消除全局安全 config 风险）

---

## 10. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| mermaid.render async 与 createResource 时序冲突（block.html 返回前 SVG 未就绪） | 低 | 中 | renderMermaidBlocks 在 createResource async 内 await（markdown.tsx:352 已是 async），SVG 就绪后才返回 block.html |
| DOMPurify 独立 config 的 `svg:true` 仍剥某些 mermaid 元素/属性 | 低 | 中 | Phase A TDD 测试验证 SVG 结构（g/text/rect/path + id）；若被剥扩展 mermaidSvgConfig 的 ADD_TAGS/ADD_ATTR |
| mermaid 库 ~500KB 增大包体 | 中 | 低 | 动态 import（getMermaid 仅 mermaid 块时触发，不进首屏包） |
| LLM 过度使用 Mermaid（每文档都加图表） | 中 | 低 | SYSTEM_PROMPT 强约束"仅在文字表达不清时用"；guidance 示例精准 + "不强制" |
| Mermaid 主题与 v2 token 不一致（light/dark 切换后图表不更新） | 中 | 中 | Phase C themeVariables 映射 v2 token；技术债：主题切换需重新 render 已渲染图表（§11） |
| 视频分镜/行政公文 LLM 误加 Mermaid | 低 | 低 | guidance 不提 Mermaid；SYSTEM_PROMPT"按 preset guidance"约束 |
| mermaid.render 生成重复 id 冲突（多图表同页） | 低 | 低 | `crypto.randomUUID()` 生成唯一 render id |
| cache 命中时 mermaid 重渲染（性能） | 中 | 低 | `html.includes("data-mermaid")` 快速跳过无 mermaid 块；mermaid 块通常少；技术债见 §11 |
| packages/ui 的 mermaidPlaceholder 与 session-ui 的 escapeHtml 逻辑重复 | 中 | 低 | Phase A 重构时评估：若 ui 内联更合理（避免 ui 反向依赖 session-ui）则各自内联；若可共享则提取 |

---

## 11. 技术债声明

| 负债 | 风险 | 到期 |
|---|---|---|
| L2 独立 HTML 图表延后 M3.5 | 汇报场景（团队全景/数据大屏）暂不支持 | 待产品确认 + CSP 评审后立项 M3.5 |
| Mermaid 主题用 `theme:"base"` + themeVariables 映射 v2 token（非精确） | 图表配色与 v2 token 可能略有差异；light/dark 切换后已渲染图表不自动更新 | Phase C 调优；后续主题切换时重新 render（需 mermaid 实例 reset + 重渲染可见图表） |
| Mermaid SVG 不入 markdown cache（renderMermaidBlocks 每次跑） | cache 命中时 mermaid 重渲染（多图表消息略慢） | 可接受（mermaid 块通常少；后续可加 mermaid SVG 结果缓存，key=源码 hash） |
| mermaidPlaceholder 在 packages/ui 内联（未与 session-ui escapeHtml 归并） | 转义逻辑两处 | Phase A 重构评估；若 ui 不能反向依赖 session-ui 则接受内联 |
| 流式中 mermaid 显示为 shiki 代码（非 SVG） | 用户流式中看到源码而非图表 | 可接受（对齐 GitHub/GitLab；完成即渲染 SVG） |

---

## 12. 关联文档

- [M3 调研报告](work-mode-m3-research.md) - L1/L2 分层决策（范围真源）
- [Work 路线图](work-mode-roadmap.md) - §3.5 M3（L1）+ §3.6 M3.5（L2 远期）
- [Work M1 计划](work-mode-execution-layer-m1.md) - 候选稿载体 D1
- [Work M1.5 计划](work-mode-execution-layer-m1.5.md) - SYSTEM_PROMPT 步骤化
- [Work M2 计划](work-mode-execution-layer-m2.md) - 存为资产链路
- [M1 TDD 手册](work-mode-m1-tdd-prompt.md) - TDD 红绿重构范式
- [frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md) - v2 token 对齐（Phase C 主题）
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) - 全局 DOMPurify config（方案 B+ 不改）
- [sanitize-regression.test.tsx](packages/session-ui/src/components/sanitize-regression.test.tsx) - sanitize 回归测试（全保留）
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
