import { createSignal } from "solid-js"
import { Button } from "@aigcfroge/ui/button"
import { CheckboxV2 } from "@aigcfroge/ui/v2/checkbox-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import type { useDialog } from "@aigcfroge/ui/context/dialog"
import type { useLanguage } from "@/context/language"

type DialogContext = ReturnType<typeof useDialog>
type Language = ReturnType<typeof useLanguage>

export type HandoffConfirmResult = {
  readonly approved: boolean
  /** User asked to remember this (location, label, agent) grant so the next identical handoff skips the confirm. */
  readonly remember: boolean
}

/**
 * Confirmation for a handoff that widens the session's permissions (D13 rule 2).
 *
 * Reuses the shared dialog host rather than adding a surface: `Dialog` must be
 * rendered through `useDialog()` (Kobalte Root/Portal), so a bare render throws
 * `useDialogContext must be used within a Dialog` — see
 * `session-permission-override-dialog.tsx`, which learned the same thing.
 *
 * Resolves `{ approved: false }` on dismissal (Escape, backdrop, Cancel) because
 * `push`'s `onClose` fires for every close path. Approval resolves before
 * `close()` runs, and a settled promise ignores the later `onClose` resolve.
 */
export function confirmHandoffEscalation(
  dialog: DialogContext,
  language: Language,
  agent: string,
): Promise<HandoffConfirmResult> {
  return new Promise<HandoffConfirmResult>((resolve) => {
    const [pending, setPending] = createSignal(false)
    const [remember, setRemember] = createSignal(false)
    dialog.push(
      () => (
        <Dialog title={language.t("session.handoff.confirm.title")} class="mx-auto w-full max-w-[480px]">
          <p data-slot="handoff-confirm-body">{language.t("session.handoff.confirm.body", { agent })}</p>
          <div class="flex items-center gap-2 py-1">
            <CheckboxV2
              data-slot="handoff-confirm-remember"
              checked={remember()}
              onChange={setRemember}
              label={language.t("session.handoff.confirm.remember")}
            />
          </div>
          <div data-slot="handoff-confirm-actions" class="flex justify-end gap-2">
            <Button variant="ghost" size="normal" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              disabled={pending()}
              onClick={() => {
                setPending(true)
                resolve({ approved: true, remember: remember() })
                dialog.close()
              }}
            >
              {language.t("session.handoff.confirm.approve")}
            </Button>
          </div>
        </Dialog>
      ),
      () => resolve({ approved: false, remember: false }),
    )
  })
}
