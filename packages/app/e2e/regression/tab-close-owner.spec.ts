import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

/**
 * S0 baseline for D-CMD-DUP — `tab.close` has two owners with different behaviour.
 *
 * Reported as a console warning on every session page:
 *   duplicate command id "tab.close" registered; keeping first entry
 *
 * The two registrations do NOT do the same thing:
 *   - `titlebar.tsx:412-420` — `hidden: true`, `mod+w`, closes the TOP-LEVEL tab
 *     (`tabsStoreActions.removeTab`).
 *   - `use-session-commands.tsx:442-446` — visible, `mod+w`, closes `closableTab()`, a tab
 *     INSIDE the session, and is registered only while such a tab exists (`:447` filters
 *     the undefined away).
 *
 * `command.tsx:263-272` keeps the FIRST registration and drops the rest, so once a session
 * has a closable child tab the two collide on one id and one keybind, and only one of them
 * can run.
 *
 * Measured, and it corrects the guess this test started from: the behaviour is currently
 * RIGHT in both contexts. With a context tab open the shortcut closes that tab and keeps
 * the session (so the Session registration is the one that survives), and with no child tab
 * it closes the top-level tab. The live defect is therefore the duplicate registration
 * itself — log noise plus an unpinned dependency on mount order, since nothing guarantees
 * which owner registers first.
 *
 * That also refutes the plan's recommendation to keep the Titlebar owner and delete the
 * Session registration: deleting it is exactly what would break the passing case below.
 * S8a has to re-decide with these three cases as the matrix.
 *
 * The child tab used here is the Context tab, opened the way a user opens it:
 * `message-timeline.tsx:58` renders `SessionContextUsage`, whose button
 * (`session-context-usage.tsx:104-105`, `aria-label` = `context.usage.view`) calls
 * `openSessionContext` → `tabs.open("context")` (`open-session-context.ts:17`).
 * `helpers.ts:65-70` then makes `closableTab()` return `"context"`.
 */
const directory = "C:/Aigcfroge/TabCloseOwner"
const projectID = "proj_tab_close_owner"
const sessionID = "ses_tab_close_owner"
const userMessageID = "msg_user_tab_close"
const title = "Tab close owner"
const created = 1700000000000

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    { id: "prt_user_tab_close", sessionID, messageID: userMessageID, type: "text", text: "Summarise this repo." },
  ],
}

const sessionHeading = (page: Page) => page.getByRole("heading", { name: title })
const contextTab = (page: Page) => page.getByRole("tab", { name: "Context" })

async function openSession(page: Page) {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "warning") return
    if (!message.text().includes("tab.close")) return
    warnings.push(message.text())
  })

  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "tab-close-owner",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "tab-close-owner",
        projectID,
        directory,
        title,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: [userMessage] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  return { warnings }
}

test.describe("regression: tab.close has one owner per context", () => {
  test("opening a context tab does not register a second tab.close", async ({ page }) => {
    const { warnings } = await openSession(page)

    // Open the child tab the way the product does, so both registrations are live.
    await page.getByRole("button", { name: "View context usage" }).click()
    await expect(contextTab(page)).toBeVisible()

    // One id, one keybind, two different behaviours: only one registration survives
    // `command.tsx:263-272`, and the warning names the collision.
    expect(warnings).toEqual([])
  })

  test("with a context tab open, the shortcut closes that tab and keeps the session", async ({ page }) => {
    // Separate from the registration check on purpose: each assertion has one reason to
    // fail, and this one measures which owner actually wins the keybind today.
    await openSession(page)
    await page.getByRole("button", { name: "View context usage" }).click()
    await expect(contextTab(page)).toBeVisible()

    await page.keyboard.press("ControlOrMeta+w")

    // The child tab is what the user asked to close.
    await expect(contextTab(page)).toHaveCount(0)
    // And the session must survive it — losing the whole tab here loses the conversation
    // view, not a file view.
    await expect(sessionHeading(page)).toBeVisible()
  })

  test("with no closable child tab, the shortcut still closes the session tab", async ({ page }) => {
    // The half that must not be lost while fixing the above: with no child tab only the
    // Titlebar registration exists, and closing the top-level tab is then correct.
    await openSession(page)
    await expect(contextTab(page)).toHaveCount(0)

    await page.keyboard.press("ControlOrMeta+w")

    await expect(sessionHeading(page)).toHaveCount(0)
  })
})
