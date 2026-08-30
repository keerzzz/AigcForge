import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 组件渲染单元测试不可行（bun 1.3.14 无法在 bun test 中编译 Solid JSX，
// bun#28605；repo 无组件渲染 harness，见 work-artifact-panel.test.ts 先例）。
// 本文件做源码级契约测试：三重安全防线 + 降级接线的断言由 Phase D Playwright
// e2e 在真实浏览器对真实渲染结果复核。
const component = fs.readFileSync(path.resolve(__dirname, "html-artifact.tsx"), "utf-8")
const srcdocModule = fs.readFileSync(path.resolve(__dirname, "html-artifact-srcdoc.ts"), "utf-8")

describe("HtmlArtifact security contract (M3.5)", () => {
  test("defense 1: the only sandbox attribute rendered is exactly allow-scripts", () => {
    const sandboxUses = component.match(/sandbox\s*=\s*\{?["'][^"']*["']\}?/g) ?? []
    expect(sandboxUses).toContain('sandbox="allow-scripts"')
    expect(sandboxUses.every((use) => use === 'sandbox="allow-scripts"')).toBe(true)
  })

  test("defense 2: iframe csp attribute blocks connect-src and external scripts", () => {
    // Whitespace-tolerant: prettier wraps the assignment across two lines.
    expect(component).toMatch(
      /const IFRAME_CSP =\s+"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none';"/,
    )
    expect(component).toContain("csp={IFRAME_CSP}")
    expect(component).toContain("connect-src 'none'")
    expect(component).toContain("default-src 'none'")
    expect(component).toContain("style-src 'unsafe-inline'")
    expect(component).toContain("img-src 'self' data:")
  })

  test("defense 3: srcdoc is built through buildSrcdoc (CSP meta + storage polyfill)", () => {
    expect(component).toContain("buildSrcdoc(clean, resolveLibs(props.html))")
    expect(srcdocModule).toContain('Object.defineProperty(window, "localStorage"')
    expect(srcdocModule).toContain("connect-src 'none'")
  })

  test("wires onError to the error banner and one-click code switch", () => {
    expect(component).toMatch(/onError=\{\(\) => setRenderError\(true\)\}/)
    expect(component).toContain("ErrorBanner")
    expect(component).toContain("onViewCode")
  })

  test("renders Code/Preview tabs with app-provided labels", () => {
    expect(component).toContain('value="preview"')
    expect(component).toContain('value="code"')
    expect(component).toContain("props.labels.preview")
    expect(component).toContain("props.labels.code")
    expect(component).toContain("props.labels.renderError")
    expect(component).toContain("props.labels.viewCode")
  })

  test("sanitizes before building srcdoc (external script src / on* handlers stripped)", () => {
    expect(component).toContain("sanitizeHtmlLite(props.html)")
  })
})
