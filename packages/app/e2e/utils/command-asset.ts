import type { Page } from "@playwright/test"
import type { CommandAssetInfo, CommandAssetListOutput, JsonValue, SessionMessageInfo } from "@aigcfroge/client/promise"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { Schema } from "effect"
import { SkillAssets } from "./skill-asset"

export function body(name = " Ｒｅｖｉｅｗ ") {
  return {
    name,
    description: "Review the actual change",
    invocation: "/review-alias",
    args: "target",
    source: "Inspect $ARGUMENTS.",
  }
}

export function facts(relativePath = "Review.md") {
  return SkillAssets.facts(relativePath)
}

export function info(revision: string, source = body().source, target?: CommandAssetInfo["target"]): CommandAssetInfo {
  const asset: CommandAssetInfo = {
    kind: "command",
    ...body(),
    source,
    relativePath: "Review.md",
    revision: revision.repeat(64),
  }

  if (target) asset.target = target

  return asset
}

export function catalog(asset: CommandAssetInfo): CommandAssetListOutput {
  const result: CommandAssetListOutput = {
    assets: [Schema.encodeSync(CommandAsset.Summary)(Schema.decodeUnknownSync(CommandAsset.Summary)(asset))],
    invalid: [],
  }

  if (asset.target) result.target = asset.target

  return result
}

export function inspection(call: SkillAssets.Call, target: NonNullable<CommandAssetInfo["target"]>): SkillAssets.Reply {
  const input = Schema.decodeUnknownSync(
    Schema.Struct({ candidate: CommandAsset.Candidate, scope: AssetPlacement.Scope }),
  )(call.body)

  return { status: 200, json: { ...facts(input.candidate.relativePath), target } }
}

export function history(
  label: string,
  input: Record<string, JsonValue> = body(),
  metadata: Record<string, JsonValue> | null = facts(),
): SessionMessageInfo[] {
  return SkillAssets.history(label, input, metadata, "command")
}

export function mock(
  page: Page,
  input: Omit<Parameters<typeof SkillAssets.mock>[1], "kind"> & {
    inspect: (call: SkillAssets.Call, attempt: number) => SkillAssets.Reply | Promise<SkillAssets.Reply>
  },
) {
  return SkillAssets.mock(page, { ...input, kind: "command" })
}

export * as CommandAssets from "./command-asset"
