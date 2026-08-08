import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// M3.5: Work 候选稿含 ```html fenced block 时，右栏 Artifact Tab 路由到
// HtmlArtifact 渲染器：iframe sandbox（三重防线）+ Code/Preview 两 Tab。
// 候选稿 = assistant 消息正文（M1 载体）；apply 落盘 .html（含 CSP + 免责）。
const directory = "C:/Aigcfroge/WorkHtml"
const sessionID = "ses_work_html"
const title = "Work html artifact"

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const session = {
  id: sessionID,
  slug: "work-html",
  projectID: "proj_work_html",
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
  id: "proj_work_html",
  worktree: directory,
  vcs: "git",
  name: "WorkHtml",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const topologyHtml = `<div id="topo" style="width:480px;height:320px"></div>
<script>
  var nodes = new vis.DataSet([{ id: 1, label: "核心" }, { id: 2, label: "边缘" }]);
  var edges = new vis.DataSet([{ from: 1, to: 2 }]);
  new vis.Network(document.getElementById("topo"), { nodes: nodes, edges: edges }, {});
</script>`

const htmlDraft = `# 团队拓扑

\`\`\`html
${topologyHtml}
\`\`\`

说明：核心节点与边缘节点的连接关系。
`

const draftMessage = (draftText: string) => ({
  info: {
    id: "msg_draft_1",
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
  parts: [{ id: "prt_draft_1", sessionID, messageID: "msg_draft_1", type: "text", text: draftText }],
})

async function mockServer(page: Page, draftText: string) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [draftMessage(draftText)] }),
    events: () => [],
    eventRetry: 16,
  })
}

function sandboxedFrame(page: Page) {
  return page.frames().find((frame) => frame !== page.mainFrame() && frame.url().startsWith("about:srcdoc"))
}

test("html candidate renders an iframe with the triple defense and interactive vis-network", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockServer(page, htmlDraft)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  // Html mode routes the panel to the artifact renderer (no Markdown heading).
  await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible({ timeout: 15_000 })

  const iframe = page.locator('iframe[sandbox="allow-scripts"]')
  await expect(iframe).toBeVisible({ timeout: 15_000 })

  // Defense 1: sandbox is exactly allow-scripts, never allow-same-origin.
  expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts")

  // Defense 2: iframe csp attribute + srcdoc CSP meta both block connect-src.
  expect(await iframe.getAttribute("csp")).toContain("connect-src 'none'")
  const srcdoc = (await iframe.getAttribute("srcdoc")) ?? ""
  expect(srcdoc).toContain('<meta http-equiv="Content-Security-Policy"')
  expect(srcdoc).toContain("connect-src 'none'")
  expect(srcdoc).not.toContain('<script src=')

  // Defense 3: storage polyfill injected so localStorage never throws.
  expect(srcdoc).toContain('Object.defineProperty(window, "localStorage"')

  // D3: vis-network source is inlined (chart library works inside the sandbox).
  expect(srcdoc).toContain("A dynamic, browser-based visualization library.")

  const frame = sandboxedFrame(page)
  expect(frame).toBeDefined()
  // The interactive renderer drew the topology (vis-network injected and ran).
  await expect(frame!.locator("canvas")).toBeVisible({ timeout: 15_000 })
  // Storage polyfill functional: setItem/getItem round-trip without SecurityError.
  const stored = await frame!.evaluate(() => {
    localStorage.setItem("vis-state", "saved")
    return localStorage.getItem("vis-state")
  })
  expect(stored).toBe("saved")
})

test("code tab shows the raw html source and apply writes an .html with the csp guard", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockServer(page, htmlDraft)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toBeVisible({ timeout: 15_000 })

  await page.getByRole("tab", { name: "Code" }).click()
  await expect(page.locator('[data-component="html-artifact-code"]')).toBeVisible()
  await expect(page.locator('[data-component="html-artifact-code"]')).toContainText("new vis.Network")

  const applied = page.waitForResponse(
    (response) =>
      response.url().includes(`/session/${sessionID}/work-artifact/apply`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Apply to project" }).click()
  const response = await applied
  expect(response.status()).toBe(200)

  const payload = response.request().postDataJSON()
  expect(payload.relativePath).toBe("团队拓扑.html")
  expect(payload.content).toContain("<!-- Generated by AigcForge Work mode. Review before sharing. -->")
  expect(payload.content).toContain("connect-src 'none'")
  expect(payload.content).toContain('<div id="topo"')
  expect(payload.content).not.toContain("```html")

  await expect(page.getByText("Applied", { exact: true })).toBeVisible()
})
