import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/GlobalShellPresentation"
const sessionID = "ses_global_shell_presentation"
const created = 1700000000000

async function mount(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: "proj_global_shell_presentation",
      worktree: directory,
      vcs: "git",
      name: "global-shell-presentation",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID: "proj_global_shell_presentation",
        directory,
        title: "Global shell presentation",
        mode: "chat",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await gotoWhenReady(page, `/${base64Encode(directory)}/session/${sessionID}`)
}

// RED 2026-09-14 update: the S4 host-alias fix landed the legacy redirect chain —
// the canonical session detail page renders (title resolves). Remaining blocker:
// chat-* collapse controls do not render on the session DETAIL route
// (chatTarget/routeContribution registration on the detail route) — a chat
// sidebar architecture question owned by S7, not a routing defect.
test.fixme(
  "keeps Project, Feature, and Session controls reachable across locale and viewport projects",
  { tag: "@presentation" },
  async ({ page }) => {
    await mount(page)

    const sidebar = page.getByRole("complementary")
    if (!(await sidebar.isVisible())) {
      await page.getByRole("button", { name: /secondary|sidebar|次级|側邊/i }).click()
    }
    await expect(sidebar).toBeVisible()
    const controls = sidebar.locator('button[aria-controls^="chat-"]')
    await expect(controls).toHaveCount(3)
    await expect(controls.nth(0)).toHaveAttribute("aria-controls", "chat-project-content")
    await expect(controls.nth(1)).toHaveAttribute("aria-controls", "chat-feature-content")
    await expect(controls.nth(2)).toHaveAttribute("aria-controls", "chat-session-content")

    for (let index = 0; index < 3; index += 1) {
      await controls.nth(index).focus()
      await page.keyboard.press("Enter")
      await expect(controls.nth(index)).toHaveAttribute("aria-expanded", "false")
    }
    await expect(sidebar.getByRole("button", { name: /New session|新建会话|新增工作階段/i })).toBeVisible()
  },
)
