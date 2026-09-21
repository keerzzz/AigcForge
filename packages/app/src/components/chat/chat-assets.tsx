/**
 * Chat asset owner (S3-3).
 *
 * One resource reads the seven project asset lists, merges the server-sync system
 * rows, and derives the per-kind counts. Two surfaces consume it — the Chat mode
 * workspace (`mode-workspace-slots.tsx`) and the session secondary sidebar
 * (`secondary-sidebar.tsx` → `ChatSessionSidebar` → `ChatFeatureList`) — and each
 * mounts this provider with the directory it means:
 *
 * - the workspace passes its mode directory, gated behind the `chatShown` latch so
 *   opening another mode does not issue Chat's requests (P2-14);
 * - the session sidebar passes the session's own directory.
 *
 * Both mount points are on sibling routes (`app.tsx`: `/mode/:mode` vs
 * `/server/:serverKey/session/:id`) and the sidebar only renders for `route.type ===
 * "session"`, so at most one provider is live with a directory at a time; the two
 * do not double-read while a route is on screen.
 *
 * S3-3 history, kept because both mistakes are easy to repeat:
 *
 * 1. The counts were previously computed twice — once here for the workbench, once
 *    in `ChatFeatureList` from its own resource. They agreed by construction
 *    (`systemCountFor` and `mergeAssets` are one shadow rule written twice; see
 *    `countAssetsByKind`), so the debt was duplicate requests, not divergent numbers.
 * 2. Removing the sidebar's own resource without giving the session sidebar a
 *    provider silently emptied its badges, because a defaultless `createContext`
 *    returns `undefined` instead of failing. `useChatAssets` therefore throws when
 *    no provider is above it: that failure has to be loud.
 *
 * The resource is keyed on `assetVersion()` so an applied asset candidate refreshes
 * the counts of both consumers — `prompt-asset-store.ts` documents that counter as
 * existing for exactly this ("Allows remote consumers (ChatFeatureSidebar counts) to
 * refetch"), and the workspace's own resource never read it before S3-3.
 */
import { createContext, createEffect, createMemo, createResource, createSignal, useContext } from "solid-js"
import type { Accessor, JSX } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import { useGlobal } from "@/context/global"
import { useServer, ServerConnection } from "@/context/server"
import type { State } from "@/context/global-sync/types"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "./asset-workbench"
import { assetVersion } from "./prompt-asset-store"
import type { AssetKindId } from "@aigcfroge/schema/asset"

type ChatAssetsValue = {
  dirSdk: Accessor<DirectorySDK | undefined>
  list: Accessor<
    { assets: AssetWorkbench.AssetInput[]; invalid: AssetWorkbench.AssetRow[]; failed: readonly string[] } | undefined
  >
  systemData: Accessor<State | undefined>
  merged: Accessor<{
    assets: AssetWorkbench.AssetInput[]
    invalid: AssetWorkbench.AssetRow[]
    failed: readonly string[]
  }>
  counts: Accessor<Partial<Record<AssetKindId, number>>>
  refetch: () => void
}

const Ctx = createContext<ChatAssetsValue>()

/**
 * Read the Chat asset owner. Throws outside `ChatAssetsProvider` on purpose — see
 * the module note about the silent-badge regression this replaced.
 */
export function useChatAssets(): ChatAssetsValue {
  const value = useContext(Ctx)
  if (!value) {
    throw new Error("useChatAssets must be used inside ChatAssetsProvider (see components/chat/chat-assets.tsx)")
  }
  return value
}

/** Optional read, for callers that legitimately render outside the owner. */
export function useChatAssetsOptional(): ChatAssetsValue | undefined {
  return useContext(Ctx)
}

export function ChatAssetsProvider(props: {
  /**
   * Which server this subtree belongs to. Required, not defaulted to the global
   * current server: a canonical URL can point at another server, and resolving the
   * directory against the wrong one silently issues the seven requests against that
   * other server (or returns nothing when its directory is unknown). The connection is
   * looked up from `server.list` by canonical key — the same resolution `app.tsx` uses
   * for the route — because `global.ensureServerCtx` takes a connection, not a key.
   */
  serverKey: Accessor<ServerConnection.Key | undefined>
  directory: Accessor<string | undefined>
  children: JSX.Element
}) {
  const sync = useServerSync()
  const global = useGlobal()
  const server = useServer()
  const chatCtx = createMemo(() => {
    const key = props.serverKey()
    if (!key) return undefined
    const conn = server.list.find((item) => ServerConnection.sameKey(key, ServerConnection.key(item)))
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })

  // ensureDirSdkContext registers cleanup hooks, so it must run under an effect that
  // disposes the previous directory context when the location changes.
  const [dirSdk, setDirSdk] = createSignal<DirectorySDK | undefined>()
  createEffect(() => {
    const dir = props.directory()
    const currentCtx = chatCtx()
    if (!dir || !currentCtx) {
      setDirSdk(undefined)
      return
    }
    setDirSdk(currentCtx.sdk.ensureDirSdkContext(dir))
  })

  // Command and MCP data load only when the child store opts into MCP bootstrap.
  const systemData = createMemo(() => {
    const dir = props.directory()
    if (!dir) return undefined
    return sync().child(dir, { mcp: true })[0]
  })

  const [list, { refetch }] = createResource(
    () => ({ sdk: dirSdk(), version: assetVersion() }),
    async (source) => {
      const sdk = source.sdk
      if (!sdk) return undefined
      // Each list is settled individually, so one failing endpoint contributes nothing
      // instead of rejecting the whole resource. That matters because `merged` below
      // reads this resource, and reading a rejected resource throws into the nearest
      // boundary — the fallback-less `<Suspense>` at `pages/layout.tsx:43`. A single
      // 500 therefore used to blank the entire mode workspace, for every mode. The
      // failed kinds feed the workbench's `AssetLoadError`.
      const settle = <T,>(call: Promise<T>): Promise<T | { data: undefined }> =>
        call.then(
          (value) => value,
          () => ({ data: undefined }),
        )
      const [promptsRes, skillsRes, mcpsRes, cmdsRes, agentsRes, workflowsRes, pluginsRes] = await Promise.all([
        settle(sdk.client.promptAsset.list()),
        settle(sdk.client.skillAsset.list()),
        settle(sdk.client.mcpAsset.list()),
        settle(sdk.client.commandAsset.list()),
        settle(sdk.client.agentAsset.list()),
        settle(sdk.client.workflowAsset.list()),
        settle(sdk.client.pluginAsset.list()),
      ])
      const failed = (
        [
          ["prompts", promptsRes],
          ["skills", skillsRes],
          ["mcp", mcpsRes],
          ["commands", cmdsRes],
          ["agents", agentsRes],
          ["workflows", workflowsRes],
          ["plugins", pluginsRes],
        ] as const
      ).flatMap(([kind, result]) => (result.data === undefined ? [kind] : []))
      const bridgedPluginInputs: AssetWorkbench.AssetInput[] = (pluginsRes.data?.bridged ?? []).map((plugin) => ({
        kind: "plugin" as const,
        name: plugin.name,
        description: plugin.description,
        relativePath: plugin.originPath,
        revision: "",
        origin: "system" as const,
      }))
      const allAssets: AssetWorkbench.AssetInput[] = [
        ...(promptsRes.data?.assets ?? []),
        ...(skillsRes.data?.assets ?? []),
        ...(mcpsRes.data?.assets ?? []),
        ...(cmdsRes.data?.assets ?? []),
        ...(agentsRes.data?.assets ?? []),
        ...(workflowsRes.data?.assets ?? []),
        ...(pluginsRes.data?.assets ?? []),
        ...bridgedPluginInputs,
      ]
      const invalidRows = AssetWorkbench.buildRows(
        [],
        [
          ...(promptsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "prompt" as const })),
          ...(skillsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "skill" as const })),
          ...(mcpsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "mcp" as const })),
          ...(cmdsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "command" as const })),
          ...(agentsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "agent" as const })),
          ...(workflowsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "workflow" as const })),
          ...(pluginsRes.data?.invalid ?? []).map((item) => ({ ...item, kind: "plugin" as const })),
        ],
      )
      return { failed, assets: allAssets, invalid: invalidRows }
    },
  )

  const merged = createMemo(() => {
    const project = list()
    const system = systemData()
    if (!project && !system) {
      const emptyAssets: AssetWorkbench.AssetInput[] = []
      const emptyInvalid: AssetWorkbench.AssetRow[] = []
      return { assets: emptyAssets, invalid: emptyInvalid, failed: [] as readonly string[] }
    }
    const assets = AssetWorkbench.mergeAssets(
      project?.assets ?? [],
      system
        ? AssetWorkbench.systemAssets({
            commands: system.command ?? [],
            agents: system.agent ?? [],
            mcp: system.mcp ?? {},
          })
        : [],
    )
    return { assets, invalid: project?.invalid ?? [], failed: (project?.failed ?? []) as readonly string[] }
  })

  const value: ChatAssetsValue = {
    dirSdk,
    list,
    systemData,
    merged,
    counts: createMemo(() => AssetWorkbench.countAssetsByKind(merged().assets)),
    refetch,
  }

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}
