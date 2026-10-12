/** Positive execution and completed-turn recovery for opt-in V2 and frozen Custom sessions. */
import { createHash } from "node:crypto"
import { expect, test, type APIResponse } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { customRuntimeAgent, e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { pinEnglishUI } from "../utils/locale"

for (const mode of ["coding", "custom"] as const) {
  test(`${mode}: canonical admission executes once and the completed turn survives reload and restart`, async ({
    page,
    request,
  }) => {
    const runtime = e4()
    test.skip(mode === "coding" ? !runtime.v2Runtime : !runtime.customMode, `${mode} runtime variant only`)
    const headers = {
      "x-aigcfroge-directory": runtime.workspaceDir,
      "x-aigcfroge-capabilities": "product-mode-custom-v1",
    }
    const query = `?directory=${encodeURIComponent(runtime.workspaceDir)}`
    const harness = new URL(runtime.providerBaseURL).origin
    const agent = "meta"
    const composition = {
      source: "temporary",
      agents: [
        {
          kind: "agent",
          relativePath: customRuntimeAgent.fileName,
          revision: createHash("sha256").update(customRuntimeAgent.source).digest("hex"),
        },
      ],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    }
    const plan =
      mode === "custom"
        ? await record(
            await request.post(`${runtime.backendUrl}/custom-composition/plan${query}`, { headers, data: composition }),
          )
        : undefined
    if (plan) expect(plan.valid).toBe(true)
    const created = await record(
      await request.post(
        `${runtime.backendUrl}${mode === "custom" ? "/custom-composition/start" : "/session"}${query}`,
        {
          headers,
          data:
            mode === "custom"
              ? { composition, expectedPlanDigest: plan?.digest, title: "Custom runtime acceptance" }
              : { mode, location: { directory: runtime.workspaceDir }, title: "V2 runtime acceptance" },
        },
      ),
    )
    const session = mode === "custom" ? created.session : created
    if (!isRecord(session) || typeof session.id !== "string") throw new Error("Session response has no id")
    const sessionID = session.id
    expect(session.mode).toBe(mode)
    const snapshot =
      mode === "custom"
        ? await record(await request.get(`${runtime.backendUrl}/session/${sessionID}/composition${query}`, { headers }))
        : undefined
    if (snapshot) expect(snapshot.digest).toBe(plan?.digest)

    const calls = async () =>
      (await records(await request.get(`${harness}/e4/provider-requests`), "requests")).filter(
        (row) => typeof row.path === "string" && row.path.endsWith("/chat/completions"),
      )
    const before = (await calls()).length
    const messages = async () =>
      records(
        await request.get(`${runtime.backendUrl}/api/session/${sessionID}/message?order=asc`, { headers }),
        "data",
      )
    await pinEnglishUI(page)
    seedRealBackend(page, runtime.backendUrl)
    await page.goto(`/server/${base64Encode(runtime.backendUrl)}/session/${sessionID}`)
    const input = page.locator('[data-component="session-prompt-dock"] [data-component="prompt-input"]')
    await expect(input).toBeVisible()
    await expect(page.locator('[data-action="prompt-agent"]')).toContainText(agent)
    const text = `Synthetic ${mode} execution acceptance`
    await input.fill(text)
    const [admitted] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/session/${sessionID}/prompt_async`,
      ),
      input.press("Enter"),
    ])
    expect(admitted.status()).toBe(204)
    const prompt: unknown = admitted.request().postDataJSON()
    if (!isRecord(prompt) || typeof prompt.messageID !== "string") throw new Error("Prompt has no stable message id")
    expect(prompt.agent).toBe(agent)
    await expect.poll(async () => (await messages()).at(-1)?.finish).toBe("stop")
    const completed = await messages()
    expect(completed.map((message) => message.type)).toEqual(["model-switched", "user", "assistant"])
    expect(completed[0]).toMatchObject({ model: { providerID: "e4-real", id: "e4-deterministic" } })
    expect(completed[1]).toMatchObject({ id: prompt.messageID, type: "user", text })
    expect(completed[2]).toMatchObject({
      type: "assistant",
      agent,
      content: [{ type: "text", text: "E4 deterministic response" }],
    })
    await expect
      .poll(
        async () =>
          (await record(await request.get(`${runtime.backendUrl}/session/status${query}`, { headers })))[sessionID],
      )
      .toBeUndefined()
    expect((await calls()).length - before).toBe(1)
    expect((await calls()).at(-1)).toMatchObject({ model: "e4-deterministic", authenticated: true })
    const rows = await records(await request.get(`${harness}/e4/admission?sessionID=${sessionID}`), "rows")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: prompt.messageID, kind: "prompt" })
    if (typeof rows[0].admitted_seq !== "number") throw new Error("Admission has no durable sequence")
    expect(rows[0].admitted_seq).toBeGreaterThan(0)
    expect(rows[0].promoted_seq).toBeGreaterThan(rows[0].admitted_seq)
    await expect(page.getByText("E4 deterministic response", { exact: true }).first()).toBeVisible()

    await page.reload()
    await expect(page.getByText("E4 deterministic response", { exact: true }).first()).toBeVisible()
    expect(await messages()).toEqual(completed)
    const retried = await request.post(`${runtime.backendUrl}/session/${sessionID}/prompt_async${query}`, {
      headers,
      data: prompt,
    })
    expect(retried.status()).toBe(204)
    expect(await messages()).toEqual(completed)
    expect((await calls()).length - before).toBe(1)

    // Only completed work is recovered here; this does not retry interrupted provider work.
    expect((await request.post(`${harness}/e4/restart-backend`)).status()).toBe(202)
    await expect
      .poll(
        async () => {
          const probe = await request.get(`${harness}/e4/backend-health`, { timeout: 5_000 }).catch(() => undefined)
          if (!probe) return false
          const health = await record(probe)
          return health.healthy === true && health.restarting === false
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    await page.reload()
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("E4 deterministic response", { exact: true }).first()).toBeVisible()
    expect(await messages()).toEqual(completed)
    expect((await calls()).length - before).toBe(1)
    if (snapshot)
      expect(
        await record(await request.get(`${runtime.backendUrl}/session/${sessionID}/composition${query}`, { headers })),
      ).toEqual(snapshot)
  })
}

async function record(response: APIResponse) {
  expect(response.ok(), `HTTP ${response.status()}`).toBeTruthy()
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new Error("Expected object response")
  return value
}

async function records(response: APIResponse, key: string) {
  const value = (await record(response))[key]
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`Expected object array: ${key}`)
  return value.filter(isRecord)
}
