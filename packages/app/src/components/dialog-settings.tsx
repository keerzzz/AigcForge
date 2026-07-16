import { Component } from "solid-js"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large">
      <TabsV2 orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </TabsV2.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </TabsV2.Content>
        <TabsV2.Content value="servers" class="no-scrollbar">
          <SettingsServers />
        </TabsV2.Content>
        <TabsV2.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </TabsV2.Content>
        <TabsV2.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}
