import { Spinner } from "@aigcfroge/ui/spinner"
import { useLanguage } from "@/context/language"

/**
 * What a surface shows while its own resources resolve.
 *
 * Shared by the route boundary in `layout.tsx` and the per-slot boundaries in
 * `mode-workspace.tsx`, which had grown two near-identical copies of it. The only real
 * difference was the class, so that is the only thing left as a prop.
 *
 * `role="status"` needs an accessible name, and that is the part worth centralising: the slot
 * copy had the role without a name, which announces an empty live region — and the slot copy is
 * the one that actually runs.
 *
 * `owner` is not decoration. Which boundary answered is the difference between "this mode is
 * loading" and "the whole routed area was replaced", and a test that cannot tell them apart
 * cannot show that one slot's wait stayed inside that slot.
 */
export function SurfacePending(props: { owner: "route" | "slot"; class?: string }) {
  const language = useLanguage()
  return (
    <div
      class={`flex items-center justify-center text-v2-text-text-muted ${props.class ?? ""}`}
      data-component="surface-pending"
      data-surface-pending={props.owner}
      role="status"
      aria-label={language.t("common.loading")}
    >
      <Spinner class="size-4" />
    </div>
  )
}
