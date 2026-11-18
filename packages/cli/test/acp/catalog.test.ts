import { describe, expect, test } from "bun:test"
import { AigcForge } from "@aigcfroge/client/effect"
import { Model } from "@aigcfroge/schema/model"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { ACPCatalog } from "../../src/acp/catalog"
import { currentValue } from "./select-options"
import { rpcError, secondModel, startWire } from "./wire-fixture"

describe("acp catalog and config options over the wire", () => {
  test.each(["explicit variant", "group", "fallback"])("preserves the model catalog %s selection", async (mode) => {
    const preferred =
      mode === "group"
        ? Model.Selection.parse("group:fallback")
        : mode === "explicit variant"
          ? { ...Model.Ref.parse("test/test-model"), variant: Model.VariantID.make("high") }
          : undefined
    await using acp = await startWire({
      fetch: (request) => {
        if (request.path !== "/api/model/group") return
        return Response.json({
          location: { directory: "/workspace" },
          data: {
            targets: [],
            definitions: [],
            effective:
              mode === "group"
                ? [
                    {
                      groupID: "fallback",
                      definition: {
                        name: "Fallback",
                        enabled: true,
                        members: [Model.Ref.parse("test/test-model")],
                        strategy: "order",
                        affinity: "turn",
                      },
                    },
                  ]
                : [],
            ...(preferred ? { defaultSelection: preferred } : {}),
          },
        })
      },
    })
    const value = await Effect.runPromise(
      AigcForge.make({ baseUrl: acp.server.url }).pipe(
        Effect.flatMap(ACPCatalog.make),
        Effect.flatMap((catalog) => catalog.get("/workspace")),
        Effect.scoped,
        Effect.provide(FetchHttpClient.layer),
      ),
    )
    expect(value.defaultModel).toEqual(
      preferred ?? { ...Model.Ref.parse("test/test-model"), variant: Model.VariantID.make("default") },
    )
  })

  test("switches model, effort, and mode against the warm catalog", async () => {
    await using acp = await startWire()
    acp.server.catalog.models.push({ ...secondModel, providerID: "test/sub" })
    await acp.initialize()
    const sessionId = (await acp.newSession()).sessionId
    const set = (configId: string, value: string) =>
      acp.request("session/set_config_option", { sessionId, configId, value })

    const selectedModel = await set("model", "test/second-model")
    const selectedEffort = await set("effort", "medium")
    const selectedMode = await set("mode", "plan")
    await acp.request("session/set_mode", { sessionId, modeId: "build" })

    expect(currentValue(selectedModel, "model")).toBe("test/second-model")
    // This switch sends no variant; the effort control reports the implicit default.
    expect(currentValue(selectedModel, "effort")).toBe("implicit")
    expect(currentValue(selectedEffort, "effort")).toBe("medium")
    expect(currentValue(selectedMode, "mode")).toBe("plan")
    expect(acp.server.selections).toEqual([
      { sessionID: sessionId, model: { providerID: "test", id: secondModel.id } },
      { sessionID: sessionId, model: { providerID: "test", id: secondModel.id, variant: "medium" } },
      { sessionID: sessionId, agent: "plan" },
      { sessionID: sessionId, agent: "build" },
    ])

    expect(await rpcError(set("effort", "maximum"))).toMatchObject({ code: -32602, data: { effort: "maximum" } })
    expect(await rpcError(set("mode", "missing"))).toMatchObject({ code: -32602, data: { mode: "missing" } })
    expect(await rpcError(set("missing", "value"))).toMatchObject({ code: -32602, data: { configId: "missing" } })
    expect(await rpcError(set("model", "test/missing-model"))).toMatchObject({
      code: -32602,
      data: { modelId: "test/missing-model" },
    })
    const overlap = "test/sub/second-model"
    expect(currentValue(await set("model", overlap), "model")).toBe(overlap)
    expect(currentValue(await set("model", `${overlap}/low`), "effort")).toBe("low")
  })

  test("answers the first session after a cold location activates its plugins (#52729, #52472)", async () => {
    await using acp = await startWire()
    const plugins = acp.server.catalog.plugins.splice(0)
    acp.server.catalog.models.splice(1)
    await acp.initialize()
    const activated = Bun.sleep(200).then(() => {
      acp.server.catalog.plugins.push(...plugins)
      acp.server.catalog.models.push(secondModel)
    })

    const session = await acp.newSession()
    const selected = await acp.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })
    await activated

    expect(session.configOptions).toContainEqual(
      expect.objectContaining({
        id: "model",
        options: [
          { value: "test/second-model", name: "test/Second Model" },
          { value: "test/test-model", name: "test/Test Model" },
        ],
      }),
    )
    expect(currentValue(selected, "model")).toBe("test/second-model")
  })
})
