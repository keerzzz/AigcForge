# V2 Bun 版本对齐诊断（2026-10-19）

本机存在运行版本不一致：V2 要求 Bun 1.4.2，shell 的 PATH 仍选择 Bun 1.3.14。同一断连探针、同一 Effect 4.0.1 和同一生产路由，在隔离 Bun 1.4.2 下通过。因此，此前观察到的断连问题属于旧运行版本，不能据此判定 V2 指定运行时存在该缺陷。

## 声明与实际解析

| 对象                 | 声明 / 实际                                                                  | 判断依据                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 主仓                 | `bun@1.3.14`                                                                 | `/home/keer/workspace/aigcfroge/package.json:7`                                                                               |
| V2                   | `bun@1.4.2`                                                                  | `package.json:8`                                                                                                              |
| 全局 shell           | `/home/keer/.bun/bin/bun`，1.3.14                                            | `command -v bun`、`bun --version`                                                                                             |
| V2 CI                | 从 packageManager 选版本，无覆盖时为 1.4.2                                   | `.github/actions/setup-bun/action.yml:28`、`:42`；测试工作流引用该 action                                                     |
| Effect / Node 平台包 | Core、Server、Client 均实际解析 4.0.1；Node 平台包 peer 要求 `effect ^4.0.1` | `package.json:39`、`:74`、`:153`；安装包 manifest 与真实路径见证据 JSON。实际只有一份 `effect@4.0.1`                          |
| Bun 类型包           | `@types/bun` 外层为 1.4.0；实际 `bun-types` 为 1.4.2                         | `package.json:43`、`:152` 的 override 及实际解析路径。没有发现该差异造成两份类型或 HTTP 运行时问题                            |
| Node                 | 实际 Node v24.15.0；Node 平台包 engines 为 `>=18.0.0`                        | `node --version` 与安装 manifest，无 engines 冲突。Bun 1.4.2 的 `process.version = v26.3.0` 是兼容标识，不代表切换了系统 Node |

锁文件的部分上游依赖保留 Effect RC 的依赖/peer 元数据。是否实际混装由 override 后的解析路径决定；本链的消费者与 Node 平台包均使用 4.0.1，没有观察到两个 Effect runtime。该检查不等于验证全部上游包的行为兼容性。

## MCP 查询与实测

使用 Context7 MCP 查询 `/oven-sh/bun/bun-v1.4.2` 的 Node 兼容与 streaming 生命周期资料，以及 `/effect-ts/effect` 的 `NodeHttpServer.makeHandler`。同时核对本地安装的 4.0.1 实现：`nodeResponse.on("close")` 会中断未完成的请求，见 `packages/server/node_modules/@effect/platform-node/src/NodeHttpServer.ts:213`。判断版本影响以本机复现为准，未推断具体修复提交。

GitHub 发布 ZIP 下载超时，部分文件的校验失败，未执行。随后下载官方 npm 包 `@oven/bun-linux-x64-baseline@1.4.2`，SHA512 与 registry integrity 相符，放在 `/tmp/v2-bun-1.4.2-runtime/package/bin/bun`。没有替换全局二进制，没有安装或重写项目依赖。

| 验证                                                              | 实际运行时    | 结果                                                                      |
| ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| 原最小 `node:http` 断连程序                                       | Bun 1.3.14    | 1 秒观察窗口未收到 `ServerResponse.close`                                 |
| 同一程序                                                          | Bun 1.4.2     | 收到 `ServerResponse.close`                                               |
| 同一程序                                                          | Node v24.15.0 | 收到 `ServerResponse.close`                                               |
| 实际 EventHandler + EventFeed + ApprovalPresence + NodeHttpServer | Bun 1.4.2     | 普通及 Custom-capable 连接均在断连后释放应答者；exit 0                    |
| 完整 createRoutes + NodeHttpServer + 公开客户端 + 真实 TCP        | Bun 1.4.2     | 2 pass、0 fail、5 assertions；含审批 reply、断连、Custom 能力并存；exit 0 |
| Server 相关 6 文件复跑                                            | Bun 1.4.2     | 14 pass、0 fail、88 assertions；exit 0                                    |

完整生产路由测试使用上一轮审批回归的真实实现，只把服务器传输替换为生产使用的 NodeHttpServer。临时测试源码已存档并从项目目录移除。

## PATH 是第二个可复现的陷阱

仅用绝对路径执行 `Bun 1.4.2 run test` 不足以保证脚本子命令也使用 1.4.2。包脚本为 `bun test ...`，子进程按 PATH 找到了全局 1.3.14。该轮输出明确显示 `bun test v1.3.14`，生产断连测试 0 pass、2 fail，已保留，不能算作 1.4.2 的失败。

最终验证使用进程范围的 PATH：

```bash
PATH="/tmp/v2-bun-1.4.2-runtime/package/bin:$PATH" bun run test --timeout 15000 test/.tmp-runtime-node-approval.test.ts
```

日志确认 `bun test v1.4.2` 后，两个断连测试通过。其余检查也按同样方式确认测试进程版本。

## 结论与后续

REPAIR-HTTP-01 的“V2 指定运行时是否有断连缺陷”已完成验证：1.4.2 上未复现，生产链通过。无需为该现象修改生产 HTTP 或 Effect 代码。

本机全局 PATH 仍是 1.3.14，因此日常 V2 命令尚未永久对齐。建议让 V2 开发终端及其子进程使用固定 1.4.2，主仓保留其 1.3.14；本次只读诊断没有修改 shell 配置。Owner：开发环境维护者；解除条件：V2 开发终端与脚本日志均确认 1.4.2，随后按项目门禁执行验证。

之前的全仓 check、Core 相关回归和 Client 全量仍是 Bun 1.3.14 的结果，未在本次按 1.4.2 全部重跑。本报告只补足 HTTP 断连链和 Server 相关测试，不能把旧运行时检查自动升级为 1.4.2 的完整验证。

证据目录：`docs/review/evidence/v2-runtime-alignment-2026-10-19/`。命令、退出码、实际版本、依赖路径和二进制校验见 `verification.json`。
