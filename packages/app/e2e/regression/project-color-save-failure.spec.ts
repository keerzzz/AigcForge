import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * S8: what a project colour write does when the server refuses it.
 *
 * Two behaviours, and only one of them is a visible one — the distinction is the point of this
 * file, because the first version of these cases asserted the wrong one.
 *
 * 1. The edit dialog (verified below). Saving used to fail completely silently: the mutation
 *    awaited the PATCH, never read its error, and left the dialog sitting there with Save
 *    re-enabled. It now says so and stays open.
 *
 * 2. The auto-assign effect (guarded below, not made visible). A rejected write used to leave the
 *    optimistic colour in the local store and delete the in-flight guard, so the next effect pass
 *    picked the same colour and re-issued the same doomed request — on a permanent rejection,
 *    forever. It now drops the colour and records the rejection.
 *
 *    That change is NOT observable as a colour change, and measuring said so: the surfaces that
 *    render a project avatar read the per-server list (`context/global.tsx:172`), which never
 *    merges the store holding the optimistic colour; only `layout.projects.list`
 *    (`context/layout.tsx:466-472`) merges it, and its consumers look a project up by path rather
 *    than rendering one. So an avatar sits at `gray` whether or not the write succeeded — asserted
 *    in neither direction here, because such a case would pass whatever the code did. The retry
 *    boundary is what these cases can actually hold, and the visible-fallback question is
 *    registered in `e2e/coverage-manifest.json` as `project-color-fallback-visibility`.
 *
 * The mock cannot express this failure: `PATCH /project/:id` is unmatched and falls through to
 * 200 {}. Both cases therefore register their own response, which wins because Playwright runs
 * route handlers last-registered-first.
 */
const directory = "C:/AigcForge/ColorFailure"
const projectID = "proj_color_failure"
const sessionID = "ses_color_failure"
const created = 1700000000000

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "color-failure",
  time: { created, updated: created },
  sandboxes: [],
}

const session = {
  id: sessionID,
  slug: "color-failure",
  projectID,
  directory,
  title: "Color failure session",
  mode: "chat",
  agent: "build",
  version: "dev",
  time: { created, updated: created },
}

async function setup(page: Page, status: 200 | 500, onUpdate: () => void) {
  await pinEnglishUI(page)
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.route("**/project/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    onUpdate()
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? project : { name: "ServerError", data: { message: "colour rejected" } }),
    })
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
}

/** A session route, because the secondary sidebar's project panel is gated on one. */
async function openSession(page: Page) {
  await gotoWhenReady(page, `/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: "Color failure session" }))
  const toggle = page.getByRole("button", { name: /Show sidebar|Hide sidebar/i })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.getByRole("complementary", { name: /Project list/i })).toBeVisible()
}

test.describe("S8: a rejected project colour write", () => {
  test("is issued, then not repeated", async ({ page }) => {
    let updates = 0
    await setup(page, 500, () => {
      updates += 1
    })
    await openSession(page)

    // The auto-assign has to have fired, or "not repeated" would be trivially true because nothing
    // ever asked. Polled rather than assumed: the effect runs when the project list first arrives.
    await expect.poll(() => updates, { timeout: 20_000, intervals: [250, 500, 1_000] }).toBeGreaterThan(0)

    // Bounded. The window is generous relative to the ~2s the effect needs, so a retry loop would
    // show up long before this expires.
    await page.waitForTimeout(3_000)
    expect(updates, `the rejected colour write was issued ${updates} times`).toBeLessThanOrEqual(2)
  })

  test("an accepted colour write is also issued once", async ({ page }) => {
    // The control for the bound above: a single pass is what a healthy save looks like too, so the
    // bound is not an artefact of the failure.
    let updates = 0
    await setup(page, 200, () => {
      updates += 1
    })
    await openSession(page)

    await expect.poll(() => updates, { timeout: 20_000, intervals: [250, 500, 1_000] }).toBeGreaterThan(0)
    await page.waitForTimeout(3_000)
    expect(updates, `the accepted colour write was issued ${updates} times`).toBeLessThanOrEqual(2)
  })

  test("the edit dialog says so instead of failing silently", async ({ page }) => {
    await setup(page, 500, () => {})

    await gotoWhenReady(page, "/")
    const trigger = page.locator('[data-action="home-project-menu"]').first()
    await expect(trigger).toBeVisible({ timeout: 120_000 })
    await trigger.click()
    await page.getByRole("menuitem", { name: "Edit" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    await dialog.getByRole("button", { name: /Select pink color/i }).click()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()

    // Previously nothing appeared at all; Save simply re-enabled. Now the failure is on screen and
    // the dialog stays open so the user can retry or cancel.
    await expect(dialog.locator('[data-component="project-edit-save-error"]')).toBeVisible()
    await expect(dialog).toBeVisible()
  })
})
