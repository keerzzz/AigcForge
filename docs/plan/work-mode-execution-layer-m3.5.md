# Work 模式 M3.5 实施计划：格式无关交互内容预览（L2）

> 状态：**Draft - 待审批**（基于 [M3.5 调研报告](work-mode-m3.5-research.md) 四次修订后的工程严密级方案）
> 日期：2026-08-08
> Owner：Core + App + Session-UI + Security
> 范围：`packages/session-ui`（HTML artifact 渲染器 + iframe sandbox）+ `packages/app`（格式路由 + Code/Preview tabs + 落盘）+ `packages/core`（SYSTEM_PROMPT）
> 关联：[M3.5 调研报告](work-mode-m3.5-research.md)（范围真源）、[竞品调研](m3.5-competitor-research.md)（Claude/E2B 架构借鉴）、[Work 路线图](work-mode-roadmap.md) §3.6、[Work M3 计划](work-mode-execution-layer-m3.md)（L1 已完成，渲染器注册表首两项）、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)（TDD 范式）、[frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md)
> 分支：**work-m3.5**（从最新 main 切出；连字符分隔、≤3 词、无斜杠无类型前缀，符合 AGENTS.md Branch 规范）
> 最后更新：2026-08-08

---

## 0. 审批状态与执行 Gate

| Gate            | 条件                                                                                                           | 状态                           | 阻塞范围   |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------- |
| **G0 范围真源** | [M3.5 调研报告](work-mode-m3.5-research.md) 四次修订完成（工程严密级）                                         | ✅ 已满足                      | 全部 Phase |
| **G1 依赖就绪** | M3 L1 已合入 main（mermaid.ts renderMermaidBlocks + marked.tsx highlight 拦截 + escapeHtml in markdown-cache） | ✅ 已满足                      | 全部 Phase |
| **G2 安全方案** | iframe sandbox 三重防线定案（sandbox + CSP 双重 + Storage Polyfill），Inline Script Injection 规避 CORS        | ✅ 已定（调研 §4.4/§4.5/§8.2） | Phase A    |
| **G3 格式标记** | ```html fenced code block 首选 + artifact 标签兼容（宽松流式解析器）                                           | ✅ 已定（调研 §10.1 #2）       | Phase B-C  |
| **G4 图表库**   | vis-network + chart.js（self-hosted，`?raw` import 内联注入）                                                  | ✅ 已定                        | Phase B    |
| **G5 范围防线** | M3.5 = 方向 ① 渲染增强 only；方向 ②③（highlight-to-edit / 版本滑块）属未来 M4+，不混入                         | ✅ 已确认                      | 全部 Phase |

**前置假设（未在调研报告 §10.1 完全确认，本计划做务实选择）**：

- 产品确认交互可视化场景为差异化卖点（#1 真伪需求）--**假设通过**，否则不立项
- iframe `connect-src 'none'`（图表不能联网）可接受（#3）--**假设通过**，Claude Artifacts 已验证此模型
- 落盘 .html 文件加 CSP meta + 免责声明（#5）--**采纳**

---

## 1. 目标、非目标与本次收敛

### 1.1 M3.5 目标

Work 预览 Tab 升级为**格式无关交互内容预览器**：LLM 产 `html 代码块时，预览 Tab 检测格式并路由到 **HTML artifact 渲染器**（iframe sandbox + 三重安全防线），支持交互（点击/拖拽/CSS 框架/JS 库）。`mermaid / Markdown 继续走 M1/M3 渲染器（不变）。

### 1.2 非目标

- ❌ 不做 highlight-to-edit 局部 Patch（方向 ②，未来 M4+，借鉴 ChatGPT Canvas）
- ❌ 不做版本滑块 / Diff 回滚（方向 ③，未来 M4+，借鉴 Canvas + v0）
- ❌ 不做 React 组件渲染（远期，需预打包 React 运行时）
- ❌ 不做 SVG 独立渲染器（```svg --远期扩展，渲染器注册表预留接口）
- ❌ 不做云沙箱 / Firecracker microVM（AigcForge 本地优先）
- ❌ 不做任意 npm install（仅 self-hosted 白名单库 vis-network/chart.js）
- ❌ 不做一键 Deploy / GitHub Sync（v0 特性，Work 是文档产出）
- ❌ 不改 M1 候选稿载体（候选稿=assistant 消息正文，```html 在正文中）
- ❌ 不改 M2 存为资产链路（prompt 资产 template=候选稿，HTML 作为 template 内容）
- ❌ 不改 M3 Mermaid 渲染器（renderMermaidBlocks 不变）
- ❌ 不改全局 DOMPurify config（markdown-cache.tsx 不变）
- ❌ 不新建数据库 migration

### 1.3 相对调研报告的收敛

| 调研报告                                  | M3.5 实施                                                   |
| ----------------------------------------- | ----------------------------------------------------------- |
| HTML + SVG + 未来 React                   | **仅 HTML**（SVG/React 远期，注册表预留）                   |
| 图表库 Vis.js + Chart.js + ECharts 三选   | **vis-network + chart.js 两库**（ECharts 包体大，远期按需） |
| 宽松流式解析器（```html + artifact 标签） | **```html 首选**，artifact 标签兼容（Phase B 实现）         |

---

## 2. 背景与当前状态（5 层代码核验）

### 2.1 已就绪基座（复用，M3 后状态）

| 层                   | 能力                                                                            | 位置                                                                              | 状态                                                                                   |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **① Prompt**         | work-orchestrator SYSTEM_PROMPT（6 步 + Resume）                                | [work-orchestrator.ts:13-46](packages/core/src/agent/prompt/work-orchestrator.ts) | ✅ M3 已加 Mermaid 指引（:25）；M3.5 加 HTML 指引                                      |
| **② Preset**         | 4 预设（PRD/文献/分镜/公文）+ guidance                                          | [work-preset.ts](packages/core/src/session/work-preset.ts)                        | ✅ M3 已加 Mermaid 示例；M3.5 不改现有 preset（HTML 走 inline task spec 或用户新需求） |
| **③ 提取**           | findLatestAssistantMarkdown + extractFirstHeading + draftFilename               | [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts)       | ✅ M1/M2 已实现；M3.5 加 extractHtmlBlock + detectArtifactFormat                       |
| **④a Mermaid 渲染**  | getMermaid + sanitizeMermaidSvg + renderMermaidBlocks                           | [mermaid.ts](packages/session-ui/src/components/mermaid.ts)                       | ✅ M3 L1 已完成（M3 review 修复后）；**M3.5 HTML 渲染器类比此模式**                    |
| **④b Markdown 组件** | Markdown createResource + marked.parse + sanitizeMarkdown + renderMermaidBlocks | [markdown.tsx:354](packages/session-ui/src/components/markdown.tsx)               | ✅ M1/M3 已实现（不变）                                                                |
| **④c sanitize**      | 全局 DOMPurify config + escapeHtml                                              | [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx)       | ✅ M3 修复后 escapeHtml 共享（不变）                                                   |
| **④d marked 配置**   | marked-shiki highlight 拦截 mermaid -> 占位符                                   | [marked.tsx:494](packages/ui/src/context/marked.tsx)                              | ✅ M3 已实现（不变；HTML 不走 marked，走独立路由）                                     |
| **⑤ 呈现**           | WorkArtifactContent `<Markdown text={candidate()!} />` + apply + save-asset     | [work-artifact-panel.tsx:187](packages/app/src/pages/work-artifact-panel.tsx)     | ✅ M1/M2 已实现；M3.5 加格式路由 + Code/Preview tabs                                   |
| **⑥ CSP**            | `script-src 'self' 'wasm-unsafe-eval'`                                          | [ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)                            | ✅ 不触发（HTML 在 iframe sandbox 内，独立 CSP）                                       |

### 2.2 需新建/修改

| 交付物                  | 位置                                                                        | 动作                                                                                         |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| HTML artifact 渲染器    | `packages/session-ui/src/components/html-artifact.tsx`                      | 新增：HtmlArtifact 组件（iframe sandbox + Code/Preview tabs + onerror 降级）                 |
| srcdoc 构造 + 安全防线  | `packages/session-ui/src/components/html-artifact-srcdoc.ts`                | 新增：buildSrcdoc（CSP meta + Storage Polyfill + Inline Script Injection）+ sanitizeHtmlLite |
| 图表库内联源            | `packages/session-ui/src/components/chart-libs.ts`                          | 新增：`?raw` import vis-network + chart.js 源码字符串                                        |
| 格式路由 + 提取         | [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts) | 修改：加 extractHtmlBlock + detectArtifactFormat                                             |
| 预览 Tab 路由           | [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)   | 修改：格式检测 -> HtmlArtifact / Markdown 条件渲染                                           |
| SYSTEM_PROMPT HTML 指引 | [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改：步骤5 加 HTML 产出指引                                                                 |
| 落盘 .html              | [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts) | 修改：draftFilename 支持 .html 扩展                                                          |
| i18n                    | [en.ts](packages/app/src/i18n/en.ts) + zh.ts + zht.ts                       | 修改：Code/Preview/error banner 文案                                                         |
| 依赖                    | [session-ui/package.json](packages/session-ui/package.json)                 | 新增：`vis-network` + `chart.js`（`?raw` import 用）                                         |

---

## 3. 范围与设计决策

### 3.1 D1：格式路由（```html 检测 -> HTML panel / else Markdown）

**决策**：候选稿（消息正文）经 `detectArtifactFormat` 检测：

- 含 `html fenced code block -> **HTML artifact 模式**（提取首个 `html 块，渲染 HtmlArtifact 组件）
- 否则 -> **Markdown 模式**（现有 M1/M3 `<Markdown>` 组件，Mermaid 内嵌不变）

````ts
// work-artifact-extract.ts 新增
export function detectArtifactFormat(content: string): "html" | "markdown" {
  return /```html\n[\s\S]*?\n```/.test(content) ? "html" : "markdown"
}

export function extractHtmlBlock(content: string): string | null {
  const match = content.match(/```html\n([\s\S]*?)\n```/)
  return match?.[1] ?? null
}
````

**路由位置**：[work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx) WorkArtifactContent 内条件渲染：

````tsx
<Show when={candidate()}>
  {candidate()!.includes("```html") ? <HtmlArtifact content={candidate()!} /> : <Markdown text={candidate()!} />}
</Show>
````

**不做**：不在 Markdown 组件内内嵌 iframe（HTML iframe 需独立面板尺寸/滚动，不适合内嵌 Markdown 流）。格式路由在面板级，非内嵌级。

### 3.2 D2：HTML iframe sandbox（三重安全防线）

**防线 1：sandbox 隔离**

```html
<iframe sandbox="allow-scripts" srcdoc="{srcdoc}" />
```

- `allow-scripts` 运行 JS，**不加** `allow-same-origin` -> null origin，不可访问父 DOM/cookie

**防线 2：CSP 双重**（调研 §8.2 核验：srcdoc 继承父 CSP，需双重）

```html
<!-- iframe 原生 csp 属性（防线 1） -->
<iframe csp="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';" ... />

<!-- srcdoc 内 <meta>（防线 2） -->
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'none';
  script-src 'unsafe-inline';
  style-src 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'none';
"
/>
```

- `connect-src 'none'` 禁网络请求（防外泄）
- `script-src 'unsafe-inline'` 允许 inline script（sandbox 已隔离父页面，unsafe-inline 可接受）

**防线 3：Storage Mock Polyfill**（调研 §8.2 核验：sandbox 无 same-origin 时 localStorage 抛 SecurityError 崩溃）

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

注入 srcdoc `<head>` 最前端，防 SecurityError 崩溃 + 锁死持久化 payload。

### 3.3 D3：Inline Script Injection（规避 null origin CORS）

**问题**（调研 §4.5 核验）：sandbox null origin 下 `<script src="/assets/vis.js">` 被 CORS 阻断。

**方案**：图表库源码**内联注入** srcdoc（零 HTTP 请求）：

```ts
// chart-libs.ts
import visNetworkSource from "vis-network/standalone/umd/vis-network.min.js?raw"
import chartJsSource from "chart.js/dist/chart.umd.js?raw"

export const CHART_LIBS: Record<string, string> = {
  "vis-network": visNetworkSource,
  "chart.js": chartJsSource,
}

export function resolveLibs(html: string): string[] {
  const libs: string[] = []
  if (html.includes("vis.")) libs.push(CHART_LIBS["vis-network"])
  if (html.includes("Chart")) libs.push(CHART_LIBS["chart.js"])
  return libs
}
```

`buildSrcdoc` 将库源码内联到 `<script>...</script>`：

```ts
function buildSrcdoc(html: string, libs: string[]): string {
  const libScripts = libs.map((lib) => `<script>${lib}</script>`).join("\n")
  return `<!DOCTYPE html><html><head>
    <meta http-equiv="Content-Security-Policy" content="...">  // 防线 2
    <script>/* Storage Polyfill */</script>                      // 防线 3
    ${libScripts}                                                // D3 库内联
  </head><body>${html}</body></html>`
}
```

**代价**：srcdoc 膨胀（vis-network ~200KB + chart.js ~70KB inline），但单候选稿可接受。

### 3.4 D4：onerror 降级 + Code/Preview 两 Tab（调研 §9.2）

**两 Tab 布局**（借鉴 E2B [preview.tsx](https://github.com/e2b-dev/fragments/blob/main/components/preview.tsx)）：

- **Code Tab**：HTML 源码（shiki 语法高亮，复用 markdown.tsx 的 `code()` 函数或 shiki worker）
- **Preview Tab**：iframe sandbox 渲染

**onerror 降级**：

```tsx
<iframe
  sandbox="allow-scripts"
  srcdoc={srcdoc()}
  onError={() => setRenderError(true)}
/>
<Show when={renderError()}>
  <Banner variant="warning">
    {language.t("work.artifact.html.renderError")}
    <Button onClick={() => setTab("code")}>{language.t("work.artifact.html.viewCode")}</Button>
  </Banner>
</Show>
```

iframe 渲染异常时不白屏，弹 Banner + 一键切 Code 视图。

### 3.5 D5：SYSTEM_PROMPT HTML 指引

[work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 后加 HTML 指引：

````
5. **Produce the candidate**: ...（现有 Mermaid 指引保留）

   **For interactive visualizations** (team topology, data dashboards, interactive prototypes that need click/drag/CSS frameworks/JS libraries beyond what Mermaid can express), produce a single ```html fenced code block containing a self-contained HTML page. Available libraries (auto-injected by the preview): vis-network (topology/network graphs), chart.js (data charts). Use them via their global APIs (e.g., new vis.Network(...), new Chart(...)). Do not include <script src> tags for these libraries. Keep HTML self-contained: inline CSS/JS, Base64 images. Only produce HTML when the user explicitly needs interactivity; default to Markdown + Mermaid for documents.
````

### 3.6 D6：落盘 .html + 存为资产

**落盘**：HTML artifact 模式时，`draftFilename` 返回 `.html` 扩展：

```ts
export function draftFilename(content: string): string {
  const title = extractFirstHeading(content)
  const ext = detectArtifactFormat(content) === "html" ? "html" : "md"
  if (!title) return `work-draft.${ext}`
  const safe = title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)
  return safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`
}
```

**落盘 HTML 加 CSP meta + 免责声明**：apply 时在 HTML 头部注入 CSP meta（防离线打开时外泄）+ 注释 `<!-- Generated by AigcForge Work mode. Review before sharing. -->`。

**存为资产**：M2 链路不变（captureWorkArtifactAsCandidate template=候选稿，```html 块作为 template 一部分自然携带）。

### 3.7 D7：宽松格式检测（```html 首选 + artifact 兼容）

`extractHtmlBlock` 优先匹配 ```html fenced block；兼容 `<artifact type="html">` 标签（小型 LLM 可能漏闭合）：

````ts
export function extractHtmlBlock(content: string): string | null {
  // 1. 首选：```html fenced block
  const fenced = content.match(/```html\n([\s\S]*?)\n```/)
  if (fenced) return fenced[1]
  // 2. 兼容：<artifact type="html">...</artifact>（宽松，允许未闭合）
  const tagged = content.match(/<artifact[^>]*type=["']html["'][^>]*>([\s\S]*?)(?:<\/artifact>|$)/)
  if (tagged) return tagged[1]
  return null
}
````

---

## 4. 关键设计

### 4.1 HTML artifact 渲染流程

````
work-orchestrator 生成候选稿（含 ```html 代码块）
  -> findLatestAssistantMarkdown 提取候选稿（M1，不变）
  -> detectArtifactFormat(content) == "html"
  -> extractHtmlBlock(content) -> HTML 源码
  -> HtmlArtifact 组件:
       buildSrcdoc(html, resolveLibs(html)):
         -> sanitizeHtmlLite(html)（剥离外部 script src / javascript: URL / 已知恶意模式）
         -> 注入 CSP meta（防线 2）
         -> 注入 Storage Polyfill（防线 3）
         -> 注入 chart 库源码（D3 Inline Injection）
         -> 返回 srcdoc 字符串
       <iframe sandbox="allow-scripts" csp="..." srcdoc={srcdoc} onError={...} />
       Code Tab: shiki 高亮 HTML 源码
       Preview Tab: iframe
  -> 右栏 Artifact Tab 显示（Code/Preview 切换 + apply/save 按钮）
````

### 4.2 HtmlArtifact 组件（session-ui/src/components/html-artifact.tsx）

```tsx
import { createMemo, createSignal, Show } from "solid-js"
import { buildSrcdoc, sanitizeHtmlLite } from "./html-artifact-srcdoc"
import { resolveLibs } from "./chart-libs"
import { useLanguage } from "@aigcfroge/ui/context/i18n"

export function HtmlArtifact(props: { content: string; html: string }) {
  const language = useLanguage()
  const [tab, setTab] = createSignal<"code" | "preview">("preview")
  const [renderError, setRenderError] = createSignal(false)

  const srcdoc = createMemo(() => {
    const clean = sanitizeHtmlLite(props.html)
    const libs = resolveLibs(props.html)
    return buildSrcdoc(clean, libs)
  })

  return (
    <div class="flex h-full min-h-0 flex-col">
      <TabsV2 value={tab()} onChange={(v) => setTab(v === "code" ? "code" : "preview")}>
        <TabsV2.List>
          <TabsV2.Trigger value="preview">{language.t("work.artifact.html.preview")}</TabsV2.Trigger>
          <TabsV2.Trigger value="code">{language.t("work.artifact.html.code")}</TabsV2.Trigger>
        </TabsV2.List>
        <TabsV2.Content value="preview">
          <Show when={!renderError()} fallback={<ErrorBanner onViewCode={() => setTab("code")} />}>
            <iframe
              sandbox="allow-scripts"
              csp="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';"
              srcdoc={srcdoc()}
              class="h-full w-full border-0"
              onError={() => setRenderError(true)}
            />
          </Show>
        </TabsV2.Content>
        <TabsV2.Content value="code">
          <CodeView code={props.html} language="html" />
        </TabsV2.Content>
      </TabsV2>
    </div>
  )
}
```

### 4.3 buildSrcdoc（html-artifact-srcdoc.ts）

```ts
import { escapeHtml } from "./markdown-cache"

const STORAGE_POLYFILL = `<script>
  window.localStorage = window.sessionStorage = (function() {
    var store = {};
    return {
      getItem: function(k) { return store[k] || null; },
      setItem: function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      clear: function() { store = {}; }
    };
  })();
</script>`

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'unsafe-inline';
  style-src 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'none';
">`

export function buildSrcdoc(html: string, libs: string[]): string {
  const libScripts = libs.map((lib) => `<script>${lib}</script>`).join("\n")
  return `<!DOCTYPE html><html><head>${CSP_META}${STORAGE_POLYFILL}${libScripts}</head><body>${html}</body></html>`
}

/** 轻量 sanitize：剥离外部 script src / javascript: URL / 事件处理器（不深度 sanitize JS）*/
export function sanitizeHtmlLite(html: string): string {
  return html
    .replace(/<script[^>]*\ssrc=["'][^"']*["'][^>]*><\/script>/gi, "") // 剥离外部 script src（库由 Inline Injection 注入）
    .replace(/javascript:/gi, "") // 剥离 javascript: URL
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "") // 剥离事件处理器（onload/onclick/...）
}
```

**注意**：`sanitizeHtmlLite` 是轻量预处理，不替代 sandbox。安全兜底靠 iframe sandbox + CSP（防线 1+2）。深度 JS sanitization 不可靠，sandbox 是最终保障。

### 4.4 不改的链路（复用验证点）

- **Mermaid 渲染器**（[mermaid.ts](packages/session-ui/src/components/mermaid.ts)）：不变（```mermaid 继续走 M3）
- **Markdown 组件**（[markdown.tsx](packages/session-ui/src/components/markdown.tsx)）：不变（非 HTML artifact 模式时继续用）
- **全局 DOMPurify config**（[markdown-cache.tsx](packages/markdown-cache.tsx)）：不变（escapeHtml 已共享）
- **marked.tsx highlight**（[marked.tsx:494](packages/ui/src/context/marked.tsx)）：不变（HTML 不走 marked，走独立路由）
- **候选稿载体**（M1 D1）：不变（```html 在消息正文中）
- **存为资产**（M2 captureWorkArtifactAsCandidate）：不变
- **CSP**（[ui.ts:12](packages/aigcfroge/src/server/shared/ui.ts)）：不变（HTML 在 iframe 内，独立 CSP）

---

## 5. 阶段划分（TDD：红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。对齐 [M1 TDD 手册](work-mode-m1-tdd-prompt.md) §5 范式。

### Phase A - HTML iframe sandbox + 安全防线（估时 2d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 新建 `packages/session-ui/src/components/html-artifact-srcdoc.test.ts`：① `buildSrcdoc` 输出含 CSP meta + Storage Polyfill + 库内联 `<script>`；② `sanitizeHtmlLite` 剥离 `<script src>` / `javascript:` / `onload=`；③ Storage Polyfill 脚本正确替换 localStorage 为内存 Map。新建 `html-artifact.test.tsx`（`it.live`，happy-dom）：① HtmlArtifact 渲染 `<iframe sandbox="allow-scripts">`（无 allow-same-origin）；② iframe srcdoc 含 CSP meta + Polyfill；③ onerror 触发 -> ErrorBanner 显示 + 切 Code Tab |
| **绿**   | 新建 `html-artifact-srcdoc.ts`（buildSrcdoc + sanitizeHtmlLite + STORAGE_POLYFILL + CSP_META）；新建 `html-artifact.tsx`（HtmlArtifact 组件：iframe + Code/Preview tabs + onerror 降级）；新建 `chart-libs.ts`（`?raw` import vis-network + chart.js + resolveLibs）                                                                                                                                                                                                                                           |
| **重构** | 确认 iframe sandbox 属性不含 allow-same-origin（测试断言）；CSP meta 与 csp 属性一致；Storage Polyfill 在 head 最前                                                                                                                                                                                                                                                                                                                                                                                            |
| **退出** | `bun --cwd packages/session-ui test --timeout 30000` 绿；`bun --cwd packages/session-ui typecheck` 绿；iframe 三重防线测试通过                                                                                                                                                                                                                                                                                                                                                                                 |

### Phase B - 格式路由 + SYSTEM_PROMPT + 图表库（估时 2d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 扩展 `packages/app/src/pages/work-artifact-extract.test.ts`：① `detectArtifactFormat("```html\n...\n```")` == "html"；② `detectArtifactFormat("# PRD\n...")` == "markdown"；③ `extractHtmlBlock` 提取 ``html 块 + 兼容 `<artifact type="html">` 标签；④ `draftFilename` 对 HTML 候选稿返回 .html 扩展。扩展 `packages/core/test/work-orchestrator.test.ts`：SYSTEM_PROMPT 含 "``html" + "interactive visualizations" + "vis-network" + "chart.js"。扩展 `work-artifact-panel.test`（若有）：候选含 ```html -> 渲染 HtmlArtifact；否则渲染 Markdown |
| **绿**   | `work-artifact-extract.ts` 加 detectArtifactFormat + extractHtmlBlock + draftFilename .html；`work-artifact-panel.tsx` WorkArtifactContent 加格式路由条件渲染；`work-orchestrator.ts` 步骤5 加 HTML 指引（§3.5 D5）                                                                                                                                                                                                                                                                                                                                |
| **重构** | 格式检测函数集中 work-artifact-extract.ts；路由逻辑在 WorkArtifactContent 单一出口；HtmlArtifact 组件不耦合提取逻辑                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **退出** | core + app test 绿；typecheck 绿；候选含 ```html -> HtmlArtifact；不含 -> Markdown（无回归）                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Phase C - 落盘 .html + 存为资产 + i18n（估时 1.5d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **红**   | 扩展 `work-artifact-extract.test.ts`：draftFilename 对 HTML 返回 .html，对 Markdown 返回 .md（向后兼容）。扩展 apply 测试：HTML 候选稿 apply 写 .html 文件（含 CSP meta + 免责声明）。i18n parity.test.ts：en/zh/zht 补 `work.artifact.html.preview`/`code`/`renderError`/`viewCode` |
| **绿**   | `draftFilename` 支持 .html；`work-artifact-panel.tsx` apply 对 HTML 注入 CSP meta + 免责注释；i18n 三 locale 补文案                                                                                                                                                                  |
| **重构** | CSP meta 注入复用 buildSrcdoc 的 CSP_META（不重复定义）；落盘 .html 的 CSP 与 iframe srcdoc 的 CSP 一致                                                                                                                                                                              |
| **退出** | apply 测试绿；parity 通过；落盘 .html 含 CSP meta                                                                                                                                                                                                                                    |

### Phase D - 端到端 + 安全测试 + 打磨（估时 1.5d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **红**   | 新建 `packages/app/e2e/regression/work-html-artifact.spec.ts`（Playwright）：Work 候选含 ```html（vis-network 拓扑图）-> 右栏 Preview Tab 渲染 iframe（`iframe[sandbox="allow-scripts"]`可见）-> 切 Code Tab 见源码 -> apply 写 .html。安全测试：iframe srcdoc 不含`allow-same-origin`；`connect-src 'none'`；localStorage 调用不抛 SecurityError（Polyfill 生效） |
| **绿**   | 端到端联调；修 iframe 时序、库内联注入、主题对齐（iframe 内 HTML 用 v2 token CSS var 字符串，对齐 frontend-theming skill）                                                                                                                                                                                                                                         |
| **重构** | iframe 尺寸自适应（ResizeHandle 对齐 code/chat B 区）；ErrorBanner UI 用 v2 token；M1/M2/M3 无回归验证                                                                                                                                                                                                                                                             |
| **退出** | 端到端通过；`tsgo -b`（app）+ `tsgo --noEmit`（core/session-ui/ui）+ `bun run lint` + 全包 test 绿；改完即审 7 步                                                                                                                                                                                                                                                  |

---

## 6. 关键文件

| 文件                                                                        | 动作 | 说明                                                             |
| --------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `packages/session-ui/src/components/html-artifact.tsx`                      | 新增 | HtmlArtifact 组件（iframe + Code/Preview tabs + onerror 降级）   |
| `packages/session-ui/src/components/html-artifact-srcdoc.ts`                | 新增 | buildSrcdoc + sanitizeHtmlLite + STORAGE_POLYFILL + CSP_META     |
| `packages/session-ui/src/components/chart-libs.ts`                          | 新增 | `?raw` import vis-network + chart.js + resolveLibs               |
| `packages/session-ui/src/components/html-artifact-srcdoc.test.ts`           | 新增 | buildSrcdoc + sanitizeHtmlLite 单测（TDD 红测试）                |
| `packages/session-ui/src/components/html-artifact.test.tsx`                 | 新增 | HtmlArtifact 组件测试（it.live，iframe sandbox 断言）            |
| [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts) | 修改 | 加 detectArtifactFormat + extractHtmlBlock + draftFilename .html |
| [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)   | 修改 | WorkArtifactContent 格式路由 + HtmlArtifact 条件渲染             |
| [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改 | 步骤5 加 HTML 指引                                               |
| [en.ts](packages/app/src/i18n/en.ts) + zh.ts + zht.ts                       | 修改 | `work.artifact.html.*` 文案                                      |
| [session-ui/package.json](packages/session-ui/package.json)                 | 修改 | 新增 `vis-network` + `chart.js` 依赖                             |
| `packages/app/e2e/regression/work-html-artifact.spec.ts`                    | 新增 | Playwright e2e                                                   |

**不改的文件**：

- [mermaid.ts](packages/session-ui/src/components/mermaid.ts)（M3 渲染器不变）
- [markdown.tsx](packages/session-ui/src/components/markdown.tsx)（Markdown 组件不变）
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx)（全局 config 不变，escapeHtml 已共享）
- [marked.tsx](packages/ui/src/context/marked.tsx)（highlight 不变，HTML 不走 marked）
- [work-asset-capture.ts](packages/app/src/pages/work-asset-capture.ts)（M2 资产映射不变）
- [artifact.ts](packages/core/src/session/artifact.ts)（WorkArtifact Service 不变）
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts)（CSP 不变）

---

## 7. 测试策略

### 7.1 新建测试

| 测试文件                       | 覆盖                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html-artifact-srcdoc.test.ts` | buildSrcdoc（CSP meta + Polyfill + 库内联）；sanitizeHtmlLite（剥外部 script src / javascript: / on\* 事件）                                             |
| `html-artifact.test.tsx`       | HtmlArtifact 组件（`it.live`）：iframe `sandbox="allow-scripts"`（断言无 allow-same-origin）；srcdoc 含 CSP + Polyfill；onerror -> ErrorBanner + 切 Code |
| `work-html-artifact.spec.ts`   | e2e：Work 候选含 ```html -> iframe 渲染 -> Code/Preview 切换 -> apply .html                                                                              |

### 7.2 扩展现有测试

| 现有测试                                                                                            | 扩展                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts)                           | SYSTEM_PROMPT 含 "```html" + "interactive visualizations" + "vis-network" |
| [work-artifact-extract.test.ts](packages/app/src/pages/work-artifact-extract.test.ts)（若有）或新建 | detectArtifactFormat + extractHtmlBlock + draftFilename .html             |
| [parity.test.ts](packages/app/src/i18n/parity.test.ts)                                              | en/zh/zht 补 `work.artifact.html.*`                                       |

### 7.3 命令（CLAUDE.md / AGENTS.md 测试规范，永不从根跑）

```bash
bun --cwd packages/session-ui test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/session-ui typecheck       # tsgo --noEmit
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck              # tsgo -b
bun run lint
```

### 7.4 硬性规则

- iframe sandbox 测试用 `it.live`（真实 async + happy-dom DOM）
- **断言 sandbox 属性不含 `allow-same-origin`**（安全门禁，防配置错误）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际渲染（iframe 元素存在 + srcdoc 内容），不 mock
- happy-dom 20.11.1 支持 iframe + `?raw` import（bunfig.toml preload happy-dom-setup.ts）

---

## 8. 验收清单

- [ ] `vis-network` + `chart.js` 装入 session-ui（`?raw` import）
- [ ] `buildSrcdoc` 输出含 CSP meta + Storage Polyfill + 库内联 `<script>`
- [ ] `sanitizeHtmlLite` 剥离外部 `<script src>` / `javascript:` / `on*` 事件
- [ ] HtmlArtifact 渲染 `<iframe sandbox="allow-scripts">`（**断言无 allow-same-origin**）
- [ ] iframe 原生 `csp=` 属性 + srcdoc `<meta>` 双重 CSP（`connect-src 'none'`）
- [ ] Storage Mock Polyfill 注入 head 最前（localStorage 调用不抛 SecurityError）
- [ ] 图表库 Inline Script Injection（库源码内联，零 HTTP 请求，规避 CORS）
- [ ] `detectArtifactFormat`：含 ```html -> "html"；否则 "markdown"
- [ ] `extractHtmlBlock`：```html 首选 + `<artifact type="html">` 兼容
- [ ] WorkArtifactContent 格式路由：```html -> HtmlArtifact；否则 Markdown（M1/M3 无回归）
- [ ] Code/Preview 两 Tab 切换（E2B 模式）
- [ ] iframe onerror -> ErrorBanner + 一键切 Code（不白屏）
- [ ] work-orchestrator SYSTEM_PROMPT 含 HTML 指引（vis-network/chart.js/自包含）
- [ ] draftFilename 对 HTML 候选稿返回 .html 扩展
- [ ] apply 落盘 .html 含 CSP meta + 免责声明
- [ ] 存为资产（M2）链路无回归（template 含 ```html 块）
- [ ] M1 Markdown / M3 Mermaid 渲染器无回归
- [ ] 全局 DOMPurify config（markdown-cache.tsx）未改
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck（tsgo -b app + tsgo --noEmit core/session-ui）+ lint + test 全绿

---

## 9. 估算

| Phase                                        | 估时   |
| -------------------------------------------- | ------ |
| A HTML iframe sandbox + 三重安全防线 + tests | 2d     |
| B 格式路由 + SYSTEM_PROMPT + 图表库 inline   | 2d     |
| C 落盘 .html + 存为资产 + i18n               | 1.5d   |
| D 端到端 + 安全测试 + 打磨                   | 1.5d   |
| **总计**                                     | **7d** |

（对齐调研报告 §10.2 估时 ~7d；比 M3 L1 的 3d 高，因新安全方案 + 格式路由 + 图表库 inline + 新候选稿提取）

---

## 10. 风险与应对

| 风险                                                               | 概率 | 影响 | 应对                                                                                                                                                                                |
| ------------------------------------------------------------------ | ---- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iframe `csp=` 属性非 Chromium 浏览器不支持                         | 低   | 低   | **已核实**：desktop = Electron 42（Chromium）全平台支持 `csp=`（非 Tauri）；非 Chromium web 部署（Firefox/Safari）仅 `<meta>` 单重（仍有效，`<meta>` CSP 跨浏览器）。双重防线已覆盖 |
| `?raw` import 图表库源码过大（vis-network ~200KB）导致 srcdoc 膨胀 | 中   | 低   | 可接受（单候选稿 < 500KB）；远期加库源码缓存                                                                                                                                        |
| LLM 产 HTML 质量不稳定（未闭合标签/inline on\* 被剥）              | 高   | 中   | onerror 降级 + Code/Preview 切换 + SYSTEM_PROMPT 指引 `addEventListener`（inline `on*` 被 sanitizeHtmlLite 剥离，LLM 需用 `<script>` + addEventListener）                           |
| LLM 误用未白名单库（如 d3）                                        | 中   | 中   | sanitizeHtmlLite 剥离外部 `<script src>`；SYSTEM_PROMPT 限定 vis-network/chart.js                                                                                                   |
| iframe 尺寸自适应问题（HTML 内容高度不定）                         | 中   | 中   | iframe height 跟随面板 + ResizeHandle（对齐 code/chat B 区）                                                                                                                        |
| 主题对齐（iframe 内 HTML 用 v2 token）                             | 中   | 低   | SYSTEM_PROMPT 指引 LLM 用 `var(--v2-*)` CSS var 字符串（对齐 frontend-theming skill）                                                                                               |
| Storage Polyfill 与第三方库冲突                                    | 低   | 中   | Polyfill 在 head 最前，覆盖 window.localStorage；测试验证 vis-network/chart.js 兼容                                                                                                 |
| 范围蔓延（混入 highlight-to-edit / 版本滑块）                      | 中   | 高   | G5 范围防线；方向 ②③ 明确标为 M4+，不混入 M3.5                                                                                                                                      |

---

## 11. 技术债声明

| 负债                                                                      | 风险                                                                      | 到期                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| bun 1.3.14 无法编译 Solid JSX（bun#28605）-> 组件测试降级为源码契约 + e2e | bun 1.4 修复后可补 it.live 渲染测试；**已核实** 1.3.14 是最新，1.4 未发布 | bun 1.4 发布后                     |
| SVG 独立渲染器未做（```svg）                                              | 渲染器注册表预留接口，SVG 暂走 Markdown 代码块                            | M3.5 后按需加                      |
| React 组件渲染未做                                                        | 需预打包 React 运行时，复杂度高                                           | 远期                               |
| 图表库仅 vis-network + chart.js（无 ECharts）                             | 大屏场景需 ECharts                                                        | 按需加（包体大，动态 import）      |
| iframe 主题不随 light/dark 切换自动重渲                                   | LLM 产 HTML 内 CSS var 字符串可自适应，但 JS 计算的颜色不更新             | 可接受（CSS var 自适应大部分场景） |
| 方向 ② highlight-to-edit 未做                                             | work-orchestrator 仍全量重写                                              | 未来 M4+（借鉴 Canvas）            |
| 方向 ③ 版本滑块未做                                                       | 无 Diff 预览/Revert                                                       | 未来 M4+（结合 M1.5 outputDigest） |

---

## 12. 关联文档

- [M3.5 调研报告](work-mode-m3.5-research.md) - 范围真源（四次修订，工程严密级）
- [竞品调研](m3.5-competitor-research.md) - Claude/E2B/v0/Canvas 架构借鉴
- [Work 路线图](work-mode-roadmap.md) - §3.6 M3.5（L2）
- [Work M3 计划](work-mode-execution-layer-m3.md) - L1 实施计划（已完成，渲染器注册表首两项）
- [M1 TDD 手册](work-mode-m1-tdd-prompt.md) - TDD 红绿重构范式
- [frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md) - v2 token 对齐
- [mermaid.ts](packages/session-ui/src/components/mermaid.ts) - M3 渲染器模式参考
- [E2B Fragments preview.tsx](https://github.com/e2b-dev/fragments/blob/main/components/preview.tsx) - Code/Preview 两 Tab 参考
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
