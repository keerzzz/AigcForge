type Input = {
  prevScrollWidth: number
  scrollWidth: number
  clientWidth: number
  prevLeadOpen: boolean
  leadOpen: boolean
}

/** A tab that opens at the lead of the strip scrolls to the start; other new tabs scroll to the end. */
export const nextTabStripScrollLeft = (input: Input) => {
  if (input.scrollWidth <= input.prevScrollWidth) return

  if (!input.prevLeadOpen && input.leadOpen) return 0

  if (input.scrollWidth <= input.clientWidth) return

  return input.scrollWidth - input.clientWidth
}

export const createTabStripScroll = (input: {
  el: HTMLDivElement
  lead: () => boolean
  onOverflowChange?: (state: { overflow: boolean; previous: boolean; next: boolean }) => void
}) => {
  let frame: number | undefined
  let prevClientWidth = input.el.clientWidth
  let prevScrollWidth = input.el.scrollWidth
  let prevLeadOpen = input.lead()

  const notify = () => {
    const max = Math.max(0, input.el.scrollWidth - input.el.clientWidth)

    const offset = Math.max(
      0,
      Math.min(getComputedStyle(input.el).direction === "rtl" ? -input.el.scrollLeft : input.el.scrollLeft, max),
    )

    input.onOverflowChange?.({
      // The full strip decides overflow; the arrows must not keep themselves visible by taking up width.
      overflow: input.el.scrollWidth > (input.el.parentElement?.clientWidth ?? input.el.clientWidth),
      previous: offset > 0,
      next: offset < max,
    })
  }

  const update = () => {
    const scrollWidth = input.el.scrollWidth
    const clientWidth = input.el.clientWidth
    const leadOpen = input.lead()

    const left = nextTabStripScrollLeft({
      prevScrollWidth,
      scrollWidth,
      clientWidth,
      prevLeadOpen,
      leadOpen,
    })

    if (left !== undefined) {
      input.el.scrollTo({
        left,
        behavior: "smooth",
      })
    }

    // Resizing can clip the selected tab without adding a tab or increasing scrollWidth.
    if (clientWidth !== prevClientWidth) {
      const selected = input.el.querySelector('[role="tab"][aria-selected="true"]')?.parentElement
      const bounds = selected?.getBoundingClientRect()
      const viewport = input.el.getBoundingClientRect()

      if (bounds && bounds.right > viewport.right) input.el.scrollLeft += bounds.right - viewport.right

      if (bounds && bounds.left < viewport.left) input.el.scrollLeft += bounds.left - viewport.left
    }

    prevClientWidth = clientWidth
    prevScrollWidth = scrollWidth
    prevLeadOpen = leadOpen
    notify()
  }

  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }

  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    input.el.scrollLeft += e.deltaY > 0 ? 50 : -50
    e.preventDefault()
  }

  input.el.addEventListener("wheel", onWheel, { passive: false })
  input.el.addEventListener("scroll", notify)
  const observer = new MutationObserver(schedule)
  observer.observe(input.el, { childList: true })
  const resize = new ResizeObserver(schedule)
  resize.observe(input.el)

  return () => {
    input.el.removeEventListener("wheel", onWheel)
    input.el.removeEventListener("scroll", notify)
    observer.disconnect()
    resize.disconnect()

    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
