# V2 R0.1 测试工作流对齐 — 2026-10-19

实现工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本切片只修改 `.github/workflows/test.yml`，复用当前保留包的构建和探针。`publish.yml` 未修改，发布链保持未闭环。没有提交、推送、PR、远程 Actions 或发布操作；也没有读取凭据。

## 根因与方案

R0 裁剪后，测试工作流仍沿用上游 CLI / SDK / services 拓扑。实际仓库没有 `packages/cli`、`packages/sdk` 或 `services`。另外，codemode 包被保留，但它的 `script/publish.ts` 不存在。

| 方案                                                                  | 兼容判断                                                                             | 本切片决策                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 把 `@opencode/sdk` 改为 `@aigcfroge/client`，把缺失 CLI 路径改为 Core | Client 没有 `verify:package`；Core 库构建不提供已编译服务 CLI 生命周期，不能等同     | 拒绝机械改名，避免假验证                                        |
| 复用保留包的实际脚本，并登记仍缺的 Sidecar 验收                       | codemode 有 `build`，Server 有 `probe:workerd`；两者可本地真实执行                   | 已实现，只声明各自证据范围                                      |
| 同时复制主仓 ADR-26 全链进入 V2                                       | V2 缺发布 controller、元数据 owner 和瘦 Sidecar，且主仓的默认分支/发布入口与 V2 不同 | 交给主代理下一切片逐域迁移；未添加必然失败 preflight 或跳过占位 |

## 测试工作流变化

| 原步骤                                                                                            | 处理                                                                                   | 当前证据与未交付范围                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Verify published codemode package` 调用不存在的 `script/publish.ts --dry-run`                    | 复用 `bun run build` 后执行 `bun pm pack --dry-run --ignore-scripts`，命名为包内容校验 | 当前构建和发布文件清单可用；没有证明外部 tarball consumer                                              |
| `Verify packed workerd SDK` 的 `@opencode/sdk` 两个 filter 分支                                   | 退役 SDK 目标删除；增加 Server `probe:workerd`                                         | 只验证 workerd condition 下模块图能构建和静态 Bun builtin 不泄漏，不能替代 SDK/Sidecar packed consumer |
| `Verify compiled service lifecycle` 调用退役 `packages/cli` build/smoke                           | 删除已退役入口命令                                                                     | 瘦 Sidecar compiled start/readiness/auth/shutdown 验收仍开放，未声称替代完成                           |
| `Verify Node build` 调用退役 `packages/cli` build-node/smoke，以及只为该步骤设置 Node 26 的 setup | 删除已退役入口命令与专用 setup                                                         | 独立 Node Sidecar 打包/启动与 Bun 构建一致性仍开放                                                     |
| `Check generated documentation` 调用退役 `services/www`                                           | 删除已退役服务目标                                                                     | 当前没有该服务 owner，不新增同名占位                                                                   |

`test.yml:106` 的受影响单测、Linux/Windows 矩阵、官方客户端生成检查 `test.yml:133`、affected job 和完整 e2e job 均逐字段比对未变。现有 `E2E_ENABLED` 排除 `v2` 分支的策略也未改变，本切片不能作为 v2 分支 E2E 已执行证据。

## 本地验证

全部执行使用项目入口 Bun 1.4.2；构建/探针从对应包目录运行。原始输出、命令、工作目录、实际退出码和耗时保存在 [evidence](evidence/v2-ci-alignment-2026-10-19/verification.json)。

| 命令                                                                      | 工作目录            | 实际结果                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `../../script/bun run build`                                              | `packages/codemode` | exit 0，4.727s；复用现有 build script                                                                                                   |
| `../../script/bun pm pack --dry-run --ignore-scripts`                     | `packages/codemode` | exit 0，92 文件，0.47MB 未压缩；日志显示 Bun 1.4.2                                                                                      |
| `../../script/bun run probe:workerd`                                      | `packages/server`   | exit 0，1 artifact，18.0 MiB，31 个外部依赖；没有静态 Bun builtin 泄漏                                                                  |
| `python3 .../validate-workflow.py`                                        | 根                  | exit 0；YAML 可解析，15 个 shell 脚本经 `bash -n`，当前直接目录/脚本/包目标 0 缺失；retained contract 字段比对通过；publish diff 0 字节 |
| `./script/bun x --no-install prettier --check .github/workflows/test.yml` | 根                  | exit 0                                                                                                                                  |
| `git diff --check -- .github/workflows/test.yml`                          | 根                  | exit 0                                                                                                                                  |

静态验证第一轮 exit 1：验证器误把 SDK 两个分支的同一缺失 target 计为单条，预期 5 条而实际 6 条引用。已按步骤集合校验并保留 `static-workflow-first.log/json`，第二轮通过。这是验证器计数问题，不是工作流运行证据。

未运行 Actions；没有跑本切片之外的全量单测、E2E、跨平台安装包或签名。没有把主代理既有 Client generate 证据算成本切片重复运行。直接目标静态扫描不递归证明所有 build/test 子脚本，也不是完整 Actions schema/expression validator；`bash -n` 只检查表达式占位后的 shell 语法。

打包额外发现：`packages/codemode/package.json:19` 的 exports 仍指向 `./src/index.ts`，而 `files` 只有 `dist`。本轮 dry-run 列出的包内容不含 src，因此发布前必须由现有发布 owner 完成 exports 映射并验证外部 consumer。这是实际发布边界缺口，未改清单、未假称“已发布包可用”。

## ADR-26 已确定的发布契约

规范源在主仓 [ADR-26](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-26-desktop-release-automation.md)，V2 未拷入该文件。V2 迁移计划 §6/§8/§9.1 仍要求迁入其发布体系，不应恢复退役 CLI/TUI 产品。

正式产品为 Electron Desktop，携带同版本且同源的 Sidecar。平台集由当前 `CLI_BINARIES`（`packages/desktop/scripts/utils.ts:20`）和 desktop 发布 metadata 聚合（`packages/desktop/scripts/publish.ts:51`）直接决定：

| 平台               | 安装包/附件             | 更新清单                    |
| ------------------ | ----------------------- | --------------------------- |
| macOS x64、arm64   | dmg、zip、`.app.tar.gz` | 两架构合成 `latest-mac.yml` |
| Windows x64、arm64 | NSIS exe、blockmap      | 两架构合成 `latest.yml`     |
| Linux x64          | AppImage、deb、rpm      | `latest-linux.yml`          |
| Linux arm64        | AppImage、deb、rpm      | `latest-linux-arm64.yml`    |

ADR-26 要求单一 release intent、版本候选只改 workspace version/对应 lock 行、完整 source SHA 同源、草稿和公开幂等、全部平台/附件/hash 校验后才公开。自动 Desktop 发行隔离 npm/Docker/AUR；这些仅属于显式 `full` 的独立边界。签名默认必需；未签名例外由 Owner 显式 variable 决定，不能因本地缺凭据自动降级。默认分支/远程仓库/自动发布 variable 属后续交付配置，本切片不猜测或改写。

## 现存发布脚本与缺口

| 当前 owner                                         | 可复用行为                                                    | 当前缺口                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/scripts/prebuild.ts:6`           | channel 解析、图标/metainfo、从同批次 Sidecar dist 复制二进制 | 生产要求 `AIGCFROGE_CLI_DIST`；dev/beta 仍可下载外部 CLI，不满足新本地 Sidecar 同源构建                                                                     |
| `packages/desktop/scripts/utils.ts:94`             | 六平台 target 映射、binary + version 文件复制、可执行属性     | Linux 本地可复用；Windows `script/sign-windows.ps1` 不存在；尚无瘦 Sidecar build 输出                                                                       |
| `packages/desktop/scripts/prepare.ts:2`            | 设置 Electron package version                                 | import `@aigcfroge/script` 不存在；不能用它作为可执行发布证据                                                                                               |
| `packages/desktop/scripts/publish.ts:3`            | 六平台附件/manifest 完整性检查与 UpdateArtifact 接口          | `@aigcfroge/script`、`script/update-artifact.ts` 不存在；且当前 UpdateArtifact 分发不等于 ADR-26 GitHub Draft 同源 controller                               |
| `packages/desktop/scripts/finalize-latest-yml.ts`  | 按平台聚合 latest metadata                                    | 接着调用 `gh release upload`；未执行，必须结合摘要验证/全部平台门禁审查再接线                                                                               |
| `packages/desktop/scripts/finalize-latest-json.ts` | Tauri 兼容更新清单                                            | 有真实网络 fetch/sign/upload，dry-run 仍有副作用，不作为本地无凭据验证；是否保留仅按真实消费者裁定                                                          |
| `script/version.ts:3`                              | 现上游 Script.version 输出                                    | 缺 `@aigcfroge/script`；没有 V2 的 ADR-26 controller/candidate owner                                                                                        |
| `script/publish.ts:52`                             | 旧 full 发布串行调度                                          | 子包 publish.ts 多数不存在；包含移动 tag/强制 push，与 ADR-26 自动 Desktop 同源不变量不兼容；不能机械复用                                                   |
| `.github/workflows/publish.yml:53`                 | 现上游 matrix 和 artifact 基础结构                            | `services/update`、legacy `packages/aigcfroge`、preview `packages/cli`、签名/Node CLI 入口缺失；仓库条件仍上游；未有 guard/prepare/finalize 等 ADR-26 owner |

实际文件存在性证据为 `release-owner-gaps.json`。后续迁移须复用主仓 `packages/script/src/release.ts`、`release-metadata.ts` 与 `script/desktop-release.ts` 的契约，按当前 V2 workspace 和 Session/Client 适配，不能复活旧 owner 或只删失败步骤。

## 未交付账目

本切片没有缩减已确定的 Desktop 发布功能；总账 `docs/technical-debt.md` 的 `V2-R01-RELEASE` 继续开放。以下是该项的具体子账，owner 与解除条件供主代理下一切片集成。

| 子项                | Owner                       | 解除条件                                                                                                                                                                                     |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01-SIDECAR-PACKED  | 主代理 / Sidecar 实现 owner | 瘦入口真实 build，外部 packed/compiled consumer，Node/Bun 启动、readiness/auth/取消/断连/停机，接入 Desktop BackgroundService 与 CI；不能用 Server in-process 或模块图证明 compiled 生命周期 |
| R01-DESKTOP-RELEASE | 主代理 / 发布实现 owner     | ADR-26 intent/candidate/source SHA owner 和六平台 build/manifest/hash/signing 守卫迁入；publish.yml 实际接线，本地 dry-run/fixture 可复现；远程另获授权                                      |
| R01-PACKAGE-EXPORTS | 主代理 / 发布实现 owner     | codemode 等 retained package 由统一发布 owner 转换 source exports 为 dist，真实外部 consumer 测试覆盖 runtime 与类型                                                                         |
| R01-FULL-BOUNDARY   | 项目 Owner / 发布实现 owner | 有明确 full 发行需求时复用独立既有契约，公开前确认目标 registry/repository；自动 Desktop 不进入 npm/Docker/AUR                                                                               |
| R01-REAL-ARTIFACT   | 主代理 / QA owner           | 六平台安装、更新、Sidecar/PTY、存量 DB 升级证据齐全，并完成签名与来源验证                                                                                                                    |

没有新提交；检查点由主代理统一安排。下一步是发布与 Sidecar 真实实现，不是把本报告或静态检查当作 V2 发布闭环。
