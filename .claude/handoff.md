# Chat Mode M1 实施交接

## 已完成的工作

已完成 Phase A~D.5 全部核心代码，通过 53 个测试，0 失败。

## 实现概览

### Phase A — Schema + Path + Atomic Write

- `packages/schema/src/prompt-asset.ts` — `Summary`/`Info`/`Frontmatter`/`Candidate` Schema.Class + `Name`/`Description`/`Revision`/`Template` 品牌约束 + 7 个 TaggedErrorClass
- `packages/schema/src/index.ts` — 添加 `PromptAsset` 导出
- `packages/core/src/prompt-asset/path.ts` — `isValidSegment`/`validateRelativePath`/`nameToRelativePath`/`resolveOwnerRoot`/`resolveSafeTarget` (双重 containment) + 22 个测试
- `packages/core/src/file-mutation.ts` — `writeAtomic` (temp + rename + priorBytes 回滚 + KeyedMutex + finalizer cleanup) + 8 个测试

### Phase B — Registry

- `packages/core/src/prompt-asset.ts` — `PromptAsset.Service` + `locationLayer` (load/list/getByPath/findByName/reload + watcher forkIn) + 10 个测试

### Phase C — PromptAssetService

- `packages/core/src/prompt-asset-service.ts` — `propose` (只读校验) + `apply` (目标级 KeyedMutex 锁 → CAS revision → writeAtomic → registry reload → readback → rollback 回滚保护) + 11 个测试（含并发和故障注入）

### Phase D — Agent/Tool/Policy

- `packages/core/src/product-mode-agent-policy.ts` — `checkPrimaryAgent`/`checkCommandAllowed` 纯策略函数 + 10 个测试
- `packages/core/src/agent/prompt/chat-orchestrator.ts` — `SYSTEM_PROMPT` (仅 propose_prompt_asset，无 write/shell/task)
- `packages/core/src/tool/propose-prompt-asset.ts` — V2 Tool 在 builtins.ts 注册
- `packages/aigcfroge/src/tool/propose-prompt-asset.ts` — V1 Tool 在 registry.ts 注册
- `packages/core/src/plugin/agent.ts` — V2 chat-orchestrator agent 注册 (`* deny` + read/glob/grep/question/propose_prompt_asset/prompt_asset_apply)

## 协议约束（新对话首读）

### CLAUDE.md 关键门禁

- **No Cheating**: 生产代码无 `as any`、`@ts-ignore`
- **Reusability**: 先查 owner module，不新建平行实现
- **Clean Logs**: 错误/log 不得含 template 正文
- **极致减法**: 复用 > 删除 > 归并 > 重构 > 新增

### AGENTS.md

- 自导出 `export * as Foo from "./foo"`，新代码禁 star import / `export namespace`
- `Effect.fn("Domain.method")` + `Effect.gen(function* () {})` + 禁 `fork`/`forkDaemon` → `forkIn(scope)`
- Schema.Class 多字段 / TaggedErrorClass 错误
- 禁 `Effect.sleep(N)` → `pollWithTimeout`
- 禁 `else` → early return

### 测试规范

- `bun --cwd packages/<name> test --timeout 30000`
- `testEffect()` / `it.live`(真实OS) / `it.effect`(TestClock) / `it.instance`(tmpdir)
- `Layer.mock` 优先于手写 stub
- Concurrent fiber 用 `Deferred` / `pollWithTimeout` / `BackgroundJob.wait`，禁用 sleep

### Effect v4 API 注意

- `Effect.catch(fn)` — 非 `catchAll`
- `Effect.catchReason(tag, reason, fn)`
- `Effect.flip` — 交换 error/success
- `Effect.runPromise` 要求 `R = never`，测试需要 cast `Effect as any`
- `Schema.decodeUnknownSync(Schema)(data)` 或 `Schema.decodeUnknownEffect(Schema)(data)`
- `FileSystem` 服务有 `writeFile(path, Uint8Array)` / `writeFileString(path, string)` / `rename(old, new)` / `remove(path)` / `exists(path)`

## 剩余工作

### D.5 — Session Policy Guard（高优先级）

| 文件                                        | 改动                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `packages/aigcfroge/src/agent/agent.ts`     | V1 chat-orchestrator 注册，带 fail-closed 权限 `* deny` + 白名单 |
| `packages/core/src/session.ts`              | V2 create 中插入 `checkPrimaryAgent(mode, agent)` 校验           |
| `packages/core/src/session/runner/llm.ts`   | provider turn 前 fail-closed policy guard                        |
| `packages/aigcfroge/src/session/session.ts` | V1 create policy                                                 |
| `packages/aigcfroge/src/session/prompt.ts`  | V1 shell/command chat 模式拒绝                                   |

`ProductModeAgentPolicy` 已存在 `packages/core/src/product-mode-agent-policy.ts`，导出 `checkPrimaryAgent(mode, agent)` 和 `checkCommandAllowed(mode)`，直接 yield 使用即可。

### D.6 — App 层

| 文件                                                                  | 改动                           |
| --------------------------------------------------------------------- | ------------------------------ |
| `packages/app/src/context/tabs.tsx`                                   | DraftTab 加 `agent?: string`   |
| `packages/app/src/components/prompt-input/submit.ts`                  | create 同时传 `mode` + `agent` |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | Chat 仅展示 chat-orchestrator  |
| `packages/app/src/pages/home.tsx`                                     | Chat 新建创建带 agent 的 Draft |

### E.1 — HTTP API

- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts` — GET list + GET content + POST apply
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts` — handler 注入 LocationServiceMap
- 按 `httpapi/AGENTS.md` 用 `HttpApiBuilder.group(...)`，handler 闭包捕获服务，不在 handler 内 `Effect.provide`

### E.2 — SDK 生成

`./packages/sdk/js/script/build.ts`

### E.3-E.6 — UI 组件（按 DESIGN.md）

- TSX 组件用 v2 token (`--v2-*`)
- i18n 18 locale + parity test
- Kobalte 无障碍原语
- `aria-label`、键盘焦点、宽窄屏适配

### F — 集成验证

- prompt-asset flag 控制 + capability 暴露
- V1 E2E + V2 smoke test
- 全仓 typecheck + lint + 受影响包测试
- 清掉 LocationServiceMap 集成后预存类型错误

## 错误类型速查

```ts
// Phase A Schema 错误
;PromptAsset.NotFound | NameConflict | PathConflict | StaleRevision | OverwriteRequired
PromptAsset.InvalidCandidate | WriteFailed

// Phase C Service 错误
PromptAssetService.InvalidCandidate | PermissionDenied
;PromptAssetService.StaleRevision | OverwriteRequired | WriteFailed
;PromptAssetService.ReadbackMismatch | RollbackFailed | ConcurrentModification

// Phase D Policy 错误（纯 Error 类）
AgentNotAllowedError(mode, agent, reason)
CommandDeniedError(mode, reason)
```
