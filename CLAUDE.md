# CLAUDE.md — AigcForge 执行宪法

> **角色**: 高级全栈工程师
> **范围**: 仅约束 `aigcfroge/` 仓库（17 个 workspace 包：入口 {aigcfroge, tui, desktop} · 应用 {app, server, script} · 领域 {core, llm, schema, sdk/js} · UI {ui, session-ui, storybook} · 扩展 {plugin} · 基础设施 {effect-drizzle-sqlite, effect-sqlite-node, http-recorder}，详见 [ARCHITECTURE.md](ARCHITECTURE.md) §3）
> **性质**: 入口文件，承载第一性原理 + 文档路由

`AGENTS.md` · `DESIGN.md` · `ARCHITECTURE.md` · `packages/aigcfroge/AGENTS.md` · `packages/llm/AGENTS.md`

---

## 第一性原理（所有任务强制首读）

### 九荣九耻

- 以瞎猜接口为耻，以认真查询为荣。
- 以模糊执行为耻，以寻求确认为荣。
- 以臆想业务为耻，以人类确认为荣。
- 以创造接口为耻，以复用现有为荣。
- 以跳过验证为耻，以主动测试为荣。
- 以破坏架构为耻，以遵循规范为荣。
- 以假装理解为耻，以诚实无知为荣。
- 以盲目修改为耻，以谨慎重构为荣。
- 以治标敷衍为耻，以溯源根治为荣。

### 四大拒绝

| 原则                        | 行为                                   |
| --------------------------- | -------------------------------------- |
| **拒绝默认假设 → 追问动机** | 不要直接执行模糊需求。先问"为什么要做" |
| **拒绝低效路径 → 提出优化** | 如果想到更优方案，必须在执行前提出     |
| **拒绝表面回答 → 追溯根因** | 不修现象，只解决本质问题               |
| **拒绝废话文学 → 精简输出** | 输出即生产力                           |

### 强制思考流程

复杂决策必须走完：

```
识别假设 → 追溯本源 → 重构方案 → 精简输出
```

### 根因收敛

面对多个同现错误或失败时，**不逐个修现象，而是找到它们共享的根因**。收敛的标志是"修一个点，好一片面"。

**收敛三步法**：
1. **归类** — 把所有报错按类型分组（编译错误、运行时 Service not found、超时、环境差异），而不是按文件分组
2. **找交集** — 每个分组里，追问"这些错误背后的共同前提是什么？"例：10 个不同的 "Service not found" 可能共享同一个 Layer 组合缺口
3. **一击必杀** — 修复那个共同根因，验证该分组全部消失。如果有新分组冒出来，重复三步

**收敛 vs 不收敛的典型对比**：

| 行为 | 不收敛 | 收敛 |
|------|--------|------|
| **多个 Service not found** | 每个缺啥补啥，跑一轮冒新的 | 检查 Layer 组合根，一次修复全部 |
| **版本检测异常** | 针对现象写兼容代码 | 追溯环境变量污染，清理源头 |
| **构建挂死** | 加超时参数 | 检查底层依赖（无 timeout 的网络 fetch），修复调用方 |

### 极致减法和方案对冲

- **极致减法**：修复优先级：**复用 → 删除 → 归并 → 重构 → 新增**。复用归一化是基础，新增即负债，删除即资产。
- **方案对冲**：面对复杂任务，必须对比“简单实现”与“健壮架构”。如果选择了简单实现，必须显式向用户声明技术债。
---

## 项目边界

| 边界                | 规则                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **测试**            | 只在单个包内跑 `bun test`，永不从根目录跑。命令：`bun --cwd packages/<name> test --timeout 30000`                                                                                                          |
| **类型检查**        | 使用 `tsgo --noEmit` 而非 `tsc`。日常用单包：`bun --cwd packages/<name> typecheck`；全仓 `bun turbo typecheck` 留给 CI。`app`/`desktop` 用 `tsgo -b`；`script`/`storybook` 无 typecheck 脚本           |
| **Lint**            | 日常用增量：`bun run script/lint-changed.ts`（只查改动文件新增行）；全量 `bun run lint`（= `oxlint` 全仓 + `lint-changed.ts`）留给 CI。配置见 `.oxlintrc.json`：`typeAware: true` + `suspicious: warn` + 20+ 规则覆写                                                                                                   |
| **Format**          | Prettier：`semi: false, printWidth: 120`，无 pre-commit hook；`.husky/pre-push` 跑 `bun typecheck`，可用 `AIGCFROGE_SKIP_TYPECHECK=1` 跳过                                                                                                         |
| **模块组织**        | 新代码使用 `export * as Foo from "./foo"` 自导出模式。禁止新增 `export namespace`；已有 namespace 不顺手迁移。Barrel `index.ts` 由各包 `AGENTS.md` 自治（aigcfroge 禁多兄弟，llm 允许 `schema/`/`route/`） |
| **Effect 编码**     | `Effect.gen(function* () {})` 组合、`Effect.fn("Domain.method")` 命名效果。无 `Effect.fork`/`forkDaemon`，用 `Effect.forkIn(scope)`                                                                        |
| **Schema**          | 多字段用 `Schema.Class`，单值用 `Schema.brand`，错误用 `Schema.TaggedErrorClass`，defect 用 `Schema.Defect`。优先用 `Effect.void` 而非 `Effect.succeed(undefined)`                                         |
| **测试同步**        | 禁止 `Effect.sleep(N)` 等待并发 fiber。用 `pollWithTimeout`、`Deferred`、`SessionStatus.Service` 等就绪信号                                                                                                |
| **测试双端**        | 使用 `testEffect()` 代替手写 runtime。`Layer.mock` 代替手写 stub                                                                                                                                           |
| **CSS / 主题**      | 所有颜色/间距/圆角引用 CSS 变量，禁止硬编码。新组件优先使用 v2 Token（`--v2-*`）                                                                                                                           |
| **Subpath imports** | 平台条件导入走 `#sqlite`、`#pty`、`#fff`、`#db`，勿直接写 `.bun.ts`/`.node.ts`                                                                                                                             |
| **LLM 层**          | 默认 AI SDK 路径。原生 `@aigcfroge/llm` 需 `AIGCFROGE_EXPERIMENTAL_NATIVE_LLM=true`                                                                                                                        |

---

## 边界与运行安全

| 门禁                 | 强制规则                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Catch Everything** | 所有 Effect 边界必须兜底：外部 API 调用、文件/网络/子进程、SSE/JSON 解析。禁止未处理 Promise 和静默失败           |
| **No Null Pointer**  | 外部输入、配置、缓存、localStorage、IPC payload、DOM ref、可选字段必须先判空或收窄。禁止无理由非空断言和 `as any` |
| **Security First**   | 路径/命令/URL 先校验再使用。防止路径穿越、命令注入、XSS。所有颜色/图标/文案走项目 Token/Icon/i18n 系统            |

---

## 工程规约与整洁

| 门禁             | 强制规则                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No Cheating**  | 新代码禁止无理由 `as any`、`@ts-ignore`、绕过 mapper/registry、假测试、吞异常。类型负测试可用 `@ts-expect-error`；兼容第三方类型逃逸必须注释原因。`packages/effect-drizzle-sqlite` 与 `packages/effect-sqlite-node` 为 vendor 桥接代码，不纳入门禁统计                                                                                                  |
| **Reusability**  | 新增 helper、组件、route、schema、adapter 前先查 owner module。扩展现有模块，不新建平行实现                                                                                                                                                                                                                                                             |
| **Clean Logs**   | 禁止输出 API key、token、Authorization、完整 prompt、用户文件内容。敏感值必须脱敏                                                                                                                                                                                                                                                                       |
| **代码检索分层** | 符号定义/调用链/重构影响面->首选 codegraph MCP（`search`/`node`/`callers`/`callees`/`impact` 无预算限；`explore` 限 2 次/项目，留给多文件源码聚合，单符号先用 `search`/`node`）；字符串字面量/正则/路径模式->Grep/Glob（codegraph 是符号级索引，找 flag/error msg/i18n key 的每次使用必须 Grep）；单点行范围->Read。codegraph 只读，修改仍用 Edit/Write |

---

## 改完即审流程

1. **确认影响面**：`git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. **匹配 Skills**：涉及主题/配色走 `frontend-theming`；涉及 Effect 编码走 `effect`；涉及数据库走 `database`；涉及重构与代码标准走 `enterprise-code-standard` / `reuse-first-refactor`；涉及质量交付门禁走 `quality-to-pr`；UI 组件/无障碍/硬编码规范见 `DESIGN.md`
3. **安全复查**：逐项检查 Catch Everything、No Null Pointer、Security First
4. **整洁复查**：逐项检查 No Cheating、Reusability、Clean Logs
5. **数据流追踪**：追踪每个改动的完整调用链——数据从哪里来、经过哪层、最终到哪。确认每个 Effect 的 Layer 依赖已被 provide。确认 import 的模块真实存在。确认条件分支两端都有实际执行路径。架构边界见 `ARCHITECTURE.md`
6. **命令验证**：运行 `bun run script/lint-changed.ts`（增量 lint）+ 受影响包的 `typecheck`（`bun --cwd packages/<name> typecheck`）+ **受影响包的 `test`**（可指定单个测试文件：`bun --cwd packages/<name> test path/to/file.test.ts`）；typecheck 通过不代表行为正确；文档-only 改动可只做链接、事实和 `git diff` 验证
7. **输出复查结论**：

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:
- 剩余风险:但声明风险≠可以向用户撒谎。
```

---

> **执行协议**: [AGENTS.md](AGENTS.md)（代码风格、分支提交、Effect 编码、Schema、测试）
> **设计协议**: [DESIGN.md](DESIGN.md)（产品 UI 性格、技术栈、Token、组件、i18n、无障碍、验证）
> **架构协议**: [ARCHITECTURE.md](ARCHITECTURE.md)（系统结构、包拓扑、子系统边界、数据流）
> **技能文件**: `.aigcfroge/skills/`（`protocols` 双向协议路由、`enterprise-code-standard` 企业级代码标准、`reuse-first-refactor` 复用优先重构、`quality-to-pr` 端到端交付；以及 `frontend-theming`、`effect`、`database` 专题技能）

## 已知技术负债

| 负债 | 包 | 风险 | Owner | 到期日 |
|---|---|---|---|---|
| @ai-sdk/google patch 未上游化 | root patches/ | 功能补丁可能滞后 | TBD | 上游监控 |
| dompurify 锁定 3.4.6 | session-ui | 残留 moderate advisory（IN_PLACE/setConfig/hook 污染类，本仓静态配置+单 hook 用法不可达）；≥3.4.7 与 happy-dom 探针环境不兼容（p/a/svg 被误剥、foreignObject 误放），升级前须先迁移探针到真实浏览器环境 | TBD | 2026-08-27 |
| 工具活动 doom_loop 拦截统计依赖 runner 错误文案匹配（"blocked by doom_loop approval"） | app | `session/runner/llm.ts` 文案变更会静默漏计；且只覆盖 denied/rejected，CorrectedError 反馈不计入。根治：事件层为 tool error 加结构化标记（如 `cause: "doom-loop"`），UI 按字段判断 | TBD | 事件层加标记时 |
| 工具活动统计随会话压缩缩水 | app | 统计基于消息 parts，compaction 重写历史后旧 part 被丢弃，计数仅反映当前上下文窗口。根治：event/DB 层聚合持久统计，UI 只读 | TBD | 需要持久指标时 |
| 多文件不符合 Prettier 格式规范 | 全仓 | 仓库无 pre-commit format hook，部分文件（如 `verifier.ts`、`reference-checker.ts`）在 main 就不符合 prettier 格式；分支审查时难以区分新旧格式问题。根治：统一跑 `prettier --write` 全仓格式化一次，配合 CI 加 format check 门禁 | TBD | 下次全仓 lint 清理时 |
| Chat 模式下 meta 默认权限依赖前置拦截与 ADR-13 Amendment-2 约束 | core / aigcfroge | 未彻底收敛为不可配置的只读沙箱，依赖 policy 层 fail-closed 门禁保证安全 | TBD | 权限沙箱重构时 |
| workflow/plugin 未建 typed service 而是 handler 内联写事务 | aigcfroge | 虽已复用 FileMutation 与 KeyedMutex 恢复 5 大不变量，但未在 core 层封装为标准 Service | TBD | 统一资产服务重构时 |
| chat 模式下 repeat-detection 启发式分词与语言支持不完备 | app | 采用混合分词与单 token 旁路，长文本混合场景可能存在边界漂移 | TBD | 意图识别升级时 |
| Import-parser 多候选同名时依赖后缀 disambiguation | core | 导入包含多个同名未命名代码块时生成序号后缀，需依赖后续用户在 UI 侧重命名 | TBD | 导入流增强时 |
| 资产 apply/delete 缺非会话路由，工作台伪造 sessionID | aigcfroge / app | 路由为 `/session/:sessionID/<kind>-asset/...`，模式首页无会话上下文，前端填 `"ses-home-delete"`；`SessionID` 只校验 `startsWith("ses")` 故静默通过，审计归属链断裂（PRD §8.3.1 已声明 sessionID 非写边界前提，故非安全缺陷）。范围与决定见 [Chat PRD §20.6](docs/prd/chat-mode-creation-layer.md) | TBD | 下次资产端点改动时 |
| meta 在非 coding 模式下无法委派 build，且无兜底出路 | core | `checkPrimaryAgent` 在 chat/work/assistant 三模式只放行 `meta` 与对应 orchestrator，故 `task → build` 被拒；meta 提示词的 "retry once, then switch engine" 在这些模式下每个备选引擎同样被拒，形成死路。当前各模式靠自己的 typed 写工具（`propose_*_asset` / `work-preset` / `reminder_*`）落盘，设计上成立，但拒绝信息未告知模型该模式可用的替代路径。根治：模式作用域权限叠加（per-agent-per-mode 信封），或在拒绝时返回该模式的可用引擎清单 | TBD | Assistant M4 跨信道前 |
