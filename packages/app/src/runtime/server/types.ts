import type {
  AgentListOutput,
  ConfigInstanceConfigInstanceGetOutput,
  ModelListOutput,
  ModelSourceMetadata,
  ModelSourceOrigins,
  ProjectListOutput,
  ProviderAuthMethods,
  ProviderListOutput,
  WorktreeDirectory,
} from "@omnixa/client/promise"
import type { ProductMode } from "@omnixa/schema/product-mode"

export type Project = Omit<ProjectListOutput[number], "canonical"> & {
  worktree: string
  worktrees: WorktreeDirectory[]
}

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: string[]
    }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
  /** On-disk size when the bytes themselves are not retained. */
  size?: number
}

export type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export type VcsInfo = { branch?: string; default_branch?: string }

export type LspStatus = { id: string; name: string; root: string; status: "connected" | "error" }

export type Agent = {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
  model?: { modelID: string; providerID: string; variant?: string } | { type: "group"; groupID: string }
  variant?: string
  prompt?: string
  options: AgentListOutput["data"][number]["request"]["settings"]
  steps?: number
  originKind?: "builtin" | "user"
  ordinaryModes?: ReadonlyArray<ProductMode.ID>
  originRelativePath?: string
  originRevision?: string
}

export type Model = {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  metadata?: ModelSourceMetadata
  origins?: ModelSourceOrigins
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved: boolean | { field: "reasoning" | "reasoning_content" | "reasoning_details" }
  }
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    tiers?: {
      input: number
      output: number
      cache: { read: number; write: number }
      tier: { type: "context"; size: number }
    }[]
    experimentalOver200K?: {
      input: number
      output: number
      cache: { read: number; write: number }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: NonNullable<ModelListOutput["data"][number]["settings"]>
  headers: Record<string, string>
  release_date: string
  variants?: Record<string, NonNullable<ModelListOutput["data"][number]["variants"][number]["settings"]>>
}

export type Provider = {
  id: string
  canonical?: string
  /** Integration that connects this provider; multiple providers can share one integration. */
  integrationID?: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  key?: string
  options: NonNullable<ProviderListOutput["data"][number]["settings"]>
  models: Record<string, Model>
}

export type ProviderListResponse = {
  all: Map<string, Provider>
  default: Record<string, string>
  connected: string[]
}

export type ProviderAuthResponse = ProviderAuthMethods

export type Config = ConfigInstanceConfigInstanceGetOutput
