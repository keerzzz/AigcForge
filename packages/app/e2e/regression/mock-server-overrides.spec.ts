import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type { SessionMessagesResponse, SessionMessagesResponses } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer, type MockCanonicalMessageQuery } from "../utils/mock-server"
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
 * Absent read overrides preserve the default projections. Project writes now
 * update a registration-local projection unless a response override is supplied.
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

test("absent knobs serve default reads and the updated project", async ({ page }) => {
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
      projectUpdate: await read("/project/proj_mock_overrides", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      capabilities: await read("/experimental/capabilities"),
    }
  })

  expect(result.projects).toEqual({ status: 200, body: [project] })
  expect(result.vcs).toEqual({ status: 200, body: { branch: "main", default_branch: "main" } })
  expect(result.path).toEqual({
    status: 200,
    body: { state: directory, config: directory, worktree: directory, directory, home: "C:/Aigcfroge" },
  })
  expect(result.file).toEqual({ status: 200, body: [] })
  expect(result.projectUpdate).toEqual({
    status: 200,
    body: { ...project, time: { ...project.time, updated: expect.any(Number) } },
  })
  expect(result.capabilities).toEqual({
    status: 200,
    body: {
      backgroundSubagents: false,
      chatAsset: false,
      customMode: false,
      productModes: ["chat", "coding", "work", "assistant", "custom"],
      customCompositionVersion: 1,
      canonicalSessionModes: ["assistant", "custom"],
    },
  })
})
;(["same-origin", "separate-origin"] as const).forEach((topology) => {
  test(`mock API contracts serve pending JSON and empty canonical history on ${topology}`, async ({
    page,
  }, testInfo) => {
    const url = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000")
    if (topology === "separate-origin") url.port = url.port === "4096" ? "4097" : "4096"
    await mockAigcfrogeServer(page, {
      port: url.port,
      directory,
      project,
      provider: { all: [], connected: [], default: {} },
      sessions: [session],
      pageMessages: () => ({ items: [] }),
    })
    // A document navigation must still reach the frontend when API and app share an origin.
    const document = await page.goto("/")
    expect(document?.status()).toBe(200)
    expect(document?.headers()["content-type"]).toContain("text/html")

    expect.soft(await readMockResponse(page, new URL("/schedule/pending", url).href)).toEqual({
      status: 200,
      contentType: "application/json",
      nextCursor: null,
      body: "[]",
    })
    expect
      .soft(await readMockResponse(page, new URL(`/api/session/${sessionID}/message?limit=25&order=asc`, url).href))
      .toEqual({
        status: 200,
        contentType: "application/json",
        nextCursor: null,
        body: JSON.stringify({ data: [], cursor: {} } satisfies SessionMessagesResponse),
      })
    expect.soft(await readMockResponse(page, new URL("/api/session/ses_missing/message", url).href)).toMatchObject({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        _tag: "SessionNotFoundError",
        sessionID: "ses_missing",
        message: "Session not found: ses_missing",
      }),
    })
    expect
      .soft(await readMockResponse(page, new URL(`/api/session/${sessionID}/message?cursor=unknown`, url).href))
      .toMatchObject({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ _tag: "InvalidCursorError", message: "Invalid cursor" }),
      })
    expect
      .soft(
        await readMockResponse(page, new URL(`/api/session/${sessionID}/message?cursor=unknown&order=desc`, url).href),
      )
      .toMatchObject({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ _tag: "InvalidCursorError", message: "Cursor cannot be combined with order" }),
      })
    for (const query of ["limit=0", "limit=201", "limit=1.5", "limit=invalid", "order=sideways"]) {
      expect(
        await readMockResponse(page, new URL(`/api/session/${sessionID}/message?${query}`, url).href),
      ).toMatchObject({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          _tag: "InvalidRequestError",
          message: "Invalid message pagination query",
          kind: "Query",
        }),
      })
    }
  })

  test(`mock API contracts keep canonical pagination separate from legacy history on ${topology}`, async ({
    page,
  }, testInfo) => {
    const url = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000")
    if (topology === "separate-origin") url.port = url.port === "4096" ? "4097" : "4096"
    const legacy = [
      {
        info: {
          id: "msg_legacy_only",
          sessionID,
          role: "user",
          time: { created },
          agent: "build",
          model: { providerID: "fixture", modelID: "fixture" },
        },
        parts: [
          { id: "prt_legacy_only", sessionID, messageID: "msg_legacy_only", type: "text", text: "Legacy history" },
        ],
      },
    ] satisfies SessionMessagesResponses[200]
    const newest = {
      data: [{ id: "msg_canonical_new", type: "user", text: "New canonical history", time: { created: created + 1 } }],
      cursor: { previous: "canonical-start", next: "canonical-older" },
    } satisfies SessionMessagesResponse
    const oldest = {
      data: [{ id: "msg_canonical_old", type: "user", text: "Old canonical history", time: { created } }],
      cursor: { previous: "canonical-newer", next: "canonical-end" },
    } satisfies SessionMessagesResponse
    const reads: MockCanonicalMessageQuery[] = []
    const config = {
      port: url.port,
      directory,
      project,
      provider: { all: [], connected: [], default: {} },
      sessions: [session, { ...session, id: "ses_canonical_other" }],
      pageMessages: (_sessionID: string, _limit: number, before?: string) =>
        before ? { items: [] } : { items: legacy, cursor: "legacy-end" },
      // Canonical data is explicit. The legacy { info, parts } callback cannot supply this protocol.
      canonicalMessages: (input: (typeof reads)[number]): SessionMessagesResponse => {
        reads.push(input)
        if (input.cursor === "canonical-start" || input.cursor === "canonical-end") return { data: [], cursor: {} }
        if (input.cursor === "canonical-older") return oldest
        if (input.order === "asc") return oldest
        return newest
      },
    }
    await mockAigcfrogeServer(page, config)
    await page.goto("/")

    const legacyPage = await readMockResponse(page, new URL(`/session/${sessionID}/message?limit=1`, url).href)
    expect(legacyPage).toMatchObject({ status: 200, contentType: "application/json", body: JSON.stringify(legacy) })
    expect(legacyPage.nextCursor).toBeTruthy()

    const canonicalURL = new URL(`/api/session/${sessionID}/message`, url)
    const first = await readMockResponse(page, `${canonicalURL}?limit=1&order=desc`)
    expect(first).toEqual({
      status: 200,
      contentType: "application/json",
      nextCursor: null,
      body: JSON.stringify(newest),
    })
    expect(await readMockResponse(page, canonicalURL.href)).toEqual(first)
    expect(
      await readMockResponse(
        page,
        new URL(`/api/session/ses_canonical_other/message?cursor=${newest.cursor.next}`, url).href,
      ),
    ).toEqual({
      status: 200,
      contentType: "application/json",
      nextCursor: null,
      body: JSON.stringify({ data: [], cursor: {} } satisfies SessionMessagesResponse),
    })
    expect(await readMockResponse(page, `${canonicalURL}?limit=1&cursor=${newest.cursor.next}`)).toEqual({
      status: 200,
      contentType: "application/json",
      nextCursor: null,
      body: JSON.stringify(oldest),
    })
    expect(await readMockResponse(page, `${canonicalURL}?limit=1&cursor=${oldest.cursor.previous}`)).toEqual(first)
    expect(await readMockResponse(page, `${canonicalURL}?limit=1&cursor=${oldest.cursor.next}`)).toEqual({
      status: 200,
      contentType: "application/json",
      nextCursor: null,
      body: JSON.stringify({ data: [], cursor: {} } satisfies SessionMessagesResponse),
    })
    expect(await readMockResponse(page, `${canonicalURL}?limit=1&order=asc`)).toMatchObject({
      status: 200,
      body: JSON.stringify(oldest),
    })
    expect(await readMockResponse(page, `${canonicalURL}?cursor=${legacyPage.nextCursor}`)).toMatchObject({
      status: 400,
      body: JSON.stringify({ _tag: "InvalidCursorError", message: "Invalid cursor" }),
    })
    expect(
      await readMockResponse(page, new URL(`/session/${sessionID}/message?before=${legacyPage.nextCursor}`, url).href),
    ).toEqual({ status: 200, contentType: "application/json", nextCursor: null, body: "[]" })
    expect(reads).toEqual([
      { sessionID, limit: 1, order: "desc" },
      { sessionID, limit: 50, order: "desc" },
      { sessionID, limit: 1, cursor: newest.cursor.next },
      { sessionID, limit: 1, cursor: oldest.cursor.previous },
      { sessionID, limit: 1, cursor: oldest.cursor.next },
      { sessionID, limit: 1, order: "asc" },
    ])
  })

  test(`an absent project override returns the project for ${topology} writes`, async ({ page }, testInfo) => {
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
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      return { status: response.status, body: await response.json() }
    }, url.toString())
    expect(result).toEqual({
      status: 200,
      body: { ...project, time: { ...project.time, updated: expect.any(Number) } },
    })
  })
})

function readMockResponse(page: Page, url: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url)
    return {
      status: response.status,
      contentType: response.headers.get("content-type")?.split(";")[0],
      nextCursor: response.headers.get("x-next-cursor"),
      body: await response.text(),
    }
  }, url)
}

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
