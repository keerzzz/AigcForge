export * as McpOAuthCallbackV2 from "./v2-oauth-callback"

import { createConnection } from "net"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "./v2-oauth-provider"

const OAUTH_CALLBACK_HOST = "127.0.0.1"
let currentPort = OAUTH_CALLBACK_PORT
let currentPath = OAUTH_CALLBACK_PATH

const HTML_SUCCESS = `<!DOCTYPE html>
<html><head><title>Aigcfroge - Authorization Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#eee}.container{text-align:center;padding:2rem}h1{color:#4ade80}</style></head>
<body><div class="container"><h1>Authorization Successful</h1><p>You can close this window and return to Aigcfroge.</p></div><script>setTimeout(()=>window.close(),2000)</script></body></html>`

function htmlError(error: string) {
  return `<!DOCTYPE html>
<html><head><title>Aigcfroge - Authorization Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#eee}h1{color:#f87171}.error{color:#fca5a5;margin-top:1rem;padding:1rem;background:rgba(248,113,113,0.1)}</style></head>
<body><div class="container"><h1>Authorization Failed</h1><div class="error">${error.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c)}</div></div></body></html>`
}

interface PendingAuth { resolve: (code: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }

let server: ReturnType<typeof createServer> | undefined
const pendingAuths = new Map<string, PendingAuth>()
const mcpNameToState = new Map<string, string>()
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

function cleanupStateIndex(oauthState: string) {
  for (const [name, state] of mcpNameToState) {
    if (state === oauthState) { mcpNameToState.delete(name); break }
  }
}

function stopIfIdle() {
  if (pendingAuths.size > 0 || !server) return
  server.close()
  server = undefined
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${currentPort}`)
  if (url.pathname !== currentPath) { res.writeHead(404); res.end("Not found"); return }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  if (!state) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(htmlError("Missing required state parameter - potential CSRF attack")); return
  }

  if (error) {
    const msg = errorDescription || error
    if (pendingAuths.has(state)) { clearTimeout(pendingAuths.get(state)!.timeout); pendingAuths.delete(state); cleanupStateIndex(state); pendingAuths.get(state)?.reject(new Error(msg)) }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(htmlError(msg)); stopIfIdle(); return
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }); res.end(htmlError("No authorization code provided")); return
  }

  if (!pendingAuths.has(state)) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }); res.end(htmlError("Invalid or expired state parameter")); return
  }

  const pending = pendingAuths.get(state)!
  clearTimeout(pending.timeout); pendingAuths.delete(state); cleanupStateIndex(state)
  pending.resolve(code)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(HTML_SUCCESS)
  stopIfIdle()
}

export async function ensureRunning(redirectUri?: string): Promise<void> {
  const { port, path } = parseRedirectUri(redirectUri)
  if (server && (currentPort !== port || currentPath !== path)) await stop()
  if (server) return
  const running = await isPortInUse(port)
  if (running) return
  currentPort = port; currentPath = path
  server = createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    server!.listen(currentPort, OAUTH_CALLBACK_HOST, () => resolve())
    server!.on("error", reject)
  })
}

export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> {
  if (mcpName) mcpNameToState.set(mcpName, oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) { pendingAuths.delete(oauthState); if (mcpName) mcpNameToState.delete(mcpName); reject(new Error("OAuth callback timeout")); stopIfIdle() }
    }, CALLBACK_TIMEOUT_MS)
    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

export function cancelPending(mcpName: string): void {
  const oauthState = mcpNameToState.get(mcpName)
  const key = oauthState ?? mcpName
  const pending = pendingAuths.get(key)
  if (pending) { clearTimeout(pending.timeout); pendingAuths.delete(key); mcpNameToState.delete(mcpName); pending.reject(new Error("Authorization cancelled")); stopIfIdle() }
}

export async function isPortInUse(port: number = OAUTH_CALLBACK_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1")
    socket.on("connect", () => { socket.destroy(); resolve(true) })
    socket.on("error", () => resolve(false))
  })
}

export async function stop(): Promise<void> {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  for (const [, pending] of pendingAuths) { clearTimeout(pending.timeout); pending.reject(new Error("OAuth callback server stopped")) }
  pendingAuths.clear(); mcpNameToState.clear()
}

export function isRunning(): boolean { return server !== undefined }
