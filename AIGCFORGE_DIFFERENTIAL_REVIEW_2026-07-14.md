# AigcForge Differential Review — 2026-07-14

## Decision

**CONDITIONAL APPROVE** — 本次 warning cleanup 变更可以合入 `v2-release`：未发现 Critical/High/Medium 安全回退，请求中的动态导入与大 chunk 告警已清零，高信号 lint 已清零。仓库仍有与本次 diff 无关的 CLI typecheck、TUI 测试和 provider registry 测试基线失败，因此不能宣称“全仓完全绿色”。

| Severity |                     Open findings in this diff |
| -------- | ---------------------------------------------: |
| Critical |                                              0 |
| High     |                                              0 |
| Medium   |                                              0 |
| Low      | 1（Shiki worker sourcemap 同名提示，明确接受） |

## Reviewed Branches

| Branch                | Commit    | Review result                                                |
| --------------------- | --------- | ------------------------------------------------------------ |
| `main`                | `c21bd96` | 不应独立发布；是 `v2-release` 祖先，且保留语法错误和构建告警 |
| `meta-v2-closure`     | `80bdddb` | 已被 `v2-release` 包含；无需再次合并                         |
| `subagent-visibility` | `80bdddb` | 与 `meta-v2-closure` 同 commit；无需再次合并                 |
| `v2-release`          | `7c5b974` | 超集分支；批准本次未提交 cleanup diff                        |

`main`、`meta-v2-closure`、`subagent-visibility` 均为 `v2-release` 的祖先，后两个分支指向完全相同的 commit。重复向祖先分支分别修复会制造不必要的分叉；正确交付路径是在 `v2-release` 合并一次。

## Scope

- App 动态导入、provider/model dialog 导航和 Vite chunk 策略
- UI 默认主题 glob
- WebSocket/Snowflake/provider 边界字符串处理
- SDK、App、脚本和测试中的 header 合并
- Root Oxlint 配置及高信号 warning 清理
- 与上述改动直接相关的测试与类型检查

## Findings and Resolution

### 1. Provider dialog 静态化不能引入循环依赖 — Resolved

初始告警清理若让 `dialog-connect-provider.tsx` 和 `dialog-select-provider.tsx` 相互静态导入，会形成 ESM 循环。最终实现改为：

- `DialogSelectProvider` 单向导入 `DialogConnectProvider`。
- `DialogConnectProvider` 通过必填 `onShowAll` 回调返回 provider 列表。
- 所有调用点显式提供导航回调。

结果：Vite 混合导入告警清零，同时没有直接模块环或 circular chunk。

### 2. Header tuple/Headers 对象 spread 会丢失 header — Resolved

`RequestInit.headers` 可为 `Headers`、record 或 tuple 数组。把它直接 spread 进对象会把数组变成数字索引，也会丢失 `Headers` 的内部条目。

修复：

- SDK V1/V2 复用生成客户端已有的 `mergeHeaders`。
- App、GitHub 工具和测试 fixture 使用 `Headers` 进行合并。
- 保留原覆盖顺序：调用方 header 仍可覆盖默认 header；认证 header 仍按原逻辑最后写入。
- 新增回归测试同时验证 tuple header、Basic Auth 和目录 query 重写。

### 3. WebSocket `RawData` 默认字符串化不完整 — Resolved

`WebSocket.RawData` 是 `Buffer | ArrayBuffer | Buffer[]`。当前实现按联合类型分别处理，避免 ArrayBuffer/分片数据产生对象字符串或逗号拼接文本；测试覆盖 ArrayBuffer 与 Buffer[]。

### 4. 大 chunk 不能只靠提高阈值隐藏 — Resolved

修复先建立 `vendor` 边界，再把阈值设为符合桌面产物的 2,000 kB：

- index：2,503.09 kB → 1,151.06 kB。
- vendor：1,812.30 kB。
- Shiki/ghostty 保持按需 chunk。

实测更细的人工分组会产生 `rendering -> vendor -> rendering` 循环 chunk，因此拒绝该方案。

### 5. Shiki worker sourcemap 同名提示 — Accepted Low Risk

主线程和 worker 都会发出同内容 `wasm-*.js.map`。通过 worker 文件名隔离可消除提示，但会额外复制约 22.4 MB worker 资源。当前提示不改变运行时 JS，故本次接受，等待依赖升级或专门 worker 构建优化。

## Security Assessment

- 未扩大网络权限、文件权限或命令执行面。
- debug CLI 的 `Function` 构造器未新增，仅增加带理由的 lint 说明；输入仍是本地用户显式传入的 debug 参数。
- Header 合并修复减少了认证/自定义 header 被静默丢弃的风险。
- WebSocket 和 provider 错误解析从不安全对象字符串化改为类型收窄。
- 未修改 V2 Session Core 的 durable admission、runner、placement 或 interruption 不变量。

## Test Coverage

| Area                             | Result            |
| -------------------------------- | ----------------- |
| App                              | 435 pass          |
| UI                               | 4 pass            |
| Session UI                       | 54 pass           |
| Aigcfroge affected tests         | 414 pass / 1 skip |
| LLM cache/executor               | 27 pass           |
| Core affected non-provider tests | 26 pass           |
| App production build             | Pass              |
| Root lint                        | Pass, 0 errors    |

## Baseline Exceptions

以下失败在 clean `v2-release@7c5b974` 可复现，不是本次回退：

- `packages/cli/src/index.ts:24` 导致全仓 `bun typecheck` 失败。
- TUI：178 pass / 1 skip / 8 fail。
- Core provider 测试：provider registry TDZ/circular initialization error。
- 中文仓库路径下 Vite 偶发 `dist` 清理 `ENOTEMPTY`；在 ASCII 临时 worktree 或先移除 ignored `dist` 后构建正常。

## Methodology

- Strategy: FOCUSED differential review。
- 基线：`main@c21bd96`、`80bdddb`、`v2-release@7c5b974` 三个唯一提交。
- 技术：分支 ancestry、独立 worktree build/lint、changed-code review、模块环检查、受影响包 typecheck/test、clean-baseline failure reproduction。
- Confidence: HIGH for warning cleanup diff；MEDIUM for whole-repository health because known unrelated baseline failures remain open。
