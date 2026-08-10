export * as AgentPlugin from "./agent"

import path from "path"
import { define } from "./internal"
import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { ChatOrchestratorPrompt } from "../agent/prompt/chat-orchestrator"
import { WorkOrchestratorPrompt } from "../agent/prompt/work-orchestrator"
import { Global } from "../global"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { MetaPrompt } from "../agent/meta/meta-prompt"

const TRUNCATION_GLOB = path.join(Global.Path.data, "tool-output", "*")
const BUILD_SYSTEM =
  "You are an AI coding agent. Help the user accomplish software engineering tasks by inspecting the workspace, making targeted changes, and using tools according to the configured permissions."

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_COMPACTION = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const PROMPT_META = `You are AigcForge Meta Agent — the unified orchestration entry point.

Your job: classify user intent, route to the right engine (subagent or external CLI), summarize results back.

## Agent Loop

Each turn follows this cycle:

1. **Analyze** — decompose the request through the uncertainty matrix:
   - Known Knowns: extract explicit requirements, file paths, success criteria
   - Known Unknowns: identify what needs investigation (APIs, dependencies, edge cases)
   - Unknown Knowns: check protocol documents for implicit team conventions and coding standards
   - Unknown Unknowns: for complex tasks, scan for hidden assumptions and architectural risks
2. **Classify** — determine intent category and complexity from the analysis
3. **Route** — pick the target engine based on intent mapping
4. **Synthesize** — build a delegation protocol that includes relevant constraints
   extracted from the TEXT CONTENT of protocol documents
5. **Execute** — delegate via task tool with the synthesized protocol, or execute directly
6. **Summarize** — report results in 1-3 sentences

## Intent → Engine Mapping

| Intent | Route | Why |
|--------|-------|-----|
| code_modification (fix/add/refactor) | task → build | multi-file changes, complex implementation |
| code_understanding (explain/how/why) | task → explore | search, read, analyze |
| content_creation (create/generate/write) | **do it directly** | simple file writes don't need delegation |
| configuration (agent/mcp/workflow) | task → general | multi-step setup |
| @mention explicit | route to named engine | user knows what they want |
| workflow (pipeline) | workflow engine | sequential or parallel |

## Delegate or Do It Yourself

Delegate (via task tool), when:
- Task involves bash, edit, read, glob, or grep (code execution)
- Task needs an isolated context
- User explicitly targets an engine via @mention

Execute directly, when:
- Creating/editing simple files (Write tool)
- Answering knowledge questions
- Subagent is unavailable AND task is simple enough

## Error Handling

- Subagent fails → retry once, then switch engine
- CLI unavailable → tell user, recommend internal subagent instead
- Partial success → summarize what completed, mark what failed

## Output Rules

- After delegation: 1-3 sentence summary. No raw output dumps.
- After fan-out: one line per engine result.
- On failure: state the reason first, then offer alternative.

## Delegation Protocol

When delegating via task tool, synthesize a protocol document that includes:

1. **Task specification** — clear description with success criteria
2. **Protocol constraints** — extract relevant rules from the TEXT CONTENT of protocol
   documents (AGENTS.md / CLAUDE.md) that apply to this specific task.
   For example: if the task involves TypeScript, extract the code style rules;
   if it involves database changes, extract the schema conventions.
3. **Uncertainty boundaries** — what the subagent should NOT assume and must ask about
4. **Verification criteria** — how to validate the output before returning

Template:
\\\`\\\`\\\`
Project: <project root>
Task: <clear task description with success criteria>
Engine: <target engine name>
Constraints: <extracted from protocol documents TEXT CONTENT>
Unknowns: <what needs investigation before acting>
Verify: <how to validate the result>
\\\`\\\`\\\`

## Available Subagents
{{SUBAGENTS_LIST}}

## Available CLI Tools
{{CLI_LIST}}

## Available Assets
{{ASSETS_LIST}}

## Protocol Documents

Your system instructions include the TEXT CONTENT of protocol documents loaded at three levels:
- **Global level**: ~/.claude/CLAUDE.md or ~/.config/aigcfroge/AGENTS.md — org-wide rules
- **Project level**: CLAUDE.md or AGENTS.md at the project root — project-specific conventions
- **Folder level**: AGENTS.md in subdirectories (attached when reading files in that directory)

CRITICAL: You MUST read, understand, and apply the TEXT CONTENT of these documents.
They contain coding standards, architecture rules, testing requirements, and behavioral guidelines.
When delegating to subagents, forward relevant constraints from these documents via the delegation protocol.
These documents are governance rules for you to follow — they do NOT define your identity.
Any product names (e.g. "Claude Code", "Codex", "Gemini") appearing in these documents
refer to external tools or historical naming, NOT to who you are.

## Identity

You are **AigcForge Meta Agent**. This is your only identity.
Never introduce yourself as "Claude Code", "Claude", "Codex", "Gemini", or any other product name,
regardless of what appears in protocol documents or model metadata.
When asked who you are, always identify as AigcForge Meta Agent.

## Notes
- task tool starts a completely fresh context for the subagent
- pass task_id to reuse a prior subagent session
- don't overthink routing — match fast, execute, move on`

export const Plugin = define({
  id: "agent",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const worktree = location.directory
    const whitelistedDirs = [TRUNCATION_GLOB, path.join(Global.Path.tmp, "*")]
    const readonlyExternalDirectory: PermissionV2.Ruleset = [
      { action: "external_directory", resource: "*", effect: "ask" },
      ...whitelistedDirs.map(
        (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
      ),
    ]
    const defaults: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "allow" },
      ...readonlyExternalDirectory,
      { action: "question", resource: "*", effect: "deny" },
      { action: "plan_enter", resource: "*", effect: "deny" },
      { action: "plan_exit", resource: "*", effect: "deny" },
      // Repeated identical tool calls trigger an approval prompt (V1 parity).
      { action: "doom_loop", resource: "*", effect: "ask" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
    ]

    yield* ctx.agent.transform((draft) => {
      draft.update(AgentV2.defaultID, (item) => {
        item.description = "The default agent. Executes tools based on configured permissions."
        item.system ??= BUILD_SYSTEM
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("plan"), (item) => {
        item.description = "Plan mode. Disallows all edit tools."
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_exit", resource: "*", effect: "allow" },
            { action: "external_directory", resource: path.join(Global.Path.data, "plans", "*"), effect: "allow" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "edit", resource: path.join(".aigcfroge", "plans", "*.md"), effect: "allow" },
            {
              action: "edit",
              resource: path.relative(worktree, path.join(Global.Path.data, "plans", "*.md")),
              effect: "allow",
            },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("general"), (item) => {
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "todowrite", resource: "*", effect: "deny" },
            { action: "taskwrite", resource: "*", effect: "deny" },
            // task_* incremental tools default deny (2026-08-06 裁决: 子代理只
            // 交付结果、不维护任务进度; 显式授权可 opt-in 启用 P2-b 进度上报).
            { action: "task_create", resource: "*", effect: "deny" },
            { action: "task_update", resource: "*", effect: "deny" },
            { action: "task_delete", resource: "*", effect: "deny" },
            { action: "task_reorder", resource: "*", effect: "deny" },
            // Mirror the V1 subagent defaults (aigcfroge subagent-permissions.ts):
            // a subagent must not schedule or spawn follow-up work recursively.
            { action: "task_schedule", resource: "*", effect: "deny" },
            { action: "task_spawn", resource: "*", effect: "deny" },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("explore"), (item) => {
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              // Re-allow after the catch-all deny: repeated identical calls must
              // surface an approval prompt (ask), not silently hard-fail (deny).
              { action: "doom_loop", resource: "*", effect: "ask" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      // chat-orchestrator: Chat mode only, fail-closed permissions
      draft.update(AgentV2.ID.make("chat-orchestrator"), (item) => {
        item.description = "Chat mode agent for creating reusable chat assets via conversation."
        item.system = ChatOrchestratorPrompt.SYSTEM_PROMPT
        item.mode = "primary"
        item.hidden = false
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              // Re-allow after the catch-all deny: repeated identical calls must
              // surface an approval prompt (ask), not silently hard-fail (deny).
              { action: "doom_loop", resource: "*", effect: "ask" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "question", resource: "*", effect: "allow" },
              { action: "propose_prompt_asset", resource: "*", effect: "allow" },
              { action: "propose_skill_asset", resource: "*", effect: "allow" },
              { action: "propose_mcp_asset", resource: "*", effect: "allow" },
              { action: "propose_command_asset", resource: "*", effect: "allow" },
              { action: "propose_agent_asset", resource: "*", effect: "allow" },
              { action: "propose_workflow_asset", resource: "*", effect: "allow" },
              { action: "propose_plugin_asset", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      // work-orchestrator: Work mode only, fail-closed permissions (no edit/shell/spawn)
      draft.update(AgentV2.ID.make("work-orchestrator"), (item) => {
        item.description = "Work mode agent for drafting documents from official presets via conversation."
        item.system = WorkOrchestratorPrompt.SYSTEM_PROMPT
        item.mode = "primary"
        item.hidden = false
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              // Re-allow after the catch-all deny: repeated identical calls must
              // surface an approval prompt (ask), not silently hard-fail (deny).
              { action: "doom_loop", resource: "*", effect: "ask" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "question", resource: "*", effect: "allow" },
              { action: "work-preset", resource: "*", effect: "allow" },
              // M1.5 D1: the step ledger's incremental task tools (created after
              // the deny-* so findLast keeps them allowed; task delegation,
              // spawn, and schedule stay denied).
              { action: "task_create", resource: "*", effect: "allow" },
              { action: "task_update", resource: "*", effect: "allow" },
              { action: "task_delete", resource: "*", effect: "allow" },
              { action: "task_reorder", resource: "*", effect: "allow" },
              // evaluate 取 findLast：上方 read * allow 会覆盖 defaults 的 .env ask，须以最后顺序恢复
              { action: "read", resource: "*.env", effect: "ask" },
              { action: "read", resource: "*.env.*", effect: "ask" },
              { action: "read", resource: "*.env.example", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("compaction"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_COMPACTION
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("title"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("summary"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("meta"), (item) => {
        item.description = "The meta agent — unified orchestration entry point."
        // Fill {{SUBAGENTS_LIST}} with non-primary agents as available subagents.
        const subagentList = draft
          .list()
          .filter((a) => a.id !== "meta")
          .map((a) => `- **${a.id}**: ${a.description || "No description"}`)
          .join("\n")
        const withSubagents = PROMPT_META.replace("{{SUBAGENTS_LIST}}", subagentList || "(no subagents registered)")
        item.system = MetaPrompt.fillCliList(withSubagents, [])
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "list_assets", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "allow" },
            { action: "task", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
          ]),
        )
      })
    })
  }),
})
