import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type { SessionMessage, SessionMessagesResponse } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"

/**
 * Direct E3 for the Assistant timeline citation overlay (S5/S8).
 *
 * The production UI `message-timeline.tsx` already owns three citation states
 * (`assistant-citation-loading`, `assistant-citation-error` with Retry, and the
 * resolved `assistant-citation` overlay). Until now they were only unit-covered:
 * the earlier attempt seeded legacy `pageMessages`, which only renders user rows
 * in an Assistant session (section15.49). Assistant sessions read the canonical
 * projection, so the fixture here supplies `canonicalMessages` with one assistant
 * text part containing a `kb://` link, and then drives the real delegated click
 * against a failing `GET /kb/:id`, retries it, and reads the note back.
 */
const directory = "C:/Aigcfroge/AssistantCitation"
const projectID = "proj_assistant_citation"
const sessionID = "ses_assistant_citation"
const title = "Assistant citation regression"
const noteID = "kb_citation_note"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "assistant-citation",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const session = {
  id: sessionID,
  slug: "assistant-citation",
  projectID,
  directory,
  title,
  mode: "assistant",
  agent: "assistant-orchestrator",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

const userMessage: SessionMessage = {
  id: "msg_citation_user",
  time: { created: 1700000000000 },
  text: "Cite the note",
  type: "user",
}

const assistantMessage: SessionMessage = {
  id: "msg_citation_assistant",
  time: { created: 1700000000100, completed: 1700000000200 },
  type: "assistant",
  agent: "assistant-orchestrator",
  model: { id: "deepseek-v4-flas", providerID: "deepseek" },
  content: [{ type: "text", id: "prt_citation_text", text: "See [Citation note](kb://kb_citation_note)." }],
  finish: "stop",
}

const note = {
  id: noteID,
  title: "Citation note",
  content: "A cited note body used by the citation overlay.",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

async function mount(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { all: [], connected: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
    // Canonical reads are newest-first; the app reverses the page before projecting.
    canonicalMessages: (): SessionMessagesResponse => ({ data: [assistantMessage, userMessage], cursor: {} }),
    events: () => [],
    eventRetry: 16,
  })

  let fail = true
  await page.route(/\/kb\/kb_citation_note(?:\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    if (fail) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ _tag: "InvalidRequestError", message: "kb read failed" }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(note),
    })
  })
  await page.addInitScript(
    (input) => {
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url: input.server } }], projects: {}, lastProject: {} }),
      )
      // The session route sets the mode from the session record, but the mode slots mount
      // from the persisted mode first; seed it so the assistant panel is the active slot on
      // the first frame (same pattern as the Work presentation specs).
      localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "assistant" }))
    },
    { server },
  )
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 15_000 })
  return {
    fail: (value: boolean) => {
      fail = value
    },
  }
}

test.beforeEach(({ page }) => pinEnglishUI(page))

test("a failing citation read shows the error overlay and Retry reads the note", async ({ page }) => {
  const fixture = await mount(page)

  // Scope to the timeline row: the Work artifact preview renders the same assistant markdown
  // in a hidden work-mode panel, so a bare href locator is not unique.
  const citation = page.locator('[data-message-id="msg_citation_user"] a[href="kb://kb_citation_note"]')
  await expect(citation).toBeVisible({ timeout: 20_000 })
  await citation.click()

  const error = page.locator('[data-component="assistant-citation-error"]')
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText("Could not load this note.")
  const retry = error.getByRole("button", { name: "Retry", exact: true })
  await expect(retry).toBeVisible()
  await expect(error.locator('[aria-label="Dismiss citation"]')).toBeVisible()

  fixture.fail(false)
  await retry.click()
  const overlay = page.locator('[data-component="assistant-citation"]')
  await expect(overlay).toBeVisible({ timeout: 15_000 })
  await expect(overlay).toContainText("Citation note")
  await expect(overlay).toContainText("A cited note body used by the citation overlay.")
  await expect(error).toHaveCount(0)
})

test("dismissing a failed citation closes the overlay without a second read", async ({ page }) => {
  const fixture = await mount(page)

  // Scope to the timeline row: the Work artifact preview renders the same assistant markdown
  // in a hidden work-mode panel, so a bare href locator is not unique.
  const citation = page.locator('[data-message-id="msg_citation_user"] a[href="kb://kb_citation_note"]')
  await expect(citation).toBeVisible({ timeout: 20_000 })
  await citation.click()
  const error = page.locator('[data-component="assistant-citation-error"]')
  await expect(error).toBeVisible({ timeout: 15_000 })

  fixture.fail(false)
  await error.getByRole("button", { name: "Dismiss citation", exact: true }).click()
  await expect(error).toHaveCount(0)
  await expect(page.locator('[data-component="assistant-citation"]')).toHaveCount(0)
})
