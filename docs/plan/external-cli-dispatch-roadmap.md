# 实施计划：外部 CLI 调度演进路线（B+D 先行，ACP 终态）

> 目标：修复外部 CLI 委派链路的现存 bug 与 UI 断头，把适配器层收敛为声明式配置 + 实时探测，最终以 ACP client 侧统一传输层。
> 前置文档：`docs/plan/external-cli-mention-autocomplete.md`（@补全）、`docs/plan/meta-agent-orchestrator.md`（编排层）。
> 决策记录：2026-08-05 确认方向——自动化优先，人工交接（terminal handoff + transcript import）暂缓；视觉维持"任务卡片 → 子会话详情页"隐喻。

---

## 1. 现状与问题定义

### 1.1 链路现状

meta agent 经 task 工具（`execution_type: "external-cli"` + `cli_target`）调度外部 CLI：

- V2：`packages/core/src/tool/task.ts:165-180` → `TaskDriver.executeCLI` → `packages/core/src/session/task-driver-fill.ts:98-164`
- 适配器：`packages/core/src/tool/cli-adapter.ts`（接口）+ `claude-code.ts` / `gemini.ts` / `codex.ts` / `opencode.ts`
- 执行：`cli-timeout.ts` 裸 spawn（管道 I/O、300s 超时、10MB 输出上限），适配器解析 stdout JSONL，`session.resume_hint` 帧写入 `external_cli_session` 表实现 resume
- UI：`packages/session-ui/src/components/message-part.tsx:1833` 的 `task-tool-card` + 子会话详情页

### 1.2 问题清单（按严重度）

| # | 问题 | 位置 |
|---|------|------|
| P0 | V2 子会话只写 prompt 消息、**不写执行结果消息**，点卡片跳转后空白（legacy V1 会写，行为不一致） | `packages/core/src/session/task-driver-fill.ts` |
| P1 | external-cli 分支在 `session_task` 双轨写之前 return，todo 联动 / AgentTaskHub / 状态栏 SUBAGENTS 指标全部感知不到外部委派 | `packages/core/src/tool/task.ts:165-180` |
| P1 | 任务卡片不区分外部 CLI 与普通 subagent（不读 `execution_type`/`cli_target`/`metadata.cli`） | `message-part.tsx:418-428, 1833-1921`；TUI `packages/tui/src/routes/session/index.tsx:2210` |
| P1 | `result.summary` 不可见（卡片 `hideDetails` 一刀切） | `message-part.tsx:1917` |
| P2 | 探测三处冻结：meta 提示词启动时一次性填充；前端 agent 列表仅启动时拉取一次；适配器类型硬编码 | `meta-prompt-filler.ts:23`；`bootstrap.ts:200`；`registry.ts:24-27` |
| P2 | CLI 徽标、`(background)`、TUI subagent 文案全部硬编码英文，未走 i18n | `slash-popover.tsx:66-69` 等 |
| P2 | `meta_agent_step` 全链路断头：`type: "external-cli"` 从未写入，`updateStep` 零调用者，无 HTTP 出口，UI 零消费 | `packages/core/src/meta-agent/` |
| P3 | 桌面端 Electron GUI 进程 PATH 与终端不一致，`which` 探测可能漏检 | 适配器 `detect()` |

---

## 2. 阶段 B：修 bug + 卡片四点小修补（先行，约一周量级）

### 2.1 P0：子会话补写结果消息

- `task-driver-fill.ts` 的 `execute` 在 `executeWithTimeout` 返回后，向子 Session 写入结果消息（text part，内容取 `DelegationParser` 的 summary；超时/失败写错误态消息），对齐 legacy `packages/aigcfroge/src/tool/task.ts:188-205` 的行为。
- 验收：调度任一外部 CLI 后，点击父会话任务卡片跳转，子会话显示 prompt + 结果两条消息。

### 2.2 P1：external-cli 分支接入 session_task 联动

- 把 `task.ts:225-255` 的 Track A/B 双轨写移到各分支公共路径（或 external-cli 分支补齐），使外部委派同样产生 `session_task` 记录并参与 onSettle 联动。
- 验收：AgentTaskHub 与标题栏进度轨道能看到 external-cli 任务。

### 2.3 P1：任务卡片四点小修补（session-ui + TUI）

1. **CLI 区分标识**：`getToolInfo` task 分支读取 `input.execution_type === "external-cli"`（或 `metadata.cli`）时，图标换 terminal + 标题旁加 CLI 徽标；i18n key 新增 `ui.tool.cli`，替换 `slash-popover.tsx` 的硬编码 `"CLI"`。
2. **可展开摘要**：task 卡片去掉 `hideDetails` 一刀切，输出中的 summary 部分默认折叠、点击展开（`renderOutput` 已解析 `<task>` 包裹结构）。
3. **状态 chip**：卡片显示 running / completed / failed / timeout，数据源 `state.status` + `metadata.status`。
4. **权限 dock 显示目标**：`session-permission-dock.tsx` 与 TUI `permission.tsx` 的 task 分支渲染 `cli_target` / `execution_type`（legacy metadata 已带，V2 需在 `permission.assert` 的 metadata 中补充）。

### 2.4 P2：i18n 补齐

- 新增 key：`ui.tool.cli`、`ui.tool.cli.badge`、TUI subagent 文案条目；清理 `slash-popover.tsx:66-69`、`autocomplete.tsx:402-422`、`message-part.tsx:1847-1855` 的硬编码。

### 2.5 验证（改完即审）

- `bun --cwd packages/session-ui test`、`bun --cwd packages/core test --timeout 30000`（task/driver 相关用例）、`bun --cwd packages/core typecheck`、`bun run lint`
- 手动：tmux 起 TUI + app 各调一次 claude-code，检查卡片徽标/摘要/状态、子会话内容、AgentTaskHub 条目。

---

## 3. 阶段 D：声明式配置 + 解冻三处探测

### 3.1 配置 schema：`cli_agents`

在 config（`packages/core/src/config/`）新增 `cli_agents` 字段，声明式定义外部 CLI：

```jsonc
{
  "cli_agents": {
    "kimi": {
      "command": "kimi",
      "description": "Kimi CLI",
      "args": ["--print", "{prompt}"],
      "resume_args": ["--resume", "{resumeId}"],
      "output": "claude-jsonl",        // 复用解析器类型：claude-jsonl | codex-jsonl | plain
      "timeout": 300
    }
  }
}
```

- registry（`packages/aigcfroge/src/agent/meta/adapters/registry.ts`）启动时加载内置四个 + 配置定义，统一走 `detect()`（`which`）。
- 配置定义的适配器由一个通用 `ConfigCliAdapter` 工厂生成（`buildArgs` 模板插值、`parseOutput` 按 `output` 类型复用现有解析器）。
- 内置适配器后续可逐步迁移为内置默认配置，收敛为一份实现。

### 3.2 解冻点 1：meta 提示词实时填充

- `meta-prompt-filler.ts:23` 目前是 layer 构建时 pre-compute `cliNames`。改为：注册 transform 时不预烘焙名单，`MetaPrompt.Service.fill` 在每次构建 prompt 时实时调 `CliAdapterRegistry.available()` + fill。
- 注意保持 transform 同步签名——把 available() 结果放入一个随调用刷新的 memo（如 `Effect.cached` + TTL，或 prompt 构建入口处的 effectful fill），避免每次 `which` 的成本打到热路径。

### 3.3 解冻点 2：agent 列表动态刷新

- 低成本：composer 挂载 / @popover 打开时重新 `sdk.app.agents()`。
- 目标态：server 侧 `available()` 结果变化时发 `agent.updated` SSE 事件（周期 re-detect 或监听 PATH 目录 mtime），走 `global-sync/event-reducer.ts` 更新 store。app 与桌面端免刷新自动出现新 CLI。

### 3.4 解冻点 3（P3）：桌面端 PATH

- `detect()` 不直接信 `process.env.PATH`：Electron GUI 启动时 PATH 缺用户 shell 配置。解析 login shell 环境（或显式扫描常见 bin 目录：`~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin` 等）后再 `which`。

### 3.5 验证

- config schema 单测（合法/非法定义、未知 output 类型的 typed error）；`ConfigCliAdapter` 用 `scriptedResponses` 风格脚本化 stdout 做解析测试。
- 手动：配置文件新增一个别名 CLI（如 `claude-code` 改名条目），不重启 server 验证 @补全与 meta prompt 出现新条目（3.2/3.3 生效）。

---

## 4. 阶段 A（终态）：ACP client 侧统一传输层

### 4.1 定位

`CliAdapter` 增加 transport 概念：`jsonl`（现状，保留为 fallback）| `sdk`（官方 SDK）| `acp`（目标态）。按家选型：

- **claude-code**：优先 ACP（`claude-code-acp` 桥接进程），过渡期内适配器内部可换 `@anthropic-ai/claude-agent-sdk`（类型化消息、权限回调、resume 都是现成的）。
- **codex**：优先 ACP（`@zed-industries/codex-acp`），过渡期内换 `@openai/codex-sdk`（Thread API、`resumeThread`、sandbox/approval 控制）。
- **gemini**：维持 JSONL（`--experimental-acp` 尚不稳定，官方无 headless SDK）。
- **opencode**：维持 JSONL，或评估 `opencode serve` + HTTP SDK。

### 4.2 ACP 收益（替换四套 JSONL 解析的回报）

- `session/load` 标准恢复 → `resume_hint` 帧解析与 `external_cli_session` 表的手工关联退休。
- `session/request_permission` → 外部 CLI 权限问询桥接进 aigcfroge 权限 UI（现状只有"超时或放行"）。
- `session/update` 结构化 tool_call → 任务卡片展开视图直接渲染外部 CLI 的工具调用进度（嵌套关联参考 claude-code-acp 的 `_meta.parentToolUseId` 约定）。
- 仓库已依赖 `@agentclientprotocol/sdk@0.21.0`（agent 侧实现在 `packages/aigcfroge/src/acp/`），client 侧补 `ClientConnection` 即可。

### 4.3 前置依赖与风险

- 依赖阶段 D 的 transport 抽象先落地，否则 ACP 会变成第五套并行实现。
- gemini ACP experimental、opencode 子会话事件不转发 ACP（上游 issue）→ JSONL fallback 长期保留，适配器按家声明 transport 优先级。
- 权限桥接需要把 ACP `session/request_permission` 映射到 `packages/core/src/permission` 的决策流，是本子阶段最大的一块新工作。

---

## 5. 明确不做（本计划范围外）

- **terminal handoff + transcript import**（人工交接模式）：已确认暂缓，自动化优先。后续单独立项。
- **PTY / 交互式 TUI 驱动外部 CLI**：解析终端控制码不可维护，任何阶段都不做。
- **meta_agent_step 断头收敛**：P2 另行决策——要么补全（external-cli 写 step + `updateStep` 状态机 + HTTP 端点 + AgentTaskHub 消费），要么删表删 service。建议随阶段 B 一并决策，避免半成品继续腐化（`meta-agent-v2-production-closure.md` 声称完成与现状不符，需同步修正该文档）。
- **V1/V2 task 工具双实现合并、CliAdapter 双 registry 收敛**：随阶段 D 的 registry 改造顺手收敛为 Effect service 单份，不单独立项。

---

## 6. 里程碑排序与验收总表

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1（阶段 B） | P0/P1/P2 修复 + 卡片四点 + i18n | 子会话有结果消息；卡片有 CLI 徽标/摘要/状态；AgentTaskHub 可见外部委派；相关包 test+typecheck+lint 通过 |
| M2（阶段 D） | `cli_agents` 配置 + 三处解冻 + 桌面 PATH | 配置文件新增 CLI 免重启生效；新装 CLI 自动出现在 @补全与 meta prompt |
| M3（阶段 A） | transport 抽象 + claude/codex SDK 化 | 两家适配器删除 JSONL 解析代码，权限回调/resume 走 SDK |
| M4（阶段 A） | ACP client 侧 + 权限桥接 | claude-code/codex 走 ACP；外部权限问询弹 aigcfroge 权限 UI；JSONL fallback 保留 |
