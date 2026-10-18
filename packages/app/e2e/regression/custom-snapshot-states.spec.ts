import { expect, test, type Page } from "@playwright/test"
import type {
  CompositionPlan,
  CompositionSnapshotV2,
  CompositionStartResponse,
  CompositionTemporaryInput,
  ProviderListResponse,
  Session,
} from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { PRESENTATION_EXPECTED } from "../presentation-matrix"

const directory = "C:/Aigcfroge/CustomSnapshotStates"
const serverA = "http://127.0.0.1:4097"
const serverB = "http://127.0.0.1:4098"
const sessionID = "ses_custom_snapshot_states"
const upgradedID = "ses_custom_snapshot_upgraded"
const otherID = "ses_custom_snapshot_other"
const snapshot = {
  version: 2,
  digest: "a".repeat(64),
  sessionID,
  profilePath: "review-profile.yaml",
  profileRevision: "b".repeat(64),
  createdAt: 1700000000000,
  data: {
    agents: [
      {
        id: "pool-reviewer",
        name: "reviewer",
        description: "Reviews code",
        relativePath: "reviewer.md",
        revision: "c".repeat(64),
      },
    ],
    bindings: { orchestrator: { instructions: [], prompts: [], skills: [], commands: [] } },
    instructions: [],
    prompts: [],
    skills: [],
    commands: [],
    tools: { fingerprints: [], catalogDigest: "d".repeat(64), catalog: [] },
  },
} satisfies CompositionSnapshotV2
const composition = {
  source: "temporary",
  agents: [{ kind: "agent", relativePath: "reviewer.md", revision: "c".repeat(64) }],
  bindings: { orchestrator: { prompts: [], skills: [], commands: [] } },
  presentation: "native",
  requestedCapabilities: [],
} satisfies CompositionTemporaryInput
const plan = {
  version: 2,
  digest: "e".repeat(64),
  valid: true,
  input: composition,
  agents: snapshot.data.agents,
  instructions: [],
  skills: [],
  capabilities: [],
  diagnostics: [],
} satisfies CompositionPlan
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.tags.includes("@presentation")) await pinEnglishUI(page)
  await page.setViewportSize({ width: 1400, height: 900 })
})

function session(id = sessionID): Session {
  return {
    id,
    slug: id,
    projectID: "proj_custom_snapshot_states",
    directory,
    mode: "custom",
    agent: "meta",
    title:
      id === sessionID
        ? "Custom snapshot source"
        : id === upgradedID
          ? "Custom snapshot upgraded"
          : "Custom snapshot other",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

type Wire = {
  snapshot: { status: number; body: unknown }
  snapshotReads: number
  snapshotGate?: Promise<void>
  plan: CompositionPlan
  planGate?: Promise<void>
  planStatus?: number
  upgradeGate?: Promise<void>
  upgradeStatus?: number
  posts: Array<{ origin: string; path: string; directory: string | null; body: unknown }>
}

function wire(): Wire {
  return { snapshot: { status: 200, body: snapshot }, snapshotReads: 0, plan, posts: [] }
}

async function openSnapshot(page: Page, state: Wire) {
  for (const [port, sessions] of [
    ["4097", []],
    ["4098", [session(), session(upgradedID), session(otherID)]],
  ] as const) {
    await mockAigcfrogeServer(page, {
      port,
      directory,
      project: {
        id: "proj_custom_snapshot_states",
        worktree: directory,
        vcs: "git",
        name: "snapshot-states",
        sandboxes: [],
        time: { created: 1700000000000, updated: 1700000000000 },
      },
      provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
      sessions: [...sessions],
      pageMessages: () => ({ items: [] }),
      events: () => [],
      eventRetry: 16,
    })
  }
  await page.route(
    (url) =>
      [serverA, serverB].includes(url.origin) &&
      (url.pathname.endsWith("/composition") || url.pathname.startsWith("/custom-composition/")),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
      const nextSnapshot = {
        ...snapshot,
        sessionID: upgradedID,
        profilePath: undefined,
        profileRevision: undefined,
        digest: state.plan.digest,
      }
      if (request.method() === "GET" && url.pathname.endsWith("/composition")) {
        state.snapshotReads += 1
        await state.snapshotGate
        const response =
          url.pathname === `/session/${upgradedID}/composition` ? { status: 200, body: nextSnapshot } : state.snapshot
        return route.fulfill({
          status: response.status,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify(response.body),
        })
      }
      if (request.method() !== "POST") return route.fallback()
      state.posts.push({
        origin: url.origin,
        path: url.pathname,
        directory: url.searchParams.get("directory"),
        body: request.postDataJSON() as unknown,
      })
      if (url.pathname === "/custom-composition/plan") {
        await state.planGate
        return route.fulfill({
          status: state.planStatus ?? 200,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify(state.planStatus ? { message: "Snapshot plan rejected" } : state.plan),
        })
      }
      if (url.pathname !== "/custom-composition/upgrade") return route.fallback()
      await state.upgradeGate
      if (state.upgradeStatus) {
        return route.fulfill({
          status: state.upgradeStatus,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify({
            message: state.upgradeStatus === 409 ? "SessionBusyError" : "Snapshot upgrade failed",
          }),
        })
      }
      const info = session(upgradedID)
      const response = {
        session: {
          id: info.id,
          slug: info.slug,
          projectID: info.projectID,
          mode: "custom",
          agent: "meta",
          title: info.title,
          version: info.version,
          time: info.time,
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        snapshot: nextSnapshot,
      } satisfies CompositionStartResponse
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify(response),
      })
    },
  )
  await page.addInitScript(
    ({ serverA, serverB, directory, sessionIDs }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify(
          sessionIDs.map((sessionId) => ({ type: "session", server: serverB, dirBase64: directory, sessionId })),
        ),
      )
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({
          list: [
            { type: "http", http: { url: serverA } },
            { type: "http", http: { url: serverB } },
          ],
          projects: {},
          lastProject: {},
        }),
      )
    },
    { serverA, serverB, directory: base64Encode(directory), sessionIDs: [sessionID, otherID] },
  )
  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: "Custom snapshot source", exact: true })).toBeVisible()
  const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
  // The narrow project renders mode panels as a content-panel overlay; open it so the
  // panel (and its gated read) becomes active, mirroring the user's narrow-mode entry.
  if (!(await panel.isVisible())) {
    const toggle = page.locator("#session-mode-panel-toggle")
    if (await toggle.isVisible()) {
      await toggle.click()
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
    }
  }
  await expect(panel).toBeVisible()
  await expect.poll(() => state.snapshotReads).toBeGreaterThan(0)
}

for (const failure of [
  { name: "absent", status: 404, body: { message: "fixture snapshot absent" } },
  { name: "rejected", status: 400, body: { message: "fixture snapshot rejected" } },
  { name: "server failure", status: 500, body: { message: "fixture snapshot failed" } },
  { name: "malformed success", status: 200, body: {} },
]) {
  test(`AI-TDD-S08-R02: an ${failure.name} snapshot cannot upgrade the workspace draft`, async ({ page }) => {
    const state = wire()
    state.snapshot = failure
    await openSnapshot(page, state)
    const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
    if (failure.status !== 404)
      await expect(panel.getByText(/Could not load this session's composition:/)).toBeVisible()
    await expect(panel.getByRole("button", { name: "Upgrade / Edit", exact: true })).toBeDisabled()
    expect(state.posts).toEqual([])
  })
}

test("AI-TDD-S08-R02: Upgrade replans the frozen composition and opens its original server", async ({ page }) => {
  const state = wire()
  const pending = Promise.withResolvers<void>()
  state.planGate = pending.promise
  try {
    await openSnapshot(page, state)
    const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
    await expect(panel.getByText(snapshot.digest, { exact: true })).toBeVisible()
    const button = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
    await button.click()
    await expect.poll(() => state.posts.map((item) => item.path)).toEqual(["/custom-composition/plan"])
    expect(state.posts[0]).toEqual({ origin: serverB, path: "/custom-composition/plan", directory, body: composition })
    await expect(button).toBeDisabled()
    pending.resolve()
    await expect.poll(() => state.posts.length).toBe(2)
    expect(state.posts[1]).toEqual({
      origin: serverB,
      path: "/custom-composition/upgrade",
      directory,
      body: { sessionID, composition, expectedPlanDigest: plan.digest },
    })
    await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
    await expect(page.getByRole("heading", { name: "Custom snapshot upgraded", exact: true })).toBeVisible()
    await expect(page.locator("#session-mode-panel-custom").getByText(plan.digest, { exact: true })).toBeVisible()
  } finally {
    pending.resolve()
  }
})

test("AI-TDD-S08-R02: an invalid Upgrade plan remains retryable without creating a session", async ({ page }) => {
  const state = wire()
  state.plan = {
    ...plan,
    valid: false,
    diagnostics: [{ severity: "error", code: "fixture-invalid", message: "fixture invalid plan" }],
  }
  await openSnapshot(page, state)
  const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
  await expect(panel.getByText(snapshot.digest, { exact: true })).toBeVisible()
  const button = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
  await button.click()
  await expect.poll(() => state.posts.map((item) => item.path)).toEqual(["/custom-composition/plan"])
  await expect(button).toBeEnabled()
  await expect(panel.getByText(/plan is invalid/i)).toBeVisible()
  state.plan = plan
  await button.click()
  await expect
    .poll(() => state.posts.map((item) => item.path))
    .toEqual(["/custom-composition/plan", "/custom-composition/plan", "/custom-composition/upgrade"])
  await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
})

test("AI-TDD-S08-R02: snapshot pending keeps the session visible and Upgrade disabled", async ({ page }) => {
  const state = wire()
  const pending = Promise.withResolvers<void>()
  state.snapshotGate = pending.promise
  try {
    await openSnapshot(page, state)
    const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
    const upgrade = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
    await expect(upgrade).toBeVisible()
    await expect(upgrade).toBeDisabled()
    await expect(panel.getByText(snapshot.digest, { exact: true })).toHaveCount(0)
    expect(state.posts).toEqual([])
    pending.resolve()
    await expect(panel.getByText(snapshot.digest, { exact: true })).toBeVisible()
    await expect(upgrade).toBeEnabled()
    expect(state.posts).toEqual([])
  } finally {
    pending.resolve()
  }
})

test("AI-TDD-S08-R02: pending Upgrade keeps one request and opens the source server on completion", async ({
  page,
}) => {
  const state = wire()
  const pending = Promise.withResolvers<void>()
  state.upgradeGate = pending.promise
  try {
    await openSnapshot(page, state)
    const upgrade = page
      .locator("#session-mode-panel-custom")
      .getByRole("button", { name: "Upgrade / Edit", exact: true })
    await expect(upgrade).toBeEnabled()
    await upgrade.click()
    await expect
      .poll(() => state.posts.map((item) => item.path))
      .toEqual(["/custom-composition/plan", "/custom-composition/upgrade"])
    await expect(upgrade).toBeDisabled()
    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
    expect(state.posts.every((post) => post.origin === serverB && post.directory === directory)).toBe(true)
    pending.resolve()
    await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
    expect(state.posts).toHaveLength(2)
  } finally {
    pending.resolve()
  }
})

for (const failure of [
  { stage: "plan", status: 400, message: "Snapshot plan rejected" },
  { stage: "upgrade", status: 500, message: "Snapshot upgrade failed" },
  { stage: "upgrade", status: 409, message: "Session is running, cannot upgrade" },
] as const) {
  test(`AI-TDD-S08-R02: Upgrade ${failure.stage} HTTP ${failure.status} preserves the source and permits explicit retry`, async ({
    page,
  }) => {
    const state = wire()
    if (failure.stage === "plan") state.planStatus = failure.status
    if (failure.stage === "upgrade") state.upgradeStatus = failure.status
    await openSnapshot(page, state)
    const panel = page.locator("#session-mode-panel-custom")
    const upgrade = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
    await expect(upgrade).toBeEnabled()
    await upgrade.click()
    await expect(panel.getByText(new RegExp(failure.message, "i"))).toBeVisible()
    await expect(upgrade).toBeEnabled()
    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
    await expect(panel.getByText(snapshot.digest, { exact: true })).toBeVisible()
    const failed =
      failure.stage === "plan"
        ? ["/custom-composition/plan"]
        : ["/custom-composition/plan", "/custom-composition/upgrade"]
    expect(state.posts.map((post) => post.path)).toEqual(failed)
    state.planStatus = undefined
    state.upgradeStatus = undefined
    await upgrade.click()
    await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
    expect(state.posts.map((post) => post.path)).toEqual([
      ...failed,
      "/custom-composition/plan",
      "/custom-composition/upgrade",
    ])
    expect(state.posts.at(-1)?.body).toEqual({ sessionID, composition, expectedPlanDigest: plan.digest })
  })
}

for (const stage of ["plan", "upgrade"] as const) {
  test(`AI-TDD-S08-R02: a late Upgrade ${stage} completion cannot take over another session`, async ({
    page,
  }, testInfo) => {
    const state = wire()
    const pending = Promise.withResolvers<void>()
    if (stage === "plan") state.planGate = pending.promise
    if (stage === "upgrade") state.upgradeGate = pending.promise
    try {
      await openSnapshot(page, state)
      const panel = page.locator("#session-mode-panel-custom")
      const upgrade = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
      await expect(upgrade).toBeEnabled()
      await upgrade.click()
      await expect.poll(() => state.posts.at(-1)?.path).toBe(`/custom-composition/${stage}`)
      await expect(upgrade).toBeDisabled()
      await page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${otherID}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`/session/${otherID}$`))
      await expect(page.getByRole("heading", { name: "Custom snapshot other", exact: true })).toBeVisible()
      await expect(upgrade).toBeEnabled()
      const current = await panel.elementHandle()
      if (!current) throw new Error("The replacement session panel must be mounted")
      const response = page.waitForResponse((item) => new URL(item.url()).pathname === `/custom-composition/${stage}`)
      pending.resolve()
      await (await response).finished()
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      await expect(page).toHaveURL(new RegExp(`/session/${otherID}$`))
      await expect(page.getByRole("heading", { name: "Custom snapshot other", exact: true })).toBeVisible()
      expect(await panel.evaluate((node, original) => node === original, current)).toBe(true)
      expect(state.posts.map((post) => post.path)).toEqual(
        stage === "plan" ? ["/custom-composition/plan"] : ["/custom-composition/plan", "/custom-composition/upgrade"],
      )
      await current.dispose()
    } finally {
      pending.resolve()
      await testInfo.attach(`snapshot-late-${stage}`, {
        body: JSON.stringify(state.posts, null, 2),
        contentType: "application/json",
      })
    }
  })
}

test("AI-TDD-S08-R02: a failed snapshot read is an alert with Retry and reads back", async ({ page }) => {
  const state = wire()
  state.snapshot = { status: 500, body: { message: "fixture snapshot failed" } }
  await openSnapshot(page, state)
  const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
  const alert = panel.getByRole("alert")
  await expect(alert).toContainText("Could not load this session's composition: fixture snapshot failed")
  const retry = alert.getByRole("button", { name: "Retry", exact: true })
  await expect(retry).toBeVisible()

  state.snapshot = { status: 200, body: snapshot }
  await retry.click()
  await expect(alert).toHaveCount(0)
  await expect(panel).toContainText("Snapshot Digest")
  await expect(panel).toContainText("a".repeat(64))
  expect(state.snapshotReads).toBeGreaterThan(1)
})

test(
  "AI-TDD-S08-R02: a failed snapshot read is visible and retryable in dark, Chinese and 390px",
  { tag: "@presentation" },
  async ({ page }, testInfo) => {
    const expected = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!expected) throw new Error(`unexpected project ${testInfo.project.name}`)
    const narrow = testInfo.project.name === "chromium-narrow"
    const state = wire()
    state.snapshot = { status: 500, body: { message: "fixture snapshot failed" } }
    await page.setViewportSize(expected.viewport)
    await openSnapshot(page, state)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", expected.colorScheme)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected.lang)
    if (narrow) expect(page.viewportSize()).toEqual({ width: 390, height: 844 })

    const panel = page.locator('[data-component="session-mode-panel"][data-mode="custom"]')
    const alert = panel.getByRole("alert")
    const label = expected.lang === "zh" ? "无法加载该会话的组合：" : "Could not load this session's composition:"
    await expect(alert).toContainText(label, { timeout: 20_000 })
    const retry = alert.getByRole("button", { name: expected.lang === "zh" ? "重试" : "Retry", exact: true })
    await expect(retry).toBeVisible()
    const box = await alert.boundingBox()
    if (!box) throw new Error("the snapshot error must have a box")
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)

    let focused = false
    for (let index = 0; index < 80 && !focused; index += 1) {
      await page.keyboard.press("Tab")
      focused = await retry.evaluate((node) => node === document.activeElement)
    }
    expect(focused, "the retry must be keyboard reachable").toBe(true)
    await expect(retry).toBeFocused()
    const outline = await retry.evaluate((node) => {
      const style = getComputedStyle(node)
      return { style: style.outlineStyle, width: style.outlineWidth }
    })
    expect(outline.style).not.toBe("none")
    expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)

    state.snapshot = { status: 200, body: snapshot }
    await page.keyboard.press("Enter")
    await expect(alert).toHaveCount(0)
    await expect(panel).toContainText("a".repeat(64))
  },
)

test("AI-TDD-S08-R02: an Upgrade busy failure is a dismissible alert and the button retries", async ({ page }) => {
  const state = wire()
  state.upgradeStatus = 409
  await openSnapshot(page, state)
  const panel = page.locator("#session-mode-panel-custom")
  const upgrade = panel.getByRole("button", { name: "Upgrade / Edit", exact: true })
  await upgrade.click()
  const alert = panel.getByRole("alert")
  await expect(alert).toContainText("Session is running, cannot upgrade")
  await expect(upgrade).toBeEnabled()
  await alert.getByRole("button", { name: "Dismiss", exact: true }).click()
  await expect(alert).toHaveCount(0)

  state.upgradeStatus = undefined
  await upgrade.click()
  await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
})

test(
  "AI-TDD-S08-R02: an Upgrade busy failure is visible and dismissible in dark, Chinese and 390px",
  { tag: "@presentation" },
  async ({ page }, testInfo) => {
    const expected = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!expected) throw new Error(`unexpected project ${testInfo.project.name}`)
    const narrow = testInfo.project.name === "chromium-narrow"
    const state = wire()
    state.upgradeStatus = 409
    await page.setViewportSize(expected.viewport)
    await openSnapshot(page, state)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", expected.colorScheme)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected.lang)
    if (narrow) expect(page.viewportSize()).toEqual({ width: 390, height: 844 })

    const panel = page.locator("#session-mode-panel-custom")
    const upgradeName = expected.lang === "zh" ? "升级 / 编辑" : "Upgrade / Edit"
    const upgrade = panel.getByRole("button", { name: upgradeName, exact: true })
    await upgrade.click()
    const alert = panel.getByRole("alert")
    const busyLabel = expected.lang === "zh" ? "会话正在运行中，无法升级" : "Session is running, cannot upgrade"
    await expect(alert).toContainText(busyLabel)
    const dismiss = alert.getByRole("button", {
      name: expected.lang === "zh" ? "忽略" : "Dismiss",
      exact: true,
    })
    await expect(dismiss).toBeVisible()
    const box = await alert.boundingBox()
    if (!box) throw new Error("the Upgrade error must have a box")
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)

    // The alert owns a real keyboard path: real Tab order reaches its Dismiss control.
    let focused = false
    for (let index = 0; index < 80 && !focused; index += 1) {
      await page.keyboard.press("Tab")
      focused = await dismiss.evaluate((node) => node === document.activeElement)
    }
    expect(focused, "the alert dismiss control must be keyboard reachable").toBe(true)
    await expect(dismiss).toBeFocused()
    // This control renders its focus affordance as a ring (box-shadow), not an outline.
    const focus = await dismiss.evaluate((node) => {
      const style = getComputedStyle(node)
      return { ring: style.boxShadow, visible: node.matches(":focus-visible") }
    })
    expect(focus.visible).toBe(true)
    expect(focus.ring).not.toBe("none")
    await page.keyboard.press("Enter")
    await expect(alert).toHaveCount(0)

    state.upgradeStatus = undefined
    await upgrade.click()
    await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(serverB)}/session/${upgradedID}$`))
  },
)

test("AI-TDD-S08-R02: a non-busy Upgrade failure is a localized alert with the server detail", async ({ page }) => {
  const state = wire()
  state.upgradeStatus = 500
  await openSnapshot(page, state)
  const panel = page.locator("#session-mode-panel-custom")
  await panel.getByRole("button", { name: "Upgrade / Edit", exact: true }).click()
  const alert = panel.getByRole("alert")
  await expect(alert).toContainText("Could not upgrade this session's composition: Snapshot upgrade failed")
})

test(
  "AI-TDD-S08-R04: a non-busy Upgrade failure is localized at dark, Chinese and 390px",
  { tag: "@presentation" },
  async ({ page }, testInfo) => {
    const expected = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!expected) throw new Error(`unexpected project ${testInfo.project.name}`)
    const narrow = testInfo.project.name === "chromium-narrow"
    const state = wire()
    state.upgradeStatus = 500
    await page.setViewportSize(expected.viewport)
    await openSnapshot(page, state)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", expected.colorScheme)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected.lang)
    if (narrow) expect(page.viewportSize()).toEqual({ width: 390, height: 844 })

    const panel = page.locator("#session-mode-panel-custom")
    const upgradeName = expected.lang === "zh" ? "升级 / 编辑" : "Upgrade / Edit"
    await panel.getByRole("button", { name: upgradeName, exact: true }).click()
    const alert = panel.getByRole("alert")
    const prefix = expected.lang === "zh" ? "无法升级该会话的组合：" : "Could not upgrade this session's composition:"
    await expect(alert).toContainText(prefix)
    // The server detail stays verbatim after the localized prefix.
    await expect(alert).toContainText("Snapshot upgrade failed")
    const box = await alert.boundingBox()
    if (!box) throw new Error("the Upgrade error must have a box")
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  },
)
