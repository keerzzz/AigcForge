# V2 项目运行时入口（2026-10-19）

状态：项目入口、嵌套进程、离线缓存与参数验证已通过；Server 定向回归 exit 1，失败单独列示。工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本任务独占 `script/bun`、`script/runtime/prepare.mjs` 和本报告；提交由主代理统一执行。

## 方案与边界

项目 Bun 的唯一版本源是根 `package.json` 的 `packageManager`。`script/bun` 使用 Node 引导准备固定版本，缓存到已被 `.gitignore` 忽略的 `.cache/bun/<version>/linux-x64-baseline/bin`，再把该目录加入当前进程及子进程 PATH 首位并 `exec` Bun。入口保留调用者的工作目录和参数。缓存命中只校验实际 Bun 版本与 bunx 入口，不访问网络。

初次准备从官方 npm registry 获取指定版本 `@oven/bun-linux-x64-baseline` 元数据和压缩包，下载分别有 15 秒和 30 秒限制。完整压缩包 SHA512 与 registry integrity 一致后才提取二进制，检查 `bun --version`，创建与 Bun 同源的 `bunx`，最后通过同文件系统目录 rename 原子安装。压缩包临时目录在成功或失败后清理。metadata 和 archive 的网络信任来源均为官方 HTTPS npm registry。

已有 CI 使用 `.github/actions/setup-bun/action.yml`，也读取根 packageManager。本地只有 `.husky/pre-push` 版本检查，未提供运行时隔离，故新增小型项目入口。没有修改 packageManager、依赖或锁文件，也没有改全局 Bun、主仓或 shell 配置。

采用当前 Linux x64 开发环境的最小入口，没有新增跨平台版本管理框架。技术债 owner：开发环境维护者；解除条件：确需 Windows 原生、macOS 或 Linux arm64 本地入口时，按对应官方平台包增补并验证。现有 CI 平台支持保持由 setup-bun 管理。初次准备要求 Node（本机 v24.15.0）和 tar；并行首次准备需要先由一个调用者完成，之后所有命令共享缓存。

## 使用

```bash
# 从根目录运行门禁或开发脚本
./script/bun run check
./script/bun run dev:desktop

# 从包目录运行脚本；包内嵌套 bun 使用同一 1.4.2
cd packages/server
../../script/bun run test --timeout 30000 test/approval-stream.test.ts

# 输出已准备的 bin 目录；可用于单个进程范围 PATH
node script/runtime/prepare.mjs
```

直接执行任意全局 `bun` 命令仍受调用者原 PATH 控制。需使用项目入口，或把 prepare 输出的 bin 加入当前进程 PATH。版本判断使用 `process.versions.bun`；`process.version` 是 Node 兼容标识。

## 验证记录

| 阶段         | 命令                                                                                                                                                                    | 退出码 | 结果                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| 协议         | `cat AGENTS.md`、根 package.json 与运行时交接报告                                                                                                                       | 0      | V2 固定 bun@1.4.2；主仓只读                           |
| 工作区       | `git status --short --branch`                                                                                                                                           | 0      | v2-dev；已保留现有修改                                |
| 环境         | `command -v node bun tar`、各版本命令                                                                                                                                   | 0      | Node v24.15.0；全局 Bun 1.3.14；临时 Bun 1.4.2        |
| 现有入口     | `rg -n` 检索 packageManager、runtime、Bun.spawn 等                                                                                                                      | 0      | CI setup-bun 和 pre-push 校验，无本地隔离             |
| 官方版本     | Node fetch 指定 npm package metadata                                                                                                                                    | 0      | name/version 一致；有 SHA512 integrity                |
| 初次准备     | `./script/bun --version`                                                                                                                                                | 0      | SHA512 验证、原子安装成功，输出 1.4.2                 |
| 脚本语法     | `node --check script/runtime/prepare.mjs`、`sh -n script/bun`                                                                                                           | 0      | 无语法错误                                            |
| 子进程与 cwd | Node 临时探针从 packages/server spawn 项目入口，Bun 子进程再 spawn bun 与 bunx                                                                                          | 0      | 当前目录保持 packages/server；三层实际版本均为 1.4.2  |
| 参数         | 同一探针传入空格、美元符号、反引号和 flag 参数                                                                                                                          | 0      | process.argv 与输入逐项相同，未经过 shell 重解释      |
| 失败传播     | 同一探针运行 `script/bun -e 'process.exit(37)'`                                                                                                                         | 0      | 探针断言通过；目标命令实际 exit 37                    |
| 离线缓存     | Node preload 对 fetch 设失败守卫后运行 `script/bun --version`                                                                                                           | 0      | 缓存命中没有调用 fetch，输出 1.4.2                    |
| 缓存忽略     | `git check-ignore .cache/bun/1.4.2/linux-x64-baseline/bin/bun`                                                                                                          | 0      | 现有 .cache 规则已覆盖，无需改 .gitignore             |
| 格式与 lint  | `./node_modules/.bin/prettier --check script/runtime/prepare.mjs docs/review/v2-project-runtime-2026-10-19.md`、`./node_modules/.bin/oxlint script/runtime/prepare.mjs` | 0      | Prettier 通过；oxlint 0 warnings、0 errors            |
| 全局隔离     | `bun --version`、`command -v bun`                                                                                                                                       | 0      | 原 PATH 仍解析 `/home/keer/.bun/bin/bun`，版本 1.3.14 |

子进程探针实际输出：

可复现源码：`docs/review/evidence/v2-project-runtime-2026-10-19/runtime-probe.mjs`。日志：同目录 `runtime-probe.log`。从仓库根执行精确命令 `node docs/review/evidence/v2-project-runtime-2026-10-19/runtime-probe.mjs`，exit 0。原临时探针已按实际执行内容存档，并用存档源码复跑成功；不加载或打印用户配置与凭据。

```json
{
  "cwd": "/home/keer/workspace/aigcfroge-v2/packages/server",
  "bun": "1.4.2",
  "args": ["value with spaces", "$literal", "`literal`", "--flag=value"],
  "commands": [
    {
      "command": "bun",
      "path": "/home/keer/workspace/aigcfroge-v2/.cache/bun/1.4.2/linux-x64-baseline/bin/bun",
      "version": "1.4.2"
    },
    {
      "command": "bunx",
      "path": "/home/keer/workspace/aigcfroge-v2/.cache/bun/1.4.2/linux-x64-baseline/bin/bunx",
      "version": "1.4.2"
    }
  ],
  "failureExitCode": 37,
  "offlineCache": { "exitCode": 0, "version": "1.4.2" }
}
```

本次下载校验记录在 `.cache/bun/1.4.2/linux-x64-baseline/integrity.json`，副本保存在 `docs/review/evidence/v2-project-runtime-2026-10-19/integrity.json`。SHA512 值为 `sha512-OKKzX/SOVIUVARCzTg+2r4Rcc4fPyWnQmBsd3K08buxeu7DAof4iwW9zSb6Lt1NhTCu4Uhi8k9UeI6f7GEE4Zg==`，源包为 `@oven/bun-linux-x64-baseline@1.4.2`。

### 未通过的 Server 定向回归

从 `packages/server` 执行：

```bash
../../script/bun run test --timeout 30000 test/approval-stream.test.ts
```

启动日志显示 `bun test v1.4.2 (744846f84)`。最终 exit 1，2 pass、2 fail、5 expect calls、4 tests。两项失败均是现有 Web HTTP 用例，报错 `SSE did not connect`；本轮未证明其根因，不能把本轮记为整套通过。Node HTTP 永久回归由主代理并行接管，这里没有修改测试或生产服务源码。

```text
(fail) web HTTP approval stream > a real HTTP event connection can answer a leaf ask and unregisters on disconnect
(fail) web HTTP approval stream > only a capable HTTP stream keeps custom asks answerable
 2 pass
 2 fail
 5 expect() calls
Ran 4 tests across 1 file. [19.48s]
error: script "test" exited with code 1
```

项目入口的独立行为验证通过，与 Server 行为验证失败分开报告。全仓 check、Core/Server/Client/App 全量验证和此 Server 失败的归因仍由主代理继续执行，不在本项目入口任务中宣称闭环。

最终执行 Prettier 再检查、Node syntax、sh syntax、`./script/bun --version` 与 `git diff --check`，命令组 exit 0，入口输出 1.4.2。

主代理另有同一 4 项在 Bun 1.4.2 下 exit 0、4 pass 的记录，本轮与全仓无缓存 check 并行。本报告保留本轮失败；并发负载是否为根因尚未验证，解除条件是主代理完成隔离复跑。

## 官方 API 依据

- Bun 1.4.2 官方 npm installer：`https://github.com/oven-sh/bun/blob/bun-v1.4.2/packages/bun-release/src/npm/install.ts`，同一二进制创建 bunx。
- Bun 官方安装文档：`https://bun.com/docs/installation`，单二进制与 baseline 平台包。
- Node 24 官方文档：`https://nodejs.org/docs/latest-v24.x/api/globals.html` 与 `https://nodejs.org/docs/latest-v24.x/api/crypto.html`，fetch、AbortSignal.timeout 与 createHash。
- Context7 已查询 `/oven-sh/bun/bun-v1.4.2`，实际 API 同时以官方源码和本机行为核对。
