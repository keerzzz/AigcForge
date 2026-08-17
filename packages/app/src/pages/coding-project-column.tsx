import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ProjectAvatar } from "@aigcfroge/ui/v2/project-avatar-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { MenuV2 } from "@aigcfroge/ui/v2/menu-v2"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useServerManagementController } from "@/components/dialog-select-server"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { ServerConnection } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { displayName, getProjectAvatarSource, type HomeProjectSelection } from "@/pages/layout/helpers"
import { ServerRowMenu } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { type ServerHealth } from "@/utils/server-health"
import { Persist, persisted } from "@/utils/persist"
import { HOME_SECTION_LABEL } from "@/pages/home-shared"

// Coding project and server navigation owner (extracted from the former Home page).
// `HomeProjectColumn`/`HomeProjectRow` keep their compatible export names because
// mode-workspace-slots and home-overview still consume them, but this module is
// the Coding owner — NOT a Home page owner and NOT a shared Location control.
// Work/Assistant reuse ModeLocationNewSession; Chat inlines its own Location in
// ChatFeatureSidebar. Do not replace this tree with ModeLocationNewSession.

const HOME_PROJECT_NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
const HOME_PROJECT_NAV_ROW =
  "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] bg-transparent text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out focus-visible:outline-none h-7 gap-2 px-1.5 [font-weight:440] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base hover:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base data-[selected]:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"

export function HomeProjectColumn(props: {
  projects: LocalProject[]
  selected: HomeProjectSelection
  focusServer: (server: ServerConnection.Any) => void
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  chooseProject: (server: ServerConnection.Any) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const dialog = useDialog()
  const controller = useServerManagementController({ navigateOnAdd: false })
  const [state, setState] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  return (
    <aside
      class="mt-6 flex min-w-0 flex-col gap-4 lg:mt-14 lg:pt-[52px]"
      aria-label={props.language.t("home.projects")}
    >
      <div class="flex h-7 min-w-0 items-center justify-between pl-1.5">
        <div class={HOME_SECTION_LABEL}>{props.language.t("home.projects")}</div>
      </div>
      <Show
        when={global.servers.list().length > 1}
        fallback={<HomeProjectList {...props} server={global.servers.list()[0]} />}
      >
        <For each={global.servers.list()}>
          {(item) => {
            const key = ServerConnection.key(item)
            const healthy = () => !!global.servers.health[key]?.healthy
            const serverCtx = global.ensureServerCtx(item)
            const collapsed = () => state.collapsed[key]
            return (
              <div class="flex max-h-[min(572px,calc(100vh_-_300px))] min-w-0 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <HomeServerRow
                  server={item}
                  selected={props.selected.server === key && !props.selected.directory}
                  healthy={healthy()}
                  collapsed={collapsed()}
                  health={global.servers.health[key]}
                  controller={controller}
                  focusServer={props.focusServer}
                  chooseProject={props.chooseProject}
                  openEdit={(server) => dialog.show(() => <DialogServerV2 mode="edit" server={server} />)}
                  toggleCollapsed={() => setState("collapsed", key, !state.collapsed[key])}
                  language={props.language}
                />
                <Show when={healthy() && !collapsed()}>
                  <div class="mx-3 h-px bg-v2-border-border-base" />
                  <HomeProjectList {...props} server={item} projects={serverCtx.projects.list()} />
                </Show>
              </div>
            )
          }}
        </For>
      </Show>

      {/* Prominent Add Project Button */}
      <Show when={global.servers.list().length === 1}>
        <div class="flex flex-col gap-1 mt-1">
          <ButtonV2
            onClick={() => props.chooseProject(global.servers.list()[0])}
            variant="neutral"
            class="w-full justify-start h-8 text-11-medium"
            icon="folder-add-left"
          >
            {props.language.t("home.project.add")}
          </ButtonV2>
        </div>
      </Show>
    </aside>
  )
}

function HomeServerRow(props: {
  server: ServerConnection.Any
  selected: boolean
  healthy: boolean
  collapsed: boolean
  health: ServerHealth | undefined
  controller: ReturnType<typeof useServerManagementController>
  focusServer: (server: ServerConnection.Any) => void
  chooseProject: (server: ServerConnection.Any) => void
  openEdit: (server: ServerConnection.Http) => void
  toggleCollapsed: () => void
  language: ReturnType<typeof useLanguage>
}) {
  const [state, setState] = createStore({ menuOpen: false })
  return (
    <div class="group/server relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        class={`${HOME_PROJECT_NAV_ROW} pr-16 disabled:opacity-60`}
        data-selected={props.selected ? "" : undefined}
        disabled={!props.healthy}
        onClick={() => props.focusServer(props.server)}
      >
        <Show when={props.healthy}>
          <span
            data-action="home-server-collapse"
            class="inline-flex -ml-0.5 -mr-1.5 size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
            aria-label={
              props.collapsed ? props.language.t("home.server.expand") : props.language.t("home.server.collapse")
            }
            aria-expanded={!props.collapsed}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              props.toggleCollapsed()
            }}
            onPointerDown={(event) => event.preventDefault()}
          >
            <IconV2
              name="chevron-down"
              size="small"
              class="transition-transform duration-150 ease-in-out"
              style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
            />
          </span>
        </Show>
        <div class="flex size-4 shrink-0 items-center justify-center -mr-0.5">
          <ServerHealthIndicator health={props.health} />
        </div>
        <span class="flex min-w-0 items-center gap-1">
          <span class={HOME_PROJECT_NAV_LABEL}>{props.server.displayName ?? new URL(props.server.http.url).host}</span>
          <Show when={props.server.label}>
            {(label) => (
              <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                {label()}
              </span>
            )}
          </Show>
        </span>
      </button>
      <div
        class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <ServerRowMenu
          server={props.server}
          controller={props.controller}
          onEdit={props.openEdit}
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        />
        <IconButtonV2
          data-action="home-add-project"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="folder-add-left" />}
          aria-label={props.language.t("home.project.add")}
          onClick={() => props.chooseProject(props.server)}
        />
      </div>
    </div>
  )
}

function HomeProjectList(props: {
  server: ServerConnection.Any
  projects: LocalProject[]
  selected: HomeProjectSelection
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <For each={props.projects}>
        {(project) => (
          <HomeProjectRow
            project={project}
            server={props.server}
            selected={
              props.selected.server === ServerConnection.key(props.server) &&
              props.selected.directory === project.worktree
            }
            unseenCount={props.unseenCount(props.server, project)}
            selectProject={props.selectProject}
            openNewSession={props.openNewSession}
            editProject={props.editProject}
            closeProject={props.closeProject}
            clearNotifications={props.clearNotifications}
            language={props.language}
          />
        )}
      </For>
    </div>
  )
}

export function HomeProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  selected: boolean
  unseenCount: number
  count?: number
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
}) {
  const [state, setState] = createStore({ menuOpen: false })
  return (
    <div class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        data-component="home-project-row"
        class={`${HOME_PROJECT_NAV_ROW} pr-16`}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => props.selectProject(props.server, props.project.worktree)}
      >
        <HomeProjectAvatar project={props.project} />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
        <Show when={props.count !== undefined}>
          <span class="ml-auto shrink-0 pr-8 text-11-regular text-v2-text-text-faint">{props.count}</span>
        </Show>
      </button>
      <div
        class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={() => props.openNewSession(props.server, props.project.worktree)}
        />
        <MenuV2
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.openNewSession(props.server, props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.editProject(props.server, props.project)}>
                {props.language.t("common.edit")}
              </MenuV2.Item>
              <MenuV2.Item
                disabled={props.unseenCount === 0}
                onSelect={() => props.clearNotifications(props.server, props.project)}
              >
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.closeProject(props.server, props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </div>
  )
}

function HomeProjectAvatar(props: { project: LocalProject }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <ProjectAvatar
      fallback={name()}
      src={getProjectAvatarSource(props.project.id, props.project.icon)}
      variant={getProjectAvatarVariant(props.project.icon?.color)}
    />
  )
}
