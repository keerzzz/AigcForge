import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/ModeDetailPersonas"
const projectID = "proj_mode_detail_personas"
const workSessionID = "ses_persona_work"
const assistantSessionID = "ses_persona_assistant"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const canonicalPath = (sessionID: string) => `/server/${base64Encode(server)}/session/${sessionID}`

const provider = {
  all: [
    {
      id: "persona-provider",
      name: "Persona Provider",
      source: "config",
      env: [],
      options: {},
      models: {
        "persona-model": {
          id: "persona-model",
          name: "Persona Model",
          family: "persona",
          release_date: "2026-09-01",
          status: "active",
          options: {},
          headers: {},
          limit: { context: 200_000, output: 16_000 },
        },
      },
    },
  ],
  connected: ["persona-provider"],
  default: { "persona-provider": "persona-model" },
}

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "mode-detail-personas",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const sessions = [
  {
    id: workSessionID,
    slug: "persona-work",
    projectID,
    directory,
    title: "Persona Work session",
    mode: "work",
    agent: "meta",
    permissionTier: "propose",
    presetCategoryId: null,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  },
  {
    id: assistantSessionID,
    slug: "persona-assistant",
    projectID,
    directory,
    title: "Persona Assistant session",
    mode: "assistant",
    agent: "assistant-orchestrator",
    permissionTier: "propose",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  },
]

interface ClosureResult {
  logic: { closed: boolean; evidence: string }
  flow: { closed: boolean; evidence: string }
  interaction: { closed: boolean; evidence: string }
}

function attachClosure(testInfo: TestInfo, result: ClosureResult) {
  return testInfo.attach("logic-flow-interaction-closure", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })
}

async function mockPersonaServer(page: Page, onOverridePut?: () => void) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions,
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  for (const path of ["agent-asset", "prompt-asset", "skill-asset", "command-asset", "workflow-asset"]) {
    await page.route(`**/${path}?*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets: [], invalid: [] }),
      }),
    )
  }
  await page.route("**/custom-composition/plan*", (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        name: "UnsupportedProductModeError",
        message: "Custom mode is disabled on this server.",
      }),
    }),
  )
  for (const path of ["schedule/pending", "delivery/recent", "memory", "kb", "kb/dangling"]) {
    await page.route(`**/${path}*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    )
  }
  await page.route("**/session/*/permission-override", async (route: Route) => {
    if (route.request().method() === "PUT") {
      onOverridePut?.()
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":true}' })
    }
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false}' })
  })
}

async function configure(page: Page) {
  await pinEnglishUI(page)
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({
        list: [],
        projects: { local: [{ worktree, expanded: true }] },
        lastProject: {},
      }),
    )
  }, directory)
}

async function openSession(page: Page, sessionID: string, title: string) {
  await gotoWhenReady(page, canonicalPath(sessionID))
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 120_000 })
}

test.beforeEach(async ({ page }) => {
  await configure(page)
  await mockPersonaServer(page)
})

test.describe("persona audit: mode and detail closure", () => {
  test("first-time user understands Work, Assistant, and Custom entry gates", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [], projects: { local: [] }, lastProject: {} }),
      )
    })

    await test.step("logic: each mode exposes its own owner", async () => {
      await gotoWhenReady(page, "/mode/work")
      await expect(page.getByRole("heading", { name: "Work Presets" })).toBeVisible()
      await expect(page.locator('[data-mode-location="work"] button').filter({ hasText: "New Session" })).toBeDisabled()
      await expect(
        page.locator('[data-mode-main="work"] button').filter({ hasText: "clarifying questions" }).first(),
      ).toBeDisabled()

      await page.goto("/mode/assistant")
      await expect(page.getByRole("heading", { name: "Assistant Dashboard" })).toBeVisible()
      await expect(page.getByRole("button", { name: "New assistant chat" })).toBeEnabled()

      await page.goto("/mode/custom")
      await expect(page.getByText("Project Assets", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()
    })

    await test.step("flow: Add Project remains the common recovery route", async () => {
      await expect(page.getByRole("button", { name: "Add Project" })).toBeEnabled()
    })

    await test.step("interaction: Settings explains its five top-level areas without leaving Custom", async () => {
      await page.getByRole("button", { name: "Settings" }).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      for (const tab of ["General", "Shortcuts", "Servers", "Providers", "Models"]) {
        await dialog.getByRole("tab", { name: tab, exact: true }).click()
        await expect(dialog.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible()
      }
      await expect(page).toHaveURL(/\/mode\/custom$/)
      await page.keyboard.press("Escape")
    })

    await attachClosure(testInfo, {
      logic: {
        closed: false,
        evidence:
          "Assistant presents project selection and a personal dashboard at once; Custom exposes no server-capability identity.",
      },
      flow: {
        closed: false,
        evidence:
          "Work and Custom stop at disabled actions; Add Project is the only visible recovery route from the no-project state.",
      },
      interaction: {
        closed: true,
        evidence:
          "Settings explains all five areas, and the disabled Start Session now renders the start-gate blocker next to the control (custom-preview-column.tsx:171-181) instead of stopping silently.",
      },
    })
  })

  test("daily user can reopen Work and Assistant details after refresh", async ({ page }, testInfo) => {
    await test.step("logic: mode-specific panels follow durable session metadata", async () => {
      await openSession(page, workSessionID, "Persona Work session")
      await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toBeVisible()
      await expect(page.getByText("No draft yet. Ask the assistant to draft a document from a preset.")).toBeVisible()

      await openSession(page, assistantSessionID, "Persona Assistant session")
      await expect(page.locator('#review-panel[aria-label="Assistant panel"]')).toBeVisible()
    })

    await test.step("flow: canonical refresh restores both sessions", async () => {
      await page.reload()
      await expect(page.getByRole("heading", { name: "Persona Assistant session" })).toBeVisible({ timeout: 120_000 })
      await expect(page.locator('#review-panel[aria-label="Assistant panel"]')).toBeVisible()
    })

    await test.step("flow: Custom stops explicitly at its disabled start gate", async () => {
      await page.goto("/mode/custom")
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()
      // The gate used to disable Start with no explanation (the recorded S7 observation).
      // It now renders the blocker next to the control it belongs to, from the same
      // start gate that decides disabled — see custom-preview-column.tsx:171-181.
      // The mock answers the plan with UnsupportedProductModeError whose message carries
      // DISABLED_MESSAGE_MARKER, so classifyPlanFailure (custom-plan-state.ts:80-91) must
      // classify it as disabled and the gate must name `custom-disabled` — not `no-sdk`
      // or a generic `plan-failed`. Pinning the code is what makes this discriminating.
      const blocker = page.locator('[data-component="custom-start-blocker"]')
      await expect(blocker).toHaveAttribute("data-blocker", "custom-disabled")
      await expect(blocker).toHaveText("Custom mode is disabled on this server.")
    })

    await test.step("interaction: a daily Settings change survives close and reopen", async () => {
      const trigger = page.getByRole("button", { name: "Settings" })
      await trigger.click()
      const dialog = page.getByRole("dialog")
      const uiFont = dialog.getByRole("textbox", { name: "UI font" })
      await uiFont.fill("Persona Daily Font")
      await page.keyboard.press("Escape")
      await trigger.click()
      await expect(dialog.getByRole("textbox", { name: "UI font" })).toHaveValue("Persona Daily Font")
      await page.keyboard.press("Escape")
    })

    await attachClosure(testInfo, {
      logic: {
        closed: false,
        evidence:
          "Work accepts presetCategoryId=null while its artifact empty state assumes a preset; Assistant does not display personal/project scope.",
      },
      flow: {
        closed: false,
        evidence:
          "Work/Assistant details and Settings recovery pass, but the real Custom journey stops before a legal Session detail exists.",
      },
      interaction: {
        closed: false,
        evidence:
          "The identity header omits scope, preset, inherited model source, and other data needed to judge the session.",
      },
    })
  })

  test("reviewer can inspect Work output but cannot finish a review lifecycle", async ({ page }, testInfo) => {
    await openSession(page, workSessionID, "Persona Work session")

    await test.step("logic: output has a dedicated review surface", async () => {
      await page.getByRole("tab", { name: "Artifact", exact: true }).click()
      await expect(page.getByRole("tabpanel")).toContainText("No draft yet")
    })

    await test.step("flow: reviewer can return to context without losing the session", async () => {
      await page.getByRole("tab", { name: "Context" }).click()
      await expect(page).toHaveURL(new RegExp(`/session/${workSessionID}$`))
    })

    await test.step("logic: Assistant exposes operational evidence but no review state", async () => {
      await openSession(page, assistantSessionID, "Persona Assistant session")
      await expect(page.locator('#review-panel[aria-label="Assistant panel"]')).toBeVisible()
      await expect(page.locator('#review-panel[aria-label="Assistant panel"]')).toContainText("Reminders")
    })

    await test.step("flow: Custom diagnostics and Settings provider/model evidence remain inspectable", async () => {
      await page.goto("/mode/custom")
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()
      await page.getByRole("tab", { name: "Diagnostics" }).click()
      await expect(page.getByRole("tabpanel")).toBeVisible()

      await page.getByRole("button", { name: "Settings" }).click()
      const dialog = page.getByRole("dialog")
      for (const tab of ["Providers", "Models"]) {
        await dialog.getByRole("tab", { name: tab, exact: true }).click()
        await expect(dialog.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible()
      }
      await page.keyboard.press("Escape")
    })

    await attachClosure(testInfo, {
      logic: {
        closed: false,
        evidence:
          "Work has no artifact review state, Assistant has operational data but no reviewer lifecycle, and Custom has no legal detail to review.",
      },
      flow: {
        closed: false,
        evidence:
          "Context and Artifacts are reachable, but output feedback cannot proceed to fix, response, and resolution without a model turn.",
      },
      interaction: {
        closed: false,
        evidence:
          "The empty output surface only asks for preset-based generation even though this session has no preset.",
      },
    })
  })

  test("restricted user can cancel temporary full access without changing permission", async ({ page }, testInfo) => {
    let overridePuts = 0
    await page.unroute("**/session/*/permission-override")
    await mockPersonaServer(page, () => {
      overridePuts += 1
    })
    await openSession(page, workSessionID, "Persona Work session")

    await test.step("logic: acknowledgement gates escalation", async () => {
      await page.locator('[data-slot="permission-override-enable"]').click()
      const acknowledge = page.locator('[data-slot="permission-override-acknowledge"]')
      const enable = page
        .locator('[data-slot="permission-override-confirm-actions"] button')
        .filter({ hasText: "Enable" })
      await expect(acknowledge).not.toBeChecked()
      await expect(enable).toBeDisabled()
    })

    await test.step("flow and interaction: cancel is reversible and side-effect free", async () => {
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page.locator('[data-slot="permission-override-acknowledge"]')).toHaveCount(0)
      expect(overridePuts).toBe(0)
      await expect(page.locator('[data-slot="permission-override-enable"]')).toBeVisible()
    })

    await test.step("logic: Assistant uses the same reversible escalation boundary", async () => {
      await openSession(page, assistantSessionID, "Persona Assistant session")
      await page.locator('[data-slot="permission-override-enable"]').click()
      await expect(page.locator('[data-slot="permission-override-acknowledge"]')).not.toBeChecked()
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      expect(overridePuts).toBe(0)
    })

    await test.step("flow: blocked Custom permissions and global Settings are still inspectable", async () => {
      await page.goto("/mode/custom")
      await page.getByRole("tab", { name: "Permissions" }).click()
      await expect(page.getByRole("tabpanel")).toBeVisible()
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()

      await page.getByRole("button", { name: "Settings" }).click()
      const dialog = page.getByRole("dialog")
      await dialog.getByRole("tab", { name: "Servers", exact: true }).click()
      await expect(dialog.getByRole("tabpanel", { name: "Servers", exact: true })).toBeVisible()
      await page.keyboard.press("Escape")
    })

    await attachClosure(testInfo, {
      logic: {
        closed: false,
        evidence:
          "Work and Assistant share the acknowledged escalation boundary, but Custom cannot reach a Session permission owner and Settings has no restricted-role scope.",
      },
      flow: {
        closed: false,
        evidence:
          "Cancel is side-effect free in Work/Assistant; Custom remains blocked before detail while its permission preview and Settings Servers remain inspectable.",
      },
      interaction: {
        closed: true,
        evidence: "The dialog explains risk and keeps Enable disabled until acknowledgement.",
      },
    })
  })

  test("recovery user keeps unsent Work and Assistant drafts when staying", async ({ page }, testInfo) => {
    for (const item of [
      { id: workSessionID, title: "Persona Work session", draft: "Unsent Work persona draft" },
      { id: assistantSessionID, title: "Persona Assistant session", draft: "Unsent Assistant persona draft" },
    ]) {
      await openSession(page, item.id, item.title)
      const composer = page.getByRole("textbox", { name: "Ask anything, / for commands, @ for context..." })
      await composer.fill(item.draft)
      await page.getByRole("button", { name: "Home", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Unsaved content" })).toBeVisible()
      await page.getByRole("button", { name: "Stay" }).click()
      await expect(composer).toContainText(item.draft)
    }

    await test.step("flow: blocked Custom and transient Settings restore their last safe surfaces", async () => {
      await page.goto("/mode/custom")
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()
      await page.reload()
      await expect(page).toHaveURL(/\/mode\/custom$/)
      await expect(page.getByRole("button", { name: "Start Session" })).toBeDisabled()

      const trigger = page.getByRole("button", { name: "Settings" })
      await trigger.focus()
      await trigger.click()
      await expect(page.getByRole("dialog")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(trigger).toBeFocused()
    })

    await attachClosure(testInfo, {
      logic: {
        closed: false,
        evidence:
          "Dirty state is independent for Work/Assistant; Custom has no creatable Session state whose draft or recovery owner can be tested.",
      },
      flow: {
        closed: false,
        evidence:
          "Work/Assistant Stay and Settings focus recovery pass; Custom reloads its blocked Builder but cannot recover a Session detail.",
      },
      interaction: {
        closed: true,
        evidence: "Stay/Leave and Settings Escape/focus return are explicit and reversible.",
      },
    })
  })

  test("narrow keyboard user reaches the mode panels and can audit Settings", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await test.step("logic and flow: narrow session details are measured, not inferred", async () => {
      await gotoWhenReady(page, canonicalPath(workSessionID))
      await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible({ timeout: 120_000 })
      await expect(page.getByRole("heading", { name: "Persona Work session" })).toBeVisible({ timeout: 120_000 })
      await expect(page.getByRole("textbox", { name: "Ask anything, / for commands, @ for context..." })).toBeVisible()

      // S7 converted this from a pin of the DEFECT. It used to assert `toHaveCount(0)` below the
      // 768px gate — i.e. it recorded that a narrow user could not reach the panel at all. The
      // panel now exists at every width and is closed here, not absent.
      await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toHaveCount(0)
      await page.locator("#session-mode-panel-toggle").click()
      await expect(page.getByRole("tab", { name: "Artifact", exact: true })).toBeVisible()

      await page.goto(canonicalPath(assistantSessionID))
      await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible({ timeout: 120_000 })
      await expect(page.getByRole("heading", { name: "Persona Assistant session" })).toBeVisible({ timeout: 120_000 })
      await page.locator("#session-mode-panel-toggle").click()
      await expect(page.locator('#review-panel[aria-label="Assistant panel"]')).toBeVisible()
    })

    await test.step("interaction: Settings remains keyboard reachable at 390x844", async () => {
      await page.goto("/mode/coding")
      const trigger = page.getByRole("button", { name: "Settings" })
      await trigger.focus()
      await trigger.click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole("tab")).toHaveCount(5)
      const general = dialog.getByRole("tab", { name: "General", exact: true })
      await general.focus()
      await page.keyboard.press("ArrowDown")
      await expect(dialog.getByRole("tab", { name: "Shortcuts", exact: true })).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
    })

    await test.step("interaction: Custom names every control in keyboard order", async () => {
      await page.goto("/mode/custom")
      await expect(page.getByText("Project Assets", { exact: true })).toBeVisible()
      // The refresh and category-all controls used to render with no accessible name:
      // `common.refresh` / `common.all` were absent from every dictionary, so the
      // translator returned undefined and Solid omitted both the aria-label attribute
      // and the text node. The keys now exist, so the recorded defect must be gone.
      await expect(page.getByRole("button", { name: "Refresh" }).first()).toBeVisible()
      await expect(page.getByRole("button", { name: "All", exact: true }).first()).toBeVisible()
      const unlabeled = page.locator("button:visible:not([aria-label]):not([title])").filter({ hasText: /^$/ })
      await expect(unlabeled).toHaveCount(0)
    })

    await attachClosure(testInfo, {
      logic: {
        closed: true,
        evidence:
          "Narrow Work and Assistant preserve the session and composer, and the mode panel is closed rather than absent; opening it reveals the Artifact tab and the Assistant panel.",
      },
      flow: {
        closed: true,
        evidence:
          "A 390x844 user can read, compose, and reach the mode-specific output/assistant panels through the titlebar entry; Settings remains operable.",
      },
      interaction: {
        closed: true,
        evidence:
          "Custom names its refresh and category-all controls in keyboard order; Settings tabs and Escape/focus return pass.",
      },
    })
  })
})
