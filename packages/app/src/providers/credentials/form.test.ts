import { describe, expect, test } from "bun:test"
import { validateCustomProvider } from "./form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("validates a connection preview before a display name or manual model is entered", () => {
    const result = validateCustomProvider({
      intent: "preview",
      form: {
        providerID: "custom-provider",
        name: "",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "create",
        credentialID: "saved-credential",
        apiKey: " new-draft-key ",
        models: [{ row: "m0", id: "", name: "", err: {} }],
        headers: [],
        err: {},
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result?.key).toBe("new-draft-key")
    expect(result.result?.credentialAction).toBe("create")
    expect(result.err.name).toBeUndefined()
    expect(result.models).toEqual([{}])
    expect(result.result?.definition).not.toHaveProperty("models")
  })

  test("builds a trimmed native provider definition and environment reference", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        protocol: "chat",
        credentialAction: "create",
        credentialID: "",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      credentialAction: "keep",
      credentialID: "",
      definition: {
        package: "@aigcfroge/ai/providers/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        settings: {
          baseURL: "https://api.example.com",
        },
        headers: {
          "X-Test": "enabled",
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
      unset: [],
    })
  })

  test("flags duplicate rows and allows editing the same provider", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "messages",
        credentialAction: "create",
        credentialID: "",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      editingProviderID: "custom-provider",
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test.each([
    ["chat", "@aigcfroge/ai/providers/openai-compatible"],
    ["responses", "@aigcfroge/ai/providers/openai-compatible/responses"],
    ["messages", "@aigcfroge/ai/providers/anthropic-compatible"],
  ] as const)("uses the native %s package and keeps a blank key", (protocol, packageName) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol,
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        models: [{ row: "m0", id: "model-a", name: "", err: {} }],
        headers: [],
        err: {},
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result?.definition).toEqual({
      package: packageName,
      name: "Provider",
      settings: { baseURL: "https://api.example.com" },
      models: { "model-a": {} },
    })
    expect(result.result?.credentialAction).toBe("keep")
    expect(result.result?.key).toBeUndefined()
  })

  test("emits explicit deletions for removed authored models and headers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "use",
        credentialID: "credential-a",
        apiKey: "",
        models: [{ row: "m0", id: "model-a", name: "New name", err: {} }],
        headers: [{ row: "h0", key: "X-Keep", value: "kept", err: {} }],
        err: {},
      },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
      definition: {
        models: { "model-a": { name: "Old name" }, "model-b": { name: "Remove" } },
        headers: { "X-Keep": "kept", "X-Remove": "remove" },
      },
    })

    expect(result.result?.unset).toEqual([
      ["models", "model-b"],
      ["headers", "X-Remove"],
    ])
    expect(result.result?.credentialAction).toBe("use")
    expect(result.result?.credentialID).toBe("credential-a")
  })

  test.each([
    {
      overrides: {
        tools: "unsupported" as const,
        context: "64000",
        compatibility: '{"requireReasoning":false}',
        cost: '{"input":0,"output":0}',
      },
      error: undefined,
    },
    { overrides: { context: "1.5" }, error: "context" as const },
    { overrides: { compatibility: '{"maxTokensField":"invalid"}' }, error: "compatibility" as const },
    { overrides: { cost: '{"input":0}' }, error: "cost" as const },
  ])("parses authored overrides at the form boundary: $error", ({ overrides, error }) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [{ row: "m0", id: "model-a", name: "", overrides, err: {} }],
      },
      t,
      existingProviderIDs: new Set(),
    })

    if (error) {
      expect(result.result).toBeUndefined()
      expect(result.models[0]?.[error]).toBeDefined()

      return
    }

    expect(result.result?.definition.models?.["model-a"]).toMatchObject({
      capabilities: { tools: false },
      limit: { context: 64000 },
      compatibility: { requireReasoning: false },
      cost: { input: 0, output: 0 },
    })
    expect(result.result?.definition.models?.["model-a"]).not.toHaveProperty("name")
  })

  test("keeps a redacted header and model alias when editing unrelated fields", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Edited Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        models: [{ row: "m0", configID: "friendly-alias", id: "actual-model", name: "Model", err: {} }],
        headers: [{ row: "h0", key: "Authorization", configKey: "Authorization", value: "", redacted: true, err: {} }],
        err: {},
      },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
      definition: { models: { "friendly-alias": { modelID: "actual-model", name: "Model" } } },
      redactedPaths: [["headers", "Authorization"]],
    })

    expect(result.result?.definition.models).toEqual({ "friendly-alias": { modelID: "actual-model", name: "Model" } })
    expect(result.result?.definition).not.toHaveProperty("headers")
    expect(result.result?.unset).toEqual([])
  })

  test("writes a dated quote from authored prices and keeps raw upstream model IDs", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [
          {
            row: "m0",
            configID: "route",
            id: "group/reasoning",
            name: "",
            err: {},
            overrides: {
              cost: '{"input":2,"output":8,"cache":{"read":0.5}}',
              quoteValidFrom: "1970-01-01T00:00:01.000Z",
              quoteValidUntil: "1970-01-01T00:00:02.000Z",
            },
          },
        ],
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result?.definition.models?.route).toEqual({
      modelID: "group/reasoning",
      quote: {
        status: "known",
        prices: [{ input: 2, output: 8, cache: { read: 0.5, write: 0 } }],
        validFrom: 1_000,
        validUntil: 2_000,
      },
    })
  })

  test.each([
    {
      overrides: { cost: '{"input":2,"output":8}', quoteValidFrom: "invalid-date" },
      error: "provider.model.override.invalidQuoteDate",
    },
    { overrides: { quoteValidFrom: "1970-01-01T00:00:01.000Z" }, error: "provider.model.override.quoteNeedsPrice" },
  ])("validates quote dates at the authored form boundary: $error", ({ overrides, error }) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [{ row: "m0", id: "model", name: "", overrides, err: {} }],
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0]?.quoteValidFrom).toBe(error)
  })

  test("clears a quote date with the original unset operation and retains unchanged price provenance", () => {
    const prices = [{ input: 2, output: 8, cache: { read: 0.5, write: 1 } }]

    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "responses",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [
          {
            row: "m0",
            configID: "alias",
            id: "provider/model",
            name: "",
            err: {},
            overrides: {
              cost: JSON.stringify(prices, null, 2),
              quoteValidFrom: "1970-01-01T00:00:01.000Z",
              quoteValidUntil: "",
            },
          },
        ],
      },
      definition: {
        models: {
          alias: {
            cost: { input: 99, output: 99 },
            quote: {
              status: "known",
              prices,
              source: "saved-price-source",
              observedAt: 500,
              validFrom: 1_000,
              validUntil: 2_000,
            },
          },
        },
      },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.result?.definition.models?.alias?.quote).toEqual({
      status: "known",
      prices,
      source: "saved-price-source",
      observedAt: 500,
      validFrom: 1_000,
      validUntil: undefined,
    })
    expect(result.result?.definition.models?.alias).not.toHaveProperty("cost")
    expect(result.result?.unset).toEqual([
      ["models", "alias", "cost"],
      ["models", "alias", "quote", "validUntil"],
    ])
  })

  test.each(["known", "free"] as const)(
    "retains the explicit %s status when editing an empty quote's date",
    (status) => {
      const result = validateCustomProvider({
        form: {
          providerID: "custom-provider",
          name: "Provider",
          baseURL: "https://api.example.com",
          protocol: "chat",
          credentialAction: "keep",
          credentialID: "",
          apiKey: "",
          headers: [],
          err: {},
          models: [
            {
              row: "m0",
              id: "model",
              name: "",
              err: {},
              overrides: { cost: "[]", quoteValidFrom: "1970-01-01T00:00:01.000Z" },
            },
          ],
        },
        definition: { models: { model: { quote: { status, prices: [] } } } },
        t,
        existingProviderIDs: new Set(["custom-provider"]),
        editingProviderID: "custom-provider",
      })

      expect(result.models[0]?.quoteValidFrom).toBeUndefined()
      expect(result.result?.definition.models?.model?.quote).toEqual({
        status,
        prices: [],
        validFrom: 1_000,
        validUntil: undefined,
      })
    },
  )

  test("preserves an explicit unknown quote and restores automatic pricing only on request", () => {
    const input = {
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat" as const,
        credentialAction: "keep" as const,
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [
          {
            row: "m0",
            id: "model",
            name: "",
            err: {},
            overrides: { cost: "", quoteValidFrom: "", quoteValidUntil: "" },
          },
        ],
      },
      definition: { models: { model: { quote: { status: "unknown" as const } } } },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    }

    expect(validateCustomProvider(input).result?.unset).toEqual([])
    expect(
      validateCustomProvider({
        ...input,
        form: {
          ...input.form,
          models: input.form.models.map((model) => ({ ...model, overrides: { ...model.overrides, quoteReset: true } })),
        },
      }).result?.unset,
    ).toEqual([["models", "model", "quote"]])
  })

  test("keeps discovered quote validity in the seed until a date is authored", () => {
    const seed = {
      identity: {
        providerID: "custom-provider",
        listURL: "https://api.example.com/models",
        protocol: "openai" as const,
        auth: "bearer" as const,
        configurationDigest: "source",
      },
      inventoryDigest: "inventory",
      observedAt: 500,
      metadata: {
        quote: {
          status: "known" as const,
          prices: [{ input: 2, output: 8, cache: { read: 0, write: 0 } }],
          validFrom: 1_000,
          validUntil: 2_000,
        },
      },
    }

    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: [{ row: "m0", id: "model", name: "", seed, overrides: { context: "64000" }, err: {} }],
      },
      t,
      existingProviderIDs: new Set(),
    })

    expect(result.result?.definition.models?.model).toMatchObject({ seed, limit: { context: 64000 } })
    expect(result.result?.definition.models?.model).not.toHaveProperty("quote")
  })

  test.each([
    {
      models: [
        { configID: "alias-a", id: "same-api" },
        { configID: "alias-b", id: "same-api" },
      ],
      duplicate: false,
    },
    { models: [{ configID: "alias-a", id: "actual-api" }, { id: "alias-a" }], duplicate: true },
  ])("validates the stored model keys: $duplicate", ({ models, duplicate }) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        headers: [],
        err: {},
        models: models.map((model, index) => ({ ...model, row: String(index), name: "Model", err: {} })),
      },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.models[1]?.id).toBe(duplicate ? "provider.custom.error.duplicate" : undefined)
    expect(result.result !== undefined).toBe(!duplicate)
  })

  test.each([
    { envNames: "FIRST_KEY, SECOND_KEY", env: ["FIRST_KEY", "SECOND_KEY"], unset: [] },
    { envNames: "", env: undefined, unset: [["env"]] },
  ])("edits authored environment references: $envNames", ({ envNames, env, unset }) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        protocol: "chat",
        credentialAction: "keep",
        credentialID: "",
        apiKey: "",
        envNames,
        headers: [],
        err: {},
        models: [{ row: "m0", id: "model-a", name: "Model", err: {} }],
      },
      t,
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
      definition: { env: ["FIRST_KEY", "SECOND_KEY"] },
    })

    expect(result.result?.definition.env).toEqual(env)
    expect(result.result?.unset).toEqual(unset)
    expect(result.result?.credentialAction).toBe("keep")
  })
})
