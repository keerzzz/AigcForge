import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * S3-3 regression guard: `ChatFeatureList` renders in TWO places, and they are not
 * nested — the mode workspace (`/mode/chat`) and the session secondary sidebar
 * (`secondary-sidebar.tsx` → `ChatSessionSidebar`), which `layout.tsx` mounts as a
 * sibling of the route outlet. When the sidebar's own asset resource was removed, the
 * sidebar path lost its provider and rendered no badges at all, silently.
 *
 * This case exists to fail if that happens again: it drives the SESSION route (not the
 * mode route), opens the secondary sidebar, and requires the counts to be there. It is
 * paired with `useChatAssets()` throwing outside its provider, so the mistake surfaces
 * at the mount site rather than as an empty list.
 */
const directory = "C:/Aigcfroge/ChatSessionSidebarCounts"
const sessionID = "ses_chat_session_sidebar_counts"
const sessionTitle = "Chat session sidebar counts"
const project = {
  id: "proj_chat_session_sidebar_counts",
  worktree: directory,
  vcs: "git",
  name: "chat-session-sidebar-counts",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  sandboxes: [],
}
const session = {
  id: sessionID,
  slug: "chat-session-sidebar-counts",
  projectID: project.id,
  directory,
  mode: "chat",
  agent: "meta",
  title: sessionTitle,
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

const categories = [
  ["Prompts", "prompt", "prompt-one", "/prompt-asset"],
  ["Skills", "skill", "skill-one", "/skill-asset"],
  ["MCP", "mcp", "mcp-one", "/mcp-asset"],
  ["Commands", "command", "command-one", "/command-asset"],
  ["Agents", "agent", "agent-one", "/agent-asset"],
  ["Workflows", "workflow", "workflow-one", "/workflow-asset"],
  ["Plugins", "plugin", "plugin-one", "/plugin-asset"],
] as const

async function openSessionWithSidebar(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  await page.route(
    (url) => url.port === apiPort && categories.some((entry) => entry[3] === url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      const entry = categories.find((category) => category[3] === path)
      if (!entry) return route.fallback()
      const [, kind, name] = entry
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assets: [
            {
              kind,
              name,
              description: `${kind} description`,
              relativePath: `${kind}-one.asset`,
              revision: "a".repeat(64),
            },
          ],
          invalid: [],
          ...(kind === "plugin" ? { bridged: [] } : {}),
        }),
      })
    },
  )

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  // `page.goto`, not `gotoWhenReady`: that helper's readiness predicate polls
  // `/@vite/client` from inside the test and intermittently times out at 120s on this
  // host while the same URL answers in ~25ms from a shell (three occurrences in one
  // session, registered in docs/technical-debt.md). The sibling spec
  // `chat-asset-categories.spec.ts` navigates directly for the same reason.
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))

  // Opened through its own control rather than a seeded storage key: the sidebar is
  // closed by default for a fresh profile (context/mode.tsx), and the toggle is the
  // supported path (same approach as the presentation spec).
  const toggle = page.getByRole("button", {
    name: /Show sidebar|Hide sidebar|显示侧边栏|隐藏侧边栏|顯示側邊欄|隱藏側邊欄/i,
  })
  await expect(toggle).toBeVisible()
  if (!/hide|隐藏|隱藏/i.test((await toggle.getAttribute("aria-label")) ?? "")) await toggle.click()
}

test("the session secondary sidebar shows the Chat feature counts", async ({ page }) => {
  await openSessionWithSidebar(page)

  const sidebar = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(sidebar).toBeVisible()

  // The regression signal is presence: every category has a non-zero count, so every
  // label renders with a badge. The exact number is deliberately not pinned here —
  // server-sync system rows (command/agent/mcp) can add to a kind, and this case is
  // about the sidebar having counts at all, not about their arithmetic (which
  // `chat-asset-categories.spec.ts` covers on the workspace side).
  const counted = sidebar.getByRole("button", {
    name: /^(Prompts|Skills|MCP|Commands|Agents|Workflows|Plugins)\s+\d+$/,
  })
  await expect(counted).toHaveCount(categories.length)
})
