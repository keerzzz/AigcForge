import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/solid-query"
import type { QuestionV2Request } from "@aigcfroge/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { PermissionPendingModel } from "@/context/global-sync/permission-pending"
import { selectSessionRequest, sessionPendingRequests, type SessionActiveRequest } from "./session-request-tree"

export function createSessionComposerState() {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const permission = usePermission()

  const pendingRequests = createMemo(() =>
    sessionPendingRequests({
      session: sync().data.session,
      sessionID: params.id,
      question: sync().data.question,
      legacyPermission: sync().data.permission,
      v2Permission: sync().data.permission_v2,
      includeLegacyPermission: (item) => !permission.autoResponds(item, sdk().directory),
      scope: sdk().scope,
      directory: sdk().directory,
    }),
  )

  const [selection, setSelection] = createStore<{ key?: string }>({ key: undefined })
  const activeRequest = createMemo<SessionActiveRequest | undefined>((previous) =>
    selectSessionRequest(pendingRequests(), {
      selectedKey: selection.key,
      previousActiveKey: previous?.key,
    }),
  )
  createEffect(() => {
    const selected = selection.key
    if (!selected || pendingRequests().some((request) => request.key === selected)) return
    setSelection("key", undefined)
  })

  const selectRequest = (key: SessionActiveRequest["key"]) => {
    if (!pendingRequests().some((request) => request.key === key)) return
    setSelection("key", key)
  }

  const questionRequest = createMemo((): QuestionV2Request | undefined => {
    const active = activeRequest()
    return active?.domain === "question" ? active.request : undefined
  })

  const questionRequestKey = createMemo(() => {
    const active = activeRequest()
    return active?.domain === "question" ? active.key : undefined
  })

  // Keep the keyed dock mounted when unrelated pending requests change.
  const permissionRequest = createMemo<PermissionPendingModel.PermissionPending | undefined>(
    () => {
      const active = activeRequest()
      return active?.domain === "permission" ? active.request : undefined
    },
    undefined,
    { equals: (before, after) => before?.kind === after?.kind && before?.request === after?.request },
  )

  const permissionRequestKey = createMemo(() => {
    const active = activeRequest()
    return active?.domain === "permission" ? active.key : undefined
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const queryClient = useQueryClient()
  const mutationKey = createMemo(() => ["session-permission-decision", permissionRequestKey()] as const)
  const pending = useIsMutating(() => ({ mutationKey: mutationKey(), exact: true }))
  const permissionResponding = createMemo(() => !!permissionRequestKey() && pending() > 0)

  // The existing mutation cache outlives routed components; local responding
  // state would be lost when a pending decision's Session is visited again.
  const decision = useMutation(() => ({
    mutationKey: mutationKey(),
    mutationFn: (value: {
      client: Parameters<typeof PermissionPendingModel.decidePermission>[0]
      input: PermissionPendingModel.PermissionDecisionInput
    }) => PermissionPendingModel.decidePermission(value.client, value.input),
    onError: (err: unknown) => {
      const description = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description })
    },
  }))

  const decide = (input: PermissionPendingModel.PermissionDecisionInput) => {
    const perm = permissionRequest()
    if (!perm || !permissionRequestKey()) return
    if (
      input.request.kind !== perm.kind ||
      input.request.request.id !== perm.request.id ||
      input.request.request.sessionID !== perm.request.sessionID
    )
      return
    if (queryClient.isMutating({ mutationKey: mutationKey(), exact: true })) return
    decision.mutate({ client: sdk().client, input })
  }

  return {
    activeRequest,
    blocked,
    pendingRequests,
    questionRequest,
    questionRequestKey,
    permissionRequest,
    permissionResponding,
    decide,
    selectRequest,
  }
}

export type SessionComposerState = ReturnType<typeof createSessionComposerState>
