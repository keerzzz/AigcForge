import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"

// English-label spec — pin the UI language so the zh/zht projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

/**
 * S0 baseline for P1-TURN-STALL — a turn that is accepted but never produces output.
 *
 * Reported as BUG-CHAT-ASSISTANT-STALL: send a question, wait 40-75s, and the page stays
 * on "Thinking" with no error, no timeout, no retry and no way to change model.
 *
 * The interactive owner is this timeline, not `session-turn.tsx`: `rows.ts:197` pushes
 * `TimelineRow.Thinking` when
 *
 *   isActive && status === "busy" && !error && (showReasoning ? no assistant parts : true)
 *
 * and that condition has no time dimension at all — nothing anywhere in the row model
 * knows how long the turn has been silent, so there is no state between "running" and
 * "finished". (`packages/enterprise` renders `SessionTurn` for shared sessions, but pins
 * `session_status` to idle, so its stall branch is unreachable and is out of scope.)
 *
 * The fixture is the reported situation exactly: one user message, zero assistant
 * messages, session status busy. Time is driven with Playwright's clock rather than by
 * waiting, so the assertion stays fast and deterministic once a threshold exists.
 *
 * `[data-timeline-row="..."]` is the timeline's own row contract
 * (`message-timeline.tsx:1115` emits `data-timeline-row={row()._tag}`), so `Stalled` is
 * the natural tag for the missing state and not a marker invented for this test.
 */
const directory = "C:/Aigcfroge/SessionTurnStall"
const projectID = "proj_session_turn_stall"
const sessionID = "ses_session_turn_stall"
const userMessageID = "msg_user_stall"
const title = "Session turn stall"
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
    {
      id: "prt_user_stall_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "What does this repository do?",
    },
  ],
}

async function openBusySession(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "session-turn-stall",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "session-turn-stall",
        projectID,
        directory,
        title,
        mode: "chat",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    // Busy with nothing to show: the turn was accepted, and no assistant message or part
    // ever arrives. This is the whole defect condition.
    sessionStatus: { [sessionID]: { type: "busy" } },
    pageMessages: () => ({ items: [userMessage] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  // The heading comes from the session shell, which mounts before the timeline's own chunk
  // finishes compiling on a cold dev server — so waiting for the heading alone left the row
  // assertions racing a build. Any row proves the timeline itself mounted; that is the real
  // readiness signal, and it absorbs the compile inside the documented budget instead of
  // pushing every later assertion onto a longer timeout.
  await expectAppVisible(page.locator("[data-timeline-row]").first())
  // `clock.install` freezes the page's timers, so deferred boot work that landed on a timer
  // would never run. One second of the fake clock releases it deterministically — far below
  // the stall threshold, so no assertion below changes meaning. Advancing the clock the test
  // installed is not a sleep: nothing waits on wall time.
  await page.clock.runFor(1_000)
}

test.describe("regression: silent turn has an exit", () => {
  test("a busy turn with no output for long enough shows a stalled state with an action", async ({ page }) => {
    // Installed before navigation so the app boots against the fake clock; otherwise
    // fast-forwarding cannot advance timers the app created during boot.
    await page.clock.install({ time: new Date(created) })
    await openBusySession(page)

    // Non-regression half: the reported state is reachable and looks the same as reported.
    await expectAppVisible(page.locator('[data-timeline-row="Thinking"]').first())

    // Three minutes of silence. Any product threshold worth having is below this.
    await page.clock.fastForward("03:00")

    const stalled = page.locator('[data-timeline-row="Stalled"]')
    await expect(stalled).toHaveCount(1, { timeout: 15_000 })
    // A state without an exit is the same dead end with different words, so the row has to
    // carry at least one enabled control (stop, retry, or change model).
    await expect(stalled.getByRole("button").first()).toBeEnabled()
  })

  test("a busy turn that is still producing output is not called stalled", async ({ page }) => {
    // The other side of the threshold, so the fix cannot simply label every busy turn as
    // stalled: with no time advanced at all, only Thinking may be present.
    await page.clock.install({ time: new Date(created) })
    await openBusySession(page)

    await expectAppVisible(page.locator('[data-timeline-row="Thinking"]').first())
    await expect(page.locator('[data-timeline-row="Stalled"]')).toHaveCount(0)
  })

  test("the stop action aborts the silent turn", async ({ page }) => {
    // An exit that does not reach the server is decoration. The stalled row's stop button has
    // to hit the same abort the composer uses, so this asserts the request, not the label.
    const aborts: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("/abort")) aborts.push(request.url())
    })

    await page.clock.install({ time: new Date(created) })
    await openBusySession(page)
    await page.clock.fastForward("03:00")

    const stalled = page.locator('[data-timeline-row="Stalled"]')
    await expect(stalled).toHaveCount(1, { timeout: 15_000 })

    await stalled.getByRole("button", { name: "Stop" }).click()
    await expect.poll(() => aborts.length, { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test("putting the prompt back refills the composer without sending it", async ({ page }) => {
    // The report's third complaint: after a dead turn the user could only retype the whole
    // request. This returns the text and nothing else — no send, and no revert, which for a
    // turn that captured no snapshot would be a no-op anyway (and destructive when it is not).
    const prompts: string[] = []
    page.on("request", (request) => {
      const url = request.url()
      if (request.method() === "POST" && (url.includes("/prompt") || url.endsWith("/message"))) prompts.push(url)
    })

    await page.clock.install({ time: new Date(created) })
    await openBusySession(page)
    await page.clock.fastForward("03:00")

    const stalled = page.locator('[data-timeline-row="Stalled"]')
    await expect(stalled).toHaveCount(1, { timeout: 15_000 })

    await stalled.getByRole("button", { name: "Put the prompt back" }).click()

    // The composer is a contenteditable, so the text is asserted where the user would read it.
    await expect(page.locator("[contenteditable]").first()).toContainText("What does this repository do?")
    expect(prompts).toEqual([])
  })

  test("the stalled actions are keyboard reachable and survive a narrow viewport", async ({ page }) => {
    // The two surfaces this plan adds have to be usable without a mouse and at the width the
    // report used (390x844), so the fix does not trade one dead end for another.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.install({ time: new Date(created) })
    await openBusySession(page)
    await page.clock.fastForward("03:00")

    const stalled = page.locator('[data-timeline-row="Stalled"]')
    await expect(stalled).toHaveCount(1, { timeout: 15_000 })
    await expect(stalled).toBeVisible()

    const stop = stalled.getByRole("button", { name: "Stop" })
    const restore = stalled.getByRole("button", { name: "Put the prompt back" })
    const changeModel = stalled.getByRole("button", { name: "Change model" })
    await expect(stop).toBeVisible()
    await expect(restore).toBeVisible()
    await expect(changeModel).toBeVisible()

    // Focusable and operable by keyboard: focus the control, then activate it with Enter.
    await changeModel.focus()
    await expect(changeModel).toBeFocused()
    await page.keyboard.press("Enter")
    // Reuses the existing model command rather than a second model picker, so the existing
    // dialog is what must appear.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 })
  })
})
