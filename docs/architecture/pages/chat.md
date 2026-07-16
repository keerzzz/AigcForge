# Chat Mode

> 状态：PLANNED — 当前代码库无实现
> 计划功能：对话式 AI 交互模式，MetaAgent 调度中枢

---

## 计划架构

Chat 模式是基于 MetaAgent 元智能体的对话交互模式：

### MetaAgent 编排模型 (来自原始 aigcfroge 实现)

- 定位：纯编排入口，不做具体代码执行
- 权限：bash/read/edit/grep/glob 全部 deny
- 仅允许：question/task/write 等编排操作
- 缓存策略：cache_mode: "three-zone"

### 核心流程

1. 用户输入 → MetaAgent 意图理解
2. MetaAgent → task tool 委派给子引擎
3. 子引擎通过 PTY 唤起本地 CLI (如 @claude-code)
4. 输出流经 PTY → Streaming JSON 解析 → Timeline 渲染

### Viewport 关系

- 与 Coding 模式共享同一 DOM 骨架
- 不同模式切换时 Viewport Keep-Alive (display:none)
- Terminal 默认折叠，可拉起

## 6 大资产系统 (PLANNED)

用户通过 CHAT 模式创建和管理的资产，落地 .aigcfroge/ 目录：

- **Prompts**: .aigcfroge/prompts/
- **Skills**: .aigcfroge/skills/
- **MCPs**: .aigcfroge/mcp/
- **Workflows**: .aigcfroge/workflows/
- **Commands**: .aigcfroge/commands/
- **Agents**: .aigcfroge/agents/

实现时需补充: Schema 定义、写入校验、路径穿越防护、安全白名单。

## 实现前置条件

1. MetaAgent 从原始项目迁移
2. PTY CLI 唤起机制
3. 6 大资产 Schema 和存储层
4. Mode Switcher 就绪
