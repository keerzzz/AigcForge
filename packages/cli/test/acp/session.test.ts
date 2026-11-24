import { describe, expect, test } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { Model } from "@omnixa/schema/model"
import { Session } from "@omnixa/schema/session"
import { Schema } from "effect"
import { currentValue } from "./select-options"
import {
  durableEvent,
  makeSession,
  rpcError,
  secondModel,
  startWire,
  type Wire,
  type WireOptions,
} from "./wire-fixture"

describe("acp session lifecycle over the wire", () => {
  test("initialize advertises capabilities, negotiates the version, and offers terminal auth only when asked", async () => {
    await using acp = await startWire()

    const plain = await acp.initialize()
    const terminal = await acp.initialize({ terminalAuth: true, childSessionUpdates: true })
    const standard = await acp.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { auth: { terminal: true } },
    })

    expect(plain).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: false },
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {} },
        _meta: { "omnixa/child-session-updates": true },
      },
      agentInfo: { name: "Omnixa" },
    })
    expect(plain.authMethods).toEqual([
      {
        id: "omnixa-login",
        name: "Login with omnixa",
        description: "Run `omnixa auth login` in the terminal",
      },
    ])
    expect(terminal.authMethods?.[0]?._meta).toEqual({
      "terminal-auth": { command: "omnixa", args: ["auth", "login"], label: "Omnixa Login" },
    })
    expect(standard.authMethods).toEqual([
      {
        id: "omnixa-login",
        name: "Login with omnixa",
        description: "Run `omnixa auth login` in the terminal",
        type: "terminal",
        args: ["--login"],
      },
    ])
    expect(await acp.request("authenticate", { methodId: "omnixa-login" })).toEqual({})
    expect(await rpcError(acp.request("authenticate", { methodId: "missing" }))).toMatchObject({
      code: -32602,
      data: { methodId: "missing" },
    })
    expect((await acp.request("initialize", { protocolVersion: 99 })).protocolVersion).toBe(1)
  })

  test("loads with paginated replay while resume and fork do not replay", async () => {
    await using acp = await startWire()
    const history = Array.from({ length: 201 }, (_, index) => ({
      id: `msg_${index}`,
      type: "user" as const,
      text: `message ${index}`,
      time: { created: index },
    }))
    acp.server.sessions.set(
      "ses_loaded",
      makeSession("ses_loaded", {
        agent: "plan",
        model: { providerID: "test", id: secondModel.id, variant: "medium" },
      }),
    )
    acp.server.messages.set("ses_loaded", history)
    acp.server.sessions.set(
      "ses_resume",
      makeSession("ses_resume", { agent: "plan", model: { providerID: "test", id: secondModel.id, variant: "low" } }),
    )
    acp.server.messages.set("ses_resume", [{ id: "msg_resume", type: "user", text: "hidden", time: { created: 1 } }])
    await acp.initialize()

    const loaded = await acp.request("session/load", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })
    const resumed = await acp.request("session/resume", { cwd: "/workspace", sessionId: "ses_resume", mcpServers: [] })
    const forked = await acp.request("session/fork", { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })

    expect(
      await rpcError(acp.request("session/load", { cwd: "/elsewhere", sessionId: "ses_loaded", mcpServers: [] })),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_loaded", cwd: "/elsewhere" } })
    const sessions = new Set(acp.server.sessions.keys())
    expect(
      await rpcError(acp.request("session/fork", { cwd: "/elsewhere", sessionId: "ses_loaded", mcpServers: [] })),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_loaded", cwd: "/elsewhere" } })
    expect(new Set(acp.server.sessions.keys())).toEqual(sessions)
    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_missing", mcpServers: [] })),
    ).toMatchObject({ code: -32602, data: { sessionId: "ses_missing" } })
    expect(currentValue(loaded, "model")).toBe("test/second-model")
    expect(currentValue(loaded, "effort")).toBe("medium")
    expect(currentValue(loaded, "mode")).toBe("plan")
    expect(currentValue(resumed, "effort")).toBe("low")
    expect(currentValue(forked, "effort")).toBe("medium")
    expect(acp.server.sessions.has(forked.sessionId)).toBe(true)
    const replayed = (sessionId: string) =>
      acp.updates.flatMap((item) =>
        item.sessionId === sessionId && item.update.sessionUpdate === "user_message_chunk"
          ? [item.update.messageId]
          : [],
      )
    expect(replayed("ses_loaded")).toEqual(history.map((message) => message.id))
    expect(replayed(forked.sessionId)).toEqual([])
    expect(replayed("ses_resume")).toEqual([])
    expect(
      acp.updates.find((item) => item.sessionId === "ses_loaded" && item.update.sessionUpdate === "user_message_chunk")
        ?.update,
    ).toEqual({
      sessionUpdate: "user_message_chunk",
      messageId: "msg_0",
      content: { type: "text", text: "message 0" },
    })
  })

  test("publishes a session's commands after the response that attaches it", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_loaded", makeSession("ses_loaded"))
    acp.server.messages.set("ses_loaded", [{ id: "msg_0", type: "user", text: "hello", time: { created: 0 } }])
    await acp.initialize()
    const params = { cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }

    expect(await untilCommands(acp, () => acp.newSession())).toEqual(["response", "available_commands_update"])
    expect(await untilCommands(acp, () => acp.request("session/load", params))).toEqual([
      "user_message_chunk",
      "response",
      "available_commands_update",
    ])
    expect(await untilCommands(acp, () => acp.request("session/resume", params))).toEqual([
      "response",
      "available_commands_update",
    ])
    expect(await untilCommands(acp, () => acp.request("session/fork", params))).toEqual([
      "response",
      "available_commands_update",
    ])
  })

  test("converts MCP configs and deduplicates registrations per session and config", async () => {
    const local: McpServer = {
      name: "tools",
      command: "bun",
      args: ["server.ts"],
      env: [{ name: "TOKEN", value: "x" }],
    }
    const changed: McpServer = { ...local, args: ["changed.ts"] }
    const remote: McpServer = {
      type: "http",
      name: "docs",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    }
    await using acp = await startWire()
    await acp.initialize()

    const first = await acp.newSession("/workspace", [local, local, remote])
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [local, remote] })
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [changed] })
    await acp.request("session/resume", { cwd: "/workspace", sessionId: first.sessionId, mcpServers: [local] })

    const localConfig = (args: string[]) => ({
      name: "tools",
      directory: "/workspace",
      config: { type: "local", command: ["bun", ...args], environment: { TOKEN: "x" } },
    })
    expect(acp.server.mcp.filter((item) => item.name === "tools")).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
    ])

    await acp.newSession("/workspace", [local])

    expect(acp.server.mcp).toHaveLength(5)
    expect(acp.server.mcp.filter((item) => item.name === "tools")).toEqual([
      localConfig(["server.ts"]),
      localConfig(["changed.ts"]),
      localConfig(["server.ts"]),
      localConfig(["server.ts"]),
    ])
    expect(acp.server.mcp.find((item) => item.name === "docs")).toEqual({
      name: "docs",
      directory: "/workspace",
      config: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" }, oauth: false },
    })
  })
  test.each([
    ["session/load", false],
    ["session/resume", false],
    ["session/load", true],
    ["session/resume", true],
  ] as const)("a delayed %s cannot restore an absent Session after close (Meta=%s)", async (method, meta) => {
    const held = Promise.withResolvers<Response>()
    const state = { hold: false }
    const options: WireOptions = {
      fetch: (request) => {
        if (state.hold && request.method === "GET" && request.path.startsWith("/api/session/ses_")) {
          state.hold = false
          return held.promise
        }
        return undefined
      },
    }
    await using acp = await (meta ? startMetaWire(options) : startWire(options))
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const session = acp.server.sessions.get(sessionId)
    if (!session) throw new Error("missing lifecycle Session")
    acp.server.messages.set(sessionId, [
      { id: "msg_lifecycle", type: "user", text: "saved history", time: { created: 1 } },
    ])
    await acp.until(
      () =>
        acp.updates.some(
          (item) => item.sessionId === sessionId && item.update.sessionUpdate === "available_commands_update",
        ),
      "initial attachment commands",
    )
    expect(await acp.request("session/close", { sessionId })).toEqual({})
    const start = acp.server.requests.length
    const params = {
      cwd: "/workspace",
      sessionId,
      additionalDirectories: ["/extra-lifecycle"],
      mcpServers: [{ name: "lifecycle", command: "bun", args: ["server.ts"], env: [] }],
    }
    state.hold = true
    const loading = rpcError(acp.request(method, params))
    try {
      await acp.until(
        () =>
          acp.server.requests
            .slice(start)
            .some((request) => request.method === "GET" && request.path === "/api/session/" + sessionId),
        "held absent Session GET",
      )
      expect(await acp.request("session/close", { sessionId })).toEqual({})
      expect(acp.server.interrupts.filter((id) => id === sessionId)).toHaveLength(2)
      const sideEffects = acp.server.requests.length
      const updates = acp.updates.length
      const mcp = acp.server.mcp.length
      held.resolve(Response.json({ data: session }))
      expect(await loading).toEqual({
        code: -32602,
        message: "Invalid params: Session selection changed while loading; retry the request",
        data: { field: "sessionId" },
      })
      expect(acp.server.requests.slice(sideEffects)).toEqual([])
      expect(acp.updates.slice(updates)).toEqual([])
      expect(acp.server.mcp).toHaveLength(mcp)
      expect(acp.server.sessions.get(sessionId)).toEqual(session)
      expect(
        await rpcError(
          acp.request("session/set_config_option", {
            sessionId,
            configId: meta ? "executor" : "mode",
            value: meta ? "executor-a" : "build",
          }),
        ),
      ).toMatchObject({ code: -32602, data: { sessionId } })
      const restored = await acp.request(method, params)
      expect(currentValue(restored, meta ? "executor" : "mode")).toBe(meta ? "executor-a" : "build")
      await acp.until(
        () =>
          acp.updates
            .slice(updates)
            .some((item) => item.sessionId === sessionId && item.update.sessionUpdate === "available_commands_update"),
        "fresh request commands",
      )
      expect(acp.server.mcp).toHaveLength(mcp + 1)
      expect(acp.server.sessions.get(sessionId)?.metadata?.["omnixa.acp.additionalDirectories"]).toEqual([
        "/extra-lifecycle",
      ])
      expect(
        acp.updates
          .slice(updates)
          .filter((item) => item.sessionId === sessionId && item.update.sessionUpdate === "user_message_chunk"),
      ).toHaveLength(method === "session/load" ? 1 : 0)
      expect(acp.logs).toEqual([])
    } finally {
      held.resolve(Response.json({ data: session }))
    }
  })

  test.each(["session/load", "session/resume"] as const)(
    "an invalidated %s request cannot release a newer attachment",
    async (method) => {
      const held = Promise.withResolvers<Response>()
      const state = { hold: false }
      await using acp = await startMetaWire({
        fetch: (request) => {
          if (state.hold && request.method === "GET" && request.path === "/api/session/ses_meta") {
            state.hold = false
            return held.promise
          }
          return undefined
        },
      })
      await acp.initialize()
      const sessionId = (await acp.newSession()).sessionId
      const session = acp.server.sessions.get(sessionId)
      if (!session) throw new Error("missing lifecycle Meta Session")
      await acp.request("session/close", { sessionId })
      const start = acp.server.requests.length
      state.hold = true
      const loading = rpcError(acp.request(method, { cwd: "/workspace", sessionId, mcpServers: [] }))
      try {
        await acp.until(
          () =>
            acp.server.requests
              .slice(start)
              .some((request) => request.method === "GET" && request.path === "/api/session/" + sessionId),
          "held old lifecycle request",
        )
        await acp.request("session/close", { sessionId })
        const fresh = await acp.request("session/resume", { cwd: "/workspace", sessionId, mcpServers: [] })
        expect(currentValue(fresh, "executor")).toBe("executor-a")
        const accepted = await acp.request("session/set_config_option", {
          sessionId,
          configId: "executor",
          value: "executor-b",
        })
        expect(currentValue(accepted, "executor")).toBe("executor-b")
        held.resolve(Response.json({ data: session }))
        expect(await loading).toMatchObject({ code: -32602, data: { field: "sessionId" } })
        const latest = await acp.request("session/set_config_option", {
          sessionId,
          configId: "effort",
          value: "default",
        })
        expect(currentValue(latest, "executor")).toBe("executor-b")
        expect(currentValue(latest, "effort")).toBe("default")
        expect(acp.server.sessions.get(sessionId)?.executorPreference?.agent).toBe("executor-b")
        expect(acp.logs).toEqual([])
      } finally {
        held.resolve(Response.json({ data: session }))
      }
    },
  )

  test("rejects relative cwds, MCP-over-ACP, and SSE servers before creating or loading a session", async () => {
    await using acp = await startWire()
    acp.server.sessions.set("ses_saved", makeSession("ses_saved"))
    await acp.initialize()
    const existing = new Set(acp.server.sessions.keys())
    const mcpServers: McpServer[] = [{ type: "acp", name: "client", serverId: "mcp_client" }]
    const sse: McpServer[] = [{ type: "sse", name: "events", url: "https://example.com/sse", headers: [] }]
    const invalid = {
      code: -32602,
      message: "Invalid params: Only stdio and HTTP MCP servers are supported",
      data: { field: "mcpServers" },
    }
    const relative = {
      code: -32602,
      message: "Invalid params: cwd must be an absolute path: workspace",
      data: { field: "cwd" },
    }

    expect(await rpcError(acp.newSession("/workspace", mcpServers))).toEqual(invalid)
    expect(await rpcError(acp.newSession("/workspace", sse))).toEqual(invalid)
    expect(
      await rpcError(acp.request("session/load", { cwd: "/workspace", sessionId: "ses_saved", mcpServers })),
    ).toEqual(invalid)
    expect(await rpcError(acp.newSession("workspace"))).toEqual(relative)
    expect(
      await rpcError(acp.request("session/load", { cwd: "workspace", sessionId: "ses_saved", mcpServers: [] })),
    ).toEqual(relative)
    expect(await rpcError(acp.request("session/list", { cwd: "workspace" }))).toEqual(relative)
    expect(await rpcError(acp.request("session/list", { cwd: "" }))).toMatchObject({
      code: -32602,
      data: { field: "cwd" },
    })
    expect(new Set(acp.server.sessions.keys())).toEqual(existing)
    expect(acp.server.requests.filter((request) => request.path.includes("ses_saved"))).toEqual([])
    expect(acp.logs).toEqual([])
  })
})

const isSessionUpdate = Schema.is(
  Schema.Struct({
    method: Schema.Literal("session/update"),
    params: Schema.Struct({ update: Schema.Struct({ sessionUpdate: Schema.String }) }),
  }),
)

// Labels what the agent sends from the request until the commands that follow it, in wire order.
async function untilCommands(acp: Wire, send: () => Promise<unknown>) {
  const start = acp.received.length
  await send()
  return acp.until(() => {
    const labels = acp.received.slice(start).map((message) => {
      if (isSessionUpdate(message)) return message.params.update.sessionUpdate
      return "method" in message ? message.method : "response"
    })
    return labels.includes("available_commands_update") && labels
  }, "available commands")
}

describe("acp canonical Meta selection over the wire", () => {
  test.each(["meta", "build", "plan"])(
    "first Meta selection waits for canonical GET identity and model facts (latest: %s)",
    async (latest) => {
      const seed = makeSession("ses_first_meta", { agent: "build", model: { providerID: "test", id: "test-model" } })
      const canonical = {
        ...seed,
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_first", rootSessionID: seed.id },
        model: { providerID: "test", id: "second-model", variant: "default" },
      } satisfies typeof Session.Info.Encoded
      const read = Promise.withResolvers<Response>()
      const state = { selecting: false, completed: false }
      await using acp = await startMetaWire(
        {
          fetch: (request) => {
            if (request.method === "POST" && request.path === "/api/session/" + seed.id + "/agent") {
              state.selecting =
                typeof request.body === "object" &&
                request.body !== null &&
                "agent" in request.body &&
                request.body.agent === "meta"
              return new Response(null, { status: 204 })
            }
            if (state.selecting && request.method === "GET" && request.path === "/api/session/" + seed.id)
              return read.promise
            return undefined
          },
        },
        seed,
      )
      const base = acp.server.catalog.agents[0]
      if (!base) throw new Error("missing base agent fixture")
      acp.server.catalog.agents.push(
        { ...base, id: "meta", name: "Meta", mode: "primary" },
        { ...base, id: "plan", name: "Plan", mode: "primary" },
      )
      await acp.initialize()
      const sessionId = (await acp.newSession()).sessionId
      const start = acp.server.requests.length
      const selecting = acp
        .request("session/set_config_option", { sessionId, configId: "mode", value: "meta" })
        .then((reply) => {
          state.completed = true
          return reply
        })
      try {
        await acp.until(
          () =>
            acp.server.requests
              .slice(start)
              .some((request) => request.method === "GET" && request.path === "/api/session/" + sessionId),
          "first Meta canonical GET",
        )
        expect(state.completed).toBe(false)
        expect(acp.server.requests.slice(start).find((request) => request.path.endsWith("/agent"))?.body).toEqual({
          agent: "meta",
        })
        if (latest !== "meta") {
          const superseding = await acp.request("session/set_config_option", {
            sessionId,
            configId: "mode",
            value: latest,
          })
          expect(currentValue(superseding, "mode")).toBe(latest)
          read.resolve(Response.json({ data: { ...canonical, agent: latest } }))
          const discarded = await selecting
          expect(currentValue(discarded, "mode")).toBe(latest)
          expect(discarded.configOptions?.some((option) => option.id === "executor")).toBe(false)
          expect(acp.server.requests.slice(start).some((request) => request.path.endsWith("/executor"))).toBe(false)
          return
        }
        read.resolve(Response.json({ data: canonical }))
        const selected = await selecting
        expect(currentValue(selected, "mode")).toBe("meta")
        expect(currentValue(selected, "model")).toBe("test/second-model")
        expect(currentValue(selected, "effort")).toBe("default")
        expect(selected.configOptions?.some((option) => option.id === "executor")).toBe(true)
      } finally {
        read.resolve(Response.json({ data: canonical }))
      }
    },
  )

  test("first Meta selection cannot acknowledge a GET without its controller and model", async () => {
    const seed = makeSession("ses_missing_meta", { agent: "build", model: { providerID: "test", id: "test-model" } })
    const state = { selecting: false }
    await using acp = await startMetaWire(
      {
        fetch: (request) => {
          if (request.method === "POST" && request.path === "/api/session/" + seed.id + "/agent") {
            state.selecting = true
            return new Response(null, { status: 204 })
          }
          if (state.selecting && request.method === "GET" && request.path === "/api/session/" + seed.id)
            return Response.json({ data: { ...seed, agent: "meta", model: undefined } })
          return undefined
        },
      },
      seed,
    )
    const base = acp.server.catalog.agents[0]
    if (!base) throw new Error("missing base agent fixture")
    acp.server.catalog.agents.push({ ...base, id: "meta", name: "Meta", mode: "primary" })
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    expect(
      await rpcError(acp.request("session/set_config_option", { sessionId, configId: "mode", value: "meta" })),
    ).toMatchObject({
      code: -32602,
      data: { field: "agent" },
    })
  })

  test("projects typed Meta create, load, resume, and fork replies into separate controls", async () => {
    await using acp = await startMetaWire()
    await acp.initialize()
    const created = await acp.newSession()
    const params = { cwd: "/workspace", sessionId: created.sessionId, mcpServers: [] }
    const loaded = await acp.request("session/load", params)
    const resumed = await acp.request("session/resume", params)
    const forked = await acp.request("session/fork", params)

    const replies = [created, loaded, resumed, forked]
    replies.forEach((result) => {
      expect(currentValue(result, "mode")).toBe("meta")
      expect(currentValue(result, "model")).toBe("test/test-model")
      expect(currentValue(result, "effort")).toBe("high")
      expect(currentValue(result, "executor")).toBe("executor-a")
      expect(currentValue(result, "executor-model")).toBe("worker/second-model")
      expect(currentValue(result, "executor-effort")).toBe("low")
    })
    expect(created.configOptions?.find((option) => option.id === "executor")).toMatchObject({
      options: [
        { value: "executor-a", name: "Executor A" },
        { value: "executor-b", name: "Executor B" },
        { value: "explore", name: "Explore" },
      ],
    })
    expect(acp.server.sessions.get(forked.sessionId)?.controller).toMatchObject({
      kind: "root",
      rootSessionID: forked.sessionId,
      metaAgentID: "mag_acp",
    })
    expect(
      acp.server.requests.filter((request) => request.method === "POST" && request.path.endsWith("/agent")),
    ).toEqual([])
  })

  test("accepts executor and Meta changes independently and sends complete canonical preferences", async () => {
    await using acp = await startMetaWire()
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId, configId, value })

    const executorModel = await set("executor-model", "test/second-model")
    const executorEffort = await set("executor-effort", "medium")
    expect(currentValue(executorModel, "executor-effort")).toBe("implicit")
    expect(currentValue(executorEffort, "effort")).toBe("high")
    const cpu = await set("model", "test/second-model/low")
    expect(currentValue(cpu, "model")).toBe("test/second-model")
    expect(currentValue(cpu, "effort")).toBe("low")
    expect(currentValue(cpu, "executor-effort")).toBe("medium")
    const start = acp.updates.length
    await acp.request("session/set_config_option", { sessionId, configId: "executor", value: "explore" })
    const mode = await acp.until(
      () => advertisements(acp, start).find((update) => currentValue(update, "executor") === "explore"),
      "accepted Explore preference",
    )
    expect(currentValue(mode, "model")).toBe("test/second-model")
    expect(currentValue(mode, "effort")).toBe("low")
    expect(currentValue(mode, "executor-model")).toBe("inherit")
    const selected = await set("executor-model", "worker/second-model/low")
    expect(currentValue(selected, "effort")).toBe("low")
    const inherited = await set("executor-model", "inherit")
    expect(currentValue(inherited, "executor-effort")).toBe("inherit")
    expect(
      acp.server.requests.filter((request) => request.path.endsWith("/executor")).map((request) => request.body),
    ).toEqual([
      { agent: "executor-a", model: { providerID: "test", id: "second-model" } },
      { agent: "executor-a", model: { providerID: "test", id: "second-model", variant: "medium" } },
      { agent: "explore" },
      { agent: "explore", model: { providerID: "worker", id: "second-model", variant: "low" } },
      { agent: "explore" },
    ])
    expect(
      acp.server.requests
        .filter((request) => request.method === "POST" && request.path.endsWith("/model"))
        .map((request) => request.body),
    ).toEqual([{ model: { providerID: "test", id: "second-model", variant: "low" } }])
    expect(
      acp.server.requests.filter((request) => request.method === "POST" && request.path.endsWith("/agent")),
    ).toEqual([])
    const count = acp.server.requests.filter((request) => request.path.endsWith("/executor")).length
    expect(await rpcError(set("executor", "missing"))).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(acp.server.requests.filter((request) => request.path.endsWith("/executor"))).toHaveLength(count)
    expect(acp.server.sessions.get(sessionId)?.executorPreference).toEqual({ agent: "explore" })
  })

  test("a typed rejection advertises the prior accepted preference even when it is unchanged", async () => {
    await using acp = await startMetaWire({
      fetch: (request) => (request.path.endsWith("/executor") ? rejected("executorPreference") : undefined),
    })
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const start = acp.updates.length
    expect(
      await rpcError(
        acp.request("session/set_config_option", {
          sessionId,
          configId: "executor",
          value: "explore",
        }),
      ),
    ).toMatchObject({ code: -32602, data: { field: "executorPreference" } })
    const accepted = await acp.until(
      () => advertisements(acp, start).find((update) => currentValue(update, "executor") === "executor-a"),
      "prior accepted preference after rejection",
    )
    expect(currentValue(accepted, "model")).toBe("test/test-model")
    expect(currentValue(accepted, "effort")).toBe("high")
    expect(currentValue(accepted, "executor-model")).toBe("worker/second-model")
    expect(currentValue(accepted, "executor-effort")).toBe("low")
    expect(acp.server.sessions.get(sessionId)?.executorPreference).toEqual(metaRoot().executorPreference)
  })

  test.each(["post", "readback", "reattach"])(
    "a delayed %s failure cannot overwrite newer acceptance",
    async (race) => {
      const held = Promise.withResolvers<Response>()
      const state = { readback: false }
      await using acp = await startMetaWire({
        fetch: (request) => {
          if (
            request.method === "POST" &&
            request.path.endsWith("/executor") &&
            Schema.is(Schema.Struct({ agent: Schema.Literal("explore") }))(request.body)
          ) {
            if (race !== "readback") return held.promise
            state.readback = true
            return rejected("executorPreference")
          }
          if (state.readback && request.method === "GET" && request.path === "/api/session/ses_meta") {
            state.readback = false
            return held.promise
          }
          return undefined
        },
      })
      await acp.initialize()
      const sessionId = (await acp.newSession()).sessionId
      const start = acp.server.requests.length
      const failed = rpcError(
        acp.request("session/set_config_option", { sessionId, configId: "executor", value: "explore" }),
      )
      await acp.until(
        () =>
          acp.server.requests
            .slice(start)
            .some((request) =>
              race === "readback"
                ? request.method === "GET" && request.path === "/api/session/ses_meta"
                : request.method === "POST" && request.path.endsWith("/executor"),
            ),
        "held selection request",
      )
      if (race === "reattach") {
        await acp.request("session/close", { sessionId })
        await acp.request("session/resume", { cwd: "/workspace", sessionId, mcpServers: [] })
      }
      const updates = acp.updates.length
      const accepted = await acp.request("session/set_config_option", {
        sessionId,
        configId: "executor",
        value: "executor-b",
      })
      expect(currentValue(accepted, "executor")).toBe("executor-b")
      await acp.until(
        () => advertisements(acp, updates).find((update) => currentValue(update, "executor") === "executor-b"),
        "newer accepted preference",
      )
      held.resolve(race === "readback" ? Response.json({ data: metaRoot() }) : rejected("executorPreference"))
      expect(await failed).toMatchObject({ code: -32602, data: { field: "executorPreference" } })
      const latest = await acp.request("session/set_config_option", { sessionId, configId: "effort", value: "default" })
      expect(currentValue(latest, "executor")).toBe("executor-b")
      await acp.until(
        () => advertisements(acp, updates).find((update) => currentValue(update, "effort") === "default"),
        "accepted Meta change after stale failure",
      )
      const advertised = advertisements(acp, updates)
      expect(advertised.length).toBeGreaterThan(0)
      expect(advertised.every((update) => currentValue(update, "executor") === "executor-b")).toBe(true)
      expect(acp.server.sessions.get(sessionId)?.executorPreference).toEqual({ agent: "executor-b" })
    },
  )

  test("an old load snapshot cannot replace a newer accepted selection on the same attachment", async () => {
    const held = Promise.withResolvers<Response>()
    const state = { load: false }
    await using acp = await startMetaWire({
      fetch: (request) => {
        if (state.load && request.method === "GET" && request.path === "/api/session/ses_meta") {
          state.load = false
          return held.promise
        }
        return undefined
      },
    })
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    state.load = true
    const start = acp.server.requests.length
    const loading = rpcError(acp.request("session/load", { cwd: "/workspace", sessionId, mcpServers: [] }))
    await acp.until(
      () =>
        acp.server.requests
          .slice(start)
          .some((request) => request.method === "GET" && request.path === "/api/session/ses_meta"),
      "held load snapshot",
    )
    const accepted = await acp.request("session/set_config_option", {
      sessionId,
      configId: "executor",
      value: "executor-b",
    })
    expect(currentValue(accepted, "executor")).toBe("executor-b")
    held.resolve(Response.json({ data: metaRoot() }))
    expect(await loading).toMatchObject({ code: -32602, data: { field: "sessionId" } })
    const latest = await acp.request("session/set_config_option", { sessionId, configId: "effort", value: "default" })
    expect(currentValue(latest, "executor")).toBe("executor-b")
    expect(currentValue(latest, "executor-model")).toBe("inherit")
  })

  test("selects implicit and literal default as different complete refs in both Meta domains", async () => {
    const seed = {
      ...metaRoot(),
      model: { providerID: "test", id: "test-model" },
      executorPreference: { agent: "executor-a", model: { providerID: "worker", id: "second-model" } },
    }
    await using acp = await startMetaWire({}, seed)
    await acp.initialize()
    const created = await acp.newSession()
    const sessionId = created.sessionId
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId, configId, value })
    expect(currentValue(created, "effort")).toBe("implicit")
    expect(currentValue(created, "executor-effort")).toBe("implicit")
    const sessionDefault = await set("effort", "default")
    expect(currentValue(sessionDefault, "effort")).toBe("default")
    expect(currentValue(sessionDefault, "executor-effort")).toBe("implicit")
    const executorDefault = await set("executor-effort", "default")
    expect(currentValue(executorDefault, "effort")).toBe("default")
    expect(currentValue(executorDefault, "executor-effort")).toBe("default")
    const sessionImplicit = await set("effort", "implicit")
    expect(currentValue(sessionImplicit, "effort")).toBe("implicit")
    expect(currentValue(sessionImplicit, "executor-effort")).toBe("default")
    const executorImplicit = await set("executor-effort", "implicit")
    expect(currentValue(executorImplicit, "effort")).toBe("implicit")
    expect(currentValue(executorImplicit, "executor-effort")).toBe("implicit")
    expect(
      acp.server.requests
        .filter((request) => request.method === "POST" && request.path.endsWith("/model"))
        .map((request) => request.body),
    ).toEqual([
      { model: { providerID: "test", id: "test-model", variant: "default" } },
      { model: { providerID: "test", id: "test-model" } },
    ])
    expect(
      acp.server.requests.filter((request) => request.path.endsWith("/executor")).map((request) => request.body),
    ).toEqual([
      { agent: "executor-a", model: { providerID: "worker", id: "second-model", variant: "default" } },
      { agent: "executor-a", model: { providerID: "worker", id: "second-model" } },
    ])
    const snapshot = acp.server.sessions.get(sessionId)
    if (!snapshot?.model || "type" in snapshot.model)
      throw new Error("The canonical ACK fixture requires physical models")
    if (!snapshot.executorPreference?.model || "type" in snapshot.executorPreference.model)
      throw new Error("The canonical ACK fixture requires physical models")
    expect(snapshot.model.variant).toBeUndefined()
    expect(snapshot.executorPreference.model.variant).toBeUndefined()
  })

  test("preserves implicit canonical ACK refs after literal-default requests in both domains", async () => {
    const seed = {
      ...metaRoot(),
      model: { providerID: "test", id: "test-model" },
      executorPreference: { agent: "executor-a", model: { providerID: "worker", id: "second-model" } },
    }
    await using acp = await startMetaWire(
      {
        fetch: (request) => {
          if (request.method !== "POST") return undefined
          if (request.method === "POST" && request.path.endsWith("/model")) return new Response(null, { status: 204 })
          if (request.path.endsWith("/executor")) return Response.json({ data: seed })
          return undefined
        },
      },
      seed,
    )
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const cpu = await acp.request("session/set_config_option", { sessionId, configId: "effort", value: "default" })
    const executor = await acp.request("session/set_config_option", {
      sessionId,
      configId: "executor-effort",
      value: "default",
    })
    expect(currentValue(cpu, "effort")).toBe("implicit")
    expect(currentValue(executor, "executor-effort")).toBe("implicit")
    expect(
      acp.server.requests.filter((request) => request.method === "POST" && request.path.endsWith("/model")).at(-1)
        ?.body,
    ).toEqual({
      model: { providerID: "test", id: "test-model", variant: "default" },
    })
    expect(acp.server.requests.filter((request) => request.path.endsWith("/executor")).at(-1)?.body).toEqual({
      agent: "executor-a",
      model: { providerID: "worker", id: "second-model", variant: "default" },
    })
    const snapshot = acp.server.sessions.get(sessionId)
    if (!snapshot?.model || "type" in snapshot.model)
      throw new Error("The canonical ACK fixture requires physical models")
    if (!snapshot.executorPreference?.model || "type" in snapshot.executorPreference.model)
      throw new Error("The canonical ACK fixture requires physical models")
    expect(snapshot.model.variant).toBeUndefined()
    expect(snapshot.executorPreference.model.variant).toBeUndefined()
  })

  test("typed Meta children advertise only their binding and retain raw undefined after identical switches", async () => {
    const state: { field?: string } = {}
    await using acp = await startMetaWire(
      {
        fetch: (request) =>
          state.field &&
          request.method === "POST" &&
          ((request.method === "POST" && request.path.endsWith("/model")) ||
            (request.method === "POST" && request.path.endsWith("/agent")))
            ? rejected(state.field, "cpu_binding_conflict")
            : undefined,
      },
      metaChild(),
    )
    await acp.initialize()
    const sessionId = "ses_child"
    const resumed = await acp.request("session/resume", { cwd: "/workspace", sessionId, mcpServers: [] })
    expect(resumed.configOptions).toMatchObject([
      {
        id: "model",
        currentValue: "test/test-model",
        options: [{ value: "test/test-model", name: "test/test-model" }],
      },
      { id: "effort", currentValue: "implicit", options: [{ value: "implicit", name: "Implicit default" }] },
      { id: "mode", currentValue: "executor-a", options: [{ value: "executor-a", name: "Executor A" }] },
    ])
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId, configId, value })
    state.field = "agent"
    expect(await rpcError(set("mode", "executor-b"))).toMatchObject({ code: -32602, data: { field: "agent" } })
    state.field = "model"
    expect(await rpcError(set("model", "test/second-model"))).toMatchObject({ code: -32602, data: { field: "model" } })
    expect(await rpcError(set("effort", "high"))).toMatchObject({ code: -32602, data: { field: "model" } })
    expect(await rpcError(set("executor-model", "test/test-model"))).toMatchObject({
      code: -32602,
      data: { configId: "executor-model" },
    })
    state.field = undefined
    const identical = await set("effort", "default")
    expect(currentValue(identical, "effort")).toBe("implicit")
    expect(
      acp.server.requests.filter((request) => request.method === "POST" && request.path.endsWith("/model")).at(-1)
        ?.body,
    ).toEqual({
      model: { providerID: "test", id: "test-model", variant: "default" },
    })
    const snapshot = acp.server.sessions.get(sessionId)
    if (!snapshot?.model || "type" in snapshot.model)
      throw new Error("The canonical child ACK fixture requires a physical model")
    expect(snapshot.model.variant).toBeUndefined()
    expect(acp.server.sessions.get(sessionId)?.controller).toEqual(metaChild().controller)
    expect(acp.server.requests.filter((request) => request.path.endsWith("/executor"))).toEqual([])
  })

  test("refreshes the accepted preference from the typed executor-selected event", async () => {
    await using acp = await startMetaWire()
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const session = acp.server.sessions.get(sessionId)
    if (!session) throw new Error("missing Meta fixture")
    const preference = { agent: "explore", model: { providerID: "worker", id: "second-model", variant: "medium" } }
    const start = acp.updates.length
    acp.server.sessions.set(sessionId, { ...session, executorPreference: preference })
    acp.server.send(durableEvent("session.executor.selected", { sessionID: sessionId, executorPreference: preference }))
    const accepted = await acp.until(
      () => advertisements(acp, start).find((update) => currentValue(update, "executor") === "explore"),
      "executor-selected event readback",
    )
    expect(currentValue(accepted, "executor-effort")).toBe("medium")
    expect(currentValue(accepted, "effort")).toBe("high")
    expect(acp.server.requests.filter((request) => request.path.endsWith("/executor"))).toEqual([])
  })

  test("keeps same-ID attachments on separate ACP servers independent", async () => {
    const held = Promise.withResolvers<Response>()
    await using first = await startMetaWire({
      fetch: (request) => (request.path.endsWith("/executor") ? held.promise : undefined),
    })
    await using second = await startMetaWire()
    await first.initialize()
    await second.initialize()
    const sessionId = (await first.newSession()).sessionId
    expect((await second.newSession()).sessionId).toBe(sessionId)
    const start = first.server.requests.length
    const failed = rpcError(
      first.request("session/set_config_option", { sessionId, configId: "executor", value: "explore" }),
    )
    await first.until(
      () => first.server.requests.slice(start).some((request) => request.path.endsWith("/executor")),
      "first server held request",
    )
    const accepted = await second.request("session/set_config_option", {
      sessionId,
      configId: "executor",
      value: "executor-b",
    })
    expect(currentValue(accepted, "executor")).toBe("executor-b")
    const updates = first.updates.length
    held.resolve(rejected("executorPreference"))
    expect(await failed).toMatchObject({ code: -32602, data: { field: "executorPreference" } })
    await first.until(
      () => advertisements(first, updates).find((update) => currentValue(update, "executor") === "executor-a"),
      "first server accepted preference",
    )
    const latest = await second.request("session/set_config_option", {
      sessionId,
      configId: "effort",
      value: "default",
    })
    expect(currentValue(latest, "executor")).toBe("executor-b")
    expect(first.server.sessions.get(sessionId)?.executorPreference?.agent).toBe("executor-a")
    expect(second.server.sessions.get(sessionId)?.executorPreference?.agent).toBe("executor-b")
  })
})

function metaRoot(id = "ses_meta"): typeof Session.Info.Encoded {
  return {
    ...makeSession(id, { agent: "meta", model: { providerID: "test", id: "test-model", variant: "high" } }),
    controller: { kind: "root", metaAgentID: "mag_acp", rootSessionID: id },
    executorPreference: { agent: "executor-a", model: { providerID: "worker", id: "second-model", variant: "low" } },
  }
}

function metaChild(): typeof Session.Info.Encoded {
  return {
    ...makeSession("ses_child", { agent: "executor-a", model: { providerID: "test", id: "test-model" } }),
    parentID: "ses_meta",
    controller: {
      kind: "child",
      metaAgentID: "mag_acp",
      rootSessionID: "ses_meta",
      executor: { agent: "executor-a", model: { providerID: "test", id: "test-model" }, source: "preference" },
      source: { kind: "task", delegationID: "dlg_acp", participantID: "par_acp" },
    },
  }
}

async function startMetaWire(options: WireOptions = {}, seed = metaRoot()) {
  const acp: Wire = await startWire({
    ...options,
    fetch: async (request) => {
      const override = await options.fetch?.(request)
      if (override) return override
      if (request.method === "POST" && request.path === "/api/session") {
        acp.server.sessions.set(seed.id, seed)
        return Response.json({ data: seed })
      }
      if (request.method === "POST" && request.path === "/api/session/" + seed.id + "/fork") {
        const source = acp.server.sessions.get(seed.id)
        if (source?.controller?.kind !== "root") return undefined
        const id = seed.id + "_fork"
        const forked = { ...source, id, controller: { ...source.controller, rootSessionID: id } }
        acp.server.sessions.set(id, forked)
        return Response.json({ data: forked })
      }
      const match = request.path.match(/^\/api\/session\/([^/]+)\/(executor|model)$/)
      if (!match || request.method !== "POST") return undefined
      const session = acp.server.sessions.get(match[1] ?? "")
      if (!session) return undefined
      if (match[2] === "executor") {
        const preference = Schema.decodeUnknownSync(Schema.toCodecJson(Session.ExecutorPreference))(request.body)
        const saved = { ...session, executorPreference: preference }
        acp.server.sessions.set(session.id, saved)
        return Response.json({ data: saved })
      }
      if (session.controller?.kind === "root") {
        const payload = Schema.decodeUnknownSync(Schema.toCodecJson(Schema.Struct({ model: Model.Ref })))(request.body)
        acp.server.sessions.set(session.id, { ...session, model: payload.model })
      }
      return new Response(null, { status: 204 })
    },
  })
  acp.server.sessions.set(seed.id, seed)
  const base = acp.server.catalog.agents[0]
  if (!base) throw new Error("missing base agent fixture")
  acp.server.catalog.agents.push(
    { ...base, id: "executor-a", name: "Executor A", mode: "all" },
    { ...base, id: "executor-b", name: "Executor B", mode: "all" },
    { ...base, id: "explore", name: "Explore", mode: "subagent" },
  )
  acp.server.catalog.models.push({ ...secondModel, providerID: "worker" })
  return acp
}

function rejected(field: string, kind = "invalid_executor") {
  return Response.json({ _tag: "InvalidRequestError", message: "selection rejected", field, kind }, { status: 400 })
}

function advertisements(acp: Wire, start: number) {
  return acp.updates
    .slice(start)
    .flatMap((item) => (item.update.sessionUpdate === "config_option_update" ? [item.update] : []))
}
