# Antigravity (Google) 反编译分析报告

> **文档性质：非规范性研究材料（NON-NORMATIVE）**
> 本文是竞品反编译分析，非 AigcForge 已批准的 PRD/ADR。借鉴点进入 `docs/prd/`、`docs/architecture/adr/` 或代码前，必须依据当前一手来源、仓库实现和 owner 评审重新核验。
> 日期：2026-08-07
> 对标：[Accio 竞品反编译分析报告](Accio竞品反编译分析报告.md)

---

## 1. 产品身份

| 项 | 值 |
|---|---|
| 产品 | Google Antigravity（AI IDE，基于 Gemini） |
| 形态 | Electron 桌面应用（x64） |
| 本地路径 | `/home/keer/opt/Antigravity-x64/` |
| 核心二进制 | `resources/bin/language_server`（Go 编译，157MB，stripped） |
| 启动器壳 | `resources/app.asar`（2.1M，仅 Electron 主进程） |

---

## 2. 反编译方法

```bash
# 1. 识别文件类型
file resources/bin/language_server
# -> ELF 64-bit LSB pie executable, x86-64, Go binary, stripped

# 2. 解包启动器壳（仅主进程，无智能体逻辑）
asar extract resources/app.asar /tmp/antigravity-asar
# -> /dist/main.js, /dist/languageServer.js, /dist/ipcHandlers.js（启动器，无 SSE）

# 3. strings 提取 Go 二进制符号（主智能体逻辑在 language_server）
strings resources/bin/language_server | grep -iE "sse|event-stream|gemini|tool_go_proto|cortex|mcp"
# -> 无 SSE 文本格式；命中 gRPC protobuf + MCP SDK + Gemini proto
```

**关键限制**：language_server 是 stripped Go 二进制，strings 只能提取符号名/字符串常量，无法还原完整逻辑。本报告基于符号名 + protobuf 定义推断。

---

## 3. 架构（协议栈）

Antigravity **不用 SSE**。流式输出靠 gRPC 双向流 + protobuf。

| 层 | 协议 | 通信方 | 证据（符号） |
|---|---|---|---|
| 本地 | **MCP JSON-RPC 2.0** | language_server ↔ Electron | `modelcontextprotocol/go_sdk/v0/internal/jsonrpc2` |
| 远程 | **gRPC streaming** | language_server ↔ Google Cloud AI Platform | `grpc.(*Server).processStreamingRPC`, `MethodDescriptorProto.GetServerStreaming` |
| 数据 | **protobuf** | Gemini API proto | `google3/google/cloud/aiplatform/master/tool_go_proto` |

**grep `text/event-stream` / `data: ` / `event: ` 全无命中** -- 确认非 SSE。

---

## 4. 智能体输出格式（4 类事件语义）

### 4.1 PartialArg · 流式工具调用增量（最有价值）

```
FunctionCall.GetPartialArgs  -> PartialArg
PartialArg:
  ├─ GetJsonPath    (增量在 JSON 参数中的定位路径)
  ├─ GetDelta       (增量值)
  └─ GetNullValue / GetNumberValue / GetStringValue / GetBoolValue (增量值类型)
```

**语义**：工具调用参数**分块流式发送**，每块含 JsonPath（定位）+ Delta（增量值）。类似 JSON Patch 增量模式。

**场景**：长参数工具（如 write 大文件、生成大段代码）分块流式，减少用户等待感。

### 4.2 ThoughtSummaryContent · 思考摘要（含图片）

```
google3/learning/genai/api/interactions/proto/content_go_proto.ThoughtSummaryContent
  ├─ GetText   (思考文本)
  └─ GetImage  (思考图片)
```

**语义**：Gemini 的思考过程输出，**支持图片**（思考过程可含截图/图表）。

### 4.3 CortexStep · 智能体步骤事件

```
google3/third_party/jetski/cortex_pb/cortex_go_proto.CortexStepSystemMessage
  ├─ GetEventType    (步骤事件类型)
  └─ GetEventSource  (事件来源)
UserGrepStepCreationOptions.GetNumSearchEvents  (grep 步骤 = 代码搜索)
```

**语义**：智能体执行步骤化，每步含 EventType（grep/edit/plan 等）+ EventSource。"jetski" 是 Google 内部代号，Cortex = 智能体引擎。

### 4.4 ComputerUse · 计算机使用工具

```
google3/google/cloud/aiplatform/master/tool_go_proto.Tool_ComputerUse
  ├─ Environment    (环境类型)
  └─ SafetyPolicy   (安全策略)
```

**语义**：屏幕截图 + 鼠标 + 键盘控制（类似 Claude computer use）。

---

## 5. 借鉴点（对 AigcForge，按优先级）

| # | 能力 | 优先级 | AigcForge 现状 | 借鉴价值 |
|---|---|---|---|---|
| **B1** | PartialArg 流式工具调用 | **P1** | 工具参数一次性（`Tool.execute(input)` 全量） | 长参数工具（write 大文件）流式，减少等待感 |
| **B2** | ThoughtSummaryContent 含图片 | P2 | reasoning part 纯文本 | 思考过程含截图/图表（M3 图表可嵌入思考） |
| **B3** | CortexStep EventType 维度 | P2 | ProgressLedger task 只有 status | 步骤加类型（grep/edit/plan），进度条更丰富 |
| **B4** | ComputerUse 工具 | P3 | 无 | Coding 模式远期增强（屏幕操作） |
| **B5** | MCP 作为本地协议 | P3 | 自有 EventV2 + HTTP API | 标准化（但已 EventV2，不改） |

### 5.1 B1 详解：PartialArg 流式工具调用

Gemini 的 FunctionCall 支持 PartialArgs，每个 PartialArg 携带 JsonPath + Delta，实现工具调用参数的增量流式。

**AigcForge 映射**：当前 `Tool.execute(input: Input)` 是一次性全量参数。若引入 PartialArg：
- `packages/core/src/tool/tool.ts` 的 Tool 类型可选支持 streaming input
- 适合 `write` / `edit` 等长参数工具（大段代码分块到达）
- 属于 LLM 层（`packages/llm`），非 Work 模式

**代价**：改 Tool 类型 + LLM 适配层 + UI 渲染流式参数。中等工作量。

### 5.2 B3 详解：CortexStep EventType

AigcForge M1.5 ProgressLedger 的 task steps 有 status（pending/in_progress/completed/failed），但无 EventType（步骤类型）。

**借鉴**：task 加 `type` 字段（grep/edit/plan/read/question 等），进度条可按类型着色/图标，用户更易识别当前在做什么。

**代价**：`SessionTask.Info` 加 type 字段（Schema 改动）+ UI 渲染。小工作量。

---

## 6. 与 Accio 竞品对比

| 维度 | Accio（玄机） | Antigravity（Google） | AigcForge |
|---|---|---|---|
| 通信协议 | Electron IPC + asar JS | MCP JSON-RPC + gRPC | EventV2 + HTTP API |
| 流式格式 | SSE（推测） | gRPC protobuf（PartialArg） | EventV2 stream |
| Task 进度 | 两段式比率宽度条（无脉冲） | CortexStep EventType | 节点轨道 + 位移脉冲（领先） |
| 智能体能力 | Task Spawn / 定时 / Skill per-Agent | ComputerUse / ThoughtSummary / PartialArg | TaskDriver 4 模式 / ProgressLedger |
| 借鉴重点 | Task 体系（P0 Spawn/定时） | 流式协议 + 思考含图（P1 PartialArg） | 各有互补 |

**关键差异**：
- Accio 偏**产品形态**（Task 体系 / Agent Hub / 多平台消息）
- Antigravity 偏**协议底层**（gRPC protobuf / MCP / 流式增量）
- AigcForge 的 EventV2 + 节点轨道脉冲在两者之间：UI 表达领先 Accio，协议层可借鉴 Antigravity

---

## 7. 与 M3 的关联

Antigravity 的发现对 M3（图表 HTML 产出）关联**间接偏弱**：

| Antigravity 能力 | 对 M3 的启发 | 强度 |
|---|---|---|
| ThoughtSummaryContent 含图片 | M3 图表可作为思考过程一部分（LLM 思考时生成图表） | 弱（远期，M3 先做交付物图表） |
| PartialArg 流式 | M3 图表 HTML 大时流式传输 | 弱（M3 候选稿已流式，影响小） |
| CortexStep EventType | M3 步骤化图表生成加类型 | 弱（M1.5 ProgressLedger 已够） |

**结论**：Antigravity 借鉴点主要在**协议层**（PartialArg / ThoughtSummary），与 M3（图表 HTML 产出）关联弱。M3 真实需求仍聚焦 L1（Mermaid 内嵌）+ L2（独立 HTML），见 [M3 调研报告](plan/work-mode-m3-research.md)。

---

## 8. 文件清单（反编译产物索引）

### 启动器壳（app.asar，2.1M）
```
/tmp/antigravity-asar/dist/
  main.js                 Electron 主进程入口
  languageServer.js       language_server 启动/管理
  ipcHandlers.js          IPC 处理
  preload.js              预加载
  services/settingsService.js  设置服务
  ideInstall/             IDE 安装向导
  tray.js / menu.js / updater.js  托盘/菜单/更新
```

### 核心二进制（language_server，157MB Go）
```
resources/bin/language_server  Go 编译，stripped
  ├─ MCP JSON-RPC 2.0 SDK   (modelcontextprotocol/go_sdk)
  ├─ gRPC streaming          (grpc.processStreamingRPC)
  ├─ Gemini protobuf         (google/cloud/aiplatform/master/tool_go_proto)
  │   ├─ PartialArg          (流式工具调用增量)
  │   ├─ FunctionCall/Response (工具调用/响应)
  │   └─ Tool_ComputerUse    (计算机使用工具)
  ├─ ThoughtSummaryContent   (learning/genai/api/interactions/proto)
  └─ CortexStep              (jetski/cortex_pb，智能体步骤事件)
```

### 其他资源
```
resources/bin/webm_encoder   WebM 视频编码器
resources/app.asar.unpacked/node_modules/chrome-devtools-mcp  Chrome DevTools MCP
```

---

## 9. 关联文档

- [Accio 竞品反编译分析报告](Accio竞品反编译分析报告.md) - 对标竞品（产品形态借鉴）
- [Work M3 调研报告](plan/work-mode-m3-research.md) - M3 图表 HTML 可行性（关联弱）
- [Todo/Task 升级计划](plan/todo-task-system-upgrade.md) - B3 CortexStep EventType 借鉴落点
- [ARCHITECTURE.md](ARCHITECTURE.md) §4.4 - Tool Registry（B1 PartialArg 借鉴落点）
