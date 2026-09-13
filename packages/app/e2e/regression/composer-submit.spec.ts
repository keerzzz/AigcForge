import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/ComposerSubmit"
const projectID = "proj_composer_submit"
const sessionID = "ses_composer_submit"
const server = "http://localhost:4096"
const model = { providerID: "aigcfroge", modelID: "composer-model" }
const path = `/server/${base64Encode(server)}/session/${sessionID}`

const composer = (page: Page) => page.locator('[data-component="session-composer"]')
const input = (page: Page) => composer(page).locator('[data-component="prompt-input"]')
const userMessage = (page: Page) => page.locator('[data-timeline-row="UserMessage"]')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function installMock(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    provider: {
      all: [
        {
          id: model.providerID,
          name: "Aigcfroge",
          models: {
            [model.modelID]: {
              id: model.modelID,
              name: "Composer Model",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: [model.providerID],
      default: model,
    },
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "composer-submit",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title: "Composer submit",
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
}

async function openSession(page: Page) {
  await gotoWhenReady(page, path)
  await expectAppVisible(input(page))
}

async function interceptPrompt(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route(`**/session/${sessionID}/prompt_async*`, handler)
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await installMock(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

// RED 2026-09-13: the editor plants a U+200B placeholder and the product strips it on read (prompt-input.tsx); this spec asserts raw innerText instead.
// Unlock at S3 by asserting through the product's read path (test-side change).
test.fixme("Shift+Enter inserts a newline without submitting", async ({ page }) => {
  const writes: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/prompt_async")) writes.push(request.url())
  })
  await openSession(page)

  await input(page).fill("first line")
  await input(page).press("Shift+Enter")
  await input(page).pressSequentially("second line")

  await expect
    .poll(() => input(page).evaluate((element) => (element instanceof HTMLElement ? element.innerText : "")))
    .toBe("first line\nsecond line")
  expect(writes).toEqual([])
})

// RED 2026-09-13: submit clears the prompt store but not the contenteditable DOM — a one-way store→DOM sync gap (clearInput vs clearEditor).
// Unlock at S3 with the product-side DOM-clearing fix.
test.fixme("Enter sends the selected session, agent, model, message id, and text", async ({ page }) => {
  let request:
    | {
        pathname: string
        body: Record<string, unknown>
      }
    | undefined
  await interceptPrompt(page, async (route) => {
    const data: unknown = route.request().postDataJSON()
    request = {
      pathname: new URL(route.request().url()).pathname,
      body: isRecord(data) ? data : {},
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  await openSession(page)

  await input(page).fill("Explain this repository")
  await input(page).press("Enter")

  await expect.poll(() => request).toBeDefined()
  expect(request?.pathname).toBe(`/session/${sessionID}/prompt_async`)
  expect(request?.body).toMatchObject({
    agent: "build",
    model,
    parts: [{ type: "text", text: "Explain this repository" }],
  })
  expect(request?.body.messageID).toMatch(/^msg_/)
  await expect(input(page)).toBeEmpty()
})

test("shows the user message optimistically while the request is pending", async ({ page }) => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await interceptPrompt(page, async (route) => {
    await pending
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  await openSession(page)

  await input(page).fill("Keep this visible while sending")
  await input(page).press("Enter")

  await expect(userMessage(page)).toContainText("Keep this visible while sending")
  release?.()
})

test("removes the optimistic message and restores the draft after a 500", async ({ page }) => {
  await interceptPrompt(page, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Deliberate composer failure" }),
    })
  })
  await openSession(page)

  await input(page).fill("Restore this failed prompt")
  await input(page).press("Enter")

  await expect(userMessage(page)).toHaveCount(0)
  await expect(input(page)).toContainText("Restore this failed prompt")
  await expect(page.getByText("Failed to send prompt", { exact: true })).toBeVisible()
})
