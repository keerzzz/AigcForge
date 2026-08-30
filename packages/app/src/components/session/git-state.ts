import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

type GitProjectState = {
  statusEnabled: boolean
  directory: string
}

function statusKey(directory: string) {
  return ["git-status", directory] as const
}

function logKey(directory: string) {
  return ["git-log", directory] as const
}

export function createGitState(input: GitProjectState) {
  const sdk = useSDK()
  const language = useLanguage()
  const queryClient = useQueryClient()

  const statusQuery = createQuery(() => ({
    queryKey: statusKey(input.directory),
    enabled: input.statusEnabled,
    queryFn: () =>
      sdk()
        .client.vcs.status({})
        .then((r) => r.data ?? []),
  }))

  const logQuery = createQuery(() => ({
    queryKey: logKey(input.directory),
    enabled: input.statusEnabled,
    queryFn: () =>
      sdk()
        .client.vcs.log({})
        .then((r) => r.data ?? []),
  }))

  const stageMutation = createMutation(() => ({
    mutationFn: (files: string[]) => sdk().client.vcs.stage({ files }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey(input.directory) })
    },
    onError: () => {
      showToast({ title: language.t("git.error.stage") })
    },
  }))

  const unstageMutation = createMutation(() => ({
    mutationFn: (files: string[]) => sdk().client.vcs.unstage({ files }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey(input.directory) })
    },
    onError: () => {
      showToast({ title: language.t("git.error.unstage") })
    },
  }))

  const commitMutation = createMutation(() => ({
    mutationFn: (message: string) => sdk().client.vcs.commit({ message }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey(input.directory) })
      void queryClient.invalidateQueries({ queryKey: logKey(input.directory) })
    },
    onError: () => {
      showToast({ title: language.t("git.error.commit") })
    },
  }))

  const [commitMessage, setCommitMessage] = createSignal("")

  const status = () => statusQuery.data ?? []
  const stagedCount = createMemo(() => status().filter((f) => f.staged).length)
  const unstagedCount = createMemo(() => status().filter((f) => !f.staged).length)
  const hasStaged = () => stagedCount() > 0

  const stageAll = () => {
    const files = status()
      .filter((f) => !f.staged)
      .map((f) => f.file)
    if (files.length > 0) stageMutation.mutate(files)
  }

  const unstageAll = () => {
    const files = status()
      .filter((f) => f.staged)
      .map((f) => f.file)
    if (files.length > 0) unstageMutation.mutate(files)
  }

  const stageFile = (file: string) => stageMutation.mutate([file])
  const unstageFile = (file: string) => unstageMutation.mutate([file])

  const handleCommit = () => {
    const msg = commitMessage().trim()
    if (!msg) return
    commitMutation.mutate(msg, {
      onSuccess: () => setCommitMessage(""),
    })
  }

  return {
    statusQuery,
    logQuery,
    commitMutation,
    status,
    stagedCount,
    unstagedCount,
    hasStaged,
    commitMessage,
    setCommitMessage,
    stageAll,
    unstageAll,
    stageFile,
    unstageFile,
    handleCommit,
    isPending: () =>
      statusQuery.isPending || stageMutation.isPending || unstageMutation.isPending || commitMutation.isPending,
  }
}
