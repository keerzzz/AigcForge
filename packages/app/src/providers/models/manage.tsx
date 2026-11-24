import { Button } from "@omnixa/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle, DialogTitleGroup } from "@omnixa/ui/dialog"
import { Switch } from "@omnixa/ui/switch"
import { TextInput } from "@omnixa/ui/text-input"
import { Tooltip } from "@omnixa/ui/tooltip"
import { useFilteredList } from "@omnixa/ui/hooks"
import { createEffect, For, onCleanup, Show, type Component, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/providers/models/selection"
import { popularProviders } from "@/providers/catalog/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { useDialog } from "@omnixa/ui/context/dialog"
import { DialogConnectProvider } from "@/providers/connect/dialog"
import { CustomProviderForm } from "@/providers/credentials/dialog"
import { ModelTooltip } from "@/providers/models/tooltip"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { decode64 } from "@/runtime/persistence/base64"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { ProviderModelSections } from "@/providers/models/provider-group"
import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useLocal>["model"]["list"]>[number]

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const data = useData()
  const sdk = useServerSDK()
  const [store, setStore] = createStore<{ collapsed: Record<string, boolean>; error?: string }>({ collapsed: {} })
  const directory = () => decode64(local.slug())

  const location = () => {
    const value = directory()

    return value ? { directory: value } : undefined
  }

  const lifetime = { active: true }

  onCleanup(() => {
    lifetime.active = false
  })

  createEffect(() => {
    const api = sdk.api
    const ref = location()

    if (sdk.connection.status() !== "connected") return
    untrack(() => {
      setStore("error", undefined)
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: Promise rejection values are opaque; the handler guards Error before producing display text.
      void data.location.provider.definition.sync(ref).catch((error: unknown) => {
        if (lifetime.active && api === sdk.api && ref?.directory === location()?.directory)
          setStore("error", error instanceof Error ? error.message : String(error))
      })
    })
  })

  const editable = (item: ModelItem) =>
    data.location.provider.definition
      .list(location())
      ?.definitions.find(
        (definition) =>
          definition.providerID === item.provider.id &&
          definition.target?.writable &&
          definition.definition.models?.[item.id],
      )

  const edit = (item: ModelItem) => {
    const definition = editable(item)

    if (!definition) return
    void dialog.show(() => (
      <Dialog size="large" preventBackdropDismiss>
        <DialogHeader>
          <DialogTitle>{language.t("provider.custom.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <CustomProviderForm
            directory={directory()}
            providerID={item.provider.id}
            modelID={item.id}
            targetPath={definition.target?.path}
            autofocus={false}
          />
        </DialogBody>
      </Dialog>
    ))
  }

  const handleConnectProvider = () => {
    void dialog.show(() => <DialogConnectProvider directory={directory()} />)
  }

  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)

  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))

  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  const setModelVisibility = (item: ModelItem, checked: boolean) => {
    local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
  }

  const list = useFilteredList<ModelItem>({
    items: () => local.model.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aRank = popularProviders.indexOf(a.category)
      const bRank = popularProviders.indexOf(b.category)
      const aPopular = aRank >= 0
      const bPopular = bRank >= 0

      if (aPopular && !bPopular) return -1

      if (!aPopular && bPopular) return 1

      if (aPopular && bPopular) return aRank - bRank

      return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
    },
  })

  const searching = () => list.filter().length > 0
  const expanded = (key: string) => searching() || !store.collapsed[key]

  function ModelRows(props: { items: ModelItem[] }) {
    return (
      <SettingsList variant="catalog">
        <For each={props.items}>
          {(item) => (
            <SettingsRow
              title={
                <Tooltip placement="right-start" gutter={12} openDelay={0} value={<ModelTooltip model={item} v2 />}>
                  <span tabIndex={0}>{item.name}</span>
                </Tooltip>
              }
              description={item.api.id}
            >
              <div class="flex items-center gap-3">
                <Show when={editable(item)}>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => edit(item)}
                    aria-label={language.t("provider.model.edit", { model: item.name })}
                  >
                    {language.t("common.edit")}
                  </Button>
                </Show>
                <Switch
                  checked={local.model.visible({ modelID: item.id, providerID: item.provider.id })}
                  onChange={(checked) => setModelVisibility(item, checked)}
                  hideLabel
                >
                  {item.name}
                </Switch>
              </div>
            </SettingsRow>
          )}
        </For>
      </SettingsList>
    )
  }

  return (
    <Dialog size="large" variant="settings" class="settings-manage-models-dialog">
      <DialogHeader hideClose={true} closeLabel={language.t("common.close")}>
        <DialogTitleGroup
          title={language.t("dialog.model.manage")}
          description={language.t("dialog.model.manage.description")}
        />
        <Button variant="neutral" icon="plus" onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <div class="px-4 pt-px pb-3">
          <TextInput
            type="search"
            appearance="base"
            class="!w-full self-stretch"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            autofocus
            aria-label={language.t("dialog.model.search.placeholder")}
            showClearButton={!!list.filter()}
            clearIcon="circle-xmark"
            clearLabel={language.t("common.clear")}
            onClearClick={() => list.clear()}
          />
        </div>
        <div data-slot="manage-models-scroll" class="relative min-h-0 flex-1">
          <div class="settings-panel settings-models h-full px-4 pt-1 pb-4">
            <Show when={store.error}>
              <p role="alert" class="text-13-regular text-text-base">
                {store.error}
              </p>
            </Show>
            <Show
              when={!list.grouped.loading}
              fallback={
                <div class="settings-models-status">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={list.flat().length > 0}
                fallback={
                  <div class="settings-models-status">
                    <span>{language.t("dialog.model.empty")}</span>
                    <Show when={list.filter()}>
                      <span class="settings-models-status-filter">&quot;{list.filter()}&quot;</span>
                    </Show>
                  </div>
                }
              >
                <ProviderModelSections
                  groups={list.grouped.latest}
                  expanded={expanded}
                  disabled={searching()}
                  onExpandedChange={(key, value) => setStore("collapsed", key, !value)}
                  action={(group) => (
                    <Switch
                      class="me-6"
                      checked={providerVisible(group.category)}
                      onChange={(checked) => setProviderVisibility(group.category, checked)}
                      hideLabel
                    >
                      {group.items[0].provider.name}
                    </Switch>
                  )}
                  rows={(items) => <ModelRows items={items} />}
                />
              </Show>
            </Show>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}
