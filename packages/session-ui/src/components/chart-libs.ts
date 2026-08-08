// 相对路径导入根 node_modules：bun 的 ?raw 不经过 package exports map
// （子路径 + 查询串会解析失败），Vite 对相对路径 ?raw 同样支持。
import visNetworkSource from "../../../../node_modules/vis-network/standalone/umd/vis-network.min.js?raw"
import chartJsSource from "../../../../node_modules/chart.js/dist/chart.umd.js?raw"

export const CHART_LIBS = {
  "vis-network": visNetworkSource,
  "chart.js": chartJsSource,
} as const

/** 按 HTML 中使用的全局 API 检测需要内联注入的图表库源码（D3 Inline Injection）。 */
export function resolveLibs(html: string): string[] {
  const libs: string[] = []
  if (html.includes("vis.")) libs.push(CHART_LIBS["vis-network"])
  if (html.includes("Chart")) libs.push(CHART_LIBS["chart.js"])
  return libs
}

export * as ChartLibs from "./chart-libs"
