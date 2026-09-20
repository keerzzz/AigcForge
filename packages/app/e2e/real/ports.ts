import { spawnSync } from "node:child_process"
import { connect } from "node:net"

/**
 * Grab a free TCP port by binding port 0 on loopback and releasing it, via a
 * synchronous probe — the Playwright config loads before any async context and
 * needs the three E4 ports up front. There is a small bind race between
 * release and the spawned process taking the port; acceptable for local E4 —
 * a collision fails loudly at startup, not silently.
 */
export function freePortSync(env: NodeJS.ProcessEnv): number {
  const probe =
    "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();console.log(a.port);s.close(()=>process.exit(0))})"
  const result = spawnSync("bun", ["--no-env-file", "-e", probe], { encoding: "utf8", env })
  const port = Number(result.stdout.trim())
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`free port probe failed: ${result.stderr}`)
  }
  return port
}

/**
 * Probe whether a TCP port still accepts connections — used by teardown to
 * prove every E4 port was released.
 */
export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => {
      socket.destroy()
      resolve(false)
    })
  })
}
