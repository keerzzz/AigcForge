# ADR-14：模式资产与运行状态的持久化边界

> 状态：Accepted（2026-07-15 接受；接受条件已满足：四份 v3 PRD 不依赖硬编码全局目录/EventV2-only 调度/隐式 Work 工作区、ARCHITECTURE.md §7 同步列 Accepted）
> 关联：[ADR-13](ADR-13-chat-work-mode-boundary.md)、[ARCHITECTURE.md](../../../ARCHITECTURE.md) §4.4/§4.8/§4.10、`packages/core/src/global.ts`

## 背景

Chat 资产、Work 产出、Assistant 调度和 Agent 来源具有不同的生命周期。旧方案将全局配置目录、用户产出、Session EventV2 和沙箱临时数据混为同一种“落盘”，容易造成硬编码路径、错误恢复语义和 owner 不清。

本 ADR 区分**配置资产**、**用户产出引用**和**运行状态**。它不批准具体 Prompt Asset、Artifact、Schedule/Delivery 或 Agent provenance Schema；这些契约由对应 owner 设计。

## 提议决策

### 1. 配置资产

| 作用域 | 根目录                             | 适用数据           |
| ------ | ---------------------------------- | ------------------ |
| 项目级 | `<Location.directory>/.aigcfroge/` | 项目资产和项目配置 |
| 全局级 | `Global.Service.config`            | 用户全局配置资产   |

- `Global.Service.config` 由 XDG 配置根或 `AIGCFROGE_CONFIG_DIR` 解析，不硬编码 `~/.aigcfroge`。
- 资产保存相对所属根目录的规范化路径；路径解析必须验证 `..`、绝对路径和符号链接越界。
- 每类资产由 typed owner service 执行校验、原子写入、registry reload、回读和失败恢复。模型或 UI 不直接把通用 Write 当作资产事务。

### 2. 用户产出

- Work M1 要求用户选择已有 Location；不创建隐式“全局 Work 工作区”。
- Artifact 内容以 Location 文件为真源，Artifact 投影只保存稳定身份、Session、类型、相对路径和状态。
- 文件缺失或被外部修改时投影保留身份并报告状态，不从聊天文本反推当前文件内容。

### 3. 运行状态

- Schedule、Delivery、重试、租约和取消状态属于查询型运行数据，使用独立持久表和 typed service。
- EventV2 可以记录用户可见事件和审计事实，但不能独自承担调度查询、租约或重试状态。
- Session transcript、自由文本 metadata 和进程内 `BackgroundJob` 均不能替代可靠运行状态存储。

### 4. 数据真源

| 数据                 | 真源                   | 非真源                      |
| -------------------- | ---------------------- | --------------------------- |
| Chat 配置资产        | typed registry + 文件  | Session transcript          |
| Work 产出内容        | Location 文件          | Artifact 投影正文副本       |
| Work 产出身份        | Artifact 事件/投影     | 工具日志                    |
| Assistant 调度       | Schedule/Delivery 表   | EventV2-only、BackgroundJob |
| Session 分类与 Agent | Session durable fields | 当前 UI Mode、URL 推断      |

### 5. 迁移与兼容

- 项目移动依赖 Location/Project 解析和相对引用，不通过批量改写绝对路径维持身份。
- 全局配置根变更必须由 Global service 和 owner service 协调迁移，不能在消费者中拼接 home directory。
- 新事件或字段保持旧客户端可解码；数据库迁移遵循 forward-only 约束。
- 导入导出、项目/全局作用域切换和跨设备同步由独立资产包设计决定，不在本 ADR 中预设格式。

## 明确不决定

- Work 的无项目默认目录。
- 测试 Session 的持久化与删除策略。
- 沙箱、网络出口、短期凭证或外部写回架构。
- 工作流、Agent 包或跨设备同步格式。

## 结果

### 正向影响

- 配置、产出和运行状态分别拥有可恢复的事实真源。
- 全局路径符合当前 XDG/环境变量实现。
- M1 不被全局工作区、沙箱和导入导出等后续能力绑架。

### 代价

- Prompt Asset、Artifact、Scheduler 和 provenance 仍需独立 owner contract。
- 不能用一个 EventV2 类型或统一目录解决所有模式的数据生命周期。

## 接受条件

1. Core、数据库和安全 owner 接受上述真源划分。
2. 四份 v3 PRD 不再依赖硬编码全局目录、EventV2-only 调度或隐式 Work 工作区。
3. `ARCHITECTURE.md` 在本 ADR 接受前将其列为 Proposed，而非 Accepted decision。
