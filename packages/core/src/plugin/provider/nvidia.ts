import { Effect } from "effect"
import { define } from "@aigcfroge/plugin/effect/plugin"

export const NvidiaPlugin = define({
  id: "aigcfroge.provider.nvidia",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@aigcfroge/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://integrate.api.nvidia.com/v1") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "HTTP-Referer": "https://aigcfroge.ai/",
            "X-Title": "aigcfroge",
            "X-BILLING-INVOKE-ORIGIN": provider.headers?.["X-BILLING-INVOKE-ORIGIN"] ?? "AigcForge",
          }
        })
      }
    })
  }),
})
