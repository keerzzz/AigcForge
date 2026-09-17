/**
 * Location VCS state (plan §11.2): a non-Git Location must say "No VCS"
 * explicitly instead of leaving the review panel's branch row empty, while a Git
 * Location still shows its branch. The pair is the control — the statement
 * cannot be satisfied by hiding the bar in both cases.
 *
 * The non-Git case is two independent facts the mock can now express: the
 * project carries no `vcs` field (what the app's `nogit()`/`project.vcs` reads)
 * and `GET /vcs` answers `{}` (both branch fields undefined, as the real server
 * does for a directory with no repository; the mock's default would otherwise
 * advertise a `main` branch the Location does not have).
 */
import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/LocationVcsState"
const projectID = "proj_location_vcs_state"
const sessionID = "ses_location_vcs_state"
const title = "Location VCS state"
const server = "http://127.0.0.1:4096"
const path = `/server/${base64Encode(server)}/session/${sessionID}`

const noVcs = (page: Page) => page.locator('[data-component="git-status-bar-no-vcs"]')
const branch = (page: Page) => page.locator('[data-component="git-status-bar-branch"]')

async function installMock(page: Page, vcs: "git" | "none") {
  const project = {
    id: projectID,
    worktree: directory,
    name: "location-vcs-state",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    sandboxes: [],
  }
  await mockAigcfrogeServer(page, {
    directory,
    project: vcs === "git" ? { ...project, vcs: "git" as const } : project,
    ...(vcs === "git" ? {} : { vcs: {} }),
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

test("a non-Git Location states that there is no VCS", async ({ page }) => {
  await installMock(page, "none")
  await gotoWhenReady(page, path)
  await expectSessionTitle(page, title)

  await expectAppVisible(noVcs(page))
  await expect(noVcs(page)).toHaveText("No VCS")
  await expect(branch(page)).toHaveCount(0)
})

test("a Git Location still shows its branch", async ({ page }) => {
  await installMock(page, "git")
  await gotoWhenReady(page, path)
  await expectSessionTitle(page, title)

  await expectAppVisible(branch(page))
  await expect(branch(page)).toHaveText("main")
  await expect(noVcs(page)).toHaveCount(0)
})
