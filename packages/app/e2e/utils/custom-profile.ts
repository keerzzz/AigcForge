import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Schema } from "effect"
import { CustomCompositionFixture } from "./custom-composition"

export const revision = "a".repeat(64)

export function info(
  root: Composition.BuiltinRoot["id"] = "build",
  input: {
    name?: string
    description?: string
    relativePath?: string
    revision?: string
    profile?: Partial<CustomProfile.Profile>
  } = {},
) {
  const preview = CustomCompositionFixture.plan(root)

  return Schema.decodeUnknownSync(Schema.toCodecJson(CustomProfile.Info))({
    kind: "custom-profile",
    name: input.name ?? "Saved build 中文",
    description: input.description ?? "Saved profile description",
    relativePath: input.relativePath ?? "saved-build.yaml",
    revision: input.revision ?? revision,
    profile: {
      kind: "custom-profile",
      root: preview.input.source === "temporary" ? preview.input.root : undefined,
      agents: [],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
      mcpBindings: [],
      ...input.profile,
      name: input.name ?? "Saved build 中文",
      description: input.description ?? "Saved profile description",
    },
  })
}

export function infoAnswer(value: CustomProfile.Info) {
  return { status: 200, body: Schema.encodeSync(Schema.toCodecJson(CustomProfile.Info))(value) }
}

export function listAnswer(profiles: CustomProfile.Info[]) {
  return {
    status: 200,
    body: {
      assets: profiles.map((profile) =>
        Schema.encodeSync(Schema.toCodecJson(CustomProfile.Summary))(
          new CustomProfile.Summary({
            kind: profile.kind,
            name: profile.name,
            description: profile.description,
            relativePath: profile.relativePath,
            revision: profile.revision,
          }),
        ),
      ),
      invalid: [],
    },
  }
}

export function plan(profile: CustomProfile.Info, input: Parameters<typeof CustomCompositionFixture.plan>[1] = {}) {
  const root = profile.profile.root

  if (root?.source !== "builtin" || !root.revision) throw new Error("Profile fixture requires a captured builtin root")

  return new Composition.Plan({
    ...CustomCompositionFixture.plan(root.id, { revision: root.revision, ...input }),
    input: new Composition.ProfileInput({
      source: "profile",
      profilePath: profile.relativePath,
      profileRevision: Composition.Revision.make(profile.revision),
    }),
  })
}

export function startAnswer(
  input: Composition.StartInput,
  directory: string,
  value: Composition.Plan,
  profile: CustomProfile.Info,
  projectID = "proj_custom_composition",
) {
  const root = profile.profile.root

  if (root?.source !== "builtin" || !root.revision) throw new Error("Profile fixture requires a captured builtin root")

  const answer = CustomCompositionFixture.startAnswer(
    input,
    directory,
    CustomCompositionFixture.plan(root.id, { revision: root.revision, digest: value.digest }),
    projectID,
  )

  const response = Schema.decodeUnknownSync(Schema.toCodecJson(Composition.StartResponse))(answer.body)

  if (response.snapshot.version !== 2) throw new Error("Profile fixture requires a V2 snapshot")

  return {
    status: 200,
    body: Schema.encodeSync(Schema.toCodecJson(Composition.StartResponse))(
      new Composition.StartResponse({
        ...response,
        snapshot: new Composition.SnapshotV2({
          ...response.snapshot,
          profilePath: profile.relativePath,
          profileRevision: Composition.Revision.make(profile.revision),
        }),
      }),
    ),
  }
}

export * as CustomProfileFixture from "./custom-profile"
