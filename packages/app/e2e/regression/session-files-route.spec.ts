import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/SessionFilesRoute"
const projectID = "proj_session_files_route"
const sessionID = "ses_session_files_route"
const title = "Session files route"
const server = "http://127.0.0.1:4096"
const canonicalPath = `/server/${base64Encode(server)}/session/${sessionID}`

const files = [
  { name: "alpha.ts", path: "src/alpha.ts", absolute: `${directory}/src/alpha.ts`, type: "file", ignored: false },
  { name: "broken.ts", path: "src/broken.ts", absolute: `${directory}/src/broken.ts`, type: "file", ignored: false },
  // Listed in search but the content route 404s it: models a file that vanished
  // between listing and reading (S6 missing-file contract).
  { name: "ghost.ts", path: "src/ghost.ts", absolute: `${directory}/src/ghost.ts`, type: "file", ignored: false },
  { name: "beta.ts", path: "src/beta.ts", absolute: `${directory}/src/beta.ts`, type: "file", ignored: false },
] as const

const source = {
  "src/alpha.ts": "export const alpha = 'alpha file content'",
  "src/beta.ts": "export const beta = 'beta file content'",
} as const

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "session-files-route",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
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
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

  await page.route("http://127.0.0.1:4096/file**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== "/file") return route.fallback()
    const path = url.searchParams.get("path")
    if (path === "") {
      return json(route, [
        { name: "src", path: "src", absolute: `${directory}/src`, type: "directory", ignored: false },
      ])
    }
    if (path === "src") return json(route, files)
    return json(route, [])
  })

  await page.route("**/find/file?**", async (route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get("query")?.toLowerCase() ?? ""
    const matches = files.map((file) => file.path).filter((path) => path.toLowerCase().includes(query))
    return json(route, matches)
  })

  await page.route("**/file/content?**", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path")
    if (path === "src/broken.ts") return json(route, { message: "Cannot read broken.ts" }, 500)
    if (path === "src/alpha.ts" || path === "src/beta.ts") {
      return json(route, { type: "text", content: source[path] })
    }
    return json(route, { name: "NotFoundError", data: { message: `File not found: ${path}` } }, 404)
  })

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await gotoWhenReady(page, canonicalPath)
  await expectSessionTitle(page, title)
})

test("opens a file from the canonical Session search and sends the SDK read contract", async ({ page }) => {
  const searchRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return request.method() === "GET" && url.pathname === "/find/file" && url.searchParams.get("query") === "alpha.ts"
  })
  const readRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      request.method() === "GET" && url.pathname === "/file/content" && url.searchParams.get("path") === "src/alpha.ts"
    )
  })

  await openFileFromSearch(page, "alpha.ts", source["src/alpha.ts"])

  const searchURL = new URL((await searchRequest).url())
  expect(searchURL.searchParams.get("dirs")).toBe("false")
  expect(searchURL.searchParams.get("directory")).toBe(directory)

  const request = await readRequest
  const requestURL = new URL(request.url())
  expect(request.postData()).toBeNull()
  expect(requestURL.searchParams.get("path")).toBe("src/alpha.ts")
  expect(requestURL.searchParams.get("directory")).toBe(directory)
  await expect(page).toHaveURL(new RegExp(`${canonicalPath}$`))
})

test("keeps multiple file tabs available and switches their displayed contents", async ({ page }) => {
  await openFileFromSearch(page, "alpha.ts", source["src/alpha.ts"])
  await openFileFromSearch(page, "beta.ts", source["src/beta.ts"])

  const alphaTab = fileTab(page, "alpha.ts")
  const betaTab = fileTab(page, "beta.ts")
  await expect(alphaTab).toBeVisible()
  await expect(betaTab).toHaveAttribute("aria-selected", "true")
  await expectFileSource(page, source["src/beta.ts"])

  await alphaTab.click()
  await expect(alphaTab).toHaveAttribute("aria-selected", "true")
  await expectFileSource(page, source["src/alpha.ts"])

  await betaTab.click()
  await expect(betaTab).toHaveAttribute("aria-selected", "true")
  await expectFileSource(page, source["src/beta.ts"])
})

test("a file missing on read shows the typed failure instead of an empty file", async ({ page }) => {
  await openFileFromSearch(page, "ghost.ts")

  const ghostTab = fileTab(page, "ghost.ts")
  await expect(ghostTab).toHaveAttribute("aria-selected", "true")
  // The server's typed message reaches the user, and the tab is an error state —
  // not a silently empty document (the contract this debt closed).
  await expectAppVisible(page.getByText(/File not found: src\/ghost\.ts/, { exact: false }).last())
  await expectAppVisible(page.getByText("Failed to load file", { exact: true }))
})

test("shows a failed read without contaminating a successfully loaded tab", async ({ page }) => {
  await openFileFromSearch(page, "alpha.ts", source["src/alpha.ts"])
  await openFileFromSearch(page, "broken.ts")
  const brokenTab = fileTab(page, "broken.ts")
  await expect(brokenTab).toHaveAttribute("aria-selected", "true")
  await expectAppVisible(page.getByText(/Cannot read broken\.ts/, { exact: false }).last())
  await expectAppVisible(page.getByText("Failed to load file", { exact: true }))

  const alphaTab = fileTab(page, "alpha.ts")
  await alphaTab.click()
  await expect(alphaTab).toHaveAttribute("aria-selected", "true")
  await expectFileSource(page, source["src/alpha.ts"])
  await expect(page.getByText(/Cannot read broken\.ts/, { exact: false })).toBeHidden()

  await brokenTab.click()
  await expect(brokenTab).toHaveAttribute("aria-selected", "true")
  await expectAppVisible(page.getByText(/Cannot read broken\.ts/, { exact: false }).last())
})

async function openFileFromSearch(page: Page, name: string, contents?: string) {
  const panel = page.getByRole("complementary", { name: "Review and files" })
  await panel.getByRole("button", { name: "Open file", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expectAppVisible(dialog)
  await dialog.getByPlaceholder("Search files").fill(name)
  await expectAppVisible(dialog.getByText(`src/${name}`, { exact: true }))
  await page.keyboard.press("Enter")
  await expectAppVisible(fileTab(page, name))
  if (contents) await expectFileSource(page, contents)
}

function fileTab(page: Page, name: string) {
  return page.getByRole("tab").filter({ hasText: name })
}

async function expectFileSource(page: Page, contents: string) {
  const file = page.locator('[data-component="file"][data-mode="text"]:visible')
  await expectAppVisible(file)
  await expect(file).toContainText(contents)
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}
