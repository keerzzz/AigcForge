# AigcForge 双向链接与防幻觉机制调研

> **类型**：项目现状调研（对照行业标准 + 开源项目 + 内部协议）
> **日期**：2026-08-09
> **范围**：双向链接 / 知识图谱在 Agent Harness 中的防幻觉价值与适用边界；幻觉检测与自救机制设计
> **关联**：[Harness 7 层现状调研](AigcForge-Harness-7层现状深度调研.md)、[Harness 7 层实施计划](../plan/harness-7-layer-hardening.md)、[第一性原理与智能体](第一性原理与智能体.md)、[Agent Harness 7层核心功能具象化调研](Agent%20Harness%207层核心功能具象化与问题解决机制深度调研.md)、[Harness工程与智能体开发](Harness工程与智能体开发.md)、[AI智能体协议研究](AI智能体协议研究.md)
> **调研方法**：Anthropic 官方工程博客 + GitHub 开源项目扫描（20+ 项目）+ jinnang 项目实践 + 内部 4 份协议文档交叉验证

---

## 0. 摘要

本调研回答三个问题：① 双向链接 / 知识图谱能否防止 LLM 幻觉；② 出现幻觉后如何发现与自救；③ 双向链接 / 知识图谱适合什么场景（含兜底边界）。

**核心结论**：

1. **双向链接的防幻觉价值只在"机械可校验的边"**：Obsidian 式双向链接的三个机制（轻量引用、反向推导、悬空检测）中，只有**悬空链接检测**（引用声称存在→机械校验不存在=幻觉证据）是 100% 确定性、零 LLM、零 MCP、零索引依赖的防线。其余两个机制对 LLM 的价值是"轻量标识符+按需加载"（已被 Anthropic 官方证实为 just-in-time 上下文策略），而非图本身。
2. **幻觉发现必须依赖外部机械信号源**：行业共识（Anthropic / OpenAI 实验 / 大量开源项目）——LLM 无法自查幻觉，检测信号只能是：验证执行器（typecheck/test 实跑）、引用完整性扫描、多模型仲裁（judge）、结构性拓扑校验（import 树方向）、HITL。**双向链接在这里的贡献是"证据链可追溯"**。
3. **幻觉自救 = 负向观察上下文闭环**：检测失败 → 错误轨迹/悬空报告封装为散文报错（含违反原则 + 修正指引）→ 喂回模型修正。AigcForge 已有 ToolFailure 通道与 permission 网络，缺口仅在波次 2 verifier。
4. **知识图谱 / 双向链接数据库适合"个人助手 + 本地知识库"场景，不适合"编程执行 Harness"场景**：个人知识库内容低变动率（无 stale index 问题）、跨会话引用密集、检索是核心交互——这正是图谱的主场（Obsidian / NOOA Agent-Curated Store / Windsurf Memories 均属此类）；编程 Harness 已有更轻的替代（Beads DAG 任务依赖、Cline 五维路径关联、Codex 单向拓扑约束），且 Anthropic 明确避开"索引/语法树"路线。

---

## 1. 问题定义：Agent 语境下的幻觉类型矩阵

幻觉不是单一现象。按检测信号源分类（这是设计防线的第一步，未经分类的"防幻觉"方案必然落空）：

| 类型 | 实例 | 检测信号源（必须机械） | AigcForge 现有覆盖 |
|---|---|---|---|
| A. 悬空引用 | 引用不存在的文件/符号/文档 | 引用完整性扫描（ripgrep 全量，零依赖） | check-refs 雏形（手工白名单，未全量推导） |
| B. 状态误判 | 声称测试通过/代码已改，实际没有 | 验证执行器（typecheck/test 实跑）+ git diff 核对 | 波次 2 verifier（未落地） |
| C. 事实编造 | 编造 API 行为、文档内容 | 多模型仲裁（judge 已有）+ claim→source 引用验证 | judge 已有 |
| D. 记忆污染 | 错误事实写入记忆并被复用 | 记忆溯源（provenance）+ 来源链接（支持/矛盾/推导自） | 波次 1b 表已预留 source 字段 |
| E. 语义错位 | 误读上下文、目标漂移 | HITL + 结构性约束（契约/权限网络） | permission 网络已有 |

> 行业证据：Anthropic 官方明确 LLM 无法承担自身交付物的裁判（"Demystifying evals for AI agents"）；OpenAI Codex 百万行实验的结论是"用机械化验证闭环代替人工监工，坚信大语言模型无法承担自身交付物的靠谱裁判"。

---

## 2. 行业证据三条主线

### 2.1 Anthropic 官方：上下文工程（2025-09）

- **just-in-time 上下文**：agent 只持有轻量标识符（文件路径/查询/链接），运行时按需加载。Claude Code 用 `glob/grep/head/tail` 动态检索，原文明说这是为了**绕过"过时索引与复杂语法树"（stale indexing and complex syntax trees）**——这是对"知识图谱/链接索引"路线的直接否证：索引 = 会过时的第二份真相。
- **结构化笔记（agentic memory）**：NOTES.md / memory tool 跨会话持久化，不建图。
- 上下文是有限资源：每 token 都是成本，注入必须有明确收益（对应 AigcForge 的 CacheShape 前缀缓存纪律）。

### 2.2 GitHub 开源：行业共识 = 引用验证而非图谱

扫描 20+ 相关项目，防幻觉的主流实现是 **citation verification（引用验证）**：

| 项目 | 机制 |
|---|---|
| `JamesWeatherhead/receipts` | "checks if your references actually say what you claim they say"——声明↔引用一致性验证 |
| `ganma0517/literature-review-hardened` | verify-first + per-claim verification + 可审计 Citation Verification Table |
| `Sungho-Park-DE/verifiable-legal-rag` | quote-and-verify + 确定性信任层 + 51 项离线校验 |
| `PHY041/claude-skill-citation-checker` | 引用幻觉检测器（.bib ↔ CrossRef/Semantic Scholar 交叉验证） |
| `sentinel-agentic-rag` | claim-level self-verification & self-correction |
| `DHEEKSHASOKALLA7/trustworthy-llm-framework` | claim verification + 动态信任评分 |

无一例外：**检测是机械的（外部校验），不是 LLM 自查**。

### 2.3 内部协议四文档：与 AigcForge 的直接映射

| 文档 | 关键机制 | AigcForge 对应物 |
|---|---|---|
| 第一性原理与智能体 | 神经-符号双环：状态验证/硬性约束归符号层；ABC 契约四元组含**恢复机制**（检测偏离→确定性降级/自纠正） | 波次 2 verifier（符号层）；permission 网络（契约）；兜底=恢复机制 |
| Agent Harness 7层 | NOOA 记忆显式关系边（支持/矛盾/推导自）；Ralph 终止拦截；负向观察上下文喂回 | meta_agent_memory（可扩展关系边）；波次 2 验证钩子 |
| Harness工程与智能体开发 | **Beads DAG**（bd depend 显式依赖声明→脚手架按图分发）；工具瘦身（15→2 工具 80%→100%）；执行期授权 | 波次 3 执行计划（任务依赖边）；工具注册表 |
| AI智能体协议研究 | **Cline 五维关联触发**（路径 Glob→规则注入，零索引）；Codex 单向拓扑守恒 + 结构性拓扑测试（import 树）；**语义化散文报错**（违反原则+重构指引） | SkillGuidance（渐进加载）；codegraph（符号拓扑）；波次 2 D6 散文报错 |

---

## 3. 双向链接的机制解构（防幻觉视角）

Obsidian 双向链接 = 三个机制，对防幻觉的价值差异极大：

| 机制 | Obsidian 版 | 防幻觉价值 | 依赖 | 适用场景 |
|---|---|---|---|---|
| ① 轻量标识符+按需加载 | `[[链接]]` 指向笔记 | 中（上下文供给侧：减少编造空间） | 文件系统 | 所有场景（Anthropic just-in-time 证实） |
| ② **悬空链接检测** | Dangling links 面板 | **高（唯一零依赖的机械防线）** | **无（ripgrep 即可）** | 所有场景 |
| ③ 反向引用/图遍历 | 图视图 backlinks | 低-中（增强，可缺省） | codegraph MCP | 仅编程场景 |

**关键判断**：防幻觉不靠"图"本身，靠"可机械校验的边"。图的增量价值（可达性分析、孤立检测）对 LLM 推理的帮助有限，且代价是索引维护（stale index 风险，Anthropic 明确回避）。

---

## 4. 知识图谱 / 双向链接数据库的适用场景判定

### 4.1 判定：适合"个人助手 + 本地知识库"，不适合"编程执行 Harness"

| 维度 | 个人助手 / 本地知识库 | 编程执行 Harness |
|---|---|---|
| 内容变动率 | 低（笔记/事实库，人工+AI 低速写入）→ 无 stale index 问题 | 高（代码高频变更）→ 索引必然过时 |
| 跨会话引用密度 | 极高（知识复用是核心交互）→ 反向推导价值大 | 低（工具调用即取即用） |
| 核心交互 | 检索/关联发现/溯源 | 执行/验证/迭代 |
| 图谱价值的行业先例 | **Obsidian（黄金标准）、NOOA Agent-Curated Store（显式关系边）、Windsurf Memories（动态事实库）** | **Anthropic 避开索引；Beads DAG（任务边）替代知识边；Cline 路径关联替代图谱** |
| 结论 | ✅ 图谱/双向链接数据库是主场 | ❌ 用"轻标识符 + 机械校验"替代 |

### 4.2 对 AigcForge 后期方向的引用结论

1. **若 AigcForge 进入"个人助手 / 本地知识库"产品形态**（assistant mode 或知识库能力），双向链接数据库 / 知识图谱应作为该场景的底层：
   - 实体表（笔记/事实/记忆）+ 关系边表（`支持 / 矛盾 / 推导自 / 引用`，对齐 NOOA Agent-Curated Store）
   - 反向引用推导（Obsidian 机制：单边存储 + 索引推导，不双写）
   - 悬空检测（同一机械校验器复用）
   - 记忆溯源（meta_agent_memory 的 source 字段 + 关系边 = 天然基础，后期加 relation 列即可）
2. **编程 Harness 场景维持现状方向**：不建图谱，走"引用完整性校验（核心）+ codegraph 反向引用（可选增强）+ Beads 式任务依赖（波次 3）"。

---

## 5. AigcForge 落地方案（防幻觉 + 自救 + 兜底）

### 5.1 核心层：引用完整性校验器（L0 兜底，零依赖）

- **机制**：ripgrep（AigcForge 已有 Ripgrep 服务）全量扫描 markdown 链接（`[text](path)`）+ 代码符号引用 → 悬空报告（声称存在 vs 实际不存在）
- **入口**：机械钩子（lifecycle-hooks postToolUse），不依赖 LLM 主动调用
- **产出**：悬空报告 → 散文报错（证据链：`声称 X 存在，实际校验：文件缺失/符号未定义`）→ 喂回模型修正
- **依赖**：无 MCP、无模型、无索引——只依赖文件系统
- **升级路径**：`check-refs.sh`（现为手工白名单）升级为全量推导 + CI 门禁

### 5.2 增强层：反向引用注入（可缺省）

- codegraph MCP 已装：会话涉及模块 X 时，SystemContext 注入 `callers(X)` + 文档反向引用（防"孤立发明"）
- **未装 → 自动降级 L0**，不阻塞（复用波次 1b 的 `Effect.serviceOption` 模式）
- 注入预算受 CacheShape 纪律约束（默认关闭，opt-in）

### 5.3 自救闭环

`检测（机械钩子）→ 定位（散文报错带证据链）→ 修正（负向观察上下文喂回）→ 复验（verifier）`

- 状态误判类（B）：波次 2 verifier（typecheck/test 实跑）
- 悬空引用类（A）：5.1 引用校验器
- 事实编造类（C）：judge 多模型仲裁（已有）
- 记忆污染类（D）：memory provenance 溯源（波次 1b 已预留）
- 语义错位类（E）：HITL（permission 网络已有）

### 5.4 兜底矩阵（服务缺失时降级而非关闭）

| 层 | 服务缺失 | 降级行为 |
|---|---|---|
| L0 引用完整性 | 无任何服务 | ripgrep 全量扫描（只依赖文件系统）——**永远可用** |
| L1 验证执行器 | 无 test runner | 回退 `git diff` 核对（文件确实被修改） |
| L2 反向引用 | 无 codegraph MCP | 不注入，基线不变（零缓存影响） |
| L3 记忆 | 无 DB | memory 注入不启用（已实现 serviceOption 降级） |
| L4 HITL | 无 UI 审批 | ask 自动 deny（已实现 unattended 降级） |

---

## 6. 结论

1. 防幻觉的正确顺序是：**先定义幻觉类型与检测信号源（矩阵），再选机制**——反向引用注入只是供给侧增强，不是防线本体。
2. 双向链接对 Harness 的贡献收敛为三件事：**悬空检测（核心防线）+ 轻量引用（just-in-time 上下文）+ 证据链（自救可追溯）**。
3. 知识图谱 / 双向链接数据库是**个人助手与本地知识库场景的主场**（Obsidian / NOOA / Windsurf 先例），编程 Harness 场景维持"轻标识符 + 机械校验"。
4. 兜底原则：**任何一层服务缺失，检测能力降级而非关闭；注入失败不阻塞主流程**（复用波次 1b 的 serviceOption 模式）。

---

## 参考

- Anthropic: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09)
- Anthropic: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- GitHub 开源：`receipts`、`literature-review-hardened`、`verifiable-legal-rag`、`claude-skill-citation-checker`、`sentinel-agentic-rag`、`trustworthy-llm-framework`
- 内部协议：`第一性原理与智能体.md`、`Agent Harness 7层核心功能具象化与问题解决机制深度调研.md`、`Harness工程与智能体开发.md`、`AI智能体协议研究.md`
- 外部项目：jinnang（`文档即代码：工程实践与AI助手.md`、`05_全站内容卡片原子结构与抗幻觉执行蓝图.md`）
