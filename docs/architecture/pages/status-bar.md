# Status Bar

> 状态：PLANNED — 当前代码库无实现
> 计划功能：底部 24px 全局度量栏

---

## 计划功能

Status Bar 是计划中的全局底部状态栏，固定高度 24px，显示当前 Session 的运行时度量：

- **上下文大小**: `24k/128k` — 已用/最大上下文 token
- **缓存率**: `84%` — prompt_tokens_details.cached_tokens 占比
- **Token 使用量**: 当前 Session 累计
- **连接状态**: 在线/离线/重连中
- **当前模型**: 模型名称和 variant
- **终端进程数**: 活跃 PTY 数量

## 数据源 (待定义)

实现时需明确每个指标的数据管道：
- Token 指标来自 LLM API 响应的 usage 字段
- 缓存率来自 prompt_tokens_details
- 连接状态来自 ServerProvider

## 交互

- 点击展开详细统计面板
- 数据缺失时显示 `—`
- 始终挂载在 Layout 底部，不随路由切换卸载
