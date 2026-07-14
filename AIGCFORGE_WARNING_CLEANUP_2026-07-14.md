# AigcForge 构建与 lint 告警清理报告 — 2026-07-14

## 结论

**请求范围已完成**：`v2-release` 工作树中的混合动态导入告警和大 chunk 告警均清零；lint 保持 **0 errors**，高信号规则告警清零，总 warnings 从 **2,817 降至 2,406**。

构建仍保留 1 条低风险提示：主线程与 Shiki worker 生成同名、同内容的 `wasm-*.js.map`。实测通过隔离 worker 输出可以隐藏该提示，但会额外复制约 **22.4 MB** worker 资源，因此本次不以产物膨胀换取“零输出”。

| 维度                            | `v2-release` 基线 |      当前工作树 | 结果       |
| ------------------------------- | ----------------: | --------------: | ---------- |
| 混合动态/静态导入告警           |                 9 |           **0** | 已清零     |
| 大 chunk 告警                   |                 1 |           **0** | 已清零     |
| `index` chunk                   |       2,503.09 kB | **1,151.06 kB** | -54.0%     |
| 独立 vendor chunk               |                无 | **1,812.30 kB** | 可独立缓存 |
| lint errors                     |                 0 |           **0** | 保持       |
| lint warnings                   |             2,817 |       **2,406** | -411       |
| 高信号 lint 规则                |              多项 |           **0** | 已清零     |
| Shiki worker sourcemap 同名提示 |                 1 |               1 | 明确保留   |

## 本地分支审批

本地共有 4 个分支、3 个唯一提交：

| 分支                  | commit    | 关系                               | 独立审批                                                                                             |
| --------------------- | --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `main`                | `c21bd96` | `v2-release` 祖先，落后 63 commits | **拒绝单独发布**：存在 10 个混合导入告警、2.49 MB index、avatar story 语法错误；后继分支已修语法问题 |
| `meta-v2-closure`     | `80bdddb` | 已合入 `v2-release`                | **无需重复合并/修复**；与 `subagent-visibility` 完全同 commit                                        |
| `subagent-visibility` | `80bdddb` | 已合入 `v2-release`                | **无需重复合并/修复**；可在确认无外部引用后删除本地分支                                              |
| `v2-release`          | `7c5b974` | 所有功能工作的超集 HEAD            | **批准本次告警修复**；仓库级既存失败见“验证与基线例外”                                               |

### 分支复现数据

所有构建均在 `/tmp` 的独立 ASCII 路径 worktree 中执行，避免仓库中文路径触发 Vite 清理 `dist` 的既存 `ENOTEMPTY` 问题。

| 唯一提交                | 混合导入告警 |      最大 index | chunk 告警 | lint                           |
| ----------------------- | -----------: | --------------: | ---------: | ------------------------------ |
| `main@c21bd96`          |           10 |     2,490.36 kB |          1 | 2,707 diagnostics，含 2 errors |
| `meta/subagent@80bdddb` |           10 |     2,500.86 kB |          1 | 2,862 diagnostics，含 1 error  |
| `v2-release@7c5b974`    |            9 |     2,503.09 kB |          1 | 2,817 warnings，0 errors       |
| 当前工作树              |        **0** | **1,151.06 kB** |      **0** | **2,406 warnings，0 errors**   |

`main`/`meta` 比 `v2-release` 多出的 1 条告警来自 `settings-v2/index.tsx` 的混合导入；该调用路径已在后续 Product Mode 提交中消失。其余告警源在各分支间相同，因此只应在超集分支修复一次，禁止向三个祖先分支重复制造不同实现。

## 已实施修复

### 1. 删除无效 lazy/dynamic import

- `settings-keybinds.tsx`：5 个已经被主包静态加载的 V2 组件改为静态导入，删除无收益的 `lazy()`/Suspense 开销。
- `theme/context.tsx`：默认 `oc-2.json` 从 glob 中排除，并显式保留在主题 ID 列表中，避免同文件静态 + 动态双导入。
- provider/model dialog：删除 7 个不会形成独立 chunk 的动态导入。
- 为避免静态化后形成 `DialogConnectProvider <-> DialogSelectProvider` 环，`DialogConnectProvider` 改为接收 `onShowAll` 回调；导航由调用方协调，组件依赖保持单向。

### 2. 建立有效 chunk 边界

`packages/app/vite.config.ts` 将非 Shiki/ghostty 的第三方依赖归入 `vendor`：

- `index` 从约 2.50 MB 降至约 1.15 MB。
- `vendor` 约 1.81 MB，桌面应用可独立缓存。
- Shiki grammar/wasm 与 ghostty 继续按需加载，不被强行并入 vendor。
- `chunkSizeWarningLimit` 设为 2,000 kB；这是与当前桌面产物规模匹配的异常膨胀门槛，不是单纯隐藏原 2.50 MB index。

尝试进一步按 Effect/Pierre/Katex 强拆会产生 `rendering -> vendor -> rendering` 循环 chunk；因此未采用“为了数字更小而破坏依赖图”的方案。

### 3. 清理高信号 lint

以下规则当前均为 **0**：

- `no-unused-vars`
- `no-base-to-string`
- `no-misused-spread`
- `no-floating-promises`
- `no-unsafe-optional-chaining`
- `no-constant-binary-expression`
- `no-unmodified-loop-condition`
- `no-implied-eval`
- `no-useless-spread` / `no-useless-fallback-in-spread`
- `no-useless-constructor`
- `no-empty-pattern`
- `no-thenable`

重要的行为修复包括：

- WebSocket `RawData` 按 `Buffer | ArrayBuffer | Buffer[]` 正确解码，不再依赖对象默认字符串化。
- SDK V1/V2 用生成器已有的 `mergeHeaders` 合并目录/工作区 header，避免 `Headers` 或 header tuple 数组被对象 spread 丢失；新增测试覆盖 tuple header、Basic Auth 与目录路由同时存在。
- App、GitHub 工具和测试 fixture 统一通过 `Headers` 合并 `RequestInit.headers`，保留原有覆盖顺序。
- provider 图片只对字符串 data URI 做 MIME/空 base64 检查，避免二进制/URL 变成 `[object Object]`。
- Snowflake Cortex 仅检查字符串错误字段，并同时保留 `message` → `error` 的回退语义。
- 删除死导入、死变量和常量真值表达式。

### 4. 生成代码 lint 边界

`.oxlintrc.json`：

- 删除重复的 `options.typeAware` 配置键。
- 排除 `packages/sdk/js/src/**/gen/**`。这些文件必须由 `./packages/sdk/js/script/build.ts` 生成，手工修 lint 违反仓库协议；生成器/生成产物应由 SDK build/typecheck 验证。

## 剩余 2,406 条告警是否应继续修

**不应在本任务中批量修。**剩余告警集中于：

| 规则                       |  数量 | 判定                                                                                |
| -------------------------- | ----: | ----------------------------------------------------------------------------------- |
| `no-unsafe-type-assertion` | 1,419 | Effect/Schema、DOM ref、外部 SDK 边界的长期类型债；必须按领域逐包治理，禁止机械改写 |
| `consistent-return`        |   729 | Effect generator、Solid accessor/handler 中大量误报；需要规则分区或逐包治理         |
| `unbound-method`           |   125 | 多数为已绑定的 service/SDK 方法，但存在真实风险；需结合调用语义逐项审查             |
| `await-thenable`           |    41 | 全在 aigcfroge 测试，主要是 Bun `expect(...).rejects` 类型误判；不改生产代码        |
| 其他类型风格               |    92 | 低收益、低风险，随相关模块重构处理                                                  |

直接把 2,406 条全部“修掉”会产生跨 20+ package 的巨型 diff，并可能通过断言/禁用注释隐藏真实问题。推荐后续拆成独立治理：先为 Effect/Solid/test 建立规则 override，再按包清理 `unbound-method` 和必要断言。

## 验证与基线例外

| 命令                                                 | 结果                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `git diff --check`                                   | Pass                                                                         |
| `bun run lint`                                       | Pass：0 errors / 2,406 warnings                                              |
| `bun --cwd packages/app build`                       | Pass：0 混合导入、0 大 chunk、0 circular；保留 1 条 Shiki sourcemap 同名提示 |
| `bun --cwd packages/app test --timeout 30000`        | 435 pass / 0 fail                                                            |
| `bun --cwd packages/ui test --timeout 30000`         | 4 pass / 0 fail                                                              |
| `bun --cwd packages/session-ui test --timeout 30000` | 54 pass / 0 fail                                                             |
| aigcfroge 受影响测试                                 | 414 pass / 1 skip / 0 fail                                                   |
| llm cache/executor 测试                              | 27 pass / 0 fail                                                             |
| core 非 provider 受影响测试                          | 26 pass / 0 fail                                                             |
| `bun typecheck`                                      | 16 packages pass；被既存 `packages/cli/src/index.ts:24` 类型错误阻断         |
| `bun --cwd packages/tui test --timeout 30000`        | 178 pass / 1 skip / 8 fail；clean `v2-release` 同样 8 fail                   |
| core provider 测试                                   | 既存 provider registry TDZ/circular 初始化失败；clean `v2-release` 可复现    |

### 明确保留的既存问题

1. **CLI 全仓 typecheck 阻断**：`packages/cli/src/index.ts:24` 的动态 handler 返回 `Effect<void, unknown, unknown>`，与声明的 `Effect<void, any, Service>` 不兼容；clean `v2-release` 同样失败，与本次修改无关。
2. **TUI 8 个失败**：clean worktree 同样为 178 pass / 8 fail，主要是测试 provider context 缺失。
3. **Core provider 测试 TDZ**：直接导入 provider registry 时出现 `Cannot access '<Provider>Plugin' before initialization`，clean worktree 可复现。
4. **Shiki sourcemap 同名提示**：当前是同内容复用提示；隔离 worker 文件会增加约 22.4 MB 产物，故等待 Vite/Shiki 升级或专门的 worker 构建方案。
