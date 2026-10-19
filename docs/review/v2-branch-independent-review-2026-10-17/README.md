# 审批证据复现

固定目标：`/home/keer/workspace/aigcfroge-v2`，HEAD `8b0661b2a9278373cb020b0998ef0943bb433459`。

`boundaries.test.ts` 的三条测试断言期望行为，在该 HEAD 上全部失败。它们调用生产服务；本地 MCP fixture 用文件标记证明 `tools/call` 已发生。探针不是业务修复。测试初始化期间的 import 和 Layer 配置问题已排除，保存的是最终复现。

先将此目录的 `boundaries.test.ts` 与 `mcp-marker.mjs` 复制到 `/tmp/v2-approval-20261017/`，并令该临时目录的 `node_modules` 符号链接指向 V2 的 `packages/core/node_modules`。从 V2 `packages/core` 目录运行：

```bash
bun run test --timeout 30000 /tmp/v2-approval-20261017/boundaries.test.ts
```

标记文件由测试清理。不要并行执行会清理子进程的其他测试。探针调试期间曾出现 ProcessStartError，该轮未计为授权漏洞复现；最终有效证据为 `boundaries.log` 中三条独立失败及 `externalCallReached:true`。

其他门禁分别从 V2 根、client 和 core 包目录运行：

```bash
TURBO_FORCE=true bun run check
```

```bash
bun run check:generated
```

```bash
bun run migration --check
```

`check:generated` 会重写生成物，失败差异保存于 `client-generation.diff`；本次已恢复其产生的工作区改动。`verification.txt` 只保留测试名称、命令和计数，避免复制测试日志中无关的配置内容。Core 全量脚本自带环境隔离；Server 全量以独立 XDG 目录复跑，以隔离后结果为准。
