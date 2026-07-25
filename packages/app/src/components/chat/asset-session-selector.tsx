import { For, Show, createEffect, createMemo } from "solid-js"
import type { Session } from "@aigcfroge/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { modeDraft } from "@/context/mode"
import { useChatDirectory } from "@/components/mode-surfaces"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { sessionHref } from "@/utils/session-route"
import type { AssetRow } from "./asset-workbench"

/**
 * Insert 流程会话选择器：选已有会话或新建会话，将资产 template 注入 Composer（PRD §9.6）。
 * dialog.show 渲染（继承调用方 owner）。
 *
 * 两种路径：
 * - 已有会话 → navigate /server/:key/session/:id?insert=<path>
 * - 新建会话 → navigate /new-session?prompt=<template 内容>
 */
export function AssetSessionSelector(props: { asset: AssetRow }) {
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const tabs = useTabs()
  const sync = useServerSync()
  const { conn, ctx, directory } = useChatDirectory()

  const serverKey = createMemo(() => {
    const current = conn()
    return current ? ServerConnection.key(current) : undefined
  })

  // bootstrap 当前 Location 的 chat 会话
  createEffect(() => {
    const dir = directory()
    if (!dir) return
    void sync().project.loadSessions(dir, { mode: "chat" })
  })

  const sessions = createMemo(() => {
    const dir = directory()
    if (!dir) return [] as Session[]
    const store = sync().child(dir, { bootstrap: false })[0]
    return sortedRootSessions(store, Date.now()).filter((session) => (session.mode ?? "coding") === "chat")
  })

  function insertInto(session: Session) {
    const key = serverKey()
    if (!key) return
    navigate(`${sessionHref(key, session.id)}?insert=${encodeURIComponent(props.asset.relativePath)}`)
    dialog.close()
  }

  async function insertNewSession() {
    const dir = directory()
    const currentCtx = ctx()
    if (!dir || !currentCtx) return
    const key = serverKey()
    if (key == null) return

    // 取资产 template 内容（按 kind 分派 content API）
    const sdk = currentCtx.sdk.ensureDirSdkContext(dir)
    let template = ""
    try {
      const path = props.asset.relativePath
      // SDK 尚未重新生成（Info types 落后 schema），运行时 content/template 字段存在
      if (props.asset.kind === "prompt") {
        const res = await sdk.client.promptAsset.content({ path })
        template = res.data?.template ?? ""
      } else if (props.asset.kind === "skill") {
        const res = await sdk.client.skillAsset.content({ path })
        template = (res.data as { content?: string })?.content ?? ""
      } else if (props.asset.kind === "mcp") {
        const res = await sdk.client.mcpAsset.content({ path })
        template = (res.data as { content?: string })?.content ?? ""
      } else if (props.asset.kind === "command") {
        const res = await sdk.client.commandAsset.content({ path })
        template = (res.data as { content?: string })?.content ?? ""
      } else if (props.asset.kind === "agent") {
        const res = await sdk.client.agentAsset.content({ path })
        template = (res.data as { content?: string })?.content ?? ""
      }
    } catch {
      /* 静默失败 */
    }

    dialog.close()

    // 创建新 draft + 自动填充 template
    tabs.newDraft({
      server: key,
      directory: dir,
      ...modeDraft("chat"),
    }, template)
  }

  return (
    <Dialog title={language.t("promptAsset.insert.title")} description={language.t("promptAsset.insert.description")} fit>
      <div class="flex min-h-0 flex-col gap-px p-2" style={{ "max-height": "60vh" }}>
        {/* 新建会话入口 */}
        <button
          type="button"
          class="flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
          onClick={insertNewSession}
        >
          <Icon name="edit" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 flex-1 truncate text-13-regular">{language.t("promptAsset.insert.newSession")}</span>
        </button>

        {/* 分割线 */}
        <div class="my-1 mx-2 h-px bg-v2-border-border-base" />

        {/* 已有会话列表 */}
        <Show
          when={sessions().length > 0}
          fallback={
            <p class="px-3 py-6 text-center text-v2-text-text-muted text-12-regular">
              {language.t("promptAsset.insert.noSessions")}
            </p>
          }
        >
          <For each={sessions()}>
            {(session) => (
              <button
                type="button"
                class="flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                onClick={() => insertInto(session)}
              >
                <span class="min-w-0 flex-1 truncate text-13-regular">{session.title || session.id}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  )
}
