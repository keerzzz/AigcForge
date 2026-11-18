// Type-level contract of the registries, checked by `bun typecheck`. Nothing imports this file. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.
import type { SessionFork } from "@aigcfroge/schema/session-fork"
import {
  Extension,
  MenuItem,
  Slot,
  TitlebarItem,
  type MountedSession,
  type SessionScreen,
  type SessionTargetRef,
  type TaskTargetRef,
  type Setup,
} from "./index"

const Fixture = Extension.define({ id: "fixture" })

export const menus: Setup<typeof Fixture> = (ctx) => {
  // Each menu takes its own fields.
  ctx.add(MenuItem, { menu: "session.panel", id: "open", title: "Open", icon: "plus", keybind: "file.open", run() {} })
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", order: 1, run() {} })
  ctx.add(MenuItem, {
    menu: "server.row",
    id: "connect",
    title: "Connect",
    when: (server) => server.startsWith("ssh:"),
    enabled: () => true,
    run: (server) => void server.length,
  })
  ctx.add(MenuItem, (): MenuItem | undefined =>
    Math.random() > 0.5 ? { menu: "server.add", id: "add", title: "Add", run() {} } : undefined,
  )

  // @ts-expect-error the Add server menu shows no icon
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", icon: "plus", run() {} })
  // @ts-expect-error the + menu lists every item, so it takes no `when`
  ctx.add(MenuItem, { menu: "session.panel", id: "open", title: "Open", when: () => true, run() {} })
  // @ts-expect-error a server row shows no keybind
  ctx.add(MenuItem, { menu: "server.row", id: "connect", title: "Connect", keybind: "file.open", run() {} })
  // @ts-expect-error only a server row's `run` receives a server key
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", run: (server: string) => void server })

  // A pill without `run` only shows its label.
  ctx.add(TitlebarItem, { id: "status", label: "Ready" })
}

/**
 * Checks the response input's layout source, content target, readonly facts, and original header contract.
 *
 * @param ctx - The existing registry fixture's context.
 */
export const responseActions: Setup<typeof Fixture> = (ctx) => {
  ctx.add(Slot, {
    at: "session.response.actions",
    render(input) {
      const screen: SessionScreen = input.screen
      const source: MountedSession = input.source
      const target: SessionTargetRef = input.session
      const boundary: SessionFork.Boundary | undefined = input.boundary
      const flags: readonly boolean[] = [input.active, input.completed, input.latest]
      const ids: readonly string[] = [input.userMessageID, input.assistantMessageID, input.contentID]
      const text: string = input.text
      void [screen, source, target, boundary, flags, ids, text]

      // @ts-expect-error content targets do not require a shell tab.
      input.session.tab
      // @ts-expect-error the host's response facts are readonly.
      input.text = "changed"

      return null
    },
  })
  ctx.add(Slot, {
    at: "session.header",
    render(input) {
      const session: MountedSession = input.session
      void session.tab

      // @ts-expect-error the original header input has no separate source.
      input.source

      return null
    },
  })
}

/**
 * Checks that Composer actions receive the actual target, and Task navigation requires a saved Task or operation.
 *
 * @param ctx - The existing registry fixture's context.
 */
export const composerActions: Setup<typeof Fixture> = (ctx) => {
  ctx.add(Slot, {
    at: "session.composer.actions",
    render(input) {
      const screen: SessionScreen = input.screen
      const source: MountedSession = input.source
      const target: SessionTargetRef = input.session
      const selection: string | undefined = input.draftAgent
      const active: boolean = input.active

      const task: TaskTargetRef = {
        server: target.server,
        sourceSessionID: target.id,
        taskID: "tsk_example",
      }

      const reservation: TaskTargetRef = {
        server: target.server,
        sourceSessionID: target.id,
        operationID: "top_example",
      }

      const opened: boolean = ctx.sessions.openTask({ source, target: task })
      void [screen, selection, active, reservation, opened]

      // @ts-expect-error an operation target can precede a shell tab.
      input.session.tab
      // @ts-expect-error the unsubmitted selection is a readonly host fact.
      input.draftAgent = "meta"
      // @ts-expect-error the saved reference needs a Task or operation identity.
      const missing: TaskTargetRef = { server: target.server, sourceSessionID: target.id }
      void missing

      return null
    },
  })
}
