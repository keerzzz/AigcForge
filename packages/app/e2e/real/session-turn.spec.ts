/**
 * S5 Session chain — the REAL product path (plan §8.1, V1 default runtime).
 *
 * Runtime fact this spec is built on (four-layer probe, S5 checkpoint): the
 * durable `session_input` inbox belongs to the opt-in V2 runtime
 * (`AIGCFROGE_V2_RUNTIME`, default false — packages/aigcfroge/src/effect/app-runtime.ts:87-94).
 * The default product path posts the prompt through the legacy prompt service,
 * which writes messages/parts directly. So THIS spec asserts what the product
 * actually does: submit → provider turn → projected parts → reload → restart
 * durability of a completed turn. Durable-admission evidence lives in
 * `v2-admission-gap.spec.ts`, which pins the V2 gap instead of pretending it is
 * the product chain.
 *
 * V1 semantics deliberately NOT asserted here (the payload has no such fields —
 * packages/aigcfroge/src/session/prompt.ts:117-130): queue, steer, resume. Only
 * submit, abort, and completed-turn durability exist on this path.
 *
 * Restart coverage stays inside the safe window of specs/v2/session.md:188: a
 * COMPLETED turn's projection must survive a backend restart. Nothing here
 * claims anything about provider-dispatched-but-unresolved work.
 *
 * The last two cases (S9A) add the per-mode half of plan §5.2: one happy path
 * driven in `chat`, plus a control that reads back the mode the two cases above
 * actually ran under, since neither of them sends one.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { expectAppVisible } from "../utils/waits"

const ASSISTANT_TEXT = "E4 deterministic response"
// The artifact panel mirrors the assistant text, so scope to the first match
// (the timeline paragraph) instead of tripping strict mode.
const assistantText = (page: Page) => page.getByText(ASSISTANT_TEXT).first()
const composer = (page: Page) => page.locator('[data-component="session-composer"]')
const input = (page: Page) => composer(page).locator('[data-component="prompt-input"]')

async function createSession(request: APIRequestContext, title: string, mode?: string) {
  const e4m = e4()
  const created = await request.post(`${e4m.backendUrl}/session?directory=${encodeURIComponent(e4m.workspaceDir)}`, {
    headers: { "x-aigcfroge-directory": e4m.workspaceDir },
    data: { location: { directory: e4m.workspaceDir }, title, ...(mode ? { mode } : {}) },
  })
  expect(created.ok(), `session create: ${await created.text()}`).toBeTruthy()
  const body: unknown = await created.json()
  if (!isRecord(body) || typeof body.id !== "string") throw new Error("session create response has no id")
  return body.id
}

/**
 * The persisted session record, read from the real backend. The mode lives here and nowhere in
 * the turn's own projection, so a case that claims to drive mode X has to read it back rather
 * than infer it from the URL or from which panels happen to render.
 */
async function persistedSession(request: APIRequestContext, sessionID: string) {
  const e4m = e4()
  const response = await request.get(
    `${e4m.backendUrl}/session/${sessionID}?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    { headers: { "x-aigcfroge-directory": e4m.workspaceDir } },
  )
  expect(response.ok(), `session read: ${await response.text()}`).toBeTruthy()
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.mode !== "string") throw new Error("session read response has no mode")
  return body
}

async function promptViaBrowser(page: Page, text: string) {
  await expectAppVisible(input(page))
  await input(page).fill(text)
  await input(page).press("Enter")
}

// The default runtime is the product path; the V2 variant run skips this file.
test.skip(() => e4().v2Runtime, "V1 product chain — not the V2 variant run")

test("browser submit runs a real provider turn that survives reload", async ({ page, request }) => {
  const e4m = e4()
  const sessionID = await createSession(request, "S5 session turn")

  const promptRequests: string[] = []
  page.on("request", (event) => {
    const path = new URL(event.url()).pathname
    if (event.method() === "POST" && path.endsWith("/prompt_async")) promptRequests.push(path)
  })

  seedRealBackend(page, e4m.backendUrl)
  await page.goto(`/server/${base64Encode(e4m.backendUrl)}/session/${sessionID}`)

  await promptViaBrowser(page, "Explain the E4 session lifeline")

  // 1. The submit went through the real endpoint.
  await expect.poll(() => promptRequests.length, { timeout: 30_000 }).toBeGreaterThan(0)

  // 2. The deterministic provider answered and its turn reached the timeline.
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText("Explain the E4 session lifeline")).toBeVisible()

  // 3. Reload serves the same projection from the real DB.
  await page.reload()
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })
})

test("a completed turn's projection survives a backend restart", async ({ page, request }) => {
  // The harness stops the real backend and waits for its own health endpoint
  // (up to 240s) instead of sleeping, so this case needs more than the config's
  // default budget for a single-request test.
  test.setTimeout(360_000)
  const e4m = e4()
  const sessionID = await createSession(request, "S5 restart durability")

  seedRealBackend(page, e4m.backendUrl)
  await page.goto(`/server/${base64Encode(e4m.backendUrl)}/session/${sessionID}`)
  await promptViaBrowser(page, "Durable across restart")
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })

  // The harness owns the backend process. It accepts the restart immediately
  // (202) and cycles the child in the background; readiness is then polled from
  // the backend's own health endpoint — a real signal, never a sleep.
  const harness = new URL(e4m.providerBaseURL).origin
  const restarted = await request.post(`${harness}/e4/restart-backend`)
  expect(restarted.status(), "harness accepted the restart").toBe(202)

  await expect
    .poll(
      async () => {
        const probe = await request.get(`${harness}/e4/backend-health`)
        const body: unknown = await probe.json()
        return isRecord(body) && body.healthy === true
      },
      { timeout: 300_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true)

  // Loaded fresh after restart: the completed turn is still projected.
  await page.reload()
  await expect(page.getByText("Durable across restart")).toBeVisible({ timeout: 90_000 })
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })
})

// Plan §5.2 asks for at least one happy path per mode in E4, and chat was the one mode without
// one: the two cases above never send a `mode`, so what they drive is the server default. The
// control below measures what that default is instead of leaving it to be read off the schema,
// and the chat case drives the same chain under a mode that resolves a *different* agent
// (chat → `meta`, ADR-13 Amendment-2) and renders a different set of panels.
test("a chat-mode session runs a real provider turn and keeps its mode", async ({ page, request }) => {
  const e4m = e4()
  const sessionID = await createSession(request, "S9A chat-mode session turn", "chat")
  expect((await persistedSession(request, sessionID)).mode, "created as chat, not defaulted").toBe("chat")

  seedRealBackend(page, e4m.backendUrl)
  await page.goto(`/server/${base64Encode(e4m.backendUrl)}/session/${sessionID}`)

  await promptViaBrowser(page, "Explain the E4 chat lifeline")

  // The same two halves the coding-path case asserts: the provider's turn reached the
  // timeline, and a reload serves that projection from the real DB.
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText("Explain the E4 chat lifeline")).toBeVisible()
  await page.reload()
  await expect(assistantText(page)).toBeVisible({ timeout: 90_000 })

  expect((await persistedSession(request, sessionID)).mode, "mode survives the turn and reload").toBe("chat")
})

test("a session created without a mode reports the server default", async ({ request }) => {
  const sessionID = await createSession(request, "S9A default-mode control")
  expect((await persistedSession(request, sessionID)).mode).toBe("coding")
})
