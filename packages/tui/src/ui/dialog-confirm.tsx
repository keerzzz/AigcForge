import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { createSignal, For, Show } from "solid-js"
import { Locale } from "../util/locale"
import { useBindings } from "../keymap"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: string
  /**
   * Optional "remember this answer" toggle. Existing callers pass nothing and
   * behave exactly as before — `show`'s signature and return type are untouched,
   * so `app.tsx` and the plugin adapter are unaffected.
   */
  remember?: {
    readonly label: string
    readonly value: boolean
    readonly onToggle: () => void
  }
}

export type DialogConfirmResult = boolean | undefined

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Confirm dialog selection",
        group: "Dialog",
        cmd: () => {
          if (store.active === "confirm") props.onConfirm?.()
          if (store.active === "cancel") props.onCancel?.()
          dialog.clear()
        },
      },
      {
        key: "left",
        desc: "Previous dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      {
        key: "right",
        desc: "Next dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      ...(props.remember
        ? [
            {
              key: "r",
              desc: "Toggle remembering this answer",
              group: "Dialog",
              cmd: () => props.remember?.onToggle(),
            },
          ]
        : []),
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <Show when={props.remember}>
        {(remember) => (
          <box paddingBottom={1} onMouseUp={() => remember().onToggle()}>
            <text fg={remember().value ? theme.text : theme.textMuted}>
              {remember().value ? "[x] " : "[ ] "}
              {remember().label} <span style={{ fg: theme.textMuted }}>(r)</span>
            </text>
          </box>
        )}
      </Show>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {Locale.titlecase(key === "cancel" ? (props.label ?? key) : key)}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

DialogConfirm.show = (dialog: DialogContext, title: string, message: string, label?: string) => {
  return new Promise<DialogConfirmResult>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
          label={label}
        />
      ),
      () => resolve(undefined),
    )
  })
}

/**
 * Confirm with a "remember this answer" toggle. Separate from `show` so the
 * existing callers keep their `boolean | undefined` contract; a dismissal still
 * resolves `undefined`, and `remember` is only meaningful when `confirmed`.
 */
DialogConfirm.showWithRemember = (
  dialog: DialogContext,
  title: string,
  message: string,
  rememberLabel: string,
  label?: string,
) => {
  return new Promise<{ readonly confirmed: boolean; readonly remember: boolean } | undefined>((resolve) => {
    const [remember, setRemember] = createSignal(false)
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve({ confirmed: true, remember: remember() })}
          onCancel={() => resolve({ confirmed: false, remember: false })}
          label={label}
          remember={{
            label: rememberLabel,
            get value() {
              return remember()
            },
            onToggle: () => setRemember((value) => !value),
          }}
        />
      ),
      () => resolve(undefined),
    )
  })
}
