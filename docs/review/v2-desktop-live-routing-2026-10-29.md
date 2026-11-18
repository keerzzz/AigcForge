# P2.2T 桌面真对话续验与 CLI 路由修复

实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，接续 HEAD `d6495e2738f1249f579f653b02b697b988fa78dd`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本节补齐 P2.2T 的开发态 Electron / 外部 DeepSeek Flash 验收，并修复由该入口实际发现的路由阻断。未关闭完整 P2 或 P6。

## 真实失败与根因

桌面实际创建 Chat Session，DeepSeek V4.1 Flash 成功调用 `propose_prompt_asset`。随后 `POST /session/:id/prompt-asset/inspect` 返回 405；见 [请求记录](evidence/v2-desktop-startup-2026-10-29/prompt-inspect-405.json) 和 [截图](evidence/v2-desktop-startup-2026-10-29/prompt-inspect-405.png)。

决定分流的是 [handler](/home/keer/workspace/aigcfroge-v2/packages/cli/src/services/web-ui.ts:7)：旧实现只将 `/api`、`/api/*`、`/auth/*` 和 `/openapi.json` 交给 API。七族资产端点由 Protocol 定义在这些前缀之外，因而进入 [serveUI](/home/keer/workspace/aigcfroge-v2/packages/cli/src/services/web-ui.ts:40)；GET 返回网页，POST 返回 405。既有资产真链直接调用 Server routes，没有经过 CLI 的 WebUi transform，因此不能证明桌面入口可用。

修复从正式 Server `Api.groups[*].endpoints[*].path` 派生路径匹配器，复用 Effect `FindMyWay.find` 与 `HttpRouter.RouterConfig`，在原分流边界将注册路径交给同一 [dispatch 鉴权](/home/keer/workspace/aigcfroge-v2/packages/server/src/process.ts:173) 与处理。端点仍由 Protocol/Server 持有；无新增 HTTP 接口、手写七族路由名单或资产注册服务。短期单独添加 Prompt 前缀会留下其他族同因故障，因此未采用。

## 本轮验证

- 原 keeper 新增七族鉴权检查后 RED：2 pass / 1 fail，预期 401、实际网页 200。
- 首次实现误用只检查静态节点的 `FindMyWay.has`，仍为 2 pass / 1 fail。核对当前实现后改用与 HTTP router 相同的 `find`，3 pass / 0 fail，127 assertions。
- 扩展正式 Client → TCP → Session 创建 → Project inspect/apply/content → 文件存在的链路。首轮因测试配置触发模型目录联网而失败；显式隔离 config、关闭 models fetch 后为 3 pass / 0 fail，130 assertions。
- CLI 包 `typecheck` 退出 0；两文件 oxlint 0 warnings / 0 errors（当前配置仅 1 rule），格式检查退出 0。格式化后最终 keeper 再验为 3 pass / 0 fail，130 assertions。独立子智能体读取实际 patch、WebUi 和 dispatch 后未发现范围内阻断，见 [静态复审边界](evidence/v2-desktop-startup-2026-10-29/route-independent-review.md)；不将有限 lint 或静态复审称为全仓门禁。

各轮原始日志、退出码与 tally 分开保存在 [验证清单](evidence/v2-desktop-startup-2026-10-29/route-validation-manifest.json)，不累计重跑。当前源码相对初始恢复文件的精确差异见 [patch](evidence/v2-desktop-startup-2026-10-29/web-ui-routing.patch.gz)。diff 的空上下文行自带空格，限定提交检查因此先失败；原 patch 保留，提交采用确定性 gzip 并验证解压字节一致。

## 实际 Electron 与 DeepSeek Flash

实际窗口 user agent 为 Electron 44.4.5，渲染地址 `http://localhost:5173/index.html`。使用独立验收数据库 `aigcfroge-v2-acceptance-20261029.db` 和 `/tmp/aigcfroge-flicker-B-20261024-2134/coding` 验收项目。DeepSeek 凭据通过正式桌面连接表单接入，密钥未写入仓库或证据。

在同一 Session `ses_e7ad781ffffekxFx19fBdUkKuN` 中完成：

1. 外部 Flash 生成 Prompt 提案。
2. 默认 Project 目标：重新检查、取消一次、确认保存、从 saved target 回读并插入；后续键入位于正确光标，保存与插入没有发出 prompt POST。
3. 显式发送插入模板，模型逐字回复 `FLASH_E2E_OK_20261029`。
4. 显式 Global 目标：重新检查、取消一次、保存、插入，再显式发送，模型再次逐字回复同一标记。

[完整请求证据](evidence/v2-desktop-startup-2026-10-29/desktop-live-result.json) 和 [SQLite 断言](evidence/v2-desktop-startup-2026-10-29/desktop-durable-assertions.json) 相互核对。持久状态为 3 条 user、4 条 assistant、3 条 outcome=succeeded；全部 assistant 模型引用均为 `deepseek / deepseek-flash / high`。这是消息计数，不冒充含标题等辅助请求在内的 provider 调用总数。

Project 和 Global 文件均为 126 字节，SHA-256 相同；[持久记录](evidence/v2-desktop-startup-2026-10-29/desktop-durable-verification.json) 记录完整路径与哈希。主线程已实际查看 [Global 完成截图](evidence/v2-desktop-startup-2026-10-29/global-flash-reply.png)。

为加载修复，旧验收服务收到 SIGTERM 后退出；桌面已有 `BackgroundService.ensure` 自动启动替代服务。第一次等待期限届满时未擅自并启服务，随后确认新监听已存在，继续复用。详见 [服务记录](evidence/v2-desktop-startup-2026-10-29/route-fixed-service.json)。旧用户数据库未修改。

## 范围与剩余事项

初始 65 项 tracked WIP、13,855 个 untracked 文件及 diff 已在仓外 `/home/keer/workspace/aigcfroge-resume-20261029-backup` 备份，并验证 tar 可读。被修复的两份 CLI 文件原为 P0.3 未提交恢复文件；备份字节与固定上游按品牌改名的字节完全一致。限定提交需明确包含这两份必需恢复文件，不能将其他恢复 WIP 一并暂存。

Rolldown 1.2.4 依赖修复单独记录；旧库 `meta_agent_memory` 表/迁移日志冲突仍未修复，不能用新验收库成功关闭旧库升级。开发日志保留 Electron CSP 警告，以及首轮响应期间的 ResizeObserver loop 警告；后者未造成当前验收失败，也未在本节归因或声称消除。

本节不代表 packaged Desktop、其他平台、旧库 cutover、全部无障碍与性能验收。Agent/MCP/Plugin/Workflow placement、导入编辑引用、Custom/Meta/Assistant/Task/Workflow 和 P5/P6 的既有未交付项仍由唯一债务账本管理。后续先收口开发态警告诊断与期间发现的共用 E2E 事件编码、header 几何验证，再实施 Agent 所选目标 owner；不跳过各节桌面 Flash 验收。原 3-input 验收快照之后另发了 1 条布局诊断输入，它不计入原验收快照。
