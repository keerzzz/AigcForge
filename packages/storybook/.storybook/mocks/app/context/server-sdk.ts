// The real ServerSDK context resolves a live ServerConnection and opens an SSE
// event stream against a running instance, which Storybook has no equivalent of.
// Stories only need the subscribe seam, so `listen` registers nothing and hands
// back a no-op unsubscribe; no event is ever delivered here.
type ServerEvent = { name: string; details: unknown }

const serverSDK = {
  event: {
    listen(_listener: (event: ServerEvent) => void) {
      return () => {}
    },
    on(_name: string, _listener: (details: unknown) => void) {
      return () => {}
    },
    start() {
      return Promise.resolve()
    },
  },
}

export function useServerSDK() {
  return () => serverSDK
}
