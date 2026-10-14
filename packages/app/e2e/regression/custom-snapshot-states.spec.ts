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

const directory = "C:/Aigcfroge/CustomSnapshotStates"
const serverA = "http://127.0.0.1:4097"
const serverB = "http://127.0.0.1:4098"
const sessionID = "ses_custom_snapshot_states"
const upgradedID = "ses_custom_snapshot_upgraded"
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

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
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
    title: id === sessionID ? "Custom snapshot source" : "Custom snapshot upgraded",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

type Wire = {
  snapshot: { status: number; body: unknown }
  snapshotReads: number
  plan: CompositionPlan
  planGate?: Promise<void>
  posts: Array<{ origin: string; path: string; directory: string | null; body: unknown }>
}

function wire(): Wire {
  return { snapshot: { status: 200, body: snapshot }, snapshotReads: 0, plan, posts: [] }
}

async function openSnapshot(page: Page, state: Wire) {
  for (const [port, sessions] of [
    ["4097", []],
    ["4098", [session(), session(upgradedID)]],
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
          status: 200,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify(state.plan),
        })
      }
      if (url.pathname !== "/custom-composition/upgrade") return route.fallback()
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
    ({ serverA, serverB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
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
    { serverA, serverB },
  )
  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: "Custom snapshot source", exact: true })).toBeVisible()
  await expect(page.locator('[data-component="session-mode-panel"][data-mode="custom"]')).toBeVisible()
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
