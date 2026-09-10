import { expect, test } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/Aigcfroge/DelegationRegression"
const sessionID = "ses_delegation_regression"
const childID = "ses_delegation_build"
const title = "Delegation regression"
const model = { providerID: "deepseek", modelID: "deepseek-v4-flas" }
const moreOptions = /^(More options|更多选项|更多選項)$/
const myAgents = /^(My agents|我的智能体|我的智能體)$/

test("shows independent delegation state and opens the Build conversation", async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: "proj_delegation",
      worktree: directory,
      vcs: "git",
      name: "Delegation",
      time: { created: 1, updated: 1 },
    },
    provider: {},
    sessions: [
      {
        id: sessionID,
        projectID: "proj_delegation",
        directory,
        title,
        version: "dev",
        time: { created: 1, updated: 1 },
      },
      {
        id: childID,
        parentID: sessionID,
        projectID: "proj_delegation",
        directory,
        title: "Build child",
        version: "dev",
        time: { created: 2, updated: 2 },
      },
    ],
    pageMessages: (requestedSessionID) => ({
      items:
        requestedSessionID === childID
          ? []
          : [
              {
                info: { id: "msg_user", sessionID, role: "user", time: { created: 1 }, agent: "build", model },
                parts: [{ id: "part_user", sessionID, messageID: "msg_user", type: "text", text: "delegate" }],
              },
            ],
    }),
    events: () => [],
    tasks: [
      {
        id: "tsk_delegate",
        content: "delegate",
        status: "pending",
        priority: "medium",
        sessionID,
        agentID: "build",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    delegations: [
      {
        delegation: {
          id: "dlg_ui",
          parentSessionID: sessionID,
          title: "Build and review",
          status: "recovery_required",
          rejectionBlocked: false,
          lastActivityAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        participants: [
          {
            id: "par_build",
            delegationID: "dlg_ui",
            provider: "internal",
            target: "build",
            role: "implementer",
            context: "fresh",
            phase: "active",
            childSessionID: childID,
            lastActivityAt: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "par_codex",
            delegationID: "dlg_ui",
            provider: "external",
            target: "codex",
            role: "reviewer",
            context: "fresh",
            phase: "active",
            externalThreadID: "thread_codex",
            lastActivityAt: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        turns: [
          {
            id: "trn_ui",
            delegationID: "dlg_ui",
            seq: 1,
            kind: "review",
            status: "recovery_required",
            participantIDs: ["par_build", "par_codex"],
            delivery: "steer",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        softExpired: false,
      },
    ],
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.locator("[data-session-title]").getByRole("button", { name: moreOptions }).click()
  await page.getByRole("menuitem", { name: myAgents }).click()
  const panel = page.locator('[data-component="delegation-panel"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-component="delegation-card"]')).toHaveAttribute("data-status", "recovery_required")
  await expect(panel.getByText("implementer: build")).toBeVisible()
  await expect(panel.getByText("reviewer: codex")).toBeVisible()
  await expect(panel.getByText("reviewer: codex")).toBeDisabled()
  await page.screenshot({ path: "e2e/test-results/delegation-panel-user-flow.png", fullPage: true })
  await panel.getByText("implementer: build").focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
  await expectSessionTitle(page, "Build child")
  expect(errors, `unexpected browser errors: ${errors.join(" | ")}`).toEqual([])
})

test("shows loading, empty, and error states as the delegation request settles", async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: "proj_delegation_states",
      worktree: directory,
      vcs: "git",
      name: "Delegation states",
      time: { created: 1, updated: 1 },
    },
    provider: {},
    sessions: [
      {
        id: sessionID,
        projectID: "proj_delegation_states",
        directory,
        title,
        version: "dev",
        time: { created: 1, updated: 1 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    tasks: [],
    delegations: [],
    delegationDelay: 250,
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.locator("[data-session-title]").getByRole("button", { name: moreOptions }).click()
  await page.getByRole("menuitem", { name: myAgents }).click()
  const panel = page.locator('[data-component="delegation-panel"]')
  await expect(panel.locator('[data-component="delegation-panel-loading"]')).toBeVisible()
  await expect(panel.locator('[data-component="delegation-panel-empty"]')).toBeVisible()

  await page.unroute("**/*")
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: "proj_delegation_states",
      worktree: directory,
      vcs: "git",
      name: "Delegation states",
      time: { created: 1, updated: 1 },
    },
    provider: {},
    sessions: [
      {
        id: sessionID,
        projectID: "proj_delegation_states",
        directory,
        title,
        version: "dev",
        time: { created: 1, updated: 1 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    tasks: [],
    delegations: [],
    delegationStatus: 500,
  })
  await page.reload()
  await expectSessionTitle(page, title)
  await page.locator("[data-session-title]").getByRole("button", { name: moreOptions }).click()
  await page.getByRole("menuitem", { name: myAgents }).click()
  await expect(page.locator('[data-component="delegation-panel-error"]')).toBeVisible()
  expect(
    errors.filter((error) => !error.includes("500")),
    `unexpected browser errors: ${errors.join(" | ")}`,
  ).toEqual([])
})

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
