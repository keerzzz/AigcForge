import type { HomeProjectsController } from "./controller"
import { HomeProjectsView } from "./view"
import type { HomeScrollController } from "../scroll"
import type { ServerConnection } from "@/runtime/server/registry"
import type { JSX } from "solid-js"
import type { LocalProject } from "@/shell/state/layout"

export function HomeProjects(props: {
  projects: HomeProjectsController
  scroll?: HomeScrollController
  dropdown?: boolean
  docked?: boolean
  onToggleProject?: (server: ServerConnection.Any, project: LocalProject) => void
  projectChildren?: (server: ServerConnection.Any, project: LocalProject) => JSX.Element
  projectStatus?: (server: ServerConnection.Any, project: LocalProject) => JSX.Element
  unseenCount?: (server: ServerConnection.Any, project: LocalProject) => number
  onClearNotifications?: (server: ServerConnection.Any, project: LocalProject) => void
}) {
  return (
    <HomeProjectsView
      dropdown={props.dropdown}
      docked={props.docked}
      language={props.projects.copy.language}
      servers={props.projects.server.list()}
      projects={props.projects.project.list()}
      recentlyClosed={props.projects.project.recentlyClosed()}
      selection={props.projects.selection.value()}
      homedir={props.projects.project.homedir()}
      serverHealth={props.projects.server.health}
      projectsForServer={props.projects.server.projects}
      collapsed={props.projects.server.collapsed}
      canRevealProject={props.projects.project.canReveal}
      unseenCount={props.unseenCount ?? props.projects.project.unseenCount}
      onWheel={(event) => props.scroll?.viewport.containWheel(event)}
      onChooseProject={props.projects.project.choose}
      onFocusServer={props.projects.server.focus}
      onAuthenticateServer={props.projects.server.authenticate}
      onToggleCollapsed={props.projects.server.toggleCollapsed}
      onEditServer={props.projects.server.edit}
      canRemoveServer={props.projects.server.canRemove}
      onRemoveServer={props.projects.server.remove}
      canHideServer={props.projects.server.canHide}
      onHideServer={props.projects.server.hide}
      onMoveProject={props.projects.project.move}
      onSelectProject={props.projects.project.select}
      onToggleProject={props.onToggleProject}
      projectChildren={props.projectChildren}
      projectStatus={props.projectStatus}
      onAddProjects={props.projects.project.add}
      canCreateSession={props.projects.project.canCreateSession()}
      onOpenProjectNewSession={props.projects.project.openNewSession}
      canImportSession={props.projects.project.canImportSession}
      onImportSession={props.projects.project.importSession}
      onEditProject={props.projects.project.edit}
      onRevealProject={props.projects.project.reveal}
      onClearNotifications={props.onClearNotifications ?? props.projects.project.clearNotifications}
      onCloseProject={props.projects.project.close}
    />
  )
}
