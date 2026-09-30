import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/icon"
import type { CliAgentDiscovery } from "@aigcfroge/sdk/v2/client"
import { type Component, createMemo, createResource, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./cli-agents.css"

export const SettingsCliAgents: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()

  const [discovery, { refetch }] = createResource(
    () => serverSdk(),
    async (sdk) => {
      const response = await sdk.client.v2.agent.cli(undefined, { throwOnError: true })
      return response.data.data ?? []
    },
  )

  const agents = createMemo(() => {
    if (discovery.loading || discovery.error) return undefined
    return discovery.latest
  })

  const errorDetail = createMemo(() => {
    const error = discovery.error
    if (!error) return undefined
    if (error instanceof Error) return error.message
    if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
    return String(error)
  })

  const status = (agent: CliAgentDiscovery) =>
    agent.available
      ? language.t("settings.cliAgents.status.detected")
      : language.t("settings.cliAgents.status.notDetected")

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked settings-v2-cli-agents-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.cliAgents.title")}</h2>
          <ButtonV2
            type="button"
            size="small"
            variant="neutral"
            disabled={discovery.loading}
            onClick={() => void refetch()}
          >
            {language.t("common.refresh")}
          </ButtonV2>
        </div>
        <div class="settings-v2-cli-agents-note">
          <Icon name="console" />
          <div class="settings-v2-cli-agents-note-copy">
            <strong>{language.t("settings.cliAgents.environment.title")}</strong>
            <span>{language.t("settings.cliAgents.environment.description")}</span>
            <span>{language.t("settings.cliAgents.noInstall")}</span>
          </div>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-cli-agents" data-component="settings-cli-agents">
        <Show
          when={!discovery.loading}
          fallback={
            <div class="settings-v2-cli-agents-state" aria-live="polite">
              <span class="settings-v2-cli-agents-state-title">{language.t("settings.cliAgents.loading")}</span>
            </div>
          }
        >
          <Show
            when={!discovery.error}
            fallback={
              <div class="settings-v2-cli-agents-state" role="alert">
                <span class="settings-v2-cli-agents-state-title">{language.t("settings.cliAgents.error.title")}</span>
                <span>{language.t("settings.cliAgents.error.description")}</span>
                <Show when={errorDetail()}>
                  <code class="settings-v2-cli-agents-error-detail">{errorDetail()}</code>
                </Show>
                <ButtonV2 type="button" size="small" variant="neutral" onClick={() => void refetch()}>
                  {language.t("settings.cliAgents.retry")}
                </ButtonV2>
              </div>
            }
          >
            <Show
              when={(agents() ?? []).length > 0}
              fallback={
                <div class="settings-v2-cli-agents-state">
                  <span class="settings-v2-cli-agents-state-title">{language.t("settings.cliAgents.empty.title")}</span>
                  <span>{language.t("settings.cliAgents.empty.description")}</span>
                </div>
              }
            >
              <SettingsListV2>
                <For each={agents()}>
                  {(agent) => (
                    <SettingsRowV2
                      title={agent.name}
                      description={
                        <div class="settings-v2-cli-agent-details">
                          <span>{agent.description}</span>
                          <div class="settings-v2-cli-agent-location">
                            <span>{language.t("settings.cliAgents.command")}</span>
                            <code>{agent.command}</code>
                            <Show when={agent.available && agent.path}>
                              <span aria-hidden="true">·</span>
                              <span>{language.t("settings.cliAgents.path")}</span>
                              <code>{agent.path}</code>
                            </Show>
                          </div>
                        </div>
                      }
                    >
                      <span class="settings-v2-cli-agent-status" data-state={agent.available ? "detected" : "missing"}>
                        <span class="settings-v2-cli-agent-status-dot" aria-hidden="true" />
                        {status(agent)}
                      </span>
                    </SettingsRowV2>
                  )}
                </For>
              </SettingsListV2>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}
