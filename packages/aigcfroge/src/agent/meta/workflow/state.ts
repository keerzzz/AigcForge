export type WorkflowStatus = "pending" | "running" | "completed" | "failed"

export interface WorkflowStep {
  target: string
  type: "subagent" | "external-cli"
  prompt: string
}

export interface StepResult {
  step: WorkflowStep
  status: WorkflowStatus
  output?: string
  error?: string
  seq: number
}

export interface WorkflowState {
  id: string
  status: WorkflowStatus
  steps: WorkflowStep[]
  results: StepResult[]
  createdAt: number
  updatedAt: number
}

export function createWorkflow(id: string, steps: WorkflowStep[]): WorkflowState {
  return {
    id,
    status: "pending",
    steps,
    results: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function updateStatus(state: WorkflowState, status: WorkflowStatus): WorkflowState {
  return { ...state, status, updatedAt: Date.now() }
}

export function addResult(state: WorkflowState, result: StepResult): WorkflowState {
  return {
    ...state,
    results: [...state.results, result],
    updatedAt: Date.now(),
  }
}

export const failed = (state: WorkflowState, error: string): WorkflowState =>
  updateStatus(addResult(state, {
    step: state.steps[state.results.length] ?? { target: "unknown", type: "subagent", prompt: "" },
    status: "failed",
    error,
    seq: state.results.length + 1,
  }), "failed")

export * as WorkflowState from "./state"
