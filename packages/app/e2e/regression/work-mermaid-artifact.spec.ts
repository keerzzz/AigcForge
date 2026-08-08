import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// M3 L1: Work 候选稿中的 ```mermaid 代码块在右栏 Artifact Tab 渲染为 SVG。
// 候选稿 = assistant 消息正文（M1 载体）；渲染链路 = marked-shiki highlight
// 拦截 -> data-mermaid 占位符 -> 全局 sanitize -> renderMermaidBlocks -> SVG。
// mermaid 输出 svg 带 aria-roledescription（role="graphics-document document"，
// 双值无法用精确属性选择器），是该图表的稳定判别选择器（页面其它 svg 无此属性）。
const directory = "C:/Aigcfroge/WorkMermaid"
const sessionID = "ses_work_mermaid"
const title = "Work mermaid artifact"

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const session = {
  id: sessionID,
  slug: "work-mermaid",
  projectID: "proj_work_mermaid",
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
  id: "proj_work_mermaid",
  worktree: directory,
  vcs: "git",
  name: "WorkMermaid",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const prdDraft = `# 用户中心 PRD

## 背景

注册登录流程现状分散，体验不一致。

## 注册流程

\`\`\`mermaid
flowchart TD
  A[访问注册页] --> B{校验邮箱}
  B -- 通过 --> C[创建账号]
  B -- 失败 --> D[提示错误]
\`\`\`

## 验收标准

- [x] 邮箱校验通过后可创建账号
`

const storyboardDraft = `# 分镜脚本

| 镜头 | 画面 | 台词 |
| --- | --- | --- |
| 1 | 城市全景 | 旁白 |

第一段：交代环境。第二段：主角出场。
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

test("work prd draft renders its mermaid block as an svg in the artifact tab", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockServer(page, prdDraft)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.getByRole("heading", { name: "用户中心 PRD" }).first()).toBeVisible({ timeout: 15_000 })

  const diagram = page.locator('svg[aria-roledescription]')
  await expect(diagram).toBeVisible({ timeout: 15_000 })
  await expect(diagram).toContainText("注册")
})

test("storyboard draft without mermaid shows no diagram svg", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockServer(page, storyboardDraft)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.getByRole("heading", { name: "分镜脚本" }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('svg[aria-roledescription]')).toHaveCount(0)
})
