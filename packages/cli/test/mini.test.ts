import { describe, expect, test } from "bun:test"
import {
  ClientError,
  Omnixa,
  type AgentInfo,
  type ModelInfo,
  type SessionCreateInput,
  type SessionInfo,
} from "@omnixa/client/promise"
import { OMNIXA_VERSION } from "../src/version"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"
import { createMiniConnection, Mini, resolveMiniTarget } from "../src/mini"
import { parseRunModel, Run } from "../src/run/run"
import { parseSessionTargetModel } from "../src/session-target"

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

function bridgeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function miniBridgeTerminal(cols: number, rows: number) {
  const empty = () => ({ character: " ", inverse: false })
  const blank = () => Array.from({ length: cols }, empty)
  const screen = Array.from({ length: rows }, blank)
  const frames: string[] = []
  const titles: string[] = []
  const unsupported: string[] = []
  const decoder = new TextDecoder()
  let pending = ""
  let row = 0
  let column = 0
  let inverse = false
  let top = 0
  let bottom = rows - 1
  let saved = { row: 0, column: 0, inverse: false }

  const lineText = (line: (typeof screen)[number]) => line.map((cell) => cell.character).join("")
  const text = () => screen.map(lineText).join("\n")
  const selected = () => screen.filter((line) => line.some((cell) => cell.inverse)).map((line) => lineText(line).trim())
  const scroll = (count: number, direction: "up" | "down") => {
    Array.from({ length: count }).forEach(() => {
      screen.splice(direction === "up" ? top : bottom, 1)
      screen.splice(direction === "up" ? bottom : top, 0, blank())
    })
  }
  const down = () => {
    if (row === bottom) return scroll(1, "up")
    row = Math.min(rows - 1, row + 1)
  }
  const clearLine = (mode: number) => {
    const start = mode === 1 || mode === 2 ? 0 : column
    const end = mode === 0 || mode === 2 ? cols : column + 1
    screen[row]?.fill(empty(), start, end)
  }
  const csi = (parameters: string, command: string) => {
    const values = parameters
      .replace(/^[?>]/, "")
      .split(";")
      .map((value) => Number(value) || 0)
    const count = values[0] || 1
    if (command === "m") {
      let colorArguments = 0
      values.forEach((value, index) => {
        if (colorArguments > 0) {
          colorArguments--
          return
        }
        if (value === 38 || value === 48 || value === 58) {
          colorArguments = values[index + 1] === 2 ? 4 : 2
          return
        }
        if (value === 0 || value === 27) {
          inverse = false
          return
        }
        if (value === 7) inverse = true
      })
      return
    }
    if (command === "A") {
      row = Math.max(0, row - count)
      return
    }
    if (command === "B") {
      row = Math.min(rows - 1, row + count)
      return
    }
    if (command === "C") {
      column = Math.min(cols - 1, column + count)
      return
    }
    if (command === "D") {
      column = Math.max(0, column - count)
      return
    }
    if (command === "E") {
      row = Math.min(rows - 1, row + count)
      column = 0
      return
    }
    if (command === "F") {
      row = Math.max(0, row - count)
      column = 0
      return
    }
    if (command === "G" || command === String.fromCharCode(96)) {
      column = Math.min(cols - 1, count - 1)
      return
    }
    if (command === "d") {
      row = Math.min(rows - 1, count - 1)
      return
    }
    if (command === "H" || command === "f") {
      row = Math.min(rows - 1, count - 1)
      column = Math.min(cols - 1, (values[1] || 1) - 1)
      return
    }
    if (command === "K") return clearLine(values[0] ?? 0)
    if (command === "J") {
      if (values[0] === 2 || values[0] === 3) {
        screen.forEach((line) => line.fill(empty()))
        return
      }
      clearLine(values[0] ?? 0)
      screen.forEach((line, index) => {
        if ((values[0] === 1 && index < row) || (values[0] !== 1 && index > row)) line.fill(empty())
      })
      return
    }
    if (command === "r") {
      top = Math.min(rows - 1, count - 1)
      bottom = Math.max(top, Math.min(rows - 1, (values[1] || rows) - 1))
      row = 0
      column = 0
      return
    }
    if (command === "S") return scroll(count, "up")
    if (command === "T") return scroll(count, "down")
    if (command === "X") {
      screen[row]?.fill(empty(), column, Math.min(cols, column + count))
      return
    }
    if (command === "P") {
      screen[row]?.splice(column, count)
      screen[row]?.push(...Array.from({ length: count }, empty))
      if (screen[row]) screen[row]!.length = cols
      return
    }
    if (command === "@") {
      screen[row]?.splice(column, 0, ...Array.from({ length: count }, empty))
      if (screen[row]) screen[row]!.length = cols
      return
    }
    if (command === "s") {
      saved = { row, column, inverse }
      return
    }
    if (command === "u") {
      row = saved.row
      column = saved.column
      inverse = saved.inverse
      return
    }
    if (["h", "l", "n", "c", "q", "t", "p"].includes(command)) return
    unsupported.push("CSI " + parameters + command)
  }
  const feed = (data: Uint8Array) => {
    pending += decoder.decode(data, { stream: true })
    while (pending.length > 0) {
      if (pending.startsWith("\x1b[")) {
        const match = /^\x1b\[([0-?]*[ -/]*)([@-~])/.exec(pending)
        if (!match) break
        csi(match[1]!, match[2]!)
        pending = pending.slice(match[0].length)
        continue
      }
      if (pending.startsWith("\x1b]") || pending.startsWith("\x1bP") || pending.startsWith("\x1b_")) {
        const end = (pending.startsWith("\x1b_") ? /\x1b\\/ : /\x07|\x1b\\/).exec(pending.slice(2))
        if (!end) break
        const value = pending.slice(2, end.index + 2)
        if (pending.startsWith("\x1b]") && /^(?:0|2);/.test(value)) titles.push(value.slice(2))
        if (pending.startsWith("\x1b_") && value !== "Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA")
          unsupported.push("APC " + value)
        pending = pending.slice(end.index + 2 + end[0].length)
        continue
      }
      if (pending.startsWith("\x1b")) {
        if (pending.length < 2) break
        const command = pending[1]
        if (command === "(" || command === ")") {
          if (pending.length < 3) break
          pending = pending.slice(3)
          continue
        }
        pending = pending.slice(2)
        if (command === "7") {
          saved = { row, column, inverse }
          continue
        }
        if (command === "8") {
          row = saved.row
          column = saved.column
          inverse = saved.inverse
          continue
        }
        if (command === "D") {
          down()
          continue
        }
        if (command === "E") {
          column = 0
          down()
          continue
        }
        if (command === "M") {
          if (row === top) scroll(1, "down")
          if (row !== top) row--
          continue
        }
        if (command === "=" || command === ">") continue
        unsupported.push("ESC " + command)
        continue
      }
      const code = pending.codePointAt(0)!
      const character = String.fromCodePoint(code)
      pending = pending.slice(character.length)
      if (character === "\r") {
        column = 0
        continue
      }
      if (character === "\n") {
        down()
        continue
      }
      if (character === "\b") {
        column = Math.max(0, column - 1)
        continue
      }
      if (character === "\t") {
        column = Math.min(cols - 1, (Math.floor(column / 8) + 1) * 8)
        continue
      }
      if (code < 32 || code === 127) continue
      if (column >= cols) {
        column = 0
        down()
      }
      if (screen[row]) screen[row]![column] = { character, inverse }
      column++
    }
    frames.push(text())
  }
  return { feed, frames, titles, unsupported, text, selected }
}

test("Mini terminal observer supports only the emitted OpenTUI APC query", () => {
  const terminal = miniBridgeTerminal(40, 2)
  const encoder = new TextEncoder()
  terminal.feed(encoder.encode("before\x1b"))
  expect(terminal.text().trim()).toBe("before")
  terminal.feed(encoder.encode("_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b"))
  expect(terminal.text().trim()).toBe("before")
  expect(terminal.unsupported).toEqual([])
  terminal.feed(encoder.encode("\\after"))
  expect(terminal.text().trim()).toBe("beforeafter")
  expect(terminal.unsupported).toEqual([])

  // A similarly shaped but unrecognized APC remains one unsupported control string.
  terminal.feed(encoder.encode("\x1b_Gi=31338,s=1,v=1,a=q,t=d,f=24;AAAA\x1b"))
  expect(terminal.text().trim()).toBe("beforeafter")
  expect(terminal.unsupported).toEqual([])
  terminal.feed(encoder.encode("\\"))
  expect(terminal.unsupported).toEqual(["APC Gi=31338,s=1,v=1,a=q,t=d,f=24;AAAA"])
  expect(terminal.text().trim()).toBe("beforeafter")
})

describe("mini command", () => {
  test("real CLI Mini bridge keeps both domains across new and transport client replacement", async () => {
    await using home = await tmpdir()
    const directory = path.join(import.meta.dir, "..")
    const location = { directory, project: { id: "pro_bridge", directory, canonical: directory } }
    const modelA = { providerID: "test", id: "model-a", variant: "high" }
    const modelB = { providerID: "test", id: "model-b", variant: "default" }
    const executorA = { providerID: "test", id: "executor-a", variant: "default" }
    const executorB = { providerID: "test", id: "executor-b", variant: "high" }
    const initial: SessionInfo = {
      id: "ses_bridge_original",
      projectID: "pro_bridge",
      title: "INITIAL_CLI_BRIDGE",
      agent: "meta",
      controller: { kind: "root", metaAgentID: "meta_bridge", rootSessionID: "ses_bridge_original" },
      model: modelA,
      executorPreference: { agent: "build", model: executorA },
      location,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    }
    const ordinary: SessionInfo = {
      ...initial,
      agent: "plan",
      controller: undefined,
      executorPreference: undefined,
    }
    const agentAck: SessionInfo = { ...initial, executorPreference: { agent: "verify", model: executorA } }
    const primaryModelAck: SessionInfo = { ...agentAck, model: { providerID: "test", id: "model-b" } }
    const primaryVariantAck: SessionInfo = { ...primaryModelAck, model: modelB }
    const executorModelAck: SessionInfo = {
      ...primaryVariantAck,
      executorPreference: { agent: "verify", model: { providerID: "test", id: "executor-b" } },
    }
    const selected: SessionInfo = { ...executorModelAck, executorPreference: { agent: "verify", model: executorB } }
    const implicitExecutorAck: SessionInfo = {
      ...selected,
      executorPreference: { agent: "verify", model: { providerID: "test", id: "executor-b" } },
    }
    const finalSelection: SessionInfo = {
      ...implicitExecutorAck,
      executorPreference: { agent: "verify", model: { providerID: "test", id: "executor-b", variant: "default" } },
    }
    const stale: SessionInfo = {
      ...initial,
      id: "ses_bridge_stale",
      title: "STALE_CLI_BRIDGE",
      controller: { kind: "root", metaAgentID: "meta_stale", rootSessionID: "ses_bridge_stale" },
    }
    const created: SessionInfo = {
      ...finalSelection,
      id: "ses_bridge_replacement",
      title: "NEW_CLI_BRIDGE",
      controller: { kind: "root", metaAgentID: "meta_next", rootSessionID: "ses_bridge_replacement" },
    }
    const buildAck: SessionInfo = { ...created, agent: "build" }
    const planAck: SessionInfo = { ...buildAck, agent: "plan" }
    const ordinaryCreated: SessionInfo = {
      ...created,
      id: "ses_bridge_ordinary",
      title: "NEW_ORDINARY_CLI_BRIDGE",
      agent: "plan",
      controller: undefined,
      executorPreference: undefined,
    }
    const model = (id: string, name: string): ModelInfo => ({
      id,
      modelID: id,
      providerID: "test",
      name,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      variants: [{ id: "default" }, { id: "high" }],
      time: { released: 1 },
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      status: "active",
      enabled: true,
      limit: { context: 128_000, output: 8_192 },
    })
    const models = [
      model("model-a", "Model A"),
      model("model-b", "Model B"),
      model("executor-a", "Executor A"),
      model("executor-b", "Executor B"),
    ]
    const agents: AgentInfo[] = (["plan", "build", "meta", "verify"] as const).map((id) => ({
      id,
      name: { plan: "Plan", build: "Build", meta: "Meta", verify: "Verify" }[id],
      mode: id === "meta" ? "primary" : id === "verify" ? "subagent" : "all",
      hidden: false,
      request: { settings: {}, headers: {}, body: {} },
      permissions: [],
      handoffs: [],
    }))
    const steps = [
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/agent",
        body: { agent: "meta", model: modelA },
        ack: initial,
      },
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/executor",
        body: { agent: "verify" },
        ack: agentAck,
      },
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/model",
        body: { model: { providerID: "test", id: "model-b" } },
        ack: primaryModelAck,
      },
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/model",
        body: { model: modelB },
        ack: primaryVariantAck,
      },
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/executor",
        body: { agent: "verify", model: { providerID: "test", id: "executor-b" } },
        ack: executorModelAck,
      },
      {
        endpoint: "initial",
        path: "/api/session/" + initial.id + "/executor",
        body: { agent: "verify", model: executorB },
        ack: selected,
      },
      {
        endpoint: "replacement",
        path: "/api/session/" + initial.id + "/executor",
        body: { agent: "verify", model: { providerID: "test", id: "executor-b" } },
        ack: implicitExecutorAck,
      },
      {
        endpoint: "replacement",
        path: "/api/session/" + initial.id + "/executor",
        body: finalSelection.executorPreference,
        ack: finalSelection,
      },
      {
        endpoint: "replacement",
        path: "/api/session/" + created.id + "/agent",
        body: { agent: "build", model: created.model },
        ack: buildAck,
      },
      {
        endpoint: "replacement",
        path: "/api/session/" + created.id + "/agent",
        body: { agent: "plan", model: created.model },
        ack: planAck,
      },
    ] as const
    const requests: Array<{
      endpoint: string
      method: string
      path: string
      body?: unknown
      authorization: string | null
    }> = []
    const mutations: Array<{ endpoint: string; path: string; body: unknown }> = []
    const unexpected: string[] = []
    const sessions = new Map<string, SessionInfo>([[ordinary.id, ordinary]])
    const oldCreate = bridgeDeferred<void>()
    const oldReturned = bridgeDeferred<void>()
    const streams = new Map<string, { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }>()
    const terminal = miniBridgeTerminal(180, 40)
    const waiters = new Set<() => void>()
    let exitCode: number | undefined
    const notify = () => waiters.forEach((check) => check())
    const waitFor = <T>(read: () => T | undefined, label: string, allowExit = false) =>
      new Promise<T>((resolve, reject) => {
        const signal = AbortSignal.timeout(15_000)
        const cleanup = () => {
          waiters.delete(check)
          signal.removeEventListener("abort", timeout)
        }
        const timeout = () => {
          cleanup()
          reject(
            new Error(
              label +
                " timed out\n" +
                terminal.text() +
                "\nrequests: " +
                requests.map((item) => item.endpoint + " " + item.method + " " + item.path).join("\n"),
            ),
          )
        }
        const check = () => {
          if (unexpected.length > 0) {
            cleanup()
            reject(new Error("Mini fixture rejected " + label + ":\n" + unexpected.join("\n") + "\n" + terminal.text()))
            return
          }
          if (!allowExit && exitCode !== undefined) {
            cleanup()
            reject(new Error("Mini exited before " + label + ": " + exitCode + "\n" + terminal.text()))
            return
          }
          const value = read()
          if (value === undefined) return
          cleanup()
          resolve(value)
        }
        waiters.add(check)
        signal.addEventListener("abort", timeout, { once: true })
        check()
      })
    const waitText = (value: string, after = 0) =>
      waitFor(
        () => (terminal.frames.slice(after).some((frame) => frame.includes(value)) ? true : undefined),
        "terminal text " + value,
      )
    const waitRequest = (endpoint: string, method: string, pathname: string, occurrence = 0) =>
      waitFor(
        () =>
          requests.filter((item) => item.endpoint === endpoint && item.method === method && item.path === pathname)[
            occurrence
          ],
        endpoint + " " + method + " " + pathname + " #" + occurrence,
      )
    const fixture = (endpoint: "initial" | "replacement") =>
      Bun.serve({
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
          const url = new URL(request.url)
          // Environment variables are not captured in diagnostic output.
          const body: unknown =
            request.method === "POST" &&
            (url.pathname === "/api/session" || /\/(?:agent|executor|model)$/.test(url.pathname))
              ? await request.json()
              : undefined
          requests.push({
            endpoint,
            method: request.method,
            path: url.pathname,
            body,
            authorization: request.headers.get("authorization"),
          })
          notify()
          const matchesBody = (expected: unknown) => {
            if (Bun.deepEquals(body, expected, true)) return true
            unexpected.push(
              endpoint +
                " " +
                request.method +
                " " +
                url.pathname +
                " body mismatch: expected " +
                JSON.stringify(expected) +
                "; received " +
                JSON.stringify(body),
            )
            notify()
            return false
          }
          if (request.method === "GET" && url.pathname === "/api/event") {
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                streams.set(endpoint, { controller, closed: false })
                controller.enqueue(
                  new TextEncoder().encode(
                    "data: " +
                      JSON.stringify({
                        id: "evt_connected_" + requests.length,
                        created: 1,
                        type: "server.connected",
                        data: {},
                      }) +
                      "\n\n",
                  ),
                )
                notify()
              },
              cancel() {
                const current = streams.get(endpoint)
                if (current) current.closed = true
              },
            })
            return new Response(stream, { headers: { "content-type": "text/event-stream" } })
          }
          if (request.method === "GET" && url.pathname === "/api/location") return Response.json(location)
          if (request.method === "GET" && url.pathname === "/api/info")
            return Response.json({
              version: OMNIXA_VERSION,
              pid: process.pid,
              urls: [],
              paths: { tmp: home.path },
            })
          if (request.method === "GET" && url.pathname === "/api/provider")
            return Response.json({
              location,
              data: [{ id: "test", name: "Test", activation: "auto", package: "" }],
            })
          if (request.method === "GET" && url.pathname === "/api/model")
            return Response.json({ location, data: models })
          if (request.method === "GET" && url.pathname === "/api/model/default")
            return Response.json({ location, data: models[0] })
          if (request.method === "GET" && url.pathname === "/api/model/group")
            return Response.json({
              location,
              data: {
                targets: [],
                definitions: [],
                effective: [],
                defaultSelection: models[0] && { providerID: models[0].providerID, id: models[0].id },
              },
            })
          if (request.method === "GET" && url.pathname === "/api/agent")
            return Response.json({ location, data: agents })
          if (request.method === "GET" && ["/api/reference", "/api/command", "/api/form"].includes(url.pathname))
            return Response.json({ location, data: [] })
          if (request.method === "GET" && url.pathname === "/api/session/active") return Response.json({ data: {} })
          if (request.method === "GET" && url.pathname === "/api/session")
            return Response.json({
              data: url.searchParams.has("parentID") ? [] : [...sessions.values()],
              cursor: {},
            })
          if (request.method === "POST" && url.pathname === "/api/session") {
            const creates = requests.filter(
              (item) => item.endpoint === endpoint && item.method === "POST" && item.path === "/api/session",
            )
            if (endpoint === "initial" && creates.length === 1) {
              if (!matchesBody({ model: modelA, location: { directory } }))
                return new Response("Initial creation body mismatch", { status: 500 })
              return Response.json({ data: ordinary })
            }
            if (endpoint === "initial" && creates.length === 2) {
              if (
                !matchesBody({
                  agent: "meta",
                  model: modelB,
                  executorPreference: selected.executorPreference,
                  location: { directory },
                })
              )
                return new Response("Old creation body mismatch", { status: 500 })
              await oldCreate.promise
              sessions.set(stale.id, stale)
              oldReturned.resolve()
              return Response.json({ data: stale })
            }
            if (endpoint === "replacement" && creates.length === 1) {
              if (
                !matchesBody({
                  agent: "meta",
                  model: modelB,
                  executorPreference: finalSelection.executorPreference,
                  location: { directory },
                })
              )
                return new Response("Replacement creation body mismatch", { status: 500 })
              sessions.set(created.id, created)
              return Response.json({ data: created })
            }
            if (endpoint === "replacement" && creates.length === 2) {
              if (!matchesBody({ agent: "plan", model: planAck.model, location: { directory } }))
                return new Response("Ordinary creation body mismatch", { status: 500 })
              sessions.set(ordinaryCreated.id, ordinaryCreated)
              return Response.json({ data: ordinaryCreated })
            }
          }
          const session = /^\/api\/session\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname)
          const info = session ? sessions.get(decodeURIComponent(session[1]!)) : undefined
          if (info && request.method === "GET" && !session?.[2]) return Response.json({ data: info })
          if (info && request.method === "GET" && session?.[2] === "message")
            return Response.json({ data: [], cursor: {} })
          if (info && request.method === "GET" && ["inbox", "permission", "form"].includes(session?.[2] ?? ""))
            return Response.json({ data: [] })
          if (info && request.method === "PUT" && session?.[2] === "environment")
            return new Response(null, { status: 204 })
          if (info && request.method === "POST" && ["agent", "executor", "model"].includes(session?.[2] ?? "")) {
            const step = steps[mutations.length]
            if (!step || step.endpoint !== endpoint || step.path !== url.pathname) {
              unexpected.push("unexpected canonical mutation: " + endpoint + " " + url.pathname)
              notify()
              return new Response("Unexpected mutation", { status: 500 })
            }
            if (!matchesBody(step.body)) return new Response("Canonical body mismatch", { status: 500 })
            mutations.push({ endpoint, path: url.pathname, body })
            sessions.set(info.id, step.ack)
            notify()
            if (session?.[2] !== "executor") return new Response(null, { status: 204 })
            return Response.json({ data: step.ack })
          }
          unexpected.push(endpoint + " " + request.method + " " + url.pathname)
          notify()
          return new Response("Unhandled fixture route", { status: 404 })
        },
      })
    const initialServer = fixture("initial")
    const replacementServer = fixture("replacement")
    try {
      const script = [
        'import { runMini } from "./src/mini.ts"',
        'import { resolve } from "@omnixa/tui/config"',
        'import path from "node:path"',
        "const root = process.env.OMNIXA_TEST_HOME",
        'if (!root) throw new Error("Missing isolated test home")',
        "await runMini({",
        "  server: {",
        '    endpoint: { url: process.env.MINI_BRIDGE_INITIAL, auth: { type: "basic", username: "initial", password: "secret" } },',
        "    reconnect: async (signal) => {",
        "      signal.throwIfAborted()",
        '      return { url: process.env.MINI_BRIDGE_REPLACEMENT, auth: { type: "basic", username: "replacement", password: "secret" } }',
        "    },",
        "  },",
        '  model: "test/model-a#high", replay: false,',
        '  tuiConfig: resolve({ animations: false, mini: { mono: true, splash: "hide", footer: "show" } }, { terminalSuspend: false }),',
        '  paths: { home: root, state: path.join(root, "state"), log: path.join(root, "log") },',
        "})",
      ].join("\n")
      const child = Bun.spawn([process.execPath, "--preload", "@opentui/solid/preload", "--eval", script], {
        cwd: directory,
        env: isolatedEnv(home.path, {
          PWD: directory,
          TERM: "xterm-256color",
          MINI_BRIDGE_INITIAL: initialServer.url.toString(),
          MINI_BRIDGE_REPLACEMENT: replacementServer.url.toString(),
        }),
        terminal: {
          cols: 180,
          rows: 40,
          data(_terminal, bytes) {
            terminal.feed(bytes)
            notify()
          },
        },
      })
      void child.exited.then((code) => {
        exitCode = code
        notify()
      })
      try {
        const tty = child.terminal
        if (!tty) throw new Error("Expected a real Bun PTY")
        const command = async (query: string, panel: string) => {
          const opened = terminal.frames.length
          tty.write("\x10")
          await waitText("Commands", opened)
          const searched = terminal.frames.length
          tty.write(query)
          await waitText(query, searched)
          const selected = terminal.frames.length
          tty.write("\r")
          await waitText(panel, selected)
        }
        const pickModel = async (name: string, domain: "session" | "executor", label: string) => {
          await command("Switch model", "Select model")
          const wanted = domain === "session" ? "[Session model]" : "[Executor model]"
          if (!terminal.text().includes(wanted)) {
            const switched = terminal.frames.length
            tty.write("\t")
            await waitText(wanted, switched)
          }
          const searched = terminal.frames.length
          tty.write(name)
          await waitText(name, searched)
          const accepted = mutations.length
          const chosen = terminal.frames.length
          tty.write("\r")
          await waitFor(() => mutations[accepted], "validated model mutation #" + accepted)
          await waitText(label, chosen)
        }
        const pickVariant = async (
          variant: "implicit" | "default" | "high",
          domain: "session" | "executor",
          label: string,
        ) => {
          await command("Switch model variant", "Select variant")
          const wanted = domain === "session" ? "[Session variant]" : "[Executor variant]"
          if (!terminal.text().includes(wanted)) {
            const switched = terminal.frames.length
            tty.write("\t")
            await waitText(wanted, switched)
          }
          await waitText("Select variant 3")
          const selectRow = async (name: string, key: string) => {
            tty.write(key)
            await waitFor(
              () => (terminal.selected().some((row) => row === name || row.startsWith(name + " ")) ? true : undefined),
              "visible selected variant " + name,
            )
          }
          await selectRow("Default", "\x1b[H")
          if (variant !== "implicit") await selectRow("default", "\x1b[B")
          if (variant === "high") await selectRow("high", "\x1b[B")
          const accepted = mutations.length
          const chosen = terminal.frames.length
          tty.write("\r")
          await waitFor(() => mutations[accepted], "validated variant mutation #" + accepted)
          await waitText(label, chosen)
        }
        const startup = await waitRequest("initial", "POST", "/api/session")
        expect(startup.body).toEqual({ model: modelA, location: { directory } })
        expect((startup.body as SessionCreateInput).agent).toBeUndefined()
        expect((startup.body as SessionCreateInput).executorPreference).toBeUndefined()
        await waitText("Plan")
        await waitText("Model A")
        await waitFor(() => (streams.has("initial") ? true : undefined), "initial SSE connected")
        await waitRequest("initial", "GET", "/api/session/active")

        await command("Switch agent", "Select agent")
        expect(terminal.text()).toContain("Select agent 3")
        expect(terminal.text()).toContain("plan")
        expect(terminal.text()).toContain("build")
        expect(terminal.text()).toContain("meta")
        expect(terminal.text()).not.toContain("verify")
        tty.write("build")
        await waitFor(
          () => (terminal.selected().some((row) => row === "build" || row.startsWith("build ")) ? true : undefined),
          "visible ordinary Build choice",
        )
        const localBuildFrame = terminal.frames.length
        tty.write("\r")
        await waitText("agent Build", localBuildFrame)
        expect(mutations).toEqual([])
        expect(requests.filter((item) => item.method === "POST" && /\/agent$/.test(item.path))).toEqual([])
        expect(sessions.get(initial.id)).toEqual(ordinary)

        await command("Switch agent", "Select agent")
        tty.write("meta")
        await waitFor(
          () => (terminal.selected().some((row) => row === "meta" || row.startsWith("meta ")) ? true : undefined),
          "visible first Meta choice",
        )
        const metaFrame = terminal.frames.length
        tty.write("\r")
        const metaMutation = await waitRequest("initial", "POST", "/api/session/" + initial.id + "/agent")
        expect(metaMutation.body).toEqual({ agent: "meta", model: modelA })
        const metaReadback = await waitFor(
          () =>
            requests
              .slice(requests.indexOf(metaMutation) + 1)
              .find(
                (item) =>
                  item.endpoint === "initial" && item.method === "GET" && item.path === "/api/session/" + initial.id,
              ),
          "first Meta canonical readback after its POST",
        )
        expect(requests.indexOf(metaReadback)).toBeGreaterThan(requests.indexOf(metaMutation))
        await waitText("Meta", metaFrame)
        await waitText("test/model-a#high", metaFrame)
        expect(sessions.get(initial.id)).toEqual(initial)
        await command("Switch agent", "Session Agent")
        if (!terminal.text().includes("[Delegation preference]")) {
          const switched = terminal.frames.length
          tty.write("\t")
          await waitText("[Delegation preference]", switched)
        }
        await waitFor(
          () => (terminal.selected().some((row) => /^> Build(?:\s|$)/.test(row)) ? true : undefined),
          "current delegation preference Build",
        )
        tty.write("\x1b[B")
        await waitFor(
          () => (terminal.selected().some((row) => /^> Verify(?:\s|$)/.test(row)) ? true : undefined),
          "visible delegation preference Verify",
        )
        tty.write("\r")
        await waitRequest("initial", "POST", "/api/session/" + initial.id + "/executor")
        await pickModel("Model B", "session", "test/model-b")
        await pickVariant("default", "session", "test/model-b#default")
        await pickModel("Executor B", "executor", "test/model-b#default")
        await pickVariant("high", "executor", "test/model-b#default")

        tty.write("/new\r")
        const pending = await waitRequest("initial", "POST", "/api/session", 1)
        expect(pending.body).toEqual({
          agent: "meta",
          model: modelB,
          executorPreference: selected.executorPreference,
          location: { directory },
        })
        const initialStream = streams.get("initial")
        if (!initialStream || initialStream.closed) throw new Error("Expected the initial live SSE owner")
        initialStream.closed = true
        initialStream.controller.close()
        // Replacement hydration requires the actual transport onClient path first.
        await waitFor(() => (streams.has("replacement") ? true : undefined), "replacement SSE connected")
        await waitRequest("replacement", "GET", "/api/session/active")
        oldCreate.resolve()
        await oldReturned.promise

        // The original Session ID in these real replacement mutations proves owner retention.
        // The two Default choices also distinguish undefined from literal default on the wire.
        await pickVariant("implicit", "executor", "test/model-b#default")
        await pickVariant("default", "executor", "test/model-b#default")
        tty.write("/new\r")
        const next = await waitRequest("replacement", "POST", "/api/session")
        expect(next.body).toEqual({
          agent: "meta",
          model: modelB,
          executorPreference: finalSelection.executorPreference,
          location: { directory },
        })
        await waitText("new session " + created.id)
        await waitText("test/model-b#default")
        await waitText("Meta")
        expect(terminal.frames.some((frame) => frame.includes("new session " + stale.id))).toBe(false)
        expect(terminal.titles.some((title) => title.includes("STALE_CLI_BRIDGE"))).toBe(false)
        expect(terminal.titles.some((title) => title.includes("INITIAL_CLI_BRIDGE"))).toBe(true)
        expect(terminal.titles.some((title) => title.includes("NEW_CLI_BRIDGE"))).toBe(true)

        for (const choice of [
          { agent: "build", name: "Build", panel: "Session Agent", ack: buildAck },
          { agent: "plan", name: "Plan", panel: "Select agent", ack: planAck },
        ] as const) {
          await command("Switch agent", choice.panel)
          if (terminal.text().includes("Delegation preference") && !terminal.text().includes("[Session Agent]")) {
            const switched = terminal.frames.length
            tty.write("\t")
            await waitText("[Session Agent]", switched)
          }
          expect(terminal.text()).toContain("Select agent 3")
          expect(terminal.text()).not.toContain("verify")
          tty.write(choice.agent)
          await waitFor(
            () =>
              terminal.selected().some((row) => row === choice.agent || row.startsWith(choice.agent + " "))
                ? true
                : undefined,
            "visible historical Session Agent " + choice.agent,
          )
          tty.write("\r")
          const mutation = await waitRequest(
            "replacement",
            "POST",
            "/api/session/" + created.id + "/agent",
            choice.agent === "build" ? 0 : 1,
          )
          expect(mutation.body).toEqual({ agent: choice.agent, model: created.model })
          const readback = await waitFor(
            () =>
              requests
                .slice(requests.indexOf(mutation) + 1)
                .find(
                  (item) =>
                    item.endpoint === "replacement" &&
                    item.method === "GET" &&
                    item.path === "/api/session/" + created.id,
                ),
            "historical " + choice.agent + " canonical readback after its POST",
          )
          expect(requests.indexOf(readback)).toBeGreaterThan(requests.indexOf(mutation))
          await waitFor(() => {
            const frame = terminal.text()
            return !frame.includes("Select agent") &&
              frame.includes(choice.name) &&
              frame.includes("test/model-b#default")
              ? true
              : undefined
          }, "historical Session footer " + choice.agent)
          expect(sessions.get(created.id)).toEqual(choice.ack)
          expect(choice.ack.id).toBe(created.id)
          expect(choice.ack.controller).toEqual(created.controller)
          expect(choice.ack.executorPreference).toEqual(created.executorPreference)
        }

        tty.write("/new\r")
        const ordinaryNew = await waitRequest("replacement", "POST", "/api/session", 1)
        expect(ordinaryNew.body).toEqual({ agent: "plan", model: planAck.model, location: { directory } })
        expect((ordinaryNew.body as SessionCreateInput).executorPreference).toBeUndefined()
        await waitText("new session " + ordinaryCreated.id)
        await waitText("Plan")
        await waitText("Model B")
        expect(terminal.titles.some((title) => title.includes("NEW_ORDINARY_CLI_BRIDGE"))).toBe(true)
        expect(sessions.get(ordinaryCreated.id)).toEqual(ordinaryCreated)
        expect(sessions.get(ordinaryCreated.id)?.controller).toBeUndefined()
        expect(sessions.get(ordinaryCreated.id)?.executorPreference).toBeUndefined()
        expect(sessions.get(created.id)).toEqual(planAck)
        expect(mutations).toEqual(
          steps.map((step) => ({
            endpoint: step.endpoint,
            path: step.path,
            body: step.body,
          })),
        )
        expect(
          requests
            .filter((item) => item.endpoint === "initial")
            .every((item) => item.authorization === "Basic " + btoa("initial:secret")),
        ).toBe(true)
        expect(
          requests
            .filter((item) => item.endpoint === "replacement")
            .every((item) => item.authorization === "Basic " + btoa("replacement:secret")),
        ).toBe(true)
        expect(unexpected).toEqual([])
        expect(terminal.unsupported).toEqual([])
        const exiting = terminal.frames.length
        tty.write("\x03")
        await waitText("exit", exiting)
        tty.write("\x03")
        expect(await waitFor(() => exitCode, "Mini clean exit", true)).toBe(0)
      } finally {
        oldCreate.resolve()
        child.kill()
        await child.exited
        child.terminal?.close()
      }
    } finally {
      oldCreate.resolve()
      initialServer.stop(true)
      replacementServer.stop(true)
    }
  }, 60_000)
  test("uses piped stdin as the initial prompt", () => {
    expect(Mini.mergeInput("from stdin", undefined)).toBe("from stdin")
    expect(Mini.mergeInput("from stdin", "from flag")).toBe("from stdin\nfrom flag")
  })

  test("constructs a fresh authenticated client for a replacement endpoint", async () => {
    const authorization: Array<string | null> = []
    const initial = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          version: OMNIXA_VERSION,
          pid: process.pid,
          urls: [],
          paths: { tmp: "/tmp/omnixa" },
        })
      },
    })
    const replacement = Bun.serve({
      port: 0,
      fetch(request) {
        authorization.push(request.headers.get("authorization"))
        return Response.json({
          version: OMNIXA_VERSION,
          pid: process.pid,
          urls: [],
          paths: { tmp: "/tmp/omnixa" },
        })
      },
    })
    const controller = new AbortController()
    let signal: AbortSignal | undefined

    try {
      const connection = createMiniConnection({
        endpoint: { url: initial.url.toString() },
        reconnect: async (next) => {
          signal = next
          return {
            url: replacement.url.toString(),
            auth: { type: "basic", username: "replacement", password: "secret" },
          }
        },
      })
      const client = await connection.reconnect?.(controller.signal)
      if (!client) throw new Error("Expected a replacement client")
      await client.server.info()

      expect(client).not.toBe(connection.sdk)
      expect(signal).toBe(controller.signal)
      expect(authorization).toEqual([`Basic ${btoa("replacement:secret")}`])
      expect(createMiniConnection({ endpoint: { url: initial.url.toString() } }).reconnect).toBeUndefined()
    } finally {
      initial.stop(true)
      replacement.stop(true)
    }
  })

  test("re-resolves a managed target when the endpoint moves before transport construction", async () => {
    const initial = Omnixa.make({ baseUrl: "https://initial.omnixa.test" })
    const replacement = Omnixa.make({ baseUrl: "https://replacement.omnixa.test" })
    const controller = new AbortController()
    const seen: (typeof initial)[] = []
    let reconnects = 0

    const result = await resolveMiniTarget({
      sdk: initial,
      reconnect: async (signal) => {
        expect(signal).toBe(controller.signal)
        reconnects++
        if (reconnects === 1) throw new Error("service still moving")
        return replacement
      },
      signal: controller.signal,
      resolve: async (sdk) => {
        seen.push(sdk)
        if (sdk === initial) throw new ClientError("Transport")
        return "ses-replacement"
      },
    })

    expect(seen).toEqual([initial, replacement])
    expect(reconnects).toBe(2)
    expect(result).toEqual({ sdk: replacement, value: "ses-replacement" })
  })

  test("merges non-interactive argument and stdin input", () => {
    expect(Run.mergeInput("from args", "from stdin")).toBe("from args\nfrom stdin")
    expect(Run.mergeInput(undefined, "from stdin")).toBe("from stdin")
  })

  test("parses model variants from the model reference", () => {
    expect(JSON.stringify(parseRunModel("openrouter/openai/gpt-5#high"))).toBe(
      JSON.stringify({ model: { providerID: "openrouter", modelID: "openai/gpt-5" }, variant: "high" }),
    )
    expect(parseRunModel("group:fallback")).toEqual({
      model: { type: "group", groupID: "fallback" },
      variant: undefined,
    })
    expect(parseSessionTargetModel("openrouter/openai/gpt-5#high")).toEqual({
      providerID: "openrouter",
      id: "openai/gpt-5",
      variant: "high",
    })
  })

  test("is registered in the preview CLI", async () => {
    const result = await cli(["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^  mini[ \t]+Start the minimal interactive interface\r?$/m)
    expect(result.stdout).toMatch(/^  run[ \t]+Run Omnixa with a message\r?$/m)
  })

  test("exposes run without legacy interactive, attach, or command modes", async () => {
    const result = await cli(["run", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("--server string")
    expect(result.stdout).not.toContain("--interactive")
    expect(result.stdout).not.toContain("--variant")
    expect(result.stdout).not.toContain("--attach")
    expect(result.stdout).not.toContain("--command")
  })

  test("keeps option-like prompt text after the argument separator", async () => {
    const result = await cli(["run", "--server", "http://127.0.0.1:1", "--", "--foo"])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain("You must provide a message")
  })

  test("passes explicit selections to session creation without catalog preflight", async () => {
    const requests: string[] = []
    let session: unknown
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname)
        if (url.pathname === "/api/info")
          return Response.json({
            version: OMNIXA_VERSION,
            pid: process.pid,
            urls: [],
            paths: { tmp: "/tmp/omnixa" },
          })
        if (url.pathname === "/api/location")
          return Response.json({ directory: process.cwd(), project: { id: "global", directory: process.cwd() } })
        if (url.pathname === "/api/session") {
          session = await request.json()
          return new Response("boom", { status: 500 })
        }
        return new Response(undefined, { status: 404 })
      },
    })

    try {
      const result = await cli([
        "run",
        "--server",
        server.url.toString(),
        "--model",
        "definitely/missing",
        "--agent",
        "definitely-missing",
        "hi",
      ])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("UnexpectedStatus")
      expect(session).toMatchObject({
        agent: "definitely-missing",
        model: { providerID: "definitely", id: "missing" },
      })
      expect(requests).not.toContain("/api/model")
      expect(requests).not.toContain("/api/agent")
      expect(requests).not.toContain("/api/location/wait")
    } finally {
      server.stop(true)
    }
  })

  test("reports pre-admission errors as JSON", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/api/session") return new Response("boom", { status: 500 })
        return Response.json({
          version: "incompatible",
          pid: process.pid,
          urls: [],
          paths: { tmp: "/tmp/omnixa" },
        })
      },
    })

    try {
      const result = await cli(["run", "--format", "json", "--server", server.url.toString(), "hi"])

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        type: "error",
        sessionID: "",
        error: { type: "unknown", message: "UnexpectedStatus: 500" },
      })
    } finally {
      server.stop(true)
    }
  })

  test("uses the shared V2 server option instead of an attach command", async () => {
    const result = await cli(["mini", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("--server string")
    expect(result.stdout).toContain("--prompt string")
    expect(result.stdout).toContain("--replay")
    expect(result.stdout).toContain("disable with --no-replay")
    expect(result.stdout).toContain("--replay-limit integer")
    expect(result.stdout).toContain("Limit replay to the newest N messages (default: 200)")
    expect(result.stdout).not.toContain("SUBCOMMANDS")
  })

  test("routes local and explicit-server invocations into mini", async () => {
    for (const args of [["mini"], ["mini", "--no-replay"], ["mini", "--server", "http://127.0.0.1:1"]]) {
      const result = await cli(args)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("omnixa mini requires a TTY stdout")
    }
  })
})
