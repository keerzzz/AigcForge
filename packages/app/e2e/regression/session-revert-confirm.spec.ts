import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

/**
 * S5 RED for P2-REVERT-CONFIRM — a destructive disk write with no confirmation.
 *
 * `message-part.tsx:1225-1233` calls `revert()` straight from the icon button's `onClick`, and
 * `session.tsx:1499-1521` halts the turn and posts `session.revert`. The server side restores
 * the workspace files to a snapshot (`core/src/session/revert.ts:43`), so one stray click
 * rewrites the user's working tree with no prompt.
 *
 * It is recoverable — the dock's restore is wired to `unrevert` — but recoverable is not the
 * same as intended, and the existing guard is only `disabled={busy()}`, which stops a click
 * during a running turn and nothing else.
 *
 * The confirmation also has to be honest about what it knows. The app has no "files this revert
 * will touch" number: `session_diff` is the session's current diff and `Session.Info.summary` is
 * written *after* a revert. So the count shown is the session's changed-file count, labelled as
 * that, and when there is no diff the dialog says what will happen without inventing a number.
 * Passing the message count off as a file count is the specific thing this must not do.
 */
const directory = "C:/Aigcfroge/RevertConfirm"
const projectID = "proj_revert_confirm"
const sessionID = "ses_revert_confirm"
const title = "Revert confirm"
const created = 1700000000000

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const userMessage = (id: string, text: string, at: number) => ({
  info: {
    id,
    sessionID,
    role: "user",
    time: { created: at },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text }],
})

// Assistant info needs the full shape or the page never decodes and the heading never appears —
// measured: the first run of this spec failed on `expectSessionTitle`, not on the assertions.
const assistantMessage = (id: string, parent: string, text: string, at: number) => ({
  info: {
    id,
    sessionID,
    role: "assistant",
    parentID: parent,
    time: { created: at, completed: at + 500 },
    summary: { diffs: [] },
    agent: "build",
    mode: "coding",
    model,
    providerID: "aigcfroge",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text }],
})

const items = [
  userMessage("msg_user_a1", "Add the first thing", created),
  assistantMessage("msg_asst_a2", "msg_user_a1", "Added it.", created + 1_000),
  userMessage("msg_user_b1", "Now add the second", created + 2_000),
  assistantMessage("msg_asst_b2", "msg_user_b1", "Added that too.", created + 3_000),
]

type Counters = { revert: number; unrevert: number; abort: number }

async function openSession(page: Page, options: { diffFiles: number; revertFails?: boolean }) {
  const counters: Counters = { revert: 0, unrevert: 0, abort: 0 }

  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "revert-confirm",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "revert-confirm",
        projectID,
        directory,
        title,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items }),
    events: () => [],
    eventRetry: 16,
  })

  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  if (options.revertFails) {
    await page.route(
      (url) => url.port === apiPort && /^\/session\/[^/]+\/revert$/.test(url.pathname),
      (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    )
  }
  // Registered after the mock so these win the match, and each falls through so the mock still
  // answers. Counting is the whole point: "no request" is the assertion, not "no visible change".
  await page.route(
    (url) => url.port === apiPort && /^\/session\/[^/]+\/(revert|unrevert|abort)$/.test(url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      // Matched rather than cast: the tail is one of three known names, and asserting that to the
      // type system is what `no-unsafe-type-assertion` exists to stop.
      if (path.endsWith("/unrevert")) counters.unrevert += 1
      else if (path.endsWith("/revert")) counters.revert += 1
      else if (path.endsWith("/abort")) counters.abort += 1
      await route.fallback()
    },
  )
  await page.route(
    (url) => url.port === apiPort && /^\/session\/[^/]+\/diff$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        // `patch` is required: `utils/diffs.ts:9` drops any entry without it, so an otherwise
        // plausible fixture silently produced an empty diff and no count — measured.
        body: JSON.stringify(
          Array.from({ length: options.diffFiles }, (_, index) => ({
            file: `src/changed-${index}.ts`,
            patch: `@@ -1 +1 @@\n-old\n+new`,
            additions: 2,
            deletions: 1,
            status: "modified",
          })),
        ),
      }),
  )

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  return counters
}

/**
 * The reset button on the second turn, which is what a user clicks to roll back to it.
 *
 * The action row is `opacity: 0; pointer-events: none` until the message is hovered or focused
 * (`message-part.css:195-198`), so the hover is part of reaching it, not test decoration —
 * measured: clicking without it waits out the full timeout on "visible, enabled and stable".
 */
async function revertButton(page: Page) {
  const message = page.locator('[data-component="user-message"]').last()
  await message.hover()
  return message.getByRole("button", { name: "Revert message" })
}

test.describe("regression: reverting asks first", () => {
  test("clicking revert asks before touching the workspace", async ({ page }) => {
    const counters = await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()

    // A dialog, and nothing on the wire yet.
    await expect(page.getByRole("dialog")).toBeVisible()
    expect(counters).toEqual({ revert: 0, unrevert: 0, abort: 0 })
  })

  test("cancelling leaves the workspace alone", async ({ page }) => {
    const counters = await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("dialog")).toHaveCount(0)
    // `abort` matters as much as `revert`: the mutation halts the turn first, so a cancelled
    // confirmation must not have stopped anything either.
    expect(counters).toEqual({ revert: 0, unrevert: 0, abort: 0 })
  })

  test("confirming reverts exactly once", async ({ page }) => {
    const counters = await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    await page.getByRole("dialog").getByRole("button", { name: "Reset to here" }).click()

    await expect.poll(() => counters.revert, { timeout: 10_000 }).toBe(1)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // Still one after the dialog closes: no retry loop, no double submit.
    await expect.poll(() => counters.revert, { timeout: 2_000 }).toBe(1)
  })

  test("the dialog reports the session's changed files when it has a diff", async ({ page }) => {
    const diffRequests: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      if (/^\/session\/[^/]+\/diff$/.test(path)) diffRequests.push(path)
    })
    await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // Measured, and it shaped the design: the session diff is only fetched when the review
    // surface wants it (`session.tsx:1101`), so a confirmation that only read the store showed a
    // count to whoever had opened the review tab and nothing to anyone else. The confirmation
    // asks for it, which is why this request exists at all.
    await expect.poll(() => diffRequests.length, { timeout: 15_000 }).toBeGreaterThan(0)
    // The number comes from the session diff, and is described as the session's changes rather
    // than as a prediction of what the revert will rewrite.
    await expect(dialog).toContainText("3")
  })

  test("with no diff it explains the effect instead of inventing a count", async ({ page }) => {
    await openSession(page, { diffFiles: 0 })

    await (await revertButton(page)).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // Four messages are on screen; none of them may be reported as a file.
    await expect(dialog).not.toContainText("4")
    // And it still says what will happen, so the fallback is a degradation and not a blank.
    await expect(dialog.getByRole("button", { name: "Reset to here" })).toBeEnabled()
  })
})

/**
 * The other half of §2.5: the undo already exists, but nobody can find it.
 *
 * `session-revert-dock.tsx:19-23` sets `collapsed` to true whenever the revert list's length or
 * head id changes — which includes the moment a revert creates that list. So the affordance that
 * makes this operation recoverable is folded away exactly when it becomes relevant, leaving a
 * one-line preview and a chevron.
 */
test.describe("regression: the undo is visible after a revert", () => {
  test("a confirmed revert opens the restore dock", async ({ page }) => {
    await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    await page.getByRole("dialog").getByRole("button", { name: "Reset to here" }).click()

    const dock = page.locator('[data-component="session-revert-dock"]')
    await expect(dock).toBeVisible()
    // Expanded, so the per-message Restore is reachable without first discovering the chevron.
    await expect(dock.getByRole("button", { name: "Restore message" }).first()).toBeVisible({ timeout: 15_000 })
    await expect(dock.getByRole("button", { name: "Collapse rolled back messages" }).first()).toBeVisible()
  })

  test("collapsing it is respected", async ({ page }) => {
    // The half that must not be traded away: opening it once is help, re-opening it on every
    // update would be nagging.
    await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    await page.getByRole("dialog").getByRole("button", { name: "Reset to here" }).click()

    const dock = page.locator('[data-component="session-revert-dock"]')
    await expect(dock.getByRole("button", { name: "Collapse rolled back messages" }).first()).toBeVisible({
      timeout: 15_000,
    })
    await dock.getByRole("button", { name: "Collapse rolled back messages" }).first().click()

    await expect(dock.getByRole("button", { name: "Expand rolled back messages" }).first()).toBeVisible()
    // Still collapsed after the app settles: nothing re-opens it behind the user's back.
    await expect(dock.getByRole("button", { name: "Restore message" })).toHaveCount(0)
  })
})

/**
 * The failure path, which the confirmation makes reachable rather than creating.
 *
 * `session.tsx:1513-1518` rolls the local marker and the draft back and calls `fail`, which
 * raises the shared toast. Asserted because "confirmed, then silently nothing" would be a worse
 * outcome than the unconfirmed click this slice replaced.
 */
test.describe("regression: a failed revert says so and puts the timeline back", () => {
  test("a 500 restores the messages and surfaces the error", async ({ page }) => {
    await openSession(page, { diffFiles: 3, revertFails: true })

    const lastMessage = page.locator('[data-component="user-message"]').last()
    await expect(lastMessage).toBeVisible()

    await (await revertButton(page)).click()
    await page.getByRole("dialog").getByRole("button", { name: "Reset to here" }).click()

    // Visible failure, not a silent no-op.
    await expect(page.getByText("Request failed").first()).toBeVisible({ timeout: 15_000 })
    // And the optimistic roll is undone, so the turn the user was looking at is still there.
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(2)
  })
})

test.describe("regression: the confirmation defaults to the safe action", () => {
  test("Enter on the fresh dialog cancels rather than reverts", async ({ page }) => {
    const counters = await openSession(page, { diffFiles: 3 })

    await (await revertButton(page)).click()
    await expect(page.getByRole("dialog")).toBeVisible()

    // Whatever has focus when the dialog opens is what a keyboard user triggers first, and this
    // dialog exists because the action writes to disk.
    await page.keyboard.press("Enter")

    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(counters).toEqual({ revert: 0, unrevert: 0, abort: 0 })
  })
})
