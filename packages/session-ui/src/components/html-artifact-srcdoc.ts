/**
 * srcdoc 构造 + 安全防线（M3.5 D2/D3）：
 *  - CSP meta（connect-src 'none'，防数据外泄）
 *  - Storage Mock Polyfill（sandbox 无 allow-same-origin 时 localStorage 抛
 *    SecurityError 会挂起脚本，head 最前注入内存 Map 垫片）
 *  - 图表库源码内联（null origin 下 <script src> 被 CORS 阻断，零 HTTP）
 * 深度 sanitize 不可靠，sandbox + CSP 才是最终保障；sanitizeHtmlLite 只做
 * 轻量预处理（剥外部 script src / javascript: URL / 事件处理器）。
 */

export const STORAGE_POLYFILL = `<script>
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

export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none';">`

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

export * as HtmlArtifactSrcdoc from "./html-artifact-srcdoc"
