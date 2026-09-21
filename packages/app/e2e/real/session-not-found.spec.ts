/**
 * E4 mock/real error-shape consistency (plan §7.2).
 *
 * E3 proves the app renders a typed session-not-found surface from a *mocked*
 * 404. This spec proves the production path end to end: the real backend emits
 * the same NotFoundError body, the production app build turns it into the same
 * typed surface, and a reload keeps it there instead of degrading to a blank
 * shell. The two field assertions here are intentionally duplicated from
 * e2e/regression/unknown-route.spec.ts — that duplication IS the consistency
 * check, so keep the pair in sync.
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"

const missingSessionID = "ses_e4_missing_session"

test("the real backend answers an unknown session with the documented NotFoundError shape", async ({ request }) => {
  const e4m = e4()

  const response = await request.get(
    `${e4m.backendUrl}/session/${missingSessionID}?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    { headers: { "x-aigcfroge-directory": e4m.workspaceDir } },
  )

  expect(response.status(), "real backend 404s an unknown session").toBe(404)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error("404 body is not an object")
  expect(body.name, "NotFoundError body name").toBe("NotFoundError")
  const data = body.data
  if (!isRecord(data)) throw new Error("404 body has no data object")
  expect(typeof data.message, "NotFoundError message is a string").toBe("string")
  expect(data.message).toContain(missingSessionID)
})

test("the app renders the typed session-not-found surface against the real backend, and keeps it across reload", async ({
  page,
}) => {
  const e4m = e4()
  seedRealBackend(page, e4m.backendUrl)

  const path = `/server/${base64Encode(e4m.backendUrl)}/session/${missingSessionID}`
  await page.goto(path)

  const surface = page.locator('[data-component="route-error"][data-route-error-kind="session-not-found"]')
  await expect(surface).toBeVisible()
  await expect(surface).toContainText(missingSessionID)
  await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`))
  // No tab may be claimed for a session the backend does not have.
  await expect(page.locator('[data-slot="titlebar-tabs"] a')).toHaveCount(0)

  await page.reload()
  await expect(surface).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})
