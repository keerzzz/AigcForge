import { TextDiffView } from "./text-diff-view"

const OLD = "第一行\n第二行\n第三行\n第四行\n第五行\n"
const NEW = "第一行\n第二行改\n第三行\n新增行\n第五行\n"

export default {
  title: "App/Session/TextDiffView",
  id: "app-session-text-diff-view",
  component: TextDiffView,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "220px",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["chat", "work"],
    },
  },
  args: {
    oldText: OLD,
    newText: NEW,
    variant: "chat",
  },
}

export const Chat = {
  args: {
    variant: "chat",
  },
}

export const Work = {
  args: {
    variant: "work",
  },
}
