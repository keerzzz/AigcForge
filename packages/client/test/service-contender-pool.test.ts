import { afterEach, expect, test } from "bun:test"
import { once } from "node:events"
import { createInterface } from "node:readline"
import {
  contenderFinished,
  contenderPool,
  type ServiceContender,
  spawnServiceContender,
} from "../src/service-contender"
import { defaultEnsureTiming } from "../src/service-timing"

const spawned: ServiceContender[] = []
afterEach(() => {
  spawned.splice(0).forEach((contender) => {
    contender.release()
    contender.child.kill("SIGKILL")
  })
})
;[
  [3, 4],
  [3, 4, 75],
].forEach((pipes) => {
  test.skipIf(process.platform !== "linux")(
    `under Node, a detached service releases launcher pipes ${pipes.join(",")} while remaining alive`,
    async () => {
      const childProcess = await import("node:child_process")
      const parentCode = `
          import { once } from "node:events"
          import { createInterface } from "node:readline"
          import { spawnServiceContender } from ${JSON.stringify(new URL("../src/service-contender.ts", import.meta.url).href)}

          const contender = spawnServiceContender(${JSON.stringify(process.execPath)}, [
            "--eval",
            ${JSON.stringify('Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") }); console.error("ready")')},
          ])
          contender.child.ref()
          process.stderr.write("daemon-pid:" + contender.child.pid + "\\n")
          const ready = createInterface({ input: contender.child.stderr })
          try {
            const event = await once(ready, "line", { signal: AbortSignal.timeout(3_000) })
            if (event[0] !== "ready") throw new Error("Daemon did not become ready")
            process.stdout.write(String(contender.child.pid) + "\\n", () => process.exit(0))
          } catch (error) {
            contender.child.kill("SIGKILL")
            throw error
          }
        `
      const supervisor = childProcess.spawn(
        "node",
        [
          "--input-type=module",
          "--eval",
          `
          import { spawn } from "node:child_process"
          import { once } from "node:events"
          import { createInterface } from "node:readline"

          const pipes = ${JSON.stringify(pipes)}
          const controller = new AbortController()
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
          const report = { failed: true, failure: "parent-spawn", parentExit: null, parentClose: null, daemonAlive: false, daemonPID: 0 }
          let parent
          let output
          let diagnostics
          process.once("SIGTERM", () => controller.abort())
          try {
            // Use Node for the sparse descriptor table: Bun's posix_spawn rejects its holes.
            // Node v24.21.0 deps/uv/src/unix/core.c:800–808 stops its CLOEXEC scan at the first gap above 15.
            parent = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(parentCode)}], {
              stdio: Array.from({ length: Math.max(...pipes) + 1 }, (_, index) =>
                index === 0 ? "ignore" : index < 3 || pipes.includes(index) ? "pipe" : "ignore",
              ),
            })
            const closed = once(parent, "close", { signal }).then((event) => event, () => undefined)
            const exited = once(parent, "exit", { signal }).then((event) => {
              report.parentExit = event
              return event
            }, () => undefined)
            report.failure = "parent-readiness"
            if (parent.stdout === null || parent.stderr === null) throw new Error("MissingParentPipes")
            diagnostics = createInterface({ input: parent.stderr })
            diagnostics.on("line", (line) => {
              const match = line.match(/^daemon-pid:(\\d+)$/)
              if (match) report.daemonPID = Number(match[1])
            })
            output = createInterface({ input: parent.stdout })
            const result = await Promise.all([once(output, "line", { signal }), exited])
            const pid = Number(result[0][0])
            if (!Number.isInteger(pid) || pid <= 0) throw new Error("InvalidDaemonPID")
            report.daemonPID = pid
            report.failure = "parent-exit"
            if (result[1]?.[0] !== 0 || result[1]?.[1] !== null) throw new Error("ParentExitFailed")
            report.failure = "daemon-alive"
            process.kill(pid, 0)
            report.daemonAlive = true
            report.failure = "parent-close-timeout"
            report.parentClose = await closed ?? null
            if (report.parentClose === null) throw new Error("ParentCloseTimedOut")
            report.failure = "parent-close-status"
            if (report.parentClose[0] !== 0 || report.parentClose[1] !== null) throw new Error("ParentCloseFailed")
            report.failure = "daemon-alive"
            process.kill(pid, 0)
            report.failed = false
            report.failure = undefined
          } catch {
            report.failed = true
          } finally {
            controller.abort()
            parent?.kill("SIGKILL")
            // Drain the parent's PID announcement before disposing its owned pipes on a startup failure.
            if (parent?.stderr && !parent.stderr.readableEnded && !parent.stderr.destroyed) {
              await once(parent.stderr, "end", { signal: AbortSignal.timeout(1_000) }).catch(() => {
                report.failed = true
                report.failure ??= "cleanup-stderr"
              })
            }
            if (report.daemonPID > 0) {
              try {
                process.kill(report.daemonPID, "SIGKILL")
              } catch (error) {
                if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
                  report.failed = true
                  report.failure ??= "cleanup-daemon"
                }
              }
            }
            output?.close()
            diagnostics?.close()
            parent?.stdio.forEach((pipe) => pipe?.destroy())
          }
          process.stdout.write(JSON.stringify(report) + "\\n", () => process.exit(report.failed ? 1 : 0))
        `,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      const closed = once(supervisor, "close", { signal }).then(
        (event) => event,
        (error: unknown) => error,
      )
      let output: ReturnType<typeof createInterface> | undefined
      try {
        if (supervisor.stdout === null) throw new Error("Node supervisor stdout pipe is unavailable")
        output = createInterface({ input: supervisor.stdout })
        const [line, exited] = await Promise.all([
          once(output, "line", { signal }),
          once(supervisor, "exit", { signal }),
        ])
        const report: unknown = JSON.parse(line[0])
        if (
          typeof report !== "object" ||
          report === null ||
          !("failed" in report) ||
          typeof report.failed !== "boolean"
        )
          throw new Error("InvalidSupervisorReport")
        if (report.failed) console.log(JSON.stringify(report))
        // A timed-out parent close is an explicit failed observation, never a swallowed success.
        expect(report).toMatchObject({
          failed: false,
          parentExit: [0, null],
          parentClose: [0, null],
          daemonAlive: true,
        })
        expect(exited).toEqual([0, null])
        expect(await closed).toEqual([0, null])
      } finally {
        controller.abort()
        output?.close()
        if (supervisor.exitCode === null && supervisor.signalCode === null) {
          const cleanup = once(supervisor, "close", { signal: AbortSignal.timeout(2_000) })
          supervisor.kill("SIGTERM")
          await cleanup.catch(() => supervisor.kill("SIGKILL"))
        }
        supervisor.stdio.forEach((pipe) => pipe?.destroy())
      }
    },
    15_000,
  )
})

test("remembers the first startup failure and reports it once no attempt is left", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 0 })
  const survivor = running()
  const failed = failing("first failure")
  pool.add(survivor)
  pool.add(failed)
  await finished(failed)

  expect(pool.reap()).toBeUndefined()
  expect(pool.failure()?.message).toContain("first failure")
  expect(pool.shouldRecruit(false)).toBe(false)

  survivor.child.kill("SIGKILL")
  await finished(survivor)
  expect(pool.reap()?.message).toContain("first failure")
})

test("evicting a replaced owner forgets its failure and restarts the spawn clock", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 60_000 })
  const owner = running()
  const failed = failing("old failure")
  pool.add(owner)
  pool.add(failed)
  await finished(failed)
  expect(pool.reap()).toBeUndefined()
  expect(pool.failure()).toBeDefined()

  pool.evict(owner.child.pid!)

  expect(pool.failure()).toBeUndefined()
  expect(pool.reap()).toBeUndefined()
  expect(pool.shouldRecruit(false)).toBe(true)
  expect(owner.child.exitCode).toBeNull()
})

test("an unanswered registration gets one spawn delay before an attempt competes", () => {
  const timing = { ...defaultEnsureTiming, spawnDelay: 60_000 }
  expect(contenderPool(timing).shouldRecruit(false)).toBe(true)

  const registered = contenderPool(timing)
  expect(registered.shouldRecruit(true)).toBe(false)
  registered.recruitNow()
  expect(registered.shouldRecruit(true)).toBe(true)
})

test("keeps at most two attempts alive", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 0 })
  const exiting = clean()
  pool.add(running())
  pool.add(exiting)
  expect(pool.shouldRecruit(false)).toBe(false)

  await finished(exiting)
  expect(pool.reap()).toBeUndefined()
  expect(pool.shouldRecruit(false)).toBe(true)
})

test("clean exits back off up to the maximum spawn delay", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 200, maxSpawnDelay: 300 })
  const exiting = clean()
  pool.add(exiting)
  const start = Date.now()
  await finished(exiting)
  expect(pool.reap()).toBeUndefined()

  // The base delay (200 ms) has passed, but the backed-off delay (300 ms) has not, unless a
  // loaded machine overslept past it.
  await Bun.sleep(Math.max(0, 250 - (Date.now() - start)))
  if (Date.now() - start < 290) expect(pool.shouldRecruit(false)).toBe(false)
  // Doubling would give 400 ms; the cap allows an attempt at 300 ms.
  await Bun.sleep(Math.max(0, 320 - (Date.now() - start)))
  expect(pool.shouldRecruit(false)).toBe(true)
})

test("an answering service resets the backoff to the base spawn delay", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 200, maxSpawnDelay: 1_000 })
  const exiting = clean()
  pool.add(exiting)
  const start = Date.now()
  await finished(exiting)
  expect(pool.reap()).toBeUndefined()

  pool.serviceAnswered()
  // Backed off, the next attempt would wait 400 ms; after the reset it waits the base 200 ms.
  await Bun.sleep(Math.max(0, 250 - (Date.now() - start)))
  expect(pool.shouldRecruit(false)).toBe(true)
})

function spawn(code: string) {
  const contender = spawnServiceContender(process.execPath, ["-e", code])
  spawned.push(contender)
  return contender
}

function running() {
  return spawn("setTimeout(() => {}, 60_000)")
}

function failing(message: string) {
  return spawn(`console.error(${JSON.stringify(message)}); process.exit(1)`)
}

function clean() {
  return spawn("process.exit(0)")
}

async function finished(contender: ServiceContender) {
  while (!contenderFinished(contender)) await Bun.sleep(5)
}
