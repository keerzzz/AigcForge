# V2 Tools

Status: **Current semantic overview.** The Plugin package owns the public tool type; Core owns registration, execution, and generic output bounding.

## Tools

V2 has one structural tool value for locally executable tools. Typed tools declare schemas and execution together:

```ts
const read = Tool.make({
  description: "Read a file",
  input: Schema.Struct({ path: Schema.String }),
  output: Schema.Struct({ content: Schema.String }),
  execute: ({ path }, context) =>
    readFile(path, context).pipe(Effect.map((output) => ({ output, content: output.content }))),
})
```

One tool response may carry three values: the declared, schema-validated `output` is the ephemeral machine value Code Mode receives; `content` is the model-facing value stored durably; and optional `metadata` is compact JSON for tool-specific UI. A tool without `output` intentionally returns only model-visible `content` and optional `metadata`. Dynamic MCP and manifest tools use the same tool shape with runtime JSON Schema.

Built-ins and statically authored plugin tools use this same constructor and execution contract.

`Tool.Tool` is a transparent structural value with exactly one `execute` function. Effect schemas and schemas implementing both Standard Schema V1 and Standard JSON Schema V1 are accepted. The Tool module derives inert model-facing `LLM.ToolDefinition` values and executes tools for the registry; callers normally rely on `Tool.make` inference rather than naming the nested type.

Standard input schemas validate model input into the tool input. Standard output schemas validate the tool response's `output` into the Code Mode machine value. Effect codecs retain their native decode-input and encode-output directions.

Input and output codecs are self-contained. Schema conversion cannot require services. Tool dependencies are acquired during construction and captured by `execute`.

## Every Call Has Durable Identity

Every local tool receives the same concrete invocation context:

```ts
interface Tool.Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  readonly progress: (update: Progress) => Effect.Effect<void>
}
```

`messageID` is the durable ID of the assistant message containing the call. The Session runner owns this association and supplies the complete context to the registry; the registry does not infer it. `callID` carries the same invocation identifier durable events use.

Decoded tool input is passed separately to `execute`. Raw provider input and domain services do not belong in the invocation context.

Effect interruption is the cancellation mechanism. Tools may translate expected typed failures into `ToolFailure`, but must not translate interruption or defects into model-visible failures.

## Plans And Execution Claims

Meta's built-in permissions allow `task_create`, `task_update`, `task_delete`, `task_reorder` and `taskwrite`; effective permission evaluation still applies explicit user rules. These tools maintain the existing Session Task store. The automatic Composer dock consumes its snapshots and remains read-only.

SessionTask receives automatic management identity through internal write options, outside model and HTTP input schemas. The first execution claim captures the actual Tool source and Task revision in the same transaction as Task append or patch, before child or Run admission. An exact source retry reuses that claim; a different source cannot claim the same unsettled Task. Ordinary unbound `in_progress` plan items remain editable.

Automatic single-item, whole-list, reorder and legacy Todo writes preserve execution-owned parent, worker and aggregate Tasks. Workflow and Delegation owners take their own lock before the Task write lock; claim checks read persisted ownership without calling those owners under the Task lock. Background acknowledgements retain running ownership. Authoritative failure, cancellation and settlement release only their captured source and revision; explicit owner retries may replace their own claim without letting an old settlement release the new revision.

Task source navigation derives from durable `metadata.parentTaskID` and the original assistant message/call pair. Multiple attempts retain separate source links and results. A plain Subagent call creates no parent Task unless the caller uses the existing Task path.

## Registrations Are Scoped

Tools are named when registered:

```ts
yield *
  tools.register({
    read,
    write,
    grep,
  })
```

The record key is the authored name. Registration normalizes it before deriving the effective model-facing name. A reusable tool value has no intrinsic name.

```ts
interface Tools {
  readonly register: (
    tools: Readonly<Record<string, Tool.Any>>,
    options?: Tool.RegisterOptions,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}
```

Registration replaces unsupported name characters with `_` and reserves `execute` for Code Mode.

A Location plugin receives only the narrow `Tools` registration capability, not the internal registry. Each activation acquires the Location's services, constructs its tools, and registers them in a fresh plugin-owned Scope.

Within one placement:

- The latest active registration for a name wins.
- Closing a registration removes only that registration.
- Closing the winner reveals the next-latest active registration.
- Mutating the caller's registration record later does not change the captured registration.

## Built-Ins Use The Same Contract

Built-ins use the same tool API while capturing trusted Location services:

```ts
const filesystem = yield * FileSystem.Service
const permission = yield * PermissionV2.Service
const tools = yield * Tools.Service

yield *
  tools.register({
    grep: Tool.make({
      description: "Search file contents",
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          const root = yield* filesystem.resolveRoot(input)

          yield* permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            source: {
              type: "tool",
              messageID: context.messageID,
              callID: context.callID,
            },
            action: "grep",
            resources: [input.pattern],
            save: ["*"],
            metadata: { root: root.resource },
          })

          return yield* filesystem.grep(input, root)
        }).pipe(/* translate expected typed errors to ToolFailure */),
    }),
  })
```

Trusted tools formulate and sequence permission requests. `PermissionV2` evaluates policy and manages approval. The registry does not inject an `assertPermission` helper.

Sharing a tool type does not imply equal authority. Built-ins and trusted Location plugins may capture services that are not available to application tools.

## Requests Capture Tool Values

The Location-scoped registry owns effective lookup and execution through one request-scoped snapshot pairing advertised LLM definitions with captured tools. For each local call it:

1. Resolves one effective named registration.
2. Decodes provider input with the input codec.
3. Executes the tool with the runner-supplied context.
4. Encodes the returned output with the output codec; the encoded value is the ephemeral machine output for Code Mode.
5. Normalizes the tool response into canonical non-empty model content and optional JSON metadata.
6. Bounds the model content; validates metadata, dropping invalid or oversized values with a warning rather than failing the call.
7. Runs `execute.after` hooks with the canonical outcome and managed output paths.
8. Returns one `ToolOutcome` — completed with output, content, and optional metadata, or an error with an optional final partial snapshot — to the runner for durable publication.

Invalid input never executes the tool. Invalid output never produces a successful execution.

When an output-bearing tool omits `content`, an encoded string becomes one text item and any other encoded JSON is serialized once. A tool without `output` must provide non-empty model content.

Each model request captures the effective registration for every advertised name. Execution uses those captured tools; later registration changes affect later requests. Unknown, hook-removed, and final-Step calls fail individually through the same execution seam; the final Step retains tool definitions with `toolChoice: "none"` where the provider supports it so the cached prompt prefix survives.

Durable terminal events are self-contained: success stores exactly the non-empty model content plus optional metadata; failure stores one error plus the final bounded snapshot of partial progress. Provider replay derives its wire value from canonical content; provider-hosted payloads that a protocol requires verbatim live in provider-owned result state, never in a generic result field.

A foreground Workflow Task is available to an actually selected Meta root in Work and takes identity from its Session, controller and Tool Context. It uses the published step inputs and an optional expectedPlanDigest; the owning freezer computes the digest when omitted. It releases the Workflow admission lock before waiting on its owning run. Terminal settlement uses the captured parent Task revision CAS and preserves the run's actual status, quality and producing source. A stale CAS does not report successful Task writeback. Runs with a persisted task_binding deliver result text only through canonical Tool content and history across terminal/cancel/resume/reconcile paths; completion admits no synthetic User copy and does not wake the waiting parent drain. Legacy Custom runs without task_binding retain the existing notification handoff.

An explicit foreground Judge Task is available to a selected Meta root in Work. It resolves every `judge_models` entry before creating execution state, fixes one complete prompt for all workers, and requires distinct resolved provider/API-model identities. Each model uses an existing fresh Delegation and internal reviewer participant. Each worker Task points to the aggregate Task through `parentID`, while its own TaskLink carries the actual Tool source and revision. The existing executor creates each child, and exact receipts determine individual results before the aggregate revision CAS is attempted. A CAS conflict remains visible in `taskSettlement`.

Judge returns all worker bodies, requested and actual model identities, receipt/source, and the exact input completion facts through one canonical Tool result. Metadata receipt values use the existing JSON codec at the durable event boundary. Failure and cancellation preserve completed sibling results; interruption cancels only this invocation's unsettled workers. Omitted arbitration reports `arbitration: "none"`; model opinions do not create typed revision-review approval or permission grants.

`arbitration_model` requests one arbitration of the complete settled Judge evidence. `summary` requests one summary of that same evidence and the actual arbitration result; its optional `model` follows the existing executor selection when omitted. Each enhancement uses the existing fresh child, worker Task and exact receipt path. Its result preserves actual model, body, source, completion and status, including partial, empty, failed, cancelled and unavailable outcomes. The original Judge results remain available. Enhancement inputs are the saved child Users identified by their receipts; the parent result retains the original Judge input without echoing each enhancement input. The aggregate owner performs one final revision CAS after the requested enhancements.

Mechanical verification (L0) returns the readable report together with a structured result identifying its Session, Tool and source. Changed files carry content hashes; package checks record the available script, signature, manifest identity, execution, exit and duration facts. Overall and package statuses distinguish `passed`, `failed`, `unavailable` and `unchecked`. An unavailable or unchecked check does not count as a code failure. Disabling escalation preserves the basic Verifier and existing Permission checks.

For saved write/edit/patch results, ToolIntegrity stores the structured result in `metadata.verification` and includes a reusable `verification.source={messageID,id}` locator in ordinary Tool content. A Task may provide `verification: { source?: { sessionID?, messageID, id }, intent?: "content_creation" }`; an omitted source Session means the calling Session. Omitting `verification` preserves ordinary Task behavior. Explicit content creation may use the complete Task input with L0 recorded as unavailable when no package check exists.

At the reference boundary, the Task decodes the saved mechanical result once, checks its exact source and any owned Task-child binding, and validates current file and manifest identities for L1. An already-associated L2 continuation follows the original revision owner. The configured router derives levels from saved Tool/Task facts, counts each saved mechanical source once, and dispatches only the explicitly requested eligible foreground Judge or internal governance Task. Actual L0 success or the valid existing completion barrier resets escalation. L2 retains the existing artifact/revision, typed review, rejection, Permission and repair/reconcile conditions.

A verification Judge reports narrow `contradiction` or `missing_evidence` observations with non-empty verbatim evidence quotes and details. The owning boundary validates the JSON and checks each quote against the exact evidence input before observations participate in routing. Empty, malformed, partial or failed reports retain their actual status and readable result; they do not establish a passed check, typed review approval or a permission grant. General Judge output keeps its existing contract when `verification` is omitted.

Cancellation preserves the completed Judge workers and their actual bodies, model identities, sources, receipts and verification settlement under the existing interruption contract. A later explicit verification Task may restore that evidence into canonical Tool content when it selects the same mechanical source or the same explicit content-creation input. Its saved result records the prior verification sources it restored, and previously recorded restorations are not re-emitted. Restoring evidence does not itself schedule a worker retry or replace the interrupted invocation's outcome.

The existing `share` tool accepts `scope: "result"` and `result_source: { messageID, id }` to read one saved completed Judge Task from `sourceSessionID`. Its existing permission leaf checks the caller and source/target resources. At this reference boundary, the tool decodes the saved Judge result once and checks its source fields; subsequent Assistant messages do not change that selection. It shares the actual completed summary, a readable partial summary, or the original result fallback, with quality and source facts in the delivered body.

Result sharing derives a stable inbox ID from the share invocation and the selected source/target/result. It reuses the existing notification lifecycle inspection and admits the synthetic input before requesting a wake. An exact retry retains the original admission; a new tool invocation is a new intent. The receipt reports the actual inbox, body, basis, admission and wake facts. A Bus without retained events returns `admission: "unavailable"`. Share does not wait for target execution: consumption is observed in the target's subsequent model request, where the synthetic input becomes ordinary user content.

## Producers And The Registry Own Different Limits

Producers may cap capture or spool data before a complete tool result exists. For example, a process tool may retain output it cannot keep in memory. Producer limits must report their own loss accurately; they are separate from registry bounding and cannot claim to reconstruct bytes already discarded.

After tool execution, the registry bounds the model content sent to the provider: only textual parts are measured, native media remains unchanged under producer-owned limits, and the default cut keeps a head-plus-tail split with the omission marker in the middle. Oversized text is retained in managed storage and replaced with a bounded preview; if complete retention fails, execution fails operationally rather than publishing lossy success. Metadata is validated and measured independently and never becomes an unbounded side channel. Managed paths never appear in `Tool.make` or tool output schemas solely for retention bookkeeping.

`execute.after` hooks receive the canonical bounded outcome and its internal managed paths. Hooks may deliberately transform that outcome; changed content is normalized and bounded again before publication.

## Failures Preserve Interruptions

Outcomes remain distinct:

- `ToolFailure` is an expected model-visible failure.
- Interruption cancels the invocation and is not a tool result.
- Unexpected typed errors and defects follow the runner's operational failure policy.
- Unknown and invalid calls become explicit model-visible execution errors without executing a tool.

Tools translate only errors they deliberately classify as recoverable. Broad cause-catching around `execute` is invalid because it consumes interruption and defects.

## Laws

- **Single execution:** `Tool.make(config)` can execute only `config.execute`.
- **Codec boundary:** a tool observes decoded input; Code Mode observes the validated encoded output; model content and metadata come from the tool response.
- **Canonical representation:** a completed call has exactly one stored model representation; a failed call has exactly one stored error plus at most one final partial snapshot. Every other view is derived at a named boundary.
- **Metadata opt-in:** absent response metadata produces absent metadata, never a copied output.
- **Durable identity:** invocation-owned records use the exact Session, agent, assistant message, and call IDs supplied by the runner.
- **Scoped registration:** closing a Scope removes exactly its registration and reveals any prior active overlay.
- **Captured execution:** a call executes the registered tool advertised in its model request.
- **Per-call rejection:** rejecting one unavailable call cannot fail another call.
- **Storage encapsulation:** domain output does not change according to model-output bounding or retention policy.
