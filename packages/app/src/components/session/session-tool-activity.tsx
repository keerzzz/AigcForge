import { createMemo, For, Show } from "solid-js"
import type { Part } from "@aigcfroge/sdk/v2/client"
import { AccordionV2 } from "@aigcfroge/ui/v2/accordion-v2"
import { StickyAccordionHeader } from "@aigcfroge/ui/sticky-accordion-header"
import { useLanguage, type Dictionary } from "@/context/language"
import { aggregateToolActivity, type ToolActivity as ToolActivityType } from "./session-tool-activity-model"

function ToolActivitySection(props: { activity: ToolActivityType }) {
  const language = useLanguage()
  const maxCount = createMemo(() => Math.max(...props.activity.items.map((i) => i.count), 1))

  return (
    <div class="flex flex-col gap-1.5">
      <div class="text-12-regular text-text-weak">
        {props.activity.total} {language.t(props.activity.label as keyof Dictionary)}
      </div>
      <div class="flex flex-col gap-1">
        <For each={props.activity.items}>
          {(item) => (
            <div class="flex items-center gap-2 text-11-regular">
              <div class="min-w-0 flex-1 truncate text-text-strong">{item.name}</div>
              <div class="flex items-center gap-1.5 shrink-0">
                <div class="w-20 h-1.5 rounded-full bg-surface-base overflow-hidden">
                  <div
                    class="h-full rounded-full bg-accent-base transition-all"
                    style={{ width: `${(item.count / maxCount()) * 100}%` }}
                  />
                </div>
                <span class="text-11-regular text-text-weaker w-3 text-right">{item.count}</span>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export function SessionToolActivity(props: { parts: () => readonly Part[] }) {
  const language = useLanguage()

  const activities = createMemo(() => aggregateToolActivity(props.parts()))
  const totalCalls = createMemo(() => activities().reduce((sum, act) => sum + act.total, 0))
  const totalTools = createMemo(() => activities().reduce((sum, act) => sum + act.items.length, 0))

  return (
    <Show when={activities().length > 0}>
      <div class="flex flex-col gap-2">
        <AccordionV2 multiple>
          <AccordionV2.Item value="tool-activity">
            <StickyAccordionHeader>
              <AccordionV2.Trigger>
                <div class="flex items-center gap-2 w-full">
                  <span class="text-12-regular text-text-weak">
                    {language.t("toolActivity.summary", {
                      total: totalCalls().toLocaleString(language.intl()),
                      count: totalTools().toLocaleString(language.intl()),
                    })}
                  </span>
                </div>
              </AccordionV2.Trigger>
            </StickyAccordionHeader>
            <AccordionV2.Content>
              <div class="grid grid-cols-2 gap-x-6 gap-y-3 px-3 pb-3">
                <For each={activities()}>
                  {(activity) => <ToolActivitySection activity={activity} />}
                </For>
              </div>
            </AccordionV2.Content>
          </AccordionV2.Item>
        </AccordionV2>
      </div>
    </Show>
  )
}
