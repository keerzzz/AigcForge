import type {
  SessionCommunicationMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@aigcfroge/client/promise"
import type { SessionReference } from "@aigcfroge/schema/session-reference"
import { Button } from "@aigcfroge/ui/button"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionResponseActionInput } from "../actions"
import type { SessionDocument } from "../document"
import { DataProvider } from "../context/data"
import { SessionTimeline } from "./session-timeline"
import type { ReasoningMode } from "./projection"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  CURRENT_SESSION_ID,
  STORY_MODEL,
  STORY_TIME,
  attachmentsAndCommentsDocument,
  attachmentsAndCommentsPresentation,
  compactionCancelledDocument,
  compactionDocument,
  compactionFailedDocument,
  compactionRunningDocument,
  instructionsUpdatedMultipleDocument,
  instructionsUpdatedSingleDocument,
  requestHistoryDocument,
  retryDocument,
  revertDocument,
  streamingDocument,
  thinkingDocument,
} from "../storybook/current-session-fixtures"

export default {
  title: "AigcForge/Conversation/Message states",
  id: "current-session-timeline-rows",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Focused current-message states rendered through the production timeline projection and message components.",
      },
    },
  },
}

export const AgentThinking = {
  render: () => <AgentReasoningStory mode="compact" reasoning="heading" tool={false} text="" />,
}

export const StreamingReasoningAndText = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming reasoning and text"
      description="The active turn contains a reasoning summary and a partial response."
      document={streamingDocument}
      width="560px"
    />
  ),
}

function ResponseActionsStory() {
  const [assistant, setAssistant] = createStore<SessionMessageAssistant>({
    id: "msg_response_actions_assistant",
    type: "assistant",
    agent: "build",
    model: STORY_MODEL,
    needsContinuation: false,
    time: { created: STORY_TIME + 100, completed: STORY_TIME + 2000 },
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [
      {
        type: "reasoning",
        text: "## Response inspection\n\nKeep the completed response controls available.",
        time: { created: STORY_TIME + 100, completed: STORY_TIME + 1100 },
      },
      { type: "text", text: "The response stays stable." },
      {
        id: "tool_response_actions_shell",
        type: "tool",
        name: "shell",
        state: {
          status: "completed",
          input: { command: "printf response" },
          content: [{ type: "text", text: "Tool result has no response actions." }],
          metadata: { exit: 0 },
        },
        time: { created: STORY_TIME + 1200, ran: STORY_TIME + 1300, completed: STORY_TIME + 1900 },
      },
    ],
  })

  const [state, setState] = createStore({ streaming: false, mounts: 0, selection: "No response selected" })

  const document = createMemo(() => {
    return {
      sessionID: CURRENT_SESSION_ID,
      status: { type: state.streaming ? "busy" : "idle" },
      diffs: [],
      messages: [
        {
          id: "msg_response_actions_user",
          type: "user",
          text: "Keep response actions stable.",
          time: { created: STORY_TIME },
        },
        assistant,
      ],
    } satisfies SessionDocument
  })

  function ResponseActions(props: { input: SessionResponseActionInput }) {
    onMount(() => setState("mounts", (value) => value + 1))

    return (
      <Show when={props.input.completed ? props.input.boundary : undefined}>
        {(boundary) => (
          <button
            type="button"
            onClick={() =>
              setState(
                "selection",
                [
                  props.input.userMessageID,
                  props.input.assistantMessageID,
                  props.input.contentID,
                  `${boundary().type}:${boundary().messageID}`,
                  props.input.text,
                ].join(" | "),
              )
            }
          >
            Fork response
          </button>
        )}
      </Show>
    )
  }

  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button
          type="button"
          onClick={() => {
            setAssistant("content", 1, (content) =>
              content.type === "text" ? { ...content, text: `${content.text} Next token.` } : content,
            )
            setAssistant("tokens", "output", (value) => (value ?? 0) + 1)
          }}
        >
          Append response token
        </button>
        <button
          type="button"
          onClick={() => {
            setAssistant("time", "completed", undefined)
            setAssistant("needsContinuation", true)
            setState("streaming", true)
          }}
        >
          Start response
        </button>
        <button
          type="button"
          onClick={() => {
            setAssistant("time", "completed", STORY_TIME + 3000)
            setAssistant("needsContinuation", false)
            setState("streaming", false)
          }}
        >
          Complete response
        </button>
      </div>
      <output aria-label="Response action mounts">{state.mounts}</output>
      <output aria-label="Response action selection">{state.selection}</output>
      <div role="region" aria-label="Response action timeline">
        <CurrentSessionProviders document={document()}>
          <SessionTimeline
            document={document()}
            responseActions={(input) => <ResponseActions input={input} />}
            reasoningMode="full"
            shellToolDefaultOpen
          />
        </CurrentSessionProviders>
      </div>
    </section>
  )
}

function AgentReasoningStory(props: { mode: ReasoningMode; reasoning: string; tool: boolean; text: string }) {
  const reasoningTime: NonNullable<SessionMessageAssistantReasoning["time"]> = { created: STORY_TIME + 100 }

  if (props.tool || props.text) reasoningTime.completed = STORY_TIME + 7100

  const content = [
    ...(props.reasoning === "none"
      ? []
      : [
          {
            type: "reasoning" as const,
            text:
              props.reasoning === "blank"
                ? "   "
                : "## Inspecting stability\n\nI will inspect the timeline before changing its state.",
            time: reasoningTime,
          },
        ]),
    ...(props.tool
      ? [
          {
            type: "tool" as const,
            id: "tool_reasoning_projection_skill",
            name: "skill",
            state: { status: "running" as const, input: { name: "inspect" }, metadata: {} },
            time: { created: STORY_TIME + 7200, ran: STORY_TIME + 7250 },
          },
        ]
      : []),
    ...(props.text ? [{ type: "text" as const, text: props.text }] : []),
  ] satisfies SessionMessageAssistant["content"]

  const document = {
    sessionID: CURRENT_SESSION_ID,
    messages: [
      ...thinkingDocument.messages,
      {
        id: "msg_projection_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        content,
        time: { created: STORY_TIME },
      },
    ],
    status: { type: "busy" },
    diffs: [],
  } satisfies SessionDocument

  return (
    <section class="mx-auto w-full max-w-[720px] p-6">
      <CurrentSessionProviders document={document}>
        <SessionTimeline document={document} reasoningMode={props.mode} />
      </CurrentSessionProviders>
    </section>
  )
}

const AgentReasoning = {
  args: { mode: "compact", reasoning: "heading", tool: false, text: "" },
  argTypes: { reasoning: { control: "select", options: ["none", "blank", "heading"] } },
  render: (args: { mode: ReasoningMode; reasoning: string; tool: boolean; text: string }) => (
    <AgentReasoningStory {...args} />
  ),
}

function HiddenReasoningStory() {
  const [state, setState] = createStore({ phase: "thinking" })

  const document = createMemo(() => {
    const finished = state.phase === "idle"
    const running = state.phase === "running"
    const toolTime: SessionMessageAssistantTool["time"] = { created: STORY_TIME + 200, ran: STORY_TIME + 250 }
    const messageTime: SessionMessageAssistant["time"] = { created: STORY_TIME }

    if (finished) {
      toolTime.completed = STORY_TIME + 300
      messageTime.completed = STORY_TIME + 400
    }

    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [
        ...thinkingDocument.messages,
        {
          id: "msg_hidden_reasoning_lifecycle",
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          content: [
            { type: "reasoning", text: "## Inspecting stability", time: { created: STORY_TIME + 100 } },
            ...(running || finished
              ? [
                  {
                    type: "tool" as const,
                    id: "tool_hidden_reasoning_shell",
                    name: "shell",
                    state: finished
                      ? {
                          status: "completed" as const,
                          input: { command: "printf done" },
                          content: [{ type: "text" as const, text: "done" }],
                          metadata: {},
                        }
                      : { status: "running" as const, input: { command: "printf done" }, metadata: {} },
                    time: toolTime,
                  },
                ]
              : []),
          ],
          time: messageTime,
        },
      ],
      status: { type: finished ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })

  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "running")}>
          Start shell
        </button>
        <button type="button" onClick={() => setState("phase", "idle")}>
          Finish session
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} reasoningMode="compact" />
      </CurrentSessionProviders>
    </section>
  )
}

const WorkingWithoutReasoningDetails = { render: () => <HiddenReasoningStory /> }

function RetryAndRecoverStory() {
  const [state, setState] = createStore({ phase: "thinking" })

  const document = createMemo(() => {
    const retry = state.phase === "retry"
    const finished = state.phase === "idle"

    const message: SessionMessageAssistant = {
      id: "msg_retry_recovery_lifecycle",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: finished ? [{ type: "text", text: "Recovered response" }] : [],
      time: { created: STORY_TIME },
    }

    if (retry)
      message.retry = {
        attempt: 2,
        at: 1_900_000_000_000,
        error: { type: "ProviderRateLimitError", message: "Rate limit reached. Retrying with backoff." },
      }

    if (finished) message.time.completed = STORY_TIME + 300

    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [...thinkingDocument.messages, message],
      status: { type: finished ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })

  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "retry")}>
          Retry request
        </button>
        <button type="button" onClick={() => setState("phase", "thinking")}>
          Recover request
        </button>
        <button type="button" onClick={() => setState("phase", "idle")}>
          Finish response
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

const RetryAndRecover = { render: () => <RetryAndRecoverStory /> }

export const ProviderRetry = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Provider retry"
      description="A temporary provider limit keeps the turn active and explains the scheduled retry."
      document={retryDocument}
      width="520px"
    />
  ),
}

const noticeUser = { id: "msg_notice_user", type: "user", text: "Run it", time: { created: STORY_TIME } } as const

const noticeAssistant = {
  id: "msg_notice_assistant",
  type: "assistant",
  agent: "build",
  model: STORY_MODEL,
  content: [{ type: "text", text: "Working" }],
  time: { created: STORY_TIME + 1, completed: STORY_TIME + 2 },
} satisfies SessionMessageInfo

const AgentActivityNotices = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Agent activity and Session notices"
      description="Agent changes, delegated work, restarted Sessions, and loaded skills appear in their original order."
      document={{
        sessionID: CURRENT_SESSION_ID,
        status: { type: "idle" },
        diffs: [],
        messages: [
          noticeUser,
          { id: "msg_notice_agent", type: "agent-switched", agent: "explore", time: { created: STORY_TIME + 1 } },
          noticeAssistant,
          {
            id: "msg_notice_subagent",
            type: "synthetic",
            text: "done",
            description: "Search code",
            metadata: { source: "subagent", agent: "explore", state: "completed" },
            time: { created: STORY_TIME + 3 },
          },
          {
            id: "msg_notice_restart",
            type: "synthetic",
            text: "continue",
            description: "Continuing after restart",
            time: { created: STORY_TIME + 4 },
          },
          {
            id: "msg_notice_skill",
            type: "skill",
            skill: "review",
            name: "Review",
            text: "instructions",
            time: { created: STORY_TIME + 5 },
          },
        ],
      }}
      width="720px"
    />
  ),
}

function CompactSessionStory() {
  const [state, setState] = createStore({ phase: "running", summary: "", second: false })

  const document = createMemo(() => {
    const failed = state.phase === "failed"
    const completed = state.phase === "completed"

    const message = {
      id: "msg_notice_compaction",
      type: "compaction" as const,
      status: failed ? ("failed" as const) : completed ? ("completed" as const) : ("running" as const),
      reason: "auto" as const,
      ...(failed
        ? {
            error: {
              type: "compaction.failed",
              message: 'Error: {"error":{"type":"ProviderError","message":"The provider rejected the summary."}}',
            },
          }
        : { summary: state.summary, recent: "" }),
      time: { created: STORY_TIME + 10 },
    }

    const cancelled = {
      id: "msg_notice_compaction_cancelled",
      type: "compaction" as const,
      status: "failed" as const,
      reason: "manual" as const,
      error: { type: "aborted", message: "Cancellation detail should stay hidden." },
      time: { created: STORY_TIME + 20 },
    }

    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [noticeUser, noticeAssistant, message, ...(state.second ? [cancelled] : [])],
      status: { type: completed || failed ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })

  return (
    <section class="mx-auto flex w-full max-w-[760px] flex-col gap-4 p-6">
      <div class="flex flex-wrap gap-3">
        <button type="button" onClick={() => setState("summary", "## Checkpoint\n\nStreamed implementation details.")}>
          Stream summary
        </button>
        <button
          type="button"
          onClick={() => setState({ phase: "completed", summary: "## Checkpoint\n\nFinal implementation details." })}
        >
          Complete summary
        </button>
        <button type="button" onClick={() => setState("phase", "failed")}>
          Fail compaction
        </button>
        <button type="button" onClick={() => setState("second", true)}>
          Cancel next compaction
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

const CompactSession = { render: () => <CompactSessionStory /> }

export const CompactionInProgress = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction in progress"
      description="The production divider remains stable while the context summary streams below it."
      document={compactionRunningDocument}
      width="600px"
    />
  ),
}

export const CompactionAndContinuation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction and continuation"
      description="The context summary separates earlier output from the continued response."
      document={compactionDocument}
      width="600px"
    />
  ),
}

export const CompactionFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction failed"
      description="A failed compaction keeps the production divider and shows the provider error."
      document={compactionFailedDocument}
      width="600px"
    />
  ),
}

export const CompactionCancelled = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction cancelled"
      description="An interrupted compaction keeps the production divider without an empty error block."
      document={compactionCancelledDocument}
      width="600px"
    />
  ),
}

export const AnsweredQuestionAndDeclinedCommand = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Answered question and declined command"
      description="The chosen answer remains in history, and the declined command keeps its user-visible result."
      document={requestHistoryDocument}
      width="620px"
      shellToolDefaultOpen
    />
  ),
}

export const RevertBoundary = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Revert boundary"
      description="The latest user message exposes the production revert action for choosing a rollback point."
      document={revertDocument}
      width="620px"
    />
  ),
}

export const PromptWithAttachments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with attachments"
      description="A user message combines text, two files, an agent mention, and a selected-line comment."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

export const MixedDirectionRtl = {
  globals: { direction: "rtl" },
  render: () => (
    <CurrentSessionTimelineStory
      title="Mixed-direction prompt in RTL"
      description="Forced RTL keeps file paths and code readable without changing the message order."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

const MovedLocation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Moved Session location"
      description="A changed working directory renders as a timeline divider, truncates, and exposes its tooltip."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_story_location",
            type: "location-switched",
            location: { directory: `/Users/usrnk1/Developer/aigcfroge/${"nested-directory/".repeat(24)}session` },
            time: { created: 1_735_689_633_000 },
          },
        ],
      }}
      width="480px"
    />
  ),
}

const InterruptedTurn = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Interrupted assistant turn"
      description="The interruption divider stays between the original response and its continuation."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_story_interrupted_before",
            type: "assistant",
            agent: "build",
            model: { id: "claude-sonnet-4", providerID: "anthropic" },
            content: [{ type: "text", text: "Before" }],
            error: { type: "MessageAbortedError", message: "Stopped" },
            time: { created: 1_735_689_633_000, completed: 1_735_689_634_000 },
          },
          {
            id: "msg_story_interrupted_after",
            type: "assistant",
            agent: "build",
            model: { id: "claude-sonnet-4", providerID: "anthropic" },
            content: [{ type: "text", text: "After" }],
            time: { created: 1_735_689_635_000, completed: 1_735_689_636_000 },
          },
        ],
      }}
      width="560px"
    />
  ),
}

const AliasedModelNotices = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Aliased model notices"
      description="Provider display names, model variants, and long-name truncation use the production notice component."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          {
            id: "msg_story_fast_nano",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "fast-nano", variant: "xhigh" },
            time: { created: 1_735_689_590_000 },
          },
          {
            id: "msg_story_long_context",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "long-context" },
            time: { created: 1_735_689_591_000 },
          },
          ...thinkingDocument.messages,
        ],
      }}
      width="420px"
    />
  ),
}

const RichUserAttachments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with rich attachments"
      description="An image, JSON attachment, source-file reference, and agent mention remain individually visible."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          {
            id: "msg_story_rich_user",
            type: "user",
            text: "Use @explore with @src/a.ts and inspect the attachments",
            agents: [{ name: "explore", mention: { text: "@explore", start: 4, end: 12 } }],
            files: [
              {
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                mime: "image/png",
                name: "pixel.png",
                source: { type: "inline" },
              },
              { data: "e30=", mime: "application/json", name: "tsconfig.json", source: { type: "inline" } },
              {
                data: "",
                mime: "text/plain",
                name: "a.ts",
                source: { type: "uri", uri: "src/a.ts" },
                mention: { text: "@src/a.ts", start: 18, end: 27 },
              },
            ],
            time: { created: 1_735_689_633_000 },
          },
        ],
      }}
      width="620px"
    />
  ),
}

const conversationScenarios = {
  coordination: { render: () => <CoordinationStory /> },
  responses: { render: () => <ResponseActionsStory /> },
  reasoning: AgentReasoning,
  hidden: WorkingWithoutReasoningDetails,
  retry: RetryAndRecover,
  notices: AgentActivityNotices,
  compaction: CompactSession,
  location: MovedLocation,
  interruption: InterruptedTurn,
  models: AliasedModelNotices,
  attachments: RichUserAttachments,
}

function CoordinationStory() {
  const [state, setState] = createStore<{
    task: string
    communication: string
    communicationsLoaded: boolean
    reference: string
    navigation: string
    remote: "available" | "missing" | "disconnected"
  }>({ task: "None", communication: "None", communicationsLoaded: false, reference: "None", navigation: "None", remote: "available" })

  const communications: SessionCommunicationMessage[] = [
    {
      id: "com_mp03_public_notice", actor: { type: "user", sessionID: "ses_mp03_notice_actor" },
      contentSource: { sessionID: "ses_mp03_content_source", scope: "output" }, targetSessionID: "ses_mp03_notice_target",
      body: { sessionID: "ses_mp03_notice_target", inputID: "msg_mp03_public_notice", digest: "a".repeat(64) },
      requestDigest: "b".repeat(64), delivery: "queue", trigger: false, createdAt: STORY_TIME + 2,
      text: "Complete retained communication\nThe second line stays intact.", state: "visible",
    },
    {
      id: "com_mp03_result_notice", actor: { type: "system", sessionID: "ses_mp03_notice_target",
        origin: { type: "task_operation", operation: { sourceSessionID: "ses_mp03_notice_actor", operationID: "top_mp03_notice" } } },
      contentSource: { sessionID: "ses_mp03_content_source", scope: "result" }, targetSessionID: "ses_mp03_notice_actor",
      body: { sessionID: "ses_mp03_notice_actor", inputID: "msg_mp03_result_notice", digest: "c".repeat(64) },
      requestDigest: "d".repeat(64), delivery: "steer", trigger: false, createdAt: STORY_TIME + 3,
      text: "Complete short-metadata result\nThe saved target stays exact.", state: "visible",
    },
  ]

  const text = "Use @build with @src/a.ts and @saved from A plus @saved from B."

  const references: SessionReference.MentionEncoded[] = [
    { reference: { serverID: "server-a", sessionID: "ses_same", title: "Saved title", scope: { kind: "identity" } }, start: text.indexOf("@saved"), end: text.indexOf("@saved") + 6, content: "@saved" },
    { reference: { serverID: "server-b", sessionID: "ses_same", title: "Saved title", scope: { kind: "through", messageID: "msg_saved_boundary" } }, start: text.lastIndexOf("@saved"), end: text.lastIndexOf("@saved") + 6, content: "@saved" },
  ]

  const document: SessionDocument = {
    ...thinkingDocument,
    sessionID: "ses_mp03_notice_target",
    status: { type: "idle" },
    messages: [
      { id: "msg_mp03_task_notice", type: "synthetic", text: "Task coordination: Inspect the saved result", time: { created: STORY_TIME }, metadata: { coordination: { kind: "task", operationRef: { sourceSessionID: "ses_mp03_notice_actor", operationID: "top_mp03_notice" }, actorSessionID: "ses_mp03_notice_actor", actorAgent: "meta", targetSessionID: "ses_mp03_notice_target" } } },
      { id: "msg_mp03_share_notice", type: "synthetic", text: "Complete saved result body", time: { created: STORY_TIME + 1 }, metadata: { source: "share", sourceSessionID: "ses_mp03_content_source", actorSessionID: "ses_mp03_notice_actor", contentSourceSessionID: "ses_mp03_content_source", scope: "result" } },
      { id: "msg_mp03_public_notice", type: "synthetic", text: "Public communication carrier", time: { created: STORY_TIME + 2 }, metadata: { source: "share", communication: { id: "com_mp03_public_notice" } } },
      { id: "msg_mp03_result_notice", type: "synthetic", text: "Actor result carrier", time: { created: STORY_TIME + 3 }, metadata: { communication: { id: "com_mp03_result_notice" } } },
      { id: "msg_mp03_references", type: "user", text, time: { created: STORY_TIME + 4 }, agents: [{ name: "build", mention: { text: "@build", start: 4, end: 10 } }], files: [{ name: "a.ts", mime: "text/plain", data: "", source: { type: "uri", uri: "src/a.ts" }, mention: { text: "@src/a.ts", start: 16, end: 25 } }] },
    ],
  }

  return (
    <CurrentSessionProviders document={document}>
      <DataProvider directory="C:/workspaces/aigcfroge" sessionID={document.sessionID}
        data={{ session: [
          { id: "ses_mp03_notice_actor", title: "Actual actor", time: { created: STORY_TIME, updated: STORY_TIME } },
          { id: "ses_mp03_notice_target", title: "Notice target", time: { created: STORY_TIME, updated: STORY_TIME } },
          { id: "ses_mp03_content_source", title: "Saved content source", time: { created: STORY_TIME, updated: STORY_TIME } },
        ], session_status: {}, session_diff: {} }}
        onOpenTask={(reference) => setState("task", JSON.stringify(reference))}
        onCommunication={(reference) => state.communicationsLoaded && reference.sessionID === document.sessionID
          ? communications.find((record) => record.id === reference.communicationID) : undefined}
        onOpenCommunication={(reference) => setState("communication", JSON.stringify(reference))}
        onNavigateToSession={(sessionID) => setState("navigation", sessionID)}
        onOpenSessionReference={(reference) => setState("reference", JSON.stringify(reference))}
        onSessionReferenceState={(reference) => ({ title: reference.serverID === "server-a" ? "Newest title A" : "Newest title B", status: reference.serverID === "server-b" ? state.remote : "available" })}
      >
        <section class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
          <div class="flex flex-wrap gap-2"><Button size="small" onClick={() => setState("remote", "missing")}>Mark remote reference deleted</Button><Button size="small" onClick={() => setState("remote", "disconnected")}>Disconnect remote reference</Button><Button size="small" onClick={() => setState("communicationsLoaded", true)}>Load retained communications</Button></div>
          <SessionTimeline document={document} presentation={{ msg_mp03_references: { displayText: text, sessionReferences: references } }} />
          <output aria-label="Opened Task operation">{state.task}</output><output aria-label="Opened communication">{state.communication}</output><output aria-label="Opened Session reference">{state.reference}</output><output aria-label="Opened Session">{state.navigation}</output>
        </section>
      </DataProvider>
    </CurrentSessionProviders>
  )
}

export const Conversation = {
  args: { scenario: "notices", mode: "compact", reasoning: "heading", tool: false, text: "" },
  argTypes: {
    scenario: { control: "select", options: Object.keys(conversationScenarios) },
    reasoning: { control: "select", options: ["none", "blank", "heading"] },
    mode: { control: "select", options: ["hidden", "compact", "full"] },
  },
  render: (args: {
    scenario: keyof typeof conversationScenarios
    mode: ReasoningMode
    reasoning: string
    tool: boolean
    text: string
  }) => {
    if (args.scenario === "reasoning") return <AgentReasoningStory {...args} />

    return conversationScenarios[args.scenario].render()
  },
}

export const InstructionsUpdatedSingle = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (single)"
      description="A system notice in the timeline showing a single updated instruction source."
      document={instructionsUpdatedSingleDocument}
      width="600px"
    />
  ),
}

export const InstructionsUpdatedMultiple = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (multiple)"
      description="A system notice in the timeline showing multiple updated instruction sources."
      document={instructionsUpdatedMultipleDocument}
      width="600px"
    />
  ),
}
