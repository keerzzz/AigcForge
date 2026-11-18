import { expect, test } from "bun:test"
import path from "node:path"
import { createModelPreferenceRepository, decodeModelPreference, modelPreferenceKey, sameModelSelection, toModelPreference, toModelSelection } from "../src/model-preference"
import { tmpdir } from "./fixture/fixture"

test("repairs known model preferences and preserves unrelated fields", () => {
  expect(
    decodeModelPreference({
      unrelated: { keep: true },
      recent: [{ providerID: "openai", modelID: "gpt-5", ignored: true }, null],
      favorite: "malformed",
      variant: { "openai/gpt-5": "high", default: "default", invalid: 42 },
    }),
  ).toEqual({
    unrelated: { keep: true },
    recent: [{ providerID: "openai", modelID: "gpt-5" }],
    favorite: [],
    variant: { "openai/gpt-5": "high", default: "default" },
  })
})

test("atomically serializes model preference updates", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  await Bun.write(file, JSON.stringify({ unrelated: "keep", favorite: [], variant: {} }))
  const repository = createModelPreferenceRepository(file)
  const openai = { providerID: "openai", modelID: "org/gpt-5" }
  const anthropic = { providerID: "anthropic", modelID: "claude/sonnet" }

  await Promise.all([
    repository.addRecent(openai),
    repository.saveVariant(openai, "high"),
    repository.saveVariant(anthropic, "low"),
  ])
  expect(await Bun.file(file).json()).toEqual({
    unrelated: "keep",
    recent: [openai],
    favorite: [],
    variant: { "openai/org/gpt-5": "high", "anthropic/claude/sonnet": "low" },
  })

  await repository.saveVariant(openai, "default")
  expect(await repository.resolveVariant(openai)).toBeUndefined()
  expect((await Bun.file(file).json()).variant).toEqual({
    "openai/org/gpt-5": "default",
    "anthropic/claude/sonnet": "low",
  })
})

test("persists Groups beside physical preferences and keeps member variants separate", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  const group = { type: "group" as const, groupID: "fallback" }
  const physical = { providerID: "group:vendor", modelID: "chat" }
  const repository = createModelPreferenceRepository(file)
  await repository.addRecent(physical)
  await repository.addRecent(group)
  await repository.addRecent(group)
  await repository.setFavorite(group, true)
  await repository.saveVariant(group, "high")
  expect(await repository.load()).toEqual({ recent: [group, physical], favorite: [group], variant: {} })
  expect(await repository.resolveVariant(group)).toBeUndefined()
  expect(modelPreferenceKey(group)).toBe("group:fallback")
  expect(modelPreferenceKey(physical)).toBe("group:vendor/chat")
  expect(toModelSelection(group, "high")).toEqual(group)
  expect(toModelPreference(group)).toEqual(group)
  expect(sameModelSelection(group, { type: "group", groupID: "other" })).toBe(false)
  expect(sameModelSelection({ providerID: "test", id: "chat" }, { providerID: "test", id: "chat", variant: "default" })).toBe(true)
  expect(decodeModelPreference({ recent: [group, { type: "group", groupID: "bad/name" }], favorite: [group] }).recent).toEqual([group])
})
