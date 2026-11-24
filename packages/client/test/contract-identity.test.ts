import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "@omnixa/schema/agent"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { Config } from "@omnixa/schema/config"
import { Model } from "@omnixa/schema/model"
import { Prompt } from "@omnixa/schema/prompt"
import { Session } from "@omnixa/schema/session"
import { SessionMessage } from "@omnixa/schema/session-message"
import { SkillAsset } from "@omnixa/schema/skill-asset"
import { Vcs } from "@omnixa/schema/vcs"

const Client = await import("../src/effect")

test("effect entrypoint exposes canonical Schema contracts", () => {
  expect(Client.Agent).toBe(Agent)
  expect(Client.AssetPlacement).toBe(AssetPlacement)
  expect(Client.Config).toBe(Config)
  expect(Client.Model).toBe(Model)
  expect(Client.Session).toBe(Session)
  expect(Client.SkillAsset).toBe(SkillAsset)
  expect(Client.Vcs.Base).toBe(Vcs.Base)
})

test("generated Effect API names canonical and composed outputs", async () => {
  const source = await Bun.file(new URL("../src/effect/api/api.ts", import.meta.url)).text()

  expect(source).toContain("export type SessionGetOutput = Session.Info")
  expect(source).toContain("export type EventSubscribeOutput = OmnixaEvent")
  expect(source).toContain("export type SkillAssetInspectOutput = SkillAsset.Inspection")
  expect(source).toContain("export type SkillAssetContentOutput = SkillAsset.Info")
  expect(source).toContain("export type SkillAssetApplyOutput = SkillAsset.Info")
  expect(source).toContain("readonly target?: AssetPlacement.Target")
  expect(source).not.toContain("HttpApiClient.ForApi")
})

test("shared DTO schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
})
