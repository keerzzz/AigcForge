import { afterAll, beforeAll } from "bun:test"

/**
 * Enables the custom-mode kill switch for the whole file and restores the prior
 * value afterwards.
 *
 * `ProductModePolicy.assertRuntimeSupported` fails closed for `custom` while the
 * flag is off, and `SessionV2.create` asserts it for every custom session
 * (children included). A file that creates custom sessions therefore has to own
 * the flag: relying on another test file to have left it set makes the suite
 * pass or fail on file ordering, which is exactly how these tests passed locally
 * and failed in CI.
 */
export function withCustomModeEnabled() {
  let saved: string | undefined
  beforeAll(() => {
    saved = process.env["AIGCFROGE_CUSTOM_MODE"]
    process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
  })
  afterAll(() => {
    if (saved === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
    else process.env["AIGCFROGE_CUSTOM_MODE"] = saved
  })
}
