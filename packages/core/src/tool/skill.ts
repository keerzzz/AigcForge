export * as SkillTool from "./skill"

import path from "path"
import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Option, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { CompositionCatalog } from "../skill/composition-catalog"
import { SkillV2 } from "../skill"
import { PermissionV2 } from "../permission"
import { SessionComposition } from "../session/composition"
import { TaskDriver } from "./task-driver"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "skill"
const FILE_LIMIT = 10

export const Input = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from the available skills list" }),
})

export const Output = Schema.Struct({
  name: Schema.String,
  directory: Schema.String,
  output: Schema.String,
})

export const description = [
  "Load a specialized skill when the task at hand matches one of the available skills in the system context.",
  "",
  "Use this tool to inject the skill's instructions and resources into the current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc. in the same directory as the skill.",
  "",
  "The skill name must match one of the available skills in the system context.",
].join("\n")

export const toModelOutput = (skill: SkillV2.Info, files: ReadonlyArray<string>) => {
  const directory = path.dirname(skill.location)
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${directory}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n")
}

const unableToLoad = (name: string, error?: unknown) =>
  new ToolFailure({ message: `Unable to load skill ${name}`, error })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const skills = yield* SkillV2.Service
    const permission = yield* PermissionV2.Service
    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              // Snapshot-local lookup in Custom Mode (MEDIUM-2a): the candidate set
              // is the session snapshot's skill catalog, never the global list.
              // TaskDriver is a process-global bridge installed by the composition
              // root; harnesses that never install it only run non-custom sessions,
              // so a missing bridge keeps the legacy global catalog. Post-install
              // sessionMode self-catches lookup failures, so the only reachable
              // defect here is the missing bridge.
              const mode = yield* TaskDriver.sessionMode(context.sessionID).pipe(
                Effect.catchDefect(() => Effect.succeed(undefined)),
              )
              const current = yield* Effect.gen(function* () {
                if (mode !== "custom") return yield* skills.list()
                const composition = yield* Effect.serviceOption(SessionComposition.Service)
                if (Option.isNone(composition)) {
                  return yield* new ToolFailure({ message: "Custom session snapshot service unavailable" })
                }
                const snapshot = yield* composition.value
                  .read(context.sessionID)
                  .pipe(
                    Effect.catchTag("SessionComposition.SnapshotDecodeError", (error) =>
                      Effect.fail(
                        new ToolFailure({ message: `Failed to decode custom session snapshot: ${error.details}` }),
                      ),
                    ),
                  )
                if (!snapshot) return yield* new ToolFailure({ message: "Custom session snapshot not found" })
                return CompositionCatalog.createCompositionSkillCatalog(snapshot.data.skills, yield* skills.list())
              })
              const skill = current.find((skill) => skill.name === input.name)
              if (!skill) return yield* unableToLoad(input.name)
              return yield* Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: [skill.name],
                  save: [skill.name],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const directory = path.dirname(skill.location)
                const files =
                  path.basename(skill.location) === "SKILL.md"
                    ? (yield* fs.glob("**/*", { cwd: directory, absolute: true, include: "file", dot: true }))
                        .filter((file) => path.basename(file) !== "SKILL.md")
                        .toSorted()
                        .slice(0, FILE_LIMIT)
                    : []
                return {
                  name: skill.name,
                  directory,
                  output: toModelOutput(skill, files),
                }
              }).pipe(Effect.mapError((error) => unableToLoad(input.name, error)))
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
