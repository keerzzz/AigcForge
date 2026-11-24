import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.OMNIXA_PASSWORD
  const previousLegacyPassword = process.env.OMNIXA_SERVER_PASSWORD
  const previousValue = process.env.OMNIXA_SESSION_ENV_TEST
  process.env.OMNIXA_PASSWORD = "password"
  process.env.OMNIXA_SERVER_PASSWORD = "legacy"
  process.env.OMNIXA_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.OMNIXA_PASSWORD
  else process.env.OMNIXA_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.OMNIXA_SERVER_PASSWORD
  else process.env.OMNIXA_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.OMNIXA_SESSION_ENV_TEST
  else process.env.OMNIXA_SESSION_ENV_TEST = previousValue

  expect(environment.OMNIXA_PASSWORD).toBeUndefined()
  expect(environment.OMNIXA_SERVER_PASSWORD).toBeUndefined()
  expect(environment.OMNIXA_SESSION_ENV_TEST).toBe("included")
})
