import type { ProductMode } from "@aigcfroge/sdk/v2/client"
import { isMode, modeDefinition } from "@/context/mode"
import { useLanguage } from "@/context/language"

/** 会话行内模式徽标：mode===undefined（历史无分类）归 coding 显示（D3）。 */
export function SessionModeBadge(props: { mode?: ProductMode }) {
  const language = useLanguage()
  const m = isMode(props.mode) ? props.mode : "coding"
  return (
    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-px text-[9px] leading-none text-v2-text-text-muted">
      {language.t(modeDefinition(m).labelKey)}
    </span>
  )
}
