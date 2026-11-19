import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("shows a delegating row while subagent input streams", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "delegation" } })
  const delegating = timeline.locator('[data-component="task-tool-delegating"]')
  await expect(delegating).toBeVisible()
  const shimmer = delegating.locator('[data-component="text-shimmer"]')
  await expect(shimmer).toHaveAttribute("aria-label", "Delegating agent…")
  await expect(shimmer).toHaveCSS("line-height", "16px")
  await expect(timeline.locator('[data-component="task-tool-card"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("waits for completion before labeling requested background work", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "background" } })
  await expect(timeline.locator('[data-component="task-tool-card"]')).toContainText("Inspect code")
  await expect(timeline.locator('[data-component="task-tool-card"]')).not.toContainText("(background)")
})

story(
  "Task, share and retained communication notices keep the exact operation, actor and content source",
  async ({ mount }) => {
    const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "coordination" } })
    const task = timeline.locator('[data-slot="session-timeline-coordination"]').filter({ hasText: "Task request" })
    const share = timeline
      .locator('[data-slot="session-timeline-coordination"]')
      .filter({ hasText: "Shared session content" })
    await expect(timeline.getByLabel("Opened Task operation", { exact: true })).toHaveText("None")
    await expect(timeline.getByLabel("Opened Session", { exact: true })).toHaveText("None")
    await expect(task).toContainText("Sent by meta")
    await expect(task.getByRole("button", { name: "Actual actor", exact: true })).toBeVisible()
    await expect(task.getByRole("button", { name: "Notice target", exact: true })).toBeVisible()
    await task.getByRole("button", { name: "View Task details", exact: true }).click()
    await expect(timeline.getByLabel("Opened Task operation", { exact: true })).toHaveText(
      '{"sourceSessionID":"ses_mp03_notice_actor","operationID":"top_mp03_notice"}',
    )
    await task.getByText("Request notice", { exact: true }).click()
    await expect(task.getByText("Task coordination: Inspect the saved result", { exact: true })).toBeVisible()
    await expect(share).toContainText("Saved Task result")
    await share.getByRole("button", { name: "Saved content source", exact: true }).click()
    await expect(timeline.getByLabel("Opened Session", { exact: true })).toHaveText("ses_mp03_content_source")
    await share.getByText("Recorded content", { exact: true }).click()
    await expect(share.getByText("Complete saved result body", { exact: true })).toBeVisible()

    const communications = [
      {
        id: "com_mp03_public_notice",
        carrier: "Public communication carrier",
        actor: "Actual actor",
        target: "Notice target",
        heading: "Session communication",
        scope: "Latest output",
        text: "Complete retained communication\nThe second line stays intact.",
      },
      {
        id: "com_mp03_result_notice",
        carrier: "Actor result carrier",
        actor: "Notice target",
        target: "Actual actor",
        heading: "System result delivery",
        scope: "Saved Task result",
        text: "Complete short-metadata result\nThe saved target stays exact.",
      },
    ]

    for (const communication of communications) {
      const row = timeline.locator('[data-slot="session-timeline-coordination"]').filter({ hasText: communication.id })
      await expect(row).toHaveCount(1)
      await expect(row.locator("code")).toHaveText(communication.id)
      await expect(row.getByRole("button", { name: "Saved content source", exact: true })).toHaveCount(0)
      await row.getByText("Recorded content", { exact: true }).click()
      await expect(row.locator("pre")).toHaveText(communication.carrier)
      await row.getByRole("button", { name: "View communication details", exact: true }).click()
      await expect(timeline.getByLabel("Opened communication", { exact: true })).toHaveText(
        JSON.stringify({ sessionID: "ses_mp03_notice_target", communicationID: communication.id }),
      )
    }

    await timeline.getByRole("button", { name: "Load retained communications", exact: true }).click()

    for (const communication of communications) {
      const row = timeline.locator('[data-slot="session-timeline-coordination"]').filter({ hasText: communication.id })
      await expect(row.locator("code")).toHaveText(communication.id)
      await expect(row).toContainText(communication.heading)
      await expect(row).toContainText(communication.scope)
      await expect(row).toContainText("Visible in target history")
      await expect(row.getByRole("button", { name: communication.actor, exact: true })).toBeVisible()
      await expect(row.getByRole("button", { name: "Saved content source", exact: true })).toBeVisible()
      await expect(row.getByRole("button", { name: communication.target, exact: true })).toBeVisible()
      await expect(row.locator("pre")).toHaveText(communication.text)
    }
  },
)
