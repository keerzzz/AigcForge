import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { QuestionRequest } from "@aigcfroge/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { PermissionPendingModel } from "@/context/global-sync/permission-pending"
import { sessionPendingPermissionRequest, sessionQuestionRequest } from "./session-request-tree"

export function createSessionComposerState() {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(sync().data.session, sync().data.question, params.id)
  })

  const permissionRequest = createMemo((): PermissionPendingModel.PermissionPending | undefined => {
    return sessionPendingPermissionRequest(
      sync().data.session,
      sync().data.permission,
      sync().data.permission_v2,
      params.id,
      (item) => !permission.autoResponds(item, sdk().directory),
    )
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const [store, setStore] = createStore({
    responding: undefined as string | undefined,
  })

  const permissionResponding = createMemo(() => {
    const perm = permissionRequest()
    if (!perm) return false
    return store.responding === perm.request.id
  })

  // Takes the request/decision pair the dock built. The dock is the only place
  // that knows which runtime owns the prompt, so it is the only place that can
  // legally construct the pair — this state just forwards it.
  const decide = (input: PermissionPendingModel.PermissionDecisionInput) => {
    const perm = permissionRequest()
    if (!perm) return
    if (store.responding === perm.request.id) return

    setStore("responding", perm.request.id)
    PermissionPendingModel.decidePermission(sdk().client, input)
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description })
      })
      .finally(() => {
        setStore("responding", (id) => (id === perm.request.id ? undefined : id))
      })
  }

  return {
    blocked,
    questionRequest,
    permissionRequest,
    permissionResponding,
    decide,
  }
}

export type SessionComposerState = ReturnType<typeof createSessionComposerState>
