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

export interface CustomDraftBinding {
  prompts: CustomDraftPrompt[]
  skills: CustomDraftSkill[]
}

export interface CustomDraftState {
  source: "temporary" | "profile"
  profilePath?: string
  profileRevision?: string
  title: string
  primaryAgent: string
  agents: CustomDraftAgent[]
  bindings: Record<string, CustomDraftBinding>
  requestedCapabilities: string[]
  presentation: "native"
}

export const DEFAULT_DRAFT: CustomDraftState = {
  source: "temporary",
  title: "",
  primaryAgent: "coder",
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
    }
  }

  const agents = state.agents.map((a) => ({
    kind: "agent" as const,
    relativePath: a.relativePath,
    revision: a.revision,
  }))

  return {
    source: "temporary",
    agents,
    bindings,
    presentation: state.presentation,
    requestedCapabilities: state.requestedCapabilities,
  }
}

export function createCustomDraftState(
  initial: CustomDraftState = DEFAULT_DRAFT,
  customStore?: [get: CustomDraftState, set: SetStoreFunction<CustomDraftState>],
) {
  const [state, setState] = customStore ?? createStore<CustomDraftState>({ ...initial })

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
    setPrimaryAgent(agent: string) {
      setState("primaryAgent", agent)
    },
    addAgent(agent: CustomDraftAgent) {
      setState(
        produce((draft) => {
          if (!draft.agents.some((a) => a.relativePath === agent.relativePath)) {
            draft.agents.push(agent)
          }
          if (draft.agents.length === 1 || !draft.primaryAgent) {
            draft.primaryAgent = agent.name ?? agent.relativePath.replace(/\.md$/, "")
          }
        }),
      )
    },
    removeAgent(relativePath: string) {
      setState(
        produce((draft) => {
          draft.agents = draft.agents.filter((a) => a.relativePath !== relativePath)
          if (
            draft.agents.length > 0 &&
            !draft.agents.some((a) => (a.name ?? a.relativePath.replace(/\.md$/, "")) === draft.primaryAgent)
          ) {
            const first = draft.agents[0]
            draft.primaryAgent = first?.name ?? first?.relativePath.replace(/\.md$/, "") ?? ""
          }
        }),
      )
    },
    togglePrompt(consumer: string, prompt: CustomDraftPrompt) {
      setState(
        produce((draft) => {
          const binding = draft.bindings[consumer] ?? { prompts: [], skills: [] }
          const exists = binding.prompts.some((p) => p.relativePath === prompt.relativePath)
          if (exists) {
            binding.prompts = binding.prompts.filter((p) => p.relativePath !== prompt.relativePath)
          } else {
            binding.prompts.push(prompt)
          }
          draft.bindings[consumer] = binding
        }),
      )
    },
    toggleSkill(consumer: string, skill: CustomDraftSkill) {
      setState(
        produce((draft) => {
          const binding = draft.bindings[consumer] ?? { prompts: [], skills: [] }
          const exists = binding.skills.some((s) => s.relativePath === skill.relativePath)
          if (exists) {
            binding.skills = binding.skills.filter((s) => s.relativePath !== skill.relativePath)
          } else {
            binding.skills.push(skill)
          }
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
          } else {
            draft.requestedCapabilities.push(cap)
          }
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
          draft.primaryAgent = snapshot.data.agentID
          draft.agents = [
            {
              kind: "agent",
              relativePath: `${snapshot.data.agentID}.md`,
              revision: "",
              name: snapshot.data.agentID,
            },
          ]
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
          draft.bindings = {
            orchestrator: { prompts, skills },
          }
          draft.requestedCapabilities = []
        }),
      )
    },
  }
}

export function createCustomDraftStore(_directory: () => string) {
  const [state, setState] = persisted(
    Persist.global("custom-draft", ["custom-draft.v1"]),
    createStore<CustomDraftState>({ ...DEFAULT_DRAFT }),
  )
  return createCustomDraftState(DEFAULT_DRAFT, [state, setState])
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
