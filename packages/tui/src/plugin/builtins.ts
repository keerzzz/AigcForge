import HomeFooter from "../feature-plugins/home/footer"
import PromptBtw from "../feature-plugins/prompt/btw"
import MetaManagement from "../feature-plugins/prompt/meta-management"
import PromptFooter from "../feature-plugins/prompt/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Storybook from "../feature-plugins/system/storybook"
import Stats from "../feature-plugins/system/stats"
import Latex from "@aigcfroge/latex/plugin"
import Merman from "@aigcfroge/merman/plugin"

export const builtins = [
  HomeFooter,
  PromptFooter,
  PromptBtw,
  MetaManagement,
  SidebarContext,
  SidebarMcp,
  SidebarFooter,
  Notifications,
  Plugins,
  Stats,
  Merman,
  Latex,
  // The storybook is a development tool; keep its route and palette commands out of
  // normal launches and register it only for AIGCFROGE_STORY runs.
  ...(process.env.AIGCFROGE_STORY ? [Storybook] : []),
  DiffViewer,
]
