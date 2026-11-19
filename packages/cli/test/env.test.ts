import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.AIGCFROGE_PASSWORD
  const previousLegacyPassword = process.env.AIGCFROGE_SERVER_PASSWORD
  const previousValue = process.env.AIGCFROGE_SESSION_ENV_TEST
  process.env.AIGCFROGE_PASSWORD = "password"
  process.env.AIGCFROGE_SERVER_PASSWORD = "legacy"
  process.env.AIGCFROGE_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.AIGCFROGE_PASSWORD
  else process.env.AIGCFROGE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.AIGCFROGE_SERVER_PASSWORD
  else process.env.AIGCFROGE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.AIGCFROGE_SESSION_ENV_TEST
  else process.env.AIGCFROGE_SESSION_ENV_TEST = previousValue

  expect(environment.AIGCFROGE_PASSWORD).toBeUndefined()
  expect(environment.AIGCFROGE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.AIGCFROGE_SESSION_ENV_TEST).toBe("included")
})
