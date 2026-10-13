import { NodeServices } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { callAuthProbe, disposeApps } from "./httpapi-exercise/backend"
import { http } from "./httpapi-exercise/dsl"
import { parseOptions } from "./httpapi-exercise/routing"
import { runScenario } from "./httpapi-exercise/runner"
import { runtime } from "./httpapi-exercise/runtime"

const it = testEffect(Layer.mergeAll(NodeServices.layer, TestLLMServer.layer))

;[false, true].forEach((prepared) => {
  it.live(
    prepared ? "auth probes prepare a real authorized response" : "auth probes reject an authorized timeout",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const modules = yield* Effect.promise(runtime)
        const app = yield* Layer.buildWithMemoMap(modules.AppLayer, modules.memoMap, yield* Effect.scope)
        yield* modules.InstanceStore.Service.use((store) => store.load({ directory })).pipe(Effect.provide(app))
        let pending = false
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // The legacy TUI queue cannot cancel a waiter when its HTTP request aborts.
            if (pending) modules.Tui.submitTuiRequest({ path: "/auth-probe-cleanup", body: null })
            yield* Effect.promise(disposeApps)
            yield* modules.InstanceStore.Service.use((store) => store.disposeAll()).pipe(Effect.provide(app))
          }),
        )
        const preparations: string[] = []
        const probe = {
          path: "/tui/control/next",
          headers: { "x-aigcfroge-directory": directory },
          ...(prepared
            ? {
                prepare: () =>
                  Effect.sync(() => {
                    preparations.push("queued")
                    modules.Tui.submitTuiRequest({ path: "/auth-probe", body: { verified: true } })
                  }),
              }
            : {}),
        }
        const scenario = http.protected.get("/tui/control/next", "auth-probe").probe(probe).status(200)
        if (prepared) {
          expect(yield* callAuthProbe(scenario, "missing").pipe(Effect.timeout("2 seconds"))).toMatchObject({
            status: 401,
            timedOut: false,
          })
          expect(preparations).toEqual([])
          pending = true
          const response = yield* callAuthProbe(scenario, "valid").pipe(Effect.timeout("2 seconds"))
          pending = false
          expect(response).toMatchObject({ status: 200, timedOut: false })
          expect(preparations).toEqual(["queued"])
          return
        }
        pending = true
        const result = yield* runScenario(parseOptions(["--mode", "auth", "--scenario-timeout", "2 seconds"]))(scenario)
        expect(result.status).toBe("fail")
        if (result.status !== "fail") return
        expect(result.message).toContain("scenario timed out")
      }),
  )
})
