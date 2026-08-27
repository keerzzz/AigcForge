import { afterAll, beforeAll } from "bun:test"

const FLAG = "AIGCFROGE_CUSTOM_MODE"

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
    saved = process.env[FLAG]
    process.env[FLAG] = "true"
  })
  afterAll(() => {
    if (saved === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved
  })
}

/**
 * Runs `body` with the kill switch pinned to an explicit value, restoring the
 * ambient one even if `body` throws.
 *
 * Needed alongside the file-scoped helper because bun shares one process across
 * test files: a file that flips the flag inside a test body and never restores
 * it leaves every later file running against the wrong branch. Asserting
 * "disabled by default" is meaningless unless the test owns the variable rather
 * than inheriting whatever ran before it.
 */
export async function withCustomModeFlag<A>(value: string | undefined, body: () => A | Promise<A>): Promise<A> {
  const saved = process.env[FLAG]
  if (value === undefined) delete process.env[FLAG]
  else process.env[FLAG] = value
  try {
    return await body()
  } finally {
    if (saved === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved
  }
}
