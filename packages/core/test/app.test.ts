import { expect, test } from "bun:test"
import { App } from "@omnixa/core/app"

test("formats app metadata as a user agent", () => {
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe("omnixa/beta/1.2.3/sdk")
})
