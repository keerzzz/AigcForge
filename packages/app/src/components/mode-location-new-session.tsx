import type { Accessor } from "solid-js"
import { getFilename } from "@aigcfroge/core/util/path"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import type { Mode } from "@/context/mode"
import { ServerConnection } from "@/context/server"
import { homeProjectDirectories, launchModeSession } from "@/pages/layout/helpers"

/** Shared location and new-session controls for Chat, Work, and Assistant. */
export function ModeLocationNewSession(props: { directory: Accessor<string | undefined>; mode: Mode }) {
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx } = useModeDirectory()

  function newSession() {
    const c = conn()
    const currentCtx = ctx()
    const dir = props.directory()
    if (!c || !currentCtx || !dir) return
    launchModeSession({
      mode: props.mode,
      projects: currentCtx.projects,
      server: ServerConnection.key(c),
      directory: dir,
      tabs,
    })
  }

  function addProject() {
    const c = conn()
    const currentCtx = ctx()
    if (!c || !currentCtx) return
    pickDirectory({
      server: c,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        const directory = dirs[0]
        if (!directory) return
        dirs.forEach((dir) => currentCtx.projects.open(dir))
        currentCtx.projects.touch(directory)
        global.lastSession.set(currentCtx.sdk.scope, directory)
      },
    })
  }

  return (
    // The mode is carried into the DOM because Work and Assistant both render this
    // component, so nothing else in their sidebars tells the two apart.
    <div data-mode-location={props.mode} class="flex min-h-0 shrink-0 flex-col">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 pb-3 pt-3">
        <Icon name={`mode-${props.mode}`} size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="shrink-0 text-v2-text-text-muted text-11-regular">{language.t("chat.feature.project")}</span>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
          {props.directory()
            ? getFilename(props.directory()) || props.directory()
            : language.t("work.preset.noLocation")}
        </span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="folder-add-left" />}
          aria-label={language.t("sidebar.secondary.addProject")}
          onClick={addProject}
        />
      </div>
      <div class="px-3 pb-2 pt-3">
        <ButtonV2
          variant="neutral"
          size="normal"
          icon="edit"
          class="w-full"
          disabled={!props.directory()}
          onClick={newSession}
        >
          {language.t("command.session.new")}
        </ButtonV2>
      </div>
    </div>
  )
}
