# M3 审批记录：声明式配置 + registry 收敛 + 探测解冻（2026-08-06，通过，含审批方修复）

> 审批对象：执行智能体按 `docs/plan/prompt-external-cli-dispatch.md`（通用前置 + M1 补丁 + M2 补丁 + M3）产出的改动。
> 方案依据：`docs/plan/external-cli-dispatch-implementation.md` §5。前置：M1/M2 已通过（同目录 m1/m2 review）。
> 分支 `external-cli-core-fix`，M1–M3 累积改动未提交。

## 1. 改动清单（执行方交付）

| 文件 | 摘要 |
|---|---|
| `packages/core/src/config/cli-agent.ts`（新建） | `ConfigCliAgent.Info` schema：command/description/args（`{prompt}`/`{resumeId}` 占位）/output（claude-jsonl、codex-jsonl、plain）/timeout |
| `packages/core/src/tool/cli-config-adapter.ts`（新建） | `fromConfig(name, info)` 工厂：配置条目物化为标准 `CliAdapter`，output 策略复用既有三种 parser |
| `packages/core/src/config.ts:66` | V2 `Config.Info` 增 `cli_agents` 可选 Record |
| `packages/core/src/v1/config/{config.ts:114,migrate.ts:73}` | V1 schema 同步 + V1→V2 migrate 透传 |
| `packages/core/src/tool/cli-adapter.ts` | 新增 `registerConfigCliAdapters(entries)`：config 条目注册进同一 cell，同名覆盖内置（config > built-in） |
| `packages/core/src/session/task-driver-fill.ts:75-84` | 组合根接线：注册四个内置适配器后，有 Config.Service 时注册 `cli_agents` 条目（`Effect.catch` 容错） |
| `packages/aigcfroge/src/agent/meta/adapters/registry.ts` | **registry 收敛**：aigcfroge 侧服务变为 core module cell 的薄 Effect 包装，`@` 列表与 task 工具同一存储，规避 M1 组合根双 registry 陷阱 |
| `packages/core/src/util/which.ts` | PATH 兜底（解冻 3）：显式空 PATH（GUI 启动）权威不静默替换；无 PATH 时回退 login-shell PATH + 常见 bin 目录（~/.local/bin、/usr/local/bin、/opt/homebrew/bin） |
| `packages/core/src/tool/cli-timeout.ts` | 支持 adapter.timeout 覆盖默认超时 |
| 解冻 1/2/3 | 解冻 1（meta prompt 填充）、解冻 3（PATH）落地；解冻 2（server SSE 热更）按方案降级为 composer 重拉并声明技术债 |
| 测试 | `core/test/cli-config-adapter.test.ts`（7 用例工厂契约）、`core/test/config/cli-agent.test.ts`（5 用例 schema 契约）、`core/test/util/which.test.ts`、`aigcfroge/test/agent/meta/adapters/registry.test.ts` 新增 2 用例（config 合并、config 覆盖内置） |

## 2. 审批方修复（4 项，均已验证）

1. **解冻 1 未闭环（真问题，根因在更深处）**：执行方交付的 `MetaPrompt.Service.fill` 无生产调用方；且 `packages/core/src/plugin/agent.ts:402` 在 plugin init 时把 `{{CLI_LIST}}` 预填为空占位 `(no external CLI tools configured)`，消费掉占位符——后注册的 MetaPromptFiller transform 即使执行也是 no-op，生产 meta 提示词永远显示空占位。修复：
   - `packages/core/src/agent/meta/meta-prompt.ts`：新增 `NO_CLI_MESSAGE` 常量；`fillCliList` 改为**顺序无关**——有 `{{CLI_LIST}}` 替换占位符，否则替换 NO_CLI_MESSAGE 标记（幂等可重填，任意 transform 顺序安全）。
   - `packages/aigcfroge/src/agent/meta/meta-prompt-filler.ts`：transform 改为 effectful，每次 reload 实时 `cliNames()`；另加 60s 周期 re-detect（`Effect.repeat` + `Schedule.fixed` + `Effect.forkScoped`），名单变化时 `agentV2.reload()`（state.ts materialize 每次从 initial 重建+重放 transform，无重复填充）。
   - 新增用例：core `meta-agent-integration.test.ts`「fillCliList refills an earlier empty fill」；aigcfroge `meta-prompt-filler.test.ts`「meta agent system prompt reflects CLI changes across reloads」（productionLayer 钉死 AgentV2.layer→template→filler 构建顺序，验证 cli-a→+cli-b 跨 reload 生效）。
2. **死代码清理**：aigcfroge 本地 `src/agent/meta/adapters/{claude-code,gemini,codex}.ts` 三文件在 registry 收敛后无任何引用（registry 已改从 core 导入），按极致减法删除；`interface.ts`（registry 类型引用）、`delegation-parser.ts`（有独立测试）、`timeout.ts`（V1 task 引用）保留。
3. **lint 新增 warning 清零**（M1 补丁第 1 条）：删除 `core/test/config/cli-agent.test.ts` 未使用的 `ConfigCliAgent` import。

## 3. 验证证据（审批方独立复跑）

- core 聚焦：`meta-agent-integration` 5 pass、`cli-config-adapter` + `config/cli-agent` + `util/which` 共 20 pass。
- aigcfroge 聚焦：`meta-prompt-filler` 2 pass（含修复新增 reload 用例）、`agent/meta/adapters/` 12 pass。
- core 全量：1554 pass / 0 fail（196 文件）；aigcfroge 全量：3155 pass / 0 fail（262 文件，22 skip / 1 todo 为既有）。
- typecheck：core + aigcfroge（`tsgo --noEmit`）通过（死文件删除后复跑亦通过）。
- `bun run lint`：0 error，warning 仅剩 M1 已登记的既有项 `core/src/session/task.ts:71`（非本次引入；新增的未使用 import 已由审批方清理）。

## 4. 偏差声明（执行方主动申报，审批接受）

- **解冻 2（server SSE 热更）降级**：按方案既定降级路径走 composer 重拉，声明为技术债。**接受**；M5 ACP 落地前若热更诉求增强再复议。
- 后台全量日志的 decode failed 输出为既有测试噪声（0 fail），非本次引入。

## 5. 审批结论

**M3 通过验收（含审批方 3 项修复）。** 声明式配置闭环（装二进制 + 5 行配置免重启生效）、registry 单份收敛、PATH 探测兜底三目标达成；解冻 1 的 live-fill 断链由审批方补齐并经跨 reload 测试验证。门禁达标：registry 采用 core cell 单存储 + aigcfroge 薄包装（等价单一 registry）、config 覆盖内置语义有测试、无 star/alias import、schema 负测试齐全。

## 6. 额外发现（不在本次修复范围）

- `registerConfigCliAdapters` 仅在 TaskDriverFill 组合根接线；server 端如另有独立组合根需确认同样经过该路径（当前已核实 server 经 handlers → TaskDriverFill，无遗漏）。
- 60s 周期 re-detect 是轮询方案，成本极低；若 M5 ACP 提供 capability 推送可再收敛。
- 解冻 2 技术债：config 热更目前靠 composer 重拉 + 60s re-detect 双通道兜底，SSE 推送仍为终态。

## 7. 下一步

M4（transport 抽象 + claude/codex 官方 SDK 适配器）开工。M1–M3 手动验收项（tmux TUI 卡片、子会话双消息、配置新增 CLI 免重启出现在 @ 列表与 meta prompt）建议 M4 前一并人工核对。
