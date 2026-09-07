import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

/**
 * The user-visible half of P1-PERMISSION-DENY.
 *
 * The report's Work-mode denial was seen on the default runtime, and the core side of that
 * runtime is fine: V1 permission errors carry their own sentence, `failToolCall` writes it
 * into the tool part, and `message-part.tsx:1440` routes an errored part to `ToolErrorCard`.
 * What the reporter saw — "the shell card turned to failed, with no explanation" — comes
 * from the card itself: `tool-error-card.tsx:24` opens at `props.defaultOpen ?? false`, and
 * the message only renders inside `Collapsible.Content` (`:126-150`). Collapsed, the trigger
 * row shows a ban icon and the tool name and nothing else, so the reason is one disclosure
 * click away from a user who has no reason to suspect there is anything to disclose.
 *
 * That is independent of which runtime produced the text, so it is asserted here from the
 * real session route rather than in a core test.
 */
const directory = "C:/Aigcfroge/ToolDenialVisible"
const projectID = "proj_tool_denial_visible"
const sessionID = "ses_tool_denial_visible"
const userMessageID = "msg_user_denial"
const assistantMessageID = "msg_assistant_denial"
const deniedPartID = "prt_0001_bash_denied"
const title = "Denied shell call"
const created = 1700000000000
const reason = "The user rejected permission to use this specific tool call."

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
  parts: [
    { id: "prt_user_denial", sessionID, messageID: userMessageID, type: "text", text: "List the project files." },
  ],
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: created + 1000, completed: created + 2000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [
    {
      id: deniedPartID,
      sessionID,
      messageID: assistantMessageID,
      type: "tool",
      callID: "call_bash_denied",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "ls -la" },
        error: reason,
        time: { start: created + 1000, end: created + 1500 },
      },
    },
  ],
}

async function openSession(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "tool-denial-visible",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "tool-denial-visible",
        projectID,
        directory,
        title,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: [userMessage, assistantMessage] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
}

test.describe("regression: a denied tool call explains itself", () => {
  test("shows why the call failed without asking the user to expand it", async ({ page }) => {
    await openSession(page)

    const card = page.locator(`[data-timeline-part-id="${deniedPartID}"]`).first()
    await expectAppVisible(card)

    // The card is the failure surface, so this is not about the card being missing.
    await expect(card.locator('[data-kind="tool-error-card"]')).toBeVisible()

    // The reason has to be readable as rendered. Nothing has been clicked.
    await expect(card.getByText(reason, { exact: false })).toBeVisible()
  })

  test("still keeps the full error behind the disclosure", async ({ page }) => {
    // The other half of the fix: making the reason legible must not mean expanding every
    // failed card by default, which would flood the timeline with stack traces.
    await openSession(page)

    const card = page.locator(`[data-timeline-part-id="${deniedPartID}"]`).first()
    await expectAppVisible(card)

    await expect(card.locator('[data-kind="tool-error-card"]')).toHaveAttribute("data-open", "false")
  })
})
