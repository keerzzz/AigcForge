import { expect, test, type Locator, type Page } from "@playwright/test"
import type {
  PermissionV2Request,
  QuestionV2Request,
  V2SessionWorkReviewTransitionError,
  WorkReviewCommand,
  WorkReviewReadResult,
  WorkReviewReady,
} from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { PRESENTATION_EXPECTED } from "../presentation-matrix"

// E3 keeps the real Work sidebar and generated SDK transport, including S08
// presentation acceptance. E4 owns real provider, file, database and restart proof.
const directory = "C:/Aigcfroge/WorkReview"
const sessionID = "ses_work_review"
const title = "Work review lifecycle"
const sessionPath = `/${base64Encode(directory)}/session/${sessionID}`
const reviewPath = `/api/session/${sessionID}/work-review`
const applyPath = `/session/${sessionID}/work-artifact/apply`
const draft = "# Review draft\n\nA candidate that must be applied before it can be reviewed.\n"
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }
const artifact = {
  id: "art_review_saved",
  sessionID,
  kind: "document",
  title: "Review draft.md",
  mediaType: "text/markdown",
  relativePath: "Review draft.md",
  status: "available",
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
} as const
const binding = { artifactID: artifact.id, artifactRevision: "a".repeat(64) }
const available = { status: "none", artifact: binding } as const
const ready = {
  status: "ready",
  review: {
    contractVersion: 1,
    state: "open",
    ...binding,
    revision: 1,
    updatedAt: 1700000001000,
  },
  artifact: binding,
  current: true,
} as const satisfies WorkReviewReady
const requested = {
  ...ready,
  review: { ...ready.review, state: "fix_requested", revision: 2, updatedAt: 1700000002000 },
} satisfies WorkReviewReady
const responded = {
  ...ready,
  review: { ...ready.review, state: "responded", revision: 3, updatedAt: 1700000003000 },
} satisfies WorkReviewReady
const reviewed = {
  ...ready,
  review: { ...ready.review, revision: 4, updatedAt: 1700000004000 },
} satisfies WorkReviewReady
const approved = {
  ...ready,
  review: { ...ready.review, state: "resolved", revision: 5, updatedAt: 1700000005000 },
} satisfies WorkReviewReady
const reopened = {
  ...ready,
  review: { ...ready.review, revision: 6, reopenedFrom: "resolved", updatedAt: 1700000006000 },
} satisfies WorkReviewReady
const approvedOnce = {
  ...ready,
  review: { ...ready.review, state: "resolved", revision: 2, updatedAt: 1700000002000 },
} satisfies WorkReviewReady
const concurrent = {
  ...ready,
  review: { ...ready.review, revision: 7, updatedAt: 1700000007000 },
} satisfies WorkReviewReady
const afterConflict = {
  ...ready,
  review: { ...ready.review, state: "resolved", revision: 8, updatedAt: 1700000008000 },
} satisfies WorkReviewReady
const approveCommand = {
  action: "approve",
  expectedReviewRevision: 1,
  artifactID: binding.artifactID,
  expectedArtifactRevision: binding.artifactRevision,
} as const satisfies WorkReviewCommand
const names = {
  submit: "Submit for review",
  request_changes: "Request changes",
  respond: "Respond",
  re_review: "Re-review",
  approve: "Approve",
  reopen: "Reopen",
} as const
const actions = ["submit", "request_changes", "respond", "re_review", "approve", "reopen"] as const
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

type ScriptedReply =
  | { status: 200; body: { data: WorkReviewReady } }
  | { status: 401 | 403 | 409 | 503; body: V2SessionWorkReviewTransitionError }
  | { abort: true }
type ScriptedTransition = {
  expected: WorkReviewCommand
  reply: ScriptedReply
  read: WorkReviewReadResult
  wait?: Promise<void>
}
type ScriptedReadFailure =
  | { status: 503; body: { _tag: "WorkReviewUnavailableError"; code: "storage"; message: string } }
  | { abort: true }

// These are authored server snapshots, not a second WorkReview machine. The
// script never derives a state, binding or revision from an incoming command.
function reviewScript(read: WorkReviewReadResult, steps: readonly ScriptedTransition[] = []) {
  return {
    read,
    steps,
    commands: [] as { page: Page; body: unknown }[],
    reads: [] as { page: Page; result: WorkReviewReadResult }[],
    readFailures: [] as ScriptedReadFailure[],
    applies: [] as unknown[],
    otherMutations: [] as { path: string; method: string }[],
    questions: [] as QuestionV2Request[],
    permissions: [] as PermissionV2Request[],
  }
}
type ReviewScript = ReturnType<typeof reviewScript>

async function mockWorkReview(page: Page, wire = reviewScript(ready), options: { presentation?: boolean } = {}) {
  if (!options.presentation) {
    await pinEnglishUI(page)
    await pinDesktopViewport(page)
  }
  await page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "work" }))
  })
  const events = [
    ...wire.permissions.map((request) => ({
      directory,
      payload: { type: "permission.v2.asked", properties: request },
    })),
    ...wire.questions.map((request) => ({
      directory,
      payload: { type: "question.v2.asked", properties: request },
    })),
  ]
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return
    if (method === "POST" && (path === reviewPath || path === applyPath)) return
    if (!/^\/(?:api\/)?(?:session|question|permission|provider|agent)(?:\/|$)/.test(path)) return
    wire.otherMutations.push({ path, method })
  })
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: "proj_work_review",
      worktree: directory,
      vcs: "git",
      name: "WorkReview",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
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
    },
    agents: [{ name: "work-orchestrator", mode: "primary", primaryModes: ["work"] }],
    sessions: [
      {
        id: sessionID,
        slug: "work-review",
        projectID: "proj_work_review",
        directory,
        mode: "work",
        agent: "work-orchestrator",
        model,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_review_draft",
            sessionID,
            role: "assistant",
            time: { created: 1700000001000 },
            summary: { diffs: [] },
            parentID: "msg_review_user",
            agent: "work-orchestrator",
            mode: "work",
            model,
            providerID: model.providerID,
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ id: "prt_review_draft", sessionID, messageID: "msg_review_draft", type: "text", text: draft }],
        },
      ],
    }),
    events: () => events.splice(0),
    eventRetry: 16,
  })
  await page.route("**/*", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (![reviewPath, applyPath, "/api/question/request", "/api/permission/request"].includes(path))
      return route.fallback()
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    if (path === "/api/question/request")
      return route.fulfill({ json: { location: { directory }, data: wire.questions }, headers: cors })
    if (path === "/api/permission/request")
      return route.fulfill({ json: { location: { directory }, data: wire.permissions }, headers: cors })
    if (path === applyPath && request.method() === "POST") {
      wire.applies.push(request.postDataJSON())
      return route.fulfill({ json: artifact, headers: cors })
    }
    if (path !== reviewPath) return route.fallback()
    if (request.method() === "GET") {
      const failure = wire.readFailures.shift()
      if (failure && "abort" in failure) return route.abort("failed")
      if (failure) return route.fulfill({ status: failure.status, json: failure.body, headers: cors })
      wire.reads.push({ page, result: wire.read })
      return route.fulfill({ json: { data: wire.read }, headers: cors })
    }
    if (request.method() !== "POST") return route.fallback()
    const step = wire.steps[wire.commands.length]
    wire.commands.push({ page, body: request.postDataJSON() })
    if (!step)
      return route.fulfill({
        status: 503,
        json: { _tag: "WorkReviewUnavailableError", code: "storage", message: "Unexpected E3 review write" },
        headers: cors,
      })
    wire.read = step.read
    await step.wait
    if ("abort" in step.reply) return route.abort("failed")
    return route.fulfill({ status: step.reply.status, json: step.reply.body, headers: cors })
  })
  return wire
}

function panelOf(page: Page) {
  return page.getByRole("region").and(page.locator('[data-component="work-review-panel"]'))
}

function actionOf(page: Page, action: WorkReviewCommand["action"]) {
  return panelOf(page)
    .getByRole("button", { name: names[action], exact: true })
    .and(page.locator(`[data-action="work-review-${action}"]`))
}

async function openReview(page: Page) {
  const open = page.getByRole("button", { name: "Review artifact", exact: true })
  await expect(open).toHaveAttribute("data-action", "work-review-open")
  await open.click()
  await expect(panelOf(page)).toBeVisible()
}

async function visitReview(page: Page) {
  await page.goto(sessionPath)
  await expectSessionTitle(page, title)
  await openReview(page)
}

async function expectReady(page: Page, result: WorkReviewReady) {
  const panel = panelOf(page)
  await expect(panel).toHaveAttribute("data-review-status", "ready")
  await expect(panel.locator('[data-slot="review-state"]')).toHaveAttribute("data-state", result.review.state)
  await expect(panel.locator('[data-field="review-revision"]')).toHaveText(String(result.review.revision))
  await expect(panel.locator('[data-field="reviewed-artifact-id"]')).toHaveText(result.review.artifactID)
  await expect(panel.locator('[data-field="reviewed-artifact-revision"]')).toHaveText(result.review.artifactRevision)
  await expect(panel.locator('[data-field="current-artifact-id"]')).toHaveText(result.artifact.artifactID)
  await expect(panel.locator('[data-field="current-artifact-revision"]')).toHaveText(result.artifact.artifactRevision)
  if (!result.current) {
    await expect(panel.locator('[data-slot="stale"]')).toBeVisible()
    await expect(panel.locator('[data-slot="approved"]')).toHaveCount(0)
  }
}

async function expectActions(page: Page, enabled: readonly WorkReviewCommand["action"][]) {
  for (const action of actions) {
    if (enabled.includes(action)) {
      await expect(actionOf(page, action)).toBeEnabled()
      continue
    }
    // An unavailable action may be omitted or natively disabled, never active.
    await expect(panelOf(page).locator(`button[data-action="work-review-${action}"]:enabled`)).toHaveCount(0)
  }
}

async function refreshReview(page: Page) {
  const refresh = panelOf(page).getByRole("button", { name: "Refresh review", exact: true })
  await expect(refresh).toHaveAttribute("data-action", "work-review-refresh")
  const read = page.waitForResponse(
    (response) => new URL(response.url()).pathname === reviewPath && response.request().method() === "GET",
  )
  await refresh.click()
  expect((await read).status()).toBe(200)
}

async function closeReview(page: Page) {
  const close = panelOf(page).getByRole("button", { name: "Close review", exact: true })
  await expect(close).toHaveAttribute("data-action", "work-review-close")
  await close.click()
  await expect(panelOf(page)).toHaveCount(0)
}

function expectScript(wire: ReviewScript) {
  expect(wire.commands.map((command) => command.body)).toEqual(wire.steps.map((step) => step.expected))
  expect(wire.otherMutations, "review must not reply/grant, start a provider or mutate the Session identity").toEqual(
    [],
  )
}

async function expectKeyboardFocus(page: Page, control: Locator) {
  await expect(control).toBeVisible()
  await expect(control).toHaveAccessibleName(/.+/)
  // Traverse the real tab order; programmatic focus would hide inert/tabindex regressions.
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.keyboard.press("Tab")
    if (await control.evaluate((element) => element === document.activeElement)) break
  }
  await expect(control).toBeFocused()
  const focus = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      visible: element.matches(":focus-visible"),
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      hit: hit !== null && (element === hit || element.contains(hit)),
    }
  })
  expect(focus.visible).toBe(true)
  expect(focus.outline).not.toBe("none")
  expect(focus.width).toBeGreaterThan(0)
  expect(focus.color).not.toBe("rgba(0, 0, 0, 0)")
  expect(focus.insideViewport).toBe(true)
  expect(focus.hit).toBe(true)
}

test(
  "AI-TDD-S08-R04 C WorkReview preserves localized keyboard actions, layout and reduced motion",
  { tag: ["@presentation", "@a11y"] },
  async ({ page }, testInfo) => {
    const presentation = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!presentation) throw new Error("WorkReview acceptance requires a registered presentation project")
    const labels =
      presentation.lang === "zh"
        ? {
            open: "审阅产物",
            title: "工作审阅",
            submit: "提交审阅",
            approve: "批准",
            refresh: "刷新审阅",
            close: "关闭审阅",
            empty: "尚无审阅。可提交当前产物进行审阅。",
            pending: "正在保存：提交审阅…",
            error: "连接中断。请先刷新审阅确认结果，再决定是否重试。",
          }
        : {
            open: "Review artifact",
            title: "Work review",
            submit: names.submit,
            approve: names.approve,
            refresh: "Refresh review",
            close: "Close review",
            empty: "No review yet. Submit the current artifact for review.",
            pending: "Saving: Submit for review…",
            error: "The connection was interrupted. Refresh the review to check the result before trying again.",
          }
    const pending = Promise.withResolvers<void>()
    const wire = await mockWorkReview(
      page,
      reviewScript(available, [
        {
          expected: { ...approveCommand, action: "submit", expectedReviewRevision: 0 },
          reply: { status: 200, body: { data: ready } },
          read: ready,
          wait: pending.promise,
        },
        {
          expected: approveCommand,
          reply: {
            status: 503,
            body: { _tag: "WorkReviewUnavailableError", code: "storage", message: "Review storage unavailable" },
          },
          read: ready,
        },
      ]),
      { presentation: true },
    )
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto(sessionPath)
    await expectSessionTitle(page, title)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", presentation.colorScheme)
    await expect(page.locator("html")).toHaveAttribute("lang", presentation.lang)
    expect(page.viewportSize()).toEqual(presentation.viewport)
    // E3 runs on the dev server, where layout.tsx mounts the dev-only performance debug
    // bar (`import.meta.env.DEV`). It is `fixed bottom-right md:block`, so at 1280x720 it
    // covers the composer's "Review artifact" control and the real `elementFromPoint`
    // hit test below (correctly) rejects the focused control. Production builds never
    // render it (`global-shell-production.test.ts` asserts count 0), so hide the dev
    // overlay before measuring the keyboard surface.
    await page.addStyleTag({ content: '[data-component="debug-bar"] { display: none !important }' })

    const toggle = page.locator("#session-mode-panel-toggle")
    if (testInfo.project.name === "chromium-narrow") {
      await expectKeyboardFocus(page, toggle)
      await page.keyboard.press("Enter")
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
    }
    const open = page.getByRole("button", { name: labels.open, exact: true })
    await expect(open).toHaveAttribute("data-action", "work-review-open")
    await expectKeyboardFocus(page, open)
    await page.keyboard.press("Enter")
    const panel = panelOf(page)
    await expect(panel).toHaveAccessibleName(labels.title)
    await expect(panel).toHaveAttribute("data-review-status", "none")
    await expect(panel.locator('[data-slot="empty"]')).toHaveText(labels.empty)
    await expect(panel.getByRole("status")).toHaveAttribute("aria-live", "polite")
    await expect(page.locator("#review-panel")).toHaveCSS("transition-property", "width")

    const submit = panel.getByRole("button", { name: labels.submit, exact: true })
    await expectKeyboardFocus(page, submit)
    try {
      await page.keyboard.press("Enter")
      await expect.poll(() => wire.commands.length).toBe(1)
      await expect(panel).toHaveAttribute("aria-busy", "true")
      await expect(panel.getByRole("status")).toContainText(labels.pending)
      await expect(submit).toBeDisabled()
      await expect(panel.getByRole("button", { name: labels.refresh, exact: true })).toBeDisabled()
      await expect(panel.getByRole("button", { name: labels.close, exact: true })).toBeEnabled()
    } finally {
      pending.resolve()
    }
    await expectReady(page, ready)
    await expect(panel).toHaveAttribute("aria-busy", "false")
    expect(
      await panel.evaluate((element) => ({
        overflow: element.scrollWidth > element.clientWidth + 1,
        clippedBindings: [...element.querySelectorAll<HTMLElement>("[data-field]")]
          .filter((field) => field.scrollWidth > field.clientWidth + 1)
          .map((field) => field.dataset.field),
      })),
    ).toEqual({ overflow: false, clippedBindings: [] })

    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(page.locator("#review-panel")).toHaveCSS("transition-property", "none")
    const approve = panel.getByRole("button", { name: labels.approve, exact: true })
    await expectKeyboardFocus(page, approve)
    await page.keyboard.press("Enter")
    await expect(panel.getByRole("alert")).toHaveText(labels.error)
    await expect(panel.locator('[data-slot="approved"]')).toHaveCount(0)
    await expect(panel.locator('button[data-action="work-review-approve"]:enabled')).toHaveCount(0)

    const refresh = panel.getByRole("button", { name: labels.refresh, exact: true })
    await expectKeyboardFocus(page, refresh)
    await page.keyboard.press("Enter")
    await expectReady(page, ready)
    await expect(panel.getByRole("alert")).toHaveCount(0)
    await expect(approve).toBeEnabled()
    await expectKeyboardFocus(page, panel.getByRole("button", { name: labels.close, exact: true }))
    await page.keyboard.press("Enter")
    await expect(panel).toHaveCount(0)
    await expect(open).toBeVisible()
    expect(wire.applies).toEqual([])
    expectScript(wire)
  },
)

test("AI-TDD-S07-R01 opens the saved artifact review from the real Work sidebar", async ({ page }) => {
  const wire = await mockWorkReview(page)
  await page.goto(sessionPath)
  await expectSessionTitle(page, title)
  await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "Apply to project", exact: true })).toBeVisible()

  const applied = page.waitForResponse(
    (response) => new URL(response.url()).pathname === applyPath && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Apply to project", exact: true }).click()
  expect((await applied).status()).toBe(200)
  await expect(page.getByText("Applied", { exact: true })).toBeVisible()

  // The frozen B4 production bundle must reach this assertion and fail because
  // the Review entry is absent, not because setup or a module import failed.
  const open = page.getByRole("button", { name: "Review artifact", exact: true })
  await expect(open).toHaveAttribute("data-action", "work-review-open")
  await open.click()
  const panel = page.getByRole("region").and(page.locator('[data-component="work-review-panel"]'))
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute("data-review-status", "ready")
  await expect(panel.locator('[data-field="review-revision"]')).toHaveText("1")
  await expect(panel.locator('[data-field="reviewed-artifact-id"]')).toHaveText(binding.artifactID)
  await expect(panel.locator('[data-field="reviewed-artifact-revision"]')).toHaveText(binding.artifactRevision)
  await expect(panel.locator('[data-field="current-artifact-id"]')).toHaveText(binding.artifactID)
  await expect(panel.locator('[data-field="current-artifact-revision"]')).toHaveText(binding.artifactRevision)
  expect(wire.applies).toHaveLength(1)
  expect(wire.applies[0]).toMatchObject({ content: draft, overwrite: false })
  expectScript(wire)
})

test("AI-TDD-S07-R01 distinguishes no review/no artifact from an available unreviewed artifact", async ({ page }) => {
  const wire = await mockWorkReview(page, reviewScript({ status: "none" }))
  await visitReview(page)
  await expect(panelOf(page)).toHaveAttribute("data-review-status", "none")
  await expectActions(page, [])
  await expect(panelOf(page).getByText(binding.artifactID, { exact: true })).toHaveCount(0)
  await expect(panelOf(page).getByText(binding.artifactRevision, { exact: true })).toHaveCount(0)

  wire.read = available
  await refreshReview(page)
  await expect(panelOf(page)).toHaveAttribute("data-review-status", "none")
  await expect(panelOf(page).locator('[data-field="current-artifact-id"]')).toHaveText(binding.artifactID)
  await expect(panelOf(page).locator('[data-field="current-artifact-revision"]')).toHaveText(binding.artifactRevision)
  await expectActions(page, ["submit"])
  expectScript(wire)
})

for (const unavailable of [
  { status: "unavailable", reason: "corrupt_review" },
  { status: "unavailable", reason: "artifact_missing", review: ready.review },
  { status: "unavailable", reason: "artifact_unavailable" },
] as const) {
  test(`AI-TDD-S07-R01 ${unavailable.reason} cannot masquerade as a new review`, async ({ page }) => {
    const wire = await mockWorkReview(page, reviewScript(unavailable))
    await visitReview(page)
    await expect(panelOf(page)).toHaveAttribute("data-review-status", "unavailable")
    await expectActions(page, [])
    await expect(panelOf(page)).toContainText(/unavailable|missing|corrupt|invalid|cannot|could not/i)

    wire.read = ready
    await refreshReview(page)
    await expectReady(page, ready)
    await expectActions(page, ["request_changes", "approve"])
    expectScript(wire)
  })
}

for (const changed of [
  { label: "content changed", artifact: { ...binding, artifactRevision: "b".repeat(64) } },
  { label: "identity changed despite the same hash", artifact: { ...binding, artifactID: "art_review_replacement" } },
]) {
  test(`AI-TDD-S07-R01 stale open review: ${changed.label}`, async ({ page }) => {
    const stale = { ...ready, artifact: changed.artifact, current: false }
    const rebound = {
      ...ready,
      artifact: changed.artifact,
      review: { ...ready.review, ...changed.artifact, revision: 2, updatedAt: 1700000002000 },
    }
    const wire = await mockWorkReview(
      page,
      reviewScript(stale, [
        {
          expected: {
            action: "re_review",
            expectedReviewRevision: 1,
            artifactID: changed.artifact.artifactID,
            expectedArtifactRevision: changed.artifact.artifactRevision,
          },
          reply: { status: 200, body: { data: rebound } },
          read: rebound,
        },
      ]),
    )
    await visitReview(page)
    await expectReady(page, stale)
    await expectActions(page, ["re_review"])
    await actionOf(page, "re_review").click()
    await expectReady(page, rebound)
    await expectActions(page, ["request_changes", "approve"])
    expectScript(wire)
  })
}

test("AI-TDD-S07-R01 a stale verdict never approves a replacement artifact with the same hash", async ({ page }) => {
  const replacement = { ...binding, artifactID: "art_review_replacement" }
  const stale = { ...approved, artifact: replacement, current: false }
  const rebound = { ...reopened, artifact: replacement, review: { ...reopened.review, ...replacement } }
  const wire = await mockWorkReview(
    page,
    reviewScript(stale, [
      {
        expected: {
          action: "reopen",
          expectedReviewRevision: 5,
          artifactID: replacement.artifactID,
          expectedArtifactRevision: replacement.artifactRevision,
        },
        reply: { status: 200, body: { data: rebound } },
        read: rebound,
      },
    ]),
  )
  await visitReview(page)
  await expectReady(page, stale)
  await expectActions(page, ["reopen"])
  await actionOf(page, "reopen").click()
  await expectReady(page, rebound)
  await expectActions(page, ["request_changes", "approve"])
  expectScript(wire)
})

test("AI-TDD-S07-R02 / AI-TDD-S07-R07 six explicit actions wait for the server and preserve Work identity", async ({
  page,
}) => {
  const steps: (ScriptedTransition & { read: WorkReviewReady; enabled: readonly WorkReviewCommand["action"][] })[] = [
    {
      expected: {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: binding.artifactID,
        expectedArtifactRevision: binding.artifactRevision,
      },
      reply: { status: 200, body: { data: ready } },
      read: ready,
      enabled: ["request_changes", "approve"],
    },
    {
      expected: { ...approveCommand, action: "request_changes" },
      reply: { status: 200, body: { data: requested } },
      read: requested,
      enabled: ["respond"],
    },
    {
      expected: { action: "respond", expectedReviewRevision: 2 },
      reply: { status: 200, body: { data: responded } },
      read: responded,
      enabled: ["re_review"],
    },
    {
      expected: { ...approveCommand, action: "re_review", expectedReviewRevision: 3 },
      reply: { status: 200, body: { data: reviewed } },
      read: reviewed,
      enabled: ["request_changes", "approve"],
    },
    {
      expected: { ...approveCommand, expectedReviewRevision: 4 },
      reply: { status: 200, body: { data: approved } },
      read: approved,
      enabled: ["reopen"],
    },
    {
      expected: { ...approveCommand, action: "reopen", expectedReviewRevision: 5 },
      reply: { status: 200, body: { data: reopened } },
      read: reopened,
      enabled: ["request_changes", "approve"],
    },
  ]
  const gates = steps.map(() => Promise.withResolvers<void>())
  const wire = await mockWorkReview(
    page,
    reviewScript(
      available,
      steps.map((step, index) => ({ ...step, wait: gates[index].promise })),
    ),
  )
  await visitReview(page)
  const composer = page.locator('[data-component="prompt-input"]')
  await composer.fill("Keep this unrelated composer draft")
  const header = page.locator('[data-component="session-product-header"]')
  await expect(header.locator('[data-field="mode"]')).toHaveText("Work")
  await expect(header.locator('[data-field="agent"]')).toHaveText("work-orchestrator")
  await expectActions(page, ["submit"])

  try {
    for (const [index, step] of steps.entries()) {
      await test.step(names[step.expected.action], async () => {
        await actionOf(page, step.expected.action).click()
        await expect.poll(() => wire.commands.length).toBe(index + 1)
        expect(wire.commands[index].body).toEqual(step.expected)
        await expectActions(page, [])
        if (index === 0) await expect(panelOf(page)).toHaveAttribute("data-review-status", "none")
        if (index > 0) await expectReady(page, steps[index - 1].read)
        gates[index].resolve()
        await expectReady(page, step.read)
        await expectActions(page, step.enabled)
        await expect(header.locator('[data-field="mode"]')).toHaveText("Work")
        await expect(header.locator('[data-field="agent"]')).toHaveText("work-orchestrator")
        await expect(composer).toHaveText("Keep this unrelated composer draft")
        await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
      })
    }
  } finally {
    gates.forEach((gate) => gate.resolve())
  }
  await refreshReview(page)
  await expectReady(page, reopened)
  expectScript(wire)
})

test("AI-TDD-S07-R03 a rapid double click sends one deferred transition", async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  const wire = await mockWorkReview(
    page,
    reviewScript(ready, [
      {
        expected: approveCommand,
        reply: { status: 200, body: { data: approvedOnce } },
        read: approvedOnce,
        wait: gate.promise,
      },
    ]),
  )
  await visitReview(page)
  await expectReady(page, ready)
  try {
    await actionOf(page, "approve").dblclick()
    await expect.poll(() => wire.commands.length).toBe(1)
    await expectReady(page, ready)
    await expectActions(page, [])
  } finally {
    gate.resolve()
  }
  await expectReady(page, approvedOnce)
  await refreshReview(page)
  await expectReady(page, approvedOnce)
  await expectActions(page, ["reopen"])
  expectScript(wire)
})

test("AI-TDD-S07-R03 closing and reopening during a transition waits for its authoritative response", async ({
  page,
}) => {
  const gate = Promise.withResolvers<void>()
  const wire = await mockWorkReview(
    page,
    reviewScript(ready, [
      {
        expected: approveCommand,
        reply: { status: 200, body: { data: approvedOnce } },
        read: approvedOnce,
        wait: gate.promise,
      },
    ]),
  )
  await visitReview(page)
  await expectReady(page, ready)
  const previousReads = wire.reads.length
  try {
    await actionOf(page, "approve").click()
    await expect.poll(() => wire.commands.length).toBe(1)
    await expectActions(page, [])
    await closeReview(page)
    await openReview(page)
    await expect(panelOf(page).locator('[data-slot="progress"]')).toHaveText("Saving: Approve…")
    expect(wire.reads).toHaveLength(previousReads)
    await expectActions(page, [])
    gate.resolve()
    await expectReady(page, approvedOnce)
    await expectActions(page, ["reopen"])
    expect(wire.commands.map((command) => command.body)).toEqual([approveCommand])
  } finally {
    gate.resolve()
  }
  expectScript(wire)
})

test("AI-TDD-S07-R04 a failed authoritative refresh removes stale actions until a new read succeeds", async ({
  page,
}) => {
  const wire = await mockWorkReview(page)
  await visitReview(page)
  await expectReady(page, ready)
  wire.readFailures.push({
    status: 503,
    body: { _tag: "WorkReviewUnavailableError", code: "storage", message: "Review read is unavailable" },
  })
  const failedRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === reviewPath && response.request().method() === "GET",
  )
  await panelOf(page).getByRole("button", { name: "Refresh review", exact: true }).click()
  expect((await failedRead).status()).toBe(503)
  await expect(panelOf(page).getByRole("alert")).toContainText(/unavailable|failed|could not|connection.*interrupted/i)
  await expect(panelOf(page)).not.toHaveAttribute("data-review-status", "ready")
  await expectActions(page, [])
  await refreshReview(page)
  await expectReady(page, ready)
  await expectActions(page, ["request_changes", "approve"])
  expectScript(wire)
})

test("AI-TDD-S07-R03 two pages competing on one revision reconcile the 409 without resending", async ({
  page,
  context,
}) => {
  const wire = reviewScript(ready, [
    { expected: approveCommand, reply: { status: 200, body: { data: approvedOnce } }, read: approvedOnce },
    {
      expected: approveCommand,
      reply: {
        status: 409,
        body: {
          _tag: "ConflictError",
          resource: "work-review",
          message: "Work review revision changed; reload before retrying",
        },
      },
      read: approvedOnce,
    },
  ])
  await mockWorkReview(page, wire)
  await visitReview(page)
  await expectReady(page, ready)
  const other = await context.newPage()
  try {
    await mockWorkReview(other, wire)
    await visitReview(other)
    await expectReady(other, ready)
    const previousReads = wire.reads.filter((read) => read.page === other).length
    await actionOf(page, "approve").click()
    await expectReady(page, approvedOnce)
    await expectReady(other, ready)

    const rejected = other.waitForResponse(
      (response) => new URL(response.url()).pathname === reviewPath && response.request().method() === "POST",
    )
    await actionOf(other, "approve").click()
    expect((await rejected).status()).toBe(409)
    await expect.poll(() => wire.reads.filter((read) => read.page === other).length).toBeGreaterThan(previousReads)
    await expectReady(other, approvedOnce)
    await expectActions(other, ["reopen"])
    await expect(panelOf(other).getByRole("alert")).toContainText(/changed|conflict|revision/i)
    await expect(panelOf(other).locator('[data-slot="selected-action"]')).toHaveText("Selected action: Approve")
    await refreshReview(other)
    await expectReady(other, approvedOnce)
    expect(wire.commands[0]?.page).toBe(page)
    expect(wire.commands[1]?.page).toBe(other)
    expectScript(wire)
  } finally {
    await other.close()
  }
})

type FailureCase = {
  label: string
  reply: ScriptedReply
  reason: RegExp
  latest: WorkReviewReady
  retry: WorkReviewCommand
  recovered: WorkReviewReady
}
const failures: FailureCase[] = [
  {
    label: "network failure",
    reply: { abort: true },
    reason: /network|connection|fetch|connect|reach/i,
    latest: ready,
    retry: approveCommand,
    recovered: approvedOnce,
  },
  {
    label: "401 authentication failure",
    reply: { status: 401, body: { _tag: "UnauthorizedError", message: "Authentication required" } },
    reason: /authenticat|sign.?in|credential|unauthoriz|permission|access/i,
    latest: ready,
    retry: approveCommand,
    recovered: approvedOnce,
  },
  {
    label: "403 scope failure",
    reply: { status: 403, body: { _tag: "ForbiddenError", message: "Work review requires a Work Session" } },
    reason: /forbidden|not allowed|permission|Work Session|scope/i,
    latest: ready,
    retry: approveCommand,
    recovered: approvedOnce,
  },
  {
    label: "409 revision failure",
    reply: {
      status: 409,
      body: {
        _tag: "ConflictError",
        resource: "work-review",
        message: "Work review revision changed; reload before retrying",
      },
    },
    reason: /changed|conflict|revision/i,
    latest: concurrent,
    retry: { ...approveCommand, expectedReviewRevision: 7 },
    recovered: afterConflict,
  },
  {
    label: "503 storage failure",
    reply: {
      status: 503,
      body: { _tag: "WorkReviewUnavailableError", code: "storage", message: "Work review storage is unavailable" },
    },
    reason: /unavailable|storage|service|connection|failed|could not/i,
    latest: ready,
    retry: approveCommand,
    recovered: approvedOnce,
  },
]

for (const failure of failures) {
  test(`AI-TDD-S07-R04 ${failure.label} retains the action and permits an explicit retry after refresh`, async ({
    page,
  }) => {
    const wire = await mockWorkReview(
      page,
      reviewScript(ready, [
        { expected: approveCommand, reply: failure.reply, read: failure.latest },
        { expected: failure.retry, reply: { status: 200, body: { data: failure.recovered } }, read: failure.recovered },
      ]),
    )
    await visitReview(page)
    await actionOf(page, "approve").click()
    const notice = panelOf(page).getByRole("alert")
    await expect(notice).toBeVisible()
    await expect(panelOf(page).locator('[data-slot="selected-action"]')).toHaveText("Selected action: Approve")
    await expect(notice).toContainText(failure.reason)
    await expect(notice).toContainText(/refresh|retry|reload|again/i)
    expect(wire.commands.map((command) => command.body)).toEqual([approveCommand])

    await refreshReview(page)
    await expectReady(page, failure.latest)
    await expectActions(page, ["request_changes", "approve"])
    expect(wire.commands.map((command) => command.body)).toEqual([approveCommand])
    await actionOf(page, "approve").click()
    await expectReady(page, failure.recovered)
    await expectActions(page, ["reopen"])
    expectScript(wire)
  })
}

for (const lost of [
  { label: "lost network acknowledgement", reply: { abort: true } },
  {
    label: "503 after commit",
    reply: {
      status: 503,
      body: {
        _tag: "WorkReviewUnavailableError",
        code: "notification",
        committedRevision: 2,
        message: "Work review notification failed; reload before retrying",
      },
    },
  },
] as const) {
  test(`AI-TDD-S07-R04 ${lost.label} reads the committed verdict instead of replaying approval`, async ({ page }) => {
    const wire = await mockWorkReview(
      page,
      reviewScript(ready, [{ expected: approveCommand, reply: lost.reply, read: approvedOnce }]),
    )
    await visitReview(page)
    await actionOf(page, "approve").click()
    await expect(panelOf(page).getByRole("alert")).toBeVisible()
    await expect(panelOf(page).locator('[data-slot="selected-action"]')).toHaveText("Selected action: Approve")
    await refreshReview(page)
    await expectReady(page, approvedOnce)
    await expectActions(page, ["reopen"])
    await closeReview(page)
    await openReview(page)
    await expectReady(page, approvedOnce)
    expectScript(wire)
  })
}

test("AI-TDD-S07-R04 closing review leaves both pending question and permission requests untouched", async ({
  page,
}) => {
  const wire = reviewScript(ready)
  wire.questions.push({
    id: "que_work_review_pending",
    sessionID,
    questions: [
      {
        header: "Unrelated choice",
        question: "Keep this question pending during artifact review?",
        options: [
          { label: "Keep", description: "Leave the decision unanswered" },
          { label: "Discuss", description: "Discuss it separately" },
        ],
        multiple: false,
        custom: true,
      },
    ],
  })
  wire.permissions.push({
    id: "per_work_review_pending",
    sessionID,
    action: "bash",
    resources: ["echo separate-request"],
  })
  await mockWorkReview(page, wire)
  await visitReview(page)
  await expectReady(page, ready)
  const picker = page
    .locator('[data-component="session-request-picker"]')
    .getByRole("button", { name: /Pending requests: 2/ })
  await expect(picker).toBeVisible()
  await closeReview(page)
  await expect(picker).toBeVisible()
  await picker.click()
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2)
  await page.keyboard.press("Escape")
  await openReview(page)
  await refreshReview(page)
  await expectReady(page, ready)
  expectScript(wire)
})

test("AI-TDD-S07-R01 reload replaces the prior panel result with a fresh authoritative GET (E3 only)", async ({
  page,
}) => {
  const wire = await mockWorkReview(page)
  await visitReview(page)
  await expectReady(page, ready)
  const previousReads = wire.reads.length
  wire.read = afterConflict
  await page.reload()
  await expectSessionTitle(page, title)
  await openReview(page)
  await expect.poll(() => wire.reads.length).toBeGreaterThan(previousReads)
  await expectReady(page, afterConflict)
  await expectActions(page, ["reopen"])
  expectScript(wire)
})

test("AI-TDD-S07-R07 ad-hoc Apply remains valid without creating a review or changing Mode/Agent", async ({ page }) => {
  const wire = await mockWorkReview(page, reviewScript({ status: "none" }))
  await page.goto(sessionPath)
  await expectSessionTitle(page, title)
  const header = page.locator('[data-component="session-product-header"]')
  await expect(header.locator('[data-field="mode"]')).toHaveText("Work")
  await expect(header.locator('[data-field="agent"]')).toHaveText("work-orchestrator")
  await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toHaveAttribute("aria-selected", "true")
  const applied = page.waitForResponse(
    (response) => new URL(response.url()).pathname === applyPath && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Apply to project", exact: true }).click()
  expect((await applied).status()).toBe(200)
  await expect(page.getByText("Applied", { exact: true })).toBeVisible()
  await expect(panelOf(page)).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(header.locator('[data-field="mode"]')).toHaveText("Work")
  await expect(header.locator('[data-field="agent"]')).toHaveText("work-orchestrator")
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  expect(wire.applies).toHaveLength(1)
  expect(wire.applies[0]).toMatchObject({ content: draft, overwrite: false })
  expectScript(wire)
})
