import { ProductMode } from "@aigcfroge/schema/product-mode"
import type { SessionInfo } from "@aigcfroge/client/promise"
import type { LayoutRoute } from "@/shell/state/layout"
import type { DraftTab } from "@/shell/tabs/tabs"
import { TabStorage } from "@/shell/tabs/schema"

export function href(mode: ProductMode.ID) {
  return `/mode/${mode}`
}

export function sourceMode(route: LayoutRoute, draft: DraftTab | undefined, session: SessionInfo | undefined) {
  if (route.type === "mode") return route.mode

  if (draft) return TabStorage.genericMode(draft)

  if (route.type !== "session" || session?.id !== route.sessionId) return

  if (session.mode === undefined) return ProductMode.Default

  if (ProductMode.isID(session.mode)) return session.mode
}

export * as ModeRoute from "./mode"
