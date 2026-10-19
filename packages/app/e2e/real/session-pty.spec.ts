/**
 * S5 PTY chain (plan §8.3): real HTTP + WebSocket against the run's backend.
 *
 * No `page.route`, no `setTimeout` guessing: the spec waits for the WebSocket to
 * open, for output to arrive, and for the process to exit — every wait is a real
 * protocol signal. Teardown must leave no orphaned PTY behind, which the
 * harness's port/process gate plus an explicit list assertion cover.
 */
import { expect, test, type APIRequestContext } from "@playwright/test"
import { e4 } from "./fixture"
import { isRecord } from "./manifest"
import { Contracts } from "./contracts"

// `connect-token` is CSRF-guarded: the handler requires this exact header
// (packages/aigcfroge/src/server/shared/pty-ticket.ts) or answers PtyForbiddenError.
const headers = () => ({
  "x-aigcfroge-directory": e4().workspaceDir,
  "content-type": "application/json",
  "x-aigcfroge-ticket": "1",
})

async function listPtys(request: APIRequestContext) {
  const response = await request.get(`${e4().backendUrl}/pty?directory=${encodeURIComponent(e4().workspaceDir)}`, {
    headers: headers(),
  })
  expect(response.ok(), `pty list: ${await response.text()}`).toBeTruthy()
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error("pty list response is not an array")
  return body
}

async function createPty(request: APIRequestContext, input: { title: string; command: string; args?: string[] }) {
  const created = await request.post(`${e4().backendUrl}/pty?directory=${encodeURIComponent(e4().workspaceDir)}`, {
    headers: headers(),
    data: { ...input, cwd: e4().workspaceDir },
  })
  expect(created.ok(), `pty create: ${await created.text()}`).toBeTruthy()
  const body: unknown = await created.json()
  if (!isRecord(body) || typeof body.id !== "string") throw new Error("pty create response has no id")
  return body.id
}

test.skip(() => e4().v2Runtime, "pty chain runs against the default backend")

test("creates a PTY, streams output over the real WebSocket, and closes on deletion", async ({ request }) => {
  const e4m = e4()
  const ptyID = await createPty(request, { title: "S5 pty", command: "/bin/sh" })

  const token = await request.post(
    `${e4m.backendUrl}/pty/${ptyID}/connect-token?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    { headers: headers(), data: {} },
  )
  expect(token.ok(), `connect-token: ${await token.text()}`).toBeTruthy()
  const tokenBody: unknown = await token.json()
  if (!isRecord(tokenBody) || typeof tokenBody.ticket !== "string") {
    throw new Error("connect-token response has no ticket")
  }
  const ticket = tokenBody.ticket

  const socket = new WebSocket(
    `ws://127.0.0.1:${e4m.backendPort}/pty/${ptyID}/connect?directory=${encodeURIComponent(e4m.workspaceDir)}&ticket=${encodeURIComponent(ticket)}`,
  )
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code), { once: true })
  })
  try {
    const output = await new Promise<string>((resolve, reject) => {
      let text = ""
      socket.addEventListener("open", () => socket.send(Contracts.ptyCommand), { once: true })
      socket.addEventListener("message", (event) => {
        text += typeof event.data === "string" ? event.data : ""
        if (Contracts.hasPtyOutput(text)) resolve(text)
      })
      socket.addEventListener("error", () => reject(new Error("pty websocket error")), { once: true })
      socket.addEventListener("close", () => reject(new Error("pty websocket closed before output")), { once: true })
    })
    expect(Contracts.hasPtyOutput(output), "pty streamed the command output").toBe(true)
    expect(socket.readyState, "the server still owns the live socket before deletion").toBe(WebSocket.OPEN)

    const removed = await request.delete(
      `${e4m.backendUrl}/pty/${ptyID}?directory=${encodeURIComponent(e4m.workspaceDir)}`,
      { headers: headers() },
    )
    expect(removed.ok(), `pty delete: ${await removed.text()}`).toBeTruthy()
    expect(await closed, "deletion closes the attached WebSocket normally").toBe(1000)
  } finally {
    socket.close()
  }
  const missing = await request.get(`${e4m.backendUrl}/api/pty/${ptyID}`, { headers: headers() })
  expect(missing.status()).toBe(404)
  expect(await missing.json()).toMatchObject({ _tag: "PtyNotFoundError", ptyID })
  await expect.poll(async () => (await listPtys(request)).length, { timeout: 20_000 }).toBe(0)
})

test("an immediately exited PTY retains its exit code until explicit removal", async ({ request }) => {
  const ptyID = await createPty(request, { title: "S5 pty exit", command: "/bin/sh", args: ["-c", "exit 7"] })

  // /api/pty retains the process result. The active-only /pty surface hides it.
  await expect
    .poll(
      async () => {
        const info = await request.get(`${e4().backendUrl}/api/pty/${ptyID}`, { headers: headers() })
        expect(info.status()).toBe(200)
        return info.json()
      },
      { timeout: 10_000 },
    )
    .toMatchObject({
      location: { directory: e4().workspaceDir },
      data: { id: ptyID, status: "exited", exitCode: 7 },
    })

  const hidden = await request.get(
    `${e4().backendUrl}/pty/${ptyID}?directory=${encodeURIComponent(e4().workspaceDir)}`,
    { headers: headers() },
  )
  expect(hidden.status()).toBe(404)
  expect(await hidden.json()).toMatchObject({ _tag: "PtyNotFoundError", ptyID })
  expect(await listPtys(request)).toEqual([])

  const retained = await request.get(`${e4().backendUrl}/api/pty`, { headers: headers() })
  expect(retained.status()).toBe(200)
  expect(await retained.json()).toMatchObject({
    location: { directory: e4().workspaceDir },
    data: [{ id: ptyID, status: "exited", exitCode: 7 }],
  })

  const removed = await request.delete(`${e4().backendUrl}/api/pty/${ptyID}`, { headers: headers() })
  expect(removed.status()).toBe(204)
  const missing = await request.get(`${e4().backendUrl}/api/pty/${ptyID}`, { headers: headers() })
  expect(missing.status()).toBe(404)
  expect(await missing.json()).toMatchObject({ _tag: "PtyNotFoundError", ptyID })
  const empty = await request.get(`${e4().backendUrl}/api/pty`, { headers: headers() })
  expect(empty.status()).toBe(200)
  expect(await empty.json()).toMatchObject({ data: [] })
})

test("creating a PTY with a nonexistent command rejects without retaining a process", async ({ request }) => {
  const created = await request.post(`${e4().backendUrl}/pty?directory=${encodeURIComponent(e4().workspaceDir)}`, {
    headers: headers(),
    data: { title: "S5 pty bad", command: "/definitely/not/a/binary", cwd: e4().workspaceDir },
  })
  // The current Linux spawn failure is an HTTP 500, without a typed 4xx contract.
  expect(created.status()).toBe(500)
  await expect.poll(async () => (await listPtys(request)).length, { timeout: 20_000 }).toBe(0)
  const empty = await request.get(`${e4().backendUrl}/api/pty`, { headers: headers() })
  expect(empty.status()).toBe(200)
  expect(await empty.json()).toMatchObject({ data: [] })
})
