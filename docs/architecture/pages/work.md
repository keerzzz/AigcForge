# Work Mode

> 状态：PLANNED — 当前代码库无实现
> 计划功能：Agent 工作流调度和后台任务管理

---

## 计划功能

WORK 模式面向 Agent 工作流的长时间运行和后台管理：

- Agent 工作流编排和执行
- 计划任务调度
- 任务状态面板和进度跟踪
- 运行日志和结果输出

## Viewport 关系

- 与 Coding/Chat 模式共享统一 DOM 骨架
- Terminal 默认折叠，可拉起查看运行日志
- Mode 切换时状态保持 (Keep-Alive)

## 实现前置条件

- Mode Switcher 就绪
- MetaAgent 工作流引擎
- 任务调度器
- 状态持久化层
