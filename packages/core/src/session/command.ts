export * as SessionCommand from "./command.js"

import type { PromptInput } from "@omnixa/schema/prompt-input"
import type { SessionInbox } from "@omnixa/schema/session-inbox"
import { Effect } from "effect"
import { Command } from "../command.js"
import { CompositionConsumerView } from "../composition/consumer-view.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { ProductModePolicy } from "../product-mode-policy.js"
import { Session } from "../session.js"
import { SessionComposition } from "./composition.js"

export const execute = Effect.fn("SessionCommand.execute")(function* (input: {
  session: Session.Info
  command: string
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  delivery?: SessionInbox.Delivery
}) {
  yield* ProductModePolicy.assertRuntimeSupported(input.session.mode)
  if (input.session.mode === "custom") {
    return yield* Effect.gen(function* () {
      const compositions = yield* SessionComposition.Service
      const selected = yield* SessionComposition.selectSessionAgent(compositions, input.session)
      const matches = CompositionConsumerView.getCommands(selected.snapshot, selected.scope).filter(
        (command) => command.name === input.command || command.invocation === input.command,
      )
      if (matches.length === 0)
        return yield* new Command.NotFoundError({
          command: input.command,
          message: `Command not found: ${input.command}`,
        })
      const command = matches[0]
      if (matches.length !== 1 || command === undefined)
        return yield* new Command.ExecutionError({
          command: input.command,
          message: "Frozen command name is ambiguous",
        })
      if (command.source === undefined)
        return yield* new Command.ExecutionError({
          command: input.command,
          message: "Frozen command body is unavailable",
        })
      // A Custom binding is an instruction template. Shell interpolation belongs
      // to ordinary configuration commands and cannot grant execution here.
      if (/!`[^`]+`/.test(command.source))
        return yield* new Command.ExecutionError({
          command: input.command,
          message: "Custom commands cannot interpolate shell commands",
        })
      const sessions = yield* Session.Service
      yield* sessions.prompt({
        sessionID: input.session.id,
        text: Command.interpolate(command.source, input.text),
        files: input.files,
        agents: input.agents,
        skills: input.skills,
        delivery: input.delivery ?? "steer",
      })
    }).pipe(
      Effect.catchTags({
        "SessionComposition.SnapshotNotFoundError": () =>
          new Command.ExecutionError({ command: input.command, message: "Custom command snapshot is unavailable" }),
        "SessionComposition.SnapshotDecodeError": () =>
          new Command.ExecutionError({ command: input.command, message: "Custom command snapshot is invalid" }),
        "SessionComposition.DependencyMissingError": (error) =>
          new Command.ExecutionError({
            command: input.command,
            message: `Custom command dependency is unavailable: ${error.reason}`,
          }),
        "SessionComposition.AgentDelegationForbiddenError": () =>
          new Command.ExecutionError({ command: input.command, message: "Custom command consumer is unavailable" }),
        "Composition.ResolveError": () =>
          new Command.ExecutionError({ command: input.command, message: "Custom command attachment is unavailable" }),
        "Session.AttachmentError": () =>
          new Command.ExecutionError({ command: input.command, message: "Command attachment is unavailable" }),
        "Session.SkillNotFoundError": () =>
          new Command.ExecutionError({ command: input.command, message: "Command Skill attachment is unavailable" }),
        "Session.PromptConflictError": () =>
          new Command.ExecutionError({ command: input.command, message: "Command prompt admission conflicted" }),
      }),
    )
  }
  const instances = yield* Instance.Service
  const commands = yield* Plugin.awaitActivation.pipe(Effect.andThen(Command.Service), instances.provide(input.session))
  yield* commands.execute({
    name: input.command,
    invocation: {
      sessionID: input.session.id,
      prompt: {
        text: input.text,
        files: input.files,
        agents: input.agents,
        skills: input.skills,
      },
      delivery: input.delivery ?? "steer",
    },
  })
})
