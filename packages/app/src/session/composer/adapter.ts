import { ClientError } from "@omnixa/client/promise"
import { onCleanup, type Accessor } from "solid-js"
import type { ActiveComposerAdapter, ComposerControls } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"

export function createActiveComposerAdapter(input: {
  sessionID: string
  controls: Accessor<ComposerControls>
  submitted: () => void
  setEditor: (element: HTMLDivElement) => void
}) {
  const id = input.sessionID

  const prompt = useComposerState()
  prompt.current()
  const state = prompt.capture()
  const data = useData()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const adapter: ActiveComposerAdapter = {
    kind: "active-session",
    state,
    ready: prompt.ready,
    controls: input.controls,
    working: () => data.session.status(id) === "running",
    submitted: input.submitted,
    setEditor: input.setEditor,
    session() {
      const owner = server.api
      const directory = location().directory
      const owned = () => !disposed && server.api === owner && location().directory === directory
      const requireOwner = () => {
        if (!owned()) throw new ClientError("Transport", { detail: "Session submission owner changed" })
      }
      const afterOwner = async <T>(run: () => Promise<T>) => {
        requireOwner()
        const value = await run()
        requireOwner()
        return value
      }

      return {
        id,
        directory,
        api: {
          command: (input) => afterOwner(() => owner.session.command(input)),
          shell: (input) => afterOwner(() => owner.session.shell(input)),
          switchAgent: (input) => afterOwner(() => owner.session.switchAgent(input)),
          switchModel: (input) => afterOwner(() => owner.session.switchModel(input)),
          selectExecutor: (input) => afterOwner(() => owner.session.selectExecutor(input)),
          revert: { commit: (input) => afterOwner(() => owner.session.revert.commit(input)) },
        },
        data: {
          location: data.location,
          session: {
            setStatus: (sessionID, status) => {
              if (!owned()) return
              data.session.setStatus(sessionID, status)
            },
            selectExecutor: (input) => afterOwner(() => data.session.selectExecutor(input)),
            invalidate: (sessionID) => {
              requireOwner()
              data.session.invalidate(sessionID)
            },
            sync: (sessionID, options) => afterOwner(() => data.session.sync(sessionID, options)),
            readback: (sessionID, options) =>
              afterOwner(async () => {
                if (options?.children) return data.session.readback(sessionID, options)
                const info = await owner.session.get({ sessionID })
                requireOwner()

                if (!data.session.get(sessionID)) return
                // Selection ACKs use this owner's response even when an event invalidates the cache read.
                data.session.remember(structuredClone(info))

                return info
              }),
            prompt: (input) => {
              requireOwner()
              return data.session.prompt({
                ...input,
                gate: Promise.all([input.gate, afterOwner(async () => undefined)]),
                prepare: () =>
                  afterOwner(async () => {
                    await input.prepare?.()
                  }),
              })
            },
          },
        },
        current: () => (owned() ? data.session.get(id) : undefined),
        admitted: (messageID) =>
          owned() && (data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID)),
      }
    },
    interrupt: () =>
      server.api.session
        .interrupt({ sessionID: id, resume: true })
        .then(() => undefined)
        .catch(() => undefined),
  }

  return adapter
}
