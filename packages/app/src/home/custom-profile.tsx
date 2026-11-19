import {
  isConflictError,
  isInvalidRequestError,
  isNotFoundError,
  type CustomProfileSummary,
} from "@aigcfroge/client/promise"
import type { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Button } from "@aigcfroge/ui/button"
import { Select } from "@aigcfroge/ui/select"
import { TextField } from "@aigcfroge/ui/text-field"
import { Option, Schema } from "effect"
import { createEffect, createMemo, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import type { HomeController } from "./model"

const decodeInfo = Schema.decodeUnknownSync(Schema.toCodecJson(CustomProfile.Info))

const sameProfile = Schema.toEquivalence(CustomProfile.Profile)

type Attempt = { candidate: CustomProfile.Candidate; baseRevision?: string; received: boolean }

type Progress =
  | { type: "idle" }
  | { type: "loading"; path: string }
  | { type: "saving"; attempt: Attempt }
  | { type: "checking"; attempt: Attempt; acknowledged?: CustomProfile.Info }
  | { type: "read-failed"; attempt: Attempt; acknowledged?: CustomProfile.Info }
  | { type: "conflict"; path: string; current?: CustomProfile.Info }
  | { type: "saved"; info: CustomProfile.Info }
  | { type: "previewing"; info: CustomProfile.Info }

export function CustomProfileForm(props: {
  owner: {
    client: NonNullable<ReturnType<HomeController["server"]["focusedContext"]>>["sdk"]["api"] | undefined
    directory: string | undefined
  }
  current: () => boolean
  connected: () => boolean
  disabled: () => boolean
  root: () => Composition.Root | undefined
  agents: () => readonly Composition.AgentRef[]
  invalidate: () => void
  preview: (saved: CustomProfile.Info) => Promise<void>
}) {
  const language = useLanguage()
  const lifetime = { active: true, revision: 0, listing: 0, controller: new AbortController() }

  const [state, setState] = createStore<{
    name: string
    description: string
    path: string
    base: CustomProfile.Info | undefined
    profiles: CustomProfileSummary[]
    listing: boolean
    listError: string
    error: string
    progress: Progress
  }>({
    name: "",
    description: "",
    path: "",
    base: undefined,
    profiles: [],
    listing: false,
    listError: "",
    error: "",
    progress: { type: "idle" },
  })

  const current = () => lifetime.active && props.current()
  const ready = () => current() && props.connected() && !!props.owner.directory && !!props.owner.client
  const busy = () => ["loading", "saving", "checking", "previewing"].includes(state.progress.type)
  const pendingRead = () => state.progress.type === "read-failed" || state.progress.type === "checking"
  const editingDisabled = () => props.disabled() || (busy() && state.progress.type !== "previewing")

  const saved = () =>
    state.progress.type === "saved" || state.progress.type === "previewing" ? state.progress.info : undefined

  const conflict = () => (state.progress.type === "conflict" ? state.progress : undefined)
  const recovery = () => (state.progress.type === "read-failed" ? state.progress : undefined)
  const root = () => (state.base ? state.base.profile.root : props.root())
  const overwrite = () => !!state.base && state.path.trim() === state.base.relativePath

  const dirty = () =>
    !state.base ||
    state.name.trim() !== state.base.name ||
    state.description !== state.base.description ||
    state.path.trim() !== state.base.relativePath

  const options = createMemo(() => [
    { path: "", label: language.t("home.custom.profile.new") },
    ...state.profiles.map((profile) => ({
      path: profile.relativePath,
      label: `${profile.name} (${profile.relativePath})`,
    })),
  ])

  const candidate = createMemo(() => {
    const name = Schema.decodeUnknownOption(CustomProfile.Name)(state.name.trim())
    const description = Schema.decodeUnknownOption(CustomProfile.Description)(state.description)

    if (Option.isNone(name) || Option.isNone(description) || !state.path.trim() || (!state.base && !root()?.revision))
      return

    return new CustomProfile.Candidate({
      name: name.value,
      description: description.value,
      relativePath: state.path.trim(),
      profile: CustomProfile.decodeProfile({
        ...(state.base?.profile ?? {
          kind: "custom-profile",
          root: root(),
          agents: props.agents(),
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
          mcpBindings: [],
        }),
        name: name.value,
        description: description.value,
      }),
    })
  })

  const nameError = () =>
    state.name && Option.isNone(Schema.decodeUnknownOption(CustomProfile.Name)(state.name.trim()))
      ? language.t("home.custom.profile.name.invalid")
      : undefined

  const descriptionError = () =>
    Option.isNone(Schema.decodeUnknownOption(CustomProfile.Description)(state.description))
      ? language.t("home.custom.profile.description.invalid")
      : undefined

  onCleanup(() => {
    lifetime.active = false
    lifetime.controller.abort()
  })
  createEffect(() => {
    if (!ready()) return

    untrack(() => void loadList())
  })
  createEffect(() => {
    if (props.connected()) return

    untrack(() => {
      const progress = state.progress
      lifetime.revision += 1
      lifetime.listing += 1
      lifetime.controller.abort()
      lifetime.controller = new AbortController()
      setState("listing", false)

      if (!props.disabled()) props.invalidate()

      if (progress.type === "saving" || progress.type === "checking") {
        setState({
          progress: {
            type: "read-failed",
            attempt: progress.attempt,
            acknowledged: progress.type === "checking" ? progress.acknowledged : undefined,
          },
          error: language.t(
            progress.attempt.received ? "home.custom.profile.error.readback" : "home.custom.profile.error.ack",
          ),
        })

        return
      }

      if (progress.type === "previewing") {
        setState("progress", { type: "saved", info: progress.info })

        return
      }

      if (progress.type === "loading") setState("progress", { type: "idle" })
    })
  })

  function invalidate() {
    props.invalidate()
    setState("error", "")

    if (state.progress.type !== "previewing") return
    lifetime.revision += 1
    lifetime.controller.abort()
    lifetime.controller = new AbortController()
    setState("progress", { type: "saved", info: state.progress.info })
  }

  async function loadList() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || state.listing) return
    const listing = ++lifetime.listing
    setState({ listing: true, listError: "" })

    try {
      const answer = await client["custom-profile"].list({ directory }, { signal: lifetime.controller.signal })

      if (!current() || listing !== lifetime.listing) return
      setState({ profiles: answer.assets, listing: false })
    } catch (error) {
      if (!current() || listing !== lifetime.listing) return
      setState({ listing: false, listError: errorMessage(error, language.t("home.custom.profile.error.list")) })
    }
  }

  function newProfile() {
    lifetime.revision += 1
    invalidate()
    setState({ name: "", description: "", path: "", base: undefined, progress: { type: "idle" } })
  }

  async function loadContent(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || props.disabled() || busy() || pendingRead()) return
    invalidate()
    const revision = ++lifetime.revision
    setState("progress", { type: "loading", path })

    try {
      const info = decodeInfo(
        await client["custom-profile"].content({ directory, path }, { signal: lifetime.controller.signal }),
      )

      if (!current() || revision !== lifetime.revision) return
      setState({
        name: info.name,
        description: info.description,
        path: info.relativePath,
        base: info,
        progress: { type: "saved", info },
      })
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return
      setState({
        progress: { type: "idle" },
        error: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  async function readSaved(attempt: Attempt, acknowledged?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || props.disabled()) return
    const revision = ++lifetime.revision
    const path = acknowledged?.relativePath ?? attempt.candidate.relativePath
    setState({ progress: { type: "checking", attempt, acknowledged }, error: "" })

    try {
      const [content, catalog] = await Promise.all([
        client["custom-profile"].content({ directory, path }, { signal: lifetime.controller.signal }),
        client["custom-profile"].list({ directory }, { signal: lifetime.controller.signal }),
      ])

      if (!current() || revision !== lifetime.revision) return
      const info = decodeInfo(content)
      setState("profiles", catalog.assets)

      if (
        !matches(attempt.candidate, info) ||
        (acknowledged &&
          (info.relativePath !== acknowledged.relativePath || info.revision !== acknowledged.revision)) ||
        !catalog.assets.some(
          (entry) =>
            entry.relativePath === info.relativePath && entry.revision === info.revision && entry.name === info.name,
        )
      ) {
        props.invalidate()
        setState({
          progress: { type: "conflict", path: info.relativePath, current: info },
          error: language.t("home.custom.profile.error.changed", { path: info.relativePath }),
        })

        return
      }

      setState({
        path: state.path.trim() === attempt.candidate.relativePath ? info.relativePath : state.path,
        base: info,
        progress: { type: "saved", info },
        error: "",
      })
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return

      if (!attempt.received && isNotFoundError(error)) {
        setState({ progress: { type: "idle" }, error: language.t("home.custom.profile.error.unconfirmed", { path }) })

        return
      }

      setState({
        progress: { type: "read-failed", attempt, acknowledged },
        error: errorMessage(
          error,
          language.t(acknowledged ? "home.custom.profile.error.readback" : "home.custom.profile.error.ack"),
        ),
      })
    }
  }

  async function readConflict(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    const revision = ++lifetime.revision

    try {
      const info = decodeInfo(
        await client["custom-profile"].content({ directory, path }, { signal: lifetime.controller.signal }),
      )

      if (!current() || revision !== lifetime.revision) return
      setState("progress", { type: "conflict", path: info.relativePath, current: info })
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return
      setState({
        progress: { type: "conflict", path },
        error: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  async function save(replacement?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || props.disabled() || busy() || pendingRead()) return

    const value = candidate()

    if (!value) return
    const baseRevision = replacement?.revision ?? (overwrite() ? state.base?.revision : undefined)

    const attempt: Attempt = {
      candidate: replacement
        ? new CustomProfile.Candidate({ ...value, relativePath: replacement.relativePath })
        : value,
      received: false,
      baseRevision,
    }

    if (replacement) setState("path", replacement.relativePath)
    invalidate()
    const revision = ++lifetime.revision
    setState("progress", { type: "saving", attempt })

    try {
      const answer = await client["custom-profile"].apply(
        {
          directory,
          candidate: attempt.candidate,
          overwrite: !!attempt.baseRevision,
          baseRevision: attempt.baseRevision,
        },
        { signal: lifetime.controller.signal },
      )

      if (!current() || revision !== lifetime.revision) return
      attempt.received = true
      await readSaved(attempt, decodeInfo(answer))
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return

      if (isConflictError(error)) {
        setState({
          progress: { type: "conflict", path: attempt.candidate.relativePath },
          error: errorMessage(
            error,
            language.t("home.custom.profile.error.changed", { path: attempt.candidate.relativePath }),
          ),
        })
        await readConflict(attempt.candidate.relativePath)

        return
      }

      if (isInvalidRequestError(error)) {
        setState({
          progress: { type: "idle" },
          error: errorMessage(error, language.t("home.custom.profile.error.save")),
        })

        return
      }

      // A missing save reply leaves the actual file authoritative. Recovery only reads this attempt's target.
      await readSaved(attempt)
    }
  }

  async function preview() {
    const client = props.owner.client
    const directory = props.owner.directory
    const before = saved()

    if (!ready() || !client || !directory || !before || dirty() || props.disabled() || busy()) return
    invalidate()
    const revision = ++lifetime.revision
    setState("progress", { type: "previewing", info: before })

    try {
      const info = decodeInfo(
        await client["custom-profile"].content(
          { directory, path: before.relativePath },
          { signal: lifetime.controller.signal },
        ),
      )

      if (!current() || revision !== lifetime.revision) return

      if (info.relativePath !== before.relativePath || info.revision !== before.revision) {
        props.invalidate()
        setState({
          progress: { type: "conflict", path: before.relativePath, current: info },
          error: language.t("home.custom.profile.error.changed", { path: before.relativePath }),
        })

        return
      }

      await props.preview(info)

      if (!current() || revision !== lifetime.revision) return
      setState("progress", { type: "saved", info })
    } catch (error) {
      if (!current() || revision !== lifetime.revision) return
      setState({
        progress: { type: "saved", info: before },
        error: errorMessage(error, language.t("home.custom.profile.error.preview")),
      })
    }
  }

  return (
    <section
      aria-label={language.t("home.custom.profile.title")}
      class="flex min-w-0 flex-col gap-3 text-[13px] leading-[var(--line-height-compact)]"
    >
      <h3 class="font-medium leading-[var(--line-height-base)]">{language.t("home.custom.profile.title")}</h3>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Select
          aria-label={language.t("home.custom.profile.select")}
          options={options()}
          current={options().find((option) => option.path === (state.base?.relativePath ?? ""))}
          value={(option) => option.path}
          label={(option) => option.label}
          disabled={!ready() || props.disabled() || busy() || pendingRead()}
          onSelect={(option) => {
            if (!option) return

            if (!option.path) return newProfile()
            void loadContent(option.path)
          }}
        />
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={!ready() || props.disabled() || state.listing || busy()}
          onClick={() => void loadList()}
        >
          {language.t(state.listing ? "home.custom.profile.loading" : "home.custom.profile.reload")}
        </Button>
      </div>
      <Show when={!state.listing && state.profiles.length === 0 && !state.listError}>
        <p class="text-v2-text-text-muted">{language.t("home.custom.profile.empty")}</p>
      </Show>
      <Show when={state.listError}>
        <p role="alert" class="break-words">
          {state.listError}
        </p>
      </Show>
      <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label={language.t("home.custom.profile.name")}
          value={state.name}
          required
          maxLength={80}
          disabled={editingDisabled()}
          error={nameError()}
          validationState={nameError() ? "invalid" : "valid"}
          onChange={(name) => {
            invalidate()
            setState("name", name)
          }}
        />
        <TextField
          label={language.t("home.custom.profile.path")}
          value={state.path}
          required
          placeholder={language.t("home.custom.profile.path.placeholder")}
          disabled={editingDisabled()}
          onChange={(path) => {
            invalidate()
            setState("path", path)
          }}
        />
        <div class="min-w-0 sm:col-span-2">
          <TextField
            label={language.t("home.custom.profile.description")}
            value={state.description}
            multiline
            maxLength={300}
            disabled={editingDisabled()}
            error={descriptionError()}
            validationState={descriptionError() ? "invalid" : "valid"}
            onChange={(description) => {
              invalidate()
              setState("description", description)
            }}
          />
        </div>
      </div>
      <Show
        when={root()}
        fallback={
          <p role="status" class="text-v2-text-text-muted">
            {language.t(state.base ? "home.custom.profile.root.legacy" : "home.custom.profile.selection.required")}
          </p>
        }
      >
        {(selected) => (
          <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt class="text-v2-text-text-muted">{language.t("home.custom.root.label")}</dt>
            <dd>
              {(() => {
                const value = selected()

                return value.source === "asset" ? value.id : language.t(`home.custom.root.${value.id}`)
              })()}
            </dd>
            <dt class="text-v2-text-text-muted">{language.t("home.custom.version.label")}</dt>
            <dd class="min-w-0 break-all font-mono text-[12px]">{selected().revision}</dd>
          </dl>
        )}
      </Show>
      <Show when={saved()}>
        {(info) => (
          <div class="flex min-w-0 flex-col gap-2">
            <p role="status">{language.t("home.custom.profile.saved")}</p>
            <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.path")}</dt>
              <dd class="min-w-0 break-all">
                <bdi>{info().relativePath}</bdi>
              </dd>
              <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.revision")}</dt>
              <dd class="min-w-0 break-all font-mono text-[12px]">{info().revision}</dd>
            </dl>
          </div>
        )}
      </Show>
      <Show when={conflict()}>
        {(issue) => (
          <div class="flex min-w-0 flex-col gap-2">
            <Show when={issue().current}>
              {(info) => (
                <p class="min-w-0 break-all font-mono text-[12px]">
                  {language.t("home.custom.profile.conflict.revision", { revision: info().revision })}
                </p>
              )}
            </Show>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!ready() || props.disabled()}
                onClick={() => void loadContent(issue().path)}
              >
                {language.t("home.custom.profile.content.reload")}
              </Button>
              <Show when={issue().current}>
                {(info) => (
                  <Button
                    type="button"
                    size="small"
                    variant="outline"
                    disabled={!ready() || props.disabled() || !candidate()}
                    onClick={() => void save(info())}
                  >
                    {language.t("home.custom.profile.overwrite")}
                  </Button>
                )}
              </Show>
              <Show when={!issue().current}>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={!ready() || props.disabled()}
                  onClick={() => void readConflict(issue().path)}
                >
                  {language.t("home.custom.profile.read.retry")}
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={state.error}>
        <p role="alert" class="break-words">
          {state.error}
        </p>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={!pendingRead() && !conflict()}>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={!ready() || props.disabled() || busy() || !candidate() || !dirty()}
            onClick={() => void save()}
          >
            {language.t(
              state.progress.type === "saving"
                ? "home.custom.profile.saving"
                : overwrite()
                  ? "home.custom.profile.overwrite"
                  : "home.custom.profile.save",
            )}
          </Button>
        </Show>
        <Show when={recovery()}>
          {(pending) => (
            <Button
              type="button"
              size="small"
              variant="outline"
              disabled={!ready() || props.disabled() || busy()}
              onClick={() => void readSaved(pending().attempt, pending().acknowledged)}
            >
              {language.t("home.custom.profile.read.retry")}
            </Button>
          )}
        </Show>
        <Show when={state.progress.type === "checking"}>
          <p role="status" class="text-v2-text-text-muted">
            {language.t("home.custom.profile.reading")}
          </p>
        </Show>
        <Show when={saved()}>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={!ready() || props.disabled() || busy() || dirty()}
            onClick={() => void preview()}
          >
            {language.t(
              state.progress.type === "previewing" ? "home.custom.preview.loading" : "home.custom.profile.preview",
            )}
          </Button>
        </Show>
      </div>
    </section>
  )
}

function matches(candidate: CustomProfile.Candidate, info: CustomProfile.Info) {
  return (
    candidate.name === info.name &&
    candidate.description === info.description &&
    sameProfile(candidate.profile, info.profile)
  )
}

export * as CustomProfileUI from "./custom-profile"
