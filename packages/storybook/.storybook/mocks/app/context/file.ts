import { createComponent, createContext, useContext, type ParentProps } from "solid-js"
import { createPathHelpers } from "../../../../../app/src/workspaces/files/path"

export type { FileSelection, SelectedLineRange } from "../../../../../app/src/workspaces/files/types"
export { selectionFromLines } from "../../../../../app/src/workspaces/files/types"

const pool = ["src/session/timeline.tsx", "src/session/composer.tsx", "src/composer/composer.tsx", "README.md"]

function createFile() {
  const paths = createPathHelpers(() => "/tmp/story")
  return {
    ready: () => true,
    normalize: paths.normalize,
    absolute: paths.absolute,
    tab(path: string) {
      return `file:${path}`
    },
    pathFromTab(tab: string) {
      if (!tab.startsWith("file:")) return ""
      return tab.slice(5)
    },
    load: async () => undefined,
    async searchFilesAndDirectories(query: string) {
      const text = query.trim().toLowerCase()
      if (!text) return pool
      return pool.filter((path) => path.toLowerCase().includes(text))
    },
  }
}

const FileContext = createContext(createFile())

export function FileProvider(props: ParentProps) {
  return createComponent(FileContext.Provider, {
    value: createFile(),
    get children() {
      return props.children
    },
  })
}

export function useFile() {
  return useContext(FileContext)
}
