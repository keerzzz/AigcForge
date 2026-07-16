import type { Component } from "solid-js"
import { modeDefinition, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"

export type ModeSurface = {
  Sidebar: Component
  RightPanel: Component
}

function PlaceholderSidebar(props: { mode: Mode }) {
  const language = useLanguage()
  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-2">
      <div class="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <Icon name={`mode-${props.mode}`} size="large" class="text-v2-icon-icon-muted opacity-40" />
        <p class="text-v2-text-text-muted text-13-regular">{language.t("sidebar.secondary.noResults")}</p>
      </div>
    </div>
  )
}

function PlaceholderPanel() {
  const language = useLanguage()
  return (
    <aside class="flex w-64 shrink-0 flex-col items-center justify-center gap-3 border-l border-v2-border-border-base bg-v2-background-bg-base p-6 text-center">
      <span class="text-v2-text-text-muted text-13-regular">{language.t("sidebar.secondary.noResults")}</span>
    </aside>
  )
}

const MODE_SURFACES: Record<ModeSurfaceSlot, ModeSurface> = {
  coding: {
    Sidebar: () => null,
    RightPanel: () => null,
  },
  chat: {
    Sidebar: () => <PlaceholderSidebar mode="chat" />,
    RightPanel: PlaceholderPanel,
  },
  work: {
    Sidebar: () => <PlaceholderSidebar mode="work" />,
    RightPanel: PlaceholderPanel,
  },
  assistant: {
    Sidebar: () => <PlaceholderSidebar mode="assistant" />,
    RightPanel: PlaceholderPanel,
  },
}

export function modeSurface(mode: Mode) {
  return MODE_SURFACES[modeDefinition(mode).surface]
}
