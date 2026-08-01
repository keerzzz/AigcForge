# Accio (Xuanji/玄机) 竞品反编译分析报告

> 状态：**Reference** — 竞品情报参考，供多份 PRD/Plan 引用
> 日期：2026-07-31
> 来源：`Accio-0.26.1-20260727-2239-win_e8855046.exe` (227MB, Nullsoft NSIS 3.04)
> 下次更新：Accio 发布新版本时

---

## 1. 产品身份

| 维度 | 信息 |
|---|---|
| **外部品牌** | Accio (`accio.com` · `accio-ai.com` · `aimode.alibaba.com`) |
| **内部代号** | `@phoenix/desktop` v0.26.1 |
| **中文品牌** | **Xuanji（玄机）** — Board Home: "欢迎来到玄机 — 描述你的任务，开始在隔离环境中会话" |
| **下载通道** | `beta-win` (`work-download.accio-ai.com/package/`) |
| **技术栈** | Electron (rolldown 打包) + React + TypeScript + Node.js v20.12 |
| **核心模块** | `@phoenix/agent-runtime` + `@phoenix/llm` + `@ali/accio-adk-ts` (Agent Dev Kit) |
| **安装器** | Nullsoft NSIS 3.04，227MB |
| **更新时间** | 2026-07-27 |

---

## 2. 反编译方法

```bash
# 1. 识别文件类型
file Accio-0.26.1-win_e8855046.exe
# → PE32 executable, Nullsoft Installer self-extracting archive

# 2. 解压 NSIS 安装包
7za x Accio-0.26.1-win_e8855046.exe -o/tmp/accio_extract -y
# → 624 files, 121 folders

# 3. 定位 Electron 应用
ls /tmp/accio_extract/resources/
# → app.asar (174MB), accio-mcp-cli/, chrome-extension/, pre-install/

# 4. 解包 ASAR
npx @electron/asar extract app.asar /tmp/accio_asar
# → node_modules/, out/, package.json

# 5. 分析编译产物
# out/main/ — 主进程 (Electron main process)
# out/renderer/ — 渲染进程 (React UI)
# out/preload/ — 预加载脚本
```

---

## 3. 功能架构

### 3.1 核心模块清单

| 模块 | 文件/路径 | 功能 |
|---|---|---|
| **Agent Hub** | `out/renderer/assets/agent-hub-page-*.js` | 智能体中心：我的智能体 + 任务衍生 + 新建 |
| **Agent 创建向导** | `out/renderer/assets/create-agent-wizard-*.js` | 分步引导式 Agent 创建 |
| **Agent 管理** | `out/main/chunks/agent-store-*.js` | Agent 持久化存储 |
| **Agent Skill 管理** | `out/main/chunks/agent-skill-manager-*.js` | Skill per-Agent 安装/启用 |
| **子 Agent 会话** | `out/main/chunks/subagent-session-store-*.js` | 子 Agent 会话存储 |
| **内置命令** | `out/main/chunks/builtin-accio-*.js` | 内置工具注册 |
| **函数工具** | `out/main/chunks/function-tools-*.js` | 动态工具注册 (Plugin 通道) |
| **Session 工具** | `out/main/chunks/session-tools-*.js` | 会话级工具管理 |
| **工具注册表** | `out/main/chunks/load-tool-registry-*.js` | 工具加载与注册 |
| **工具结果清理** | `out/main/chunks/tool-result-cleanup-*.js` | 工具结果生命周期管理 |
| **团队聊天** | `out/main/chunks/team-chat-*.js`, `team-context-*.js` | 团队协作 + TL 角色 |
| **浏览器 Relay** | `resources/chrome-extension/accio-browser-relay/` | Chrome CDP 远程控制 |
| **MCP CLI** | `resources/accio-mcp-cli/accio-mcp.mjs` | MCP 协议客户端 (Bun 运行) |
| **远程工具** | `resources/remote-tools.json` | 预装依赖下载配置 (Python/Git/Node/Lark) |
| **跨平台集成** | `out/main/chunks/wecom-*.js`, `weixin-*.js`, `telegram-*.js`, `lark-*.js` | 微信/企微/Telegram/飞书四通道 |
| **截图** | `out/main/chunks/capture-*.js` | 屏幕/页面捕获 |
| **Agent 活动岛** | `out/renderer/assets/agent-activity-island-*.js` | Agent 实时状态浮层 |
| **Workspace** | `out/renderer/assets/workspace-*.js`, `workspace-office-preview-*.js` | 工作区 + Office 预览 |
| **Worktree** | `out/renderer/assets/worktree-handoff-store-*.js`, `worktree-quiescence-*.js` | Git worktree 管理 |

### 3.2 预装依赖

`resources/pre-install/`:
- Node.js v20.12.0 (win-x64)
- Python 3.12.2 (win-amd64)
- Portable Git 2.44.0 (64-bit)
- Lark CLI 1.0.0 (飞书命令行, win-amd64)
- zip.exe (压缩工具)

---

## 4. 核心差异化能力详解

### 4.1 任务衍生 (Task Spawn) — P0 借鉴

```
Agent Hub 三区结构:
┌─────────────────────────────────────────────────┐
│  智能体 (Agents)                                 │
│  ┌──────────────┬──────────────┬──────────────┐ │
│  │ 我的智能体    │ 任务衍生      │ 新建智能体    │ │
│  │ (手动创建)    │ (对话自动)    │ (Wizard)      │ │
│  └──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────┘

关键行为:
- 群聊中对话内容自动触发 Agent 创建
- 衍生 Agent 出现在 "任务衍生" tab
- 用户不需要手动创建 Agent，Agent 从任务中自然生长
```

**AigcForge 映射**: TaskDriver 创建子会话完成后，用户可选择 "存为 Agent"——将一次性子会话升级为持久化 Agent。

### 4.2 定时任务 (Scheduled Jobs) — P0 借鉴

```
Agent 删除确认弹窗:
  "删除「{name}」？"
  "将同时删除："
  "  · {count} 个会话"
  "  · {count} 个定时任务"     ← 关键：Agent 拥有定时任务
  "删除后无法恢复。"

推断模型:
  Agent
    ├─ 对话能力 (Session)
    ├─ Skills (per-Agent 安装)
    └─ ScheduledJobs (per-Agent 定时执行)
         ├─ cron 表达式
         ├─ prompt (执行内容)
         ├─ lastRun / nextRun
         └─ status: scheduled | running | completed | failed
```

**AigcForge 映射**: `packages/core/src/session/scheduled-job.ts` (待建)——通用 cron 调度引擎，消费方包括 Assistant(提醒)、Work(周报)、电商(巡检)。

### 4.3 Skill per-Agent 管理 — P1 借鉴

```
agent-skill-manager 从 UI 字符串逆向推断:

UI 文本 (agents-*.js):
  "管理技能" (Manage Skills)
  "官方" (Official)     ← 官方 Skills
  "个人" (Personal)     ← 用户自定义 Skills
  "搜索技能..." (Search Skills...)
  "未找到技能" (No skills found)
  "无启用的技能" (No enabled skills)
  "无可用技能" (No skills available)

Plugin 文本 (chat-*.js):
  "{count} 安装的插件" (Installed plugins)
  "按 Agent" (by Agent)
  "仅当前会话" (Session-scoped)
  "Team Leader (TL) 协调且不使用插件"
```

**AigcForge 映射**: 当前 Skill Guidance 是只读 playbook（prompt 注入），无安装/启用/禁用机制。需要引入 Agent 级 Skill registry。

### 4.4 Board Home 任务驱动入口 — P2 借鉴

```
Board Home UI (chat-*.js, 德语 locale):
  "Willkommen bei Xuanji — beschreiben Sie Ihre Aufgabe,
   um eine Sitzung in isolierter Umgebung zu starten"

翻译: "欢迎来到玄机 — 描述你的任务，开始在隔离环境中会话"

关键设计:
- 入口不是 Session 列表，而是任务描述输入框
- 输入任务 → 系统自动创建 Session（隔离环境）
- 任务驱动，非会话驱动
```

### 4.5 Chrome CDP Relay — P3 参考

```
Chrome Extension: Accio Browser Relay v0.2.1
权限: debugger, tabs, tabGroups, windows, activeTab, scripting, storage, alarms, notifications
Host: <all_urls>

CDP 通道:
  WebSocket relay → Tab management → CDP event dispatch

外部连接域:
  accio.com, aimode.alibaba.com (及 pre/local 子域)
```

### 4.6 多平台消息通道 — P3 参考

| 平台 | 文件 | 说明 |
|---|---|---|
| 微信 | `weixin-*.js` | 个人微信接入 |
| 企业微信 | `wecom-*.js` | 企业微信接入 |
| Telegram | `telegram-*.js` | Telegram Bot 接入 |
| 飞书/Lark | `lark-*.js` + `pre-install/lark-cli` | 飞书命令行 |

**AigcForge 映射**: 非 Work/Task 范围——Plugin 体系考虑作为消息通道 plugin。

---

## 5. Todo/Task 相关实现

### 5.1 TodoWrite Tool

Accio 的 chat renderer 中有 7+ 个 JS chunk 引用了 `todowrite`，确认其内置 TodoWrite 工具。与 AigcForge 的功能等价（LLM 驱动的全量替换式任务列表）。

### 5.2 Agent → Task 关系

Accio 的核心差异：**Agent 拥有 Task，而非 Session 拥有 Task。**

```
AigcForge 当前:          Accio 当前:
  Session → Todo[]          Agent → Task[]
                                   ├─ 一次性任务
                                   ├─ 定时任务 (ScheduledJob)
                                   └─ 衍生任务 (SpawnedTask)
```

### 5.3 删除 Agent 的影响面

删除 Agent 时展示影响：
- N 个会话
- N 个定时任务

这表明 Accio 在数据模型中维护了 Agent ↔ Task ↔ Session 的完整外键链路，删除时做级联影响分析。

---

## 6. 对 AigcForge 的借鉴优先级矩阵

| # | 能力 | 优先级 | 适用 Mode | 实施阶段 |
|---|---|---|---|---|
| A1 | 任务衍生 (Task Spawn) | **P0** | Chat/Coding/Work/Meta-Agent | M5 |
| A2 | 定时任务 (ScheduledJob) | **P0** | 全 Mode (含电商) | M3 |
| A3 | Agent Hub 聚合视图 | **P1** | Chat (主区) | M4 |
| A4 | Board Home 任务入口 | **P1** | Work（Preset 展开） | M5 |
| A5 | Skill per-Agent 安装 | **P1** | 全 Mode | 独立 PRD |
| A6 | Agent Activity Island | **P2** | 全 Mode | 独立 PRD |
| A7 | Wizard Agent 创建 | **P2** | Chat | 独立 PRD |
| A8 | Chrome CDP Relay | **P3** | Coding | Plugin 体系 |
| A9 | 多平台消息通道 | **P3** | Assistant | Plugin 体系 |

---

## 7. 文件清单（反编译产物索引）

### 关键主进程文件
```
/tmp/accio_asar/out/main/chunks/
  agent-store--ieWDnfM.js              Agent 存储
  agent-skill-manager-DPt8INes.js       Skill 管理
  subagent-session-store-CP0lOBI1.js   子 Agent 会话
  builtin-accio-DGaEpc0y.js            内置命令
  function-tools-DNs1DTr1.js           函数工具
  session-tools-NfT-rR_X.js            Session 工具
  load-tool-registry-CUl9_OP0.js       工具注册表
  tool-result-cleanup-CFWoithe.js      工具结果清理
  team-chat-Du52eUn5.js               团队聊天
  team-context-DmtgR8iU.js            团队上下文
  wecom-B5vTgnVs.js                   企业微信
  weixin-p2joK-VB.js                  微信
  telegram-Bu092NVB.js                Telegram
  api-*.js                            API 层 (多个)
  capture-D94xdNwq.js                 截图
  adk-gateway-client-BNM3X0K0.js      ADK 网关
  adopt-migration-BrcjTm7q.js         迁移
```

### 关键渲染进程文件
```
/tmp/accio_asar/out/renderer/assets/
  agent-hub-page-pxvqRGry.js           智能体中心页面
  create-agent-wizard-Ba1dVvE6.js      Agent 创建向导
  agent-activity-island-BxDY9Nxz.js    Agent 活动岛
  agent-detail-modal-DD8J3_14.js       Agent 详情弹窗
  agent-form-DDERmvOy.js               Agent 表单
  agent-panel-4Ey5xYJB.js              Agent 面板
  agents-8gKm1NIc.js                   Agent 列表
  chat-*.js (7个)                     聊天 UI（含 todowrite 引用）
  workspace-*.js                       工作区
  workspace-office-preview-*.js        Office 预览
  worktree-handoff-store-*.js          Worktree 切换
  activity-store-*.js                  活动存储
  activity-share-copy-*.js            活动分享
```

### 独立资源
```
/tmp/accio_extract/resources/
  app.asar (174MB)                     Electron 应用本体
  accio-mcp-cli/accio-mcp.mjs (3,806行) MCP CLI (Bun, 内嵌 js-yaml)
  chrome-extension/accio-browser-relay/ Chrome CDP Relay v0.2.1
  remote-tools.json                    远程工具配置 v0.7.1
  pre-install/                         Node/Python/Git/Lark 预装包
  ps/                                   PowerShell 脚本 (15+)
  badge/                               托盘徽章图标
```

---

## 8. 关联文档

- [Todo/Task 系统升级实施方案](plan/todo-task-system-upgrade.md) — 本报告的工程落地计划
- [Work 模式 PRD](prd/work-mode-execution-layer.md) — Preset→Task 展开的消费方
- [Chat 模式 PRD](prd/chat-mode-creation-layer.md) — Agent 资产创建的消费方
- [Assistant 模式 PRD](prd/assistant-mode-personal-agent.md) — 定时提醒的消费方
