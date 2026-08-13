# Assistant 模式完整开发路线图

> 状态：**Draft — 待审批**
> 日期：2026-08-11
> Owner：产品 + Core + App + Security
> 依据：[Assistant PRD v4](../prd/assistant-mode-personal-agent.md)（Approved 基线 v3 + 本次 v4 修订）、[实施计划](assistant-mode-implementation.md)、[ADR-11~15](../architecture/adr/)（全 Accepted）、[元智能体调度架构讨论总结](../research/agent/元智能体调度架构讨论总结.md)、[个人笔记与知识库竞品调研](../research/agent/个人笔记与知识库竞品调研.md)、[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)
> 分支策略：**assistant** 分支（从 main 切出，主线顺序 Phase A→F）

---

## 1. 路线图总览

```
主线（main 分支）
├── [已完成] ADR-11~15 架构基座（mode 分类/入口/边界/持久化/slot）
├── [已完成] Chat M1~M7 资产开闸（7 类资产）
├── [已完成] Work M0~M2 文档闭环 + Todo/Task 升级（含 scheduled-job 调度内核）
├── [已完成] Meta-Agent V2（总路由 + prerouter + task 委派）
│
├── ▸ ▸ ▸ 进行中：Assistant Phase A-F 已合入（assistant 分支）；下一步 会话详情 UI（M2.6，分支 assistant-session-detail）▸ ▸ ▸
│
└── [远期] Assistant M3~M4（主动任务/图谱/闪卡 → 跨信道 PoC）
```

### 全阶段一览

| 阶段 | 名称 | 范围 | 依赖 | 状态 |
|---|---|---|---|---|
| **M0** | 调度内核 + 基座 | SchedulerCore 提取、Schedule/Delivery 表、assistant 子智能体、全模式默认 meta | 无（复用 scheduled-job 内核） | ✅ 已合入（assistant 分支） |
| **M1** | 单次提醒闭环 | reminder_create/update/cancel、收件箱、离线补投、桌面通知、Dashboard | M0 | ✅ 已合入（assistant 分支） |
| **M2a** | 个人记忆 | personal_memory 表、提议+确认、Memory Inspector | M1 | ✅ 已合入（assistant 分支） |
| **M2b** | 个人知识库 | kb_note/kb_link、wikilink、悬空检测、反向引用、FTS5、文件落盘 | M2a（共享 kb 基础） | ✅ 已合入（assistant 分支） |
| **M2.5** | 笔记 + AI 产物 | 笔记编辑器、模板/日记、propose_note 7 格式、源数据锚定问答 | M2b | ✅ 已合入（assistant 分支） |
| **M2.6** | 会话详情页 UI | 详情右栏 5-Tab + 次级左栏富结构 + 首页实体导航树/会话联动 + 双栏编辑器 + 引文锚定（[实施计划](assistant-session-detail-plan.md)） | M2.5 | 🔲 待启动（分支 assistant-session-detail） |
| **M3** | 主动任务 + 图谱 | 周期计划、有限 Session wake、图谱视图、闪卡、随机反刍 | M2.6 + M3 设计评审 | 🔲 远期 |
| **M4** | 跨信道 | 单一信道 PoC + 社交网关收敛 + Outbox | M3 + Gateway 安全评审 | 🔲 远期 |

---

## 2. 分支与依赖策略

### 2.1 单分支顺序（assistant）

```
assistant 分支:
  M0 (调度内核+基座) → M1 (提醒闭环) → M2a (记忆) → M2b (知识库) → M2.5 (笔记) → 合并 main
                                                                      ↓
                                    assistant-session-detail 分支: M2.6 (会话详情页 UI) → 合并 main
                                                          ↓
                                          M3 (主动任务/图谱, 远期) → M4 (跨信道, 远期)
```

### 2.2 assistant 分支的禁区（防返工）

| 禁区 | 原因 |
|---|---|
| ❌ 不新建第二套调度器 | `scheduled-job.ts` 内核必须提取复用（G1） |
| ❌ 不让 assistant 子智能体继承宽权限 | 必须 fail-closed（G2） |
| ❌ 不做记忆"自编辑自动注入" | PRD §9 只允许"提议+确认"（G3） |
| ❌ 不把 IM 桥接提前 | M4 单独立项，PoC 门控（PRD §10） |
| ❌ 不复制 Session 页面 | 复用 ADR-12 canonical route + ModeWorkspace |

### 2.3 与既有代码的接口边界

| 能力 | 归属 | 说明 |
|---|---|---|
| `scheduled-job.ts` 调度内核 | Work 已有 | M0 提取为 `SchedulerCore`，行为不变，回归测试 |
| Task/Todo 表 | Work 已有 | 不动；Assistant 用独立 Schedule/Delivery 表（ADR-14 §3） |
| `memory.ts`（MetaAgent 项目级） | Meta-Agent 已有 | 不动；M2a 新增**个人记忆**（用户级跨项目） |
| chat-orchestrator / work-orchestrator | Chat/Work 已有 | 保留为委派目标；默认 agent 改为 meta |
| propose 候选-审查链路 | Chat 已有 | M2.5 复用为 propose_note |
| websearch / webfetch | 共享工具 | Assistant 继承，零建设 |

---

## 3. 阶段详情

### 3.1 M0 调度内核 + 基座（Phase A）

**目标**：让 Assistant 的调度与编排基座就位。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| SchedulerCore 提取 | 从 `scheduled-job.ts` 提取表无关的扫描+认领+恢复+daemon 循环 | 无 |
| Schedule/Delivery 表 + Service | 独立运行状态表（ADR-14 §3），含 deliveryKey 幂等 | SchedulerCore |
| assistant 子智能体 | fail-closed 权限（只读/联网/提问 + reminder_*/kb_*/memory_*） | 无 |
| 全模式默认 meta | meta 权限收敛（只读自干/写委派）+ modeDraft/local.tsx 改造 | 无 |

**准入**：G1（内核复用）+ G2（meta 契约）评审通过
**退出**：Core/数据库/安全评审通过；时间与崩溃测试完成

### 3.2 M1 单次提醒闭环（Phase B）

**目标**：用户能创建/修改/取消提醒，到期零成本投递，离线补投。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| reminder_create/update/cancel 工具 | 自然语言解析 + 确认 → typed Schedule 边界 | M0 |
| 收件箱（已读/归档） | Delivery 查询 + read 标记 | M0 |
| 离线补投 | 启动恢复扫描 + is_caught_up | M0 |
| 桌面通知 | best-effort，失败不回滚 | M0 |
| Dashboard + 提醒 Tab | 待执行列表 + 取消 + 历史投递 | M0 |

**退出**：PRD §11 Beta Gate 全部达标（创建率≥95%、在线及时率≥99%/60s、离线补投≥99%/30s、重复=0）

### 3.3 M2a 个人记忆（Phase C）

**目标**：用户可管理 AI 记住关于自己的事（确认优先）。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| personal_memory 表 | 用户级跨项目，来源/信任/敏感等级 | M1 |
| propose_memory + 待确认队列 | derived 默认 pending，不注入 | M1 |
| Memory Inspector | 右栏面板查看/编辑/删除/审计 | M1 |
| 注入约束 | 仅确认后条目可注入 prefix，CacheShape 预算 | M1 |

**退出**：记忆安全设计通过；提议+确认闭环；derived 不注入验证

### 3.4 M2b 个人知识库（Phase D）

**目标**：Obsidian 式双向链接知识库。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| kb_note/kb_link 表 | title 唯一 + wikilink 内容 + 关系边 | M2a |
| wikilink 解析 + 悬空检测 | 机械校验，零 LLM 依赖 | M2a |
| 反向引用 | 单边存储 + 索引推导 | M2a |
| FTS5 中文检索 | title+content 虚拟表 | M2a |
| 文件落盘 + Obsidian 兼容 | `.md` 落 XDG/项目目录，文件监听重建索引 | M2a |

**退出**：双向链接机制测试通过；悬空检测零依赖验证；外部编辑同步

### 3.5 M2.5 笔记 + AI 产物（Phase E）

**目标**：对话生成笔记 + NotebookLM 式源数据锚定问答。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| 笔记编辑器 | 右栏画布 Markdown WYSIWYG + [[补全]] | M2b |
| 模板/日记页 | 会议纪要/周报/每日回顾 | M2b |
| propose_note 工具 | 复用 propose 候选-审查链路，7 格式 | M2b |
| 源数据锚定问答 | 仅基于 kb_note 回答 + 引文角标 | M2b |

**退出**：propose_note 各 format 输出正确；锚定问答防幻觉验证通过

### 3.6 M2.6 会话详情页 UI（[实施计划](assistant-session-detail-plan.md)）

**目标**：补齐 assistant 会话详情页空壳（次级左栏/右栏 Placeholder）并归一化首页骨架。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| 详情右栏 5-Tab | 提醒/记忆/知识库/笔记编辑器/上下文，A/B 归一化 B 区隐藏，手动开+拖拽 | M2.5 |
| 次级左栏富结构 | Location + 会话列表 + 实体导航树（`AssistantSessionSidebar`） | M2.5 |
| 首页实体导航树 + 会话联动 | `AssistantNavTree` 首页/详情共用；主区会话列表联动左栏实体列表 | M2.5 |
| 双栏笔记编辑器 | Markdown + `[[补全]]` + 实时预览 + 悬空高亮 | M2.5 |
| 引文锚定 | timeline `[笔记ID]` 角标 → 右栏知识库 Tab 定位 | M2.5 |

**退出**：详情页 5-Tab 全量可用；首页/详情左栏非 Placeholder；联动高亮/退化正确；引文锚定跳转闭环

---

## 4. 依赖矩阵

### 4.1 与已完成基础设施的复用

| 已存在 | Assistant 复用点 |
|---|---|
| `scheduled-job.ts` 调度内核 | M0 SchedulerCore 提取 |
| `schedule.ts` cron 解析 | M0 直接导入 |
| `mode-workspace-slots.tsx` slot 注册 | Assistant Main/Sidebar/RightPanel |
| `mode-surfaces.tsx` MODE_SURFACES | assistant 三槽位替换 Placeholder |
| `session-context-tab.tsx` | 右栏 Context Tab |
| question tool | 提醒/记忆确认 |
| chat-orchestrator 范式 | assistant 子智能体类比创建 |
| propose 候选-审查链路 | M2.5 propose_note |
| websearch/webfetch | 联网搜索 + Web 剪藏素材 |
| system-context builtins | 记忆注入 + 日期/环境 |
| WorkArtifactPanel 画布 | 笔记编辑器参考 |

### 4.2 跨阶段依赖

| 阶段 | 依赖 | 说明 |
|---|---|---|
| M2b 知识库 | M2a 记忆 | 共享 kb 基础表 + 关系边（记忆↔笔记） |
| M2.5 笔记 | M2b 知识库 | 笔记写入 kb_note，锚定问答检索 kb_note |
| M3 闪卡 | M2.5 笔记 | 闪卡从笔记标记；Scheduler 联动复习提醒 |
| M3 随机反刍 | M2.5 笔记 + M1 Scheduler | 每日随机推送一条笔记到收件箱 |

---

## 5. 里程碑节奏

```
周 1-2:   M0 调度内核 + 基座（SchedulerCore 提取 + Schedule/Delivery + assistant 子智能体 + 全模式默认 meta）
周 3-4:   M1 单次提醒闭环（reminder 工具 + 收件箱 + 补投 + Dashboard）
          → M0+M1 合并 main（PRD §11 Beta Gate）
周 5:     M2a 个人记忆（提议+确认 + Memory Inspector）
周 6-7:   M2b 知识库（kb 表 + wikilink + 悬空检测 + FTS5 + 文件落盘）
周 8-9:   M2.5 笔记 + AI 产物（编辑器 + propose_note + 锚定问答）
          → M2 系列合并 main
周 10+:   M3 主动任务/图谱（远期，需设计评审）
周 12+:   M4 跨信道（远期，PoC 门控）
```

### 关键验收节点

| 节点 | 验收标准 |
|---|---|
| **M0 完成** | Assistant 会话默认 meta；meta 无写权限；assistant 子智能体 fail-closed；Schedule/Delivery 表可查可认领 |
| **M1 完成** | "明天上午9点提醒我跟进客户"→ 确认 → 到期投递收件箱 → 重启补投，重复=0 |
| **M2a 完成** | AI 提议记忆 → 用户确认 → 注入；derived 不注入 |
| **M2b 完成** | `[[wikilink]]` 解析 + 悬空检测 + 反向引用 + FTS5 搜索 + `.md` Obsidian 兼容 |
| **M2.5 完成** | 对话"整理成笔记"→ propose_note 候选 → 确认落盘；"我之前怎么处理 X"→ 锚定回答 + 引文角标 |

---

## 6. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| SchedulerCore 提取破坏 Work 调度 | 中 | 高 | 提取后 scheduled-job 测试回归；行为不变硬约束 |
| 全模式默认 meta 影响 chat/work 既有行为 | 中 | 高 | 保留 orchestrator 定义；feature flag 可回切 |
| 记忆注入 System Context 失控 | 中 | 高 | 确认门控 + CacheShape 预算纪律 |
| FTS5 中文分词质量 | 中 | 中 | 内置 tokenizer + 中英文验收测试 |
| 笔记编辑器工程量超预期 | 高 | 中 | 复用右栏画布，不引入重型编辑器 |
| 知识库规模增长 | 低 | 中 | M2 用 FTS5 够用，M3+ 再评估向量检索 |
| IM 桥接平台风险 | 高 | 高 | M4 PoC 门控（微信封号/OpenClaw CVE 规避） |

---

## 7. 下一步

1. **G0-G4 批准链落库**：PRD v4 评审 + ARCHITECTURE.md §7 同步（Assistant → In progress）+ 本路线图 + 实施计划
2. **G1 调度内核复用评审**：Core owner 确认 SchedulerCore 提取边界
3. **G2 meta 契约评审**：Core/安全确认全模式默认 meta + assistant 子智能体权限
4. **M0 启动**（Phase A）：assistant 分支，见实施计划 §4

## 8. 关联文档

- [Assistant PRD v4](../prd/assistant-mode-personal-agent.md) — 范围真源
- [Assistant 实施计划](assistant-mode-implementation.md) — 阶段详情与测试策略
- [元智能体调度架构讨论总结](../research/agent/元智能体调度架构讨论总结.md) — meta 契约
- [个人笔记与知识库竞品调研](../research/agent/个人笔记与知识库竞品调研.md) — 笔记功能依据
- [双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md) — 悬空检测/溯源
- [Work 模式路线图](work-mode-roadmap.md) — 格式与阶段范式参考
- [Work M1 实施计划](work-mode-execution-layer-m1.md) — 格式参考
