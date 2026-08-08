import { createMemo, createResource, createSignal, Show } from "solid-js"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { getSharedHighlighter } from "@pierre/diffs"
import { escapeHtml } from "./markdown-cache"
import { buildSrcdoc, sanitizeHtmlLite } from "./html-artifact-srcdoc"
import { resolveLibs } from "./chart-libs"

export type HtmlArtifactLabels = {
  preview: string
  code: string
  renderError: string
  viewCode: string
}

const IFRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';"

/**
 * HTML artifact 渲染器（M3.5）：iframe sandbox（三重防线）+ Code/Preview 两 Tab。
 *  - 防线 1：sandbox="allow-scripts"，绝不加 allow-same-origin（iframe 共享 app
 *    origin，加了 = 父 DOM/cookie 可读 = XSS 升级）
 *  - 防线 2：iframe csp 属性 + srcdoc <meta> 双重 CSP（connect-src 'none' 防外泄）
 *  - 防线 3：Storage Mock Polyfill（buildSrcdoc 注入，防 SecurityError 崩溃）
 *  - 图表库：resolveLibs 检测 vis./Chart 全局，源码内联注入（规避 null origin CORS）
 */
export function HtmlArtifact(props: { html: string; labels: HtmlArtifactLabels }) {
  const [tab, setTab] = createSignal<"code" | "preview">("preview")
  const [renderError, setRenderError] = createSignal(false)

  const srcdoc = createMemo(() => {
    const clean = sanitizeHtmlLite(props.html)
    return buildSrcdoc(clean, resolveLibs(props.html))
  })

  const switchTab = (value: string) => {
    setTab(value === "code" ? "code" : "preview")
    if (value === "preview") setRenderError(false)
  }

  return (
    <div class="flex h-full min-h-0 flex-col" data-component="html-artifact">
      <TabsV2 value={tab()} onChange={switchTab}>
        <TabsV2.List class="shrink-0">
          <TabsV2.Trigger value="preview">{props.labels.preview}</TabsV2.Trigger>
          <TabsV2.Trigger value="code">{props.labels.code}</TabsV2.Trigger>
        </TabsV2.List>
        <TabsV2.Content value="preview" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show
            when={!renderError()}
            fallback={<ErrorBanner labels={props.labels} onViewCode={() => setTab("code")} />}
          >
            <iframe
              sandbox="allow-scripts"
              csp={IFRAME_CSP}
              srcdoc={srcdoc()}
              title={props.labels.preview}
              class="h-full w-full border-0"
              onError={() => setRenderError(true)}
            />
          </Show>
        </TabsV2.Content>
        <TabsV2.Content value="code" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CodeView code={props.html} />
        </TabsV2.Content>
      </TabsV2>
    </div>
  )
}

function ErrorBanner(props: { labels: HtmlArtifactLabels; onViewCode: () => void }) {
  return (
    <div class="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 text-center">
      <p class="text-v2-text-text-muted text-13-regular">{props.labels.renderError}</p>
      <button
        type="button"
        class="text-v2-text-text-base rounded-md border border-v2-border-border-base px-3 py-1.5 text-13-medium hover:bg-v2-background-bg-accent"
        onClick={props.onViewCode}
      >
        {props.labels.viewCode}
      </button>
    </div>
  )
}

/** Code Tab：shiki 语法高亮（复用 marked 的 Aigcfroge 共享高亮器），失败降级为纯文本。 */
function CodeView(props: { code: string }) {
  const [html] = createResource(
    () => props.code,
    async (code) => {
      try {
        const highlighter = await getSharedHighlighter({
          themes: ["Aigcfroge"],
          langs: [],
          preferredHighlighter: "shiki-wasm",
        })
        const language = "html"
        if (!highlighter.getLoadedLanguages().includes(language)) await highlighter.loadLanguage(language)
        return highlighter.codeToHtml(code, { lang: language, theme: "Aigcfroge", tabindex: false })
      } catch (error) {
        console.error("[html-artifact] highlight failed, fallback to plain source", error)
        return `<pre class="shiki Aigcfroge"><code class="language-html">${escapeHtml(code)}</code></pre>`
      }
    },
  )
  return (
    <div class="min-h-0 flex-1 overflow-auto p-3" data-component="html-artifact-code" innerHTML={html()} />
  )
}
