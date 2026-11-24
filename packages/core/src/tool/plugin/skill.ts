export * as SkillTool from "./skill.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Result, Schema } from "effect"
import { FSUtil } from "@omnixa/util/fs-util"
import { CompositionConsumerView } from "../../composition/consumer-view.js"
import { Location } from "../../location.js"
import { SessionComposition } from "../../session/composition.js"
import { SessionStore } from "../../session/store.js"
import { CompositionCatalog } from "../../skill/composition-catalog.js"
import { Skill } from "../../skill.js"
import { Permission } from "../../permission.js"

export const name = "skill"

export const Input = Schema.Struct({
  id: Skill.ID.annotate({ description: "The ID of an available skill or a skill explicitly referenced by the user" }),
})

export const Output = Schema.Struct({
  name: Skill.Name,
  directory: Schema.String,
  output: Schema.String,
})
export const description = [
  "Load a specialized skill's instructions and resources into the current conversation when the task at hand matches its description.",
  "",
  "The skill ID must match an available skill or a skill explicitly referenced by the user.",
].join("\n")

export const toModelOutput = Skill.toModelOutput

const unableToLoad = (name: string, error?: unknown) =>
  new ToolFailure({ message: `Unable to load skill ${name}`, error })

export const Plugin = {
  id: "omnixa.tool.skill",
  effect: Effect.fn("SkillTool.Plugin")(function* (ctx: Context) {
    const fs = yield* FSUtil.Service
    const skills = yield* Skill.Service
    const permission = yield* Permission.Service
    const sessions = yield* SessionStore.Service
    const composition = yield* SessionComposition.Service
    const location = yield* Location.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(context.sessionID)
              const skill = yield* Effect.gen(function* () {
                if (
                  session?.mode !== "custom" &&
                  !(session?.controller?.kind === "child" && session.controller.source.kind === "workflow")
                )
                  return yield* skills.get(input.id)
                if (
                  session.location.directory !== location.directory ||
                  session.location.workspaceID !== location.workspaceID
                )
                  return yield* unableToLoad(input.id)
                const selected = yield* composition.selectAgent(session.id, context.agent)
                const frozen = CompositionCatalog.frozenSkills(
                  location.directory,
                  CompositionConsumerView.getSkills(selected.snapshot, selected.scope),
                )
                if (Result.isFailure(frozen)) return yield* unableToLoad(input.id, frozen.failure)
                return frozen.success.find((skill) => skill.id === input.id)
              }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)))
              if (!skill) return yield* unableToLoad(input.id)
              return yield* Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: [skill.id],
                  save: [skill.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
                return { name: skill.name, ...(yield* Skill.prepare(fs, skill)) }
              }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)))
            }).pipe(
              Effect.map((output) => ({
                output,
                content: output.output,
                metadata: { name: output.name, directory: output.directory },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
