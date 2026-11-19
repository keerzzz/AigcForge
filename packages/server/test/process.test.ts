import { expect } from "bun:test"
import { Clock, Context, DateTime, Deferred, Duration, Effect, Exit, Layer, Ref, Scope } from "effect"
import { TestClock } from "effect/testing"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Session } from "@aigcfroge/schema/session"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Global } from "@aigcfroge/util/global"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, it, pollWithTimeout } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("authenticates API requests behind the frontend transform while allowing browser preflight", () =>
  Effect.gen(function* () {
    const fallback = "fallback".repeat(256)
    const server = yield* ServerProcess.start<never, never>(
      {
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        cors: ["http://192.168.1.10:3001", "https://example.com"],
        app: { version: "test-version" },
        database: { path: ":memory:" },
      },
      undefined,
      (api) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/openapi.json")
            return yield* api
          return HttpServerResponse.raw(fallback, { contentType: "text/plain" })
        }),
    )
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization")

    const status = yield* Effect.promise(() =>
      fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
        headers: {
          authorization: `Basic ${btoa("aigcfroge:secret")}`,
          origin: "http://localhost:3000",
        },
      }),
    )

    expect(status.status).toBe(200)
    expect(status.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(yield* Effect.promise(() => status.json())).toMatchObject({ version: "test-version" })

    yield* Effect.forEach(
      ["http://192.168.1.10:3001", "https://example.com", "https://untrusted.example.com"],
      (origin) =>
        Effect.gen(function* () {
          const allowed = origin === "https://untrusted.example.com" ? null : origin
          const preflight = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
              method: "OPTIONS",
              headers: {
                origin,
                "access-control-request-method": "GET",
                "access-control-request-headers": "authorization",
              },
            }),
          )
          expect(preflight.status).toBe(204)
          expect(preflight.headers.get("access-control-allow-origin")).toBe(allowed)

          const status = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), {
              headers: { origin, authorization: `Basic ${btoa("aigcfroge:secret")}` },
            }),
          )
          expect(status.status).toBe(200)
          expect(status.headers.get("access-control-allow-origin")).toBe(allowed)
          yield* Effect.promise(() => status.arrayBuffer())

          const denied = yield* Effect.promise(() =>
            fetch(new URL("/api/info", HttpServer.formatAddress(server.address)), { headers: { origin } }),
          )
          expect(denied.status).toBe(401)
          expect(denied.headers.get("access-control-allow-origin")).toBe(allowed)
          yield* Effect.promise(() => denied.arrayBuffer())
        }),
    )

    const event = yield* Effect.promise(() =>
      fetch(new URL("/api/event", HttpServer.formatAddress(server.address)), {
        headers: {
          "accept-encoding": "br",
          authorization: `Basic ${btoa("aigcfroge:secret")}`,
        },
      }),
    )
    expect(event.status).toBe(200)
    expect(event.headers.get("content-encoding")).toBeNull()
    const body = event.body
    if (!body) return yield* Effect.die(new Error("Event response has no body"))
    const reader = body.getReader()
    yield* Effect.promise(() => readUntil(reader, "server.connected"))
    yield* server.updateAvailable("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.update-available"))
    yield* server.updated("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.updated"))
    yield* Effect.promise(() => reader.cancel())

    const missing = yield* Effect.promise(() =>
      fetch(new URL("/missing", HttpServer.formatAddress(server.address)), {
        headers: {
          "accept-encoding": "br",
          authorization: `Basic ${btoa("aigcfroge:secret")}`,
        },
      }),
    )
    expect(missing.status).toBe(200)
    expect(missing.headers.get("content-encoding")).toBe("br")
    expect(missing.headers.get("content-type")).toBe("text/plain")
    expect(missing.headers.get("vary")?.toLowerCase()).toContain("accept-encoding")
    expect(yield* Effect.promise(() => missing.text())).toBe(fallback)

    yield* Effect.forEach(["/api", "/api/missing", "/openapi.json"], (pathname) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => fetch(new URL(pathname, HttpServer.formatAddress(server.address))))
        expect(response.status).toBe(401)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "UnauthorizedError",
          message: "Authentication required",
        })
      }),
    )

    yield* Effect.forEach(["/", "/workspace/example", "/_assets/app.js", "/icons/icon.svg", "/sw.js"], (pathname) =>
      Effect.gen(function* () {
        yield* Effect.forEach(["GET", "HEAD"], (method) =>
          Effect.gen(function* () {
            yield* Effect.forEach([undefined, `Basic ${btoa("aigcfroge:wrong")}`], (authorization) =>
              Effect.gen(function* () {
                const response = yield* Effect.promise(() =>
                  fetch(new URL(pathname, HttpServer.formatAddress(server.address)), {
                    method,
                    headers: authorization ? { authorization } : undefined,
                  }),
                )
                expect(response.status).toBe(200)
                expect(response.headers.get("www-authenticate")).toBeNull()
                expect(yield* Effect.promise(() => response.text())).toBe(method === "HEAD" ? "" : fallback)
              }),
            )
            const response = yield* Effect.promise(() =>
              fetch(new URL(pathname, HttpServer.formatAddress(server.address)), {
                method,
                headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
              }),
            )
            expect(response.status).toBe(200)
            expect(yield* Effect.promise(() => response.text())).toBe(method === "HEAD" ? "" : fallback)
          }),
        )
      }),
    )
  }),
)

it.live("pairing links sign in browsers with a cookie and API clients with a token", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
    })
    const base = HttpServer.formatAddress(server.address)
    const request = (pathname: string, init?: RequestInit) =>
      Effect.promise(() => fetch(new URL(pathname, base), { redirect: "manual", ...init }))
    const pair = Effect.gen(function* () {
      const response = yield* request("/api/pair", {
        method: "POST",
        headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
      })
      expect(response.status).toBe(200)
      return (yield* Effect.promise(() => response.json())) as { code: string; expires_in: number }
    })

    const rejected = yield* request("/api/pair", { method: "POST" })
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    // A Basic challenge on fetch makes browsers show a native prompt instead of the app's sign-in screen.
    const fetched = yield* request("/api/info", { headers: { "sec-fetch-mode": "cors" } })
    expect(fetched.status).toBe(401)
    expect(fetched.headers.get("www-authenticate")).toBeNull()

    const browser = yield* pair
    expect(browser.expires_in).toBe(300)
    const redirect = yield* request(`/auth/connect/${browser.code}`, { headers: { accept: "text/html" } })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe("/")
    const setCookie = redirect.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`aigcfroge_session_${new URL(base).port}=`)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    const cookie = setCookie.split(";")[0]

    const reused = yield* request(`/auth/connect/${browser.code}`, { headers: { accept: "text/html" } })
    expect(reused.status).toBe(401)
    expect(yield* Effect.promise(() => reused.text())).toContain("aigcfroge pair")

    expect((yield* request("/api/info", { headers: { cookie } })).status).toBe(200)
    expect((yield* request("/api/info", { headers: { cookie, origin: base } })).status).toBe(200)
    expect((yield* request("/api/info", { headers: { cookie, origin: "http://127.0.0.1:1" } })).status).toBe(401)
    expect((yield* request("/api/info", { headers: { cookie: `${cookie}x` } })).status).toBe(401)

    const client = yield* pair
    const redeemed = yield* request(`/auth/connect/${client.code}`)
    expect(redeemed.status).toBe(200)
    const session = (yield* Effect.promise(() => redeemed.json())) as { token: string }
    expect(
      (yield* request("/api/info", { headers: { authorization: `Basic ${btoa(`aigcfroge:${session.token}`)}` } }))
        .status,
    ).toBe(200)
    expect((yield* request(`/auth/connect/${client.code}`)).status).toBe(401)
    expect((yield* request("/auth/connect/unknown")).status).toBe(401)
  }),
)

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string) {
  while (true) {
    const next = await reader.read()
    if (next.done) throw new Error(`Event stream ended before ${expected}`)
    if (new TextDecoder().decode(next.value).includes(expected)) return
  }
}

it.live("server info lists remote URLs alongside local addresses while they are available", () =>
  Effect.gen(function* () {
    const remote = { urls: ["https://example.opentunnel.xyz"] as ReadonlyArray<string> }
    const server = yield* ServerProcess.start<never, never>(
      { hostname: "127.0.0.1", port: 0, password: "secret", database: { path: ":memory:" } },
      undefined,
      undefined,
      () => remote.urls,
    )
    const base = HttpServer.formatAddress(server.address)
    const info = () =>
      Effect.promise(() =>
        fetch(new URL("/api/info", base), { headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` } }).then(
          (response) => response.json() as Promise<{ urls: ReadonlyArray<string> }>,
        ),
      )

    expect((yield* info()).urls).toEqual([base, "https://example.opentunnel.xyz"])
    remote.urls = []
    expect((yield* info()).urls).toEqual([base])
  }),
)

it.live("MP03 managed boot owns one Schedule timer, catches missed updates, and releases it with its Scope", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const databasePath = `${directory.path}/host-schedule.db`
    const sessionID = Session.ID.create()
    const initial = (yield* DateTime.nowAsDate).getTime()
    const clock = yield* TestClock.make()
    yield* clock.setTime(initial)
    const minutePending = yield* Ref.make(0)
    const minuteStarts = yield* Ref.make<readonly number[]>([])
    const minuteEnds = yield* Ref.make<readonly number[]>([])
    const firstMinute = yield* Deferred.make<void>()
    // Workspace and LocationActivity also sleep for a minute; the named Effect frame identifies the Schedule owner.
    const trackedClock: Clock.Clock = {
      ...clock,
      sleep: (duration) =>
        Duration.toMillis(duration) !== 60_000
          ? clock.sleep(duration)
          : Effect.withFiber((fiber) => {
              let frame = fiber.cache.stackFrame
              while (frame && frame.name !== "ScheduleExecution.daemon") frame = frame.parent
              if (!frame) return clock.sleep(duration)
              return Effect.acquireUseRelease(
                Ref.update(minutePending, (count) => count + 1).pipe(
                  Effect.andThen(Ref.update(minuteStarts, (times) => [...times, clock.currentTimeMillisUnsafe()])),
                  Effect.andThen(Deferred.succeed(firstMinute, undefined)),
                ),
                () => clock.sleep(duration),
                () =>
                  Ref.update(minutePending, (count) => count - 1).pipe(
                    Effect.andThen(Ref.update(minuteEnds, (times) => [...times, clock.currentTimeMillisUnsafe()])),
                  ),
              )
            }),
    }
    // This separate Bus instance persists the same database but has no host re-arm subscribers.
    const writer = yield* Layer.build(
      Layer.fresh(
        AppNodeBuilder.build(
          LayerNode.group([Database.node, Bus.node, ScheduleService.node, ScheduleService.deliveryNode]),
          [
            Global.node.replace(tempGlobalLayer),
            Database.node.replace(Database.configured({ path: databasePath })),
            Bus.node.replace(Bus.configured({ persist: true })),
          ],
        ),
      ),
    )
    const database = Context.get(writer, Database.Service)
    const schedules = Context.get(writer, ScheduleService.Service)
    const deliveries = Context.get(writer, ScheduleService.DeliveryService)
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory.path), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: directory.path,
        title: "Host reminder owner",
        version: "keeper",
        mode: "coding",
      })
      .run()
      .pipe(Effect.orDie)
    const overdue = yield* schedules.createRule(
      new Schedule.Create({
        sessionID,
        kind: "reminder",
        content: "Overdue before host boot",
        dueAt: initial - 60_000,
        timezone: "UTC",
      }),
    )
    const options = {
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      database: { path: databasePath },
      events: { persist: true },
      models: { fetch: false },
      config: { directory: directory.path },
      fs: { filewatcher: false },
    }
    const firstScope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(firstScope, Exit.void))
    yield* ServerProcess.start<never, never>(options, { onListen: () => Effect.succeed(Effect.void) }).pipe(
      Effect.provideService(Scope.Scope, firstScope),
      Effect.provideService(Clock.Clock, trackedClock),
    )
    yield* awaitWithTimeout(Deferred.await(firstMinute), "The real host did not arm its minute timer")
    expect(yield* Ref.get(minutePending)).toBe(1)
    yield* pollWithTimeout(
      deliveries.listInbox(sessionID).pipe(Effect.map((rows) => (rows.length === 1 ? rows : undefined))),
      "The real host did not discover its overdue persisted reminder",
    )
    expect(yield* schedules.runs(overdue.id)).toHaveLength(1)

    const missed = yield* schedules.createRule(
      new Schedule.Create({
        sessionID,
        kind: "reminder",
        content: "Created on the other Bus",
        dueAt: initial + 1_000,
        timezone: "UTC",
      }),
    )
    expect(yield* deliveries.listInbox(sessionID)).toHaveLength(1)
    yield* clock.adjust("1 minute")
    yield* pollWithTimeout(
      deliveries.listInbox(sessionID).pipe(Effect.map((rows) => (rows.length === 2 ? rows : undefined))),
      "The minute scan did not discover the missed RuleUpdated event",
    )
    expect((yield* deliveries.listInbox(sessionID)).map((row) => row.content).toSorted()).toEqual([
      "Created on the other Bus",
      "Overdue before host boot",
    ])
    expect(yield* schedules.runs(missed.id)).toHaveLength(1)
    yield* pollWithTimeout(
      Ref.get(minutePending).pipe(Effect.map((count) => (count === 1 ? count : undefined))),
      "The host did not re-arm its single minute timer",
    ).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const boundary = {
            now: clock.currentTimeMillisUnsafe(),
            pending: yield* Ref.get(minutePending),
            starts: yield* Ref.get(minuteStarts),
            ends: yield* Ref.get(minuteEnds),
          }
          return yield* Effect.fail(
            new Error(`${error.message}; Schedule minute Clock boundary: ${JSON.stringify(boundary)}`),
          )
        }),
      ),
    )
    expect(yield* Ref.get(minutePending)).toBe(1)

    yield* Scope.close(firstScope, Exit.void)
    expect(yield* Ref.get(minutePending)).toBe(0)
    const stopped = yield* schedules.createRule(
      new Schedule.Create({
        sessionID,
        kind: "reminder",
        content: "Waiting for the next host",
        dueAt: initial + 60_000,
        timezone: "UTC",
      }),
    )
    yield* clock.adjust("1 minute")
    expect(yield* deliveries.listInbox(sessionID)).toHaveLength(2)
    expect((yield* schedules.getRule(stopped.id))?.status).toBe("pending")

    const secondScope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(secondScope, Exit.void))
    yield* ServerProcess.start<never, never>(options, { onListen: () => Effect.succeed(Effect.void) }).pipe(
      Effect.provideService(Scope.Scope, secondScope),
      Effect.provideService(Clock.Clock, trackedClock),
    )
    yield* pollWithTimeout(
      Ref.get(minutePending).pipe(Effect.map((count) => (count === 1 ? count : undefined))),
      "The replacement host did not own exactly one minute timer",
    )
    yield* pollWithTimeout(
      deliveries.listInbox(sessionID).pipe(Effect.map((rows) => (rows.length === 3 ? rows : undefined))),
      "The replacement host did not recover the stopped overdue reminder",
    )
    expect(yield* schedules.runs(overdue.id)).toHaveLength(1)
    expect(yield* schedules.runs(missed.id)).toHaveLength(1)
    expect(yield* schedules.runs(stopped.id)).toHaveLength(1)
    yield* Scope.close(secondScope, Exit.void)
    expect(yield* Ref.get(minutePending)).toBe(0)
  }),
)
