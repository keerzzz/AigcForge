import { createContext, createMemo, Show, useContext, type ParentProps, type Accessor } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      // Access init.ready inside the memo to make it reactive for getter properties
      const isReady = createMemo(() => {
        // @ts-expect-error
        const ready = init.ready as Accessor<boolean> | boolean | undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })
      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    // Arrow properties, not methods: every consumer destructures these off the
    // returned object, which trips `unbound-method` on a method shorthand.
    use: () => {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
    /**
     * Reads the context without throwing when no provider is above.
     *
     * For the cases where absence is a legitimate mounting, not a bug: a hook that
     * has to work both inside a scoped subtree and in the shell above it cannot use
     * `use()`, because that turns "no provider here" into a crash.
     */
    useOptional: () => useContext(ctx),
  }
}
