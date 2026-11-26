import { ScrollView } from "@omnixa/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { Show, Suspense, lazy } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@omnixa/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { AgentHub } from "./agent-hub"
import { CustomComposition } from "./custom-composition"
import { createHomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"
import { HomeWorkSummary } from "./work-summary"
import { Icon } from "@omnixa/ui/icon"
import "./home.css"

const MemoryInspector = lazy(async () => {
  const { MemoryInspector } = await import("./memory-inspector")

  return { default: MemoryInspector }
})

export function Home() {
  const mobile = createMediaQuery("(max-width: 767px)")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  const language = useLanguage()
  const [consumers, setConsumers] = createStore({ memory: false, hub: false })

  const open = (id: string) => {
    const info = home.server.focusedContext()?.data.session.get(id)

    if (info) sessions.session.open(info)
  }

  return (
    <div
      data-slot="home-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile()}>
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
      </Show>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={scroll.viewport.containOuterWheel}
      >
        <div data-component="home-workspace-grid" data-mode={home.mode.workspace()}>
          <Show when={!mobile()}>
            <Show
              when={home.mode.workspace() === "custom"}
              fallback={<HomeProjects projects={projects} scroll={scroll} />}
            >
              <div data-component="custom-home-navigation">
                <HomeProjects projects={projects} scroll={scroll} />
                <HomeSessions sessions={sessions} search={search} scroll={scroll} />
              </div>
            </Show>
          </Show>
          <div class="flex min-h-0 min-w-0 flex-col">
            <Show when={home.mode.workspace() === "custom" ? home.project.selected() : home.project.newSession()}>
              {(project) => (
                <div data-component="home-workspace-context" aria-label={language.t("home.workspace.current")}>
                  <Icon name="folder" size="small" />
                  <strong>{project().name ?? project().worktree.split(/[\\/]/).at(-1)}</strong>
                  <Show
                    when={
                      home.server.focusedContext()?.data.location.vcs.info({ directory: project().worktree })?.branch
                        .current
                    }
                  >
                    {(branch) => (
                      <span data-slot="workspace-branch">
                        <Icon name="branch" size="small" />
                        {branch()}
                      </span>
                    )}
                  </Show>
                  <span data-slot="workspace-path" title={project().worktree}>
                    {project().worktree}
                  </span>
                </div>
              )}
            </Show>
            <Show when={home.mode.workspace() === "custom"}>
              <CustomComposition home={home} />
            </Show>
            <div class="flex flex-wrap gap-2 py-2">
              <Show when={home.mode.current() === undefined || home.mode.current() === "work"}>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-expanded={consumers.hub}
                  onClick={() => setConsumers("hub", !consumers.hub)}
                >
                  {language.t("home.hub.title")}
                </Button>
              </Show>
              <Show when={home.mode.current() === undefined || home.mode.current() === "assistant"}>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-expanded={consumers.memory}
                  onClick={() => setConsumers("memory", !consumers.memory)}
                >
                  {language.t("home.memory.title")}
                </Button>
              </Show>
            </div>
            <Show when={home.server.focusedContext()} keyed>
              {(context) => (
                <>
                  <Show when={consumers.hub && (home.mode.current() === undefined || home.mode.current() === "work")}>
                    <AgentHub
                      context={context}
                      directory={
                        home.selection.value().directory ??
                        context.projects.last() ??
                        context.projects.list()[0]?.worktree ??
                        ""
                      }
                      active={consumers.hub}
                      openSession={open}
                    />
                  </Show>
                  <Show
                    when={
                      consumers.memory && (home.mode.current() === undefined || home.mode.current() === "assistant")
                    }
                  >
                    <Suspense>
                      <MemoryInspector context={context} active={consumers.memory} openSource={open} />
                    </Suspense>
                  </Show>
                </>
              )}
            </Show>
            <Show when={home.mode.workspace() !== "custom" || mobile()}>
              <HomeSessions sessions={sessions} search={search} scroll={scroll} />
            </Show>
          </div>
          <HomeWorkSummary home={home} sessions={sessions} />
        </div>
      </ScrollView>
    </div>
  )
}
