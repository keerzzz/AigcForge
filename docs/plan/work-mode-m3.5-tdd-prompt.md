# Work 模式 M3.5 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work M3.5。
> **来源**：[M3.5 实施计划](work-mode-execution-layer-m3.5.md)（Draft-待审批）、[M3.5 调研报告](work-mode-m3.5-research.md)（四次修订，工程严密级）、[竞品调研](m3.5-competitor-research.md)、[Work 路线图](work-mode-roadmap.md) §3.6、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)、[frontend-theming skill](../../.aigcfroge/skills/frontend-theming/SKILL.md)
> **分支**：`work-m3.5`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 模式 M3.5：格式无关交互内容预览（L2）](docs/plan/work-mode-execution-layer-m3.5.md)。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

**⚠️ 本计划有严格的范围防线（G5）：M3.5 = 方向 ① 渲染增强 only。方向 ②（highlight-to-edit 局部 Patch）/ ③（版本滑块）属未来 M4+，**绝不混入 M3.5**。**

**⚠️ 三重安全防线是硬约束（§2 D2），任何一条偏离即安全漏洞：① iframe `sandbox="allow-scripts"` 绝不加 `allow-same-origin`；② CSP `connect-src 'none'`；③ Storage Mock Polyfill 必须注入。测试必须断言这三条。**

---

## 0. 你的任务（一句话）

让 Work 预览 Tab 升级为格式无关交互内容预览器：LLM 产 ```html 代码块时，预览 Tab 检测格式并路由到 HTML artifact 渲染器（iframe sandbox + 三重安全防线 + Inline Script Injection 图表库），支持交互可视化。```mermaid / Markdown 继续走 M1/M3 渲染器（不变）。

## 1. 范围与禁区

### 1.1 范围（M3.5 只做这些）
- 新建 session-ui `html-artifact-srcdoc.ts`：buildSrcdoc（CSP meta + Storage Polyfill + 库内联）+ sanitizeHtmlLite
- 新建 session-ui `html-artifact.tsx`：HtmlArtifact 组件（iframe sandbox + Code/Preview tabs + onerror 降级）
- 新建 session-ui `chart-libs.ts`：`?raw` import vis-network + chart.js 源码 + resolveLibs
- work-artifact-extract.ts 加 detectArtifactFormat + extractHtmlBlock + draftFilename .html
- work-artifact-panel.tsx WorkArtifactContent 加格式路由（```html -> HtmlArtifact / else Markdown）
- work-orchestrator SYSTEM_PROMPT 步骤5 加 HTML 指引
- i18n（en/zh/zht）：Code/Preview/error banner 文案

### 1.2 禁区（违反即返工，绝对不做）
- ❌ **iframe 绝不加 `allow-same-origin`**--AigcForge iframe 共享 app origin，加 allow-same-origin = iframe JS 可读父 DOM/cookie = XSS 升级。只允许 `sandbox="allow-scripts"`
- ❌ **不删除/弱化 CSP `connect-src 'none'`**--防数据外泄（fetch/XHR/WebSocket/beacon 全禁）
- ❌ **不省略 Storage Mock Polyfill**--sandbox 无 allow-same-origin 时 `window.localStorage` 抛**不可捕获** SecurityError，脚本挂起崩溃。必须 head 最前注入内存 Map 垫片
- ❌ **不用 `<script src="/assets/xxx.js">` 加载库**--null origin 下被 CORS 阻断。必须 Inline Script Injection（库源码内联 `<script>...</script>`，`?raw` import）
- ❌ **不改 mermaid.ts / markdown.tsx / markdown-cache.tsx / marked.tsx**（M1/M2/M3 零回归）
- ❌ **不改全局 DOMPurify config**（markdown-cache.tsx:13-20 不变；escapeHtml 已共享，直接 import）
- ❌ **不做 highlight-to-edit 局部 Patch**（方向 ②，未来 M4+，借鉴 ChatGPT Canvas）
- ❌ **不做版本滑块 / Diff 回滚**（方向 ③，未来 M4+）
- ❌ **不做 React 组件渲染**（远期，需预打包 React 运行时）
- ❌ **不做 SVG 独立渲染器**（```svg 远期，渲染器注册表预留）
- ❌ **不做云沙箱 / Firecracker microVM**（AigcForge 本地优先）
- ❌ **不引 CDN**（供应链风险；库 self-hosted `?raw` import 内联）
- ❌ **不做任意 npm install**（仅 vis-network + chart.js 白名单库）
- ❌ **不改 M1 候选稿载体**（候选稿=消息正文，```html 在正文中）
- ❌ **不改 M2 存为资产链路**（captureWorkArtifactAsCandidate 不变，```html 块作为 template 携带）
- ❌ **不改 M3 SYSTEM_PROMPT Mermaid 指引**（步骤5 现有 Mermaid 段保留，HTML 指引追加其后）
- ❌ 不新建 Service/HTTP/数据库 migration
- ❌ 不改现有 4 preset guidance（PRD/文献/分镜/公文 Mermaid 指引不变；HTML 走 inline task spec 或用户显式需求）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 格式路由（```html 检测 -> HTML panel / else Markdown）
- `detectArtifactFormat(content)`：含 ```html fenced block -> "html"；否则 "markdown"
- `extractHtmlBlock(content)`：```html 首选 + `<artifact type="html">` 兼容（宽松，小型 LLM 可能漏闭合）
- 路由在 [work-artifact-panel.tsx:187](packages/app/src/pages/work-artifact-panel.tsx) WorkArtifactContent 面板级（非 Markdown 组件内嵌）：```html -> `<HtmlArtifact>`；否则 `<Markdown>`（M1/M3 不变）
- **不做内嵌 iframe**（HTML iframe 需独立面板尺寸/滚动，不适合内嵌 Markdown 流）

### 2.2 D2 三重安全防线（硬约束，测试断言每一条）

**防线 1：sandbox 隔离**
```html
<iframe sandbox="allow-scripts" srcdoc={srcdoc} />
```
- `allow-scripts` 运行 JS，**绝不加 `allow-same-origin`** -> null origin，不可访问父 DOM/cookie

**防线 2：CSP 双重**（srcdoc 继承父 CSP，单 `<meta>` 不够，需 iframe `csp=` 属性 + srcdoc `<meta>`）
```html
<iframe csp="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';" ... />
```
srcdoc 内：
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src 'self' data:; connect-src 'none';
">
```
- `connect-src 'none'` 禁网络请求（防外泄）
- `script-src 'unsafe-inline'` 允许 inline script（sandbox 已隔离父页面，unsafe-inline 可接受）

**防线 3：Storage Mock Polyfill**（防 SecurityError 崩溃）
srcdoc `<head>` 最前注入：
```html
<script>
  window.localStorage = window.sessionStorage = (function() {
    var store = {};
    return {
      getItem: function(k) { return store[k] || null; },
      setItem: function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      clear: function() { store = {}; }
    };
  })();
</script>
```

### 2.3 D3 Inline Script Injection（规避 null origin CORS）
- **问题**：sandbox null origin 下 `<script src="/assets/vis.js">` 被 CORS 阻断
- **方案**：库源码内联 `<script>...</script>`，零 HTTP 请求
- `chart-libs.ts`：`import visNetworkSource from "vis-network/standalone/umd/vis-network.min.js?raw"` + chart.js 同理
- `resolveLibs(html)`：检测 HTML 是否用 `vis.` / `Chart` -> 返回需内联的库源码数组
- `buildSrcdoc(html, libs)`：库源码内联到 `<script>...</script>`

### 2.4 D4 onerror 降级 + Code/Preview 两 Tab
- **Code Tab**：HTML 源码（shiki 语法高亮）
- **Preview Tab**：iframe sandbox
- iframe `onError` -> ErrorBanner "交互渲染异常" + 一键切 Code Tab（不白屏）
- 借鉴 E2B [preview.tsx](https://github.com/e2b-dev/fragments/blob/main/components/preview.tsx) 两 Tab 布局

### 2.5 D5 SYSTEM_PROMPT HTML 指引
[work-orchestrator.ts:23](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 现有 Mermaid 段后追加 HTML 指引：交互可视化（团队拓扑/数据大屏/交互原型）产 ```html 块，声明 vis-network/chart.js 可用，自包含（inline CSS/JS + Base64 图片），不写 `<script src>`。默认 Markdown + Mermaid，仅用户显式需交互时产 HTML。

### 2.6 D6 落盘 .html + 存为资产
- `draftFilename(content)`：HTML artifact 模式返回 `.html` 扩展，否则 `.md`（向后兼容）
- apply 落盘 .html 时注入 CSP meta + 免责注释 `<!-- Generated by AigcForge Work mode. Review before sharing. -->`
- 存为资产（M2 captureWorkArtifactAsCandidate）不变，```html 块作为 template 携带

### 2.7 D7 宽松格式检测
- `extractHtmlBlock`：```html fenced block 首选 + `<artifact type="html">...</artifact>` 兼容（允许未闭合，`(?:<\/artifact>|$)`）

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| **M3 渲染器模式参考** | `packages/session-ui/src/components/mermaid.ts` | **必读**：getMermaid（动态 import cached）+ sanitizeMermaidSvg（独立 DOMPurify config）+ renderMermaidBlocks（DOMParser + 占位符 + 替换）。HtmlArtifact 类比此模式但用 iframe 非 innerHTML |
| **escapeHtml（共享）** | `packages/session-ui/src/components/markdown-cache.tsx` | import `{ escapeHtml }`（M3 已共享，不重复定义） |
| **WorkArtifactContent（路由集成点）** | `packages/app/src/pages/work-artifact-panel.tsx:187` | 改：`<Markdown text={candidate()!} />` -> 格式路由条件渲染 HtmlArtifact / Markdown |
| **候选稿提取** | `packages/app/src/pages/work-artifact-extract.ts` | 改：加 detectArtifactFormat + extractHtmlBlock + draftFilename .html（现有 findLatestAssistantMarkdown / extractFirstHeading / draftFilename 不破坏） |
| **SYSTEM_PROMPT** | `packages/core/src/agent/prompt/work-orchestrator.ts:23` | 改：步骤5 Mermaid 段后追加 HTML 指引（不删现有 Mermaid 段） |
| **work-orchestrator 测试** | `packages/core/test/work-orchestrator.test.ts` | 扩展：SYSTEM_PROMPT 含 "```html" + "interactive visualizations" + "vis-network" |
| **work-artifact-panel apply** | `packages/app/src/pages/work-artifact-panel.tsx:103-158` | 不改 apply 逻辑；draftFilename 支持 .html 后 apply 自动写 .html |
| **i18n parity** | `packages/app/src/i18n/parity.test.ts` | 约束 en/zh/zht 三 locale |
| **现有 i18n key** | `packages/app/src/i18n/en.ts` + zh.ts + zht.ts | 已有 `work.artifact.*`（M1）；M3.5 加 `work.artifact.html.*` |
| **CSP（不改）** | `packages/aigcfroge/src/server/shared/ui.ts:12` | 不改：HTML 在 iframe sandbox 内，独立 CSP，不触发全局 |
| **session-ui 测试环境** | `packages/session-ui/bunfig.toml` + `happy-dom-setup.ts` | happy-dom 20.11.1；支持 iframe + `?raw` import |
| **TabsV2 组件** | `@aigcfroge/ui/v2/tabs-v2` | Code/Preview 两 Tab 用 TabsV2（work-artifact-panel.tsx 已 import WorkSessionPanel 用 TabsV2 参考） |

## 4. 修改文件清单

```
packages/session-ui/src/components/html-artifact-srcdoc.ts        新增：buildSrcdoc + sanitizeHtmlLite + STORAGE_POLYFILL + CSP_META
packages/session-ui/src/components/html-artifact-srcdoc.test.ts   新增：TDD 红测试（buildSrcdoc + sanitizeHtmlLite）
packages/session-ui/src/components/html-artifact.tsx               新增：HtmlArtifact 组件（iframe + Code/Preview + onerror）
packages/session-ui/src/components/html-artifact.test.tsx          新增：组件测试（it.live，sandbox 断言 + onerror）
packages/session-ui/src/components/chart-libs.ts                   新增：?raw import vis-network + chart.js + resolveLibs
packages/session-ui/package.json                                   修改：新增 vis-network + chart.js 依赖
packages/app/src/pages/work-artifact-extract.ts                    修改：detectArtifactFormat + extractHtmlBlock + draftFilename .html
packages/app/src/pages/work-artifact-extract.test.ts               新增/扩展：格式检测 + 提取 + 文件名测试
packages/app/src/pages/work-artifact-panel.tsx                     修改：WorkArtifactContent 格式路由
packages/core/src/agent/prompt/work-orchestrator.ts                修改：步骤5 加 HTML 指引
packages/core/test/work-orchestrator.test.ts                       扩展：SYSTEM_PROMPT 含 HTML 指引
packages/app/src/i18n/en.ts + zh.ts + zht.ts                       修改：work.artifact.html.* 文案
packages/app/e2e/regression/work-html-artifact.spec.ts             新增：Playwright e2e
```

**不改的文件**：mermaid.ts / markdown.tsx / markdown-cache.tsx / marked.tsx / work-asset-capture.ts / artifact.ts / ui.ts / work-preset.ts（现有 4 preset 不改）。

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase A - HTML iframe sandbox + 三重防线（2d）

1. **红**：
   - 新建 `packages/session-ui/src/components/html-artifact-srcdoc.test.ts`：
     - `buildSrcdoc(html, libs)` 输出含 CSP meta（`connect-src 'none'`）+ Storage Polyfill（`window.localStorage =`）+ 库内联 `<script>...</script>`
     - `sanitizeHtmlLite(html)` 剥离 `<script src="...">` / `javascript:` / `onload=` / `onclick=`
     - Storage Polyfill 脚本正确替换 localStorage 为内存 Map（getItem/setItem/removeItem/clear）
   - 新建 `packages/session-ui/src/components/html-artifact.test.tsx`（`it.live`，happy-dom）：
     - HtmlArtifact 渲染 `<iframe>` 且 `sandbox` 属性 == `"allow-scripts"`（**断言不含 `allow-same-origin`**）
     - iframe `csp` 属性含 `connect-src 'none'`
     - srcdoc 含 CSP meta + Storage Polyfill
     - onerror 触发 -> ErrorBanner 显示 + 切 Code Tab
2. **绿**：
   - 新建 `html-artifact-srcdoc.ts`（buildSrcdoc + sanitizeHtmlLite + STORAGE_POLYFILL + CSP_META，§5.1 参考代码）
   - 新建 `html-artifact.tsx`（HtmlArtifact 组件，§5.2 参考代码）
   - 新建 `chart-libs.ts`（`?raw` import + resolveLibs）
   - `bun add vis-network chart.js` in session-ui
3. **重构**：
   - 确认 iframe sandbox 不含 allow-same-origin（测试断言已覆盖）
   - CSP_META 单一常量（buildSrcdoc 与落盘 .html 复用）
   - Storage Polyfill 在 head 最前（CSP meta 后、库脚本前）
4. **退出**：`bun --cwd packages/session-ui test --timeout 30000` 绿；`bun --cwd packages/session-ui typecheck` 绿

### Phase B - 格式路由 + SYSTEM_PROMPT + 图表库（2d）

1. **红**：
   - 新建/扩展 `work-artifact-extract.test.ts`：
     - `detectArtifactFormat("```html\n<div></div>\n```")` == "html"
     - `detectArtifactFormat("# PRD\n...")` == "markdown"
     - `extractHtmlBlock` 提取 ```html 块内容 + 兼容 `<artifact type="html">` 标签
     - `draftFilename` 对 HTML 候选稿返回 .html，对 Markdown 返回 .md（向后兼容）
   - 扩展 `work-orchestrator.test.ts`：SYSTEM_PROMPT 含 "```html" + "interactive visualizations" + "vis-network" + "chart.js"
   - 组件测试：候选含 ```html -> WorkArtifactContent 渲染 HtmlArtifact；否则渲染 Markdown
2. **绿**：
   - `work-artifact-extract.ts` 加 detectArtifactFormat + extractHtmlBlock + draftFilename .html
   - `work-artifact-panel.tsx` WorkArtifactContent 加格式路由（§5.3 参考代码）
   - `work-orchestrator.ts` 步骤5 加 HTML 指引（§2.5 D5）
3. **重构**：格式检测函数集中 work-artifact-extract.ts；路由单一出口；HtmlArtifact 不耦合提取
4. **退出**：core + app test 绿；typecheck 绿；候选含 ```html -> HtmlArtifact；不含 -> Markdown（M1/M3 无回归）

### Phase C - 落盘 .html + 存为资产 + i18n（1.5d）

1. **红**：
   - draftFilename .html 向后兼容测试（HTML->.html，Markdown->.md）
   - apply 落盘 .html 含 CSP meta + 免责声明测试
   - parity.test.ts：en/zh/zht 补 `work.artifact.html.preview`/`code`/`renderError`/`viewCode`
2. **绿**：
   - draftFilename 支持 .html；apply 对 HTML 注入 CSP meta + 免责注释
   - i18n 三 locale 补文案
3. **重构**：落盘 CSP meta 复用 buildSrcdoc 的 CSP_META（不重复定义）
4. **退出**：apply 测试绿；parity 通过；落盘 .html 含 CSP meta

### Phase D - 端到端 + 安全测试 + 打磨（1.5d）

1. **红**：
   - 新建 `packages/app/e2e/regression/work-html-artifact.spec.ts`（Playwright）：Work 候选含 ```html（vis-network 拓扑）-> Preview Tab 渲染 `iframe[sandbox="allow-scripts"]` -> 切 Code Tab -> apply 写 .html
   - 安全测试：iframe sandbox 不含 allow-same-origin；connect-src 'none'；localStorage 调用不抛 SecurityError
2. **绿**：端到端联调；修 iframe 时序、库内联、主题对齐（iframe 内 HTML 用 v2 token CSS var，frontend-theming skill）
3. **重构**：iframe 尺寸自适应（ResizeHandle 对齐 code/chat B 区）；ErrorBanner 用 v2 token；M1/M2/M3 无回归
4. **退出**：端到端通过；`tsgo -b`（app）+ `tsgo --noEmit`（core/session-ui）+ `bun run lint` + 全包 test 绿；改完即审 7 步

### 5.1 buildSrcdoc 参考实现

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

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none';">`

export function buildSrcdoc(html: string, libs: string[]): string {
  const libScripts = libs.map((lib) => `<script>${lib}</script>`).join("\n")
  return `<!DOCTYPE html><html><head>${CSP_META}${STORAGE_POLYFILL}${libScripts}</head><body>${html}</body></html>`
}

export function sanitizeHtmlLite(html: string): string {
  return html
    .replace(/<script[^>]*\ssrc=["'][^"']*["'][^>]*><\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
}
```

### 5.2 HtmlArtifact 组件参考实现

```tsx
import { createMemo, createSignal, Show } from "solid-js"
import { buildSrcdoc, sanitizeHtmlLite } from "./html-artifact-srcdoc"
import { resolveLibs } from "./chart-libs"
import { useLanguage } from "@aigcfroge/ui/context/i18n"

export function HtmlArtifact(props: { html: string }) {
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

### 5.3 work-artifact-panel.tsx 格式路由参考

```tsx
// WorkArtifactContent return 部分改为：
<Show when={candidate()}>
  <ScrollView class="min-h-0 flex-1">
    <div class="flex flex-col gap-3 p-3">
      <Show when={detectArtifactFormat(candidate()!) === "html"} fallback={<Markdown text={candidate()!} />}>
        <HtmlArtifact html={extractHtmlBlock(candidate()!) ?? ""} />
      </Show>
      <div class="flex gap-2">
        {/* apply + save-asset 按钮不变 */}
      </div>
    </div>
  </ScrollView>
</Show>
```

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）
```bash
bun --cwd packages/session-ui test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/session-ui typecheck       # tsgo --noEmit
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck              # tsgo -b
bun run lint
```

### 6.2 三模式选择
| 模式 | 何时用 |
|---|---|
| `it.live` | HtmlArtifact 组件测试（真实 async + happy-dom DOM，iframe 渲染） |
| 普通 `it` | buildSrcdoc / sanitizeHtmlLite / detectArtifactFormat / extractHtmlBlock 纯函数 |
| E2E | Work 候选含 ```html -> iframe 渲染 -> Code/Preview 切换 -> apply .html（Playwright） |

### 6.3 硬性规则
- **iframe sandbox 测试必须断言 `sandbox="allow-scripts"` 且不含 `allow-same-origin`**（安全门禁）
- **CSP 测试必须断言 srcdoc 含 `connect-src 'none'`**（防外泄门禁）
- **Storage Polyfill 测试必须断言 head 含 `window.localStorage =`**（防崩溃门禁）
- 测试实际渲染（iframe 元素 + srcdoc 内容），不 mock
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- happy-dom 20.11.1 支持 iframe + `?raw` import

## 7. SolidJS / 编码规范
- M3.5 主要写 SolidJS 组件 + DOM 操作 + 字符串构造，基本不写 Effect 代码
- 新代码用 `export * as Foo from "./foo"` 自导出；禁 namespace/别名 import/star import（AGENTS.md §Imports）
- iframe srcdoc 是字符串拼接，注意 HTML 转义（用户 HTML 内容经 sanitizeHtmlLite 后直接嵌入 body）
- `?raw` import 是 Vite 特性，将文件内容作为字符串导入（`import x from "lib?raw"` -> x 是源码字符串）
- 图表库源码较大（vis-network ~200KB），inline 注入导致 srcdoc 膨胀，但可接受（单候选稿 < 500KB）
- 主题对齐：iframe 内 HTML 用 v2 token CSS var 字符串（`var(--v2-*)`，对齐 frontend-theming skill）

## 8. 分支与提交规范
- 分支：`work-m3.5`（从最新 main 切出；≤3 词、连字符、无斜杠无类型前缀）
- commit：`type(scope): summary`；scope 用 `session-ui`/`app`/`core`
- 每完成一个 Phase 一个 commit（`feat(session-ui): ...` / `feat(app): ...` / `feat(core): ...`），不批量
- `.husky/pre-push` 会跑 `bun typecheck`--push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）
- [ ] `vis-network` + `chart.js` 装入 session-ui（`?raw` import）
- [ ] `buildSrcdoc` 输出含 CSP meta（`connect-src 'none'`）+ Storage Polyfill + 库内联 `<script>`
- [ ] `sanitizeHtmlLite` 剥离外部 `<script src>` / `javascript:` / `on*` 事件
- [ ] HtmlArtifact 渲染 `<iframe sandbox="allow-scripts">`（**断言无 allow-same-origin**）
- [ ] iframe 原生 `csp=` 属性 + srcdoc `<meta>` 双重 CSP（`connect-src 'none'`）
- [ ] Storage Mock Polyfill 注入 head 最前（localStorage 调用不抛 SecurityError）
- [ ] 图表库 Inline Script Injection（库源码内联，零 HTTP，规避 CORS）
- [ ] `detectArtifactFormat`：含 ```html -> "html"；否则 "markdown"
- [ ] `extractHtmlBlock`：```html 首选 + `<artifact type="html">` 兼容
- [ ] WorkArtifactContent 格式路由：```html -> HtmlArtifact；否则 Markdown（M1/M3 无回归）
- [ ] Code/Preview 两 Tab 切换
- [ ] iframe onerror -> ErrorBanner + 一键切 Code（不白屏）
- [ ] work-orchestrator SYSTEM_PROMPT 含 HTML 指引（vis-network/chart.js/自包含），Mermaid 指引保留
- [ ] draftFilename 对 HTML 候选稿返回 .html，对 Markdown 返回 .md（向后兼容）
- [ ] apply 落盘 .html 含 CSP meta + 免责声明
- [ ] 存为资产（M2）链路无回归
- [ ] M1 Markdown / M3 Mermaid 渲染器无回归（mermaid.ts/markdown.tsx/markdown-cache.tsx 未改）
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck（tsgo -b app + tsgo --noEmit core/session-ui）+ lint + test 全绿

## 10. 改完即审（每 Phase 结束必须执行）
1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查（**三重防线逐项**）：
   - Catch Everything：iframe onerror 降级不白屏
   - No Null Pointer：extractHtmlBlock `?? ""` 空值守卫
   - Security First：**① sandbox 无 allow-same-origin；② connect-src 'none'；③ Storage Polyfill 注入**（三条硬断言）
3. 整洁复查：No Cheating（无 as any/@ts-ignore）/ Reusability（escapeHtml 复用 markdown-cache，CSP_META 单一常量）/ Clean Logs
4. 数据流追踪：候选稿 -> detectArtifactFormat -> extractHtmlBlock -> sanitizeHtmlLite -> buildSrcdoc（CSP+Polyfill+libs）-> iframe srcdoc -> 渲染；确认格式路由单一出口；确认 M1/M3 路径不受影响
5. 输出复查结论：
```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:（三重防线逐项确认）
- 工程门禁:
- 已运行命令:
- 剩余风险:
```

## 11. 禁止事项（八荣九耻）
- **禁加 allow-same-origin**--iframe 共享 app origin，加 = XSS 升级（§1.2 硬禁区）
- **禁删 connect-src 'none'**--防数据外泄（§1.2 硬禁区）
- **禁省 Storage Polyfill**--防 SecurityError 崩溃（§1.2 硬禁区）
- **禁用 `<script src>` 加载库**--null origin CORS 阻断；必须 Inline Injection（§1.2 硬禁区）
- 禁瞎猜接口--查 `codegraph`（MCP）或 grep 确认后再写。**特别核实**：mermaid.ts 渲染器模式、work-artifact-panel.tsx:187 Markdown 集成点、work-artifact-extract.ts 提取模式
- 禁模糊执行--任务不清停下来问，不自我感动式盲目执行
- 禁创造接口--先查 owner module 能否复用（escapeHtml / TabsV2 / Markdown 组件都有现成）
- 禁跳过验证--改完必须跑对应包 test（session-ui/core/app）
- 禁破坏架构--遵循 ADR-11~15 + AGENTS.md 分层；新代码用 `export * as Foo` 自导出
- 禁假装理解--未知技术栈承认并向人类求助
- 禁长注释--默认无注释，仅 WHY 非显然处加一行
- 禁混入方向 ②③--highlight-to-edit / 版本滑块是 M4+，不混入 M3.5
- 禁改 mermaid.ts/markdown.tsx/markdown-cache.tsx/marked.tsx--M1/M2/M3 零回归
- 禁引 CDN--库 self-hosted `?raw` import 内联
- 禁做 SVG/React 渲染器--远期，渲染器注册表预留

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行建议主力模型） |
| 新对话打开文件 | `docs/plan/work-mode-execution-layer-m3.5.md`（范围真源）+ 本文件 |
| 开工顺序 | 通读 CLAUDE.md/AGENTS.md/frontend-theming skill -> git 切 `work-m3.5` -> Phase A 红测试开始 |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁）。特别回报：三重防线是否全绿、iframe sandbox 是否含 allow-same-origin |
| 跨包顺序 | Phase A 先 session-ui（html-artifact + srcdoc + chart-libs 测试）；Phase B session-ui + app（路由）+ core（prompt）；Phase C app（落盘 + i18n）；Phase D app e2e |
| 安全门禁 | 每个涉及 iframe 的 commit 必须确认三重防线（sandbox 无 same-origin / connect-src none / Polyfill 注入），测试断言全绿才提交 |
