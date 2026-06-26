import { run as runTui, type TuiInput } from "@aigcfroge/tui"
import { Global } from "@aigcfroge/core/global"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(Global.defaultLayer))
}
