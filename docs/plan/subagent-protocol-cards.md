> **状态：HISTORICAL PROTOCOL-CARD PLAN / EXTENDED BY ADR-22（2026-08-31）**
> 本文仍是 Agent Card/Protocol Card 的历史实施记录。新的 implementer/reviewer participant 输出、turn、evidence/revision digest 和 close 协议，以 [ADR-22](../architecture/adr/ADR-22-meta-agent-persistent-delegation.md) 与 [唯一实施计划](meta-agent-persistent-delegation-closed-loop.md) 为准。

# AigcForge 子智能体协议卡片实施计划

> 日期：2026-06-29
> 版本：v1.0
> 来源调研：
>
> - `docs/research/industry/AI智能体协议研究.md` — 2026 上半年行业协议架构白皮书
> - `harness-engineering` 项目（4266 stars）— 30 篇交叉分析文章
> - `CL4R1T4S` 项目 — Claude Code / Cursor / Cline / Codex / Devin 系统提示词
> - 本项目现有代码：agent.ts、core/plugin/agent.ts、meta.txt、delegation-protocol.ts、context-builder.ts

---

## 一、现状调查：子智能体能力清单

### 1.1 V1 注册（agent.ts）

| 智能体         | mode     | hidden | 系统提示词                          | 描述                                                                                      | 核心权限特征                                                             |
| -------------- | -------- | ------ | ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **meta**       | primary  | false  | meta.txt（升级中）                  | "The meta agent — unified orchestration entry point"                                      | buildDefaults + task/create_agent/configure_mcp allow                    |
| **build**      | primary  | false  | 无独立文件（仅 V2 中 BUILD_SYSTEM） | "The default agent. Executes tools based on configured permissions."                      | buildDefaults（全工具 allow + question/plan_enter allow）                |
| **plan**       | primary  | false  | 无独立文件                          | "Plan mode. Disallows all edit tools."                                                    | defaults + question/plan_exit allow，edit deny（.aigcfroge/plans/ 除外） |
| **general**    | subagent | false  | 无独立文件                          | "General-purpose agent for researching complex questions and executing multi-step tasks." | defaults + todowrite deny                                                |
| **explore**    | subagent | false  | explore.txt（19行）                 | "Fast agent specialized for exploring codebases."                                         | mark-all-deny + grep/glob/list/bash/webfetch/websearch/read allow        |
| **compaction** | primary  | true   | compaction.txt                      | 上下文摘要（内部）                                                                        | mark-all-deny                                                            |
| **title**      | primary  | true   | title.txt                           | 标题生成（内部）                                                                          | mark-all-deny                                                            |
| **summary**    | primary  | true   | summary.txt                         | 摘要生成（内部）                                                                          | mark-all-deny                                                            |

### 1.2 V2 注册（core/plugin/agent.ts）

V2 与 V1 权限结构一致，使用 PermissionV2 Ruleset 格式。build/system prompt 为 `BUILD_SYSTEM` 常量。此外注册了 meta 智能体（PROMPT_META）。

### 1.3 已有协议文档

| 文档                            | 适用对象                 | 长度    | 类型                                |
| ------------------------------- | ------------------------ | ------- | ----------------------------------- |
| AGENTS.md（根目录）             | 全仓库智能体             | 159 行  | 代码风格/分支/提交/测试/Effect 规范 |
| packages/aigcfroge/AGENTS.md    | aigcfroge 包智能体       | 132 行  | DB/模块形状/Effect 规则             |
| packages/llm/AGENTS.md          | LLM 包智能体             | —       | LLM 架构/路由/协议                  |
| meta.txt                        | meta agent 自身          | ~70 行  | 编排规则/路由映射/协议/错误处理     |
| explore.txt                     | explore agent            | 19 行   | 搜索角色定义/工具使用指南           |
| core/plugin/agent.ts PROMPT\_\* | compaction/title/summary | ～50 行 | 内联文本                            |

### 1.4 缺失项

- **build**：无独立协议文档，无行为约束，无输出格式要求
- **plan**：无独立协议文档，无规划输出格式要求
- **general**：无独立协议文档，无任务分解约定
- **agent-level AGENTS.md**：无 agents 目录统一入口

---

## 二、核心设计原则

### 2.1 架构分层

```
Layer 3: Dynamic Context  ─── delegation-protocol 工具（已存在，需增强）
Layer 2: Protocol Card    ─── 软约束，按需加载（本次新增）
Layer 1: Agent Card       ─── 元数据声明（本次新增）
Layer 0: Permission       ─── 硬约束（已存在，不动）
```

### 2.2 设计约束

1. **不是 AGENTS.md，是 protocol card** — 每张卡片 10-25 行，聚焦单一职责
2. **不是全量注入，是按需触发** — meta agent 仅复杂任务（complexity === complex）时注入
3. **Rule of Three** — 智能体连续 3 次犯同一错才沉淀为协议规则
4. **硬约束在 Permission，软约束在 Protocol** — 权限系统管"能不能"，协议管"怎么做"
5. **卡片与源码同目录版本化** — 跟随子智能体代码一起变更

---

## 三、协议卡片设计

### 3.1 Agent Card（元数据 JSON）

每个子智能体对应一份 `agent.json`，声明智能体的元信息供 meta agent 发现和匹配：

```json
{
  "name": "build",
  "mode": "primary",
  "description": "The default agent. Executes tools based on configured permissions.",
  "capabilities": ["code_modification", "configuration"],
  "constraints": [],
  "protocol": "build"
}
```

### 3.2 Protocol Card（协议 Markdown）

每个子智能体对应一份 `protocol.md`，定义软约束和行为规范。

#### build/protocol.md

```markdown
## build protocol

- Role: implement code changes, run tests, fix issues
- Always check existing code conventions before writing new code
- Verify with tests: run test suite after changes
- Report: list files changed + test results + any warnings
- Do NOT: add comments unless existing code uses them
```

#### explore/protocol.md

```markdown
## explore protocol

- Role: search, read, and analyze codebase
- Use glob/grep for search, read for file content
- Report: file paths as absolute paths, summary of findings
- Do NOT: create or modify any files
- Do NOT: run bash commands that modify system state
```

#### plan/protocol.md

```markdown
## plan protocol

- Role: analyze requirements, design architecture, create implementation plan
- Output format: structured plan with steps, dependencies, file lists
- Scope: read-only analysis, no code modification
- When complete: present plan for user approval
```

#### general/protocol.md

```markdown
## general protocol

- Role: research, multi-step tasks, parallel execution
- Break complex tasks into independent units
- Report: per-unit status (completed/failed/skipped)
- Do NOT: use todo_write tool
```

---

## 四、实施路线图

### Phase 1：协议卡片创建（3 天）

#### Day 1：建立目录结构 + Agent Card

```
packages/aigcfroge/src/agent/
├── agents.json            ← 统一索引（所有智能体元数据）
├── build/
│   └── agent.json         ← build 元数据
├── explore/
│   └── agent.json
├── plan/
│   └── agent.json
└── general/
    └── agent.json
```

**具体操作**：

1. 创建 `packages/aigcfroge/src/agent/agents.json` — 包含所有子智能体元数据索引
2. 为 build/explore/plan/general 各创建 `agent.json`
3. 类型定义：`packages/aigcfroge/src/agent/protocol.ts`
4. 编写单元测试验证 JSON 结构与预期一致

#### Day 2：Protocol Card 内容

```
packages/aigcfroge/src/agent/
├── build/protocol.md
├── explore/protocol.md
├── plan/protocol.md
└── general/protocol.md
```

1. 为 build/explore/plan/general 各编写 protocol.md（10-25 行）
2. 内容来源：现有权限配置 + 系统提示词 + 行为观察
3. 编写测试验证每个 protocol.md 包含 `## Role` 节且 ≤ 25 行

#### Day 3：Agent Card 解析器

1. 创建 `packages/aigcfroge/src/agent/protocol.ts`，定义类型和加载函数
2. 实现 `loadAgentCard(name: string): AgentCard` — 读取 JSON 元数据
3. 实现 `loadProtocolCard(name: string): string` — 读取 Markdown 协议
4. 编写测试覆盖：卡片存在性、格式正确性

### Phase 2：delegation-protocol 工具增强（2 天）

#### Day 4：工具参数扩展

在 `generate_delegation_protocol` 工具中新增：

- `include_protocol`（可选 boolean，默认 false）— 是否注入协议卡片
- `agent_card`（自动读取）— 注入目标引擎的 Agent Card 元数据

#### Day 5：协议注入逻辑

1. 当 `include_protocol === true` 时，自动读取目标引擎的 `protocol.md`
2. 将协议内容追加到 delegation protocol 文档末尾
3. 更新 meta.txt 的 Delegation Protocol 节：说明何时设置 `include_protocol`

### Phase 3：机械化验证（1 天）

#### Day 6：验证脚本

1. 创建 `scripts/check-agent-protocols.sh`：

```bash
# C1: 所有 V1 注册的 subagent 必须有 agent.json
# C2: 每个 agent.json 的 name 字段与注册表中的 agents 记录一致
# C3: 每个 agent.json 对应的 protocol.md 存在
# C4: protocol.md 包含 ## Role 节
# C5: protocol.md 不超过 25 行
```

2. 集成到 CI（`.github/workflows/consistency.yml`）
3. 可选的 pre-commit hook

### Phase 4：meta.txt 同步更新（0.5 天）

#### Day 7

1. meta.txt Available Subagents 节改为动态引用 Agent Card
2. Delegation Protocol 节增加 protocol card 注入说明
3. 更新 meta-agent.test.ts 验证内容

---

## 五、文件变更清单

| 操作 | 文件                               | 阶段 | 用途                                  |
| ---- | ---------------------------------- | ---- | ------------------------------------- |
| 新建 | `src/agent/agents.json`            | P1   | 子智能体统一元数据索引                |
| 新建 | `src/agent/build/agent.json`       | P1   | build 智能体卡片                      |
| 新建 | `src/agent/build/protocol.md`      | P1   | build 协议                            |
| 新建 | `src/agent/explore/agent.json`     | P1   | explore 智能体卡片                    |
| 新建 | `src/agent/explore/protocol.md`    | P1   | explore 协议                          |
| 新建 | `src/agent/plan/agent.json`        | P1   | plan 智能体卡片                       |
| 新建 | `src/agent/plan/protocol.md`       | P1   | plan 协议                             |
| 新建 | `src/agent/general/agent.json`     | P1   | general 智能体卡片                    |
| 新建 | `src/agent/general/protocol.md`    | P1   | general 协议                          |
| 新建 | `src/agent/protocol.ts`            | P1   | 卡片类型定义 + 加载器                 |
| 修改 | `src/tool/delegation-protocol.ts`  | P2   | 增加 include_protocol/agent_card 参数 |
| 修改 | `src/agent/prompt/meta.txt`        | P4   | 同步更新协议引用                      |
| 新建 | `scripts/check-agent-protocols.sh` | P3   | 机械验证脚本                          |
| 新建 | `test/agent/protocol.test.ts`      | P3   | 协议卡片格式测试                      |

---

## 六、与现有系统集成

### 6.1 meta agent 调用流程（更新后）

```
用户: "修复登录页的复杂 bug"

Meta Agent:
  1. classify → code_modification, complexity=complex
  2. call generate_delegation_protocol({
       engine: "build",
       task_description: "修复登录页的 bug",
       include_protocol: true,        // ← 新增：复杂任务注入协议
       files: "src/pages/login.tsx",
       constraints: "保持 API 签名不变"
     })
     ← 输出:
        Project: /path
        Task: 修复登录页的 bug
        Engine: build
        ...
        --- build protocol ---
        Role: implement code changes, run tests...
        ...
  3. task({ subagent_type: "build", prompt: <协议文本> })
```

### 6.2 复杂度决定策略

| 复杂度   | include_protocol | 说明                                         |
| -------- | ---------------- | -------------------------------------------- |
| simple   | false            | 直接传 prompt，不注入协议                    |
| moderate | false            | delegate protocol 含约束但不含 protocol card |
| complex  | true             | 完整协议：delegate protocol + protocol card  |

---

## 七、验证标准

### 7.1 每阶段出口标准

**Phase 1 出口**：

- ✅ 所有 4 个子智能体（build/explore/plan/general）有 `agent.json`
- ✅ 所有 4 个子智能体有 `protocol.md`
- ✅ `protocol.ts` 类型定义通过 typecheck
- ✅ 单元测试验证 JSON 与 Markdown 格式

**Phase 2 出口**：

- ✅ `generate_delegation_protocol` 参数扩展通过 typecheck
- ✅ 复杂任务能正确注入 protocol.md
- ✅ 简单任务跳过 protocol 注入
- ✅ 集成测试验证完整调用链

**Phase 3 出口**：

- ✅ `scripts/check-agent-protocols.sh` 零失败
- ✅ CI 中集成

**Phase 4 出口**：

- ✅ meta.txt L1 SHA256 锁定测试通过
- ✅ meta-agent.test.ts 全部通过
- ✅ agent.test.ts 全部通过（43 tests）

### 7.2 全量验证命令

```bash
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge test --timeout 30000
scripts/check-agent-protocols.sh
```

---

## 八、参考

- [现有 meta agent 系统提示词](../../packages/core/src/plugin/agent.ts)
- [现有 delegation-protocol 工具](../../packages/aigcfroge/src/tool/delegation-protocol.ts)
- [现有 context-builder 模板](../../packages/aigcfroge/src/agent/meta/context-builder.ts)
- [V1 agent 注册表](../../packages/aigcfroge/src/agent/agent.ts)
- [V2 agent 注册表](../../packages/core/src/plugin/agent.ts)
- [Harness Engineering 学习指南](https://github.com/deusyu/harness-engineering)
- [AI 智能体协议研究白皮书](../research/industry/AI智能体协议研究.md)
