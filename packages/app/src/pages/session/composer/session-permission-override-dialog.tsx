import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@aigcfroge/ui/button"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"

const RENEW_INTERVAL_MS = 30_000

/**
 * 会话级 break-glass（计划 §4.3）：仅根会话、有人值守时显示；打开需二次
 * 确认 + 显式勾选；页面可见时每 30s 续租 60s 租约，隐藏/断连后租约自动过期。
 * Dialog 必须经 useDialog() 宿主渲染（Kobalte Root/Portal），裸渲染会崩
 * （useDialogContext must be used within a Dialog）。
 */
export function SessionPermissionOverrideControl(props: {
  sessionID: string
  root: boolean
  attended: boolean | undefined
  enabled: () => boolean
  onEnable: () => void
  onRenew: () => void
  onDisable: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [acknowledged, setAcknowledged] = createSignal(false)

  const visible = createMemo(() => props.root && props.attended !== false)

  const renewLoop = () => {
    if (!props.enabled()) return
    if (document.visibilityState !== "visible") return
    props.onRenew()
  }

  onMount(() => {
    const interval = setInterval(renewLoop, RENEW_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return
      renewLoop()
    }
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    })
  })

  const confirm = () => {
    if (!acknowledged()) return
    props.onEnable()
    dialog.close()
  }

  const openConfirm = () => {
    setAcknowledged(false)
    dialog.push(() => (
      <Dialog title={language.t("permission.override.confirm.title")} class="w-full max-w-[480px] mx-auto">
        <p data-slot="permission-override-confirm-body">{language.t("permission.override.confirm.body")}</p>
        <label>
          <input
            type="checkbox"
            data-slot="permission-override-acknowledge"
            checked={acknowledged()}
            onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          />
          {language.t("permission.override.confirm.acknowledge")}
        </label>
        <div data-slot="permission-override-confirm-actions">
          <Button variant="ghost" size="normal" onClick={() => dialog.close()}>
            {language.t("permission.override.cancel")}
          </Button>
          <Button
            variant="secondary"
            size="normal"
            disabled={!acknowledged()}
            onClick={confirm}
          >
            {language.t("permission.override.confirm.enable")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const disable = () => props.onDisable()

  return (
    <Show when={visible()}>
      <div data-slot="permission-override-control">
        <Show
          when={props.enabled()}
          fallback={
            <button
              type="button"
              data-slot="permission-override-enable"
              onClick={openConfirm}
            >
              {language.t("permission.override.enable")}
            </button>
          }
        >
          <button type="button" data-slot="permission-override-disable" onClick={disable}>
            {language.t("permission.override.disable")}
          </button>
        </Show>
      </div>
    </Show>
  )
}
