import type { Page } from "@playwright/test"
import type { JsonValue, PromptAssetInfo, PromptAssetListOutput, SessionMessageInfo } from "@aigcfroge/client/promise"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { Schema } from "effect"
import { SkillAssets } from "./skill-asset"

export function body() {
  return { name: "Review", description: "Review the change", template: "Review {{target}}.\nKeep $ARGUMENTS literal." }
}

export function info(
  revision: string,
  template = body().template,
  target?: PromptAssetInfo["target"],
): PromptAssetInfo {
  const input = {
    kind: "prompt",
    ...body(),
    template,
    relativePath: "Review.md",
    revision: revision.repeat(64),
  }

  if (target) Object.assign(input, { target })

  return Schema.encodeSync(PromptAsset.Info)(Schema.decodeUnknownSync(PromptAsset.Info)(input))
}

export function target(scope: AssetPlacement.Scope, root: string) {
  return Schema.encodeSync(AssetPlacement.Target)(Schema.decodeUnknownSync(AssetPlacement.Target)({ scope, root }))
}

export function catalog(asset: PromptAssetInfo): PromptAssetListOutput {
  const result = {
    assets: [Schema.encodeSync(PromptAsset.Summary)(Schema.decodeUnknownSync(PromptAsset.Summary)(asset))],
    invalid: [],
  }

  if (asset.target) Object.assign(result, { target: asset.target })

  return result
}

export function inspection(
  call: SkillAssets.Call,
  target: NonNullable<PromptAssetInfo["target"]>,
  current?: PromptAssetInfo,
): SkillAssets.Reply {
  const input = Schema.decodeUnknownSync(
    Schema.Struct({ candidate: PromptAsset.Candidate, scope: AssetPlacement.Scope }),
  )(call.body)

  return {
    status: 200,
    json: Schema.encodeSync(PromptAsset.Inspection)(
      Schema.decodeUnknownSync(PromptAsset.Inspection)({
        ...SkillAssets.facts(input.candidate.relativePath),
        exists: current !== undefined,
        revision: current?.revision ?? null,
        target,
      }),
    ),
  }
}

export function history(
  label: string,
  input: Record<string, JsonValue> = body(),
  metadata: Record<string, JsonValue> | null = SkillAssets.facts(),
): SessionMessageInfo[] {
  return SkillAssets.history(label, input, metadata, "prompt")
}

export function mock(
  page: Page,
  input: Omit<Parameters<typeof SkillAssets.mock>[1], "kind"> & {
    inspect: (call: SkillAssets.Call, attempt: number) => SkillAssets.Reply | Promise<SkillAssets.Reply>
  },
) {
  return SkillAssets.mock(page, { ...input, kind: "prompt" })
}

export * as PromptAssets from "./prompt-asset"
