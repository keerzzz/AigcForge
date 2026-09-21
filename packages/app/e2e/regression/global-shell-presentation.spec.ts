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

// S7 (2026-09-16): the S0/S4 notes here blamed the route contribution —
// "chat-* controls do not render on the session DETAIL route". Measured, that is
// wrong on both counts, and the second count is why the earlier runs failed:
//
// 1. The contribution registers on the detail route and `ChatSessionSidebar`
//    renders all three sections. The secondary sidebar simply starts CLOSED for a
//    fresh profile (`context/mode.tsx:100-104`, a deliberate default so mode home
//    pages keep their own left column).
// 2. `getByRole("complementary")` is not unique. This repo renders three implicit
//    `aside` elements on a session route (the secondary sidebar, the review panel
//    and the debug bar), so a strict locator on the bare role resolves to 3 and
//    fails; the old precondition asked `isVisible()` on that non-unique locator,
//    which never matched the sidebar it meant, skipped the toggle, and then looked
//    for chat controls in the wrong region. The sidebar has a stable accessible
//    name (`sidebar.secondary.projectList`), so the locator is scoped by name.
//
// No product change was needed for either: the route contribution and the sidebar
// were already correct.
test(
  "keeps Project, Feature, and Session controls reachable across locale and viewport projects",
  { tag: "@presentation" },
  async ({ page }) => {
    await mount(page)

    // The toggle's accessible name comes from `sidebar.secondary.show|hide`
    // (titlebar.tsx:941), so it matches per locale rather than by position.
    const toggle = page.getByRole("button", {
      name: /Show sidebar|Hide sidebar|显示侧边栏|隐藏侧边栏|顯示側邊欄|隱藏側邊欄/i,
    })
    await expect(toggle).toBeVisible()
    if (!/hide|隐藏|隱藏/i.test((await toggle.getAttribute("aria-label")) ?? "")) {
      await toggle.click()
    }

    const sidebar = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
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
