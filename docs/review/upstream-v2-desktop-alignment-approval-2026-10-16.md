# AigcForge 对齐上游 v2 桌面端实施方案技术审批记录

> **审批日期**：2026-10-16  
> **审批对象**：[docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md](../research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md)  
> **审批状态**：**APPROVED_WITH_CAVEATS_FOR_R0**（限定技术审批通过：放行 R0 基座搭建与裁剪；R1~R5 须满足切片门禁方可开工）  
> **主审角色**：AigcForge 高级全栈开发顾问 / 架构质量委员会  
> **最高约束**：[CLAUDE.md](../../CLAUDE.md) · [AGENTS.md](../../AGENTS.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) · [docs/technical-debt.md](../../docs/technical-debt.md) §15

---

## 1. 审批范围与前置裁定

本次是对《AigcForge 对齐上游 OpenCode v2 完整桌面端架构调研与实施方案》（2026-10-16 定稿）的**正式技术审批与工程可行性裁决**。

### 1.1 明确批准的范围

1. **策略 A（渐进式 Re-fork + 双周窗口制）**：批准以上游 `upstream/v2` HEAD（`461721082`）为基座，在 `/home/keer/workspace/aigcfroge-v2`（分支 `v2-dev`）上展开工作；
2. **桌面端 19 包依赖闭包**：批准保留 `schema`、`core`、`desktop`、`gui-extensions`、`client` 等 19 个基座包，批准退役 `tui`、`cli`、`sdk`、`effect-sqlite-node`、`effect-drizzle-sqlite`；
3. **自研资产完整性保障**：批准全量保留 5 大真实产品模式（`coding`、`work`、`assistant`、`chat`、`custom`）、Meta-Agent 持久委派、Anti-Hallucination 防幻觉门禁、Todo-Task 系统、Import-Parser、统一资产系统、Break-glass 权限盾牌等 11 大业务资产（1,707 个闭包文件）；
4. **终端引擎升级**：批准将桌面内置终端无缝迁移至 `ghostty-web`（WASM）引擎。

### 1.2 明确禁止的违规行为

- 严禁在 `main` 生产分支直接打补丁或强推大重构；
- 严禁使用未经验证的 3-way merge 强行合并双侧分歧代码；
- 严禁为了“求快通过”而在新基座中使用 `as any`、`@ts-ignore` 绕过类型系统（违背 CLAUDE.md No Cheating 原则）。

---

## 2. 审查依据与事实证据链

- **执行宪法**：[CLAUDE.md](../../CLAUDE.md)（九荣九耻、四大拒绝、极致减法、根因收敛、改完即审）；
- **架构协议**：[AGENTS.md](../../AGENTS.md)（Session V2 8 大不变量、Effect 编码规范、Schema 纯度要求）；
- **历史证据**：祖先分叉点 `116ac93` 对照比对、权威移植文件清单 `data/desktop-closure-porting.txt`（1,707 文件）；
- **债务台账**：[docs/technical-debt.md](../../docs/technical-debt.md) §15（上游 v2 同步规划债务）。

---

## 3. 主审审计发现与红线修订要求（Audit Findings）

主审在方案审查中识别出 5 项关键工程风险，必须作为硬性约束写入实施规约：

### A01 · [P0] 1,707 个文件移植粒度过粗，缺乏原子切片（Slice Checkpoints）

- **风险分析**：原方案中 R2 阶段（Core 544 文件）和 R3 阶段（App 496 文件）范围过大，如果一次性集中提交，一旦测试红灯将极难定位根因，破坏“根因收敛”原则。
- **强制修订**：
  R2 和 R3 必须严格细化为**原子功能切片（Atomic Slices）**，每切片遵循独立的“红测试 $\to$ 移植 $\to$ 绿测试 $\to$ 检查点报告”循环：
  - **Slice 2.1 (Core 地基)**：System Context 代数、Epoch 持久化与 Session V2 准入语义；
  - **Slice 2.2 (核心执行)**：SessionExecution 调度、Event Replay 与 Provider Turn 约束；
  - **Slice 2.3 (资产子系统)**：7 大资产域（agent, prompt, skill, command, mcp, plugin, workflow）；
  - **Slice 2.4 (Work & Review)**：Work 模式、Task Driver 与 Work Review Lifecycle 审查合同；
  - **Slice 2.5 (Assistant & 记忆)**：Assistant 模式、personal-memory 与知识库 KB 集成；
  - **Slice 2.6 (Custom & 编排)**：Custom Mode 组合平台（ADR-17~21）、Workflow DAG Runner；
  - **Slice 2.7 (防幻觉与工具)**：Anti-Hallucination 校验门禁、Doom Loop 拦截与工具注册。

### A02 · [P1] 数据库 Migration 序列归并缺少沙箱回放硬门禁

- **风险分析**：上游分叉后增加了 `drafts`、`state`、`blob-touched`、`extension` 等迁移；本仓也新增了多项针对 custom/asset/session 的迁移。方案仅提“追加尾部并重排时间戳”，未防范外键冲突与列覆盖。
- **强制修订**：
  在 R2 阶段合入前，必须建立 `test/migration/db-upgrade-simulation.test.ts` 沙箱用例：
  1. 取线上老版本真实 SQLite 库快照；
  2. 顺序执行重排后的 Migration 链条；
  3. 逐表校验字段完整性与数据可读性；演练通过前严禁合入生产迁移文件。

### A03 · [P1] 桌面主进程与 Sidecar 认证握手协议分歧

- **风险分析**：上游桌面采用 `@opencode/client` 的 `service.json` 自动探测机制，本仓采用环境变量固定 Token 模式。若协议未收敛，渲染层将直接报 401 鉴权失败白屏。
- **强制修订**：
  在 R0 结束前，必须固定统一的 `SidecarCredentials` 契约，统一握手标准，并在 `packages/desktop/src/main/service/background-service.ts` 补齐模拟启动集成测试。

### A04 · [P2] `ghostty-web` WebAssembly 资产打包丢失隐患

- **风险分析**：`ghostty-web` 核心依赖 `.wasm` 二进制文件。若 Vite / Electron-Builder 未配置 WASM 资产复制，本地开发正常，但打包后的 dmg / exe / AppImage 会因 WASM 404 导致终端打不开。
- **强制修订**：
  在 R4 阶段必须核验 `packages/desktop/electron.vite.config.ts` 中的 Rollup 静态资源复制规则，并在 CI 中增加对打包后产物解包并校验 `ghostty-web.wasm` 存在的硬断言。

### A05 · [P2] 上游 `ai` 与自研 `@aigcfroge/llm` 抽象共存的下放路径

- **风险分析**：上游 Core 硬依赖 `ai` 包；本仓保留了 native `@aigcfroge/llm` 实验层。如果两者在 Core 内被不同模块混用，会导致事件流分裂。
- **强制修订**：
  维持分层契约：默认运行时走上游 `ai`（保证全仓稳定），自研 `@aigcfroge/llm` 仅在 `AIGCFROGE_EXPERIMENTAL_NATIVE_LLM=true` 时作为可选下放适配器挂载，严禁双底座混交。

---

## 4. 方案对冲与技术债务核验

审查确认，方案已严格贯彻“方案对冲”要求，对以下技术债务做了真实披露，已同步备案至 `docs/technical-debt.md` §15：

- **双轨维护税**：接受 `main` 与 `v2-dev` 短期双轨并存，对 `main` 实施架构冻结；
- **改名桥维护税**：接受每次吸收上游补丁需执行三段式 Codemod；
- **包退役集**：确认 `tui`/`cli`/`sdk` 退出历史舞台，由 GUI 桌面端与 client 生成链全面接管。

---

## 5. 阶段性放行决议与门禁清单

| 阶段                 |     放行裁决     | 必需解锁前置条件                                                                     |
| :------------------- | :--------------: | :----------------------------------------------------------------------------------- |
| **R0 基座构建**      | **【立即放行】** | 裁剪至 19 个基座包，执行改名桥，全仓 `bun turbo typecheck` 绿灯。                    |
| **R1 Schema 契约**   |  **待 R0 验收**  | 66 个 Schema 契约移植，自研 API 端点入 `protocol`，生成 `client` 零漂移。            |
| **R2 Core 切片移植** |  **待 R1 验收**  | 拆分为 Slice 2.1 ~ 2.7 逐片落地；沙箱 DB 升级演练通过；Session V2 8 不变量测试全绿。 |
| **R3 UI 渲染回放**   |  **待 R2 验收**  | 接驳 `@opencode/app/desktop`；5 模式界面渲染与状态恢复正常。                         |
| **R4 桌面组装**      |  **待 R3 验收**  | Sidecar 握手打通；`ghostty-web` WASM 打包无误；桌面端实机冷启动成功。                |
| **R5 Cutover 合并**  |  **待 R4 验收**  | 全量 E2E 绿灯；存量数据库迁移 100% 成功；终审签字后方可切回 `main`。                 |

---

## 6. 最终审批结论

```text
================================================================================
审批结论：APPROVED_WITH_CAVEATS_FOR_R0
主审判定：方案调研详尽，证据链完整，架构设计高度契合 CLAUDE.md 宪法原则。
针对 A01~A05 提出的安全修订已作为硬性红线并入工程管理。
准予立即在 /home/keer/workspace/aigcfroge-v2 工作区启动 R0 阶段实施！
================================================================================
```

---

## 7. 复审补充记录（2026-10-16 第二轮 · R0 开工前实测取证）

主审在 `main`（@ d5376379f）与 v2 基座（@ 461721082）执行实测复核：确认前审 A01~A05 依然有效，另发现并裁定以下 7 项，均已回写方案正文闭环。

| 编号 | 级别 | 实测发现                                                                                                                                                                                                                                          | 裁定与修复                                                   |
| :--- | :--: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------- |
| F1   |  P1  | §5.2 裁剪清单不完整：基座实有 35 包 = 20 保留目录 + 15 剔除目录，原文仅列 7 个，且含上游已不存在的 `effect-sqlite-node`；遗漏 `console/containers/enterprise/function/identity/posts/stats/web/script` 与 `services/*`                            | 已补全 §5.2（含 root `package.json`/`turbo.json` 联动清理）  |
| F2   |  P1  | 剔除 `cli` 与权威闭包统计（含 384 个 `aigcfroge` 入口文件、22 个 `llm` 文件）自相矛盾，且 R0~R5 无窗口归属                                                                                                                                        | 已新增 §5.3：R4 瘦 sidecar 入口包回植，`llm` 按 A05 契约回植 |
| F3   |  P1  | §7 codemod 豁免缺失外部 npm 包名：`@opencode-ai/*`、`@brendonovich/vite-plugin-opencode`、`opencode-gitlab-auth`（fork 先例 `packages/aigcfroge/src/plugin/index.ts` 保持原名 import）。一刀切改名将产出不存在的 npm 包名，直接摧毁 `bun install` | 已扩充 §7 豁免白名单                                         |
| F4   |  P2  | 正文引用 `data/desktop-closure-porting.txt` 路径悬空（实际位于 `docs/research/upstream-v2-sync/data/`，仓库根无 `data/`）                                                                                                                         | 已修正引用                                                   |
| F5   |  P2  | v2 基座为 depth=1 浅克隆，`116ac93` 不可本地复核；扫描快照对标 upstream @ `55dde88`（2026-10-10），与基线 `461721082` 存在 6 天漂移                                                                                                               | 已在 §9.1 披露；R1 前重跑 `scan-divergence.sh`               |
| F6   |  P2  | R0 工作项未列明 root `package.json` 8 个失效脚本与 `turbo.json` 8 处退役包 task 条目的清理                                                                                                                                                        | 已并入 §5.2 与 §8 R0 行                                      |
| F7   |  P2  | `.opencode/` → `.aigcfroge/` 目录级与文件名级 codemod 未入规格（fork `83e3651f6` 已有先例：`.opencode/` → `.aigcfroge/`、`opencode.jsonc` → `aigcfroge.jsonc`、`provider/opencode.ts` → `provider/aigcfroge.ts`）                                 | 已扩充 §7 第 4 条                                            |

**复核成立项**：1,707 闭包统计及 R1~R3 分包数字与权威文件逐项吻合（SUM=1707 ✓）；双 HEAD 快照准确 ✓；19 包闭包在 package.json 与源码 import 两层均不依赖 15 个剔除包（`@opencode/cli` 命中为 `@opencode/client` 前缀误报，已排除）✓；`script/sdk-docs.ts` 实为 gui-extensions SDK 文档检查器，裁剪后 root `lint` 脚本仍有效 ✓；`patches/` 无 opencode 外部包补丁 ✓。

**复审终裁：F1~F7 修复闭环，R0 维持放行，即刻在 `/home/keer/workspace/aigcfroge-v2` 开工。**
