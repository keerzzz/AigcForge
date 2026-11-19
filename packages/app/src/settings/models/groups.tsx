import type {
  ConnectionInfo,
  ModelGroupAuthored,
  ModelGroupDefinition,
  ModelGroupRead,
  ModelGroupSaveResult,
  ModelSourceConnectionRef,
} from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { Checkbox } from "@aigcfroge/ui/checkbox"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@aigcfroge/ui/dialog"
import { Field } from "@aigcfroge/ui/field"
import { Select } from "@aigcfroge/ui/select"
import { Switch } from "@aigcfroge/ui/switch"
import { TextInput } from "@aigcfroge/ui/text-input"
import { createEffect, For, onCleanup, Show, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useModels } from "@/providers/models/models"
import { matchesModelSearch } from "@/providers/models/search"
import { useIntegrations } from "@/providers/catalog/integrations"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { providerAccounts } from "@/settings/providers/accounts"
import { errorMessage } from "@/shell/layout/helpers"

export function SettingsModelGroups(props: { active?: boolean; search: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()
  const definition = data.location.model.group.definition
  const lifetime = { active: true, generation: 0 }
  const [state, setState] = createStore({ loading: false, error: "" })
  onCleanup(() => {
    lifetime.active = false
  })

  async function load() {
    const api = sdk.api
    const generation = ++lifetime.generation
    setState({ loading: true, error: "" })

    try {
      await definition.sync()
    } catch (error) {
      if (lifetime.active && api === sdk.api && generation === lifetime.generation)
        setState("error", errorMessage(error, language.t("model.group.read.error")))
    } finally {
      if (lifetime.active && api === sdk.api && generation === lifetime.generation) setState("loading", false)
    }
  }

  createEffect(() => {
    if (props.active === false || sdk.connection.status() !== "connected") return
    untrack(() => void load())
  })

  const groups = () =>
    definition
      .list()
      ?.definitions.filter((group) =>
        matchesModelSearch(props.search, [
          group.definition.name,
          group.groupID,
          group.source.path ?? group.source.scope,
        ]),
      ) ?? []

  function edit(source?: ModelGroupAuthored) {
    const read = definition.list()

    if (!read) return

    void dialog.show(() => (
      <Dialog size="large" preventBackdropDismiss>
        <DialogHeader>
          <DialogTitle>
            {source
              ? language.t("model.group.edit", { name: source.definition.name || source.groupID })
              : language.t("model.group.create")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ModelGroupForm read={read} source={source} />
        </DialogBody>
      </Dialog>
    ))
  }

  return (
    <section class="mb-6 flex min-w-0 flex-col gap-3" aria-label={language.t("model.group.title")}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-13-medium">{language.t("model.group.title")}</h3>
        <Button
          size="small"
          variant="neutral"
          disabled={state.loading || !definition.list()?.targets.some((target) => target.writable)}
          onClick={() => edit()}
        >
          {language.t("model.group.create")}
        </Button>
      </div>
      <Show when={state.error}>
        <p role="alert" class="text-13-regular text-text-base">
          {state.error}
        </p>
        <Button size="small" variant="ghost" onClick={() => void load()}>
          {language.t("model.group.reload")}
        </Button>
      </Show>
      <Show
        when={groups().length}
        fallback={
          <p class="text-13-regular text-text-weak">
            {state.loading ? language.t("common.loading") : language.t("model.group.empty")}
          </p>
        }
      >
        <SettingsList variant="catalog">
          <For each={groups()}>
            {(group) => (
              <SettingsRow
                title={group.definition.name || group.groupID}
                description={
                  <span class="flex flex-col gap-1">
                    <span>
                      {language.plural("model.group.members", group.definition.members.length)} ·{" "}
                      {language.t(
                        group.definition.enabled ? "model.group.enabled.status" : "model.group.disabled.status",
                      )}
                    </span>
                    <span class="break-all">
                      {group.source.path ?? language.t(`provider.custom.scope.${group.source.scope}`)}
                    </span>
                  </span>
                }
              >
                <Button
                  size="small"
                  variant="ghost"
                  disabled={!group.target?.writable}
                  aria-label={language.t("model.group.edit", { name: group.definition.name || group.groupID })}
                  onClick={() => edit(group)}
                >
                  {language.t("common.edit")}
                </Button>
              </SettingsRow>
            )}
          </For>
        </SettingsList>
      </Show>
    </section>
  )
}

function ModelGroupForm(props: { read: ModelGroupRead; source?: ModelGroupAuthored }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const models = useModels()
  const integrations = useIntegrations(() => data.location.default().directory)
  const dialog = useDialog()
  const definition = data.location.model.group.definition
  const lifetime = { active: true }

  const [state, setState] = createStore<{
    read: ModelGroupRead
    groupID: string
    name: string
    enabled: boolean
    members: ModelGroupDefinition["members"]
    strategy: ModelGroupDefinition["strategy"]
    affinity: ModelGroupDefinition["affinity"]
    targetPath?: string
    saving: boolean
    saved: boolean
    recordedID?: string
    removed: boolean
    error: string
    result?: ModelGroupSaveResult["definition"]
  }>({
    read: structuredClone(unwrap(props.read)),
    groupID: props.source?.groupID ?? "",
    name: props.source?.definition.name ?? "",
    enabled: props.source?.definition.enabled ?? true,
    members: structuredClone(unwrap(props.source?.definition.members ?? [])),
    strategy: props.source?.definition.strategy ?? "order",
    affinity: props.source?.definition.affinity ?? "turn",
    targetPath:
      props.source?.target?.path ??
      props.read.targets.find((target) => target.preferred && target.writable)?.path ??
      props.read.targets.find((target) => target.writable)?.path,
    saving: false,
    saved: false,
    removed: false,
    error: "",
  })

  onCleanup(() => {
    lifetime.active = false
  })
  const target = () => state.read.targets.find((target) => target.path === state.targetPath)
  const locked = () => state.saving || state.removed

  const source = () =>
    state.read.definitions.find((group) => group.groupID === state.groupID && group.target?.path === state.targetPath)

  const memberLabel = (member: ModelGroupDefinition["members"][number]) =>
    models.find({ providerID: member.providerID, modelID: member.id })?.name ?? member.id

  const usesQuota = () => ["smart", "usage", "pace", "free", "expiring", "drain"].includes(state.strategy)

  function integration(member: ModelGroupDefinition["members"][number]) {
    const provider = data.location.provider.list()?.find((provider) => provider.id === member.providerID)

    return integrations.list().find((entry) => entry.id === (provider?.integrationID ?? member.providerID))
  }

  function connections(member: ModelGroupDefinition["members"][number]) {
    const current = integration(member)

    return [
      ...providerAccounts(current),
      ...(current?.connections.filter((connection) => connection.type === "env") ?? []),
    ]
  }

  function changeTarget(path: string) {
    const group = state.read.definitions.find((group) => group.groupID === state.groupID && group.target?.path === path)

    setState({ targetPath: path, saved: false, result: undefined, error: "" })

    if (!group) return

    setState({
      name: group.definition.name,
      enabled: group.definition.enabled,
      members: structuredClone(unwrap(group.definition.members)),
      strategy: group.definition.strategy,
      affinity: group.definition.affinity,
    })
  }

  function moveMember(index: number, delta: 1 | -1) {
    const members = [...state.members]
    const other = index + delta
    const member = members[index]
    const displaced = members[other]

    if (!member || !displaced) return

    members[index] = displaced
    members[other] = member
    setState({ members, saved: false, result: undefined, error: "" })
  }

  async function reload() {
    const api = sdk.api
    setState({ saving: true, error: "" })

    try {
      definition.invalidate()

      await definition.sync()

      if (!lifetime.active || api !== sdk.api) return

      const read = definition.list()

      if (read) setState({ read: structuredClone(unwrap(read)), result: undefined })
    } catch (error) {
      if (lifetime.active && api === sdk.api)
        setState("error", errorMessage(error, language.t("model.group.read.error")))
    } finally {
      if (lifetime.active && api === sdk.api) setState("saving", false)
    }
  }

  async function submit(remove = false) {
    const selected = target()

    if (!selected?.writable || locked()) return

    const api = sdk.api
    const location = data.location.default()
    setState({ saving: true, error: "", result: undefined })

    try {
      const payload = {
        groupID: state.groupID,
        target: { scope: selected.scope, path: selected.path },
        expectedDigest: selected.digest,
      }

      const response = remove
        ? await api.model.group.definition.remove({ location, payload })
        : await api.model.group.definition.save({
            location,
            payload: {
              ...payload,
              patch: {
                set: {
                  name: state.name,
                  enabled: state.enabled,
                  members: structuredClone(unwrap(state.members)),
                  strategy: state.strategy,
                  affinity: state.affinity,
                },
              },
            },
          })

      if (!lifetime.active || api !== sdk.api) return

      setState("result", response.data.definition)

      if (response.data.definition.status !== "saved" && response.data.definition.status !== "unchanged") return

      setState({ saved: true, removed: remove, recordedID: state.groupID })

      const committed = response.data.definition.target

      if (committed) setState("read", "targets", (target) => target.path === committed.path, committed)

      definition.invalidate()

      await definition.sync()

      if (!lifetime.active || api !== sdk.api) return

      const read = definition.list()

      if (read) setState("read", structuredClone(unwrap(read)))
    } catch (error) {
      if (lifetime.active && api === sdk.api)
        setState(
          "error",
          state.saved
            ? language.t("model.group.saved.refresh")
            : errorMessage(error, language.t("model.group.save.error")),
        )
    } finally {
      if (lifetime.active && api === sdk.api) setState("saving", false)
    }
  }

  return (
    <form
      class="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <Field.Label>{language.t("model.group.id")}</Field.Label>
          <TextInput
            appearance="large"
            required
            class="w-full"
            value={state.groupID}
            disabled={locked() || !!props.source || !!state.recordedID}
            onInput={(event) =>
              setState({ groupID: event.currentTarget.value, saved: false, result: undefined, error: "" })
            }
          />
        </Field>
        <Field>
          <Field.Label>{language.t("model.group.name")}</Field.Label>
          <TextInput
            appearance="large"
            class="w-full"
            value={state.name}
            disabled={locked()}
            onInput={(event) =>
              setState({ name: event.currentTarget.value, saved: false, result: undefined, error: "" })
            }
          />
        </Field>
      </div>
      <div class="flex min-w-0 flex-col gap-2">
        <span class="text-13-medium">{language.t("provider.custom.scope.label")}</span>
        <Select
          modal
          aria-label={language.t("provider.custom.scope.label")}
          options={state.read.targets.filter((target) => target.writable)}
          current={target()}
          value={(target) => target.path}
          label={(target) => language.t(`provider.custom.scope.${target.scope}`) + " · " + target.path}
          disabled={locked()}
          onSelect={(target) => {
            if (target) changeTarget(target.path)
          }}
        />
        <Show when={!target()?.writable}>
          <p class="text-13-regular text-text-weak">{language.t("provider.custom.scope.unavailable")}</p>
        </Show>
        <Show when={source()?.inherited.length}>
          <p class="text-13-regular text-text-weak">
            {language.t("provider.custom.inherited", {
              sources:
                source()
                  ?.inherited.map((source) => source.path ?? language.t(`provider.custom.scope.${source.scope}`))
                  .join(", ") ?? "",
            })}
          </p>
        </Show>
      </div>
      <Switch
        checked={state.enabled}
        disabled={locked()}
        onChange={(enabled) => setState({ enabled, saved: false, result: undefined, error: "" })}
      >
        {language.t("model.group.enabled")}
      </Switch>
      <div class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-2">
          <span class="text-13-medium">{language.t("model.group.strategy")}</span>
          <Select
            modal
            aria-label={language.t("model.group.strategy")}
            options={
              [
                "order",
                "rotate",
                "weight",
                "fast",
                "cheap",
                "smart",
                "usage",
                "pace",
                "free",
                "expiring",
                "drain",
              ] satisfies ModelGroupDefinition["strategy"][]
            }
            current={state.strategy}
            value={(strategy) => strategy}
            label={(strategy) => language.t(`model.group.strategy.${strategy}`)}
            disabled={locked()}
            onSelect={(strategy) => {
              if (strategy) setState({ strategy, saved: false, result: undefined, error: "" })
            }}
          />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <span class="text-13-medium">{language.t("model.group.affinity")}</span>
          <Select
            modal
            aria-label={language.t("model.group.affinity")}
            options={["turn", "session", "off"] satisfies ModelGroupDefinition["affinity"][]}
            current={state.affinity}
            value={(affinity) => affinity}
            label={(affinity) => language.t(`model.group.affinity.${affinity}`)}
            disabled={locked()}
            onSelect={(affinity) => {
              if (affinity) setState({ affinity, saved: false, result: undefined, error: "" })
            }}
          />
        </div>
      </div>
      <div class="flex flex-col gap-2 text-13-regular text-text-weak">
        <p>{language.t(`model.group.strategy.inputs.${state.strategy}`)}</p>
        <p>{language.t("model.group.weights")}</p>
      </div>
      <section class="flex min-w-0 flex-col gap-4" aria-label={language.t("model.group.member.model")}>
        <ol class="flex min-w-0 flex-col gap-4">
          <For each={state.members}>
            {(member, index) => {
              const model = () =>
                data.location.model
                  .list()
                  ?.find((model) => model.providerID === member.providerID && model.id === member.id)

              const quote = () => {
                const observation = model()?.metadata?.quote

                if (!observation || observation.status === "unknown") return

                return observation
              }

              const quoteStatus = () => {
                const observation = quote()

                if (!observation) return "unknown"

                if (observation.validFrom !== undefined && observation.validFrom > Date.now()) return "future"

                if (observation.validUntil !== undefined && observation.validUntil <= Date.now()) return "expired"

                return observation.status
              }

              const choices = () => {
                const selected = member.connections?.map((connection) => connectionKey(connection.ref)) ?? []

                return [
                  ...selected,
                  ...connections(member)
                    .map(connectionKey)
                    .filter((key) => !selected.includes(key)),
                ]
              }

              return (
                <li class="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-weak-base pb-4">
                  <span class="text-13-regular text-text-weak tabular-nums">{index() + 1}.</span>
                  <span class="min-w-0 flex-1 break-words text-13-regular">
                    {memberLabel(member)} <span class="text-text-weak">({member.providerID})</span>
                  </span>
                  <Select
                    modal
                    aria-label={language.t("model.group.member.variant", { model: memberLabel(member) })}
                    options={[
                      "default",
                      ...new Set([
                        ...Object.keys(
                          models.find({ providerID: member.providerID, modelID: member.id })?.variants ?? {},
                        ),
                        ...(member.variant ? [member.variant] : []),
                      ]),
                    ]}
                    current={member.variant ?? "default"}
                    value={(variant) => variant}
                    label={(variant) => (variant === "default" ? language.t("model.group.variant.default") : variant)}
                    disabled={locked()}
                    onSelect={(variant) => {
                      if (!variant) return

                      setState("members", index(), "variant", variant === "default" ? undefined : variant)
                      setState({ saved: false, result: undefined, error: "" })
                    }}
                  />
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={locked() || index() === 0}
                    aria-label={language.t("model.group.member.up", { model: memberLabel(member) })}
                    onClick={() => moveMember(index(), -1)}
                  >
                    {language.t("model.group.up")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={locked() || index() === state.members.length - 1}
                    aria-label={language.t("model.group.member.down", { model: memberLabel(member) })}
                    onClick={() => moveMember(index(), 1)}
                  >
                    {language.t("model.group.down")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={locked()}
                    aria-label={language.t("model.group.member.remove", { model: memberLabel(member) })}
                    onClick={() =>
                      setState({
                        members: state.members.filter((_, memberIndex) => memberIndex !== index()),
                        saved: false,
                        result: undefined,
                        error: "",
                      })
                    }
                  >
                    {language.t("model.group.member.removeButton")}
                  </Button>
                  <Field>
                    <Field.Label>{language.t("model.group.member.weight", { model: memberLabel(member) })}</Field.Label>
                    <TextInput
                      appearance="large"
                      type="number"
                      step="any"
                      min="0"
                      numeric
                      class="w-24"
                      value={member.weight ?? ""}
                      placeholder={language.t("model.group.weight.default")}
                      disabled={locked()}
                      onInput={(event) => {
                        setState(
                          "members",
                          index(),
                          "weight",
                          readWeight(event.currentTarget, language.t("model.group.weight.invalid")),
                        )
                        setState({ saved: false, result: undefined, error: "" })
                      }}
                    />
                  </Field>
                  <Show when={state.strategy === "cheap"}>
                    <dl
                      class="flex w-full min-w-0 flex-col gap-1 text-13-regular text-text-weak"
                      aria-label={language.t("model.group.quote.title", { model: memberLabel(member) })}
                    >
                      <div class="flex flex-wrap gap-x-2">
                        <dt>{language.t("model.group.quote.label")}</dt>
                        <dd>{language.t(`model.group.quote.status.${quoteStatus()}`)}</dd>
                      </div>
                      <Show when={quote()}>
                        {(observation) => (
                          <>
                            <Show when={observation().source}>
                              <div class="flex flex-wrap gap-x-2">
                                <dt>{language.t("model.group.quota.source")}</dt>
                                <dd class="break-words">{observation().source}</dd>
                              </div>
                            </Show>
                            <Show when={observation().observedAt !== undefined}>
                              <div class="flex flex-wrap gap-x-2">
                                <dt>{language.t("model.group.quota.observed")}</dt>
                                <dd>{new Date(observation().observedAt!).toLocaleString(language.intl())}</dd>
                              </div>
                            </Show>
                            <Show when={observation().validFrom !== undefined}>
                              <div class="flex flex-wrap gap-x-2">
                                <dt>{language.t("model.group.quote.validFrom")}</dt>
                                <dd>{new Date(observation().validFrom!).toLocaleString(language.intl())}</dd>
                              </div>
                            </Show>
                            <Show when={observation().validUntil !== undefined}>
                              <div class="flex flex-wrap gap-x-2">
                                <dt>{language.t("model.group.quote.validUntil")}</dt>
                                <dd>{new Date(observation().validUntil!).toLocaleString(language.intl())}</dd>
                              </div>
                            </Show>
                            <For each={observation().prices}>
                              {(price) => (
                                <div class="flex min-w-0 flex-col gap-1 border-l border-border-weak-base pl-3">
                                  <dt>
                                    {price.tier
                                      ? language.t("model.group.quote.context", {
                                          size: price.tier.size.toLocaleString(language.intl()),
                                        })
                                      : language.t("model.group.quote.base")}
                                  </dt>
                                  <dd>
                                    {language.t("model.group.quote.input", {
                                      price: price.input.toLocaleString(language.intl(), {
                                        style: "currency",
                                        currency: "USD",
                                        maximumFractionDigits: 6,
                                      }),
                                    })}
                                  </dd>
                                  <dd>
                                    {language.t("model.group.quote.output", {
                                      price: price.output.toLocaleString(language.intl(), {
                                        style: "currency",
                                        currency: "USD",
                                        maximumFractionDigits: 6,
                                      }),
                                    })}
                                  </dd>
                                  <dd>
                                    {language.t("model.group.quote.cacheRead", {
                                      price: price.cache.read.toLocaleString(language.intl(), {
                                        style: "currency",
                                        currency: "USD",
                                        maximumFractionDigits: 6,
                                      }),
                                    })}
                                  </dd>
                                  <dd>
                                    {language.t("model.group.quote.cacheWrite", {
                                      price: price.cache.write.toLocaleString(language.intl(), {
                                        style: "currency",
                                        currency: "USD",
                                        maximumFractionDigits: 6,
                                      }),
                                    })}
                                  </dd>
                                </div>
                              )}
                            </For>
                          </>
                        )}
                      </Show>
                    </dl>
                  </Show>
                  <fieldset class="flex w-full min-w-0 flex-col gap-2">
                    <legend class="mb-2 text-13-medium">
                      {language.t("model.group.member.connections", { model: memberLabel(member) })}
                    </legend>
                    <Checkbox
                      checked={member.connections === undefined}
                      disabled={locked()}
                      onChange={(active) => {
                        setState("members", index(), "connections", active ? undefined : [])
                        setState({ saved: false, result: undefined, error: "" })
                      }}
                    >
                      {language.t("model.group.connection.active")}
                    </Checkbox>
                    <Show when={member.connections !== undefined}>
                      <Show when={!integrations.ready()}>
                        <p class="text-13-regular text-text-weak">{language.t("common.loading")}</p>
                      </Show>
                      <For each={choices()}>
                        {(key) => {
                          const configured = () =>
                            member.connections?.find((connection) => connectionKey(connection.ref) === key)

                          const known = () =>
                            connections(member).find((connection) => connectionKey(connection) === key)

                          const label = () => {
                            const connection = known() ?? configured()?.ref

                            return connection ? connectionLabel(connection) : key
                          }

                          return (
                            <div class="flex min-w-0 flex-wrap items-center gap-3">
                              <Checkbox
                                checked={configured() !== undefined}
                                disabled={locked()}
                                onChange={(checked) => {
                                  if (!checked) {
                                    setState("members", index(), "connections", (selected) =>
                                      selected?.filter((connection) => connectionKey(connection.ref) !== key),
                                    )
                                    setState({ saved: false, result: undefined, error: "" })

                                    return
                                  }

                                  const connection = known()

                                  if (!connection) return

                                  const ref: ModelSourceConnectionRef =
                                    connection.type === "credential"
                                      ? { type: "credential", id: connection.id }
                                      : { type: "env", name: connection.name }

                                  setState("members", index(), "connections", (selected) => [
                                    ...(selected ?? []),
                                    { ref },
                                  ])
                                  setState({ saved: false, result: undefined, error: "" })
                                }}
                              >
                                {label()}
                              </Checkbox>
                              <Show when={integrations.ready() && !known()}>
                                <span class="text-13-regular text-text-weak">
                                  {language.t("model.group.connection.missing")}
                                </span>
                              </Show>
                              <Show when={known()?.status}>
                                <span class="text-13-regular text-text-weak">
                                  {language.t("model.group.connection.needsAuth")}
                                </span>
                              </Show>
                              <Show when={configured()}>
                                <Field class="!w-auto min-w-0 flex-1">
                                  <Field.Label>
                                    {language.t("model.group.connection.weight", {
                                      connection: label(),
                                      model: memberLabel(member),
                                    })}
                                  </Field.Label>
                                  <TextInput
                                    appearance="large"
                                    type="number"
                                    step="any"
                                    min="0"
                                    numeric
                                    class="w-24"
                                    value={configured()?.weight ?? ""}
                                    placeholder={language.t("model.group.weight.default")}
                                    disabled={locked()}
                                    onInput={(event) => {
                                      const weight = readWeight(
                                        event.currentTarget,
                                        language.t("model.group.weight.invalid"),
                                      )

                                      setState(
                                        "members",
                                        index(),
                                        "connections",
                                        (connection) => connectionKey(connection.ref) === key,
                                        "weight",
                                        weight,
                                      )
                                      setState({ saved: false, result: undefined, error: "" })
                                    }}
                                  />
                                </Field>
                              </Show>
                              <Show when={known()?.status?.message}>
                                <p class="w-full break-words text-13-regular text-text-weak">
                                  {known()?.status?.message}
                                </p>
                              </Show>
                            </div>
                          )
                        }}
                      </For>
                      <Show when={member.connections?.length === 0}>
                        <p class="text-13-regular text-text-weak">{language.t("model.group.connection.empty")}</p>
                      </Show>
                    </Show>
                    <Show when={usesQuota()}>
                      <For
                        each={
                          member.connections === undefined
                            ? ["active"]
                            : member.connections.map((connection) => connectionKey(connection.ref))
                        }
                      >
                        {(key) => {
                          const ref = () =>
                            member.connections?.find((connection) => connectionKey(connection.ref) === key)?.ref

                          const label = () => {
                            if (key === "active") return language.t("model.group.connection.current")

                            const connection =
                              connections(member).find((connection) => connectionKey(connection) === key) ?? ref()

                            return connection ? connectionLabel(connection) : key
                          }

                          const quota = () => {
                            const observation = model()?.metadata?.quota
                            const connection = ref()

                            if (
                              connection &&
                              (!observation?.connection ||
                                connectionKey(observation.connection) !== connectionKey(connection))
                            )
                              return

                            return observation
                          }

                          const status = () => {
                            const observation = quota()

                            if (!observation) return "unknown"

                            if (observation.status !== "known") return observation.status

                            if (observation.freshUntil !== undefined && observation.freshUntil <= Date.now())
                              return "stale"

                            return "known"
                          }

                          return (
                            <dl
                              class="flex min-w-0 flex-col gap-1 text-13-regular text-text-weak"
                              aria-label={language.t("model.group.quota.title", {
                                model: memberLabel(member),
                                connection: label(),
                              })}
                            >
                              <div class="flex flex-wrap gap-x-2">
                                <dt>{language.t("model.group.quota.connection", { connection: label() })}</dt>
                                <dd>{language.t(`model.group.quota.status.${status()}`)}</dd>
                              </div>
                              <Show when={!quota()}>
                                <dd>
                                  {language.t(
                                    key === "active"
                                      ? "model.group.quota.unobserved"
                                      : "model.group.quota.connection.unobserved",
                                  )}
                                </dd>
                              </Show>
                              <Show when={quota()}>
                                {(observation) => (
                                  <>
                                    <div class="flex flex-wrap gap-x-2">
                                      <dt>{language.t("model.group.quota.source")}</dt>
                                      <dd class="break-words">{observation().source}</dd>
                                    </div>
                                    <Show when={observation().reason}>
                                      {(reason) => <dd>{language.t(`model.group.quota.reason.${reason()}`)}</dd>}
                                    </Show>
                                    <Show when={observation().observedAt !== undefined}>
                                      <div class="flex flex-wrap gap-x-2">
                                        <dt>{language.t("model.group.quota.observed")}</dt>
                                        <dd>{new Date(observation().observedAt!).toLocaleString(language.intl())}</dd>
                                      </div>
                                    </Show>
                                    <div class="flex flex-wrap gap-x-2">
                                      <dt>{language.t("model.group.quota.freshness")}</dt>
                                      <dd>
                                        {observation().freshUntil === undefined
                                          ? language.t("model.group.quota.freshness.unknown")
                                          : new Date(observation().freshUntil!).toLocaleString(language.intl())}
                                      </dd>
                                    </div>
                                    <Show when={observation().plan}>
                                      <div class="flex flex-wrap gap-x-2">
                                        <dt>{language.t("model.group.quota.plan")}</dt>
                                        <dd>{observation().plan}</dd>
                                      </div>
                                    </Show>
                                    <Show when={observation().allowed !== undefined}>
                                      <div class="flex flex-wrap gap-x-2">
                                        <dt>{language.t("model.group.quota.allowed")}</dt>
                                        <dd>
                                          {language.t(
                                            observation().allowed ? "model.group.quota.yes" : "model.group.quota.no",
                                          )}
                                        </dd>
                                      </div>
                                    </Show>
                                    <Show when={observation().freeModel !== undefined}>
                                      <div class="flex flex-wrap gap-x-2">
                                        <dt>{language.t("model.group.quota.freeModel")}</dt>
                                        <dd>
                                          {language.t(
                                            observation().freeModel ? "model.group.quota.yes" : "model.group.quota.no",
                                          )}
                                        </dd>
                                      </div>
                                    </Show>
                                    <Show when={observation().freePlan !== undefined}>
                                      <div class="flex flex-wrap gap-x-2">
                                        <dt>{language.t("model.group.quota.freePlan")}</dt>
                                        <dd>
                                          {language.t(
                                            observation().freePlan ? "model.group.quota.yes" : "model.group.quota.no",
                                          )}
                                        </dd>
                                      </div>
                                    </Show>
                                    <Show
                                      when={
                                        state.strategy === "free" &&
                                        observation().freeModel === undefined &&
                                        observation().freePlan === undefined
                                      }
                                    >
                                      <dd>{language.t("model.group.quota.free.unknown")}</dd>
                                    </Show>
                                    <Show when={observation().credits}>
                                      {(credits) => (
                                        <>
                                          <Show when={credits().balance !== undefined}>
                                            <div class="flex flex-wrap gap-x-2">
                                              <dt>{language.t("model.group.quota.credits")}</dt>
                                              <dd>{credits().balance!.toLocaleString(language.intl())}</dd>
                                            </div>
                                          </Show>
                                          <Show when={credits().unlimited}>
                                            <dd>{language.t("model.group.quota.credits.unlimited")}</dd>
                                          </Show>
                                          <Show when={credits().expiresAt !== undefined}>
                                            <div class="flex flex-wrap gap-x-2">
                                              <dt>{language.t("model.group.quota.expires")}</dt>
                                              <dd>{new Date(credits().expiresAt!).toLocaleString(language.intl())}</dd>
                                            </div>
                                          </Show>
                                        </>
                                      )}
                                    </Show>
                                    <For each={observation().windows}>
                                      {(window) => (
                                        <div class="flex min-w-0 flex-col gap-1 border-l border-border-weak-base pl-3">
                                          <dt class="break-words">
                                            {window.id} · {language.t(`model.group.quota.scope.${window.scope}`)} ·{" "}
                                            {window.unit}
                                          </dt>
                                          <Show when={window.modelIDs?.length}>
                                            <dd class="break-words">{window.modelIDs?.join(", ")}</dd>
                                          </Show>
                                          <Show when={window.usedRatio !== undefined}>
                                            <dd>
                                              {language.t("model.group.quota.used", {
                                                amount: (window.usedRatio! * 100).toLocaleString(language.intl(), {
                                                  maximumFractionDigits: 1,
                                                }),
                                              })}
                                            </dd>
                                          </Show>
                                          <Show when={window.remaining !== undefined}>
                                            <dd>
                                              {language.t("model.group.quota.remaining", {
                                                amount: window.remaining!.toLocaleString(language.intl()),
                                                unit: window.unit,
                                              })}
                                            </dd>
                                          </Show>
                                          <Show when={window.total !== undefined}>
                                            <dd>
                                              {language.t("model.group.quota.total", {
                                                amount: window.total!.toLocaleString(language.intl()),
                                                unit: window.unit,
                                              })}
                                            </dd>
                                          </Show>
                                          <Show when={window.unlimited}>
                                            <dd>{language.t("model.group.quota.unlimited")}</dd>
                                          </Show>
                                          <Show when={window.resetAt !== undefined}>
                                            <dd>
                                              {language.t("model.group.quota.reset", {
                                                time: new Date(window.resetAt!).toLocaleString(language.intl()),
                                              })}
                                            </dd>
                                          </Show>
                                          <Show when={window.spanMs !== undefined}>
                                            <dd>
                                              {language.t("model.group.quota.duration", {
                                                hours: (window.spanMs! / 3_600_000).toLocaleString(language.intl()),
                                              })}
                                            </dd>
                                          </Show>
                                        </div>
                                      )}
                                    </For>
                                    <Show when={observation().status === "known" && observation().windows.length === 0}>
                                      <dd>{language.t("model.group.quota.windows.empty")}</dd>
                                    </Show>
                                  </>
                                )}
                              </Show>
                            </dl>
                          )
                        }}
                      </For>
                    </Show>
                  </fieldset>
                </li>
              )
            }}
          </For>
        </ol>
        {/* Keep request options out of choice data, and encode keys for Kobalte's CSS selectors. */}
        <Select
          modal
          aria-label={language.t("model.group.member.add")}
          placeholder={language.t("model.group.member.add")}
          options={models.list().map((model) => ({
            id: model.id,
            providerID: model.provider.id,
            label: `${model.name} (${model.provider.name})`,
          }))}
          value={(model) => encodeURIComponent(JSON.stringify([model.providerID, model.id]))}
          label={(model) => model.label}
          disabled={locked()}
          onSelect={(model) => {
            if (!model) return

            setState("members", state.members.length, { id: model.id, providerID: model.providerID })
            setState({ saved: false, result: undefined, error: "" })
          }}
        />
      </section>
      <Show when={state.result}>
        <p role="status" class="text-13-regular">
          {state.saved
            ? language.t(state.removed ? "model.group.removed" : "model.group.saved")
            : (state.result?.message ?? language.t(`provider.custom.status.${state.result?.status}`))}
        </p>
      </Show>
      <Show when={state.error}>
        <p role="alert" class="text-13-regular">
          {state.error}
        </p>
      </Show>
      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-border-weak-base pt-4">
        <Show when={source()?.target?.writable && !state.removed}>
          <Button type="button" size="small" variant="ghost" disabled={locked()} onClick={() => void submit(true)}>
            {language.t("model.group.remove")}
          </Button>
        </Show>
        <Button type="button" size="small" variant="ghost" disabled={locked()} onClick={() => void reload()}>
          {language.t("model.group.reload")}
        </Button>
        <Button type="button" size="small" variant="ghost" disabled={state.saving} onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
        <Button
          type="submit"
          size="small"
          variant="submit"
          disabled={locked() || !target()?.writable || !state.groupID || state.saved}
        >
          {language.t("common.save")}
        </Button>
      </div>
    </form>
  )
}

function connectionKey(connection: ModelSourceConnectionRef) {
  return connection.type === "credential" ? `credential:${connection.id}` : `env:${connection.name}`
}

function connectionLabel(connection: ConnectionInfo | ModelSourceConnectionRef) {
  if (connection.type === "credential") return "label" in connection ? connection.label : connection.id

  return connection.name
}

function readWeight(input: HTMLInputElement, message: string) {
  const weight = input.value === "" ? undefined : input.valueAsNumber

  input.setCustomValidity(weight === undefined || (Number.isFinite(weight) && weight > 0) ? "" : message)

  return weight
}
