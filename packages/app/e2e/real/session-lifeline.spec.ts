/**
 * S2 GREEN lifeline: health → create Session → reload, three rounds, retries=0.
 *
 * This spec talks to a REAL backend through a REAL production app build —
 * nothing intercepts the network. The health canary ties the browser-facing
 * backend to the process the orchestrator started: the asserted version comes
 * from the orchestrator's own `GET /global/health` probe recorded in the
 * runtime manifest, so an E3 mock answering on the wire cannot satisfy it.
 * Durability comes from the real SQLite DB in the temp run dir: after reload
 * the session projection is served by the backend again, not by browser state.
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { expectSessionTitle } from "../utils/waits"

for (const round of [1, 2, 3]) {
  test(`real backend lifeline round ${round}: health → create → reload`, async ({ page, request }) => {
    const e4m = e4()

    // 1. Real health canary — version equality with the orchestrator's probe.
    const health = await request.get(`${e4m.backendUrl}/global/health`)
    expect(health.ok(), `backend health at ${e4m.backendUrl}`).toBeTruthy()
    const healthBody: unknown = await health.json()
    if (!isRecord(healthBody)) throw new Error("health response is not an object")
    expect(healthBody.healthy).toBe(true)
    expect(healthBody.version).toBe(e4m.backendVersion)

    // 2. Create a session through the real API — a durable session_input row in
    //    the run's own SQLite DB, not browser state.
    const created = await request.post(`${e4m.backendUrl}/session?directory=${encodeURIComponent(e4m.workspaceDir)}`, {
      headers: { "x-aigcfroge-directory": e4m.workspaceDir },
      data: { location: { directory: e4m.workspaceDir }, title: `E4 lifeline round ${round}` },
    })
    expect(created.ok(), `session create: ${await created.text()}`).toBeTruthy()
    const createdBody: unknown = await created.json()
    if (!isRecord(createdBody) || typeof createdBody.id !== "string") {
      throw new Error("session create response has no id")
    }
    const sessionID = createdBody.id
    expect(sessionID).toMatch(/^ses/)

    // 3. The production app renders the canonical URL against the real backend.
    seedRealBackend(page, e4m.backendUrl)
    const canonical = `/server/${base64Encode(e4m.backendUrl)}/session/${sessionID}`
    await page.goto(canonical)
    await expectSessionTitle(page, `E4 lifeline round ${round}`)

    // 4. Reload — the projection is served again from the real DB.
    await page.reload()
    await expectSessionTitle(page, `E4 lifeline round ${round}`)
  })
}
