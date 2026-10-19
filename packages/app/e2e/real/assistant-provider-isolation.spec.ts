import { expect, test, type APIRequestContext } from "@playwright/test"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2/client"
import { createServer } from "node:http"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { e4 } from "./fixture"
import { isRecord } from "./manifest"

const providerID = "e4-isolation"
const sides = ["left", "right"] as const

test("AI-TDD-S08: Assistant backends isolate credentials, models, System Context and history", async ({
  request,
}, testInfo) => {
  const manifest = e4()
  const peer = manifest.peer
  test.skip(!peer, "Requires two isolated product backends")
  test.skip(manifest.v2Runtime, "Exercises the default Assistant runtime")
  if (!peer) throw new Error("The dual-backend manifest is missing its peer")
  expect(peer.dbPath).not.toBe(manifest.dbPath)
  expect(peer.workspaceDir).not.toBe(manifest.workspaceDir)
  const gate = Promise.withResolvers<void>()
  const providers = []
  try {
    for (const side of sides) providers.push(await startProvider(side, side === "left" ? gate.promise : undefined))
    const scopes = []
    for (const [index, backend] of [manifest, peer].entries()) {
      const provider = providers[index]
      if (!provider) throw new Error("The loopback provider was not created")
      const client = createAigcfrogeClient({
        baseUrl: backend.backendUrl,
        directory: backend.workspaceDir,
        throwOnError: true,
      })
      // Native InstructionContext observes the configured global AGENTS.md owner.
      const instructions = path.join(backend.configDir, "AGENTS.md")
      writeFileSync(instructions, provider.system, { mode: 0o600 })
      // This harness pins AIGCFROGE_CONFIG_DIR, the native configuration owner.
      // Seed it before opening the Location; public global settings write to XDG.
      const configPath = path.join(backend.configDir, "aigcfroge.json")
      const config: unknown = JSON.parse(readFileSync(configPath, "utf8"))
      if (!isRecord(config) || !isRecord(config.provider)) throw new Error("Invalid isolated provider config")
      writeFileSync(
        configPath,
        JSON.stringify({
          ...config,
          provider: {
            ...config.provider,
            [providerID]: {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: provider.url },
              models: {
                [provider.model]: { name: provider.model, tool_call: true, limit: { context: 200_000, output: 8_192 } },
              },
            },
          },
        }),
        { mode: 0o600 },
      )
      const authenticated = await client.auth.set({ providerID, auth: { type: "api", key: provider.credential } })
      expect(authenticated.response.status).toBe(200)
      const created = await client.session.create({
        title: `E4 Assistant ${provider.side}`,
        mode: "assistant",
        model: { providerID, id: provider.model },
      })
      expect(created.response.status).toBe(200)
      if (!created.data) throw new Error("Assistant creation returned no body")
      scopes.push({ client, backend, provider, sessionID: created.data.id })
    }
    const left = scopes[0]
    const right = scopes[1]
    if (!left || !right) throw new Error("Both Assistant scopes are required")
    const submit = async (scope: typeof left, turn: number) => {
      const response = await scope.client.session.promptAsync({
        sessionID: scope.sessionID,
        messageID: `msg_isolation_${scope.provider.side}_${turn}`,
        parts: [{ type: "text", text: `${scope.provider.prompt} turn ${turn}` }],
      })
      expect(response.response.status).toBe(204)
    }
    await submit(left, 1)
    await expect.poll(() => left.provider.hits.length).toBe(1)
    await submit(right, 1)
    await expect
      .poll(async () => (await history(request, right.backend.backendUrl, right.sessionID)).at(-1)?.finish)
      .toBe("stop")
    expect(left.provider.hits).toHaveLength(1)
    expect((await history(request, left.backend.backendUrl, left.sessionID)).at(-1)?.finish).not.toBe("stop")
    gate.resolve()
    await expect
      .poll(async () => (await history(request, left.backend.backendUrl, left.sessionID)).at(-1)?.finish)
      .toBe("stop")

    for (const scope of scopes) {
      const before = await history(request, scope.backend.backendUrl, scope.sessionID)
      expect(before.filter((message) => message.type === "user")).toHaveLength(1)
      expect(JSON.stringify(before)).toContain(scope.provider.prompt)
      expect(JSON.stringify(before)).not.toContain(scope.provider.foreignPrompt)
      await submit(scope, 2)
      await expect
        .poll(async () => {
          const current = await history(request, scope.backend.backendUrl, scope.sessionID)
          return { users: current.filter((message) => message.type === "user").length, finish: current.at(-1)?.finish }
        })
        .toEqual({ users: 2, finish: "stop" })
      const completed = await history(request, scope.backend.backendUrl, scope.sessionID)
      expect(completed.slice(0, before.length)).toEqual(before)
      expect(JSON.stringify(completed)).not.toContain(scope.provider.foreignPrompt)
      expect(scope.provider.hits).toHaveLength(2)
      expect(scope.provider.hits).toEqual([
        {
          path: "/v1/chat/completions",
          model: scope.provider.model,
          authenticated: true,
          ownSystem: true,
          foreignSystem: false,
          ownPrompt: true,
          foreignPrompt: false,
          ownReply: false,
          foreignReply: false,
        },
        {
          path: "/v1/chat/completions",
          model: scope.provider.model,
          authenticated: true,
          ownSystem: true,
          foreignSystem: false,
          ownPrompt: true,
          foreignPrompt: false,
          ownReply: true,
          foreignReply: false,
        },
      ])
      expect(await history(request, scope.backend.backendUrl, scope.sessionID)).toEqual(completed)
    }
    await testInfo.attach("e4-assistant-provider-isolation", {
      body: JSON.stringify(
        scopes.map((scope) => ({
          backend: scope.backend.backendUrl,
          directory: scope.backend.workspaceDir,
          sessionID: scope.sessionID,
          endpoint: scope.provider.url,
          requests: scope.provider.hits,
        })),
        null,
        2,
      ),
      contentType: "application/json",
    })
  } finally {
    gate.resolve()
    for (const provider of providers) await provider.close()
  }
})

async function history(request: APIRequestContext, backend: string, sessionID: string) {
  const response = await request.get(`${backend}/api/session/${sessionID}/message?order=asc`)
  expect(response.status()).toBe(200)
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.data) || !body.data.every(isRecord)) {
    throw new Error("Canonical history returned an invalid page")
  }
  return body.data
}

async function startProvider(side: (typeof sides)[number], held?: Promise<void>) {
  const foreign = side === "left" ? "right" : "left"
  const model = `e4-isolation-${side}`
  const credential = `synthetic-e4-isolation-${side}`
  const system = `E4_SYSTEM_CONTEXT_${side.toUpperCase()}_ONLY`
  const prompt = `E4_HISTORY_${side.toUpperCase()}_ONLY`
  const foreignPrompt = `E4_HISTORY_${foreign.toUpperCase()}_ONLY`
  const answer = `E4_REPLY_${side.toUpperCase()}_ONLY`
  const hits: {
    path: string
    model: unknown
    authenticated: boolean
    ownSystem: boolean
    foreignSystem: boolean
    ownPrompt: boolean
    foreignPrompt: boolean
    ownReply: boolean
    foreignReply: boolean
  }[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Invalid provider body")
      const systemMessages = JSON.stringify(
        body.messages.filter(
          (message: unknown) => isRecord(message) && ["system", "developer"].includes(String(message.role)),
        ),
      )
      const ordinaryMessages = JSON.stringify(
        body.messages.filter(
          (message: unknown) => isRecord(message) && !["system", "developer"].includes(String(message.role)),
        ),
      )
      const authenticated = request.headers.authorization === `Bearer ${credential}`
      hits.push({
        path: request.url ?? "",
        model: body.model,
        authenticated,
        ownSystem: systemMessages.includes(system),
        foreignSystem: systemMessages.includes(`E4_SYSTEM_CONTEXT_${foreign.toUpperCase()}_ONLY`),
        ownPrompt: ordinaryMessages.includes(prompt),
        foreignPrompt: ordinaryMessages.includes(foreignPrompt),
        ownReply: ordinaryMessages.includes(answer),
        foreignReply: ordinaryMessages.includes(`E4_REPLY_${foreign.toUpperCase()}_ONLY`),
      })
      if (!authenticated || body.model !== model || request.url !== "/v1/chat/completions") {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { message: "Synthetic provider selection mismatch" } }))
        return
      }
      if (hits.length === 1 && held) await held
      response.writeHead(200, { "content-type": "text/event-stream" })
      for (const choice of [{ delta: { role: "assistant", content: answer } }, { delta: {}, finish_reason: "stop" }]) {
        response.write(
          `data: ${JSON.stringify({ id: "chatcmpl-isolation", object: "chat.completion.chunk", choices: [choice] })}\n\n`,
        )
      }
      response.end("data: [DONE]\n\n")
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end("Synthetic provider could not read the request")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a loopback TCP address")
  return {
    side,
    model,
    credential,
    system,
    prompt,
    foreignPrompt,
    hits,
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}
