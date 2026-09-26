import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * The mock's optional overrides, proven to take effect.
 *
 * `MockServerConfig` gained five additive knobs so the S8 failure/shape cases are
 * expressible without every spec registering its own route:
 *
 *   `projects`         — GET /project is no longer pinned to `[config.project]`
 *   `projectUpdate`    — PATCH /project/:id is no longer an unmatched 200 `{}`
 *   `pathResponse`     — GET /path can answer a status/shape other than the projection
 *   `files`            — GET /file is no longer pinned to `[]`
 *   `vcs`              — GET /vcs is no longer pinned to `main`
 *
 * The other half of that contract — an absent knob answers byte-for-byte what the
 * mock answered before — is carried by the existing specs that read these routes
 * (home-empty-new-session, session-list-path-loading, session-files-route), whose
 * configs set none of these fields.
 */
const directory = "C:/Aigcfroge/MockServerOverrides"
const projectID = "proj_mock_overrides"
const sessionID = "ses_mock_overrides"
const created = 1700000000000

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "mock-overrides",
  time: { created, updated: created },
  sandboxes: [],
}

const secondProject = {
  id: "proj_mock_overrides_second",
  worktree: `${directory}/second`,
  vcs: "git",
  name: "mock-overrides-second",
  time: { created, updated: created },
  sandboxes: [],
}

const session = {
  id: sessionID,
  slug: sessionID,
  projectID,
  directory,
  title: "Mock overrides session",
  mode: "coding",
  agent: "build",
  version: "dev",
  time: { created, updated: created },
}

const listedFile = {
  name: "knob-listing.ts",
  path: "knob-listing.ts",
  absolute: `${directory}/knob-listing.ts`,
  type: "file",
  ignored: false,
}

test("absent knobs keep the previous answers byte-for-byte", async ({ page }) => {
  // Registered before the mock, so it only sees what the mock itself falls through
  // (Playwright runs the last-registered matching handler first). An absent knob
  // must leave PATCH /project/:id to that fall-through — i.e. unhandled by the mock —
  // rather than inventing an answer, which is the pre-knob behaviour.
  await page.route("**/project/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fellThrough: true }) })
      : route.fallback(),
  )
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })

  await gotoWhenReady(page, "/")

  const result = await page.evaluate(async () => {
    const read = async (input: string, init?: RequestInit) => {
      const response = await fetch(input, init)
      return { status: response.status, body: await response.json() }
    }
    return {
      projects: await read("/project"),
      vcs: await read("/vcs"),
      path: await read("/path"),
      file: await read("/file?path="),
      projectUpdate: await read("/project/proj_mock_overrides", { method: "PATCH" }),
    }
  })

  expect(result.projects).toEqual({ status: 200, body: [project] })
  expect(result.vcs).toEqual({ status: 200, body: { branch: "main", default_branch: "main" } })
  expect(result.path).toEqual({
    status: 200,
    body: { state: directory, config: directory, worktree: directory, directory, home: "C:/Aigcfroge" },
  })
  expect(result.file).toEqual({ status: 200, body: [] })
  expect(result.projectUpdate).toEqual({ status: 200, body: { fellThrough: true } })
})
;(["same-origin", "separate-origin"] as const).forEach((topology) => {
  test(`an absent project override still answers ${topology} SDK writes`, async ({ page }, testInfo) => {
    const url = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000")
    if (topology === "separate-origin") url.port = url.port === "4096" ? "4097" : "4096"
    url.pathname = `/project/${projectID}`
    url.searchParams.set("directory", directory)

    await mockAigcfrogeServer(page, {
      port: url.port,
      directory,
      project,
      provider: { providers: [], default: {} },
      sessions: [session],
      pageMessages: () => ({ items: [] }),
    })
    await gotoWhenReady(page, "/")

    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, { method: "PATCH" })
      return { status: response.status, body: await response.json() }
    }, url.toString())
    expect(result).toEqual({ status: 200, body: {} })
  })
})

test("the shape knobs answer /project, /vcs, /path, /file and PATCH /project/:id", async ({ page }) => {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    projects: [project, secondProject],
    vcs: { branch: "knob-branch", default_branch: "trunk" },
    files: [listedFile],
    pathResponse: { name: "NotFoundError", data: { message: `Directory not found: ${directory}` } },
    pathStatus: 404,
    projectUpdate: { name: "ServerError", data: { message: "project write rejected" } },
    projectUpdateStatus: 500,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })

  await gotoWhenReady(page, "/")

  // Read through the page: `page.route` intercepts page traffic, not the
  // APIRequestContext (same rationale as the mock-shape case in unknown-route.spec.ts).
  const result = await page.evaluate(async () => {
    const read = async (input: string, init?: RequestInit) => {
      const response = await fetch(input, init)
      return { status: response.status, body: await response.json() }
    }
    return {
      projects: await read("/project"),
      vcs: await read("/vcs"),
      path: await read(`/path?directory=${encodeURIComponent("C:/Aigcfroge/MockServerOverrides")}`),
      files: await read("/file?path="),
      projectUpdate: await read("/project/proj_mock_overrides", { method: "PATCH" }),
    }
  })

  expect(result.projects).toEqual({ status: 200, body: [project, secondProject] })
  expect(result.vcs).toEqual({ status: 200, body: { branch: "knob-branch", default_branch: "trunk" } })
  expect(result.path).toEqual({
    status: 404,
    body: { name: "NotFoundError", data: { message: `Directory not found: ${directory}` } },
  })
  expect(result.files).toEqual({ status: 200, body: [listedFile] })
  expect(result.projectUpdate).toEqual({
    status: 500,
    body: { name: "ServerError", data: { message: "project write rejected" } },
  })
})

test("a rejected project write reaches the edit dialog without a local route override", async ({ page }) => {
  await pinEnglishUI(page)
  await mockAigcfrogeServer(page, {
    directory,
    project,
    projectUpdate: { name: "ServerError", data: { message: "colour rejected" } },
    projectUpdateStatus: 500,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)

  await gotoWhenReady(page, "/")
  const trigger = page.locator('[data-action="home-project-menu"]').first()
  await expect(trigger).toBeVisible({ timeout: 120_000 })
  await trigger.click()
  await page.getByRole("menuitem", { name: "Edit" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: /Select pink color/i }).click()

  const write = page.waitForResponse(
    (response) => new URL(response.url()).pathname.startsWith("/project/") && response.request().method() === "PATCH",
  )
  await dialog.getByRole("button", { name: "Save", exact: true }).click()

  expect((await write).status()).toBe(500)
  // Previously unreachable against the mock: the write was a 200 `{}`, so the failure
  // surface could only be exercised by specs registering their own PATCH route.
  await expectAppVisible(dialog.locator('[data-component="project-edit-save-error"]'))
})

test("the /file listing knob populates the session file dialog", async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await mockAigcfrogeServer(page, {
    directory,
    project,
    files: [listedFile],
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await gotoWhenReady(page, `/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: "Mock overrides session" }))

  const panel = page.getByRole("complementary", { name: "Review and files" })
  await panel.getByRole("button", { name: "Open file", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expectAppVisible(dialog)
  // The dialog's root list comes from GET /file; the default `[]` leaves it empty.
  await expectAppVisible(dialog.getByText("knob-listing.ts", { exact: false }).first())
})
