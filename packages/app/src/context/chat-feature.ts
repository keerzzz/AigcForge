import { createSignal } from "solid-js"

/**
 * Chat 模式功能树当前选中的功能分类（m1 §1.4）。
 *
 * 模块级 signal：ChatFeatureSidebar（左栏导航）写入，Home 右栏读取以切换内容。
 * 选 "prompt" 时右栏显示 chat 会话列表 + 资产入口；其余分类右栏显示能力清单（只读）。
 * 非持久化：刷新回到默认 "prompt"（M1 可接受，后续如需记忆再迁 persisted）。
 */
export type ChatFeatureID = "prompt" | "skill" | "mcp" | "command" | "agent" | "workflow"

const [chatFeature, setChatFeature] = createSignal<ChatFeatureID>("prompt")
export { chatFeature, setChatFeature }
