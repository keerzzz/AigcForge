import { createReactiveTimelineProjection } from "@omnixa/session-ui/timeline/projection"

export { reuseTimelineRows } from "@omnixa/session-ui/timeline/projection"

export function createTimelineProjection(input: Parameters<typeof createReactiveTimelineProjection>[0]) {
  return createReactiveTimelineProjection(input)
}
