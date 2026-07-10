import { useLayout } from "@/context/layout"

/**
 * Opens the session Context tab: reveals the review panel, switches the file
 * tree to "all", and activates the "context" tab.
 *
 * Shared by the bottom stats bar and the session-context-usage button so both
 * entry points use identical navigation logic.
 */
export function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  if (!args.view.reviewPanel.opened()) args.view.reviewPanel.open()
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}
