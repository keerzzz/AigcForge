/**
 * S6 App-consumption assertions (paired, as the review required): the agent picker
 * and the status bar both read server-owned data now, so each has one assertion
 * for the real contract and one for the state that used to be wrong.
 *
 *  - the picker used to be removed from the DOM entirely when `showCustomAgents`
 *    was off (the default), which is the S0-recorded defect;
 *  - the bar used to show no permission state at all, and must stay silent for the
 *    default `propose` tier while warning for `full`.
 */
import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/IdentityConsumers"
const projectID = "proj_identity_consumers"
const sessionID = "ses_identity_consumers"
const server = "http://127.0.0.1:4096"
const path = `/server/${base64Encode(server)}/session/${sessionID}`

const agentPicker = (page: Page) => page.locator('[data-action="prompt-agent"]')
const permissionChip = (page: Page) => page.locator('[data-component="status-bar-permission"]')

async function installMock(page: Page, permissionTier: "propose" | "full", showCustomAgents: boolean) {
  await page.addInitScript(
    ({ tier, show }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, showCustomAgents: show } }),
      )
      void tier
    },
    { tier: permissionTier, show: showCustomAgents },
  )
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "identity-consumers",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title: "Identity consumers",
        mode: "coding",
        agent: "build",
        permissionTier,
        model: { providerID: "session-provider", id: "session-model" },
        version: "dev",
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      },
    ],
    identity: {
      sessionID,
      mode: "coding",
      location: { directory },
      projectID,
      agent: "identity-agent",
      model: { status: "ready", value: { providerID: "identity-provider", modelID: "identity-model" } },
      permission: { declaredTier: permissionTier, effect: permissionTier === "full" ? "allow" : "ask" },
      capability: { health: "ready", reasons: [] },
      detail: {
        status: "ready",
        detail: {
          source: "coding",
          vcs: { branch: { status: "ready", value: "main" }, worktree: { status: "ready", value: directory } },
        },
      },
    },
    pageMessages: () => ({ items: [] }),
  })
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

test("keeps the agent picker visible when custom agents are switched off", async ({ page }) => {
  await installMock(page, "propose", false)
  await gotoWhenReady(page, path)

  // The setting no longer deletes the control (S6): the mode policy decides which
  // agents exist, and this assertion is the flip of the old "picker disappears" one.
  await expectAppVisible(agentPicker(page))
})

test("shows no permission chip for the default propose tier", async ({ page }) => {
  await installMock(page, "propose", false)
  await gotoWhenReady(page, path)

  // One loaded signal first, so a still-mounting bar cannot pass as "silent".
  await expectAppVisible(agentPicker(page))
  await expect(permissionChip(page)).toHaveCount(0)
})

test("warns in the status bar for the full tier, with the reason-bearing label", async ({ page }) => {
  await installMock(page, "full", false)
  await gotoWhenReady(page, path)

  const chip = permissionChip(page)
  await expectAppVisible(chip)
  await expect(chip).toHaveAttribute("data-kind", "full")
  await expect(chip).toHaveAttribute("aria-label", /Permission state: Full access/)
})

test("renders the session header from the identity projection, not the session record", async ({ page }) => {
  await installMock(page, "full", false)
  await gotoWhenReady(page, path)

  const header = page.locator('[data-component="session-product-header"]')
  await expectAppVisible(header)
  await expect(header.locator('[data-field="mode"]')).toHaveText("Coding")
  await expect(header.locator('[data-field="location"]')).toHaveText("IdentityConsumers")
  await expect(header.locator('[data-field="agent"]')).toHaveText("identity-agent")
  await expect(header.locator('[data-field="model"]')).toHaveText("identity-provider/identity-model")

  await header.getByText("Session details").click()
  await expect(header.locator('[data-field="permission"]')).toContainText("Full access")
  await expect(header.locator('[data-field="health"]')).toHaveText("Health: ready")
  await expect(header.locator('[data-field="detail"]')).toContainText("main")
})
