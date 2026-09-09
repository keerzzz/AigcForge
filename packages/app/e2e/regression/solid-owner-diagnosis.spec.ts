import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"

// English-label, desktop-geometry spec — pin the UI language and viewport so the
// zh/zht and narrow presentation projects stay green (see utils/locale.ts, utils/viewport.ts).
test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

/**
 * S8b diagnosis for D-SOLID-OWNER — reactive graph nodes created with no owner.
 *
 * The 2026-09-03 dogfood run recorded these two on the console (`report.md:248-249`):
 *
 *   cleanups created outside a createRoot or render will never be run
 *   computations created outside a createRoot or render will never be disposed
 *
 * Solid emits them in dev only. They mean a `createEffect`/`createMemo`/`onCleanup` ran with
 * no owner, so its disposal is never scheduled — a leak that grows with every mount, and in
 * production the warning is simply absent rather than the leak being absent.
 *
 * The plan named seven detached `createRoot` sites as candidates and forbade assuming a
 * culprit. Measured, it is none of them:
 *
 *   at showToastV2   packages/ui/src/v2/components/toast-v2.tsx:111
 *   at onError       packages/app/src/context/file.tsx:54
 *   at              packages/app/src/context/file/tree-store.ts:83
 *
 * `showToastV2` calls `children(() => opts.icon)` (`toast-v2.tsx:101`) before handing the JSX
 * to the toaster. `children` is a memo, so every toast raised from a plain callback — an error
 * handler, a mutation's `onError` — creates one with no owner. Four of them on a cold session
 * route, from the file tree's error path.
 *
 * That owner is outside this batch's changed files, which per the plan's stop conditions means
 * it is reported and not fixed here. See `docs/technical-debt.md`.
 *
 * So the assertion is scoped to what this slice can honestly hold: no ownerless node from
 * anywhere OTHER than that known site. It stays green when the toast is fixed and turns red if
 * a new site appears, which is the regression worth having.
 *
 * The full text of every offending warning is attached to the failure, which is what makes
 * this a diagnosis rather than a pass/fail bit. Only Solid's own message is collected — no
 * page content, no request bodies.
 */
/**
 * The one measured owner, reported in the debt ledger rather than fixed in this slice.
 *
 * The warning pattern itself lives inside `captureOwnerlessStacks`'s init script: that function
 * body is serialised into the page, so it cannot close over a constant from this module.
 */
const KNOWN_OWNERLESS = /toast-v2\.tsx/

const directory = "C:/Aigcfroge/SolidOwner"
const projectID = "proj_solid_owner"
const sessionID = "ses_solid_owner"
const title = "Solid owner diagnosis"
const created = 1700000000000
const userMessageID = "msg_user_solid_owner"

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [{ id: "prt_solid_owner", sessionID, messageID: userMessageID, type: "text", text: "Explain this repo." }],
}

declare global {
  interface Window {
    __ownerlessStacks?: string[]
  }
}

/**
 * Record the JS stack at the moment Solid warns.
 *
 * The `console` event alone only reports solid-js's own frame, which names the messenger and
 * not the caller. Wrapping `console.warn` in the page keeps the original behaviour and adds
 * the stack, which under Vite's source maps points at the module that created the node.
 */
async function captureOwnerlessStacks(page: Page) {
  await page.addInitScript(() => {
    window.__ownerlessStacks = []
    const original = console.warn.bind(console)
    console.warn = (...args: unknown[]) => {
      const first = typeof args[0] === "string" ? args[0] : ""
      if (/created outside a `?createRoot`? or `?render`?/i.test(first)) {
        window.__ownerlessStacks?.push(new Error(first).stack ?? first)
      }
      original(...args)
    }
  })
}

const readStacks = (page: Page) => page.evaluate(() => window.__ownerlessStacks ?? [])

async function setup(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "solid-owner",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "solid-owner",
        projectID,
        directory,
        title,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: [userMessage] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
}

test.describe("diagnosis: no ownerless reactive nodes on the routes this batch changed", () => {
  test("a session route creates no ownerless computation or cleanup", async ({ page }) => {
    await captureOwnerlessStacks(page)
    await setup(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    // The context tab is the child-tab path S8a measured, and it mounts the session's own
    // command registration and side panel.
    await page.getByRole("button", { name: "View context usage" }).click()
    await expect(page.getByRole("tab", { name: "Context" })).toBeVisible()

    const unknown = (await readStacks(page)).filter((stack) => !KNOWN_OWNERLESS.test(stack))
    expect(unknown, unknown.join("\n===\n")).toEqual([])
  })

  test("switching modes creates no ownerless computation or cleanup", async ({ page }) => {
    // Mode switching is what mounts and unmounts every slot, so it is where a detached
    // `createRoot` in a slot's own tree would show up.
    await captureOwnerlessStacks(page)
    await setup(page)

    await page.goto("/mode/coding")
    await expectAppVisible(page.locator('[data-mode-main="coding"]'))
    for (const mode of ["chat", "work", "assistant", "custom", "coding"]) {
      await page.goto(`/mode/${mode}`)
      await expectAppVisible(page.locator(`[data-mode-main="${mode}"]`))
    }

    const unknown = (await readStacks(page)).filter((stack) => !KNOWN_OWNERLESS.test(stack))
    expect(unknown, unknown.join("\n===\n")).toEqual([])
  })
})
