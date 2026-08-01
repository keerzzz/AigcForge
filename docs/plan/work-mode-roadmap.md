# Work 模式完整开发路线图

> 状态：**Draft — 待审批**
> 日期：2026-08-01
> Owner：产品 + Core + App + Security
> 依据：[Work PRD v4.1](../prd/work-mode-execution-layer.md)（Approved 2026-07-31）、[ADR-11~15](../architecture/adr/)（全 Accepted）、[Todo/Task 升级计划](todo-task-system-upgrade.md)（交叉裁决）、[Accio 竞品反编译分析报告](../Accio竞品反编译分析报告.md)
> 分支策略：**work** 分支（本路线图）与 **todo** 分支（[todo-task-system-upgrade.md](todo-task-system-upgrade.md)）并行启动，主线顺序 Todo 先行（数据模型地基），Work 分支 M1 做不依赖模型的文档闭环

---

## 1. 路线图总览

```
主线（main 分支）
├── [已完成] ADR-11~15 架构基座（mode 分类/入口/边界/持久化/slot）
├── [已完成] Chat M1~M7 资产开闸（prompt/skill/mcp/command/agent/workflow/plugin 7 类资产）
├── [已完成] ModeWorkspace typed slot（adr-15-modeworkspace-implementation.md, main @ 0105b3649）
│
├── ▸ ▸ ▸ 本路线图：Work 模式 M0→M1→M1.5→M2→M3 ▸ ▸ ▸
│
└── [并行] Todo/Task 升级分支（数据模型地基，见 §4 依赖矩阵）
```

### 全阶段一览

| 阶段 | 名称 | 范围 | 依赖 | 状态 |
|---|---|---|---|---|
| **M0** | 契约层 | Artifact 领域事件、Task 模型对齐、原子写入规范 | Todo M0 (Task Schema) | 🔲 待开发 |
| **M1** | 文档闭环 | Preset Catalog、澄清、Markdown 只读预览、同名询问、安全落盘 | 无外部依赖（不碰 ProgressLedger） | 🔲 本路线图首个交付 |
| **M1.5** | 进度与恢复 | Progress Ledger 节点 UI、断点恢复 (Resume)、对齐 Context Tab | **Todo M1（Task 模型）** | 🔲 依赖 Todo |
| **M2** | 资产沉淀 | 消息级"存为资产"→ Chat 资产工作室 | Chat M3/M7 接口（已就绪） | 🔲 依赖 M1 |
| **M3** | 扩展产出 | DataAnalysis / 图表 HTML 产出 | CSP 安全评审 | 🔲 远期 |

---

## 2. 分支与依赖策略

### 2.1 双分支并行

```
时间 →
├─ todo 分支:  M0(Task Schema) ── M1(SessionTask+联动+写API) ──────► 合并 main
│                                        │
├─ work 分支:  M1 文档闭环 ─────────────────────────────────────► 合并 main
│                (Preset/澄清/预览/落盘, 不碰步骤追踪)          │
│                                                               ▼
│                                            Work M1.5 (ProgressLedger, 复用 Task 模型)
│                                            Todo M2 (TaskPanel UI)   ← 两个可并行
└─ 合并后:      Work M2 (资产沉淀) → Work M3 (扩展产出)
```

### 2.2 work 分支的禁区（防返工）

| 禁区 | 原因 |
|---|---|
| ❌ 不实现 ProgressLedger 独立 Schema/Service | 交叉裁决：ProgressLedger = Task List 子集，等 Todo M1 的 Task 模型 |
| ❌ 不实现步骤追踪/断点恢复 | 属 M1.5，依赖 Task 模型 |
| ❌ 不新建全局 Work 工作区 | ADR-14：Work 产出落用户选择的已有 Location |
| ❌ 不内嵌富文本/代码编辑器 | PRD §6.2 非目标，修改一律走对话 |

### 2.3 与 todo 分支的接口边界

| 能力 | 归属 | 说明 |
|---|---|---|
| `TaskInfo` Schema | todo 分支 M0 | Work 的 `outputDigest` 字段已列入 Todo 计划 §5.2 (M1.5) |
| `SessionTask` Service | todo 分支 M1 | Work M1.5 复用，不新建 |
| `PATCH /session/{id}/task` 写 API | todo 分支 M1 | Work 可交互 TaskPanel 依赖 |
| `outputDigest` | todo 分支 M1.5 | 与 Work M1.5 同步上线 |
| 官方 Preset 注册表 | **work 分支 M1** | Work 独有，与 todo 无交集 |
| work-orchestrator agent | **work 分支 M1** | 类比 chat-orchestrator，Work 专属 |
| Artifact 投影 | **work 分支 M0/M1** | Work 独有（产出记录），与 todo 无交集 |

---

## 3. 阶段详情

### 3.1 M0 契约层

**目标**：定义 Work 的数据契约，与 Todo 分支 Task 模型对齐。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| Artifact 领域事件 | `artifact.created` 等（引用不复制正文，ADR-14） | 无 |
| Artifact Record 契约 | `id/sessionID/kind/title/mediaType/relativePath/status` | 无 |
| 原子写入规范 | 目标级事务锁 + CAS + 安全回滚（对齐 Chat M1 PromptAssetService 模式） | 无 |
| Task 模型对齐确认 | 确认 `outputDigest`/`in_progress`/派生值已纳入 Todo 分支 | **Todo M0** |

**准入**：Schema 评审通过
**退出**：Artifact 契约 + 原子写入规范落地

### 3.2 M1 文档闭环（首个交付，work 分支）

**目标**：非编程用户从预设出发，完成"选择预设 → 澄清 → 生成 → 只读预览 → 确认落盘"的完整文档产出闭环。

详见 [work-mode-execution-layer-m1.md](work-mode-execution-layer-m1.md)（独立实施计划）。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| 官方 Preset Catalog | 硬编码预设库（12 工种 + 5 泛人群），按分类检索 | 无 |
| work-orchestrator agent | Work 专属执行 agent，澄清 + 生成 | 无 |
| question tool 接入 | 小白问卷式引导 | 已有（`packages/aigcfroge/src/question/`） |
| Work Surface UI | ModeWorkspace slot：Preset 卡片 + 会话列表 | 已有 slot 骨架 |
| 右栏双 Tab | Context Tab（对齐 Code）+ Artifact Tab（只读预览 + 应用按钮） | 已有 `session-context-tab.tsx` |
| 同名冲突询问 | LLM 自动询问重命名/覆盖 + Diff 确认 | 无 |
| 安全落盘 | 原子写入当前 Location + Artifact 投影 | M0 |

**准入**：M0 完成
**退出**：内部 50 次测试达标（PRD §13 M1 准入）

### 3.3 M1.5 进度与恢复（依赖 todo 分支）

**目标**：Progress Ledger 节点 UI + 断点恢复。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| Progress Ledger UI | 复用 Task 模型渲染步骤进度条 | **Todo M1**（SessionTask Service） |
| 断点恢复 (Resume) | 从 failed/in_progress 步骤续传 | **Todo M1**（Task status 持久化） |
| Context Tab 对齐 | 完全对齐 Code 模式 | 已有 `session-context-tab.tsx` |
| outputDigest | 步骤增量摘要 | **Todo M1.5** |

**退出**：恢复测试 100% 通过（PRD §13 M1.5 准入）

### 3.4 M2 资产沉淀联动

**目标**：消息级"存为资产" → 无缝路由 Chat 资产工作室。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| 存为资产按钮 | 产出消息下方，预填数据 | M1 |
| 路由协议 | Work 产出 → Chat 资产注册（预填 `propose_*_asset` 入参） | Chat M3/M7 接口（已就绪） |
| 预填数据模型 | 产出 digest → 资产字段映射 | M1 |

**退出**：与 Chat M3/M7 接口对齐，端到端注册成功

### 3.5 M3 扩展产出（远期）

**目标**：DataAnalysis / 图表 HTML 产出。

| 交付物 | 说明 | 依赖 |
|---|---|---|
| 图表产出 | DataAnalysis preset 生成 HTML 图表 | CSP 安全隔离 |
| 内容安全评审 | 单独通过 CSP 评审 | — |

**退出**：内容安全评审通过

---

## 4. 依赖矩阵

### 4.1 与 Todo/Task 计划的交叉

| Work 阶段 | Todo 阶段 | 依赖点 | 合并节奏 |
|---|---|---|---|
| M1 | 无直接代码依赖 | 经 M0 对齐确认**间接依赖 Todo M0**（契约评审级：确认 `outputDigest`/`in_progress`/派生值纳入 Task 模型，非代码依赖） | work 分支独立开发，可先合并 |
| M1.5 | **M1** | SessionTask Service、Task status 持久化 | 需 Todo M1 先合并 main |
| M1.5 | **M1.5** | outputDigest 字段 | 需 Todo M1.5 同步 |
| M2 | 无 | 不依赖 | 依赖 M1 即可 |

### 4.2 与已完成基础设施的复用

| 已存在 | Work 复用点 |
|---|---|
| `mode-workspace-slots.tsx` slot 注册 | Work Main slot（替代 PlaceholderMain） |
| `mode-surfaces.tsx` MODE_SURFACES 注册表 | Work Sidebar/Main/RightPanel 注册 |
| `session-context-tab.tsx` (442行, mode-agnostic) | Work 右栏 Context Tab |
| question tool (`packages/aigcfroge/src/question/`) | 小白问卷式澄清 |
| chat-orchestrator 模式 | work-orchestrator 类比创建 |
| Chat M1 PromptAssetService 事务模式 | Work Artifact 原子写入 |
| `session-capture` 链路 (`session.tsx:1598-1626`) | M2 存为资产路由 |
| TodoWrite tool | M1 后 TaskWrite 复用（不新建） |

---

## 5. 里程碑节奏

```
周 1-2:   work 分支 M0 + M1 前半（Preset Schema + work-orchestrator + 澄清）
          todo 分支 M0 + M1（并行，数据模型地基）
周 3-4:   work 分支 M1 后半（只读预览 + 同名询问 + 安全落盘）
          → work M1 合并 main（内部 50 次测试）
周 5:     todo M1 合并 main → Work M1.5 启动（ProgressLedger，复用 Task）
周 6-7:   Work M1.5 完成 + Todo M2 并行（TaskPanel UI）
周 8:     Work M2 资产沉淀（存为资产 → Chat 工作室）
周 9+:    Work M3 扩展产出（远期，独立排期）
```

### 关键验收节点

| 节点 | 验收标准 |
|---|---|
| **Work M1 完成** | 非编程用户选"视频分镜脚本"→ 答 3-5 个问题 → 右侧预览完整 Markdown → 确认保存到项目目录 |
| **Work M1.5 完成** | 生成中断 → 进度条显示失败步骤 → 点击 Resume → 从断点续传完成 |
| **Work M2 完成** | 产出消息点"存为资产"→ Chat 资产工作室出现该资产 → 新会话可复用 |

---

## 6. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| work 分支抢先实现 ProgressLedger | 中 | 高 | §2.2 禁区明确标注 + 合并前 code review 检查 |
| Todo M1 延迟拖累 Work M1.5 | 中 | 中 | Work M1 独立交付先合并，M1.5 弹性排期 |
| 官方预设文案质量不足 | 高 | 中 | PRD §14：邀请视频/科研/游戏内测用户共同校准 |
| 12+5 工种真伪需求偏差 | 中 | 高 | §5 真伪需求矩阵已过产品评审，M1 只落地 3-4 个高置信预设 |
| 跨 Location 读取权限复杂 | 低 | 中 | 复用 PermissionV2 ask 流程（PRD §11 注记） |

---

## 7. 下一步

0. **提交批准链落库**（W1 ARCHITECTURE.md 同步三处 + Work PRD v4.1 + Todo v2.1 + 本路线图 + M1 计划 + Accio 报告——目前全部仅在工作树）
1. **批准本路线图**
2. **执行 [M1 实施计划](work-mode-execution-layer-m1.md)**（work 分支，D1/D2 已定案）
3. 与 [Todo/Task 升级计划](todo-task-system-upgrade.md) 并行推进 todo 分支
4. M1 落地后启动 M1.5（依赖 Todo M1 合并）

## 8. 关联文档

- [Work 模式 PRD v4.1](../prd/work-mode-execution-layer.md) — 范围真源
- [Todo/Task 升级计划](todo-task-system-upgrade.md) — 数据模型地基（交叉裁决）
- [Accio 竞品反编译分析报告](../Accio竞品反编译分析报告.md) — Preset 任务驱动借鉴
- [Chat M1 实施计划](chat-mode-creation-layer-m1.md) — 格式与阶段范式参考
- [ADR-15 实施计划](adr-15-modeworkspace-implementation.md) — ModeWorkspace slot 基座
