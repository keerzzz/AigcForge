import { Terminal } from "ghostty-web"
import { Predicate } from "effect"
import { SerializeAddon } from "../../../../gui-extensions/src/terminal/serialize"

export type TerminalProbe = {
  term?: Terminal
  writes: number
  pending: number
  bytes: number
  renders: number
  hiddenRenders: number
  draws: number
  hiddenDraws: number
  serialized: { ms: number; bytes: number; value: string }[]
}

declare global {
  interface Window {
    terminalProbe: TerminalProbe
  }
}

const probe: TerminalProbe = {
  writes: 0,
  pending: 0,
  bytes: 0,
  renders: 0,
  hiddenRenders: 0,
  draws: 0,
  hiddenDraws: 0,
  serialized: [],
}

window.terminalProbe = probe

const open = Terminal.prototype.open

Terminal.prototype.open = function (element) {
  probe.term = this
  open.call(this, element)
  // Ghostty does not expose render events. This benchmark-only wrapper observes its
  // actual renderer; it does not alter scheduling, parsing, or drawing.
  const renderer = this.renderer

  if (!renderer) throw new Error("missing terminal renderer")

  const render = renderer.render
  let hidden = false
  renderer.render = function (...args) {
    probe.renders++
    hidden = !element.checkVisibility()

    if (hidden) probe.hiddenRenders++

    return render.apply(this, args)
  }

  if (new URL(location.href).searchParams.has("terminalDrawProbe")) {
    const context = element.querySelector("canvas")!.getContext("2d")!

    const drawAt: (this: CanvasRenderingContext2D, image: CanvasImageSource, dx: number, dy: number) => void =
      context.drawImage

    const drawSized: (
      this: CanvasRenderingContext2D,
      image: CanvasImageSource,
      dx: number,
      dy: number,
      width: number,
      height: number,
    ) => void = context.drawImage

    const drawRegion: (
      this: CanvasRenderingContext2D,
      image: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => void = context.drawImage

    context.drawImage = function (
      ...args:
        | [CanvasImageSource, number, number]
        | [CanvasImageSource, number, number, number, number]
        | [CanvasImageSource, number, number, number, number, number, number, number, number]
    ) {
      probe.draws++

      if (hidden) probe.hiddenDraws++

      if (args.length === 3) return drawAt.call(this, ...args)

      if (args.length === 5) return drawSized.call(this, ...args)

      return drawRegion.call(this, ...args)
    }
  }
}

const write = Terminal.prototype.write

Terminal.prototype.write = function (data, done) {
  probe.writes++
  probe.pending++
  probe.bytes += Predicate.isString(data) ? new TextEncoder().encode(data).byteLength : data.byteLength

  return write.call(this, data, () => {
    probe.pending--
    done?.()
  })
}

const serialize = SerializeAddon.prototype.serialize

SerializeAddon.prototype.serialize = function (options) {
  const start = performance.now()
  const value = serialize.call(this, options)
  probe.serialized.push({ ms: performance.now() - start, bytes: new TextEncoder().encode(value).byteLength, value })

  return value
}
