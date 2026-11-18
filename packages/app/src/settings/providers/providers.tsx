import { Button } from "@aigcfroge/ui/button"
import { Badge } from "@aigcfroge/ui/badge"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { Icon } from "@aigcfroge/ui/icon"
import { Menu } from "@aigcfroge/ui/menu"
import { Select } from "@aigcfroge/ui/select"
import { Switch } from "@aigcfroge/ui/switch"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@aigcfroge/ui/dialog"
import type { ModelSourceConnectionRef, ProviderDefinitionInfo } from "@aigcfroge/client/promise"
import { AigcForgeLogo } from "@/providers/aigcfroge-logo"
import { showToast } from "@/shell/notifications/toast"
import { popularProviders, useProviders } from "@/providers/catalog/providers"
import { consoleProviderGroup } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { createEffect, createMemo, type Component, For, onCleanup, Show, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { CONSOLE_INTEGRATION, CONSOLE_PROVIDERS } from "@/providers/connect/controller"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { CustomProviderForm } from "@/providers/credentials/dialog"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { SettingsList } from "@/settings/list"
import { activeProviderAccount, providerAccounts, type ProviderAccount } from "./accounts"
import "@/settings/settings.css"

type ProviderSource = "env" | "api" | "account" | "config" | "custom"

type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

type ProviderSettingsState = {
  disconnecting: Record<string, "removing" | "removed" | "absent" | undefined>
  consoleExpanded: boolean
  connecting: boolean
  credentialID?: string
  definitionLoading: boolean
  definitionError?: string
  definitionAction?: string
  discoveryExpanded?: string
  discoveryConnection?: ModelSourceConnectionRef
  discoveryBusy: boolean
  discoveryError?: string
}

type DiscoveryRequestState = {
  generation: number
  controller: AbortController | undefined
}

const PROVIDER_NOTES = [
  { match: (id: string) => id === "aigcfroge", key: "dialog.provider.aigcfroge.note" },
  { match: (id: string) => id === "aigcfroge-go", key: "dialog.provider.aigcfrogeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component<{
  directory: string | undefined
  onSelectProvider?: (providerID: string) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const providers = useProviders(() => props.directory)
  const integrations = useIntegrations(() => props.directory)
  const providerConnect = useProviderConnectController()
  const definition = data.location.provider.definition
  const discovery = data.location.provider.discovery
  const location = () => props.directory ? { directory: props.directory } : undefined
  const lifetime = { active: true, generation: 0 }

  const discoveryRequest: DiscoveryRequestState = {
    generation: 0, controller: undefined,
  }

  const [state, setState] = createStore<ProviderSettingsState>({
    disconnecting: {},
    consoleExpanded: false,
    connecting: false,
    credentialID: undefined,
    definitionLoading: false,
    definitionError: undefined,
    definitionAction: undefined,
    discoveryBusy: false,
  })

  onCleanup(() => { lifetime.active = false; cancelDiscovery() })
  createEffect(() => {
    const client = serverSdk.api
    const ref = location()

    if (serverSdk.connection.status() !== "connected") return
    untrack(() => void loadDefinitions(client, ref))
  })

  async function loadDefinitions(client = serverSdk.api, ref = location()) {
    const generation = ++lifetime.generation
    setState({ definitionLoading: true, definitionError: undefined })

    try {
      await definition.sync(ref)
    } catch (error) {
      if (!lifetime.active || client !== serverSdk.api || generation !== lifetime.generation) return
      setState("definitionError", error instanceof Error ? error.message : String(error))
    } finally {
      if (lifetime.active && client === serverSdk.api && generation === lifetime.generation)
        setState("definitionLoading", false)
    }
  }

  const savedDefinitions = () => definition.list(location())?.definitions ?? []
  const definitionKey = (item: ProviderDefinitionInfo) => item.providerID + "\n" + (item.target?.path ?? item.source.path ?? item.source.scope)

  createEffect(() => {
    const client = serverSdk.api
    const ref = location()
    const status = serverSdk.connection.status()
    const key = state.discoveryExpanded
    const connection = state.discoveryConnection
    untrack(() => {
      cancelDiscovery()

      if (status !== "connected" || !key) return
      const item = savedDefinitions().find((item) => definitionKey(item) === key)

      if (!item) return
      const generation = discoveryRequest.generation
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: Promise rejection values are opaque; the handler guards Error before producing display text.
      void discovery.sync(item.providerID, connection, ref).catch((error: unknown) => {
        if (!lifetime.active || client !== serverSdk.api || generation !== discoveryRequest.generation) return
        setState("discoveryError", error instanceof Error ? error.message : String(error))
      })
    })
  })

  const definitionStatus = (item: ProviderDefinitionInfo) => {
    const adoption = item.definition.adoption

    if (adoption && adoption.phase !== "ready")
      return language.t(adoption.phase === "draft" ? "settings.providers.definitions.draft" : "settings.providers.definitions.applying")

    return language.t(item.definition.disabled ? "settings.providers.definitions.disabled" : "settings.providers.definitions.enabled")
  }

  const editDefinition = (item?: ProviderDefinitionInfo) => {
    void dialog.show(() => (
      <Dialog size="large" preventBackdropDismiss>
        <DialogHeader><DialogTitle>{language.t("provider.custom.title")}</DialogTitle></DialogHeader>
        <DialogBody>
          <CustomProviderForm directory={props.directory} defaultLocation={props.directory === undefined}
            providerID={item?.providerID} targetPath={item?.target?.path}
            onSaved={() => { definition.invalidate(location()); void loadDefinitions() }} />
        </DialogBody>
      </Dialog>
    ), () => { definition.invalidate(location()); void loadDefinitions() })
  }

  async function changeDefinition(item: ProviderDefinitionInfo, action: "toggle" | "remove" | "source" | "sync", value?: boolean) {
    const target = item.target

    if (!target?.writable || state.definitionAction) return
    const client = serverSdk.api
    const ref = location()
    const generation = lifetime.generation
    setState({ definitionAction: definitionKey(item), definitionError: undefined })

    try {
      if (action === "remove") {
        const response = await client.provider.definition.remove({ providerID: item.providerID,
          target: { scope: target.scope, path: target.path }, expectedDigest: target.digest, location: ref })

        if (!lifetime.active || client !== serverSdk.api || generation !== lifetime.generation) return

        if (response.data.definition.status === "conflict" || response.data.definition.status === "failed")
          throw new Error(response.data.definition.message ?? language.t("provider.custom.status.failed"))
        showToast({ variant: "success", icon: "circle-check",
          title: language.t("settings.providers.definitions.removed"),
          description: response.data.inherited.length ? language.t("settings.providers.definitions.inherited", {
            sources: response.data.inherited.map((source) => source.path ?? source.scope).join(", "),
          }) : undefined })
      }

      if (action !== "remove") {
        const response = await client.provider.definition.save({ providerID: item.providerID,
          target: { scope: target.scope, path: target.path }, expectedDigest: target.digest,
          submissionID: crypto.randomUUID(), patch: { set: action === "toggle" ? { disabled: !item.definition.disabled }
            : { discovery: action === "source" ? { enabled: value } : { autoSync: value } } },
          credential: { type: "keep" }, location: ref })

        if (!lifetime.active || client !== serverSdk.api || generation !== lifetime.generation) return

        if (response.data.definition.status === "conflict" || response.data.definition.status === "failed")
          throw new Error(response.data.definition.message ?? language.t("provider.custom.status.failed"))
      }

      definition.invalidate(ref)
      data.location.provider.invalidate(ref)
      data.location.model.invalidate(ref)
      discovery.invalidate(item.providerID, undefined, ref)
      await Promise.all([definition.sync(ref), data.location.provider.sync(ref), data.location.model.sync(ref),
        discovery.sync(item.providerID, state.discoveryConnection, ref)])
    } catch (error) {
      if (lifetime.active && client === serverSdk.api && generation === lifetime.generation)
        setState("definitionError", error instanceof Error ? error.message : String(error))
    } finally {
      if (lifetime.active && client === serverSdk.api && generation === lifetime.generation)
        setState("definitionAction", undefined)
    }
  }

  function cancelDiscovery() {
    discoveryRequest.generation++
    discoveryRequest.controller?.abort()
    discoveryRequest.controller = undefined
    setState({ discoveryBusy: false, discoveryError: undefined })
  }

  function expandDiscovery(item: ProviderDefinitionInfo) {
    const key = definitionKey(item)
    setState({ discoveryExpanded: state.discoveryExpanded === key ? undefined : key, discoveryConnection: undefined })
  }

  async function refreshDiscovery(item: ProviderDefinitionInfo) {
    if (state.discoveryBusy || state.definitionAction) return
    cancelDiscovery()
    const client = serverSdk.api
    const ref = location()
    const connection = state.discoveryConnection
    const generation = discoveryRequest.generation
    const controller = new AbortController()
    discoveryRequest.controller = controller
    const fresh = () => lifetime.active && client === serverSdk.api && generation === discoveryRequest.generation && !controller.signal.aborted
    setState("discoveryBusy", true)

    try {
      await client.provider.discovery.refresh({ providerID: item.providerID, connection, force: true, location: ref },
        { signal: controller.signal })

      if (!fresh()) return
      discovery.invalidate(item.providerID, connection, ref)
      await discovery.sync(item.providerID, connection, ref)
    } catch (error) {
      if (fresh()) setState("discoveryError", error instanceof Error ? error.message : String(error))
    } finally {
      if (fresh()) { setState("discoveryBusy", false); discoveryRequest.controller = undefined }
    }
  }

  function DiscoveryControls(control: { item: ProviderDefinitionInfo }) {
    const list = () => discovery.get(control.item.providerID, state.discoveryConnection, location())

    const options = () => [{ key: "active", label: language.t("provider.discovery.activeConnection"), connection: undefined },
      ...control.item.connections.flatMap<{ key: string; label: string; connection: ModelSourceConnectionRef }>((connection) => {
        if (connection.type === "credential") return [{ key: "credential:" + connection.id, label: connection.label,
          connection: { type: "credential", id: connection.id } }]

        if (connection.type === "env") return [{ key: "env:" + connection.name, label: connection.name,
          connection: { type: "env", name: connection.name } }]

        return []
      })]

    const key = () => {
      if (state.discoveryConnection?.type === "credential") return "credential:" + state.discoveryConnection.id

      if (state.discoveryConnection?.type === "env") return "env:" + state.discoveryConnection.name

      return "active"
    }

    return <section class="flex basis-full min-w-0 flex-col gap-3 border-t border-border-weak pt-3"
      aria-label={language.t("provider.discovery.title")}>
      <Select options={options()} current={options().find((item) => item.key === key())} value={(item) => item.key}
        label={(item) => item.label} disabled={state.discoveryBusy} aria-label={language.t("provider.discovery.connection")}
        onSelect={(option) => {
          if (!option) return
          setState("discoveryConnection", option.connection)
        }} />
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch checked={control.item.definition.discovery?.enabled ?? true}
          onChange={(value) => void changeDefinition(control.item, "source", value)}
          disabled={!control.item.target?.writable || state.definitionAction !== undefined || state.discoveryBusy}>
          {language.t("provider.discovery.source")}
        </Switch>
        <Switch checked={control.item.definition.discovery?.autoSync ?? false}
          onChange={(value) => void changeDefinition(control.item, "sync", value)}
          disabled={!control.item.target?.writable || state.definitionAction !== undefined || state.discoveryBusy}>
          {language.t("provider.discovery.autoSync")}
        </Switch>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="small" variant="neutral" onClick={() => void refreshDiscovery(control.item)}
          disabled={state.discoveryBusy || state.definitionAction !== undefined || control.item.definition.discovery?.enabled === false}>
          {language.t("provider.discovery.refresh")}
        </Button>
        <Show when={state.discoveryBusy}>
          <Button size="small" variant="ghost" onClick={cancelDiscovery}>{language.t("provider.discovery.cancel")}</Button>
        </Show>
        <Button size="small" variant="ghost" onClick={() => editDefinition(control.item)}
          disabled={!control.item.target?.writable || state.definitionAction !== undefined}>
          {language.t("provider.discovery.manage", { provider: control.item.definition.name ?? control.item.providerID })}
        </Button>
      </div>
      <p role="status" class="text-12-regular text-text-weak">{language.t("provider.discovery.phase." +
        (state.discoveryBusy ? "fetching" : list()?.status.phase ?? "idle"))}</p>
      <Show when={state.discoveryError}><p role="alert" class="text-13-regular text-text-base">{state.discoveryError}</p></Show>
      <Show when={list()}>
        {(read) => <>
          <Show when={read().status.error}>{(error) => <p role="alert" class="text-13-regular text-text-base">{error().message}</p>}</Show>
          <Show when={read().status.identity}>
            {(identity) => <p class="text-12-regular text-text-weak break-all">{identity().listURL}</p>}
          </Show>
          <Show when={read().status.lastSuccessAt}>
            {(time) => <p class="text-12-regular text-text-weak">{language.t("provider.discovery.lastSuccess", {
              time: new Date(time()).toLocaleString(language.intl()),
            })}</p>}
          </Show>
          <Show when={read().inventory && (read().status.phase === "failed" || read().status.phase === "partial")}>
            <p class="text-12-regular text-text-weak">{language.t("provider.discovery.previousSuccess", {
              time: new Date(read().inventory!.observedAt).toLocaleString(language.intl()),
            })}</p>
          </Show>
          <Show when={read().inventory && !read().status.cachePersisted}>
            <p class="text-12-regular text-text-weak">{language.t("provider.discovery.cacheNotSaved")}</p>
          </Show>
          <For each={read().managed}>
            {(model) => <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-12-regular">
              <div class="min-w-0 flex-1">
                <p class="text-text-base break-all">{model.metadata.name ?? model.ref.id}</p>
                <p class="text-text-weak break-all">{model.ref.id} · {model.modelID}</p>
                <Show when={model.origins.name}><p class="text-text-weak">{language.t("provider.model.origin." + model.origins.name)}</p></Show>
              </div>
              <span class="text-text-weak">{language.t("provider.discovery.membership." + model.membership)}</span>
            </div>}
          </For>
        </>}
      </Show>
    </section>
  }

  const updateDisconnecting = (ids: string[], status: "removing" | "removed" | "absent" | undefined) =>
    setState("disconnecting", (current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [id, status])),
    }))

  // Console-managed providers (`aigcfroge-go`, `console-*`) connect through the `aigcfroge`
  // integration, so the lookup must follow `integrationID` rather than the provider id.
  const integration = (item: ProviderItem) => {
    const id = item.integrationID ?? item.id

    return integrations.list().find((entry) => entry.id === id)
  }

  const connect = (provider?: string) => {
    setState("connecting", true)
    providerConnect.select(provider)
    void dialog.show(
      () => (
        <DialogConnectProvider
          directory={props.directory}
          defaultLocation={props.directory === undefined}
          controller={providerConnect}
          onConnected={(providerID) => {
            if (CONSOLE_PROVIDERS.has(providerID)) {
              setState("disconnecting", reconcile({}))

              return
            }

            setState("disconnecting", providerID, undefined)
          }}
        />
      ),
      () => {
        setState("connecting", false)
        const location = props.directory ? { directory: props.directory } : undefined
        data.location.integration.invalidate(location)
        data.location.provider.invalidate(location)
        data.location.model.invalidate(location)
        void Promise.all([
          data.location.integration.sync(location),
          data.location.provider.sync(location),
          data.location.model.sync(location),
        ]).catch(() => undefined)
      },
    )
  }

  const available = createMemo(() => {
    const connected = providers.connected()
    const managedConsole = consoleProviderGroup(connected)

    const consoleConnected = integrations
      .list()
      .find((item) => item.id === CONSOLE_INTEGRATION)
      ?.connections.some((connection) => connection.type === "credential" || connection.type === "env")

    // Hides the free `aigcfroge` row while a new Console grant is still loading its workspace providers.
    const consoleTransition =
      state.connecting &&
      CONSOLE_PROVIDERS.has(providerConnect.selected() ?? "") &&
      consoleConnected &&
      managedConsole === undefined

    return connected
      .filter(
        (provider) =>
          provider.id !== "aigcfroge" ||
          (!consoleTransition &&
            (managedConsole !== undefined ||
              consoleConnected ||
              Object.values(provider.models).some((model) => model.cost.input > 0))),
      )
      .toSorted((a, b) => Number(b.id === "aigcfroge-go") - Number(a.id === "aigcfroge-go"))
  })

  createEffect(() => {
    const ids = new Set(available().map((item) => item.id))
    Object.entries(state.disconnecting).forEach(([id, status]) => {
      if ((status === "removing" || status === "removed") && !ids.has(id)) {
        setState("disconnecting", id, "absent")

        return
      }

      if (status === "absent" && ids.has(id)) setState("disconnecting", id, undefined)
    })
  })

  const connected = createMemo(() => available().filter((item) => !state.disconnecting[item.id]))

  const consoleGroup = createMemo(() => consoleProviderGroup(available()))

  const displayed = createMemo(() => {
    const group = consoleGroup()

    if (!group) return connected()
    const grouped = new Set(group.providers.filter((item) => item.id !== group.root.id).map((item) => item.id))

    return connected().filter((item) => !grouped.has(item.id))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    // The Console account (integration `aigcfroge`) shares its id with the Zen provider. A stored API
    // key, including one imported from a v1 auth.json, makes Zen "connected" without any account, so
    // the Popular list keeps the sign-in row until the active credential is an OAuth grant. Until the
    // integration list arrives the row is still the models.dev Zen provider, so dedupe it as before.
    const account = integrations.list().find((entry) => entry.id === CONSOLE_INTEGRATION)

    const items = providers
      .popular()
      .filter((p) => {
        if (p.id !== CONSOLE_INTEGRATION || !account) return !connectedIDs.has(p.id)

        return account.connections.find((connection) => connection.type === "credential")?.method !== "oauth"
      })
      .slice()

    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))

    return items
  })

  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or OAuth grant, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item)
    const credential = current?.connections.find((connection) => connection.type === "credential")

    if (credential) return credential.method === "oauth" ? "account" : "api"

    if (current?.connections.some((connection) => connection.type === "env")) return "env"

    if (current) return "config"

    if (!("source" in item)) return
    const value = item.source

    if (value === "env" || value === "api" || value === "config" || value === "custom") return value

    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)

    if (current === "env") return language.t("settings.providers.tag.environment")

    if (current === "api") return language.t("provider.connect.method.apiKey")

    if (current === "account") return language.t("settings.providers.tag.account")

    if (current === "config") return language.t("settings.providers.tag.config")

    if (current === "custom") return language.t("settings.providers.tag.custom")

    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => {
    const current = integration(item)

    if (current) return current.connections.some((connection) => connection.type === "credential")
    const currentSource = source(item)

    return currentSource !== "env" && currentSource !== "config"
  }

  const canManageAccounts = (item: ProviderItem) => providerAccounts(integration(item)).length > 0

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (item: ProviderItem, name: string) => {
    if (state.disconnecting[item.id]) return
    const group = consoleGroup()
    const ids = group?.root.id === item.id ? group.providers.map((provider) => provider.id) : [item.id]
    updateDisconnecting(ids, "removing")
    const location = props.directory ? { directory: props.directory } : undefined
    await serverSdk.api.integration
      .get({ integrationID: item.integrationID ?? item.id, location })
      .then(async (integration) => {
        const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []

        if (credentials.length === 0) {
          showToast({
            title: language.t("common.requestFailed"),
            description: language.t("provider.disconnect.toast.noCredentials.description", { provider: name }),
          })

          return
        }

        await Promise.all(
          credentials.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })),
        )
        updateDisconnecting(ids, "removed")
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((cause: unknown) => {
        updateDisconnecting(ids, undefined)
        const message = cause instanceof Error ? cause.message : String(cause)
        showToast({
          title: language.t("common.requestFailed"),
          description: language.tDynamic("provider.disconnect.toast.failed.description", message, { provider: name }),
        })
      })
  }

  const refreshAccounts = async () => {
    const location = props.directory ? { directory: props.directory } : undefined
    data.location.integration.invalidate(location)
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)
    await Promise.all([
      data.location.integration.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
    ])
  }

  const accountError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const activate = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    if (activeProviderAccount(integration(provider))?.id === account.id) return
    setState("credentialID", account.id)
    await serverSdk.api.credential
      .activate({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: providerName }),
          description: language.t("settings.providers.account.switched.description", { account: account.label }),
        }),
      )
      .catch(accountError)
      .finally(() => setState("credentialID", undefined))
  }

  const remove = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    const final = providerAccounts(integration(provider)).length === 1
    setState("credentialID", account.id)
    await serverSdk.api.credential
      .remove({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t(
            final ? "provider.disconnect.toast.disconnected.title" : "settings.providers.account.removed.title",
            final ? { provider: providerName } : { account: account.label },
          ),
          description: language.t(
            final
              ? "provider.disconnect.toast.disconnected.description"
              : "settings.providers.account.removed.description",
            { provider: providerName },
          ),
        }),
      )
      .catch(accountError)
      .finally(() => setState("credentialID", undefined))
  }

  function AccountMenu(menuProps: { provider: ProviderItem; name?: string }) {
    const accounts = () => providerAccounts(integration(menuProps.provider))
    const active = () => activeProviderAccount(integration(menuProps.provider))
    const name = () => menuProps.name ?? menuProps.provider.name

    return (
      <Menu placement="bottom-end" gutter={6}>
        <Menu.Trigger
          as={Button}
          size="normal"
          variant="ghost-muted"
          class="settings-provider-account-trigger"
          aria-label={language.t("settings.providers.account.manage", { provider: name() })}
        >
          <span>{active()?.label}</span>
          <Icon name="chevron-down" size="small" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content class="settings-provider-account-menu" onEscapeKeyDown={(event) => event.stopPropagation()}>
            <Menu.Group>
              <Menu.GroupLabel>{language.t("settings.providers.account.group")}</Menu.GroupLabel>
              <Menu.RadioGroup
                class="settings-provider-account-list"
                value={active()?.id}
                onChange={(credentialID) => {
                  const account = accounts().find((item) => item.id === credentialID)

                  if (account) void activate(menuProps.provider, name(), account)
                }}
              >
                <For each={accounts()}>
                  {(account) => (
                    <Menu.RadioItem value={account.id} closeOnSelect disabled={state.credentialID !== undefined}>
                      <span class="settings-provider-account-label">{account.label}</span>
                    </Menu.RadioItem>
                  )}
                </For>
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item disabled={state.credentialID !== undefined} onSelect={() => connect(menuProps.provider.id)}>
              {language.t("settings.providers.account.add")}
            </Menu.Item>
            <Menu.Sub placement="left-start">
              <Menu.SubTrigger disabled={state.credentialID !== undefined || accounts().length === 0}>
                {language.t("settings.providers.account.remove")}
              </Menu.SubTrigger>
              <Menu.SubContent class="settings-provider-account-submenu">
                <For each={accounts()}>
                  {(account) => (
                    <Menu.Item
                      badge={account.id === active()?.id ? language.t("settings.providers.account.active") : undefined}
                      onSelect={() => void remove(menuProps.provider, name(), account)}
                    >
                      <span class="settings-provider-account-label">{account.label}</span>
                    </Menu.Item>
                  )}
                </For>
              </Menu.SubContent>
            </Menu.Sub>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    )
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.providers.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.providers.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned settings-providers">
        <div class="settings-section">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="settings-section-title">{language.t("settings.providers.section.definitions")}</h3>
            <div class="flex flex-wrap gap-2">
              <Button size="small" variant="ghost" onClick={() => { definition.invalidate(location()); void loadDefinitions() }}
                disabled={state.definitionLoading}>{language.t("settings.providers.definitions.refresh")}</Button>
              <Button size="small" variant="neutral" icon="plus" onClick={() => editDefinition()}>
                {language.t("settings.providers.definitions.add")}
              </Button>
            </div>
          </div>
          <Show when={state.definitionError}><p role="alert" class="text-13-regular text-text-base">{state.definitionError}</p></Show>
          <SettingsList variant="catalog">
            <Show when={savedDefinitions().length > 0} fallback={
              <div class="settings-provider-empty">{language.t(state.definitionLoading
                ? "settings.providers.definitions.loading" : "settings.providers.definitions.empty")}</div>
            }>
              <For each={savedDefinitions()}>
                {(item) => (
                  <div class="settings-provider-row">
                    <div class="flex w-full min-w-0 flex-col gap-3">
                      <div class="settings-provider-lead min-w-0">
                        <ProviderModelIcon provider={{ id: item.providerID, name: item.definition.name ?? item.providerID }}
                          class="settings-provider-icon shrink-0" />
                        <div class="settings-provider-copy min-w-0">
                          <div class="settings-provider-main">
                            <span class="settings-provider-name truncate">{item.definition.name ?? item.providerID}</span>
                            <Badge>{definitionStatus(item)}</Badge>
                          </div>
                          <p class="text-12-regular text-text-weak break-all">{item.providerID} · {item.source.path ?? language.t("settings.providers.definitions.virtual")}</p>
                        </div>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <Button size="small" variant="ghost-muted" onClick={() => expandDiscovery(item)}
                          aria-expanded={state.discoveryExpanded === definitionKey(item)}>
                          {language.t("provider.discovery.title")}
                        </Button>
                        <Button size="small" variant="ghost-muted" onClick={() => editDefinition(item)}
                          disabled={!item.target?.writable || state.definitionAction !== undefined}
                          aria-label={language.t("settings.providers.definitions.edit", { provider: item.definition.name ?? item.providerID })}>
                          {language.t("common.edit")}
                        </Button>
                        <Button size="small" variant="ghost-muted" onClick={() => void changeDefinition(item, "toggle")}
                          disabled={!item.target?.writable || state.definitionAction !== undefined ||
                            Boolean(item.definition.adoption && item.definition.adoption.phase !== "ready")}>
                          {language.t(item.definition.disabled ? "settings.providers.definitions.allow" : "settings.providers.definitions.disable")}
                        </Button>
                        <Button size="small" variant="ghost-muted" onClick={() => void changeDefinition(item, "remove")}
                          disabled={!item.target?.writable || state.definitionAction !== undefined}>
                          {language.t("settings.providers.definitions.remove")}
                        </Button>
                      </div>
                      <Show when={state.discoveryExpanded === definitionKey(item)}>
                        <DiscoveryControls item={item} />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>
        <div class="settings-section" data-component="connected-providers-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList variant="catalog">
            <Show
              when={displayed().length > 0}
              fallback={<div class="settings-provider-empty">{language.t("settings.providers.connected.empty")}</div>}
            >
              <For each={displayed()}>
                {(item) => {
                  const managedGroup = () => (consoleGroup()?.root.id === item.id ? consoleGroup() : undefined)

                  return (
                    <Show
                      when={managedGroup()}
                      fallback={
                        <div class="settings-provider-row group">
                          <div class="settings-provider-lead">
                            <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />

                            <div class="settings-provider-main">
                              <span class="settings-provider-name truncate">
                                {item.name}
                              </span>
                              <Badge>{type(item)}</Badge>
                            </div>
                          </div>
                          <Show
                            when={canManageAccounts(item)}
                            fallback={
                              <Show
                                when={canDisconnect(item)}
                                fallback={
                                  <span class="settings-provider-env-hint">
                                    {language.t("settings.providers.connected.environmentDescription")}
                                  </span>
                                }
                              >
                                <Button
                                  size="normal"
                                  variant="ghost-muted"
                                  onClick={() => void disconnect(item, item.name)}
                                >
                                  {language.t("common.disconnect")}
                                </Button>
                              </Show>
                            }
                          >
                            <AccountMenu provider={item} />
                          </Show>
                        </div>
                      }
                    >
                      {(group) => (
                        <div class="settings-provider-console group">
                          <div class="settings-provider-console-header">
                            <div class="settings-provider-lead">
                              <AigcForgeLogo class="settings-provider-icon size-4 shrink-0" />
                              <div class="settings-provider-console-summary">
                                <div class="settings-provider-main">
                                  <span class="settings-provider-name truncate">
                                    {language.t("provider.connect.aigcfroge.name")}
                                  </span>
                                  <Badge>{group().workspace}</Badge>
                                </div>
                                <Show when={group().providers.length > 1}>
                                  <button
                                    type="button"
                                    class="settings-provider-console-toggle"
                                    aria-expanded={state.consoleExpanded}
                                    onClick={() => setState("consoleExpanded", (value) => !value)}
                                  >
                                    <span>
                                      {language.plural(
                                        "settings.providers.console.available",
                                        group().providers.length,
                                        { count: group().providers.length },
                                      )}
                                    </span>
                                    <Icon
                                      name="chevron-right"
                                      size="small"
                                      classList={{
                                        "settings-provider-console-chevron": true,
                                        open: state.consoleExpanded,
                                      }}
                                    />
                                  </button>
                                </Show>
                              </div>
                            </div>
                            <Show
                              when={canManageAccounts(item)}
                              fallback={
                                <Button
                                  size="normal"
                                  variant="ghost-muted"
                                  onClick={() => void disconnect(item, language.t("provider.connect.aigcfroge.name"))}
                                >
                                  {language.t("common.disconnect")}
                                </Button>
                              }
                            >
                              <AccountMenu provider={item} name={language.t("provider.connect.aigcfroge.name")} />
                            </Show>
                          </div>
                          <Show when={state.consoleExpanded}>
                            <div class="settings-provider-console-list">
                              <div class="settings-provider-console-separator" aria-hidden="true" />
                              <For each={group().providers}>
                                {(provider) => (
                                  <button
                                    type="button"
                                    class="settings-provider-console-item"
                                    onClick={() => props.onSelectProvider?.(provider.id)}
                                  >
                                    <span>{provider.name.slice(group().prefix.length)}</span>
                                    <Icon
                                      name="chevron-right"
                                      size="small"
                                      class="settings-provider-console-item-chevron"
                                    />
                                  </button>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>
                  )
                }}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList variant="catalog">
            <For each={popular()}>
              {(item) => (
                <div class="settings-provider-row">
                  <div class="settings-provider-lead">
                    <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />

                    <div class="settings-provider-copy">
                      <div class="settings-provider-main">
                        <span class="settings-provider-name">
                          {item.name}
                        </span>
                        <Show when={item.id === "aigcfroge" || item.id === "aigcfroge-go"}>
                          <Badge>{language.t("dialog.provider.tag.recommended")}</Badge>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                  </div>
                  <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>
          </SettingsList>

          <button type="button" class="settings-providers-view-all" onClick={() => connect()}>
            {language.t("dialog.provider.viewAll")}
          </button>
        </div>
      </div>
    </>
  )
}
