import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { LanguageProvider } from "@/context/language"
import { PlatformProvider } from "@/context/platform"
import { AssetLoadError } from "./asset-load-error"

describe("AssetLoadError accessibility", () => {
  test("announces the failure as an alert", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const dispose = render(
      () => (
        <PlatformProvider
          value={{
            platform: "web",
            openLink() {},
            restart: async () => {},
            back() {},
            forward() {},
            notify: async () => {},
          }}
        >
          <LanguageProvider locale="en">
            <AssetLoadError failed={["prompt"]} total={7} onRetry={() => {}} />
          </LanguageProvider>
        </PlatformProvider>
      ),
      container,
    )
    expect(container.querySelector('[data-slot="asset-load-error"]')?.getAttribute("role")).toBe("alert")
    dispose()
    container.remove()
  })
})
