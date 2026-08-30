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
3. **幻觉自救 = 负向观察上下文闭环 + 纠正持久化**：检测失败 -> 散文报错喂回模型修正（一次性 augment）；纠正方向持久化到临时记忆钩子（§9），走 SystemContext update 通道不破坏前缀缓存，确保 compaction 后纠正不丢失。**错误只出现一次，之后只注入正确方向**（注意力机制 + 正向指令优于负向指令）。
4. **知识图谱 / 双向链接数据库适合"个人助手 + 本地知识库"场景，不适合"编程执行 Harness"场景**：个人知识库内容低变动率（无 stale index 问题）、跨会话引用密集、检索是核心交互——这正是图谱的主场（Obsidian / NOOA Agent-Curated Store / Windsurf Memories 均属此类）；编程 Harness 已有更轻的替代（Beads DAG 任务依赖、Cline 五维路径关联、Codex 单向拓扑约束），且 Anthropic 明确避开"索引/语法树"路线。

---

## 1. 问题定义：Agent 语境下的幻觉类型矩阵

幻觉不是单一现象。按检测信号源分类（这是设计防线的第一步，未经分类的"防幻觉"方案必然落空）：

| 类型        | 实例                            | 检测信号源（必须机械）                               | AigcForge 现有覆盖                        |
| ----------- | ------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| A. 悬空引用 | 引用不存在的文件/符号/文档      | 引用完整性扫描（ripgrep 全量，零依赖）               | check-refs 雏形（手工白名单，未全量推导） |
| B. 状态误判 | 声称测试通过/代码已改，实际没有 | 验证执行器（typecheck/test 实跑）+ git diff 核对     | 波次 2 verifier（未落地）                 |
| C. 事实编造 | 编造 API 行为、文档内容         | 多模型仲裁（judge 已有）+ claim→source 引用验证      | judge 已有                                |
| D. 记忆污染 | 错误事实写入记忆并被复用        | 记忆溯源（provenance）+ 来源链接（支持/矛盾/推导自） | 波次 1b 表已预留 source 字段              |
| E. 语义错位 | 误读上下文、目标漂移            | HITL + 结构性约束（契约/权限网络）                   | permission 网络已有                       |

> 行业证据：Anthropic 官方明确 LLM 无法承担自身交付物的裁判（"Demystifying evals for AI agents"）；OpenAI Codex 百万行实验的结论是"用机械化验证闭环代替人工监工，坚信大语言模型无法承担自身交付物的靠谱裁判"。

---

## 2. 行业证据三条主线

### 2.1 Anthropic 官方：上下文工程（2025-09）

- **just-in-time 上下文**：agent 只持有轻量标识符（文件路径/查询/链接），运行时按需加载。Claude Code 用 `glob/grep/head/tail` 动态检索，原文明说这是为了**绕过"过时索引与复杂语法树"（stale indexing and complex syntax trees）**——这是对"知识图谱/链接索引"路线的直接否证：索引 = 会过时的第二份真相。
- **结构化笔记（agentic memory）**：NOTES.md / memory tool 跨会话持久化，不建图。
- 上下文是有限资源：每 token 都是成本，注入必须有明确收益（对应 AigcForge 的 CacheShape 前缀缓存纪律）。

### 2.2 GitHub 开源：行业共识 = 引用验证而非图谱

扫描 20+ 相关项目，防幻觉的主流实现是 **citation verification（引用验证）**：

| 项目                                         | 机制                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `JamesWeatherhead/receipts`                  | "checks if your references actually say what you claim they say"——声明↔引用一致性验证 |
| `ganma0517/literature-review-hardened`       | verify-first + per-claim verification + 可审计 Citation Verification Table             |
| `Sungho-Park-DE/verifiable-legal-rag`        | quote-and-verify + 确定性信任层 + 51 项离线校验                                        |
| `PHY041/claude-skill-citation-checker`       | 引用幻觉检测器（.bib ↔ CrossRef/Semantic Scholar 交叉验证）                           |
| `sentinel-agentic-rag`                       | claim-level self-verification & self-correction                                        |
| `DHEEKSHASOKALLA7/trustworthy-llm-framework` | claim verification + 动态信任评分                                                      |

无一例外：**检测是机械的（外部校验），不是 LLM 自查**。

### 2.3 内部协议四文档：与 AigcForge 的直接映射

| 文档                    | 关键机制                                                                                                                                        | AigcForge 对应物                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 第一性原理与智能体      | 神经-符号双环：状态验证/硬性约束归符号层；ABC 契约四元组含**恢复机制**（检测偏离→确定性降级/自纠正）                                            | 波次 2 verifier（符号层）；permission 网络（契约）；兜底=恢复机制    |
| Agent Harness 7层       | NOOA 记忆显式关系边（支持/矛盾/推导自）；Ralph 终止拦截；负向观察上下文喂回                                                                     | meta_agent_memory（可扩展关系边）；波次 2 验证钩子                   |
| Harness工程与智能体开发 | **Beads DAG**（bd depend 显式依赖声明→脚手架按图分发）；工具瘦身（15→2 工具 80%→100%）；执行期授权                                              | 波次 3 执行计划（任务依赖边）；工具注册表                            |
| AI智能体协议研究        | **Cline 五维关联触发**（路径 Glob→规则注入，零索引）；Codex 单向拓扑守恒 + 结构性拓扑测试（import 树）；**语义化散文报错**（违反原则+重构指引） | SkillGuidance（渐进加载）；codegraph（符号拓扑）；波次 2 D6 散文报错 |

---

## 3. 双向链接的机制解构（防幻觉视角）

Obsidian 双向链接 = 三个机制，对防幻觉的价值差异极大：

| 机制                  | Obsidian 版         | 防幻觉价值                       | 依赖                   | 适用场景                                |
| --------------------- | ------------------- | -------------------------------- | ---------------------- | --------------------------------------- |
| ① 轻量标识符+按需加载 | `[[链接]]` 指向笔记 | 中（上下文供给侧：减少编造空间） | 文件系统               | 所有场景（Anthropic just-in-time 证实） |
| ② **悬空链接检测**    | Dangling links 面板 | **高（唯一零依赖的机械防线）**   | **无（ripgrep 即可）** | 所有场景                                |
| ③ 反向引用/图遍历     | 图视图 backlinks    | 低-中（增强，可缺省）            | codegraph MCP          | 仅编程场景                              |

**关键判断**：防幻觉不靠"图"本身，靠"可机械校验的边"。图的增量价值（可达性分析、孤立检测）对 LLM 推理的帮助有限，且代价是索引维护（stale index 风险，Anthropic 明确回避）。

---

## 4. 知识图谱 / 双向链接数据库的适用场景判定

### 4.1 判定：适合"个人助手 + 本地知识库"，不适合"编程执行 Harness"

| 维度               | 个人助手 / 本地知识库                                                                             | 编程执行 Harness                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 内容变动率         | 低（笔记/事实库，人工+AI 低速写入）→ 无 stale index 问题                                          | 高（代码高频变更）→ 索引必然过时                                              |
| 跨会话引用密度     | 极高（知识复用是核心交互）→ 反向推导价值大                                                        | 低（工具调用即取即用）                                                        |
| 核心交互           | 检索/关联发现/溯源                                                                                | 执行/验证/迭代                                                                |
| 图谱价值的行业先例 | **Obsidian（黄金标准）、NOOA Agent-Curated Store（显式关系边）、Windsurf Memories（动态事实库）** | **Anthropic 避开索引；Beads DAG（任务边）替代知识边；Cline 路径关联替代图谱** |
| 结论               | ✅ 图谱/双向链接数据库是主场                                                                      | ❌ 用"轻标识符 + 机械校验"替代                                                |

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

| 层            | 服务缺失         | 降级行为                                         |
| ------------- | ---------------- | ------------------------------------------------ |
| L0 引用完整性 | 无任何服务       | ripgrep 全量扫描（只依赖文件系统）——**永远可用** |
| L1 验证执行器 | 无 test runner   | 回退 `git diff` 核对（文件确实被修改）           |
| L2 反向引用   | 无 codegraph MCP | 不注入，基线不变（零缓存影响）                   |
| L3 记忆       | 无 DB            | memory 注入不启用（已实现 serviceOption 降级）   |
| L4 HITL       | 无 UI 审批       | ask 自动 deny（已实现 unattended 降级）          |

---

## 6. 结论

1. 防幻觉的正确顺序是：**先定义幻觉类型与检测信号源（矩阵），再选机制**——反向引用注入只是供给侧增强，不是防线本体。
2. 双向链接对 Harness 的贡献收敛为三件事：**悬空检测（核心防线）+ 轻量引用（just-in-time 上下文）+ 证据链（自救可追溯）**。
3. 知识图谱 / 双向链接数据库是**个人助手与本地知识库场景的主场**（Obsidian / NOOA / Windsurf 先例），编程 Harness 场景维持"轻标识符 + 机械校验"。
4. 兜底原则：**任何一层服务缺失，检测能力降级而非关闭；注入失败不阻塞主流程**（复用波次 1b 的 serviceOption 模式）。

---

## 7. 幻觉检测与缓解研究补充（解码级 / 训练级机制的归属判定）

行业对幻觉控制的研究可归为三维度：自我发现（运行时检测）、前置主动防御、边界突破后的闭环自愈。按"信号源是否在 Harness 控制边界内"判定 AigcForge 归属：

| 机制                         | 原理                                                                    | 信号源层级                     | AigcForge 归属                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| VarEntropy / Semantic Energy | 解码时熵与熵方差飙升 → 知识盲区                                         | 模型内部（token 概率）         | ❌ 模型侧责任（Harness 拿不到 token 级分布；CHOKE 警示证明不可靠）                                                                               |
| CSR / REFIND                 | 带证据 vs 剥离证据的条件概率差 → 忠实度违背                             | 模型内部 + 双路推理（2x 成本） | ⏳ 中期可选：可作为 judge 的"证据敏感度"实现，但成本与收益需评估                                                                                 |
| H-Neurons / CLAP             | FFN 中 <0.1% 幻觉神经元的激活探针                                       | 模型权重内部                   | ❌ 模型侧责任（需厂商开放）                                                                                                                      |
| **CHOKE 警示**               | 强误导下模型以极高置信度+零熵输出荒谬幻觉                               | ——                             | ✅ **关键结论：不确定性自查不可作为唯一防线——确定性计算门（机械验证）是唯一可靠防线，与 §2.2 结论一致**                                          |
| KARL / DPO                   | RL 阶段校准知识边界，学会拒绝（IDK）                                    | 训练侧                         | ❌ 模型侧责任（Harness 不控制）                                                                                                                  |
| DAGCD                        | 解码时按交叉注意力拉升证据对齐 token                                    | 解码侧                         | ❌ 模型侧责任                                                                                                                                    |
| 渐进式披露                   | 只注入目录，用时可加载                                                  | Harness                        | ✅ 已有：SkillGuidance / 意图工具过滤 / MCP 渐进加载                                                                                             |
| 上下文重置                   | 提纯进度后重启干净子 Agent                                              | Harness                        | ✅ 已有：compaction 三级水位 + Context Epoch + 波次 1b SystemContext                                                                             |
| PGE 三角色                   | Planner/Generator/Evaluator 物理剥离                                    | Harness                        | ⏳ 部分已有：judge（Evaluator 骨架）+ task 委派（Planner/Generator 分派）+ verifier（机械 Evaluator）——缺"动态路由策略"，见 §8                   |
| MARCH 非对称盲审             | Checker 不见 Solver 原文，仅凭 QA 命题+文档重答，分歧即失败             | Harness                        | ⏳ 部分已有：`judgeMerge` 只接收 Worker 最终输出（已天然符合"新鲜眼睛"）——但它是"合并"型而非"盲审校验"型；增强方向：judge 输入改为原子 QA 命题对 |
| HarnessFix / HTIR            | 失败轨迹编译为有向图，Diagnosis Agent 沿图归因到 Harness 缺陷并局部修补 | Harness                        | ⏳ 波次 4：EventV2 + OTLP span 归因是现成底座                                                                                                    |
| 确定性物理卡点               | 编译/测试/PR 合入的最终裁决权硬性上收给计算门                           | Harness                        | ✅ 波次 2 verifier 定位即此（"模型建议，代码裁决"）                                                                                              |
| Shadow/Phantom Registry      | 影子注册表可信源校验，拦截 slopsquatting/虚假 URL                       | Harness                        | ⏳ 后续安全波次候选                                                                                                                              |
| Monitoring Decoding          | 解码中实时评分偏置 token，就地重采样回溯                                | 解码侧                         | ❌ 模型侧责任                                                                                                                                    |

**归属判定结论**：AigcForge 作为 Harness 层，可执行的防线集中在"渐进式披露、上下文重置、PGE 组装、机械卡点、盲审增强"五项；解码级/训练级机制记录为模型侧责任，不列入实施范围。CHOKE 警示为"机械验证优先"提供了研究级背书。

---

## 8. PGE 动态路由设计（成本优化）

PGE 多模型并联的 Token/延迟成本是实际部署的第一顾虑。核心解法：**Evaluator 成本分档 + 失败升级路由**——PGE 不是恒定架构，是按任务特征动态启停的验证策略。

### 8.1 关键洞察：机械验证器是"免费的 Evaluator"

PGE 的成本痛点只在 LLM Evaluator。而多数任务（尤其代码修改）的评估可完全机械化（typecheck/test/lint/引用校验）——确定性计算门**零额外 LLM 成本且从不幻觉**（CHOKE 警示反向印证）。因此路由的第一判断是：**任务能否被机械验证？能 → 不开 LLM Evaluator**。这是最大的成本节省点，波次 2 verifier 即此定位。

### 8.2 三级验证策略路由表

| 级别                     | 验证策略                                                               | 适用任务特征                                              | 相对成本 |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| L0 单模型 + 机械验证     | Generator 用主模型；Evaluator = verifier（typecheck/test/引用校验）    | 代码修改且可机械验证（默认路径）                          | 免费验证 |
| L1 单模型 + 小模型 Judge | 复用现有 `judgeMerge`（廉价模型 + 4 级 fallback）                      | 开放产出（文档/总结/设计/研究），机械不可验证             | 低       |
| L2 PGE 全三角色          | 多模型盲审（MARCH 式）：Planner 拆解 → Generator 执行 → 独立 Evaluator | 高风险 + 低机械可验证性（架构级重构/生产数据/跨模块 API） | 高       |

### 8.3 动态决策信号

- **任务特征（静态信号）**：意图分类（`classify`，已有）+ 改动拓扑（包/模块范围，波次 2 verifier 的包路径解析）+ 产出类型（代码 vs 文本）
- **失败历史（动态信号）**：机械验证连续失败次数 + doom_loop 触发次数——**失败升级（Escalation Router）**：L0 连续失败 ≥ N 次 → 升级 L1；L1 再失败 → 升级 L2 或升级基座模型。这是波次 1a doom_loop 检测器的自然延伸（同为"连续失败计数"语义，仅从"审批"扩展为"验证策略升级"）

### 8.4 升级基座 vs 开启 PGE 的正交权衡

- **基座升级解决"生成质量"（少犯错），PGE 解决"评估独立性"（能发现错）——正交，不可互相替代**（Fresh Eyes 原则：同模型自我评估存在确认偏差）
- 成本最优组合：
  - 可机械验证的任务 → **升基座比开 PGE 划算**（贵一点的生成 + 免费的验证 < 多模型多轮）
  - 不可机械验证的开放产出 → **小模型 Judge（L1）是必需品**，PGE 仅在风险升级时启用
  - 升级基座不改变 L0/L1 路由，只降低 Generator 的出错率；PGE 在风险维度上兜底

### 8.5 对 AigcForge 的落地路径（全部复用现有资产，无新架构）

1. 波次 2 verifier = L0 机械验证器（计算门，确定性的最终裁决权）
2. 验证失败计数 → 升级路由（复用 doom_loop 的环形缓冲语义）
3. `judgeMerge` 增强为 MARCH 式盲审（Checker 输入 = 原子 QA 命题对 + 原始文档，不含 Solver 原文）——现有 judge 已天然"只见产出"，增量是"命题化解构"
4. L2 全三角色复用现有 `task` 委派（subagent / judge / external-cli 三种委派模式）组装，不新建执行引擎

---

## 9. 临时记忆钩子：幻觉纠正持久化机制

> **新增日期**：2026-08-09
> **性质**：自救闭环的持久化层设计，补充 §5.3 的一次性 augment 方案的缺口

### 9.1 问题定义：检测结果是易失的

§5.3 的自救闭环设计为"检测 -> 散文报错 -> 喂回模型 -> 复验"。但散文报错是 augment 到 `Settlement.result.value` 的一次性注入，存在两个缺口：

| 时间线                  | augment 方式（一次性）       | 临时记忆钩子（持久化）                 |
| ----------------------- | ---------------------------- | -------------------------------------- |
| Turn N（检测到错误）    | 错误追加到工具结果           | 纠正写入钩子 Ref                       |
| Turn N+1                | 模型在工具结果中看到错误     | 模型在 SystemContext update 中看到纠正 |
| Turn N+5                | 错误仍在对话历史中           | 纠正仍在钩子中，每轮注入正确方向       |
| Turn N+20（compaction） | **错误可能被压缩掉**         | **纠正不受 compaction 影响**           |
| Turn N+30               | 模型可能忘记自己犯过这个错误 | 模型仍看到正确方向引导                 |

**核心价值**：compaction 是有损的。LLM 压缩历史时，"模型在 turn 5 声称文件 X 导出了函数 Y 但实际没有"这种具体错误信息很可能被丢掉。临时记忆钩子是独立于对话历史的存储，不受 compaction 影响。

### 9.2 核心设计原则：存纠正不存错误

**错误只出现一次，之后只保留正确方向。** 这基于三层 LLM 工程依据：

1. **注意力机制特性**：Transformer 注意力对所有上下文 token 分配权重。如果每轮注入"你在 turn 5 说错了，X 不是 Y"，"X 不是 Y"这个 token 序列反复出现，模型注意力可能反复关联回负面记录，反而强化错误模式关联。正确做法是：错误在工具结果中出现一次（让模型知道"我错了"），之后上下文只保留"X 是 Y"（正确事实），模型注意力始终对齐正确方向。

2. **上下文窗口是有限资源**：每轮注入累积错误历史持续消耗 token 预算。20 条错误记录可能占 500-800 token。而"已验证事实"列表用正面陈述，通常更简短。

3. **正向指令优于负向指令**：LLM prompt engineering 的基本经验--告诉模型"不要 import ./foo"不如告诉它"import 路径是 ./bar"。持续注入正确方向比持续提醒历史错误更能引导模型行为。

### 9.3 三模式钩子架构

钩子不是被动存储，是主动的**三模式**服务：

```
模式 1：记录（settle 后）
  外部检测器发现错误 -> 错误在 result.value 中出现一次（即时反馈）
  -> 钩子只记录纠正（不记录错误原文、不记录轮次、不记录"你错了"叙述）
  -> 存储：{ key, correct, wrong?, source }

模式 2：拦截（settle 前，advisory 不 blocking）
  模型发起工具调用 -> 钩子从 args 中提取路径/符号名
  -> 匹配纠正数据库中的 wrong 字段
  -> 命中：advisory warning 追加到 result.value（"此路径已纠正，正确值是 X。如确需使用旧值请忽略此提醒。"）
  -> 工具照常执行（不 blocking），模型自行决定是否调整
  -> 未命中：放行，无额外输出

模式 3：注入（SystemContext）
  每轮 turn 开始 -> reconcile 检测纠正库变化
  -> 注入"已验证事实"列表（只含 correct，不含 wrong，不含错误历史）
  -> 格式："Verified facts:\n- module X imports from ./bar\n- function Y is async, returns Promise<string>"
```

**与 doom_loop 的区别**：doom_loop 检测"完全相同的调用重复"（指纹匹配），是 blocking（走 PermissionV2 assert）；纠正钩子检测"同类型语义错误的重复"（已纠正的错误模式再次出现），是 advisory（追加 warning 但放行）。两者互补：纠正钩子给模型自我调整的机会，doom_loop 是重复行为的最终拦截。执行顺序：纠正钩子先（advisory），doom_loop 后（blocking）。

### 9.4 内容模型：分层提取 + 结构化存储

钩子存储的是**结构化事实**，不是原始文本。提取分四层：

| 层         | 来源                                      | 提取方式       | 精度                     | 可拦截 |
| ---------- | ----------------------------------------- | -------------- | ------------------------ | ------ |
| L1         | 检测器结构化输出（引用校验器/验证执行器） | 直接写入       | 高（机械检测，零歧义）   | ✅     |
| L2         | 用户纠正模式提取（正则+启发式）           | 模式匹配       | 中高（覆盖常见纠正模式） | ✅     |
| L3         | 无法结构化的用户纠正                      | 回退为原文标注 | 保留信息无匹配能力       | ❌     |
| L4（可选） | 模型主动记录                              | 工具调用       | 取决于模型判断           | ❌     |

**存储格式**（统一 schema）：

```ts
interface CorrectionEntry {
  key: string // 纠正对象标识（"function:foo:signature" / "import:module-X"）
  correct: string // 正确值（注入用，正向表述）
  wrong?: string // 错误值（拦截匹配用，可空）
  source: "reference-checker" | "verifier" | "user-correction" | "model-self" | "permission-corrected"
  extractLayer: 1 | 2 | 3 | 4
}
```

**L2 用户纠正提取流程**：

1. 检测纠正信号：机械匹配触发词（"不对"/"错了"/"应该是"/"no"/"wrong"/"should be"）
2. 提取纠正对象：结合模型最近输出做对照（"这个函数" -> 模型上一轮输出的 `foo`）
3. 提取正确值和错误值：模式匹配对比对（"不是同步的，是 async 的" -> `wrong="sync"`, `correct="async"`）
4. 组装结构化事实

**为什么不存原始用户输入**：注意力分散（否定句处理弱）、无法机械匹配、与对话历史冗余。

**为什么不用 LLM 优化**：循环依赖（用可能幻觉的模型提取防幻觉信息）、成本叠加、延迟。

### 9.5 缓存影响分析

**结论：正常轮次零缓存影响，compaction 后随 compaction 一起 break（不额外增加 break 次数）。**

证据链（代码级验证）：

1. **缓存前缀构成**：`cache-shape.ts:capture()` 只哈希 `[agent.info?.system, system.baseline]`（系统提示词）+ tool definitions + rewriteVersion。`messages` 数组（对话历史）不在缓存前缀中。

2. **ContextUpdated 事件去向**：`message-updater.ts:142` 把 `ContextUpdated` 事件转为 `SessionMessage.System`（系统消息），进入对话历史，不进入系统提示词。

3. **entriesForRunner 过滤**：`history.ts:41` 包含 `seq > baselineSeq` 的 system 消息。模型在 `messages` 中看到更新，但 `system` 参数不变。

4. **reconcile "Updated" 分支**：`context-epoch.ts:72-74` 返回 `stored.baseline`（不变），只通过事件发布更新。**baseline 不变 -> systemHash 不变 -> 前缀缓存保留。**

5. **compaction 后 "ReplacementReady"**：`context-epoch.ts:66-69` 调用 `SystemContext.replace`，重新加载所有源（包括纠正库 Ref），生成新 baseline。**baseline 变化 -> 缓存 break。** 但 compaction 本身 increment `rewriteVersion`，缓存本来就会 break。纠正库内容被合并进新 baseline，确保纠正信息在 compaction 后存活。

| 场景                      | baseline 变化             | 前缀缓存 | 额外影响                                        |
| ------------------------- | ------------------------- | -------- | ----------------------------------------------- |
| 正常轮次 + 纠正库无变化   | 不变                      | 保留     | 无                                              |
| 正常轮次 + 纠正库有新条目 | 不变（走 Updated 事件）   | 保留     | messages 多一条系统消息                         |
| compaction 后             | 变（走 ReplacementReady） | break    | 纠正库合并进新 baseline（不受 compaction 影响） |

### 9.6 其他影响与边界问题

**上下文窗口压力**：每次纠正写入产生一个 ContextUpdated 事件，成为对话历史中的系统消息。10 次纠正 = 10 条系统消息。每条较小（几行），但累积消耗 token 预算。compaction 后这些消息可能被压缩掉，但纠正内容已合并进新 baseline。容量控制：FIFO 环形缓冲，最多保留 20 条。

**settleTool 延迟**：

- 拦截模式（settle 前）：从 args 提取路径/符号名 + 匹配纠正库（N<20 字符串比较）~ 微秒级，可忽略
- 记录模式（settle 后）：Ref 更新 ~ 微秒级，可忽略
- 检测模式：复用阶段 A/B 的检测器延迟（5s + 60s），纠正库写入本身零延迟

**与 doom_loop 的交互**：两者都是 settleTool 中的 pre-settle 检查。执行顺序：纠正钩子先（advisory，给模型自我调整机会），doom_loop 后（blocking，最终拦截）。纠正钩子是 advisory 不 blocking，工具照常执行，doom_loop 独立运行。无冲突。

**拦截模式力度：advisory 不 blocking**。原因：(1) 误报风险--机械模式匹配无法区分"重复已纠正的错误"和"合理引用旧值"（如删除旧文件）；(2) 防线冗余--忽略 advisory 后 Stage A/B 检测器会捕获实际错误，完全重复则 doom_loop 拦截；(3) LLM 行为--advisory warning 含正确方向时模型通常调整，比硬性 blocking 更自然。warning 格式：`ℹ️ [纠正提醒] 此路径已纠正，正确值是 X。如确需使用旧值请忽略此提醒。`

**纠正过期：TTL 衰减 + 用户纠正豁免**。不做验证成功自动清除（验证成功 ≠ 纠正已内化，映射不精确且增加耦合）。

| 来源                             | TTL             | 拦截参与              | 注入参与          |
| -------------------------------- | --------------- | --------------------- | ----------------- |
| L1 检测器（引用校验/验证执行器） | 10 轮后退出拦截 | ✅ 10 轮内            | ✅ 直到 FIFO 驱逐 |
| L2 用户纠正模式提取              | 不过期          | ✅ 永久（session 内） | ✅ 直到 FIFO 驱逐 |
| L3 用户原文回退                  | 5 轮后移除      | ❌ 无 wrong 字段      | ✅ 5 轮内         |
| L4 模型主动记录（可选，暂不做）  | 不过期          | ❌                    | ✅ 直到 FIFO 驱逐 |

**会话范围**：纠正库 Location-scoped + SessionID 键控（同 doom_loop 模式），父子会话不共享纠正。委派场景中子会话通过 `composeParentSummary`（`task-driver.ts:385`）获得压缩的父上下文，纠正信息如果重要会被摘要保留。

**入口边界**：

- 检测器写入（L1）：阶段 A/B 的 Service 内部调用，不需要工具
- 用户纠正提取（L2）：在 `SessionInput.admit`（`input.ts:51`）路径中提取。admit 是用户消息进入系统的唯一入口，发布 `PromptAdmitted` 事件后、返回前调用 `CorrectionStore.extractFromUserMessage(sessionID, prompt.text)`。利用 admit 与 turn 执行的天然时间差（admit 先执行，wake 后异步拾取），纠正在同轮 turn 开始时已写入 Ref，`SystemContextRegistry.load()` 自然读到。提取是内存操作（模式匹配 + Ref 写入），微秒级，不阻塞 admit。
- 模型主动记录（L4，可选）：通过工具调用，暂不实施

### 9.7 敏感内容安全处理

用户纠正中可能包含敏感信息（API key、密码、token、文件内容片段）。如果被写入 CorrectionStore 并注入 SystemContext，会通过系统提示词发送给 LLM 提供商，违反 CLAUDE.md Clean Logs 门禁。

**策略：白名单提取 + 敏感模式拒绝 + L3 脱敏。**

**1. 提取白名单**（只提取以下技术性模式的纠正内容，拒绝存储自由文本）：

| 模式        | 示例                                       | 匹配方式                   |
| ----------- | ------------------------------------------ | -------------------------- |
| 文件路径    | `./src/foo.ts`, `packages/core/src/bar.ts` | 相对/绝对路径 + 已知扩展名 |
| Import 路径 | `./foo`, `@aigcfroge/llm`                  | 模块说明符                 |
| 类型签名    | `Promise<string>`, `Effect<void, Error>`   | TypeScript 类型表达式      |
| HTTP 方法   | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`    | 大写枚举                   |
| 标识符      | 函数名、类名、变量名                       | `[a-zA-Z_$][a-zA-Z0-9_$]*` |
| 布尔/枚举值 | `true`, `false`, `async`, `sync`           | 固定词集                   |

**2. 敏感模式黑名单**（检测到则拒绝存储整条纠正，只保留工具结果中的一次性 augment）：

```
sk-[a-zA-Z0-9]{20,}          # OpenAI API key
AKIA[A-Z0-9]{16}              # AWS access key
Bearer\s+[a-zA-Z0-9._-]+      # Bearer token
eyJ[a-zA-Z0-9._-]+\.          # JWT token
password\s*[=:]               # Password assignment
secret\s*[=:]                 # Secret assignment
token\s*[=:]                  # Token assignment
api[_-]?key\s*[=:]            # API key assignment
```

以及：值长度 > 200 字符（可能是文件内容片段）、来自 `.env`/`auth.json`/`credentials.*` 文件路径的上下文。

**3. L3 原文回退脱敏**：无法结构化提取、回退为用户原文时，先做敏感模式扫描。命中则**跳过该纠正**（不存储），只保留工具结果中的一次性 augment。确保敏感信息不通过 CorrectionStore 持久化注入。

**4. 为什么不用 LLM 脱敏**：用 LLM 判断"这段文字是否敏感"本身就是把敏感内容喂给 LLM，在脱敏完成前已经泄露。机械模式匹配是唯一安全的方案--在写入 CorrectionStore 之前完成扫描，敏感内容不进入 Ref、不进入 SystemContext、不进入 LLM 请求。

### 9.8 与实施计划的关系

临时记忆钩子是阶段 A/B 的**公共子模块**，不是独立阶段。实施顺序：

1. 先建 `CorrectionStore` Service + SystemContext 源（阶段 A 开始前）
2. 阶段 A 引用校验器检测到悬空链接 -> 写入 CorrectionStore
3. 阶段 B 验证执行器检测到 typecheck 失败 -> 写入 CorrectionStore
4. settleTool 集成拦截模式（模式 2）
5. 用户纠正提取（L2）作为独立增强项，可在阶段 A/B 之后添加

---

## 参考

- Anthropic: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09)
- Anthropic: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- GitHub 开源：`receipts`、`literature-review-hardened`、`verifiable-legal-rag`、`claude-skill-citation-checker`、`sentinel-agentic-rag`、`trustworthy-llm-framework`
- 内部协议：`第一性原理与智能体.md`、`Agent Harness 7层核心功能具象化与问题解决机制深度调研.md`、`Harness工程与智能体开发.md`、`AI智能体协议研究.md`
- 外部项目：jinnang（`文档即代码：工程实践与AI助手.md`、`05_全站内容卡片原子结构与抗幻觉执行蓝图.md`）
