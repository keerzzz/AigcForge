# Work 模式 M3 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work M3。
> **来源**：[M3 实施计划](work-mode-execution-layer-m3.md)（Approved，代码核验修订版）、[M3 调研报告](work-mode-m3-research.md)、[Work 路线图](work-mode-roadmap.md)、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)、[frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md)
> **分支**：`work-m3`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 模式 M3：Mermaid 内嵌图表（L1）](docs/plan/work-mode-execution-layer-m3.md)（Approved）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

**⚠️ 本计划有初稿技术误判已被代码核验纠正（计划 §0.1）。你必须严格遵守本提示词 §2 的定案决策，不得回退到初稿的"marked renderer"或"inline SVG + 全局 svg profile"方案。**

---

## 0. 你的任务（一句话）

让 Work 候选稿（Markdown 消息正文）支持 Mermaid 图表内嵌：LLM 写 ` ```mermaid ` 代码块，右栏 Artifact Tab 只读预览渲染为 SVG。通过 marked-shiki `highlight` 回调拦截 mermaid 语言 -> 输出占位符 div -> 全局 sanitize 后用独立 DOMPurify config 渲染+sanitize SVG（不动全局 config）。

## 1. 范围与禁区

### 1.1 范围（M3 只做这些）
- marked.tsx `highlight` 回调加 mermaid 拦截 -> 返占位符 div（packages/ui，不引 mermaid 库）
- 新建 session-ui `mermaid.ts`：getMermaid（动态 import + initialize strict）+ renderMermaidBlocks（DOMParser 找占位符 -> render -> 独立 sanitize -> 替换）+ sanitizeMermaidSvg
- markdown.tsx 接入 renderMermaidBlocks（sanitizeMarkdown 后统一跑）
- work-orchestrator SYSTEM_PROMPT 步骤5 加 Mermaid 通用指引
- work-preset PRD/文献综述 guidance 加 Mermaid 示例（视频分镜/行政公文不加）
- i18n（en/zh/zht，若需图表加载/错误降级提示）

### 1.2 禁区（违反即返工，绝对不做）
- ❌ **不用 marked 自定义 code renderer 拦截 mermaid**--marked-shiki `walkTokens` 在 marked renderer 之前把 code token 转 html token（[marked-shiki/dist/index.js:5-15](../../node_modules/marked-shiki/dist/index.js)），renderer 永远看不到 mermaid token。拦截点只能是 `highlight(code, lang)` 回调（[marked.tsx:488](packages/ui/src/context/marked.tsx)）
- ❌ **不动全局 DOMPurify config**（[markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx)）--方案 B+ 用独立 sanitize config，全局 config 改了会破坏 sanitize-regression.test.tsx + 影响所有 markdown
- ❌ **不用 inline SVG 经全局 sanitizeMarkdown**--全局 config 无 svg profile（仅 ADD_TAGS svg+path）会剥 Mermaid SVG 绝大部分元素；`SANITIZE_NAMED_PROPS:true` 打断 `url(#id)` 引用
- ❌ 不改 sanitize-regression.test.tsx（方案 B+ 不动全局 config，回归测试全保留）
- ❌ 不改 M1 候选稿载体/落盘模型（候选稿=assistant 消息正文，[work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts) 不变）
- ❌ 不改 M2 存为资产链路（[work-asset-capture.ts](packages/app/src/pages/work-asset-capture.ts) 不变，mermaid 源码作为 template 自然携带）
- ❌ 不改流式渲染管线（`code()`/shiki worker/markdown-stream.ts 不动，mermaid 仅非流式拦截，见 D6）
- ❌ 不做独立 HTML 图表 / Chart.js/Vis.js/ECharts / iframe sandbox / CSP 评审（那是 M3.5 L2）
- ❌ 不新建 Service/HTTP/数据库 migration
- ❌ 不给所有 preset 强加 Mermaid（视频分镜/行政公文不加）
- ❌ 不在 packages/ui 引入 mermaid 库依赖（占位符是纯字符串，渲染在 session-ui）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 拦截点 = marked-shiki `highlight` 回调（非 marked renderer）
- marked-shiki v1.2.1 `walkTokens`：调 `highlight(code, lang, langArgs)`，返回值 `r` 作 raw HTML（无 container 时 `o=r`），code token -> html token `text:o`（[marked-shiki/dist/index.js:8-14](../../node_modules/marked-shiki/dist/index.js)）
- marked renderer 永远看不到 mermaid code token（已被 walkTokens 转 html token）
- 拦截在 [marked.tsx:488](packages/ui/src/context/marked.tsx) `async highlight(code, lang)` 开头，在 `if (!(lang in bundledLanguages)) lang = "text"`（:494）回退**之前**--否则 "mermaid" 语言信息丢失
- `mermaidPlaceholder(code)` 返 `<div data-mermaid="<HTML 转义源码>"></div>`，packages/ui 不引 mermaid 库

### 2.2 D2 SVG 安全 = 方案 B+（占位符 + 后渲染 + 独立 sanitize）
- highlight 返占位符 div（packages/ui）-> 全局 sanitizeMarkdown 保留 div + data-*（DOMPurify html profile 默认放行 data-*）-> `renderMermaidBlocks`（session-ui）找 `[data-mermaid]` -> `mermaid.render` -> `sanitizeMermaidSvg`（独立 config）-> 替换占位符
- **独立 sanitize config**：`{ USE_PROFILES: { svg: true }, SANITIZE_NAMED_PROPS: false, FORBID_TAGS: ["foreignObject", "script"], FORBID_ATTR: ["onload","onclick","onerror"] }`
  - `svg:true` 放行 g/text/rect/circle/path/defs/marker/tspan 全系，DOMPurify 仍剥 script/javascript:/事件处理器
  - `SANITIZE_NAMED_PROPS:false` 保留 id，不断 `url(#id)` 引用（箭头标记/渐变）
  - `FORBID_TAGS:["foreignObject"]` 显式禁 foreignObject（XSS 向量，mermaid strict 不用）
- defense-in-depth：mermaid `securityLevel:"strict"`（第 1 层）+ 独立 DOMPurify sanitize（第 2 层）
- 全局 `afterSanitizeAttributes` hook（[markdown-cache.tsx:23-32](packages/session-ui/src/components/markdown-cache.tsx)，给 target=_blank 加 noopener）对 SVG 无影响，复用安全

### 2.3 D3 占位符格式
- `<div data-mermaid="<HTML 转义源码>"></div>`，转义 `&<>"'`
- 浏览器 DOM 解析自动反转义：`element.getAttribute("data-mermaid")` 返回原始 mermaid 源码
- 全局 sanitizeMarkdown 不改 data-* 值，占位符存活到 renderMermaidBlocks

### 2.4 D4 SYSTEM_PROMPT Mermaid 指引（步骤5 Produce，通用不绑 preset）
- [work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 后加："Use Mermaid diagrams when text alone is unclear - flowchart for processes, sequenceDiagram for API interactions, gantt for timelines, mindmap for structure, pie/xychart for data, erDiagram for DB schema. Wrap in ```mermaid fenced code blocks. Only use a diagram when it genuinely clarifies; do not force diagrams into every document."
- 不改 Plan/Execute/Resume 步骤（保持 M1.5）

### 2.5 D5 preset guidance Mermaid 示例
- PRD（write-prd, [work-preset.ts:30-31](packages/core/src/session/work-preset.ts)）guidance 末尾加：流程 flowchart TD / 依赖 graph / 排期 gantt，"仅在文字表达不清时使用，不强制"
- 文献综述（literature-review, :47-48）guidance 末尾加：结构 mindmap，对比用原生表格，"仅在文字表达不清时使用，不强制"
- 视频分镜（storyboard-video）/ 行政公文（official-document）guidance **不改**

### 2.6 D6 流式 vs 非流式时序（不改流式管线）
- Work 面板 `<Markdown text={candidate()!} />`（[work-artifact-panel.tsx:187](packages/app/src/pages/work-artifact-panel.tsx)）无 streaming prop -> `live=false`
- `live=false`：`stream(text, false)` 返回单 `mode:"full"` 块（[markdown-stream.ts:53](packages/session-ui/src/components/markdown-stream.ts)），marked.parse 处理全文含 mermaid -> markedShiki highlight 拦截 -> 占位符 -> sanitize -> renderMermaidBlocks -> SVG
- `live=true`（流式中）：mermaid 块 `mode:"code"`（[markdown-stream.ts:67-69](packages/session-ui/src/components/markdown-stream.ts)）走 shiki worker（[markdown.tsx:327-341](packages/session-ui/src/components/markdown.tsx)），lang 回退 "text" -> 显示源码；消息完成后 live 转 false 整体重渲 -> SVG
- **可接受**（对齐 GitHub/GitLab：mermaid 仅完整块后渲染）

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| **marked-shiki walkTokens 行为** | `node_modules/marked-shiki/dist/index.js:5-15` | **必读**：highlight 返回值 = 代码块最终 HTML（无 `<pre><code>` 包裹），code token -> html token。证明拦截点在 highlight 不在 renderer |
| **highlight 拦截点** | `packages/ui/src/context/marked.tsx:488` | 改：`async highlight(code, lang)` 开头加 `if (lang === "mermaid") return mermaidPlaceholder(code)`（:494 lang 回退 text 之前） |
| MarkedProvider（JS 路径） | `packages/ui/src/context/marked.tsx:471-522` + `packages/app/src/app.tsx:359` | `<MarkedProvider>` 无 nativeParser -> JS parser 路径（marked.use + markedShiki） |
| **markdown.tsx 接入点** | `packages/session-ui/src/components/markdown.tsx:343-354` | 改：非 code 块路径，sanitizeMarkdown 后统一 `await renderMermaidBlocks(html)`（cache 命中/未命中两路径，见 §4.3） |
| sanitizeMarkdown 调用 | `packages/session-ui/src/components/markdown.tsx:352` | `sanitizeMarkdown(await Promise.resolve(marked.parse(block.src)))`--marked.parse 已含 markedShiki walkTokens（占位符在此产生） |
| **全局 DOMPurify config（不改）** | `packages/session-ui/src/components/markdown-cache.tsx:13-20` | **禁改**：无 svg profile + SANITIZE_NAMED_PROPS:true + ADD_TAGS 仅 svg+path。方案 B+ 绕开 |
| sanitize-regression 测试（不改） | `packages/session-ui/src/components/sanitize-regression.test.tsx:11-14` | **禁改**：显式断言 foreignObject 被剥。方案 B+ 不动全局 config，此测试全保留 |
| preloadMarkdown 跳过 code | `packages/session-ui/src/components/markdown-cache.tsx:62` | 不改：`if (block.mode === "code") return`；非流式无 code 块（全 "full"），preloadMarkdown 处理全文含 mermaid 占位符 |
| 流分块（不改） | `packages/session-ui/src/components/markdown-stream.ts:52-110` | 不改：`live=false` 单 "full" 块（:53）；`live=true` code 分离（:67-69） |
| updateBlock innerHTML + decorate | `packages/session-ui/src/components/markdown.tsx:485-486` | 不改：`next.innerHTML = block.html`（含 SVG）后 `decorate()`（pre 加 copy 按钮，不影响 SVG） |
| Work 面板（不改） | `packages/app/src/pages/work-artifact-panel.tsx:187` | 不改：`<Markdown text={candidate()!} />` 非流式 |
| work-orchestrator SYSTEM_PROMPT | `packages/core/src/agent/prompt/work-orchestrator.ts:23` | 改：步骤5 Produce 加 Mermaid 通用指引 |
| work-preset 4 预设 | `packages/core/src/session/work-preset.ts:5-75` | 改：PRD（:30-31）/文献综述（:47-48）guidance 加 Mermaid 示例；视频分镜/行政公文不改 |
| CSP（不改） | `packages/aigcfroge/src/server/shared/ui.ts:12` | 不改：`script-src 'self' 'wasm-unsafe-eval'`，mermaid SVG 无 script 不触发 |
| work-orchestrator 测试 | `packages/core/test/work-orchestrator.test.ts` | 扩展：SYSTEM_PROMPT 含 Mermaid 指引（string-contains 范式） |
| work-preset 测试 | `packages/core/test/work-preset.test.ts` | 扩展：PRD/文献综述 guidance 含 mermaid；视频分镜/行政公文不含 |
| i18n parity | `packages/app/src/i18n/parity.test.ts` | 约束 en/zh/zht 三 locale |
| session-ui 测试环境 | `packages/session-ui/bunfig.toml` + `happy-dom-setup.ts` | happy-dom 20.11.1（GlobalRegistrator）；支持 DOMParser + crypto.randomUUID |
| 现有 session-ui 测试范式 | `packages/session-ui/src/components/sanitize-regression.test.tsx` | 参考：DOMPurify sanitize 测试写法 |

## 4. 修改文件清单

```
packages/session-ui/package.json                           修改：新增 mermaid 依赖
packages/session-ui/src/components/mermaid.ts               新增：getMermaid + renderMermaidBlocks + sanitizeMermaidSvg + escapeHtml
packages/session-ui/src/components/mermaid.test.ts          新增：Mermaid 渲染单测（TDD 红测试，it.live）
packages/session-ui/src/components/markdown.tsx             修改：:343-354 重构接 renderMermaidBlocks
packages/ui/src/context/marked.tsx                         修改：:488 highlight 加 mermaid 拦截 + 内联 mermaidPlaceholder
packages/core/src/agent/prompt/work-orchestrator.ts        修改：:23 步骤5 加 Mermaid 指引
packages/core/src/session/work-preset.ts                   修改：PRD/文献综述 guidance 加 Mermaid 示例
packages/app/src/i18n/en.ts + zh.ts + zht.ts               修改（可选）：图表加载/错误降级提示文案
```

**不改的文件**：markdown-cache.tsx（全局 config）/ sanitize-regression.test.tsx / markdown-stream.ts / work-artifact-panel.tsx / work-artifact-extract.ts / work-asset-capture.ts / artifact.ts / ui.ts / flag.ts。

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase A - Mermaid 渲染集成（1.5d）

1. **红**：
   - 新建 `packages/session-ui/src/components/mermaid.test.ts`（`it.live`，真实 async + happy-dom DOM）：
     - `renderMermaidBlocks` 对含 `<div data-mermaid="graph TD; A-->B">` 的 HTML -> 输出含 `<svg>` 且**保留 `url(#` 内部引用**（箭头标记不丢，验证 SANITIZE_NAMED_PROPS:false 生效）
     - flowchart/sequenceDiagram/gantt/pie 至少 4 种 mermaid 类型均渲染出 `<svg>`
     - 非占位符 HTML 原样返回（`html.includes("data-mermaid")` 快速跳过，零 DOMParser 开销）
     - mermaid 语法错误（非法语法）-> 降级 `<pre><code class="language-mermaid">` 不崩
     - `sanitizeMermaidSvg` 剥 `<script>` 和 `<foreignObject>`，保留 `<g>/<text>/<rect>/<path>` + `id` 属性
   - marked.tsx 的 `mermaidPlaceholder` 单测（可放 ui 包测试或 session-ui）：含 `"` `<` `&` 的源码正确转义进 `data-mermaid`
2. **绿**：
   - `bun add mermaid` in session-ui
   - 新建 `packages/session-ui/src/components/mermaid.ts`（§5.1 代码）
   - [marked.tsx:488](packages/ui/src/context/marked.tsx) highlight 加 `if (lang === "mermaid") return mermaidPlaceholder(code)` + 内联 `mermaidPlaceholder`（不引 mermaid 库）
   - [markdown.tsx:343-354](packages/session-ui/src/components/markdown.tsx) 重构接 `renderMermaidBlocks`（§5.2 代码）
3. **重构**：
   - `getMermaid` cached（mermaid.initialize 一次）
   - `renderMermaidBlocks` 无 mermaid 时 `includes` 快速跳过
   - `mermaidPlaceholder`（ui）与 `escapeHtml`（session-ui mermaid.ts）若逻辑同：评估依赖方向。**packages/ui 不能反向依赖 session-ui**（ui 是底层包），故 ui 内联 `mermaidPlaceholder`、session-ui 内联 `escapeHtml`，接受两处重复（技术债见计划 §11）
4. **退出**：`bun --cwd packages/session-ui test --timeout 30000` 绿；`bun --cwd packages/session-ui typecheck` 绿；`bun --cwd packages/ui typecheck` 绿；mermaid 代码块经全链路渲染为 SVG 且内部引用保留

### Phase B - SYSTEM_PROMPT + preset guidance（0.5d）

1. **红**：
   - 扩展 [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts)：SYSTEM_PROMPT 含 "Mermaid" + "```mermaid" + "when text alone is unclear"（对齐现有 string-contains 范式）
   - 扩展 [work-preset.test.ts](packages/core/test/work-preset.test.ts)：write-prd guidance 含 "mermaid" + "flowchart"；literature-review guidance 含 "mermaid" + "mindmap"；storyboard-video guidance 不含 "mermaid"；official-document guidance 不含 "mermaid"
2. **绿**：
   - [work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 加 Mermaid 指引（§2.4 D4）
   - [work-preset.ts](packages/core/src/session/work-preset.ts) PRD（:30-31）/文献综述（:47-48）guidance 加 Mermaid 示例（§2.5 D5）；视频分镜/行政公文不改
3. **重构**：SYSTEM_PROMPT Mermaid 指引通用（不绑 preset）；guidance 示例精准 + "不强制"
4. **退出**：`bun --cwd packages/core test --timeout 30000` 绿；`bun --cwd packages/core typecheck` 绿

### Phase C - 端到端 + 主题对齐 + 打磨（1d）

1. **红**：
   - 新建 session-ui 集成测试：完整 Markdown（含 ```mermaid 块 + 普通代码块 + 表格）经 Markdown 组件渲染 -> mermaid 块出 `<svg>`，普通代码块仍 shiki 高亮 `<pre class="shiki">`
   - 扩展 `packages/app/e2e/`（Playwright，现有 regression/smoke 目录）：Work 选 write-prd 预设 -> 生成候选稿含 ```mermaid -> 右栏 Artifact Tab 渲染 `<svg>`；视频分镜候选稿不含 mermaid（无 mermaid `<svg>`）
2. **绿**：端到端联调；修 mermaid.render 时序（async createResource）、动态 import、主题对齐 v2 token
3. **重构**：
   - mermaid 动态 import 不阻塞首屏（getMermaid cached + 仅 mermaid 块时触发）
   - 主题对齐：mermaid `theme:"base"` + `themeVariables` 映射 v2 token（`--v2-background-bg-accent` 节点填充 / `--v2-text-text-base` 节点文字 / `--v2-border-border-base` 节点边框 / `--v2-text-text-muted` 连线 / `--v2-background-bg-base` 画布，见 frontend-theming skill）
   - M1 候选稿载体/落盘/M2 存为资产无回归验证
4. **退出**：端到端通过；`tsgo -b`（app）+ `tsgo --noEmit`（core/session-ui/ui）+ `bun run lint` + 全包 test 绿；改完即审 7 步

### 5.1 mermaid.ts 参考实现（session-ui）

```ts
import DOMPurify from "dompurify"

let mermaidReady: Promise<typeof import("mermaid")> | undefined

function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          primaryColor: "var(--v2-background-bg-accent)",
          primaryTextColor: "var(--v2-text-text-base)",
          primaryBorderColor: "var(--v2-border-border-base)",
          lineColor: "var(--v2-text-text-muted)",
          background: "var(--v2-background-bg-base)",
        },
        securityLevel: "strict",
      })
      return m.default
    })
  }
  return mermaidReady
}

const mermaidSvgConfig = {
  USE_PROFILES: { svg: true },
  SANITIZE_NAMED_PROPS: false,
  FORBID_TAGS: ["foreignObject", "script"],
  FORBID_ATTR: ["onload", "onclick", "onerror"],
}

function sanitizeMermaidSvg(svg: string): string {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, mermaidSvgConfig)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export async function renderMermaidBlocks(html: string): Promise<string> {
  if (!html.includes("data-mermaid")) return html
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

### 5.2 markdown.tsx :343-354 重构参考

```ts
// 原 :343-354 非 code 块路径，重构为统一出口
const hash = checksum(block.raw)
let html: string
const cached = key ? getCachedMarkdown(key) : undefined
if (cached?.raw === block.raw) {
  touchCachedMarkdown(key!, cached)
  html = cached.html  // cache 存含占位符的 sanitized HTML
} else {
  html = sanitizeMarkdown(await Promise.resolve(marked.parse(block.src)))
  if (key && hash) touchCachedMarkdown(key, { raw: block.raw, hash, html })
}
const finalHtml = await renderMermaidBlocks(html)  // 占位符 -> SVG（cache 命中/未命中都跑）
return { key: blockKey, mode: block.mode, raw: block.raw, hash: hash ?? "", html: finalHtml }
```

- cache 存 sanitized 含占位符 HTML（`html`），不存 SVG（`finalHtml`）--SVG 经独立 sanitize，不入全局 markdown cache
- `renderMermaidBlocks` 每次跑（cache 命中也跑），无 `data-mermaid` 时 `includes` 快速跳过（零开销）

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）
```bash
bun --cwd packages/session-ui test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/ui test --timeout 30000    # 若新增 marked 占位符测试
bun --cwd packages/app test
bun --cwd packages/session-ui typecheck       # tsgo --noEmit
bun --cwd packages/core typecheck
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck              # tsgo -b
bun run lint
```

### 6.2 三模式选择
| 模式 | 何时用 |
|---|---|
| `it.live` | mermaid.render 真实 async + happy-dom DOM（**必须用 it.live**，it.effect 用 Test Clock 会挂起 async drain） |
| 普通 `it` | mermaidPlaceholder 转义纯函数、sanitizeMermaidSvg 纯函数 |
| E2E | Work 选预设 -> 候选含 mermaid -> 右栏渲染 SVG（Playwright） |

### 6.3 硬性规则
- mermaid.render 是 async，测试用 `it.live`（真实 async + happy-dom DOM）
- **不 mock mermaid**（AGENTS.md「Avoid mocks」）--测试实际渲染输出（SVG 元素存在 + 内部引用保留）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试
- happy-dom 20.11.1 支持 DOMParser + crypto.randomUUID（[bunfig.toml](packages/session-ui/bunfig.toml) preload happy-dom-setup.ts）

## 7. SolidJS / 编码规范
- M3 主要写纯函数 + DOM 操作 + marked 配置，基本不写 Effect 代码
- 新代码用 `export * as Foo from "./foo"` 自导出；禁 namespace/别名 import/star import（AGENTS.md §Imports）
- **packages/ui 不能反向依赖 session-ui**（ui 是底层包）--mermaidPlaceholder 在 ui 内联，mermaid 渲染在 session-ui
- mermaid themeVariables 用 v2 token CSS var 字符串（`var(--v2-*)`，SVG fill 支持 var()，见 frontend-theming skill）
- 动态 import 模块（mermaid ~500KB）：`import("mermaid").then(...)`，cached 在模块级变量，不进首屏包

## 8. 分支与提交规范
- 分支：`work-m3`（从最新 main 切出；≤3 词、连字符、无斜杠无类型前缀）
- commit：`type(scope): summary`；scope 用 `session-ui`/`ui`/`core`/`app`
- 每完成一个 Phase 一个 commit（`feat(session-ui): ...` / `feat(ui): ...` / `feat(core): ...`），不批量
- `.husky/pre-push` 会跑 `bun typecheck`--push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）
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

## 10. 改完即审（每 Phase 结束必须执行）
1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything（mermaid 语法错误降级不崩）/ No Null Pointer（占位符 src 空值守卫 `?? ""`）/ Security First（独立 sanitize config + mermaid strict + foreignObject 显式禁）
3. 整洁复查：No Cheating（无 as any/@ts-ignore）/ Reusability（复用 M1-M2 全链路，0 新建 Service/HTTP/migration）/ Clean Logs（错误日志不含敏感数据）
4. 数据流追踪：mermaid 源码 -> 占位符（data-mermaid 转义）-> 全局 sanitize（占位符存活）-> renderMermaidBlocks（反转义 -> render -> 独立 sanitize -> 替换）-> innerHTML -> decorate；确认 marked.tsx highlight 在 lang 回退前拦截；确认 markdown.tsx cache 命中/未命中两路径都跑 renderMermaidBlocks
5. 输出复查结论：
```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:
- 剩余风险:
```

## 11. 禁止事项（八荣九耻）
- **禁用 marked renderer 拦截 mermaid**--marked-shiki walkTokens 在 renderer 前转 token，拦截点只能是 marked.tsx:488 highlight 回调（初稿误判，§2.1）
- **禁动全局 DOMPurify config**--方案 B+ 用独立 sanitize config，全局 config 改了破坏 sanitize-regression.test.tsx + 影响所有 markdown（初稿误判，§2.2）
- **禁用 inline SVG 经全局 sanitizeMarkdown**--全局 config 无 svg profile 会剥 SVG 元素 + SANITIZE_NAMED_PROPS 打断引用
- 禁瞎猜接口--查 `codegraph`（MCP）或 grep 确认后再写。**特别核实**：marked-shiki walkTokens 行为（node_modules/marked-shiki/dist/index.js:5-15）、marked.tsx:488 highlight、markdown-cache.tsx:13-20 全局 config
- 禁模糊执行--任务不清停下来问，不自我感动式盲目执行
- 禁创造接口--先查 owner module 能否复用（marked 配置 / DOMPurify / Markdown 组件都有现成）
- 禁跳过验证--改完必须跑对应包 test（session-ui/core/ui/app）
- 禁破坏架构--遵循 ADR-11~15 + AGENTS.md 分层；packages/ui 不反向依赖 session-ui；新代码用 `export * as Foo` 自导出
- 禁假装理解--未知技术栈承认并向人类求助
- 禁长注释--默认无注释，仅 WHY 非显然处加一行
- 禁把 M3.5（独立 HTML 图表 / iframe sandbox / CSP 评审）混进 M3
- 禁改流式渲染管线（code()/shiki worker/markdown-stream.ts 不动）
- 禁给所有 preset 强加 Mermaid（视频分镜/行政公文不加）
- 禁在 packages/ui 引入 mermaid 库依赖（占位符是纯字符串）

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行建议主力模型） |
| 新对话打开文件 | `docs/plan/work-mode-execution-layer-m3.md`（范围真源）+ 本文件 |
| 开工顺序 | 通读 CLAUDE.md/AGENTS.md/frontend-theming skill -> git 切 `work-m3` -> Phase A 红测试开始 |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁）。特别回报：mermaid SVG 内部引用是否保留、全局 config 是否被动 |
| 跨包顺序 | Phase A 先 session-ui（mermaid.ts 测试）+ ui（highlight 拦截）+ markdown.tsx 接入；Phase B core；Phase C app e2e。包间无运行时依赖顺序（占位符是纯字符串契约） |
