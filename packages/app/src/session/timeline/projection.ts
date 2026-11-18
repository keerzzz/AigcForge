import { createReactiveTimelineProjection } from "@aigcfroge/session-ui/timeline/projection"

export { reuseTimelineRows } from "@aigcfroge/session-ui/timeline/projection"

export function createTimelineProjection(input: Parameters<typeof createReactiveTimelineProjection>[0]) {
  return createReactiveTimelineProjection(input)
}
