import { describe, expect, test } from "bun:test"
import { Agent } from "@aigcfroge/schema/agent"
import { Model } from "@aigcfroge/schema/model"
import { Provider } from "@aigcfroge/schema/provider"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Session } from "@aigcfroge/schema/session"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { Effect, Schema } from "effect"
import type { Catalog } from "../../src/acp/catalog"
import {
  configOptions,
  currentModel,
  parseModelSelection,
  resolveChange,
  selectionFromSession,
} from "../../src/acp/config-option"
import { currentValue } from "./select-options"

const model = (providerID: string, id: string, name: string, variants: string[] = []) => ({
  ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
  name,
  variants: variants.map((variant) => ({ id: Model.VariantID.make(variant) })),
})

const catalog: Catalog = {
  models: [
    model("anthropic", "claude/sonnet-4", "Claude Sonnet 4", ["default", "high", "very-high"]),
    model("anthropic", "claude-haiku", "Claude Haiku"),
    model("openai", "gpt-5", "GPT-5", ["minimal", "low"]),
    model("test", "effort", "Effort", ["low", "default", "high"]),
  ],
  defaultModel: { providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") },
  modes: [{ id: Agent.ID.make("build"), name: "Build" }],
  defaultModeID: Agent.ID.make("build"),
  commands: [],
}

const rootController = Schema.decodeUnknownSync(Schema.toCodecJson(Session.Controller))({
  kind: "root",
  metaAgentID: "mag_acp",
  rootSessionID: "ses_meta",
})

const executorCatalog = {
  ...catalog,
  executors: [
    { id: Agent.ID.make("worker"), name: "Worker" },
    { id: Agent.ID.make("explore"), name: "Explore" },
  ],
}

const effortOption = (providerID: string, id: string) =>
  configOptions(catalog, {
    model: {
      providerID: Provider.ID.make(providerID),
      id: Model.ID.make(id),
      variant: Model.VariantID.make("missing"),
    },
  }).find((option) => option.id === "effort")

describe("acp config options", () => {
  test.each(["coding", "work", "custom", undefined] as const)(
    "projects ordinary Agent and Executor choices for Session mode %s",
    (mode) => {
      const choices = [
        { id: Agent.ID.make("authored"), name: "Authored", ordinaryModes: ["custom"] as const },
        { id: Agent.ID.make("build"), name: "Build", ordinaryModes: ProductMode.ID.literals },
        { id: Agent.ID.make("legacy"), name: "Legacy" },
      ]
      const projected: Catalog = {
        ...catalog,
        modes: choices,
        executors: choices,
        defaultModeID: Agent.ID.make("authored"),
      }
      const expected =
        mode === "custom"
          ? [
              { value: "authored", name: "Authored" },
              { value: "build", name: "Build" },
              { value: "legacy", name: "Legacy" },
            ]
          : [
              { value: "build", name: "Build" },
              { value: "legacy", name: "Legacy" },
            ]
      const fresh = configOptions(projected, { mode })
      expect(fresh.find((option) => option.id === "mode")).toMatchObject({
        currentValue: mode === "custom" ? "authored" : "build",
        options: expected,
      })
      const selection = selectionFromSession({
        mode: mode ?? ProductMode.Default,
        agent: Agent.ID.make("meta"),
        model: catalog.defaultModel,
        controller: rootController,
        executorPreference: new Session.ExecutorPreference({ agent: Agent.ID.make("build") }),
      })
      expect(selection.mode).toBe(mode ?? ProductMode.Default)
      expect(configOptions(projected, selection).find((option) => option.id === "executor")).toMatchObject({
        currentValue: "build",
        options: expected,
      })
    },
  )

  test("preserves mode-ineligible saved Agent and Executor selections as unavailable", () => {
    const authored = { id: Agent.ID.make("authored"), name: "Authored", ordinaryModes: ["custom"] as const }
    const projected: Catalog = { ...catalog, modes: [...catalog.modes, authored], executors: [authored] }
    expect(
      configOptions(projected, { mode: "coding", modeID: authored.id }).find((option) => option.id === "mode"),
    ).toMatchObject({
      currentValue: "authored",
      options: [
        { value: "build", name: "Build" },
        { value: "authored", name: "authored", description: "Unavailable Agent; saved selection" },
      ],
    })
    expect(
      configOptions(projected, {
        mode: "coding",
        modeID: Agent.ID.make("meta"),
        controller: rootController,
        executorPreference: new Session.ExecutorPreference({ agent: authored.id }),
      }).find((option) => option.id === "executor"),
    ).toMatchObject({
      currentValue: "authored",
      options: [{ value: "authored", name: "authored", description: "Unavailable executor; saved preference" }],
    })
  })

  test("selects logical Groups independently for Session and executor and omits physical effort controls", async () => {
    const group = Model.Selection.parse("group:fallback")
    const grouped: Catalog = {
      ...executorCatalog,
      groups: [
        new ModelGroup.Current({
          groupID: Model.GroupID.make("fallback"),
          definition: new ModelGroup.Definition({
            name: "Fast fallback",
            enabled: true,
            members: [Model.Ref.parse("openai/gpt-5")],
            strategy: "order",
            affinity: "turn",
          }),
        }),
      ],
    }
    const selection = {
      modeID: Agent.ID.make("meta"),
      controller: rootController,
      model: group,
      executorPreference: new Session.ExecutorPreference({ agent: Agent.ID.make("worker"), model: group }),
    }
    const options = configOptions(grouped, selection)
    expect(currentValue({ configOptions: options }, "model")).toBe("group:fallback")
    expect(currentValue({ configOptions: options }, "executor-model")).toBe("group:fallback")
    expect(options.some((option) => option.id === "effort" || option.id === "executor-effort")).toBe(false)
    expect(options.find((option) => option.id === "model")).toMatchObject({
      options: expect.arrayContaining([{ value: "group:fallback", name: "Fast fallback", description: "Model group" }]),
    })
    expect(await Effect.runPromise(resolveChange(grouped, {}, "model", "group:fallback"))).toEqual({ model: group })
    expect(await Effect.runPromise(resolveChange(grouped, selection, "executor-model", "group:fallback"))).toEqual({
      executorPreference: selection.executorPreference,
    })
    await expect(Effect.runPromise(resolveChange(grouped, selection, "effort", "high"))).rejects.toThrow()
    expect(parseModelSelection("group:vendor/chat", grouped.models)).toEqual(Model.Ref.parse("group:vendor/chat"))
  })

  test("retains a saved unavailable Group without replacing it with a physical default", async () => {
    const group = Model.Selection.parse("group:removed")
    const options = configOptions(catalog, { model: group })
    expect(currentValue({ configOptions: options }, "model")).toBe("group:removed")
    expect(currentModel(catalog, { model: group })).toEqual(group)
    expect(await Effect.runPromise(resolveChange(catalog, { model: group }, "model", "group:removed"))).toEqual({
      model: group,
    })
    await expect(Effect.runPromise(resolveChange(catalog, {}, "model", "group:removed"))).rejects.toThrow()
  })

  test("retains an unavailable saved variant beside the available and implicit values", () => {
    expect(effortOption("test", "effort")).toEqual({
      id: "effort",
      name: "Effort",
      description: "Available effort levels for this model",
      category: "thought_level",
      type: "select",
      currentValue: "missing",
      options: [
        { value: "low", name: "Low" },
        { value: "default", name: "Default" },
        { value: "high", name: "High" },
        { value: "implicit", name: "Implicit default" },
        { value: "missing", name: "Missing" },
      ],
    })
    expect(effortOption("openai", "gpt-5")?.currentValue).toBe("missing")
  })

  test.each([
    ["openai/gpt-5", { providerID: Provider.ID.openai, id: Model.ID.make("gpt-5") }],
    [
      "openai/gpt-5/low",
      { providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("low") },
    ],
    ["anthropic/claude/sonnet-4", { providerID: Provider.ID.anthropic, id: Model.ID.make("claude/sonnet-4") }],
    [
      "anthropic/claude/sonnet-4/high",
      {
        providerID: Provider.ID.anthropic,
        id: Model.ID.make("claude/sonnet-4"),
        variant: Model.VariantID.make("high"),
      },
    ],
    [
      "anthropic/claude/sonnet-4/missing",
      { providerID: Provider.ID.anthropic, id: Model.ID.make("claude/sonnet-4/missing") },
    ],
  ])("parses the model selection %s, preferring exact slash-containing model ids", (value, expected) => {
    expect(parseModelSelection(value, catalog.models)).toEqual(expected)
  })
  test("projects actual Agent selection beside separate delegation model and effort controls", () => {
    const selection = {
      modeID: Agent.ID.make("meta"),
      model: parseModelSelection("test/effort/high", catalog.models),
      controller: rootController,
      executorPreference: new Session.ExecutorPreference({
        agent: Agent.ID.make("worker"),
        model: parseModelSelection("openai/gpt-5/low", catalog.models),
      }),
    }
    const options = configOptions(executorCatalog, selection)
    expect(currentValue({ configOptions: options }, "model")).toBe("test/effort")
    expect(currentValue({ configOptions: options }, "effort")).toBe("high")
    expect(currentValue({ configOptions: options }, "mode")).toBe("meta")
    expect(currentValue({ configOptions: options }, "executor")).toBe("worker")
    expect(currentValue({ configOptions: options }, "executor-model")).toBe("openai/gpt-5")
    expect(currentValue({ configOptions: options }, "executor-effort")).toBe("low")
    expect(currentModel(executorCatalog, selection)).toEqual(selection.model)
    expect(options.find((option) => option.id === "model")).toMatchObject({ name: "Model" })
    expect(options.find((option) => option.id === "executor")).toMatchObject({
      name: "Executor",
      options: [
        { value: "worker", name: "Worker" },
        { value: "explore", name: "Explore" },
      ],
    })
  })

  test("keeps unavailable saved selections and does not invent an executor when preference is unset", async () => {
    const missing = { modeID: Agent.ID.make("meta"), controller: rootController }
    expect(currentModel(executorCatalog, missing)).toBeUndefined()
    expect(configOptions(executorCatalog, missing).find((option) => option.id === "model")).toMatchObject({
      currentValue: "",
      options: expect.arrayContaining([{ value: "", name: "Unavailable model" }]),
    })
    await expect(Effect.runPromise(resolveChange(executorCatalog, missing, "effort", "default"))).rejects.toMatchObject(
      {
        _tag: "ACPInvalidEffortError",
      },
    )
    expect(currentModel(executorCatalog, { modeID: Agent.ID.make("meta") })).toEqual(catalog.defaultModel)
    expect(currentModel(executorCatalog, { ...missing, modeID: Agent.ID.make("build") })).toEqual(catalog.defaultModel)
    const unset = configOptions(executorCatalog, {
      modeID: Agent.ID.make("meta"),
      controller: rootController,
      model: catalog.defaultModel,
    })
    expect(currentValue({ configOptions: unset }, "mode")).toBe("meta")
    expect(currentValue({ configOptions: unset }, "executor")).toBe("")
    expect(currentValue({ configOptions: unset }, "executor-model")).toBe("inherit")
    expect(currentValue({ configOptions: unset }, "executor-effort")).toBe("inherit")
    const unavailable = configOptions(executorCatalog, {
      modeID: Agent.ID.make("meta"),
      controller: rootController,
      model: catalog.defaultModel,
      executorPreference: new Session.ExecutorPreference({
        agent: Agent.ID.make("removed"),
        model: {
          providerID: Provider.ID.make("missing"),
          id: Model.ID.make("saved"),
          variant: Model.VariantID.make("saved"),
        },
      }),
    })
    expect(unavailable.find((option) => option.id === "executor")).toMatchObject({
      currentValue: "removed",
      options: expect.arrayContaining([
        { value: "removed", name: "removed", description: "Unavailable executor; saved preference" },
      ]),
    })
    expect(unavailable.find((option) => option.id === "executor-model")).toMatchObject({
      currentValue: "missing/saved",
      options: expect.arrayContaining([
        { value: "missing/saved", name: "missing/saved", description: "Unavailable model; saved selection" },
      ]),
    })
    expect(unavailable.find((option) => option.id === "executor-effort")).toMatchObject({
      currentValue: "saved",
      options: expect.arrayContaining([{ value: "saved", name: "Saved" }]),
    })
  })

  test("projects the immutable child binding with one option per control", () => {
    const controller = Schema.decodeUnknownSync(Schema.toCodecJson(Session.Controller))({
      kind: "child",
      metaAgentID: "mag_acp",
      rootSessionID: "ses_meta",
      executor: { agent: "worker", model: { providerID: "openai", id: "gpt-5", variant: "low" }, source: "preference" },
      source: { kind: "task", delegationID: "dlg_acp", participantID: "par_acp" },
    })
    const selection = {
      mode: ProductMode.Default,
      modeID: Agent.ID.make("worker"),
      model: parseModelSelection("openai/gpt-5/low", catalog.models),
      controller,
    }
    const adoptedCatalog = {
      ...executorCatalog,
      executors: executorCatalog.executors.map((agent) => ({
        ...agent,
        ordinaryModes: ["custom"] as const,
      })),
    }
    expect(configOptions(adoptedCatalog, selection)).toMatchObject([
      { id: "model", currentValue: "openai/gpt-5", options: [{ value: "openai/gpt-5", name: "openai/gpt-5" }] },
      { id: "effort", currentValue: "low", options: [{ value: "low", name: "Low" }] },
      { id: "mode", currentValue: "worker", options: [{ value: "worker", name: "Worker" }] },
    ])
  })

  test("keeps a catalog variant named implicit distinct from the implicit default option", async () => {
    const catalog = {
      ...executorCatalog,
      models: [model("test", "effort", "Effort", ["implicit", "implicit:", "default"])],
    }
    const ref = { providerID: Provider.ID.make("test"), id: Model.ID.make("effort") }
    const selection = {
      modeID: Agent.ID.make("meta"),
      model: ref,
      controller: rootController,
      executorPreference: new Session.ExecutorPreference({ agent: Agent.ID.make("worker"), model: ref }),
    }
    for (const id of ["effort", "executor-effort"]) {
      const option = configOptions(catalog, selection).find((option) => option.id === id)
      expect(option).toMatchObject({
        currentValue: "implicit::",
        options: expect.arrayContaining([
          { value: "implicit::", name: "Implicit default" },
          { value: "implicit", name: "Implicit" },
        ]),
      })
      const chosen = await Effect.runPromise(resolveChange(catalog, selection, id, "implicit"))
      const implicit = await Effect.runPromise(resolveChange(catalog, selection, id, "implicit::"))
      expect(chosen).toMatchObject(
        id === "effort"
          ? { model: { ...ref, variant: "implicit" } }
          : { executorPreference: { model: { ...ref, variant: "implicit" } } },
      )
      expect(implicit).toMatchObject(id === "effort" ? { model: ref } : { executorPreference: { model: ref } })
      const selected =
        implicit && "model" in implicit
          ? implicit.model
          : implicit && "executorPreference" in implicit
            ? implicit.executorPreference?.model
            : undefined
      if (!selected || Model.Selection.isGroup(selected))
        throw new Error("The implicit variant fixture requires a physical model")
      expect(selected.variant).toBeUndefined()
    }
  })

  test("advertises different Session and delegation values for raw undefined and literal default", () => {
    const refs = [undefined, Model.VariantID.make("default")].map((variant) => ({
      providerID: Provider.ID.make("test"),
      id: Model.ID.make("effort"),
      variant,
    }))
    const selections = refs.map((model) => ({
      modeID: Agent.ID.make("meta"),
      model,
      controller: rootController,
      executorPreference: new Session.ExecutorPreference({ agent: Agent.ID.make("worker"), model }),
    }))
    expect(
      selections.map((selection) =>
        currentValue({ configOptions: configOptions(executorCatalog, selection) }, "effort"),
      ),
    ).toEqual(["implicit", "default"])
    expect(
      selections.map((selection) =>
        currentValue({ configOptions: configOptions(executorCatalog, selection) }, "executor-effort"),
      ),
    ).toEqual(["implicit", "default"])
    selections.forEach((selection) => {
      expect(configOptions(executorCatalog, selection).find((option) => option.id === "effort")).toMatchObject({
        options: expect.arrayContaining([
          { value: "implicit", name: "Implicit default" },
          { value: "default", name: "Default" },
        ]),
      })
    })
  })

  test.each(["build", "plan", "meta"])("mode selects the actual %s Agent on a historical root", async (value) => {
    const modes = ["plan", "build", "meta"].map((id) => ({ id: Agent.ID.make(id), name: id }))
    const ordered = { ...executorCatalog, modes, defaultModeID: Agent.ID.make("plan") }
    const selection = {
      modeID: Agent.ID.make("build"),
      controller: rootController,
      model: catalog.defaultModel,
      executorPreference: new Session.ExecutorPreference({ agent: Agent.ID.make("worker") }),
    }
    const options = configOptions(ordered, selection)
    expect(options.find((option) => option.id === "mode")).toMatchObject({
      currentValue: "build",
      options: modes.map((mode) => ({ value: mode.id, name: mode.name })),
    })
    expect(options.some((option) => option.id.startsWith("executor"))).toBe(false)
    expect(currentValue({ configOptions: configOptions(ordered, {}) }, "mode")).toBe("plan")
    expect(await Effect.runPromise(resolveChange(ordered, selection, "mode", value))).toEqual({
      modeID: Agent.ID.make(value),
    })
  })
})
