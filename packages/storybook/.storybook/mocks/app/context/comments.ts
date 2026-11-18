import { createComponent, createContext, useContext, type ParentProps } from "solid-js"
import { createCommentSessionForTest } from "../../../../../app/src/composer/comments"

const createComments = () => ({
  ...createCommentSessionForTest(),
  ready: () => true,
})

const CommentsContext = createContext(createComments())

export function CommentsProvider(props: ParentProps) {
  return createComponent(CommentsContext.Provider, {
    value: createComments(),
    get children() {
      return props.children
    },
  })
}

export function useComments() {
  return useContext(CommentsContext)
}
