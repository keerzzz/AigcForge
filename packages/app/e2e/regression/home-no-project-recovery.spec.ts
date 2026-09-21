import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * S6, the recovery half of P2-HOME-EMPTY — "new session" from a Home with no opened project.
 *
 * `home-empty-new-session.spec.ts:83-108` asserts the negative half of this branch: the click
 * must produce feedback, must not POST `/session`, and must stay on `/`. The branch itself
 * (`home-overview.tsx:191-227`) is never driven there — with no directory it opens the project
 * picker, and the callback on the picked directory opens that project and starts the draft.
 * This spec drives that branch and asserts the three consequences the product promises:
 *
 *   1. no session is created on the way (the draft is a client-side route),
 *   2. the picked directory is registered in the persisted project registry
 *      (`aigcfroge.global.dat:server`) and the persisted draft tab holds it, and
 *   3. the app renders the draft surface it navigated to.
 *
 * MEASURED 2026-09-17 (this spec is RED at the last assertion, deliberately — see below):
 * (1), (2) and the URL half of (3) all hold. The draft *surface* does not: after the row
 * click the URL is `/new-session?draftId=<uuid>` and the registry and tab are written, but
 * Home stays mounted and `[data-component="prompt-input"]` never appears.
 *
 * Measured with a temporary network dump inside this spec, not inferred:
 *   - the browser never issues a request for the lazy `new-session` module at all
 *     (`page.on("request")` for any URL containing `new-session`: `seen: []`, and Resource
 *     Timing has no `/src/pages/new-session.tsx` entry), so the route component never ran;
 *   - the route Suspense fallback never appeared either (`surface-pending: 0`), and no
 *     console error or page error was raised (`logs: []`);
 *   - `page.reload()` on the same URL renders the draft correctly (the persisted draft is
 *     valid, and `new-session-route.spec.ts` passes against the same build with a seeded tab);
 *   - clicking the same Home "New session" affordance a second time — now with a directory
 *     available, so the picker is skipped and the same `openNewSession` ->
 *     `launchModeSessionOrRoute` -> `tabs.newDraft` -> `navigate` chain runs from a plain
 *     click handler — navigates AND renders the draft (`home: 0`, `prompt-input: 1`).
 * What is NOT pinned: the mechanism (`DirtyDraftGuard`'s `useBeforeLeave` is installed at
 * `app.tsx:695` and `navigate` cannot commit while a leave handler prevents it, but on Home
 * no tab key is registered as dirty, so that is a hypothesis this spec does not decide).
 * The failure is therefore reported as measured behaviour, not as a diagnosed cause.
 *
 * Driving notes, all read from source rather than assumed:
 * - Which picker the browser gets is decided at `directory-picker.tsx:19-43`: native is
 *   desktop + local server only, `DialogSelectDirectoryV2` is desktop, and web falls to the
 *   legacy List-based `DialogSelectDirectory`. The dev entry is `platform: "web"`
 *   (`entry.tsx:122-123`), so this drives the legacy picker — proven by its own placeholder
 *   ("Search folders"), not by a marker added for the test.
 * - The legacy picker renders Windows paths in their backslash spelling
 *   (`directory-picker-domain.ts:318-322`) and keys each row's fuzzysort `search` field with
 *   that spelling (`dialog-select-directory.tsx:27-39`), so a forward-slash path typed into
 *   the search box matches nothing — the test types the backslash form a Windows user would.
 * - A typed absolute path is the only branch that reads `GET /file`; an empty or segment-only
 *   filter goes to `GET /find/file`, which this mock does not serve. The `files` knob feeds
 *   `GET /file`, and the mock answers the same listing for every directory — so the seeded
 *   listing carries one directory node per path segment the picker walks:
 *   `C:/` → `Aigcfroge` → `HomeNoProjectRecovery`.
 */
const directory = "C:/Aigcfroge/HomeNoProjectRecovery"
// What a user types into the picker and what the row is keyed by: same path, display spelling.
const typedDirectory = "C:\\Aigcfroge\\HomeNoProjectRecovery"
const projectID = "proj_home_no_project_recovery"
const created = 1_700_000_000_000

/** Separator/case-insensitive comparison, the same equivalence `pathKey` implements. */
const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "")

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "home-no-project-recovery",
  time: { created, updated: created },
  sandboxes: [],
}

// One directory node per walked segment. The picker filters by `name` when walking
// (`directory-picker-domain.ts:341-362`) and by the row's `search` field when displaying.
const listing = [
  { name: "Aigcfroge", path: "Aigcfroge", absolute: "C:/Aigcfroge", type: "directory", ignored: false },
  {
    name: "HomeNoProjectRecovery",
    path: "HomeNoProjectRecovery",
    absolute: directory,
    type: "directory",
    ignored: false,
  },
]

async function persisted(page: Page, key: string) {
  return page.evaluate((name) => {
    const raw = localStorage.getItem(name)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  }, key)
}

/**
 * Walk the parsed JSON rather than assert a shape at it.
 *
 * `persisted` returns whatever `JSON.parse` produced, so the reads below are structural walks over
 * `unknown`. A cast would silence the linter and prove nothing about the payload it claims to
 * describe, which is the one thing this spec must not do — the payload is the evidence.
 */
function collectWorktrees(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectWorktrees(item, found)
    return found
  }
  if (typeof value !== "object" || value === null) return found
  for (const [key, entry] of Object.entries(value)) {
    if (key === "worktree" && typeof entry === "string") found.push(entry)
    else collectWorktrees(entry, found)
  }
  return found
}

/** The draft directories the shell persisted, read the same way. */
function collectDraftDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const found: string[] = []
  for (const tab of value) {
    if (typeof tab !== "object" || tab === null) continue
    let type: unknown
    let directory: unknown
    for (const [key, entry] of Object.entries(tab)) {
      if (key === "type") type = entry
      if (key === "directory") directory = entry
    }
    if (type === "draft" && typeof directory === "string") found.push(directory)
  }
  return found
}

async function persistedWorktrees(page: Page, key: string) {
  return collectWorktrees(await persisted(page, key)).map(normalize)
}

async function persistedDraftDirectories(page: Page, key: string) {
  return collectDraftDirectories(await persisted(page, key)).map(normalize)
}

test.describe("regression: Home new session recovers from having no project", () => {
  test("picking a directory registers the project and opens the draft", async ({ page }) => {
    await pinEnglishUI(page)
    await pinDesktopViewport(page)

    const sessionPosts: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "POST") return
      if (new URL(request.url()).pathname !== "/session") return
      sessionPosts.push(request.url())
    })

    await mockAigcfrogeServer(page, {
      directory,
      project,
      provider: {
        all: [
          {
            id: "aigcfroge",
            name: "Aigcfroge",
            models: { "test-model": { id: "test-model", name: "Test Model", limit: { context: 200_000 } } },
          },
        ],
        connected: ["aigcfroge"],
        default: { providerID: "aigcfroge", modelID: "test-model" },
      },
      sessions: [],
      pageMessages: () => ({ items: [] }),
      events: () => [],
      eventRetry: 16,
      files: listing,
    })

    await page.addInitScript(() => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      // The server knows a project; what is empty is the client-side opened list. That
      // separation is the point: this is a fresh profile against a healthy backend.
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [], projects: { local: [] }, lastProject: {} }),
      )
    })

    await gotoWhenReady(page, "/")
    await expectAppVisible(page.locator('[data-component="home-overview"]'))

    await page.locator('[data-component="home-overview"]').locator('[data-action="home-new-session"]').click()

    // The recovery step the sibling spec stops short of: the picker, not a dead end.
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText("Open project")).toBeVisible()
    // The web picker is the List-based one; its placeholder is the app's own text.
    const search = dialog.getByPlaceholder("Search folders")
    await expect(search).toBeVisible()

    await search.fill(typedDirectory)

    const row = page.locator('[data-slot="list-item"]').filter({ hasText: "HomeNoProjectRecovery" })
    await expect(row).toHaveCount(1, { timeout: 10_000 })
    await row.click()

    // (1) The draft is a client-side route; the session is created on its first send.
    expect(sessionPosts).toEqual([])

    // (2) The picked directory is registered in the persisted project registry.
    await expect
      .poll(async () => persistedWorktrees(page, "aigcfroge.global.dat:server"), { timeout: 10_000 })
      .toContain(normalize(directory))

    // ...and the draft tab the product opened holds that same directory, not a default.
    await expect
      .poll(async () => persistedDraftDirectories(page, "aigcfroge.global.dat:tabs"))
      .toContain(normalize(directory))

    // (3) The app is on the draft route it navigated to...
    await expect(page).toHaveURL(/\/new-session\?draftId=/)

    // ...and this is where it stops today: the route is never rendered, so the draft surface
    // is absent even though the URL, the registry and the tab above all agree it exists.
    // The message carries the measurement so a failure is read as the pinned defect rather
    // than as a broken test. Do not relax it into the URL assertion above.
    await expect(
      page.locator('[data-component="prompt-input"]'),
      "PINNED DEFECT (P2-HOME-EMPTY recovery): the picked directory is registered and the URL is " +
        "/new-session?draftId=..., but the draft surface never mounts — Home stays rendered and the lazy " +
        "new-session module is never requested. A page reload on this URL renders the draft; the same Home " +
        "action clicked again (picker skipped) renders it too. This assertion is the reproduction.",
    ).toBeVisible({ timeout: 30_000 })
  })
})
