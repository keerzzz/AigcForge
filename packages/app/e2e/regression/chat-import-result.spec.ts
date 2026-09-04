import { expect, test, type Page, type Route } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Chat asset import shows its parsed result (BUG-CHAT-IMPORT, 2026-09-03 dogfood run).
 *
 * `POST /import-asset/parse` returned 200 and the dialog stayed on the paste form
 * forever, so parsed candidates were unreachable. The cause was a bare `if` in the
 * component body — a Solid component function runs once, so the phase switch was
 * evaluated at creation time and never again.
 *
 * The assertion is on what the user sees after a successful parse: the result heading,
 * the candidate the server returned, and the apply action. Asserting the request was
 * made would have passed the whole time.
 */
const directory = "C:/Aigcfroge/ChatImportResult"
const projectID = "proj_chat_import_result"
const sessionID = "ses_chat_import_result"
const sessionTitle = "Chat import seed"

const cors = { "access-control-allow-origin": "*" }

const base64Encode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

const importButton = (page: Page) => page.getByRole("button", { name: "Import", exact: true })
const pasteTab = (page: Page) => page.getByRole("button", { name: "Paste text", exact: true })
const reviewButton = (page: Page) => page.getByRole("button", { name: "Review in Chat", exact: true })

async function openChatMode(page: Page, parse: { onCall?: () => void } = {}) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "chat-import-result",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "chat-import-result",
        projectID,
        directory,
        title: sessionTitle,
        mode: "chat",
        agent: "meta",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  // Registered after the catch-all so it wins: Playwright resolves routes LIFO.
  await page.route("**/import-asset/parse*", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    parse.onCall?.()
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", ...cors },
      body: JSON.stringify({
        candidates: [
          {
            kind: "prompt",
            name: "release-notes",
            description: "Drafts release notes from a changelog",
            template: "Summarise the following changelog:",
          },
        ],
        warnings: [],
        errors: [],
      }),
    })
  })

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  // Visiting a session first resolves the directory `useModeDirectory` needs; without it
  // the workbench has no client and the Import button stays disabled.
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))
  await page.goto("/mode/chat")
}

test.describe("regression: Chat import result", () => {
  test("a successful parse switches the dialog to its result view", async ({ page }) => {
    let parseCalls = 0
    await openChatMode(page, { onCall: () => (parseCalls += 1) })

    await expectAppVisible(importButton(page))
    await importButton(page).click()

    await expectAppVisible(pasteTab(page))
    await pasteTab(page).click()
    await page.locator("textarea").first().fill("# Changelog\n\n- shipped the importer")

    await reviewButton(page).click()

    // The result view: its heading, the candidate the server returned, and the action
    // that was unreachable while the dialog was stuck on the form.
    await expect(page.getByText("Parsed Results", { exact: true })).toBeVisible()
    await expect(page.getByText("release-notes", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Apply Import", exact: true })).toBeVisible()
    // The paste form is gone, not merely covered.
    await expect(reviewButton(page)).toHaveCount(0)
    expect(parseCalls).toBe(1)
  })
})
