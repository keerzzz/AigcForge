export type StartupMark = { label: string; ms: number }

type PerfSink = (label: string, ms: number) => void

const startupMarks: StartupMark[] = []
let sink: PerfSink = () => {}
let replayed = 0

export function perf(label: string): StartupMark {
  const mark: StartupMark = { label, ms: performance.now() }
  startupMarks.push(mark)
  sink(mark.label, mark.ms)
  return mark
}

export function getStartupMarks(): StartupMark[] {
  return [...startupMarks]
}

export function resetStartupMarks() {
  startupMarks.length = 0
  replayed = 0
}

export function setPerfSink(next: PerfSink) {
  sink = next
  // Replay marks recorded before the sink was wired (e.g. `before-whenReady`
  // fires before `initLogging` makes the log transport ready).
  for (; replayed < startupMarks.length; replayed++) {
    const mark = startupMarks[replayed]
    sink(mark.label, mark.ms)
  }
}
