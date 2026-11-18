# Desktop bundled-dev factory ABI 修复

Vite 8.2.2 的 bundled-dev client 通过 `registerFactory(id, kind, fn)` 保存 factory，并在加载模块时调用 `factory.fn`。安装到 Rolldown 1.2.13 时，生成代码采用 `registerFactory(id, fn, stamp)`，第三参数不再是函数，真实桌面报 `TypeError: factory.fn is not a function`。

根 `package.json` override 固定 Rolldown 1.2.4，与当前 Vite 声明的 `~1.2.4` 下限及其 runtime ABI 一致。锁文件包含该版本、配套 native bindings 和 `@oxc-project/types` 的必要变化。未关闭 bundled dev，未修改第三方运行时。

独立只读根因与锁图核对见 [初审](evidence/v2-desktop-startup-2026-10-29/independent-review.md) 和 [锁图差异](evidence/v2-desktop-startup-2026-10-29/resume-lock-review.json)。该初审的“桌面 405 待解决”和 Client/codegen 修改归属已过时：本轮 405 由 CLI WebUi 分流修复，Client/codegen 字节未被本轮修改；详见 [真实桌面报告](v2-desktop-live-routing-2026-10-29.md)。

主线程在独立复审后重新执行：

- 真实 Vite bundled-dev + Chromium 动态 import，退出 0，`lazy-ready`、零 pageerror、所有记录的 `fnType=function`，见 [本轮 ABI 结果](evidence/v2-desktop-startup-2026-10-29/runtime-abi-resume-green.json)。原 1.2.13 红证据保留。
- Canonical root/workspace manifests 在仓外目录进行 `bun install --frozen-lockfile --lockfile-only --ignore-scripts --offline --registry=https://registry.npmjs.org`，退出 0；锁文件前后 SHA-256 均为 `7bc2aeecd4ca283869f89bf36d5624d7d17dd2e91501306c75e292234bc8f36a`。见 [命令与退出码](evidence/v2-desktop-startup-2026-10-29/canonical-frozen-resume.json)。这是冻结解析检查，没有重新安装依赖。
- 实际 Electron 44.4.5 正常加载；外部 DeepSeek V4.1 Flash 完成 Project/global 保存插入及真实回复。该流程同时发现并修复独立的 CLI 路由问题；不能将其误归为依赖 ABI 故障。

本次提交使用 HEAD manifests 生成的 canonical 锁文件，只包含 override 和 17 个 package key 的必要差异；原工作树的额外 workspace 与 registry 改动保留。实际桌面来自当前工作树，包含先前 WIP；不声称本次有限提交的干净 checkout 已完成 packaged 构建。

Owner：Desktop/Build。pin 的解除条件是升级到 ABI 匹配的 Vite/Rolldown 组合，再通过同一 bundled-dev 动态 import、冻结解析与真实桌面 Flash 验收。旧用户库迁移、最终 packaged 产物与其他平台验收仍开放。
