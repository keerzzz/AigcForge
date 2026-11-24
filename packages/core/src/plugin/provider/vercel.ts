import { Effect } from "effect"
import { define } from "@omnixa/plugin/effect/plugin"
import { Provider } from "../../provider.js"

export const VercelPlugin = define({
  id: "omnixa.provider.vercel",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@ai-sdk/vercel") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "http-referer": "https://omnixa.ai/", "x-title": "omnixa" }
        })
      }
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/vercel") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/vercel"))
        evt.sdk = mod.createVercel(evt.options)
      }),
    )
  }),
})
