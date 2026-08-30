import { createSignal, For } from "solid-js"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { SessionFileTabStrip } from "./file-tab-strip"
import { FileVisual } from "@/components/session"

const FILES = ["src/session/timeline.tsx", "src/session/composer.tsx", "src/components/prompt-input.tsx"]

function SessionFileTabStripExample() {
  const [tabs, setTabs] = createSignal([...FILES])
  const [active, setActive] = createSignal(FILES[0])
  const [contextOpen, setContextOpen] = createSignal(false)

  const move = (from: string, to: string) => {
    const list = [...tabs()]
    const fromIndex = list.indexOf(from)
    const toIndex = list.indexOf(to)
    if (fromIndex < 0 || toIndex < 0) return
    list.splice(fromIndex, 1)
    list.splice(toIndex, 0, from)
    setTabs(list)
  }

  return (
    <TabsV2 value={active()} onChange={(tab) => setActive(String(tab))}>
      <SessionFileTabStrip
        openedTabs={tabs}
        contextOpen={contextOpen}
        onClose={(tab) => setTabs((list) => list.filter((item) => item !== tab))}
        onMove={move}
        renderLeading={() => (
          <>
            <TabsV2.Trigger value="review">Review</TabsV2.Trigger>
            <TabsV2.Trigger value="context" onClick={() => setContextOpen(!contextOpen())}>
              Context
            </TabsV2.Trigger>
          </>
        )}
        renderOverlay={(tab) => <FileVisual active path={tab} />}
      >
        <TabsV2.Content value="review">Review tab content</TabsV2.Content>
        <TabsV2.Content value="context">Context tab content</TabsV2.Content>
        <For each={tabs()}>{(tab) => <TabsV2.Content value={tab}>File: {tab}</TabsV2.Content>}</For>
      </SessionFileTabStrip>
    </TabsV2>
  )
}

export default {
  title: "App/Session/FileTabStrip",
  id: "app-session-file-tab-strip",
  component: SessionFileTabStrip,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "180px",
  },
}

export const Default = {
  render: () => <SessionFileTabStripExample />,
}
