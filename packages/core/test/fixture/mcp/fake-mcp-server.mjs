// Minimal line-delimited JSON-RPC MCP server fixture for mcp-connection tests.
// Modes: ok (handshake + two tools + echo call), silent (never replies),
// garbage (writes non-JSON lines), crash (exits immediately),
// stubborn (ignores SIGTERM; exercises forceKillAfter escalation),
// proto (advertises a tool literally named `__proto__` plus one normal tool),
// envecho (echoes the injected MCP_CREDENTIAL_* env back through a tool call,
//   so a test can prove the material actually reached the child process),
// stderrsecret (writes one very long stderr line whose secret straddles the
//   log truncation boundary; exercises scan-before-truncate ordering),
// pendingcall (handshakes normally then leaves tools/call unanswered).
import { writeFileSync } from "node:fs"
import readline from "node:readline"

const mode = process.argv[2] ?? "ok"
const pendingMarker = process.argv[3]

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")

if (mode === "crash") {
  process.exit(3)
}

if (mode === "stubborn") {
  // Replace the default TERM handling: only SIGKILL may stop this server.
  process.on("SIGTERM", () => {})
}

if (mode === "stderrsecret") {
  // The secret sits AFTER a long filler run so that a truncate-first log would
  // slice it into a prefix no pattern can match. Keep the filler wide enough to
  // straddle McpConnection.MAX_STDERR_LOG.
  const filler = "x".repeat(2400)
  process.stderr.write(`${filler} api_key=sk-live-abcdefghijklmnopqrstuvwxyz012345\n`)
}

if (mode === "garbage") {
  setInterval(() => process.stdout.write("garbage-line\n"), 20)
} else {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on("line", (line) => {
    if (mode === "silent") return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (!msg || typeof msg.id !== "number" || typeof msg.method !== "string") return
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake", version: "0" },
        },
      })
    } else if (msg.method === "tools/list") {
      const tools =
        mode === "proto"
          ? [
              {
                name: "__proto__",
                description: "Tool named after the prototype key",
                inputSchema: { type: "object", properties: { msg: { type: "string" } } },
              },
              { name: "good", description: "Normal tool", inputSchema: { type: "object" } },
            ]
          : [
              {
                name: "echo",
                description: mode === "changed" ? "Changed echo" : "Echo a message",
                inputSchema:
                  mode === "changed"
                    ? { type: "object", properties: { changed: { type: "boolean" } } }
                    : {
                        type: "object",
                        properties: { msg: { type: "string" } },
                        required: ["msg"],
                      },
              },
              { name: "desc", description: "Second tool", inputSchema: { type: "object" } },
            ]
      send({ jsonrpc: "2.0", id: msg.id, result: { tools } })
    } else if (msg.method === "tools/call") {
      if (mode === "pendingcall") {
        if (pendingMarker) writeFileSync(pendingMarker, "pending")
        return
      }
      const echoed =
        mode === "envecho"
          ? `env:${process.env.MCP_CREDENTIAL_API_KEY ?? ""}|${process.env.MCP_CREDENTIAL_ACCESS_TOKEN ?? ""}`
          : `echo:${msg.params?.arguments?.msg ?? ""}`
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: echoed }] },
      })
    }
  })
}

setInterval(() => {}, 10_000)
