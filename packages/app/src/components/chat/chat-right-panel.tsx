import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { diffLines } from "diff"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useNavigate } from "@solidjs/router"
import { useProposeCandidate, setProposeCandidate, setApplying, setApplied } from "./prompt-asset-store"
import { normalizeProposeCandidate } from "./prompt-asset-candidate"
import type { Part, PromptAssetSummary } from "@aigcfroge/sdk/v2/client"

// SDK Part.state 是 union;normalizeProposeCandidate 期望 V1/V2 tool state 结构。
// 第三方类型逃逸,注释原因(AGENTS.md No Cheating:兼容第三方类型逃逸必须注释)。
type ToolState = { input: Record<string, unknown>; output?: string; structured?: Record<string, unknown> }

/** 在会话所有消息的 parts 里找首个完成的 propose_prompt_asset 结果。 */
function findProposeResult(messages: { id: string }[], partsByMsg: Record<string, Part[] | undefined>) {
  for (const msg of messages) {
    const parts = partsByMsg[msg.id]
    if (!parts) continue
    for (const part of parts) {
      if (part.type !== "tool") continue
      if (part.tool !== "propose_prompt_asset") continue
      if (part.state.status !== "completed") continue
      return normalizeProposeCandidate({ tool: part.tool, state: part.state as unknown as ToolState })
    }
  }
  return null
}

type DiffLine = { type: "add" | "del" | "eq"; text: string }

/** 用 diff 库 diffLines(Myers O(ND),无稠密矩阵)做行级 diff。复用已有依赖(E1)。 */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const change of diffLines(oldText, newText)) {
    const lines = change.value.split("\n")
    // diffLines 的 value 末尾常含 \n,split 产生空尾,去掉
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const type: DiffLine["type"] = change.added ? "add" : change.removed ? "del" : "eq"
    for (const text of lines) out.push({ type, text })
  }
  return out
}

export function ChatRightPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const navigate = useNavigate()
  const candidate = useProposeCandidate()
  const [searchQuery, setSearchQuery] = createSignal("")
  const [openAssets, setOpenAssets] = createSignal<string[]>([])
  const [activeTab, setActiveTab] = createSignal<string>("preview")
  const [deletingPath, setDeletingPath] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  // per-asset 编辑槽(Map),避免编辑第二资产丢第一未保存编辑(F5)
  const [editingPath, setEditingPath] = createSignal<string | null>(null)
  const [editedTemplates, setEditedTemplates] = createSignal<Record<string, string>>({})
  // TODO: 768px 应引用 v2 断点常量(D6);当前 v2 未暴露常量,暂字面量
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const [treeOpen, setTreeOpen] = createSignal(false)
  let sessionLayout: ReturnType<typeof useSessionLayout> | undefined

  try {
    sessionLayout = useSessionLayout()
  } catch {
    // Not inside a session layout
  }

  // Detect propose results:sync.data.message[sessionID] -> 各 message 的 parts(F-critical 修复)
  createEffect(() => {
    if (!sessionLayout) return
    const sessionID = sessionLayout.params.id
    if (!sessionID) return
    const data = sync().data as { message?: Record<string, { id: string }[] | undefined>; part?: Record<string, Part[] | undefined> }
    const messages = data.message?.[sessionID] ?? []
    const info = findProposeResult(messages, data.part ?? {})
    if (info && info.status !== "conflict") {
      setProposeCandidate(sessionID, info)
    }
  })

  const [result, { refetch }] = createResource(
    () => sdk().client,
    (client) => client.promptAsset.list(),
  )
  const assets = createMemo(() => result()?.data ?? [])

  const filteredAssets = createMemo(() => {
    const all = assets()
    if (!all) return []
    const q = searchQuery().toLowerCase()
    if (!q) return all
    return all.filter((a: PromptAssetSummary) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  })

  // Asset tab content:fetched on tab switch,暴露 refetch 供 editApply 后刷新(F4)
  const [assetContent, { refetch: refetchContent }] = createResource(activeTab, async (tab) => {
    if (tab === "preview") return null
    const r = await sdk().client.promptAsset.content({ path: tab })
    return r.data ?? null
  })

  // Existing asset template (overwrite diff when candidate.status === "exists")
  const [oldTemplate] = createResource(
    () => (candidate.candidate?.exists ? candidate.candidate?.relativePath : null),
    async (path: string) => {
      const r = await sdk().client.promptAsset.content({ path })
      return r.data?.template ?? ""
    },
  )
  // diff 用 createMemo,仅在 oldTemplate/candidate.template 变化时重算(E3)
  const diffLinesMemo = createMemo(() => {
    if (candidate.candidate?.status !== "exists") return null
    return computeDiff(oldTemplate() ?? "", candidate.candidate?.template ?? "")
  })

  const handleApply = async () => {
    const c = candidate.candidate
    if (!c || !candidate.sessionID || candidate.applying) return
    setApplying(true)
    try {
      await sdk().client.promptAsset.apply({
        sessionID: candidate.sessionID,
        candidate: { name: c.name, description: c.description, template: c.template, relativePath: c.relativePath },
        baseRevision: c.revision ?? undefined,
        overwrite: false,
      })
      setApplied()
      refetch()
    } catch (err) {
      console.error("Apply failed:", err)
      setApplying(false)
    }
  }

  const handleApplyOverwrite = async () => {
    const c = candidate.candidate
    if (!c || !candidate.sessionID || candidate.applying) return
    setApplying(true)
    try {
      await sdk().client.promptAsset.apply({
        sessionID: candidate.sessionID,
        candidate: { name: c.name, description: c.description, template: c.template, relativePath: c.relativePath },
        baseRevision: c.revision ?? undefined,
        overwrite: true,
      })
      setApplied()
      refetch()
    } catch (err) {
      console.error("Apply overwrite failed:", err)
      setApplying(false)
    }
  }

  const openAsset = (relativePath: string) => {
    if (!openAssets().includes(relativePath)) setOpenAssets([...openAssets(), relativePath])
    setActiveTab(relativePath)
  }

  const handleDelete = async (relativePath: string, revision: string | null) => {
    if (!sessionLayout?.params.id || deleting()) return
    setDeleting(true)
    try {
      await sdk().client.promptAsset.delete({
        sessionID: sessionLayout.params.id,
        relativePath,
        baseRevision: revision ?? undefined,
      })
      setOpenAssets(openAssets().filter((p) => p !== relativePath))
      if (activeTab() === relativePath) setActiveTab("preview")
      if (editingPath() === relativePath) {
        setEditingPath(null)
        setEditedTemplates((m) => {
          const next = { ...m }
          delete next[relativePath]
          return next
        })
      }
      setDeletingPath(null)
      refetch()
    } catch (err) {
      console.error("Delete failed:", err)
      setDeletingPath(null)
    } finally {
      setDeleting(false)
    }
  }

  const startEdit = (p: string) => {
    const info = assetContent()
    setEditingPath(p)
    setEditedTemplates((m) => ({
      ...m,
      [p]: m[p] ?? (info?.relativePath === p ? (info.template ?? "") : ""),
    }))
  }

  const cancelEdit = () => {
    const p = editingPath()
    if (p) {
      setEditedTemplates((m) => {
        const next = { ...m }
        delete next[p]
        return next
      })
    }
    setEditingPath(null)
  }

  const handleEditApply = async (p: string) => {
    if (!sessionLayout?.params.id || candidate.applying) return
    const info = assetContent()
    if (!info || info.relativePath !== p) return
    setApplying(true)
    try {
      await sdk().client.promptAsset.apply({
        sessionID: sessionLayout.params.id,
        candidate: {
          name: info.name,
          description: info.description,
          template: editedTemplates()[p] ?? "",
          relativePath: info.relativePath,
        },
        baseRevision: info.revision ?? undefined,
        overwrite: true,
      })
      setEditingPath(null)
      refetch()
      refetchContent()
    } catch (err) {
      console.error("Edit apply failed:", err)
    } finally {
      setApplying(false)
    }
  }

  const tabLabel = (p: string) => p.replace(/\.md$/, "")

  return (
    <aside class="relative flex h-full shrink-0 overflow-hidden border-l border-v2-border-border-base bg-v2-background-bg-base">
      {/* A 区:tab 工作区(预览 + 已打开资产) */}
      <div class="flex min-w-0 flex-1 flex-col">
        <Show when={!isDesktop()}>
          <div class="flex shrink-0 items-center border-b border-v2-border-border-base px-2 py-1">
            <ButtonV2 variant="ghost" size="small" onClick={() => setTreeOpen(true)}>
              <Icon name="list" size="small" />
              <span class="ml-1">{language.t("promptAsset.panel.title")}</span>
            </ButtonV2>
          </div>
        </Show>
        <TabsV2 value={activeTab()} onChange={setActiveTab} class="flex min-h-0 flex-1 flex-col">
          <TabsV2.List class="shrink-0">
            <TabsV2.Trigger value="preview">{language.t("promptAsset.tab.preview")}</TabsV2.Trigger>
            <For each={openAssets()}>{(p) => <TabsV2.Trigger value={p}>{tabLabel(p)}</TabsV2.Trigger>}</For>
          </TabsV2.List>

          {/* 预览 tab:候选预览 + apply */}
          <TabsV2.Content value="preview" class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={candidate.candidate && !candidate.applied}
              fallback={
                <Show
                  when={candidate.applied}
                  fallback={
                    <div class="p-4 text-center text-v2-text-text-muted text-12-regular">
                      {language.t("promptAsset.candidate.noCandidate")}
                    </div>
                  }
                >
                  <div class="p-3">
                    <span class="text-v2-state-fg-success text-12-semibold">{language.t("promptAsset.candidate.applied")}</span>
                  </div>
                </Show>
              }
            >
              <div class="flex h-full flex-col p-3">
                <div class="mb-1 truncate text-v2-text-text-base text-12-semibold">{candidate.candidate?.name}</div>
                <div class="mb-2 line-clamp-2 text-v2-text-text-muted text-12-regular">{candidate.candidate?.description}</div>
                <Show
                  when={candidate.candidate?.status === "valid"}
                  fallback={
                    <Show
                      when={candidate.candidate?.status === "exists"}
                      fallback={
                        <span class="mb-2 block shrink-0 text-v2-state-fg-warning text-12-regular">
                          {language.t("promptAsset.candidate.conflict")}
                        </span>
                      }
                    >
                      {/* exists: 旧↔新 diff + 显式覆盖确认(PRD §9.3) */}
                      <span class="mb-2 block shrink-0 text-v2-state-fg-warning text-12-regular">
                        {language.t("promptAsset.candidate.exists")}
                      </span>
                      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-v2-border-border-base">
                        <Show
                          when={!oldTemplate.loading && oldTemplate() !== undefined}
                          fallback={
                            <div class="p-2 text-v2-text-text-muted text-12-regular">
                              {language.t("promptAsset.panel.loading")}
                            </div>
                          }
                        >
                          <For each={diffLinesMemo() ?? []}>
                            {(line) => (
                              <div
                                class="flex px-1 font-mono text-12-regular"
                                classList={{
                                  "text-v2-state-fg-success": line.type === "add",
                                  "text-v2-state-fg-warning": line.type === "del",
                                  "text-v2-text-text-muted": line.type === "eq",
                                }}
                              >
                                <span class="shrink-0 select-none">
                                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                                </span>
                                <span class="whitespace-pre-wrap break-all">{line.text}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                      <div class="mt-2 shrink-0">
                        <ButtonV2
                          variant="contrast"
                          size="small"
                          class="w-full"
                          onClick={handleApplyOverwrite}
                          disabled={candidate.applying}
                        >
                          {candidate.applying ? language.t("promptAsset.candidate.applying") : language.t("promptAsset.candidate.apply")}
                        </ButtonV2>
                      </div>
                    </Show>
                  }
                >
                  {/* valid: 直接应用(overwrite=false) */}
                  <span class="mb-2 block shrink-0 text-v2-state-fg-success text-12-regular">
                    {language.t("promptAsset.candidate.valid")}
                  </span>
                  <div class="mt-auto shrink-0">
                    <ButtonV2
                      variant="contrast"
                      size="small"
                      class="w-full"
                      onClick={handleApply}
                      disabled={candidate.applying}
                    >
                      {candidate.applying ? language.t("promptAsset.candidate.applying") : language.t("promptAsset.candidate.apply")}
                    </ButtonV2>
                  </div>
                </Show>
              </div>
            </Show>
          </TabsV2.Content>

          {/* 资产 tab:查看/编辑两态(content API) */}
          <For each={openAssets()}>
            {(p) => (
              <TabsV2.Content value={p} class="min-h-0 flex-1 overflow-y-auto">
                <Show
                  when={assetContent()?.relativePath === p}
                  fallback={
                    <div class="p-4 text-center text-v2-text-text-muted text-12-regular">
                      {language.t("promptAsset.panel.loading")}
                    </div>
                  }
                >
                  <div class="flex h-full flex-col p-3">
                    <div class="mb-1 text-v2-text-text-base text-13-semibold">{assetContent()?.name}</div>
                    <div class="mb-3 text-v2-text-text-muted text-12-regular">{assetContent()?.description}</div>
                    <Show
                      when={editingPath() === p}
                      fallback={
                        <>
                          <pre class="min-h-0 flex-1 whitespace-pre-wrap break-words overflow-y-auto font-mono text-v2-text-text-base text-12-regular">
                            {assetContent()?.template}
                          </pre>
                          <div class="mt-2 flex shrink-0 gap-2">
                            <ButtonV2 variant="ghost" size="small" onClick={() => startEdit(p)}>
                              {language.t("common.edit")}
                            </ButtonV2>
                          </div>
                        </>
                      }
                    >
                      {/* 编辑态:受控 textarea + apply CAS（PRD §9.5/§8.3.1） */}
                      <textarea
                        class="min-h-0 flex-1 resize-none rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-2 font-mono text-v2-text-text-base text-12-regular outline-none focus:border-v2-border-border-focus"
                        aria-label={language.t("promptAsset.candidate.template")}
                        value={editedTemplates()[p] ?? ""}
                        onInput={(e) => setEditedTemplates((m) => ({ ...m, [p]: e.currentTarget.value }))}
                      />
                      <div class="mt-2 flex shrink-0 gap-2">
                        <ButtonV2 variant="contrast" size="small" onClick={() => handleEditApply(p)} disabled={candidate.applying}>
                          {candidate.applying ? language.t("promptAsset.candidate.applying") : language.t("promptAsset.candidate.apply")}
                        </ButtonV2>
                        <ButtonV2 variant="ghost" size="small" onClick={cancelEdit} disabled={candidate.applying}>
                          {language.t("common.cancel")}
                        </ButtonV2>
                      </div>
                    </Show>
                  </div>
                </Show>
              </TabsV2.Content>
            )}
          </For>
        </TabsV2>
      </div>

      {/* B 区:资产树(桌面固定 / 窄屏抽屉,PRD §9.6 A5) */}
      <Show when={isDesktop() || treeOpen()}>
      <div
        class="flex w-60 shrink-0 flex-col border-l border-v2-border-border-base bg-v2-background-bg-base"
        classList={{ "absolute inset-y-0 right-0 z-20 shadow-[var(--v2-elevation-raised)]": !isDesktop() }}
      >
        <Show when={!isDesktop()}>
          <div class="flex shrink-0 items-center justify-between border-b border-v2-border-border-base px-2 py-1">
            <span class="text-v2-text-text-base text-12-semibold">{language.t("promptAsset.panel.title")}</span>
            <ButtonV2 variant="ghost" size="small" onClick={() => setTreeOpen(false)} aria-label={language.t("common.close")}>
              <Icon name="close-small" size="small" />
            </ButtonV2>
          </div>
        </Show>
        <div class="flex items-center gap-2 border-b border-v2-border-border-base px-3 py-1.5">
          <input
            type="text"
            placeholder={language.t("promptAsset.list.searchPlaceholder")}
            aria-label={language.t("promptAsset.list.searchPlaceholder")}
            class="min-w-0 flex-1 bg-transparent text-v2-text-text-base text-12-regular outline-none placeholder:text-v2-text-text-faint"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <ButtonV2 variant="ghost" size="small" onClick={() => navigate("/mode/chat")} aria-label={language.t("promptAsset.panel.newPrompt")}>
            <Icon name="plus" size="small" />
          </ButtonV2>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <Show
            when={!result.loading}
            fallback={
              <div class="py-4 text-center text-v2-text-text-muted text-12-regular">
                {language.t("promptAsset.panel.loading")}
              </div>
            }
          >
            <Show
              when={filteredAssets().length > 0}
              fallback={
                <div class="py-4 text-center text-v2-text-text-muted text-12-regular">
                  {language.t("promptAsset.panel.noAssets")}
                </div>
              }
            >
              <For each={filteredAssets()}>
                {(asset: PromptAssetSummary) => (
                  <div class="group flex items-center rounded-md px-2 py-1.5 hover:bg-v2-overlay-simple-overlay-hover">
                    <Show
                      when={deletingPath() === asset.relativePath}
                      fallback={
                        <>
                          <button type="button" class="min-w-0 flex-1 text-left" onClick={() => openAsset(asset.relativePath)}>
                            <div class="truncate text-v2-text-text-base text-12-semibold">{asset.name}</div>
                            <div class="line-clamp-1 text-v2-text-text-muted text-11-regular">{asset.description}</div>
                          </button>
                          <button
                            type="button"
                            class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-opacity hover:text-v2-text-text-base group-hover:opacity-100"
                            onClick={() => setDeletingPath(asset.relativePath)}
                            aria-label={language.t("common.delete")}
                          >
                            <Icon name="trash" size="small" />
                          </button>
                        </>
                      }
                    >
                      {/* 删除二次确认(内联) */}
                      <div class="flex w-full items-center gap-1">
                        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-12-regular">
                          {language.t("promptAsset.asset.deleteConfirm")}
                        </span>
                        <ButtonV2 variant="ghost" size="small" onClick={() => setDeletingPath(null)} disabled={deleting()}>
                          {language.t("common.cancel")}
                        </ButtonV2>
                        <ButtonV2
                          variant="contrast"
                          size="small"
                          onClick={() => handleDelete(asset.relativePath, asset.revision ?? null)}
                          disabled={deleting()}
                        >
                          {language.t("common.delete")}
                        </ButtonV2>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
      </Show>
    </aside>
  )
}
