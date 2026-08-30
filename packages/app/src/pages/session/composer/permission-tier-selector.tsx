import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * Session permission tier selector（计划 §5）。只在
 * chat/work/assistant × meta 显示；Coding 与非 meta Agent 忽略档位。
 */
export function PermissionTierSelector(props: {
  mode: string | undefined
  agent: string | undefined
  value: "propose" | "full" | undefined
  onChange: (tier: "propose" | "full") => void
}) {
  const language = useLanguage()

  const visible = createMemo(() => {
    const mode = props.mode
    const agent = props.agent
    if (mode !== "chat" && mode !== "work" && mode !== "assistant") return false
    return agent === "meta"
  })

  const options = [
    {
      id: "propose" as const,
      label: language.t("permission.tier.propose"),
      hint: language.t("permission.tier.propose.hint"),
    },
    { id: "full" as const, label: language.t("permission.tier.full"), hint: language.t("permission.tier.full.hint") },
  ]

  return (
    <Show when={visible()}>
      <div data-slot="permission-tier-selector" role="group" aria-label={language.t("permission.tier.label")}>
        <span data-slot="permission-tier-label">{language.t("permission.tier.label")}</span>
        <div data-slot="permission-tier-options">
          <For each={options}>
            {(option) => (
              <button
                type="button"
                data-slot="permission-tier-option"
                data-value={option.id}
                data-active={props.value === option.id || (props.value === undefined && option.id === "propose")}
                aria-pressed={props.value === option.id || (props.value === undefined && option.id === "propose")}
                aria-label={option.hint}
                title={option.hint}
                onClick={() => props.onChange(option.id)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
