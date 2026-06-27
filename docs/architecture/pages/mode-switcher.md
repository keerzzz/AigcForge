# Mode Switcher

> 状态：PLANNED — 当前代码库无实现
> 计划功能：四模式切换器，动态插槽装配

---

## 计划功能

四模式切换器，位于 Layout 核心位置：

- **Coding**: 代码编辑交互 (当前唯一已实现)
- **Chat**: 对话式 AI + MetaAgent 调度
- **Work**: Agent 工作流调度
- **Assistant**: 用户自定义智能体

## 设计要点

- 图标按钮组，当前模式高亮
- 键盘快捷键切换
- 每个模式独立记住最后活跃 Session (activeSessionId[mode])
- 不在 URL 中编码 Mode
- Viewport Keep-Alive 策略 (display:none)

## 持久化契约

- currentMode: 当前选中模式
- activeSessionId[mode]: 每个模式的活跃 Session ID
- 持久化 key: session-view (Persist.session)

## 实现前置条件

- Layout 中预留 Mode Switcher 插槽
- 各 Mode 的 Viewport 组件就绪
