# Cherry-Studio 2.0.0 反编译分析报告

> **文档性质：非规范性研究材料（NON-NORMATIVE）**
> 本文是竞品反编译分析，非 AigcForge 已批准的 PRD/ADR。借鉴点进入 `docs/prd/`、`docs/architecture/adr/` 或代码前，必须依据当前一手来源、仓库实现和 owner 评审重新核验。
> 日期：2026-08-07
> 对标：[Accio 竞品反编译分析报告](Accio竞品反编译分析报告.md)、[Antigravity 反编译分析报告](Antigravity反编译分析报告.md)

---

## 1. 产品身份

| 项       | 值                                                                                        |
| -------- | ----------------------------------------------------------------------------------------- |
| 产品     | Cherry-Studio（开源 AI 桌面客户端，CherryHQ）                                             |
| 版本     | 2.0.0（v2 重构）/ 源码 1.2.2（2025-04 main 分支）                                         |
| 形态     | Electron + React + Vite                                                                   |
| 数据层   | **Drizzle + SQLite**（与 AigcForge 同栈）                                                 |
| RAG      | `@cherrystudio/embedjs`（自家库，多 loader）                                              |
| 通信     | **SSE**（EventSource + text/event-stream）                                                |
| 本地路径 | `/opt/Cherry Studio/`（安装）、`/home/keer/Downloads/Cherry-Studio-2.0.0-amd64.deb`（包） |
| 配置     | `/home/keer/.config/CherryStudio/`（含 cherrystudio.sqlite）                              |

---

## 2. 反编译方法

```bash
# 1. 解压 deb 包
dpkg-deb -x Cherry-Studio-2.0.0-amd64.deb /tmp/cherry-studio-2.0.0
# -> /tmp/cherry-studio-2.0.0/opt/Cherry Studio/resources/app.asar

# 2. 解包 app.asar
asar extract "resources/app.asar" /tmp/cs2-asar
# -> out/main/, out/renderer/, migrations/, resources/

# 3. 读数据模型（SQL 可读）
cat resources/migrations/sqlite-drizzle/0000_*.sql

# 4. 读 provider 配置（JSON 可读）
cat resources/provider-registry/providers.json

# 5. grep main.js 关键逻辑（minified，字符串提取）
grep -oE "EventSource|toolCallDelta|AgentSession|knowledge|rag|embedding" out/main/main.js | sort | uniq -c
```

**关键限制**：out/main/main.js 是 Vite 打包的 minified JS，只能 grep 字符串常量，无法还原完整逻辑。数据模型 + provider 配置是可读的 SQL/JSON，能反映架构。

---

## 3. 架构

| 层       | 技术                    | 证据                                                          |
| -------- | ----------------------- | ------------------------------------------------------------- |
| 主进程   | Electron + Node         | `out/main/main.js`                                            |
| 渲染进程 | React + Vite            | `out/renderer/`（assets + windows）                           |
| 数据层   | Drizzle + SQLite        | `migrations/sqlite-drizzle/`（0000-0005）                     |
| LLM 通信 | **SSE**（EventSource）  | main.js: EventSource 88 + onmessage 35 + text/event-stream 31 |
| RAG      | `@cherrystudio/embedjs` | 多 loader（csv/image/markdown/msoffice/pdf/web/xml/sitemap）  |
| MCP      | MCP 客户端              | main.js: mcp 1023 次 + `mcp-install` UI                       |

---

## 4. 核心功能模块

| 模块                | 证据（renderer assets / main.js grep）                                                       | 说明                       |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| **Agent**           | `agent`/`agents`/`agentSession`/`AgentFileDiffRenderer` + main.js agent 3520 次              | AgentSession 为核心        |
| **知识库 RAG**      | `knowledge`/`knowledgeFileEntry` + chunk 7519 / rag 1130 / embedding 628 / KnowledgeBase 287 | 重度 RAG，多 loader        |
| **MCP**             | `mcp`/`mcp-install`/`McpServerFields`/`mcpToolName` + 1023 次                                | MCP 客户端 + 安装 UI       |
| **SSE 流式**        | EventSource 88 + onmessage 35 + `data: toolCallDelta`                                        | 真 SSE，含流式工具调用增量 |
| **多 LLM Provider** | `provider-registry/`（providers.json + models.json + provider-models.json）                  | 一个 provider 多协议       |
| **快捷助手**        | `windows/quickAssistant`                                                                     | 类 Spotlight 快捷入口      |
| **选中文本操作**    | `windows/selection`                                                                          | 划词操作                   |
| **多窗口**          | `windows/main`/`subWindow`/`migrationV2`/`userDataRelocation`                                | 多窗口架构                 |
| **Agent File Diff** | `AgentFileDiffRenderer`                                                                      | Agent 文件变更 diff 渲染   |

---

## 5. 数据模型（agent 表为核心）

```sql
agent:
  ├─ id / type / name / description / instructions
  ├─ model / plan_model / small_model     ← 多模型分级（规划/小任务用不同模型）
  ├─ disabled_tools / configuration / order_key
  └─ created_at / updated_at / deleted_at

agent_channel:                            ← Agent 多平台消息通道
  ├─ type: telegram | feishu | qq | wechat | discord | slack  ← 6 平台
  ├─ permission_mode: default | acceptEdits | bypassPermissions | plan  ← 权限模式
  ├─ agent_id / session_id / workspace
  └─ active_chat_ids / config

agent_channel_task:                       ← Agent 定时任务（多对多 job_schedule）
agent_global_skill:                       ← 全局技能（folder_name）
```

### 5.1 关键设计

- **Agent 多模型分级**（model + plan_model + small_model）：主模型 + 规划模型 + 小任务模型，按任务复杂度选模型降成本
- **Agent 多平台消息**（6 平台）：telegram/feishu/qq/wechat/discord/slack，Agent 绑定消息通道
- **permission_mode**：default/acceptEdits/bypassPermissions/plan（类似 Claude Code 权限模式）
- **Agent 定时任务**：agent_channel_task 多对多 job_schedule

---

## 6. Provider 多协议适配

```json
{
  "id": "cherryin",
  "defaultChatEndpoint": "openai-chat-completions",
  "endpointConfigs": {
    "anthropic-messages": { "adapterFamily": "cherryin", "baseUrl": "https://open.cherryin.net" },
    "google-generate-content": { "adapterFamily": "cherryin", "baseUrl": "..." },
    "openai-chat-completions": {
      "adapterFamily": "cherryin",
      "reasoningFormat": { "type": "openai-chat" }
    }
  }
}
```

**一个 provider 支持多 endpoint 协议**：

- `anthropic-messages`（Claude API 格式）
- `google-generate-content`（Gemini API 格式）
- `openai-chat-completions`（OpenAI API 格式）
- `adapterFamily` 统一路由（aggregator 如 cherryin 可多协议转发）
- `reasoningFormat` 控制推理输出格式

---

## 7. SSE 流式实现

```
EventSource / fetchEventSource
  ├─ onmessage: data: ctx.data / data: toolCallDelta  ← 流式工具调用增量
  ├─ onerror: 140 次（错误处理）
  └─ data: { [providerOptionsName]: ... }  ← provider 选项透传
```

- `toolCallDelta` = 流式工具调用增量（类似 Antigravity 的 `PartialArg.GetDelta`）
- 用 SSE `data:` 行传输 JSON 增量
- provider 选项经 `providerOptionsName` 透传

---

## 8. 借鉴点（对 AigcForge，按优先级）

| #      | 能力                                                  | 优先级 | AigcForge 现状                  | 借鉴价值                                                             |
| ------ | ----------------------------------------------------- | ------ | ------------------------------- | -------------------------------------------------------------------- |
| **C1** | Agent 多模型分级（model/plan_model/small_model）      | **P1** | 一个 agent 一个 model           | 按 task 复杂度用不同模型（plan 强模型，小任务便宜模型），降成本      |
| **C2** | 知识库 RAG（embedjs 多 loader）                       | **P1** | 无知识库（只有 System Context） | pdf/csv/image/markdown/web loader + 向量检索，AigcForge 缺失能力     |
| **C3** | Provider 多协议适配                                   | P2     | provider 单一协议               | 一个 provider 支持 anthropic/google/openai 多协议（aggregator 路由） |
| **C4** | Agent 多平台消息（6 平台）                            | P2     | 无                              | telegram/feishu/qq/wechat/discord/slack（比 Accio 4 平台更全）       |
| **C5** | permission_mode（plan/acceptEdits/bypassPermissions） | P2     | PermissionV2 无模式概念         | plan 模式（只规划不执行）类似 Claude Code                            |
| **C6** | SSE toolCallDelta                                     | P3     | EventV2 + 工具一次性            | 流式工具调用增量（与 Antigravity B1 一致）                           |
| **C7** | Agent 定时任务（agent_channel_task + job_schedule）   | P3     | Todo M3 计划要做                | 已在 AigcForge 路线图（Todo M3 ScheduledJob）                        |

### 8.1 C1 详解：Agent 多模型分级

Cherry-Studio 的 agent 表有 `model`（主）+ `plan_model`（规划）+ `small_model`（小任务）。

**AigcForge 映射**：当前 `packages/core/src/agent.ts` 的 agent 绑定单一 model。借鉴：

- agent schema 加 plan_model / small_model
- TaskDriver 委派时按任务复杂度选模型（plan 用强模型，子任务用小模型）
- 降成本（小任务不浪费强模型 token）

### 8.2 C2 详解：知识库 RAG

Cherry-Studio 用 `@cherrystudio/embedjs`（自家 RAG 库）+ 多 loader（pdf/csv/image/markdown/msoffice/web/xml/sitemap）+ SQLite 向量存储。

**AigcForge 映射**：当前有 System Context（文件树/git status/workspace），但无文档知识库 RAG。借鉴：

- 新增知识库子系统（`packages/core/src/knowledge/`）
- 文档加载 + 分块 + 嵌入 + 向量检索
- 作为 Context Source 接入 System Context algebra

---

## 9. 三竞品对比

| 维度          | Accio（玄机）               | Antigravity（Google）     | Cherry-Studio 2.0.0                    | AigcForge            |
| ------------- | --------------------------- | ------------------------- | -------------------------------------- | -------------------- |
| 通信协议      | Electron IPC + SSE          | MCP JSON-RPC + gRPC       | **SSE（EventSource）**                 | EventV2 + HTTP API   |
| 流式工具调用  | -                           | PartialArg.GetDelta       | **toolCallDelta**                      | 一次性               |
| Agent 模型    | 单模型                      | 单模型                    | **多模型分级（plan/small）**           | 单模型               |
| 多平台消息    | 4 平台（微信/企微/TG/飞书） | 无                        | **6 平台（+qq/discord/slack）**        | 无                   |
| 知识库 RAG    | 无                          | 无                        | **重度（embedjs 多 loader）**          | 无（System Context） |
| Provider 适配 | -                           | Gemini only               | **多协议（anthropic/google/openai）**  | AI SDK 多 provider   |
| 权限模式      | -                           | -                         | **plan/acceptEdits/bypassPermissions** | PermissionV2         |
| Task 进度     | 两段式宽度条                | CortexStep EventType      | AgentSession                           | 节点轨道脉冲（领先） |
| MCP           | -                           | MCP SDK                   | mcp-install UI                         | MCP V2               |
| 借鉴重点      | Task 体系（P0）             | 流式协议（P1 PartialArg） | **多模型分级 + 知识库（P1）**          | 各有互补             |

**三竞品定位**：

- Accio = **产品形态**（Task/Agent Hub/多平台）
- Antigravity = **协议底层**（gRPC/MCP/流式增量）
- Cherry-Studio = **功能广度**（多模型/多平台/知识库/MCP/SSE，开源全栈）

---

## 10. 与 M3 的关联

Cherry-Studio 的发现对 M3（图表 HTML 产出）关联**弱**：

- SSE/Agent/RAG 都不直接服务 M3 图表产出
- 但 C2 知识库 RAG 对 AigcForge 整体有高价值（缺失能力，非 M3 范围）

**结论**：Cherry-Studio 借鉴点主要在 **Agent 多模型分级（C1）+ 知识库 RAG（C2）**，与 M3 关联弱，但对 AigcForge 中长期演进有价值。

---

## 11. 文件清单（反编译产物索引）

### 安装包结构（/opt/Cherry Studio/）

```
resources/
  app.asar                    Electron 应用本体（2.0.0）
  app.asar.unpacked/           原生模块（better-sqlite3/font-list/registry-js/selection-hook）
  provider-registry/           LLM provider 配置
    providers.json             provider 列表（多协议适配）
    models.json                模型列表
    provider-models.json       provider-model 映射
  migrations/sqlite-drizzle/   数据库迁移（0000-0005 + meta）
  app-update.yml               自动更新
```

### app.asar 解包结构（/tmp/cs2-asar/）

```
out/
  main/                       主进程（main.js + chunk + readableContentWorker）
  preload/                    预加载
  renderer/
    assets/                   React 组件 + 图标（agent/agents/agentSession/knowledge/mcp/chat）
    windows/                  多窗口（main/quickAssistant/selection/subWindow/migrationV2/userDataRelocation）
migrations/                   数据库迁移（同 resources/migrations）
resources/                    内置资源
v2-refactor-temp/             v2 重构临时
node_modules/                 依赖
```

### 关键数据文件

```
/home/keer/.config/CherryStudio/
  cherrystudio.sqlite          用户数据库（agent/session/knowledge 等）
```

---

## 12. 关联文档

- [Accio 竞品反编译分析报告](Accio竞品反编译分析报告.md) - 对标竞品（产品形态借鉴）
- [Antigravity 反编译分析报告](Antigravity反编译分析报告.md) - 对标竞品（协议底层借鉴）
- [Work M3 调研报告](plan/work-mode-m3-research.md) - M3 图表 HTML（关联弱）
- [Todo/Task 升级计划](plan/todo-task-system-upgrade.md) - C7 定时任务借鉴落点
- [ARCHITECTURE.md](ARCHITECTURE.md) §4.5 - Provider/Model Catalog（C3 多协议借鉴落点）
- [ARCHITECTURE.md](ARCHITECTURE.md) §4.2 - System Context（C2 知识库 RAG 借鉴落点）
