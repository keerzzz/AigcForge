export type StartupMark = { label: string; ms: number }

type PerfSink = (label: string, ms: number) => void

const startupMarks: StartupMark[] = []
let sink: PerfSink = () => {}

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
}

export function setPerfSink(next: PerfSink) {
  sink = next
}
