import { decode64 } from "@/utils/base64"

// P1-12: `useProviders` derived its directory from the router's `:dir` param alone.
//
// That is correct on the `/:dir/...` routes and silently wrong on the two routes
// where a Location is known but not spelled in the URL — the target Session route
// (`/session/:serverKey/:id`, whose directory comes from the resolved placement) and
// the draft route (whose directory comes from the DraftTab). On both, `params.dir` is
// empty, so `useProviders` fell through to the server-global provider list even
// though a project-scoped one existed.
//
// The SDK context is the Location owner (`app.tsx:166`, `:232`,
// `directory-layout.tsx:108` all provide it from the resolved directory), so it wins.
// The route param stays as the fallback because `useProviders` also runs ABOVE that
// provider: `ModelsProvider` (`app.tsx:311`/`:332`) wraps `Layout`, which is where
// `SDKProvider` is mounted, and `context/models.tsx` calls `useProviders` from there.
// That is a legitimate mounting, not a bug, which is why the SDK lookup has to be
// optional rather than `useSDK()`.

/**
 * The directory a provider list should be scoped to. Empty string means "no
 * Location", for which callers fall back to the server-global list.
 */
export function resolveProviderDirectory(input: {
  sdkDirectory: string | undefined
  routeParam: string | undefined
}): string {
  if (input.sdkDirectory) return input.sdkDirectory
  return decode64(input.routeParam) ?? ""
}
