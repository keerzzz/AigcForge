import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

// M2 存为资产：Work 候选稿 -> "存为资产" -> setProposeCandidate 注入 Chat propose store。
// 不自动切 mode（session 页以 session.mode 为权威，app.tsx session effect 锁回）：
// ChatRightPanel 是 render-all 常驻（display:none 时仍在 DOM），store 注入后审查 UI 自动渲染，
// 用户手动切 Chat 后可见。apply 落盘由 Chat 既有链路覆盖。
const directory = "C:/Aigcfroge/WorkAssetSave"
const sessionID = "ses_work_asset_save"
const title = "Work asset save"
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }
const draftText = "# 视频分镜脚本\n\n第一段：明确主题与时长。\n\n第二段：细化分镜。"

const session = {
  id: sessionID,
  slug: "work-asset-save",
  projectID: "proj_work_asset_save",
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
  id: "proj_work_asset_save",
  worktree: directory,
  vcs: "git",
  name: "WorkAssetSave",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const draftMessage = {
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
}

async function mockServer(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [draftMessage] }),
    events: () => [],
    eventRetry: 16,
  })
}

test("work draft -> save as asset injects the candidate into the chat propose store", async ({ page }) => {
  // M2 D6: work mode boot (no flag involved), then the artifact tab shows the draft.
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  await mockServer(page)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  // 右栏 Artifact Tab 显示候选稿 + 存为资产按钮（D4：候选存在 + 未 applied）。
  // ButtonV2 强制 data-component="button-v2"（覆盖自定义值），用文案定位按钮。
  const saveButton = page.getByRole("button", { name: "Save as asset" })
  await expect(saveButton).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("heading", { name: "视频分镜脚本" }).first()).toBeVisible()

  // 点击 -> captureWorkArtifactAsCandidate -> setProposeCandidate（store 注入）。
  // ChatRightPanel 是 render-all 常驻：work mode 下 display:none 但 DOM 已渲染，
  // 注入后 status="valid" 分支（Ready to apply）自动出现在 DOM 中。
  await saveButton.click()
  await expect(page.getByText("Ready to apply")).toBeAttached({ timeout: 15_000 })
  await expect(page.getByText("Ready to apply")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(1)

  // 不自动切 mode：mode 仍为 work（session 页以 session.mode 为权威）。
  const storedMode = await page.evaluate(() => localStorage.getItem("aigcfroge.global.dat:mode-view"))
  expect(storedMode).toContain("work")

  // A work candidate carries `exists: false` and an empty `relativePath`
  // (work-asset-capture.ts:52) — apply derives the path from the name server-side.
  // So the review pane shows the plain preview, not the overwrite branch with its
  // diff: there is no existing file to diff against.
  await expect(page.getByText("File already exists")).toHaveCount(0)
})
