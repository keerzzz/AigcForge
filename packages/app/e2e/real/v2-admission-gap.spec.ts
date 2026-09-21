/**
 * ⚠️ GREEN HERE MEANS THE GAP IS STILL THERE — this file is a live defect pin,
 * not a product-pass claim (plan §8.1 errata, Owner ruling 2026-09-14, option A).
 *
 * The durable `session_input` admission inbox exists only on the opt-in V2
 * runtime (`AIGCFROGE_V2_RUNTIME`, default false):
 *   - packages/aigcfroge/src/effect/app-runtime.ts:87-94 (flag default + known bugs)
 *   - packages/core/src/product-mode-policy.ts:102 (`custom` always V2, else the flag)
 *   - packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:819
 *     (promptAsync splits admitCanonical vs the legacy prompt service)
 *
 * Four-layer probe (S5 checkpoint) established what the V2 path does TODAY:
 * admission row written, provider never dispatched, V1 message projection empty.
 * These assertions encode exactly that, so completing the V2 path turns them red
 * and forces a contract update — the same pin-defect pattern S4 used for routing.
 *
 * Runs only in the V2 variant (`E4_V2_RUNTIME=1`), where the harness injects the
 * flag into an isolated backend. The default run skips it, and the default
 * backend never carries the flag.
 */
import { expect, test, type APIRequestContext } from "@playwright/test"
import { e4 } from "./fixture"
import { isRecord } from "./manifest"

test.skip(() => !e4().v2Runtime, "V2 variant only — run with E4_V2_RUNTIME=1")

interface AdmissionRow {
  id: string
  kind: string
  delivery: string
  admitted_seq: number
  promoted_seq: number | null
}

async function admissionRows(sessionID: string): Promise<Array<AdmissionRow>> {
  const providerOrigin = new URL(e4().providerBaseURL).origin
  const response = await fetch(`${providerOrigin}/e4/admission?sessionID=${encodeURIComponent(sessionID)}`)
  expect(response.ok).toBeTruthy()
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.rows)) throw new Error("admission response has no rows")
  return body.rows.map((row, index) => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.admitted_seq !== "number") {
      throw new Error(`admission row ${index} is missing id/admitted_seq`)
    }
    return {
      id: row.id,
      kind: typeof row.kind === "string" ? row.kind : "prompt",
      delivery: typeof row.delivery === "string" ? row.delivery : "unknown",
      admitted_seq: row.admitted_seq,
      promoted_seq: typeof row.promoted_seq === "number" ? row.promoted_seq : null,
    }
  })
}

async function promptViaApi(request: APIRequestContext, sessionID: string, messageID: string, text: string) {
  const e4m = e4()
  return request.post(
    `${e4m.backendUrl}/session/${sessionID}/prompt_async?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    {
      headers: { "x-aigcfroge-directory": e4m.workspaceDir, "content-type": "application/json" },
      data: {
        messageID,
        agent: "build",
        model: { providerID: "e4-real", modelID: "e4-deterministic" },
        parts: [{ type: "text", text }],
      },
    },
  )
}

test("V2 runtime: durable admission lands, but execution is not dispatched and the V1 projection is empty", async ({
  request,
}) => {
  const e4m = e4()
  expect(e4m.v2Runtime, "this run must be the flag-on variant").toBe(true)

  const created = await request.post(`${e4m.backendUrl}/session?directory=${encodeURIComponent(e4m.workspaceDir)}`, {
    headers: { "x-aigcfroge-directory": e4m.workspaceDir },
    data: { location: { directory: e4m.workspaceDir }, title: "S5 V2 admission gap" },
  })
  const sessionBody: unknown = await created.json()
  if (!isRecord(sessionBody) || typeof sessionBody.id !== "string") throw new Error("session create response has no id")
  const sessionID = sessionBody.id

  const accepted = await promptViaApi(request, sessionID, "msg_s5_v2_gap", "V2 admission probe")
  expect(accepted.status(), "prompt_async accepts on the V2 path").toBe(204)

  // (a) Durable admission happened — the real behaviour custom-mode sessions rely on.
  await expect.poll(async () => (await admissionRows(sessionID)).length, { timeout: 30_000 }).toBeGreaterThan(0)
  const rows = await admissionRows(sessionID)
  expect(rows[0].admitted_seq, "admitted_seq assigned").toBeGreaterThan(0)
  expect(rows[0].kind).toBe("prompt")

  // (b) Gap: the provider was never called for this session's turn.
  const providerOrigin = new URL(e4m.providerBaseURL).origin
  const dispatch = await fetch(`${providerOrigin}/e4/provider-requests`)
  const dispatchBody: unknown = await dispatch.json()
  if (!isRecord(dispatchBody) || !Array.isArray(dispatchBody.requests)) {
    throw new Error("provider-requests response has no requests")
  }
  const chatCalls = dispatchBody.requests.filter(
    (entry) => isRecord(entry) && typeof entry.path === "string" && entry.path.endsWith("/chat/completions"),
  )
  expect(chatCalls.length, "GAP PIN: V2 admits without dispatching provider work today").toBe(0)

  // (c) Gap: the V1 message projection the app reads returns nothing on this path.
  const messages = await request.get(
    `${e4m.backendUrl}/session/${sessionID}/message?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    { headers: { "x-aigcfroge-directory": e4m.workspaceDir } },
  )
  expect(messages.status()).toBe(200)
  const projected: unknown = await messages.json()
  if (!Array.isArray(projected)) throw new Error("message projection is not an array")
  expect(projected.length, "GAP PIN: V1-shaped projection is empty for V2-admitted sessions").toBe(0)
})
