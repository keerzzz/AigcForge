import { useServerSync } from "@/context/server-sync"
import { useSDKOptional } from "@/context/sdk"
import { resolveProviderDirectory } from "@/hooks/provider-location"
import { useParams } from "@solidjs/router"
import { Iterable, pipe } from "effect"
import { createMemo } from "solid-js"

export const popularProviders = [
  "aigcfroge",
  "aigcfroge-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const serverSync = useServerSync()
  const params = useParams()
  // The SDK context is the Location owner; the route param is the fallback for the
  // shell above it. See provider-location.ts for why the lookup is optional.
  const sdk = useSDKOptional()
  const dir = createMemo(() => resolveProviderDirectory({ sdkDirectory: sdk?.().directory, routeParam: params.dir }))
  const providers = () => {
    if (dir()) {
      const [projectStore] = serverSync().child(dir())
      if (projectStore.provider_ready) return projectStore.provider
    }
    return serverSync().data.provider
  }
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () =>
      pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => popularProviderSet.has(p.id)),
        (v) => Array.from(v),
      ),
    connected: () => {
      const connected = new Set(providers().connected)
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return Array.from(
        Iterable.filter(
          providers().all,
          ([id]) =>
            connected.has(id) &&
            (id !== "aigcfroge" || Object.values(providers().all.get(id)?.models ?? {}).some((m) => m.cost?.input)),
        ),
      )
    },
  }
}
