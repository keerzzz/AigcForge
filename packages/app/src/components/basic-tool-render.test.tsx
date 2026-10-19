import { afterEach, describe, expect, test } from "bun:test"
import { onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { render } from "solid-js/web"
import { BasicTool } from "@aigcfroge/session-ui/basic-tool"
import { Part, renderable } from "@aigcfroge/session-ui/message-part"
import { DataProvider } from "@aigcfroge/session-ui/context/data"
import { I18nProvider, type UiI18n } from "@aigcfroge/ui/context/i18n"
import type { AssistantMessage, QuestionV2Info, SessionTaskInfo, ToolPart } from "@aigcfroge/sdk/v2"

const cleanups: Array<() => void> = []

function mount(component: () => JSX.Element) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(component, container)
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return container
}

afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
})

describe("AI-TDD-S05-R01 production BasicTool semantic icons", () => {
  // Permission surfaces use warning/shield, not an invented permission glyph.
  test.each([
    "glasses",
    "bullet-list",
    "magnifying-glass-menu",
    "window-cursor",
    "console",
    "terminal",
    "task",
    "brain",
    "checklist",
    "bubble-5",
    "code-lines",
    "mcp",
    "help",
    "warning",
    "shield",
  ] as const)("renders the existing %s glyph and hides its decoration from assistive technology", (name) => {
    const container = mount(() => <BasicTool icon={name} trigger={{ title: "Tool invocation" }} />)
    const svg = container.querySelector('[data-slot="basic-tool-tool-indicator"] [data-slot="icon-svg"]')
    expect(svg !== null).toBe(true)
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.querySelector("use")?.getAttribute("href")).toBe(`#aigcfroge-icon-${name}`)
    expect(
      Boolean(document.getElementById(`aigcfroge-icon-${name}`)?.querySelector("path, circle, rect, line, polyline")),
    ).toBe(true)
  })
})

describe("AI-TDD-S05-R02 production BasicTool disclosure semantics", () => {
  test.each([undefined, null, false, "", "   "])("does not make an empty child %p expandable", (child) => {
    const container = mount(() => (
      <BasicTool icon="console" trigger={{ title: "Empty call" }}>
        {child}
      </BasicTool>
    ))
    expect(container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
  })

  test("hideDetails does not evaluate or mount its withheld body", () => {
    const mounts: string[] = []
    const Body = () => {
      mounts.push("constructed")
      return <pre>Hidden details</pre>
    }
    const container = mount(() => (
      <BasicTool icon="console" hideDetails trigger={{ title: "Hidden call" }}>
        <Body />
      </BasicTool>
    ))
    expect(mounts).toEqual([])
    expect(container.querySelectorAll("pre, button, [aria-expanded]").length).toBe(0)
  })

  test("zero is real detail content rather than an empty child", () => {
    const container = mount(() => (
      <BasicTool icon="console" trigger={{ title: "Zero output" }}>
        {0}
      </BasicTool>
    ))
    expect(container.querySelectorAll('button[data-slot="collapsible-trigger"]').length).toBe(1)
  })

  test("does not offer an expansion button for a completed row without details", () => {
    const container = mount(() => (
      <BasicTool icon="glasses" status="completed" trigger={{ title: "Read", subtitle: "src/example.ts" }} />
    ))
    expect(container.textContent).toContain("Read")
    expect(container.querySelectorAll("button, [role=button], [aria-expanded]").length).toBe(0)
  })

  test("does not turn an empty conditional child into a disclosure", () => {
    const container = mount(() => (
      <BasicTool icon="mcp" status="completed" trigger={{ title: "No output" }}>
        <Show when={false}>
          <pre>Not available</pre>
        </Show>
      </BasicTool>
    ))
    expect(container.querySelectorAll("button, [role=button], [aria-expanded]").length).toBe(0)
    expect(container.textContent).not.toContain("Not available")
  })

  test("does not offer an expansion button when details are explicitly hidden", () => {
    const container = mount(() => (
      <BasicTool icon="brain" status="completed" hideDetails trigger={{ title: "Skill" }}>
        <pre>Hidden details</pre>
      </BasicTool>
    ))
    expect(container.textContent).toContain("Skill")
    expect(container.querySelectorAll("button, [role=button], [aria-expanded]").length).toBe(0)
    expect(container.textContent).not.toContain("Hidden details")
  })

  test.each(["pending", "running"] as const)("does not offer a fake expansion while %s without content", (status) => {
    const container = mount(() => <BasicTool icon="console" status={status} trigger={{ title: "Shell" }} />)
    expect(container.textContent).toContain("Shell")
    expect(container.querySelectorAll("button, [role=button], [aria-expanded]").length).toBe(0)
  })

  test("keeps a named, operable disclosure for a completed row with content", () => {
    const container = mount(() => (
      <BasicTool icon="console" status="completed" trigger={{ title: "Shell output" }}>
        <pre>{"first line\nlast line"}</pre>
      </BasicTool>
    ))
    const trigger = container.querySelector<HTMLButtonElement>('button[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    expect(trigger?.textContent).toContain("Shell output")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    trigger?.click()
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector('[data-slot="collapsible-content"]')?.textContent).toContain("last line")
    trigger?.click()
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
  })

  test("a details row points aria-controls at the content element it actually renders", async () => {
    const container = mount(() => (
      <BasicTool icon="console" trigger={{ title: "Shell output" }}>
        <pre>first line</pre>
      </BasicTool>
    ))
    const trigger = container.querySelector<HTMLButtonElement>('button[data-slot="collapsible-trigger"]')
    if (!trigger) throw new Error("Expected the real disclosure trigger")
    trigger.click()
    await waitForDom(
      container,
      () => {
        const controls = trigger.getAttribute("aria-controls")
        return !!controls && document.getElementById(controls)?.getAttribute("data-slot") === "collapsible-content"
      },
      "aria-controls resolves to the rendered content element",
    )
    const controls = trigger.getAttribute("aria-controls")
    if (!controls) throw new Error("Expected the disclosure's content identity")
    expect(document.getElementById(controls)?.textContent).toContain("first line")
  })

  test("a no-details row keeps a real action as a native control without aria-expanded", () => {
    const clicks: string[] = []
    const container = mount(() => (
      <>
        <BasicTool icon="help" trigger={{ title: "Open help" }} onTriggerClick={() => clicks.push("help")} />
        <BasicTool icon="task" trigger={{ title: "Open child" }} triggerHref="/child-session" />
      </>
    ))
    const button = container.querySelector<HTMLButtonElement>('button[data-component="tool-trigger-button"]')
    const link = container.querySelector<HTMLAnchorElement>('a[data-component="tool-trigger-link"]')
    expect(button !== null).toBe(true)
    expect(link !== null).toBe(true)
    expect(button?.type).toBe("button")
    expect(button?.hasAttribute("aria-expanded")).toBe(false)
    expect(link?.getAttribute("href")).toBe("/child-session")
    expect(link?.hasAttribute("aria-expanded")).toBe(false)
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(0)
    button?.click()
    expect(clicks).toEqual(["help"])
  })

  test("a conditional body becomes expandable without any status change", () => {
    const [state, setState] = createStore({ ready: false })
    const container = mount(() => (
      <BasicTool icon="mcp" trigger={{ title: "Conditional invocation" }}>
        <Show when={state.ready}>
          <pre>Later content</pre>
        </Show>
      </BasicTool>
    ))
    expect(container.querySelectorAll("button, [role=button], [aria-expanded]").length).toBe(0)
    setState("ready", true)
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    trigger?.click()
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("pre")?.textContent).toBe("Later content")
  })
})

describe("AI-TDD-S05-R03 no-details rows retain real actions", () => {
  test("preserves triggerHref and its click handler without disabling the real link", () => {
    const clicks: string[] = []
    const container = mount(() => (
      <BasicTool
        icon="task"
        trigger={{ title: "Open child session" }}
        triggerHref="/child-session"
        onTriggerClick={(event) => {
          event.preventDefault()
          clicks.push("navigate")
        }}
      />
    ))
    const link = container.querySelector<HTMLAnchorElement>('a[href="/child-session"]')
    expect(link !== null).toBe(true)
    expect(link?.hasAttribute("disabled")).toBe(false)
    expect(link?.getAttribute("aria-disabled")).not.toBe("true")
    link?.click()
    expect(clicks).toEqual(["navigate"])
  })

  test("keeps a custom trigger's inner link active when details are hidden", () => {
    const clicks: string[] = []
    const container = mount(() => (
      <BasicTool
        icon="window-cursor"
        hideDetails
        trigger={
          <a
            href="https://example.com/tool-result"
            onClick={(event) => {
              event.preventDefault()
              clicks.push("open")
            }}
          >
            Open result
          </a>
        }
      />
    ))
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/tool-result"]')
    expect(link !== null).toBe(true)
    expect(link?.closest("[disabled], [aria-disabled=true]") === null).toBe(true)
    link?.click()
    expect(clicks).toEqual(["open"])
  })

  test("does not drop an explicit trigger action just because there are no details", () => {
    const clicks: string[] = []
    const container = mount(() => (
      <BasicTool icon="help" trigger={{ title: "Open help" }} onTriggerClick={() => clicks.push("help")} />
    ))
    const button = container.querySelector<HTMLButtonElement>("button")
    expect(button !== null).toBe(true)
    button?.click()
    expect(clicks).toEqual(["help"])
  })
})

function waitForDom(container: HTMLElement, ready: () => boolean, description: string) {
  const result = Promise.withResolvers<void>()
  const observer = new MutationObserver(check)
  // This is a failure deadline; only the observed DOM condition resolves the wait.
  const timeout = setTimeout(() => {
    observer.disconnect()
    result.reject(new Error(`DOM readiness deadline: ${description}`))
  }, 5_000)
  // Deferred bodies commit on a frame; the emulated DOM can miss a reinserted-node mutation.
  const frame = requestAnimationFrame(check)
  function stop() {
    cancelAnimationFrame(frame)
    observer.disconnect()
    clearTimeout(timeout)
  }
  function check() {
    if (!ready()) return
    stop()
    result.resolve()
  }
  observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true })
  cleanups.push(stop)
  check()
  return result.promise
}

function toolPart(tool: string, state: ToolPart["state"]): ToolPart {
  return {
    id: `prt_component_${tool}`,
    sessionID: "ses_component_tools",
    messageID: "msg_component_tools",
    callID: `call_component_${tool}`,
    type: "tool",
    tool,
    state,
  }
}

type ToolIdentity = Pick<ToolPart, "sessionID" | "messageID" | "callID">

function mountToolPart(
  part: ToolPart,
  options: {
    defaultOpen?: boolean
    deferToolContent?: boolean
    toolOpen?: () => boolean | undefined
    onToolOpenChange?: (open: boolean) => void
    visible?: () => boolean
    onQuestionAction?: (part: ToolIdentity) => (() => void) | undefined
    i18n?: UiI18n
  } = {},
) {
  const [state, setState] = createStore({ part })
  const message = {
    id: part.messageID,
    sessionID: part.sessionID,
    role: "assistant",
    parentID: "msg_component_user",
    time: { created: 1 },
    modelID: "fixture",
    providerID: "fixture",
    mode: "build",
    agent: "build",
    path: { cwd: "/fixture", root: "/fixture" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } satisfies AssistantMessage
  // A spread admits the agreed optional callback before the frozen provider gains
  // its type. The old provider ignoring it is not the first failing assertion.
  const provider = {
    directory: "/fixture",
    data: {
      session: [],
      session_status: {},
      session_diff: {},
      message: { [part.sessionID]: [message] },
      get part() {
        return { [part.messageID]: [state.part] }
      },
    },
    onQuestionAction: options.onQuestionAction,
  }
  const component = () => (
    <DataProvider {...provider}>
      <Show when={options.visible?.() ?? true}>
        <Part
          part={state.part}
          message={message}
          defaultOpen={options.defaultOpen}
          deferToolContent={options.deferToolContent}
          toolOpen={options.toolOpen?.()}
          onToolOpenChange={options.onToolOpenChange}
        />
      </Show>
    </DataProvider>
  )
  const container = mount(() =>
    options.i18n ? <I18nProvider value={options.i18n}>{component()}</I18nProvider> : component(),
  )
  return {
    container,
    update(next: ToolPart) {
      setState("part", reconcile(next))
    },
  }
}

describe("AI-TDD-S05-R02 status labels and real error states", () => {
  test.each([
    { status: "pending", label: /\b(?:Pending|Queued)\b/i },
    { status: "running", label: /\bRunning\b/i },
    { status: "completed", label: /\bCompleted\b/i },
    { status: "error", label: /\bFailed\b/i },
  ])("presents the $status state as readable text, not only shimmer or color", (item) => {
    const container = mount(() => (
      <BasicTool icon="console" status={item.status} trigger={{ title: "Tool invocation" }} />
    ))
    expect(item.label.test(container.textContent ?? "")).toBe(true)
  })

  test("a reactive row gains a real disclosure only when completed output becomes available", () => {
    const [state, setState] = createStore<{ status: "pending" | "running" | "completed" }>({ status: "pending" })
    const container = mount(() => (
      <BasicTool icon="console" status={state.status} trigger={{ title: "Tool invocation" }}>
        <Show when={state.status === "completed"}>
          <pre>Final output marker</pre>
        </Show>
      </BasicTool>
    ))
    expect(/\b(?:Pending|Queued)\b/i.test(container.textContent ?? "")).toBe(true)
    expect(container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
    setState("status", "running")
    expect(/\bRunning\b/i.test(container.textContent ?? "")).toBe(true)
    expect(container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
    setState("status", "completed")
    expect(/\bCompleted\b/i.test(container.textContent ?? "")).toBe(true)
    const trigger = container.querySelector<HTMLButtonElement>('button[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    trigger?.click()
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("pre")?.textContent).toBe("Final output marker")
  })

  test.each([
    { name: "legacy cleanup marker", error: "Tool execution aborted", metadata: { interrupted: true } },
    { name: "current V2 terminal error", error: "Tool execution interrupted", metadata: {} },
  ])("recognizes $name without inventing an interrupted ToolState", (item) => {
    const fixture = mountToolPart(
      toolPart("bash", {
        status: "error",
        input: { command: "run build" },
        error: item.error,
        metadata: item.metadata,
        time: { start: 1, end: 2 },
      }),
    )
    expect(fixture.container.textContent?.includes("Interrupted")).toBe(true)
    const trigger = fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    trigger?.click()
    expect(fixture.container.textContent?.includes(item.error)).toBe(true)
  })

  test("does not classify an ordinary error merely because its detail mentions interrupted", () => {
    const fixture = mountToolPart(
      toolPart("bash", {
        status: "error",
        input: { command: "run build" },
        error: "Configuration says interrupted=false\nThe command failed validation",
        metadata: { interrupted: false },
        time: { start: 1, end: 2 },
      }),
    )
    expect(fixture.container.textContent?.includes("Configuration says interrupted=false")).toBe(true)
    expect(fixture.container.textContent?.includes("Interrupted")).toBe(false)
    fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    expect(fixture.container.textContent?.includes("The command failed validation")).toBe(true)
  })

  test("does not classify an unrelated error that merely contains the word interrupted", () => {
    const error = "Cannot open interrupted-report.txt"
    const fixture = mountToolPart(
      toolPart("bash", {
        status: "error",
        input: { command: "cat interrupted-report.txt" },
        error,
        metadata: {},
        time: { start: 1, end: 2 },
      }),
    )
    expect(fixture.container.textContent?.includes(error)).toBe(true)
    expect(fixture.container.textContent?.includes("Interrupted")).toBe(false)
    fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    expect(fixture.container.textContent?.includes(error)).toBe(true)
  })

  test("an interrupted-looking metadata field cannot turn a completed call into an interrupted one", () => {
    const fixture = mountToolPart(
      toolPart("bash", {
        status: "completed",
        input: { command: "run build" },
        output: "Build succeeded",
        title: "run build",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      }),
    )
    expect(/\bCompleted\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    expect(fixture.container.textContent?.includes("Interrupted")).toBe(false)
  })
})

describe("AI-TDD-S05-R03 dynamic, locked, deferred and animated contracts", () => {
  test("a dynamic trigger observes the same open accessor across opening and closing", () => {
    const calls: string[] = []
    const changes: boolean[] = []
    const container = mount(() => (
      <BasicTool
        icon="console"
        status="completed"
        trigger={(open) => {
          calls.push("trigger")
          return <span data-testid="dynamic-trigger">{open() ? "Expanded invocation" : "Collapsed invocation"}</span>
        }}
        onOpenChange={(open) => changes.push(open)}
      >
        <pre>Dynamic trigger output</pre>
      </BasicTool>
    ))
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    expect(container.querySelector('[data-testid="dynamic-trigger"]')?.textContent).toBe("Collapsed invocation")
    trigger?.click()
    expect(container.querySelector('[data-testid="dynamic-trigger"]')?.textContent).toBe("Expanded invocation")
    trigger?.click()
    expect(container.querySelector('[data-testid="dynamic-trigger"]')?.textContent).toBe("Collapsed invocation")
    expect(changes).toEqual([true, false])
    expect(calls).toEqual(["trigger"])
  })

  test("a controlled row reports intent but waits for its owner to change open", () => {
    const [state, setState] = createStore({ open: false })
    const changes: boolean[] = []
    const container = mount(() => (
      <BasicTool
        icon="console"
        trigger={{ title: "Controlled invocation" }}
        open={state.open}
        onOpenChange={(open) => changes.push(open)}
      >
        <pre>Controlled output</pre>
      </BasicTool>
    ))
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    trigger?.click()
    expect(changes).toEqual([true])
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    setState("open", true)
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("pre")?.textContent).toBe("Controlled output")
  })

  test("locked permits the initial opening but refuses a later collapse", () => {
    const changes: boolean[] = []
    const container = mount(() => (
      <BasicTool icon="console" locked trigger={{ title: "Locked output" }} onOpenChange={(open) => changes.push(open)}>
        <pre>Keep this output open</pre>
      </BasicTool>
    ))
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger !== null).toBe(true)
    trigger?.click()
    expect(container.querySelector("pre")?.textContent).toBe("Keep this output open")
    container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    expect(container.querySelector("pre")?.textContent).toBe("Keep this output open")
    expect(container.querySelectorAll('[aria-expanded="false"]').length).toBe(0)
    expect(changes).toEqual([true])
  })

  test("forceOpen still opens the real body and reports the change", () => {
    const [state, setState] = createStore({ force: false })
    const changes: boolean[] = []
    const container = mount(() => (
      <BasicTool
        icon="console"
        forceOpen={state.force}
        trigger={{ title: "Forced output" }}
        onOpenChange={(open) => changes.push(open)}
      >
        <pre>Forced body</pre>
      </BasicTool>
    ))
    setState("force", true)
    expect(container.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("pre")?.textContent).toBe("Forced body")
    expect(changes).toEqual([true])
  })

  test("defer mounts only at readiness, releases on close, and can mount a fresh body on reopen", async () => {
    const [state, setState] = createStore({ open: false })
    const lifetime = { mounts: 0, releases: 0 }
    const arrivals = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const Body = () => {
      onMount(() => {
        lifetime.mounts += 1
        arrivals[lifetime.mounts - 1]?.resolve()
      })
      onCleanup(() => {
        lifetime.releases += 1
      })
      return <pre>Deferred output</pre>
    }
    const container = mount(() => (
      <BasicTool icon="code-lines" defer open={state.open} trigger={{ title: "Deferred invocation" }}>
        <Body />
      </BasicTool>
    ))
    expect(lifetime.mounts).toBe(0)
    expect(container.querySelectorAll("pre").length).toBe(0)
    setState("open", true)
    expect(lifetime.mounts).toBe(0)
    await arrivals[0]?.promise
    expect(lifetime.mounts).toBe(1)
    expect(container.querySelector("pre")?.textContent).toBe("Deferred output")
    setState("open", false)
    expect(lifetime.releases).toBe(1)
    expect(container.querySelectorAll("pre").length).toBe(0)
    setState("open", true)
    await arrivals[1]?.promise
    expect(lifetime.mounts).toBe(2)
    expect(container.querySelector("pre")?.textContent).toBe("Deferred output")
  }, 10_000)

  test("unmounting a deferred default-open row cancels its scheduled body", async () => {
    const [state, setState] = createStore({ visible: true })
    const mounts: string[] = []
    const Body = () => {
      onMount(() => mounts.push("mounted"))
      return <pre>Cancelled body</pre>
    }
    const container = mount(() => (
      <Show when={state.visible}>
        <BasicTool icon="code-lines" defer defaultOpen trigger={{ title: "Cancelled invocation" }}>
          <Body />
        </BasicTool>
      </Show>
    ))
    setState("visible", false)
    // Flush the two RAF boundaries owned by the production initial-defer queue.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(mounts.length).toBe(0)
    expect(container.querySelectorAll("pre").length).toBe(0)
  }, 10_000)

  // The `height:auto` + `overflow:visible` finalization is only observable with a real
  // animation driver; the unit environment never resolves `height:auto`. The browser
  // contract stays with e2e/regression/session-tool-row.spec.ts (owner: main).
  test("animated keeps the same mounted body while the open state toggles", async () => {
    const container = mount(() => (
      <BasicTool icon="console" animated trigger={{ title: "Animated invocation" }}>
        <pre>Animated output</pre>
      </BasicTool>
    ))
    const body = container.querySelector("pre")
    const content = container.querySelector<HTMLDivElement>('[data-slot="collapsible-content"][data-animated]')
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(body !== null).toBe(true)
    expect(content !== null).toBe(true)
    expect(trigger !== null).toBe(true)
    expect(content?.style.height).toBe("0px")
    trigger?.click()
    await waitForDom(container, () => content?.style.height !== "0px", "animated content leaves its collapsed height")
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("pre") === body).toBe(true)
    trigger?.click()
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector("pre") === body).toBe(true)
  })

  test("animated plus deferred default-open still waits before constructing the body", async () => {
    const arrived = Promise.withResolvers<void>()
    const mounts: string[] = []
    const Body = () => {
      onMount(() => {
        mounts.push("mounted")
        arrived.resolve()
      })
      return <pre>Deferred animated output</pre>
    }
    const container = mount(() => (
      <BasicTool icon="code-lines" animated defer defaultOpen trigger={{ title: "Deferred animated invocation" }}>
        <Body />
      </BasicTool>
    ))
    expect(mounts.length).toBe(0)
    await arrived.promise
    expect(mounts.length).toBe(1)
    expect(container.querySelector("pre")?.textContent).toBe("Deferred animated output")
    expect(
      container.querySelector<HTMLDivElement>('[data-slot="collapsible-content"][data-animated]')?.style.height,
    ).toBe("auto")
  }, 10_000)
})

const question = {
  header: "Database",
  question: "Which database should this invocation use?",
  options: [
    { label: "SQLite", description: "Use the local database" },
    { label: "Postgres", description: "Use the remote database" },
  ],
  multiple: false,
  custom: false,
} satisfies QuestionV2Info

function waitingQuestion(status: "pending" | "running" = "running") {
  const input = {
    questions: [question],
    sessionID: "ses_input_is_not_the_owner",
    messageID: "msg_input_is_not_the_owner",
    callID: "call_input_is_not_the_owner",
  }
  return toolPart(
    "question",
    status === "pending"
      ? { status, input, raw: JSON.stringify(input) }
      : { status, input, metadata: {}, time: { start: 1 } },
  )
}

function answeredQuestion(): ToolPart {
  return toolPart("question", {
    status: "completed",
    input: { questions: [question] },
    output: "The user chose SQLite",
    title: "Questions",
    metadata: { answers: [["SQLite"]] },
    time: { start: 1, end: 2 },
  })
}

function expectWaiting(container: HTMLElement, part: ToolPart) {
  expect(container.querySelectorAll(`[data-timeline-part-id="${part.id}"]`).length).toBe(1)
  expect(/waiting/i.test(container.textContent ?? "")).toBe(true)
  expect(container.querySelectorAll('form, textarea, [type="submit"], [role="radio"], [role="checkbox"]').length).toBe(
    0,
  )
}

describe("AI-TDD-S05-R05 production QuestionActionFn component contract", () => {
  test.each(["pending", "running"] as const)(
    "%s questions remain readonly waiting rows without an action provider",
    (status) => {
      const part = waitingQuestion(status)
      const fixture = mountToolPart(part)
      expectWaiting(fixture.container, part)
      expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(0)
    },
  )

  test("an installed provider returning no action cannot create a fake locate button", () => {
    const part = waitingQuestion()
    const fixture = mountToolPart(part, { onQuestionAction: () => undefined })
    expectWaiting(fixture.container, part)
    expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(0)
  })

  test("the locate button calls the returned action and derives identity from the real ToolPart, not its input", () => {
    const part = waitingQuestion()
    const queries: ToolIdentity[] = []
    const actions: ToolIdentity[] = []
    const fixture = mountToolPart(part, {
      onQuestionAction: (target) => {
        const identity = { sessionID: target.sessionID, messageID: target.messageID, callID: target.callID }
        queries.push(identity)
        return () => actions.push(identity)
      },
    })
    expectWaiting(fixture.container, part)
    const button = fixture.container.querySelector<HTMLButtonElement>('button[data-slot="question-locate"]')
    expect(button !== null).toBe(true)
    const name = (button?.getAttribute("aria-label") ?? button?.textContent ?? "").trim()
    expect(name.length > 0).toBe(true)
    expect(name.startsWith("ui.")).toBe(false)
    expect(button?.type).toBe("button")
    expect(queries.length > 0).toBe(true)
    expect(
      queries.every(
        (target) =>
          target.sessionID === part.sessionID && target.messageID === part.messageID && target.callID === part.callID,
      ),
    ).toBe(true)
    button?.focus()
    expect(document.activeElement === button).toBe(true)
    button?.click()
    expect(actions).toEqual([{ sessionID: part.sessionID, messageID: part.messageID, callID: part.callID }])
    expect(fixture.container.querySelectorAll('form, textarea, [type="submit"]').length).toBe(0)
  })

  test("locate uses the shared i18n provider rather than a hard-coded accessible name", () => {
    const part = waitingQuestion()
    const fixture = mountToolPart(part, {
      onQuestionAction: () => () => {},
      i18n: { locale: () => "test", t: (key) => `translated:${key}` },
    })
    expect(fixture.container.querySelectorAll(`[data-timeline-part-id="${part.id}"]`).length).toBe(1)
    const button = fixture.container.querySelector<HTMLButtonElement>('button[data-slot="question-locate"]')
    expect(button !== null).toBe(true)
    const name = (button?.getAttribute("aria-label") ?? button?.textContent ?? "").trim()
    expect(name.startsWith("translated:ui.")).toBe(true)
  })

  test("revoking the pending-request action removes locate without removing the waiting history row", () => {
    const [permission, setPermission] = createStore({ available: true })
    const actions: string[] = []
    const part = waitingQuestion()
    const fixture = mountToolPart(part, {
      onQuestionAction: () => (permission.available ? () => actions.push("locate") : undefined),
    })
    expectWaiting(fixture.container, part)
    expect(fixture.container.querySelectorAll('button[data-slot="question-locate"]').length).toBe(1)
    setPermission("available", false)
    expectWaiting(fixture.container, part)
    expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(0)
    expect(actions).toEqual([])
  })

  test("an answered projection renders readonly answers even if an action provider is present", () => {
    const actions: string[] = []
    const fixture = mountToolPart(answeredQuestion(), { onQuestionAction: () => () => actions.push("locate") })
    expect(fixture.container.querySelector('[data-component="question-answers"]')?.textContent).toContain("SQLite")
    expect(fixture.container.textContent?.includes(question.question)).toBe(true)
    expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(0)
    expect(
      fixture.container.querySelectorAll('form, textarea, [type="submit"], [role="radio"], [role="checkbox"]').length,
    ).toBe(0)
    expect(actions).toEqual([])
  })

  test("pending to answered removes the action and exposes only the immutable answer projection", () => {
    const part = waitingQuestion()
    const actions: string[] = []
    const fixture = mountToolPart(part, { onQuestionAction: () => () => actions.push("locate") })
    expectWaiting(fixture.container, part)
    expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(1)
    fixture.update(answeredQuestion())
    expect(fixture.container.querySelectorAll('[data-slot="question-locate"]').length).toBe(0)
    const trigger = fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    if (trigger?.getAttribute("aria-expanded") === "false") trigger.click()
    expect(fixture.container.querySelector('[data-component="question-answers"]')?.textContent).toContain("SQLite")
    expect(/waiting/i.test(fixture.container.textContent ?? "")).toBe(false)
    expect(fixture.container.querySelectorAll('form, textarea, [type="submit"]').length).toBe(0)
    expect(actions).toEqual([])
  })
})

describe("AI-TDD-S05-R06 production registry state transitions", () => {
  test.each(["mcp_docs_search", "unregistered_tool"])(
    "%s preserves the timeline-owned expansion across row remounts",
    (tool) => {
      const [owner, setOwner] = createStore({ open: false, visible: true })
      const fixture = mountToolPart(
        toolPart(tool, {
          status: "completed",
          input: {},
          output: "Immutable generic output",
          title: tool,
          metadata: {},
          time: { start: 1, end: 2 },
        }),
        {
          toolOpen: () => owner.open,
          onToolOpenChange: (open) => setOwner("open", open),
          visible: () => owner.visible,
        },
      )
      const trigger = () =>
        fixture.container.querySelector<HTMLButtonElement>('button[data-slot="collapsible-trigger"]')
      trigger()?.click()
      expect(owner.open).toBe(true)
      setOwner("visible", false)
      expect(trigger()).toBeNull()
      setOwner("visible", true)
      expect(trigger()?.getAttribute("aria-expanded")).toBe("true")
      expect(fixture.container.querySelector("pre")?.textContent).toBe("Immutable generic output")
    },
  )

  test("shell running metadata output is replaced by the complete final output without losing lines", () => {
    const input = { command: "print report" }
    const fixture = mountToolPart(
      toolPart("bash", { status: "running", input, metadata: { output: "First line" }, time: { start: 1 } }),
      { defaultOpen: true },
    )
    expect(fixture.container.querySelector('[data-slot="bash-pre"]')?.textContent).toContain("First line")
    expect(/\bRunning\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    fixture.update(
      toolPart("bash", {
        status: "completed",
        input,
        output: "First line\nSecond line\nLast line",
        title: "print report",
        metadata: {},
        time: { start: 1, end: 2 },
      }),
    )
    expect(fixture.container.querySelector('[data-slot="bash-pre"]')?.textContent).toBe(
      "$ print report\n\nFirst line\nSecond line\nLast line",
    )
    expect(/\bCompleted\b/i.test(fixture.container.textContent ?? "")).toBe(true)
  })

  test.each(["mcp_docs_search", "unregistered_tool"])(
    "%s can progress from pending through running to safe complete output",
    (name) => {
      const input = { query: "Look up the existing implementation" }
      const fixture = mountToolPart(toolPart(name, { status: "pending", input, raw: JSON.stringify(input) }))
      expect(/\b(?:Pending|Queued)\b/i.test(fixture.container.textContent ?? "")).toBe(true)
      expect(fixture.container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
      fixture.update(toolPart(name, { status: "running", input, metadata: {}, time: { start: 1 } }))
      expect(/\bRunning\b/i.test(fixture.container.textContent ?? "")).toBe(true)
      expect(fixture.container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
      const output = '<img src="invalid" onerror="unsafe()">\n<script>unsafe()</script>\nLast line'
      fixture.update(
        toolPart(name, {
          status: "completed",
          input,
          output,
          title: name,
          metadata: {},
          time: { start: 1, end: 2 },
        }),
      )
      const trigger = fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
      expect(trigger !== null).toBe(true)
      trigger?.click()
      expect(fixture.container.querySelector('[data-slot="collapsible-content"]')?.textContent).toBe(output)
      expect(fixture.container.querySelectorAll("img, script, iframe").length).toBe(0)
    },
  )

  test("a skill changes its status label without gaining a fake output action", () => {
    const input = { name: "review" }
    const fixture = mountToolPart(toolPart("skill", { status: "pending", input, raw: JSON.stringify(input) }))
    expect(/\b(?:Pending|Queued)\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    fixture.update(toolPart("skill", { status: "running", input, time: { start: 1 } }))
    expect(/\bRunning\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    fixture.update(
      toolPart("skill", {
        status: "completed",
        input,
        output: "Loaded the skill",
        title: "review",
        metadata: {},
        time: { start: 1, end: 2 },
      }),
    )
    expect(/\bCompleted\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    expect(fixture.container.querySelectorAll("button, [aria-expanded]").length).toBe(0)
  })

  test.each(["todowrite", "taskwrite"])("%s transitions to a compact readonly invocation snapshot", (tool) => {
    const snapshot = {
      id: "tsk_component_history",
      sessionID: "ses_component_tools",
      content: "Original task snapshot",
      status: "pending",
      priority: "high",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    } satisfies SessionTaskInfo
    const input = { tasks: [{ content: snapshot.content, status: snapshot.status, priority: snapshot.priority }] }
    const running = toolPart(tool, { status: "running", input, time: { start: 1 } })
    expect(renderable(running)).toBe(true)
    const fixture = mountToolPart(running)
    expect(/\bRunning\b/i.test(fixture.container.textContent ?? "")).toBe(true)
    fixture.update(
      toolPart(tool, {
        status: "completed",
        input,
        output: JSON.stringify([snapshot]),
        title: tool,
        metadata: { tasks: [snapshot] },
        time: { start: 1, end: 2 },
      }),
    )
    expect(fixture.container.querySelector('[data-slot="basic-tool-tool-indicator"] use')?.getAttribute("href")).toBe(
      "#aigcfroge-icon-checklist",
    )
    const trigger = fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    trigger?.click()
    expect(fixture.container.querySelector('[data-slot="collapsible-content"]')?.textContent).toContain(
      snapshot.content,
    )
    expect(
      fixture.container.querySelectorAll(
        'form, textarea, [contenteditable="true"], input[type="checkbox"], [role="checkbox"]',
      ).length,
    ).toBe(0)
  })

  test("the retained todowrite result snapshot wins over its older input without exposing editing controls", () => {
    const part = toolPart("todowrite", {
      status: "completed",
      input: { tasks: [{ content: "Requested before the tool completed", status: "pending" }] },
      metadata: { tasks: [{ content: "Recorded at tool completion", status: "completed" }] },
      output: "[]",
      title: "todowrite",
      time: { start: 1, end: 2 },
    })
    expect(renderable(part)).toBe(true)
    const fixture = mountToolPart(part)
    const trigger = fixture.container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    trigger?.click()
    const content = fixture.container.querySelector('[data-slot="collapsible-content"]')
    expect(content?.textContent).toContain("Recorded at tool completion")
    expect(content?.textContent).not.toContain("Requested before the tool completed")
    expect(
      fixture.container.querySelectorAll('input, [role="checkbox"], form, textarea, [contenteditable="true"]').length,
    ).toBe(0)
  })
})

describe("AI-TDD-S05-R03 late deferred output", () => {
  test.each(["mcp_docs_search", "unregistered_tool"])(
    "a controlled %s mounts late deferred output without toggling or replacing its owner",
    async (name) => {
      const [state, setState] = createStore({ open: true })
      const fixture = mountToolPart(
        toolPart(name, { status: "running", input: { query: "existing contract" }, time: { start: 1 } }),
        {
          deferToolContent: true,
          toolOpen: () => state.open,
          onToolOpenChange: (open) => setState("open", open),
        },
      )
      const wrapper = fixture.container.querySelector('[data-component="tool-part-wrapper"]')
      expect(wrapper !== null).toBe(true)
      expect(fixture.container.querySelectorAll("pre, [aria-expanded]").length).toBe(0)
      fixture.update(
        toolPart(name, {
          status: "completed",
          input: { query: "existing contract" },
          output: "Late immutable tool output",
          title: "Existing contract",
          metadata: {},
          time: { start: 1, end: 2 },
        }),
      )
      expect(fixture.container.querySelector('[aria-expanded="true"]') !== null).toBe(true)
      await waitForDom(
        fixture.container,
        () => fixture.container.querySelector("pre")?.textContent === "Late immutable tool output",
        "controlled late output mounts after deferred readiness",
      )
      expect(fixture.container.querySelector('[data-component="tool-part-wrapper"]')).toBe(wrapper)
      setState("open", false)
      expect(fixture.container.querySelectorAll("pre").length).toBe(0)
      setState("open", true)
      await waitForDom(
        fixture.container,
        () => fixture.container.querySelector("pre")?.textContent === "Late immutable tool output",
        "controlled late output reopens through its existing owner",
      )
      expect(fixture.container.querySelector('[data-component="tool-part-wrapper"]')).toBe(wrapper)
    },
    10_000,
  )
})
