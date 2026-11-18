import type { Page } from "@playwright/test"
import type {
  SessionConsultationRead,
  SessionConsultationReference,
  SessionMessageInfo,
} from "@aigcfroge/client/promise"
import { createHash } from "node:crypto"
import { base64Encode } from "@aigcfroge/util/encode"
import { pageMessagesFrom, provider, SERVER, T0, workspaceKey } from "../../utils/app"
import { openSidePanel } from "../../utils/side-panel"
import { installSseTransport } from "../../utils/sse-transport"
import { openSession } from "../../utils/workspace"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  benchmarkLocation,
  performanceTurn,
  setupTimelineBenchmark,
  timelineEvent,
  textPartID,
} from "./session-timeline-benchmark.fixture"
import { startTimelineProfile } from "./session-timeline-profile"
import { createReviewDiffs } from "./timeline-test-helpers"
import {
  collectTimelineStreamMetrics,
  installTimelineStreamProbe,
  startTimelineStreamProbe,
} from "./session-timeline-stream-probe"

type TimelineStreamOptions = {
  reviewDiffs?: boolean
  reviewPane?: boolean
}

type ReviewPaneSample = {
  observedAtMs: number
  panelVisible: boolean
  header: string
  diffViewers: number
  diffLines: number
  codeBlocks: number
  ready: boolean
}

type ReviewPaneProbe = {
  samples: ReviewPaneSample[]
  start: () => void
  stop: () => void
}

declare global {
  interface Window {
    /** Review samples installed and read by this benchmark in the same page. */
    __reviewPaneProbe?: ReviewPaneProbe
  }
}

const reviewReadyStreak = 3

benchmark.describe("performance: session timeline streaming", () => {
  benchmark("streams assistant text without remounting or oscillating", async ({ page, report }) => {
    benchmark.setTimeout(Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 420_000) + 60_000)
    const result = await runTimelineStreamBenchmark(page, {})
    report(result.metrics, result.context)
  })

  benchmark("streams assistant text with review diffs and pane closed", async ({ page, report }) => {
    benchmark.setTimeout(Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 420_000) + 60_000)
    const result = await runTimelineStreamBenchmark(page, { reviewDiffs: true })
    report(result.metrics, result.context)
  })

  benchmark("streams assistant text with review pane open", async ({ page, report }) => {
    benchmark.setTimeout(Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 420_000) + 60_000)
    const result = await runTimelineStreamBenchmark(page, { reviewPane: true })
    report(result.metrics, result.context)
  })

  benchmark("streams main and two reopened saved BTW Chat targets", async ({ page, report }) => {
    const completionTimeoutMs = Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 420_000)
    const cpuThrottle = Number(process.env.TIMELINE_CPU_THROTTLE ?? 30)
    const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 160)
    const historyTurns = Number(process.env.TIMELINE_HISTORY_TURNS ?? 320)
    const minimal = process.env.TIMELINE_MINIMAL === "1"
    const profileCPU = process.env.TIMELINE_CPU_PROFILE === "1"
    const profileVisual = !minimal && profileCPU && process.env.TIMELINE_VISUAL_PROFILE !== "0"
    const model = { id: "claude-opus-4-6", providerID: "aigcfroge" }

    const targets = [
      { id: "ses_sc07_benchmark_main", label: "Source", title: "SC07 streaming source" },
      { id: "ses_sc07_benchmark_side_a", label: "SideA", title: "SC07 saved side A" },
      { id: "ses_sc07_benchmark_side_b", label: "SideB", title: "SC07 saved side B" },
    ].map((target) => ({
      ...target,
      firstID: `msg_${target.id}_first`,
      userID: `msg_${target.id}_stream_user`,
      assistantID: `msg_${target.id}_stream_assistant`,
      partID: `msg_${target.id}_stream_assistant:text:0`,
      draft: `Retained ${target.label} draft during three streams`,
      attachment: `${target.label.toLowerCase()}-retained.txt`,
      result: Array.from({ length: deltaCount }, (_, index) => `${target.label}-stream-${index + 1}`)
        .concat(`${target.label}-benchmark-complete`)
        .join(" "),
    }))

    const sourceTarget = targets[0]!
    const sides = targets.slice(1)
    const completedUserID = "msg_sc07_benchmark_completed_user"
    const completedAssistantID = "msg_sc07_benchmark_completed_answer"
    const completedAnswer = "SC07 completed source answer retained during all three streams."
    const material = `Source ${sourceTarget.id} through ${completedAssistantID}.\n\n${completedAnswer}`

    const reference = {
      sourceSessionID: sourceTarget.id,
      boundary: { type: "through", messageID: completedAssistantID },
      boundarySeq: 3,
      sourceMessageIDs: [completedUserID, completedAssistantID],
      digest: createHash("sha256").update(material).digest("hex"),
      omissions: [],
      file: {
        data: Buffer.from(material).toString("base64"),
        mime: "text/plain",
        name: "sc07-saved-source-reference.txt",
        source: { type: "inline" },
      },
    } satisfies SessionConsultationReference

    const messages: Record<string, SessionMessageInfo[]> = Object.fromEntries(
      targets.map((target, targetIndex) => {
        const base = T0 + (targetIndex === 0 ? 0 : (historyTurns + 1) * 2_000)

        const history = Array.from({ length: historyTurns }, (_, index) =>
          performanceTurn(index).map((message) => {
            const fields = {
              id: `${target.id}_${message.id}`,
              time: { created: base + index * 2_000 + (message.type === "assistant" ? 1_000 : 0) },
            }

            if (message.type !== "assistant") return { ...message, ...fields }

            return {
              ...message,
              ...fields,
              time: { ...fields.time, completed: base + index * 2_000 + 1_500 },
              content: message.content.map((part) =>
                part.type === "tool" ? { ...part, id: `${target.id}_${part.id}` } : part,
              ),
            }
          }),
        ).flat()

        const first = {
          id: target.firstID,
          type: "user",
          text: target.title,
          time: { created: base },
        } satisfies SessionMessageInfo

        const currentTime = T0 + (historyTurns * 2 + 3) * 2_000

        const current = [
          { id: target.userID, type: "user", text: `Stream ${target.label}`, time: { created: currentTime } },
          {
            id: target.assistantID,
            type: "assistant",
            agent: "build",
            model,
            metadata: { parentID: target.userID },
            time: { created: currentTime + 1 },
            content: [],
          },
        ] satisfies SessionMessageInfo[]

        const anchor =
          targetIndex === 0
            ? ([
                {
                  id: completedUserID,
                  type: "user",
                  text: "Keep the completed source response mounted",
                  time: { created: T0 + (historyTurns + 1) * 2_000 },
                },
                {
                  id: completedAssistantID,
                  type: "assistant",
                  agent: "build",
                  model,
                  metadata: { parentID: completedUserID },
                  time: {
                    created: T0 + (historyTurns + 1) * 2_000 + 1,
                    completed: T0 + (historyTurns + 1) * 2_000 + 2,
                  },
                  completion: { id: "evt_sc07_benchmark_completed_source", seq: 3 },
                  needsContinuation: false,
                  content: [{ type: "text", text: completedAnswer }],
                },
              ] satisfies SessionMessageInfo[])
            : []

        return [
          target.id,
          [
            targetIndex === 0 ? first : { ...first, files: [reference.file] },
            ...history.slice(1),
            ...anchor,
            ...current,
          ],
        ]
      }),
    )

    const consultations = Object.fromEntries(
      sides.map((target) => {
        const first = messages[target.id]!.find((message) => message.type === "user")

        if (!first) throw new Error(`Missing saved first question for ${target.id}`)

        return [
          target.id,
          { reference, admission: { state: "promoted", input: first } } satisfies SessionConsultationRead,
        ]
      }),
    )

    const executionRequests: { method: string; path: string }[] = []
    const writes: { path: string; directory: string; body: string }[] = []

    benchmark.setTimeout(completionTimeoutMs + 60_000)
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname

      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) || !/^\/api\/session(?:\/|$)/.test(path))
        return
      executionRequests.push({ method: request.method(), path })
    })
    await page.setViewportSize({ width: 1366, height: 768 })
    const transport = await installSseTransport(page, { server: SERVER })

    const workspace = await openSession(page, {
      name: "SC07 simultaneous saved side targets",
      directory: benchmarkLocation.directory,
      project: { id: benchmarkLocation.project.id },
      sessions: targets.map((target) => {
        const session = {
          id: target.id,
          title: target.title,
          mode: "chat",
          agent: "build",
          model,
        }

        if (target.id === sourceTarget.id) return session

        return {
          ...session,
          metadata: { consultation: { sourceSessionID: sourceTarget.id, firstMessageID: target.firstID } },
        }
      }),
      provider: provider({ id: model.id, name: "Timeline benchmark model" }),
      pageMessages: pageMessagesFrom(messages),
      sessionStatus: Object.fromEntries(targets.map((target) => [target.id, { type: "running" }])),
      onConsultationRead: (sessionID) => ({ status: 200, body: { data: consultations[sessionID] } }),
      onFileWrite: (input) => writes.push(input),
      seed: {
        tabs: [sourceTarget.id],
        settings: {
          general: { editToolPartsExpanded: true, shellToolPartsExpanded: true, showReasoningSummaries: true },
        },
        storage: {
          [workspaceKey(base64Encode(benchmarkLocation.directory), "extension.btw.chats").replace(
            ":workspace:",
            `:session:${sourceTarget.id}:`,
          )]: {
            chats: sides.map((target) => ({
              id: target.label,
              question: target.title,
              admitted: true,
              intent: {
                serverID: SERVER,
                sessionID: sourceTarget.id,
                boundary: reference.boundary,
                location: { directory: benchmarkLocation.directory },
                targetID: target.id,
                firstID: target.firstID,
              },
              request: {
                kind: "consultation",
                input: {
                  id: target.id,
                  boundary: reference.boundary,
                  agent: "build",
                  model,
                  prompt: { id: target.firstID, text: target.title },
                  resume: false,
                },
              },
            })),
          },
        },
      },
    })

    await transport.waitForConnection()
    const main = page.locator('[data-slot="session-chat-panel"]')
    const sourceEditor = main.locator('[data-component="composer-editor"]')
    const review = page.locator("#review-panel")
    const sideViews = []

    await sourceEditor.fill(sourceTarget.draft)

    const sourceFile = await page.evaluateHandle((filename) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(["Retained source attachment"], filename, { type: "text/plain" }))

      return transfer
    }, sourceTarget.attachment)

    await main.dispatchEvent("drop", { dataTransfer: sourceFile })
    await sourceFile.dispose()
    await expect.poll(() => writes.length).toBe(1)
    await expect(main.locator('[data-component="composer-attachments"]')).toContainText(sourceTarget.attachment)

    for (const target of sides) {
      await openSidePanel(page, "Side chats")
      await review.getByRole("button", { name: target.title, exact: true }).click()
      const tab = review.getByRole("tab", { name: target.title, exact: true })
      await expect(tab).toHaveAttribute("aria-selected", "true")
      const panelID = await tab.getAttribute("aria-controls")
      const tabID = await tab.getAttribute("id")

      if (!panelID || !tabID) throw new Error(`Missing saved BTW panel identity for ${target.id}`)
      const panel = page.locator(`[id="${panelID}"]`)
      const editor = panel.locator('[data-component="composer-editor"]')
      await expect(editor).toBeEditable()
      await editor.fill(target.draft)

      const attachment = await page.evaluateHandle((filename) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(["Retained side attachment"], filename, { type: "text/plain" }))

        return transfer
      }, target.attachment)

      await panel.locator("[data-session-content]").dispatchEvent("drop", { dataTransfer: attachment })
      await attachment.dispose()
      await expect.poll(() => writes.length).toBe(sideViews.length + 2)
      await expect(panel.locator('[data-component="composer-attachments"]')).toContainText(target.attachment)
      sideViews.push({ target, tab: page.locator(`[id="${tabID}"]`), panelID, panel })
    }

    const activeSide = sideViews[0]!
    const inactiveSide = sideViews[1]!
    await activeSide.tab.click()
    await expect(activeSide.tab).toHaveAttribute("aria-selected", "true")
    await expect(activeSide.panel.locator('[data-component="composer-editor"]')).toBeEditable()
    await expect(activeSide.panel.locator('[data-component="composer-attachments"]')).toContainText(
      activeSide.target.attachment,
    )

    const initialEvents = targets.flatMap((target) => [
      timelineEvent(
        "session.text.started",
        { sessionID: target.id, assistantMessageID: target.assistantID, ordinal: 0 },
        true,
      ),
      timelineEvent("session.text.delta", {
        sessionID: target.id,
        assistantMessageID: target.assistantID,
        ordinal: 0,
        delta: `Streaming ${target.title}\n\n## Implementation plan\n\n`,
      }),
    ])

    const initialAcknowledgements = await transport.burst(initialEvents)
    const sourceText = main.locator(`[data-timeline-part-id="${sourceTarget.partID}"]`)
    const activeText = activeSide.panel.locator(`[data-timeline-part-id="${activeSide.target.partID}"]`)
    await expect(sourceText).toContainText("Implementation plan")
    await expect(activeText).toContainText("Implementation plan")

    const sourceScroller = main.getByRole("region", { name: "scrollable content", exact: true }).filter({
      has: page.locator(`[data-timeline-part-id="${sourceTarget.partID}"]`),
    })

    const activeScroller = activeSide.panel.getByRole("region", { name: "scrollable content", exact: true }).filter({
      has: page.locator(`[data-timeline-part-id="${activeSide.target.partID}"]`),
    })

    for (const scroller of [sourceScroller, activeScroller]) {
      await expect(scroller).toBeVisible()
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
    }

    const completedAction = main
      .locator(`[data-message-id="${completedUserID}"]`)
      .getByRole("button", { name: "Side chat", exact: true })

    await expect(completedAction).toHaveCount(1)
    const activeEditor = activeSide.panel.locator('[data-component="composer-editor"]')
    const selectedText = `${activeSide.target.label} draft`
    const selectionStart = activeSide.target.draft.indexOf(selectedText)
    const selectionEnd = selectionStart + selectedText.length
    await activeEditor.click()
    await activeEditor.evaluate((editor, selectedText) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      const node = walker.nextNode()

      if (!node?.textContent?.includes(selectedText)) throw new Error("Missing selected draft text")
      const start = node.textContent.indexOf(selectedText)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + selectedText.length)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    }, selectedText)
    await expect(activeEditor).toBeFocused()
    const profile = await startTimelineProfile(page, { cpuThrottle, profileCPU })
    await installTimelineStreamProbe(page, {
      textPartID: sourceTarget.partID,
      finalIndex: deltaCount,
      profileVisual,
      minimal,
    })

    const surfaces = await page.evaluateHandle(
      ({ source, active, inactive, completedUserID }) => {
        const capture = (scope: Element | null, userID: string) => {
          const timeline = scope?.querySelector<HTMLElement>("[data-timeline-virtual-content]")
          const composer = scope?.querySelector<HTMLElement>('[data-component="composer-editor"]')
          const selection = document.getSelection()
          const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined

          const selected =
            composer && range && composer.contains(range.startContainer) && composer.contains(range.endContainer)
              ? (() => {
                  const prefix = document.createRange()
                  prefix.selectNodeContents(composer)
                  prefix.setEnd(range.startContainer, range.startOffset)
                  const start = prefix.toString().length
                  prefix.setEnd(range.endContainer, range.endOffset)

                  return { start, end: prefix.toString().length, text: range.toString() }
                })()
              : undefined

          const history = [...(scope?.querySelectorAll<HTMLElement>("[data-timeline-row]") ?? [])].flatMap((row) => {
            if (row.dataset.messageId === userID) return []

            return [
              {
                messageID: row.dataset.messageId,
                row: row.dataset.timelineRow,
                heightPx: row.getBoundingClientRect().height,
              },
            ]
          })

          return {
            timeline,
            composer,
            snapshot: {
              timelineConnected: timeline?.isConnected ?? false,
              composerConnected: composer?.isConnected ?? false,
              draft: composer?.textContent,
              selection: selected,
              attachments: scope?.querySelector('[data-component="composer-attachments"]')?.textContent,
              mountedHistoryRows: history,
              mountedHistoryHeightPx: history.reduce((sum, row) => sum + row.heightPx, 0),
            },
          }
        }

        const sourceScope = document.querySelector('[data-slot="session-chat-panel"]')
        const activeScope = document.getElementById(active.panelID)
        const inactiveScope = document.getElementById(inactive.panelID)
        const beforeSource = capture(sourceScope, source.userID)
        const beforeActive = capture(activeScope, active.userID)
        const action = sourceScope?.querySelector(`[data-message-id="${completedUserID}"] [aria-label="Side chat"]`)
        const focused = document.activeElement
        const selection = document.getSelection()
        const anchorNode = selection?.anchorNode

        const before = {
          source: beforeSource.snapshot,
          activeTarget: beforeActive.snapshot,
          completedActionConnected: action?.isConnected ?? false,
          focus: {
            sourceComposer: focused === beforeSource.composer,
            activeComposer: focused === beforeActive.composer,
            anchorOffset: selection?.anchorOffset,
            focusOffset: selection?.focusOffset,
          },
          inactiveTarget: {
            panelConnected: inactiveScope?.isConnected ?? false,
            timelineConnected: !!inactiveScope?.querySelector("[data-timeline-virtual-content]"),
            composerConnected: !!inactiveScope?.querySelector('[data-component="composer-editor"]'),
          },
        }

        return {
          finish() {
            const currentSourceScope = document.querySelector('[data-slot="session-chat-panel"]')
            const currentActiveScope = document.getElementById(active.panelID)
            const currentInactiveScope = document.getElementById(inactive.panelID)
            const afterSource = capture(currentSourceScope, source.userID)
            const afterActive = capture(currentActiveScope, active.userID)

            const currentAction = currentSourceScope?.querySelector(
              `[data-message-id="${completedUserID}"] [aria-label="Side chat"]`,
            )

            const currentSelection = document.getSelection()

            return {
              before,
              after: {
                source: afterSource.snapshot,
                activeTarget: afterActive.snapshot,
                completedActionConnected: currentAction?.isConnected ?? false,
                focus: {
                  sameElement: document.activeElement === focused,
                  sourceComposer: document.activeElement === afterSource.composer,
                  activeComposer: document.activeElement === afterActive.composer,
                  anchorNodePreserved: currentSelection?.anchorNode === anchorNode,
                  anchorOffset: currentSelection?.anchorOffset,
                  focusOffset: currentSelection?.focusOffset,
                },
                inactiveTarget: {
                  panelConnected: currentInactiveScope?.isConnected ?? false,
                  timelineConnected: !!currentInactiveScope?.querySelector("[data-timeline-virtual-content]"),
                  composerConnected: !!currentInactiveScope?.querySelector('[data-component="composer-editor"]'),
                },
              },
              identity: {
                sourcePanelPreserved: sourceScope && currentSourceScope ? sourceScope === currentSourceScope : null,
                activePanelPreserved: activeScope && currentActiveScope ? activeScope === currentActiveScope : null,
                inactivePanelPreserved:
                  inactiveScope && currentInactiveScope ? inactiveScope === currentInactiveScope : null,
                sourceTimelinePreserved:
                  beforeSource.timeline && afterSource.timeline ? beforeSource.timeline === afterSource.timeline : null,
                sourceComposerPreserved:
                  beforeSource.composer && afterSource.composer ? beforeSource.composer === afterSource.composer : null,
                activeTimelinePreserved:
                  beforeActive.timeline && afterActive.timeline ? beforeActive.timeline === afterActive.timeline : null,
                activeComposerPreserved:
                  beforeActive.composer && afterActive.composer ? beforeActive.composer === afterActive.composer : null,
                completedActionPreserved: action && currentAction ? action === currentAction : null,
              },
            }
          },
        }
      },
      {
        source: sourceTarget,
        active: { panelID: activeSide.panelID, userID: activeSide.target.userID },
        inactive: { panelID: inactiveSide.panelID },
        completedUserID,
      },
    )

    const deltas = Array.from({ length: deltaCount }, (_, index) =>
      targets.map((target) =>
        timelineEvent("session.text.delta", {
          sessionID: target.id,
          assistantMessageID: target.assistantID,
          ordinal: 0,
          delta: ` ${target.label}-stream-${index + 1}${index === deltaCount - 1 ? ` ${target.label}-benchmark-complete` : ""}`,
        }),
      ),
    ).flat()

    await startTimelineStreamProbe(page)
    const burstAcknowledgements = await transport.burst(deltas)

    const completionAcknowledgements = await transport.burst(
      targets.flatMap((target) => [
        timelineEvent(
          "session.text.ended",
          { sessionID: target.id, assistantMessageID: target.assistantID, ordinal: 0, text: " " + target.result },
          true,
        ),
        timelineEvent("session.step.completed", { sessionID: target.id, assistantMessageID: target.assistantID }, true),
        timelineEvent("session.execution.succeeded", { sessionID: target.id }, true),
      ]),
    )

    await expect(sourceText).toContainText(sourceTarget.result, { timeout: completionTimeoutMs })
    await expect(activeText).toContainText(activeSide.target.result, { timeout: completionTimeoutMs })
    const identities = await surfaces.evaluate((state) => state.finish())
    await benchmark.info().attach("three-target-surfaces", {
      body: JSON.stringify(identities, null, 2),
      contentType: "application/json",
    })
    expect(identities.before.activeTarget.selection).toEqual({
      start: selectionStart,
      end: selectionEnd,
      text: selectedText,
    })
    expect(identities.after.activeTarget.selection).toEqual(identities.before.activeTarget.selection)
    expect(identities.after.focus.activeComposer).toBe(true)
    await expect(sourceEditor).toHaveText(sourceTarget.draft)
    await expect(activeEditor).toHaveText(activeSide.target.draft)
    await expect(activeSide.panel.locator('[data-component="composer-attachments"]')).toContainText(
      activeSide.target.attachment,
    )
    await page.keyboard.type("!")

    const editedActiveDraft =
      activeSide.target.draft.slice(0, selectionStart) + "!" + activeSide.target.draft.slice(selectionEnd)

    await expect(activeEditor).toHaveText(editedActiveDraft)

    const sourceMetrics = await collectTimelineStreamMetrics(page, {
      textPartID: sourceTarget.partID,
      finalIndex: deltaCount,
      navigations: benchmarkDiagnostics(page).navigations,
    })

    const reopenStarted = performance.now()
    await inactiveSide.tab.click()
    await expect(inactiveSide.tab).toHaveAttribute("aria-selected", "true")
    const inactiveText = inactiveSide.panel.locator(`[data-timeline-part-id="${inactiveSide.target.partID}"]`)
    await expect(inactiveText).toContainText(inactiveSide.target.result, { timeout: completionTimeoutMs })
    await expect(inactiveSide.panel.locator('[data-component="composer-editor"]')).toHaveText(inactiveSide.target.draft)
    await expect(inactiveSide.panel.locator('[data-component="composer-attachments"]')).toContainText(
      inactiveSide.target.attachment,
    )

    const inactiveFinal = {
      endToEndReactivationObservedMs: performance.now() - reopenStarted,
      text: await inactiveText.textContent(),
    }

    await profile.stop()
    await surfaces.dispose()
    await profile.reset()
    await activeSide.tab.click()
    await expect(activeEditor).toHaveText(editedActiveDraft)

    for (const view of sideViews) {
      await view.tab.click()
      await expect(view.panel.locator('[data-component="composer-editor"]')).toHaveText(
        view === activeSide ? editedActiveDraft : view.target.draft,
      )
      await view.panel.getByRole("button", { name: "View reference", exact: true }).click()
      await expect(view.panel).toContainText(material)
      await view.panel.getByRole("button", { name: "Close reference", exact: true }).click()
      await view.tab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
    }

    for (const view of sideViews) {
      await openSidePanel(page, "Side chats")
      await review.getByRole("button", { name: view.target.title, exact: true }).click()
      const tab = review.getByRole("tab", { name: view.target.title, exact: true })
      await expect(tab).toHaveAttribute("aria-selected", "true")
      const panel = page.locator(`[id="${await tab.getAttribute("aria-controls")}"]`)
      await expect(panel.locator('[data-component="composer-editor"]')).toHaveText(
        view === activeSide ? editedActiveDraft : view.target.draft,
      )
      await expect(panel.locator('[data-component="composer-attachments"]')).toContainText(view.target.attachment)
    }

    await page.reload()
    await expect(sourceEditor).toHaveText(sourceTarget.draft)
    await expect(main.locator('[data-component="composer-attachments"]')).toContainText(sourceTarget.attachment)

    for (const view of sideViews) {
      const tab = review.getByRole("tab", { name: view.target.title, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute("aria-selected", "true")
      const panel = page.locator(`[id="${await tab.getAttribute("aria-controls")}"]`)
      await expect(panel.locator('[data-component="composer-editor"]')).toHaveText(
        view === activeSide ? editedActiveDraft : view.target.draft,
      )
      await expect(panel.locator('[data-component="composer-attachments"]')).toContainText(view.target.attachment)
      await panel.getByRole("button", { name: "View reference", exact: true }).click()
      await expect(panel).toContainText(material)
      await panel.getByRole("button", { name: "Close reference", exact: true }).click()
    }

    expect(executionRequests).toHaveLength(0)
    report(
      {
        sourceStream: sourceMetrics,
        surfaces: identities,
        inactiveFinal,
        executionRequests,
        transport: {
          connections: await transport.connections(),
          initialAcknowledgements,
          burstAcknowledgements,
          completionAcknowledgements,
        },
      },
      {
        capabilitySample: "SC07 saved BTW targets; no frozen-baseline counterpart",
        server: workspace.server,
        targets: targets.map((target) => ({ id: target.id, title: target.title })),
        visitedSideTargets: sides.length,
        selectedDuringStream: activeSide.target.id,
        inactiveDuringStream: inactiveSide.target.id,
        inactiveObservation:
          "The BTW provider retains the selected member's DOM. The inactive saved target is observed in shared data and through accumulated text after selecting its tab; hidden geometry, paint and focus are not sampled.",
        surfaceObservation:
          "Initial/final identity is reported only when both DOM nodes exist. Mounted history rows may change through virtualization. Source subtree mutation samples require the original visual profile; target transient replacements are not observed.",
        historyTurnsPerTarget: historyTurns,
        deltaCountPerTarget: deltaCount,
        deltaWorkload: "interleaved plain accumulation with per-target stream markers",
        queuedDeltas: deltas.length,
        cpuThrottle,
        profileCPU,
        profileVisual,
        minimal,
      },
    )
  })
})

benchmark.describe("performance: review pane", () => {
  benchmark("loads review diffs and switches active files", async ({ page, report }) => {
    benchmark.setTimeout(240_000)
    const historyTurns = Number(process.env.REVIEW_PANE_HISTORY_TURNS ?? 72)
    const diffs = createReviewDiffs()

    const fixture = await setupTimelineBenchmark(page, {
      historyTurns,
      eventBatch: 1,
      vcsDiff: diffs,
    })

    fixture.transport.enqueue(buildInitialStreamEvent(1))
    await expect(fixture.text).toBeVisible()
    await expect(fixture.text).toContainText("Implementation plan")
    await fixture.scrollToBottom()
    await fixture.waitForStableGeometry()

    const open = await measureReviewPaneLoad(page, diffs[0]!.file)
    const switches = []

    for (const diff of diffs.slice(1, 4)) switches.push(await measureReviewNextFile(page, diff.file))

    report(
      {
        open,
        switches,
      },
      {
        historyTurns,
        reviewDiffs: diffs.length,
      },
    )
  })
})

async function runTimelineStreamBenchmark(page: Page, options: TimelineStreamOptions) {
  const completionTimeoutMs = Number(process.env.TIMELINE_COMPLETION_TIMEOUT_MS ?? 420_000)
  const cpuThrottle = Number(process.env.TIMELINE_CPU_THROTTLE ?? 30)
  const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 160)
  const historyTurns = Number(process.env.TIMELINE_HISTORY_TURNS ?? 320)
  const eventBatch = Number(process.env.TIMELINE_EVENT_BATCH ?? 1)
  const minimal = process.env.TIMELINE_MINIMAL === "1"
  const profileCPU = process.env.TIMELINE_CPU_PROFILE === "1"
  const profileVisual = !minimal && profileCPU && process.env.TIMELINE_VISUAL_PROFILE !== "0"
  const diffs = options.reviewDiffs || options.reviewPane ? createReviewDiffs() : undefined

  const fixture = await setupTimelineBenchmark(page, {
    historyTurns,
    eventBatch,
    // Turn diffs exercise timeline data cost; the pane-open scenario serves the same
    // diffs through the default git mode so it works across review implementations.
    turnDiffs: options.reviewDiffs ? diffs : undefined,
    vcsDiff: options.reviewPane ? diffs : undefined,
  })

  fixture.transport.enqueue(buildInitialStreamEvent(deltaCount))
  const contentStart = performance.now()
  await expect(fixture.text).toBeVisible()
  await expect(fixture.text).toContainText("Implementation plan")
  const initialContentObservedMs = performance.now() - contentStart
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()

  const reviewPane = options.reviewPane && diffs ? await measureReviewPaneLoad(page, diffs[0]!.file) : undefined

  if (reviewPane) await fixture.waitForStableGeometry()

  const profile = await startTimelineProfile(page, { cpuThrottle, profileCPU })
  await installTimelineStreamProbe(page, { textPartID, finalIndex: deltaCount, profileVisual, minimal })
  const deltas = buildStreamDeltaEvents(deltaCount)
  await startTimelineStreamProbe(page)
  fixture.transport.enqueue(deltas)

  await page.waitForFunction(
    (finalIndex) => window.__timelineStreamBenchmark?.applied.some((value) => value.index === finalIndex),
    deltaCount,
    { timeout: completionTimeoutMs },
  )
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect(fixture.text).toContainText("Streaming")
  await fixture.waitForStableGeometry()

  const metrics = await collectTimelineStreamMetrics(page, {
    textPartID,
    finalIndex: deltaCount,
    navigations: benchmarkDiagnostics(page).navigations,
  })

  const delivered = deltas.length - fixture.transport.pendingCount()
  await profile.stop()

  const result = {
    metrics: {
      endToEndInitialContentObservedMs: initialContentObservedMs,
      ...metrics,
      deliveredDeltas: delivered,
      pendingDeltas: fixture.transport.pendingCount(),
      reviewPane: reviewPane ?? null,
    },
    context: {
      cpuThrottle,
      profileCPU,
      profileVisual,
      minimal,
      queuedDeltas: deltas.length,
      historyTurns,
      eventBatch,
      reviewPane: options.reviewPane === true ? "open" : "closed",
      reviewDiffs: diffs?.length ?? 0,
    },
  }

  await profile.reset()

  return result
}

async function measureReviewPaneLoad(page: Page, file: string) {
  // Default git mode reads the mocked /vcs/diff data, so opening the pane is enough
  // and the flow works across review pane implementations.
  await installReviewPaneProbe(page, { file })
  await startReviewPaneProbe(page)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(page.locator("#review-panel")).toBeVisible()

  return collectReviewPaneProbe(page)
}

async function measureReviewNextFile(page: Page, file: string) {
  await installReviewPaneProbe(page, { file })
  await startReviewPaneProbe(page)
  await page.getByRole("button", { name: "Next file" }).click()

  return collectReviewPaneProbe(page)
}

async function installReviewPaneProbe(page: Page, input: { file: string }) {
  await page.evaluate((input) => {
    const samples: ReviewPaneSample[] = []
    const basename = input.file.split(/[\\/]/).at(-1) ?? input.file
    let started: number | undefined
    let running = true

    const paneState = () => {
      const panel = document.querySelector<HTMLElement>("#review-panel")
      const review = panel?.querySelector<HTMLElement>('[data-component="session-review-v2"]')
      const rect = (review ?? panel)?.getBoundingClientRect()
      const text = panel?.textContent ?? ""

      const previewHeader = panel?.querySelector<HTMLElement>(
        '[data-slot="session-review-v2-file-header"]',
      )?.textContent

      const header = previewHeader ?? text
      const viewers = panel ? [...panel.querySelectorAll<HTMLElement>('[data-component="file"][data-mode="diff"]')] : []
      const codeBlocks = panel?.querySelectorAll("code").length ?? 0

      const diffLines = viewers.reduce(
        (sum, viewer) =>
          sum +
          (viewer.shadowRoot?.querySelectorAll("[data-line]").length ?? viewer.querySelectorAll("[data-line]").length),
        0,
      )

      const panelVisible =
        !!panel && panel.getAttribute("aria-hidden") !== "true" && !!rect && rect.width > 0 && rect.height > 0

      return {
        panelVisible,
        header: header.slice(0, 500),
        diffViewers: viewers.length,
        diffLines,
        codeBlocks,
        ready:
          panelVisible &&
          header.includes(basename) &&
          (viewers.length > 0 || text.includes("+3") || diffLines > 0 || codeBlocks > 0),
      }
    }

    const sample = () => {
      if (!running || started === undefined) return
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!running || started === undefined) return
          samples.push({ observedAtMs: performance.now() - started, ...paneState() })

          if (performance.now() - started < 10_000) sample()
        }, 0)
      })
    }

    window.__reviewPaneProbe = {
      samples,
      start: () => {
        started = performance.now()
        performance.mark("aigcfroge.review-pane.click")
        sample()
      },
      stop: () => {
        running = false
      },
    }
  }, input)
}

async function startReviewPaneProbe(page: Page) {
  await page.evaluate(() => {
    window.__reviewPaneProbe!.start()
  })
}

async function collectReviewPaneProbe(page: Page) {
  await page.waitForFunction((streak) => {
    const samples = window.__reviewPaneProbe?.samples

    if (!samples) return false

    return samples.some((_, index) => {
      const stable = samples.slice(index, index + streak)

      return stable.length === streak && stable.every((sample) => sample.ready)
    })
  }, reviewReadyStreak)

  const samples = await page.evaluate(() => {
    const probe = window.__reviewPaneProbe!
    probe.stop()

    return probe.samples
  })

  return { summary: summarizeReviewPaneSamples(samples), samples }
}

function summarizeReviewPaneSamples(samples: ReviewPaneSample[]) {
  const firstReady = samples.find((sample) => sample.ready)

  const stableIndex = samples.findIndex((_, index) => {
    const stable = samples.slice(index, index + reviewReadyStreak)

    return stable.length === reviewReadyStreak && stable.every((sample) => sample.ready)
  })

  return {
    samples: samples.length,
    firstReadyObservedMs: firstReady?.observedAtMs ?? null,
    stableReadyObservedMs: stableIndex === -1 ? null : samples[stableIndex + reviewReadyStreak - 1]!.observedAtMs,
    notReadySamples: samples.filter((sample) => !sample.ready).length,
    maxDiffViewers: Math.max(0, ...samples.map((sample) => sample.diffViewers)),
    maxDiffLines: Math.max(0, ...samples.map((sample) => sample.diffLines)),
    maxCodeBlocks: Math.max(0, ...samples.map((sample) => sample.codeBlocks)),
  }
}
