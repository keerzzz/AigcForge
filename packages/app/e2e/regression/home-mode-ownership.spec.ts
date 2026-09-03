import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Home session navigation and Product Mode ownership (S8).
 *
 * Replaces the last of the source-string assertions S0.5 deleted — the ones that
 * checked `layout/helpers.ts` did not contain `setMode?:` and that `home-overview.tsx`
 * did not contain `setMode: mode.setCurrentMode`. The property behind them is that
 * Home does not decide the mode: the canonical Session route does, from the session it
 * resolved. Confirmed structurally too — `setCurrentMode` has exactly three production
 * call sites, all in `app.tsx` (the Session route, the draft route, and the mode
 * route) and none in the Home path.
 *
 * The observable form: Home renders no ModeSwitcher at all and lists sessions of every
 * mode, and a session route shows the switcher pressed on the mode of the session it
 * resolved — even when the app's persisted last-mode says otherwise.
 *
 * The current mode is read off `ModeSwitcher`'s `aria-pressed`, which is the app's own
 * indicator (`mode-switcher.tsx:42-52`) rather than a marker added for the test.
 */
const directory = "C:/Aigcfroge/HomeModeOwnership"
const projectID = "proj_home_mode_ownership"
const chatSessionID = "ses_home_mode_chat"
const workSessionID = "ses_home_mode_work"
const chatTitle = "Chat seeded session"
const workTitle = "Work seeded session"

// Scoped to the ModeSwitcher nav on purpose: HomeOverview renders its own mode FILTER
// chips with the same accessible names, so an unscoped lookup is ambiguous.
const modeSwitcher = (page: Page) => page.getByRole("navigation", { name: "Mode switcher" })
const modeButton = (page: Page, name: string) => modeSwitcher(page).getByRole("button", { name, exact: true })
const homeRow = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

const session = (id: string, title: string, mode: string, created: number) => ({
  id,
  slug: id,
  projectID,
  directory,
  title,
  mode,
  agent: "meta",
  version: "dev",
  time: { created, updated: created },
})

async function openApp(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "home-mode-ownership",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      session(chatSessionID, chatTitle, "chat", 1700000000000),
      session(workSessionID, workTitle, "work", 1700000001000),
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    // Home only lists sessions from projects the user has OPENED, and nothing opens one
    // just because a session was visited (checked: no `projects.open` on that path). So
    // the opened list is seeded the way a returning user's would be — `Persist.global`
    // writes under `<GLOBAL_STORAGE>:server`, keyed by server scope.
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
  // Visiting a session first is what puts the project into the client-side opened list
  // a fresh profile does not have; Home lists nothing without it. It also leaves the
  // app in that session's mode, which is exactly the starting state this test wants.
  await page.goto(`/${base64Encode(directory)}/session/${chatSessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: chatTitle }))
}

test.describe("regression: Home is not a Product Mode surface", () => {
  test("Home shows no ModeSwitcher at all, and a session route shows it pressed on that session's mode", async ({
    page,
  }) => {
    // Measured, and it corrects the assumption this test started from: `/` does not
    // merely show every mode unpressed, it renders no switcher — `pages/layout.tsx:36`
    // gates `<ModeSwitcher />` behind `location.pathname !== "/"`. The identical check
    // inside `mode-switcher.tsx:42` is therefore belt-and-braces for a component that
    // never mounts there.
    await openApp(page)
    await expect(modeSwitcher(page)).toBeVisible()
    await expect(modeButton(page, "Chat")).toHaveAttribute("aria-pressed", "true")

    await page.goto("/")
    await expectAppVisible(homeRow(page, workTitle))
    await expect(modeSwitcher(page)).toHaveCount(0)
  })

  test("Home lists sessions of every mode, without adopting any of them", async ({ page }) => {
    // Home is mode-agnostic: both seeded sessions are listed whatever mode the app was
    // last in. Paired with the absence of a switcher above, this is the observable half
    // of "Home does not own Product Mode".
    await openApp(page)
    await page.goto("/")

    await expectAppVisible(homeRow(page, chatTitle))
    await expect(homeRow(page, workTitle)).toBeVisible()
  })

  test("a session route adopts that session's mode, not the mode the app was last in", async ({ page }) => {
    // The other half: the mode a session opens in comes from the SESSION, not from
    // whatever the app was showing. `openApp` leaves the app in chat (it visits the chat
    // session), and `currentMode` is persisted, so on the next load chat is the default
    // the Session route has to overrule.
    //
    // Reached by URL rather than by clicking the Home row, and that is a finding rather
    // than a shortcut: the click is wedged. Measured — the row's handler runs to
    // completion (`openSessionRecord` adds the tab and calls `navigate()` with the right
    // href) but `history` is never written and the old DOM stays up for at least 24s,
    // because `@solidjs/router` writes history in the `.finally()` of a Solid transition
    // and that transition never resolves. Stubbing out `<Session />` makes the very same
    // click land, and so does neutering `Transition.promises.add`, so the transition is
    // held by a resource inside the session page. See technical-debt: it is pre-existing,
    // it is not what this spec is for, and asserting the mode through a URL visit pins
    // the same property without depending on it.
    await openApp(page)
    await expect(modeButton(page, "Chat")).toHaveAttribute("aria-pressed", "true")

    await page.goto(`/${base64Encode(directory)}/session/${workSessionID}`)
    await expectAppVisible(page.getByRole("heading", { name: workTitle }))

    await expect(modeButton(page, "Work")).toHaveAttribute("aria-pressed", "true")
    await expect(modeButton(page, "Chat")).toHaveAttribute("aria-pressed", "false")
  })
})
