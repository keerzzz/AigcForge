import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/HeaderMatrix"
const projectID = "proj_session_product_header"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const created = 1_700_000_000_000

const cases = [
  {
    mode: "coding",
    health: "ready",
    detail: {
      status: "ready",
      detail: {
        source: "coding",
        vcs: {
          branch: { status: "ready", value: "main" },
          worktree: { status: "ready", value: directory },
        },
      },
    },
    expected: ["VCS", "main", "HeaderMatrix"],
  },
  {
    mode: "chat",
    health: "ready",
    detail: {
      status: "ready",
      detail: { source: "chat", assetCounts: [{ kind: "prompt", count: 2 }] },
    },
    expected: ["Prompts 2"],
  },
  {
    mode: "work",
    health: "ready",
    detail: {
      status: "ready",
      detail: {
        source: "work",
        contract: { source: "workflow", revision: "wf-revision" },
        artifact: { status: "ready", value: "artifact-revision" },
      },
    },
    expected: ["Workflow contract", "wf-revision", "artifact-revision"],
  },
  {
    mode: "assistant",
    health: "degraded",
    detail: {
      status: "ready",
      detail: {
        source: "assistant",
        scope: { kind: "personal" },
        reminders: { health: "ready", reasons: [] },
        memory: { health: "degraded", reasons: [{ code: "memory-scope-pending", severity: "warning" }] },
        knowledge: { health: "blocked", reasons: [{ code: "knowledge-scope-pending", severity: "critical" }] },
      },
    },
    reasons: [{ code: "assistant-detail-degraded", severity: "warning" }],
    expected: ["Personal scope", "Reminders", "Memory", "Knowledge"],
  },
  {
    mode: "custom",
    health: "blocked",
    detail: {
      status: "ready",
      detail: {
        source: "custom",
        snapshot: { digest: "snapshot-digest" },
        policy: { health: "blocked", reasons: [{ code: "custom-mode-disabled", severity: "critical" }] },
      },
    },
    reasons: [{ code: "custom-mode-disabled", severity: "critical" }],
    expected: ["snapshot-digest", "Policy", "Health: blocked"],
  },
] as const

const modeLabels = {
  coding: "Coding",
  chat: "Chat",
  work: "Work",
  assistant: "Assistant",
  custom: "Custom",
} as const

async function openSession(
  page: Page,
  item: (typeof cases)[number],
  onIdentity: () => void,
  identityOverrides: Record<string, unknown> = {},
) {
  const sessionID = `ses_header_${item.mode}`
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "session-product-header",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title: `Header ${item.mode}`,
        mode: item.mode,
        agent: "session-record-agent",
        model: { providerID: "session-provider", id: "session-model" },
        permissionTier: "propose",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    identity: {
      sessionID,
      mode: item.mode,
      location: { directory },
      projectID,
      agent: `identity-${item.mode}`,
      model: { status: "ready", value: { providerID: "identity-provider", modelID: `${item.mode}-model` } },
      permission: { declaredTier: "full", effect: "allow" },
      capability: { health: item.health, reasons: "reasons" in item ? item.reasons : [] },
      detail: item.detail,
      ...identityOverrides,
    },
    onIdentity,
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await gotoWhenReady(page, `/server/${base64Encode(server)}/session/${sessionID}`)
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

for (const item of cases) {
  test(`renders the ${item.mode} identity projection in the shared Session header`, async ({ page }) => {
    let identityReads = 0
    await openSession(page, item, () => identityReads++)

    const header = page.locator('[data-component="session-product-header"]')
    await expectAppVisible(header)
    await expect(header).toHaveAttribute("data-mode", item.mode)
    await expect(header).toHaveAttribute("data-health", item.health)
    await expect(header.locator('[data-field="mode"]')).toHaveText(modeLabels[item.mode])
    await expect(header.locator('[data-field="location"]')).toHaveText("HeaderMatrix")
    await expect(header.locator('[data-field="agent"]')).toHaveText(`identity-${item.mode}`)
    await expect(header.locator('[data-field="model"]')).toHaveText(`identity-provider/${item.mode}-model`)
    await expect(header).not.toContainText("session-record-agent")
    await expect(header).not.toContainText("session-model")

    await header.getByText("Session details").click()
    await expect(header.locator('[data-field="permission"]')).toContainText("Full access")
    await expect(header.locator('[data-field="health"]')).toHaveText(
      item.health === "ready" ? "Health: ready" : item.health === "degraded" ? "Health: degraded" : "Health: blocked",
    )
    for (const expected of item.expected) await expect(header.locator('[data-field="detail"]')).toContainText(expected)

    // Header and StatusBar both consume the same query key. A second request would prove they own
    // parallel identity fetches instead of sharing the projection cache.
    await expect.poll(() => identityReads).toBe(1)
  })
}

test("keeps a missing model distinct from healthy capability at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSession(page, cases[0], () => {}, {
    model: { status: "missing" },
    capability: { health: "ready", reasons: [] },
  })

  const header = page.locator('[data-component="session-product-header"]')
  await expectAppVisible(header)
  await expect(header).toHaveAttribute("data-health", "ready")
  await expect(header.locator('[data-field="model"]')).toHaveText("Missing")
  expect(
    await header.evaluate((element) => element.scrollWidth <= element.clientWidth),
    "the narrow Header must wrap rather than create horizontal overflow",
  ).toBe(true)
})
