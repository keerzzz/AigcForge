import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { CompositionTemporaryInput, CompositionProfileInput } from "@aigcfroge/sdk/v2/client"
import type { Snapshot } from "@aigcfroge/schema/composition"

export interface CustomDraftAgent {
  kind: "agent"
  relativePath: string
  revision: string
  name?: string
  description?: string
}

export interface CustomDraftPrompt {
  kind: "prompt"
  relativePath: string
  revision: string
  name?: string
}

export interface CustomDraftSkill {
  kind: "skill"
  relativePath: string
  revision: string
  name?: string
}

export interface CustomDraftWorkflow {
  kind: "workflow"
  relativePath: string
  revision: string
  name?: string
  description?: string
}

export interface CustomDraftCommand {
  kind: "command"
  relativePath: string
  revision: string
  name?: string
  description?: string
}

export interface CustomDraftBinding {
  prompts: CustomDraftPrompt[]
  skills: CustomDraftSkill[]
  commands: CustomDraftCommand[]
}

export interface CustomDraftState {
  source: "temporary" | "profile"
  profilePath?: string
  profileRevision?: string
  title: string
  agents: CustomDraftAgent[]
  workflow?: CustomDraftWorkflow
  bindings: Record<string, CustomDraftBinding>
  requestedCapabilities: string[]
  presentation: "native"
}

export const DEFAULT_DRAFT: CustomDraftState = {
  source: "temporary",
  title: "",
  agents: [],
  bindings: {},
  requestedCapabilities: [],
  presentation: "native",
}

export function toCompositionInput(state: CustomDraftState): CompositionTemporaryInput | CompositionProfileInput {
  if (state.source === "profile" && state.profilePath) {
    return {
      source: "profile",
      profilePath: state.profilePath,
      profileRevision: state.profileRevision ?? "",
    }
  }

  const bindings: Record<
    string,
    {
      prompts: Array<{ kind: "prompt"; relativePath: string; revision: string }>
      skills: Array<{ kind: "skill"; relativePath: string; revision: string }>
      commands: Array<{ kind: "command"; relativePath: string; revision: string }>
    }
  > = {}

  for (const [consumer, binding] of Object.entries(state.bindings)) {
    bindings[consumer] = {
      prompts: binding.prompts.map((p) => ({
        kind: "prompt",
        relativePath: p.relativePath,
        revision: p.revision,
      })),
      skills: binding.skills.map((s) => ({
        kind: "skill",
        relativePath: s.relativePath,
        revision: s.revision,
      })),
      commands: (binding.commands ?? []).map((command) => ({
        kind: "command",
        relativePath: command.relativePath,
        revision: command.revision,
      })),
    }
  }

  const agents = state.agents.map((a) => ({
    kind: "agent" as const,
    relativePath: a.relativePath,
    revision: a.revision,
  }))

  const workflow = state.workflow
    ? {
        kind: "workflow" as const,
        relativePath: state.workflow.relativePath,
        revision: state.workflow.revision,
      }
    : undefined

  return {
    source: "temporary",
    agents,
    workflow,
    bindings,
    presentation: state.presentation,
    requestedCapabilities: state.requestedCapabilities,
  }
}

export function createCustomDraftState(
  initial: CustomDraftState = DEFAULT_DRAFT,
  customStore?: [get: CustomDraftState, set: SetStoreFunction<CustomDraftState>],
) {
  const [state, setState] =
    customStore ??
    createStore<CustomDraftState>({
      ...initial,
      bindings: Object.fromEntries(
        Object.entries(initial.bindings).map(([consumer, binding]) => [
          consumer,
          { ...binding, commands: binding.commands ?? [] },
        ]),
      ),
    })

  return {
    state,
    get composition(): CompositionTemporaryInput | CompositionProfileInput {
      return toCompositionInput(state)
    },
    setSource(source: "temporary" | "profile") {
      setState("source", source)
    },
    setProfilePath(profilePath: string) {
      setState("profilePath", profilePath)
    },
    setTitle(title: string) {
      setState("title", title)
    },
    setWorkflow(workflow: CustomDraftWorkflow | undefined) {
      setState("workflow", workflow)
    },
    toggleWorkflow(workflow: CustomDraftWorkflow) {
      setState("workflow", state.workflow?.relativePath === workflow.relativePath ? undefined : workflow)
    },
    addAgent(agent: CustomDraftAgent) {
      setState(
        produce((draft) => {
          if (!draft.agents.some((a) => a.relativePath === agent.relativePath)) {
            draft.agents.push(agent)
          }
        }),
      )
    },
    removeAgent(relativePath: string) {
      setState(
        produce((draft) => {
          const removed = draft.agents.find((agent) => agent.relativePath === relativePath)
          draft.agents = draft.agents.filter((a) => a.relativePath !== relativePath)
          if (removed) {
            const consumer = `agents/${removed.name ?? removed.relativePath.replace(/\.md$/, "")}`
            delete draft.bindings[consumer]
          }
        }),
      )
    },
    togglePrompt(consumer: string, prompt: CustomDraftPrompt) {
      setState(
        produce((draft) => {
          const binding = draft.bindings[consumer] ?? { prompts: [], skills: [], commands: [] }
          binding.commands ??= []
          const exists = binding.prompts.some((p) => p.relativePath === prompt.relativePath)
          if (exists) {
            binding.prompts = binding.prompts.filter((p) => p.relativePath !== prompt.relativePath)
            draft.bindings[consumer] = binding
            return
          }
          binding.prompts.push(prompt)
          draft.bindings[consumer] = binding
        }),
      )
    },
    toggleSkill(consumer: string, skill: CustomDraftSkill) {
      setState(
        produce((draft) => {
          const binding = draft.bindings[consumer] ?? { prompts: [], skills: [], commands: [] }
          binding.commands ??= []
          const exists = binding.skills.some((s) => s.relativePath === skill.relativePath)
          if (exists) {
            binding.skills = binding.skills.filter((s) => s.relativePath !== skill.relativePath)
            draft.bindings[consumer] = binding
            return
          }
          binding.skills.push(skill)
          draft.bindings[consumer] = binding
        }),
      )
    },
    toggleCommand(consumer: string, command: CustomDraftCommand) {
      setState(
        produce((draft) => {
          const binding = draft.bindings[consumer] ?? { prompts: [], skills: [], commands: [] }
          binding.commands ??= []
          const exists = binding.commands.some((item) => item.relativePath === command.relativePath)
          if (exists) {
            binding.commands = binding.commands.filter((item) => item.relativePath !== command.relativePath)
            draft.bindings[consumer] = binding
            return
          }
          binding.commands.push(command)
          draft.bindings[consumer] = binding
        }),
      )
    },
    toggleCapability(cap: string) {
      setState(
        produce((draft) => {
          const idx = draft.requestedCapabilities.indexOf(cap)
          if (idx >= 0) {
            draft.requestedCapabilities.splice(idx, 1)
            return
          }
          draft.requestedCapabilities.push(cap)
        }),
      )
    },
    reset() {
      setState(reconcile({ ...DEFAULT_DRAFT }))
    },
    loadFromSnapshot(snapshot: Snapshot) {
      setState(
        produce((draft) => {
          draft.source = "temporary"
          draft.workflow = undefined
          if (snapshot.version === 1) {
            draft.agents = [
              {
                kind: "agent",
                relativePath: `${snapshot.data.agentID}.md`,
                revision: "",
                name: snapshot.data.agentID,
              },
            ]
          } else {
            draft.agents = snapshot.data.agents.map((a) => ({
              kind: "agent",
              relativePath: a.relativePath,
              revision: a.revision,
              name: a.name,
              description: a.description,
            }))
            if (snapshot.data.workflow) {
              draft.workflow = {
                kind: "workflow",
                relativePath: snapshot.data.workflow.relativePath,
                revision: snapshot.data.workflow.revision,
                name: snapshot.data.workflow.name,
                description: snapshot.data.workflow.description,
              }
            }
          }
          const prompts: CustomDraftPrompt[] = snapshot.data.prompts.map((p) => ({
            kind: "prompt",
            relativePath: p.relativePath,
            revision: p.revision,
            name: p.relativePath,
          }))
          const skills: CustomDraftSkill[] = snapshot.data.skills.map((s) => ({
            kind: "skill",
            relativePath: s.name,
            revision: "",
            name: s.name,
          }))
          const commands: CustomDraftCommand[] =
            snapshot.version === 2
              ? (snapshot.data.commands ?? []).map((command) => ({
                  kind: "command",
                  relativePath: command.relativePath,
                  revision: command.revision,
                  name: command.name,
                  description: command.description,
                }))
              : []
          const bindings =
            snapshot.version === 2
              ? Object.fromEntries(
                  // `bindings` is absent on pre-binding V2 snapshots (schema
                  // decodes the key as optional, so `{}` and "missing" stay
                  // distinguishable). A missing map means no per-consumer view
                  // to project, not an empty one.
                  Object.entries(snapshot.data.bindings ?? {}).map(([consumer, binding]) => [
                    consumer,
                    {
                      prompts: binding.prompts.map((prompt) => ({
                        kind: "prompt" as const,
                        relativePath: prompt.relativePath,
                        revision: prompt.revision,
                        name: prompt.relativePath,
                      })),
                      skills: binding.skills.map((skill) => ({
                        kind: "skill" as const,
                        relativePath: skill.relativePath,
                        revision: skill.revision,
                        name: skill.name,
                      })),
                      commands: binding.commands.map((command) => ({
                        kind: "command" as const,
                        relativePath: command.relativePath,
                        revision: command.revision,
                        name: command.name,
                        description: command.description,
                      })),
                    },
                  ]),
                )
              : {}
          draft.bindings = Object.keys(bindings).length > 0 ? bindings : { orchestrator: { prompts, skills, commands } }
          draft.requestedCapabilities = []
        }),
      )
    },
  }
}

const sharedStores = new Map<string, ReturnType<typeof createCustomDraftState>>()

export function createCustomDraftStore(directory: () => string) {
  const key = directory()
  const existing = sharedStores.get(key)
  if (existing) return existing
  const [state, setState] = persisted(
    Persist.global("custom-draft", ["custom-draft.v1"]),
    createStore<CustomDraftState>({ ...DEFAULT_DRAFT }),
  )
  const store = createCustomDraftState(DEFAULT_DRAFT, [state, setState])
  sharedStores.set(key, store)
  return store
}

export type CustomDraftStore = ReturnType<typeof createCustomDraftState>

const CustomDraftContext = createContext<CustomDraftStore>()

export function CustomDraftProvider(props: ParentProps<{ directory: () => string }>) {
  const store = createCustomDraftStore(props.directory)
  return <CustomDraftContext.Provider value={store}>{props.children}</CustomDraftContext.Provider>
}

export function useCustomDraft() {
  const ctx = useContext(CustomDraftContext)
  if (!ctx) throw new Error("useCustomDraft must be used within a CustomDraftProvider")
  return ctx
}
