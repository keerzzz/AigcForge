export * as ShellResult from "./result.js"

import { Shell } from "@aigcfroge/schema/shell"
import { Hash } from "@aigcfroge/util/hash"
import { Schema } from "effect"

export type Result = {
  info: Shell.Info
  capture: { output: string; truncated: boolean } | undefined
}

type Output = { output: string; truncated: boolean; exit?: number; signal?: string; timeout?: boolean; commandResult?: Shell.CommandResult }

const missing = "Shell command output is no longer available."
export const unavailable: Shell.Output = {
  output: missing,
  cursor: Buffer.byteLength(missing),
  size: Buffer.byteLength(missing),
  truncated: false,
}

export function output(result: Result): Output {
  return {
    output: result.capture?.output ?? unavailable.output,
    truncated: result.capture?.truncated ?? false,
    ...(result.info.exit !== undefined ? { exit: result.info.exit } : {}),
    ...(result.info.signal !== undefined ? { signal: result.info.signal } : {}),
    ...(result.info.status === "timeout" ? { timeout: true } : {}),
    ...(result.capture !== undefined && result.info.time.completed !== undefined ? { commandResult: {
      id: result.info.id,
      command: result.info.command,
      cwd: result.info.cwd,
      exit: result.info.exit,
      signal: result.info.signal,
      timeout: result.info.status === "timeout",
      truncated: result.capture.truncated,
      outputDigest: Hash.sha256(result.capture.output),
      started: result.info.time.started,
      completed: result.info.time.completed,
    } } : {}),
  }
}

export function notice(output: Pick<Output, "exit" | "signal" | "timeout">) {
  if (output.timeout) return "Timed out before completion"
  if (output.signal !== undefined) return `Killed by ${output.signal}`
  if (output.exit !== undefined && output.exit !== 0) return `Exited with code ${output.exit}`
}

export function metadata(output: Output) {
  return {
    truncated: output.truncated,
    ...(output.exit !== undefined ? { exit: output.exit } : {}),
    ...(output.signal !== undefined ? { signal: output.signal } : {}),
    ...(output.timeout !== undefined ? { timeout: output.timeout } : {}),
    ...(output.commandResult !== undefined ? { commandResult: Schema.encodeSync(Shell.CommandResult)(output.commandResult) } : {}),
  }
}

export function notification(input: {
  shellID: string
  jobID?: string
  command: string
  state: "completed" | "cancelled" | "error"
  text: string
  output?: Output
}) {
  return {
    text: `<shell id="${input.jobID ?? input.shellID}" state="${input.state}" command="${input.command}">\n${input.text}\n</shell>`,
    metadata: {
      source: "shell",
      shellID: input.shellID,
      ...(input.jobID !== undefined ? { jobID: input.jobID } : {}),
      state: input.state,
      ...(input.output ? metadata(input.output) : {}),
    },
  }
}

export function userNotification(result: Result) {
  const captured = output(result)
  const status =
    result.info.status === "killed"
      ? "Cancelled"
      : captured.exit === 0
        ? undefined
        : (notice(captured) ?? "Exited with code unknown")
  const message = notification({
    shellID: result.info.id,
    command: result.info.command,
    state: result.info.status === "killed" ? "cancelled" : "completed",
    text: [captured.output, status].filter((item) => item !== undefined && item !== "").join("\n\n"),
    output: captured,
  })
  return { ...message, text: `The following shell command was executed by the user:\n${message.text}` }
}
