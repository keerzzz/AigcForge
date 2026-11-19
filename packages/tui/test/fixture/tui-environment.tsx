/** @jsxImportSource @opentui/solid */
import {
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  type TuiPaths,
} from "../../src/context/runtime"
import type { ParentProps } from "solid-js"
import { LogProvider, type LogSink } from "../../src/context/log"
import { ClipboardProvider, type ClipboardService } from "../../src/context/clipboard"

const clipboard: ClipboardService = {
  async read() {
    return undefined
  },
  async write() {},
}

export function TestTuiContexts(
  props: ParentProps<{
    cwd?: string
    directory?: string
    paths?: Partial<TuiPaths>
    log?: LogSink
    clipboard?: ClipboardService
  }>,
) {
  return (
    <LogProvider log={props.log ?? (() => {})}>
      <TuiPathsProvider
        value={{
          cwd: props.cwd ?? props.directory ?? "/tmp/aigcfroge/packages/tui",
          home: "/tmp/aigcfroge/home",
          state: "/tmp/aigcfroge/state",
          worktree: "/tmp/aigcfroge",
          ...props.paths,
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: false }}>
            <ClipboardProvider value={props.clipboard ?? clipboard}>{props.children}</ClipboardProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    </LogProvider>
  )
}
