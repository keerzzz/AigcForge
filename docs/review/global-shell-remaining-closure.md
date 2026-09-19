# 全局应用外壳剩余闭环 —— S7 切片报告（2026-09-17）

> **性质**：切片交付报告，追加写入，不抹掉历史。前序证据在 [`global-shell-e2e-2026-09-10.md`](global-shell-e2e-2026-09-10.md)。
> **主计划**：[`docs/plan/global-shell-product-closure-2026-09-13.md`](../plan/global-shell-product-closure-2026-09-13.md)。
> **本片范围**：主计划 §10 Slice 7 —— 窄屏下模式内容面板的可达性，以及该切片结转的 Agent/身份欠账与真实 200% 缩放证据。
> **本片不含**：S8–S12。它们仍未开工，账目见 §6。

---

## 1. 范围与状态

| 事项                                                       | 状态         | 说明                                                                                                                           |
| ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 模式内容面板的窄屏接入（Work / Assistant / Custom）        | **verified** | `narrow-mode-content-panels` 已从 deferred 台账移除                                                                            |
| 窄屏入口的键盘可达 / Escape / 焦点回归 / aria 关系         | **verified** | 与上同一 spec                                                                                                                  |
| desktop→narrow→desktop 的 active tab / store 往返          | **verified** | 面板状态由共享 tab store 承载                                                                                                  |
| Agent picker 在 390 宽下的键盘可达、完整名称、长列表不挤压 | **verified** | `identity-narrow-viewport-controls` 已移除                                                                                     |
| 窄屏权限状态可读（声明档位 + degraded 优先级）             | **verified** | 同上                                                                                                                           |
| 真实浏览器 200% 缩放的证据                                 | **verified** | `real-200-percent-zoom` 已移除；配方见 §4.3                                                                                    |
| 窄屏 overlay 的 browser **back** 行为                      | **pending**  | 合同未定（面板开合刻意不进 URL），已登记 `mode-panel-back-and-scroll`                                                          |
| 窄屏 overlay 打开/关闭后的**滚动位置保持**                 | **pending**  | 现有 mock 无消息可滚动，无法构造判别式；已登记同一条目                                                                         |
| Agent 列表按 provenance 收窄（official-only）              | **blocked**  | 依赖 `/agent` 投影新增 `AgentV2.Info.originRelativePath`，属服务端合同，未获批前不动；`agent-picker-custom-narrowing` 保持开放 |
| chat 模式的真实 provider turn E4                           | **pending**  | 新登记 `chat-mode-e4-turn`，见 §6                                                                                              |

**本片未交付且必须显式记账的**：`back`/scroll 两项（原因与解锁条件见 §6），以及 `agent-picker-custom-narrowing` 依赖的服务端字段。

---

## 2. Git 账目

- 分支 `global-shell-e2e`，HEAD `ff237887022d0c77da08974512df53e79bf8fceb`。
- 相对 `origin/main`：**ahead 75 / behind 0**。
- **本片未产生任何 commit**（Git 授权未授予），因此提交列表为空——这不是"没有改动"，改动全部在工作树里。
- 工作树：18 个已跟踪文件被修改，3 项未跟踪（`docs/plan/prompt-global-shell-remaining-closure.md` 为用户粘贴的执行手册，保留未动；`packages/app/e2e/regression/narrow-composer-controls.spec.ts` 与 `packages/app/e2e/zoom/` 为本片新增）。
- 无远程 PR，分支未推送、无上游。

改动文件（按层）：

- L1 UI/内容：`packages/app/src/pages/session/session-side-panel.tsx`
- L2 路由/状态：`packages/app/src/pages/session.tsx`、`components/titlebar.tsx`、`context/layout-helpers.ts`、`context/mode.tsx`
- i18n：`packages/app/src/i18n/{en,zh,zht}.ts`（新增 `session.panel.show` / `session.panel.hide`，三语齐全）
- 测试：`e2e/regression/mode-slot-fallback-a11y.spec.ts`、`e2e/regression/narrow-composer-controls.spec.ts`（新）、`e2e/regression/mode-detail-personas.spec.ts`、`e2e/utils/mock-server.ts`、`e2e/utils/waits.ts`、`e2e/zoom/`（新）、`src/context/layout.test.ts`、`src/pages/session/assistant-session-panel.test.tsx`
- 账面：`e2e/coverage-manifest.json`、`playwright.config.ts`、`package.json`、`.gitignore`

---

## 3. 五层追踪

**决定关系的函数（file:line）**

- 窄屏挂载规则：`modeContentPanelShown({ routeType, mode, docked })` —— `packages/app/src/context/layout-helpers.ts`。它是三个消费者（面板生命周期、titlebar 入口与 `aria-controls`、正文 `inert`）的唯一判定函数；本片把它做成接受 `docked` 的单一表达式，正是因为早前一版让调用方各自传"有没有 session"，类型检查当场拒绝了那次漂移。
- 断点字符串：`MODE_CONTENT_PANEL_QUERY`（同文件），三处 `createMediaQuery` 同源。
- 面板生命周期与两个覆盖层 affordance：`packages/app/src/pages/session/session-side-panel.tsx` 的 `contentPanelShown` / `contentPanelFloats` / `contentPanelOpen` 与两个 `createEffect`。
- 正文让位：`packages/app/src/pages/session.tsx` 的 `narrowContentPanelOpen()`，仅用于同一个 `modeContentPanelShown(..., docked: false)`。
- 入口状态：`packages/app/src/context/mode.tsx` 的 `contentPanelOpen` / `toggleContentPanel`（**刻意不持久化**，理由见 §5）。

**复用而非新建**：模式面板本体未新增任何 owner——`ChatRightPanel` / `WorkSessionPanel` / `AssistantSessionPanel` / `CustomSessionPanel` 仍是原来的组件，仍是单一挂载点，窄屏只改外层 box；入口与既有 `#secondary-sidebar-toggle` 同构（同 `aria-expanded`、同"IDREF 随挂载而定"的规则）。

**未审范围**：`packages/core`、`packages/aigcfroge`（服务端）、`packages/desktop`、SDK 生成物本片一律未改。

---

## 4. TDD 与门禁

### 4.1 RED（先证明红在目标契约上）

- 在 `mode-slot-fallback-a11y.spec.ts` 新增三条：Work/Assistant 在 390×844 下经 `#session-mode-panel-toggle` 可达。
- 实测红：`locator('#session-mode-panel-toggle')` **element(s) not found** —— 失败点是"入口不存在"，不是 setup/端口/fixture。这是关键判别：本片其余测试在服务器冷启动时会红在 `expectDevServerReady`，两者必须分开记账（见 §4.4）。
- 独立第二角度：真实缩放 harness 在同一契约上也是红的，且带证书 —— Work `artifactTabVisible: false`、Assistant `panelVisible: false`，同时 `innerWidth 720 / DPR 2 / mq768 false / 1200px 探针溢出`证明浏览器真的缩放了。

### 4.2 GREEN（本次实际运行，均为 `--workers=1 --retries=0`）

| 命令                                                                 | 结果                                               | 层级/模式                                         |
| -------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `test:e2e --project=chromium-narrow -g "S7: the mode content panel"` | **6 passed**（2.3m）                               | E3 / chat·work·assistant·custom·coding 的窄屏呈现 |
| `test:e2e --project=chromium-narrow`（`narrow-composer-controls`）   | **3 passed**（1.6m）                               | E3 / composer 身份控件                            |
| `test:e2e --project=chromium -g "narrow keyboard user"`              | **1 passed**（1.8m）                               | E3 / personas 转正断言                            |
| `test:e2e:zoom --project=chromium-real-zoom-768`                     | **2 passed**（1.2m）                               | E4-ish / 真实浏览器缩放                           |
| `bun --cwd packages/app test`                                        | **1042 pass / 0 fail**（120s），virtualizer 3 pass | E1/E2                                             |
| `bun --cwd packages/app typecheck`                                   | exit 0                                             |                                                   |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`           | passed（124 changed files）                        |                                                   |
| `bunx prettier --check`（18 个改动源文件）                           | clean                                              |                                                   |
| `git diff --check`                                                   | clean                                              |                                                   |
| manifest 结构校验（字段/owner/status/fixme 口径，脚本复算）          | 通过，deferred 13 / entries 2                      |                                                   |

### 4.3 真实 200% 缩放的配方（本片新建 `packages/app/e2e/zoom/`）

三个条件同时成立才是"真实缩放"，缺一即退化为模拟，且都不经 CDP：

1. `channel: "chromium"` —— Playwright 默认 `headless: true` 用的是 `chrome-headless-shell`，该二进制**没有缩放子系统**（不含任何相关 pref 字符串，也从不写 `Preferences`）。用默认 headless 会得到"预置无效"的假结论。
2. `viewport: null` —— 任何显式 viewport 都会让 Playwright 发送 `Emulation.setDeviceMetricsOverride` 钉住布局视口，把预置缩放整个掩掉（实测：预置 + 1280×720 viewport → innerWidth 仍 1280、mq768 true）。仓库现有 config 用的 `devices["Desktop Chrome"]` 正属此类。
3. 启动前预置 `Default/Preferences`：`partition.per_host_zoom_levels.x."127.0.0.1".zoom_level = log₁.₂(2) ≈ 3.8017840169239308`。`x` 是默认存储分区名（缺它整段被忽略），值是对象而非裸 double，host 键**不带端口**且 `localhost` 是另一个键。

实测证书（`--window-size=1440,900`）：干净 profile `innerWidth 1440 / DPR 1 / mq768 true`，预置 profile `innerWidth 720 / outerWidth 1440（窗口不变）/ DPR 2 / mq768 false`，1200px 探针由不溢出变为溢出。spec 在触碰任何应用 UI **之前**先断言这四项，所以浏览器哪天不再认这个预置，失败的是证书而不是产品结论。**CDP 的 `scale`/`deviceScaleFactor` 依旧不能替代**（`scale: 2` 布局视口仍是 1440×900、DPR 1、媒体查询不变；`deviceScaleFactor: 2` 只抬 DPR），§10 原文未修订。

### 4.4 环境事实（会影响后续所有 e2e 判读，必须继承）

- 本机 dev server 与仓库同在 FUSE/NTFS 挂载上。**每次 Playwright 运行会让它卡住 2–5 分钟**（vite 进程 `wchan=request_wait_answer`，即阻塞在挂载的内核守护进程），期间连静态路径都排队。机制与更正记录在 `docs/technical-debt.md` §8（`冷态 dev server 的首轮编译会顶穿就绪探测预算`），本片复测到更极端的量：**冷启动预热 `/` 单独耗时 293 秒**，之后每个路由 7–11 秒。
- 因此本片所有 e2e 结果都是**先预热、再运行**得到的；预热脚本是本片临时产物，已在收尾时删除。**台账明确反对全局调大 `APP_READY_TIMEOUT`**（那会让"服务器真的没起来"也一起变慢），所以我没有改 `waits.ts` 的行为，只在 `gotoWhenReady` 上补了一段说明该机制的注释。可靠做法应落在 harness 的 global setup，已写进 `e2e-readiness-predicate-flake` 的 unlock。
- **并发会互相杀死**：我曾在 zoom 运行时并行跑 1042 个单测，那一轮 zoom 因 app 未渲染而红；串行重跑即 2 passed。后续切片请串行，或先把预热带进 harness。
- 曾按授权建过一个 ext4 验收检出（`/home/keer/aigcfroge-verify`）：源码树复制成功，但 `node_modules` 复制在 FUSE 上进入 D 状态 45 分钟仍未完成，且 `bun install --frozen-lockfile` 因锁文件漂移失败。**该半成品已删除**——依赖不完整的检出比没有更危险。若后续仍要走 ext4：复制源码时必须带上 `patches/`，依赖建议完整复制现有 `node_modules`（含 `.bun` store 与各包 symlink 农场）而不是重装。
- 未触碰用户进程：全程复用 3000 端口上那个跑了 22 小时的 `bun run dev`，未重启、未占用 4444，未使用 4096。

---

## 5. 产品证据与实现要点

1. **门控的真相**：`session-side-panel.tsx` 原来是 `<Show when={isDesktop() && !!params.id}>`，768px 以下**五个模式内容面板一个都不挂载**（不是藏起来）。manifest 当时只登记了 Work/Assistant/Custom，实际 Chat 与 Coding 受同一门控约束；本片按五模式处理，没有只修三个。
2. **接入方式**：`md` 以上行为完全不变（`flex-1 min-w-0`，仍常挂载以保持"切模式不重置状态"）；以下同一 owner 浮在会话体之上，正文由 `session.tsx` 置 `inert` + `aria-hidden`（覆盖层对键盘用户必须真的让位，不能只挡眼睛）。**单一挂载点**：窄屏不是第二份面板，所以 resize 不会重置 active tab。
3. **Coding 刻意排除**：它的内容 owner 是 review/files，窄屏模式已通过自己的 Session/Changes 标签到达；再挂一个浮动副本是同一 owner 的第二呈现，不是入口。该排除被单独断言（`a coding session offers no narrow entry`），不是隐含决定。
4. **发现并修掉的真缺陷（持久化 open 状态）**：我第一版把 `contentPanelOpen` 做成了持久化偏好（仿次级侧栏）。这在窄屏是错的——面板是覆盖层，正文同时被 `aria-hidden`，于是"打开过一次"之后，**任何后续会话都会自带一个盖住正文且对辅助技术不可见的浮层**。实测证据：personas 用例里 Work 段打开面板后导航到 Assistant 会话，页面标题栏仍是 Work、正文标题从无障碍树里消失、`getByRole("heading")` 匹配 0 个节点。改成内存态（不持久化）后该用例通过。这条差异是有意的，代码注释里写了原因。
5. **权限状态的优先级**：窄屏用例曾按"声明 `full` 就看到 full"来写，实测拿到的是 `data-kind="degraded"`、`aria-label="Permission state: Limited (mode-detail-not-projected)"` —— 这正是 `permission-display.ts` 的规则（blocked/degraded 压过声明档位）。断言已按产品的真实规则重写：非编码会话断言 degraded 压过 full，编码会话（detail 已投影）断言 full，两者都断言有可访问名且完整落在 390 视口内。
6. **长列表不挤压控件**：断言的落点是"控件宽度不变 + 完整在视口内 + 列表自身有界可滚动（沿用既有 12rem 上限）"，**不断言纵向位置**——实测 composer dock 会因窄屏权限横幅等异步部分落位而整体位移 280px，那是 dock 的正常重组，把它写成不变量会得到一个假红。
7. **既有 spec 的转正**：`mode-detail-personas.spec.ts` 原先用 `toHaveCount(0)` **钉住**了"窄屏拿不到面板"这个缺陷，现已改为"面板存在但关闭，打开后可达"；三处 `closed:false` 观察里属于本片主题的两处已转为 `expect()`，第三处（Custom 的无名按钮）属他人主题未动。
8. **i18n / a11y**：新增 `session.panel.show|hide` 走 en/zh/zht 三语（parity 测试通过）；入口与次级侧栏同构地暴露 `aria-expanded` 与 `aria-controls`；浮层关闭后焦点回到入口（先让焦点离开入口再按 Escape，否则"焦点回归"不可证伪——这是仓库已有的教训，我在新用例里照做）。

---

## 6. 未交付项与解锁条件

以下三项已写入 `packages/app/e2e/coverage-manifest.json`（或保持原登记），不得被"全绿"覆盖：

1. **`mode-panel-back-and-scroll`（owner S7，新登记）**——plan §10 对同一载体的 back 与 scroll 保持要求未交付。back 的合同本身未定：面板开合刻意不进 URL，所以 browser back 现在会离开页面而不是关闭浮层，哪种才是产品想要的需要裁决；scroll 的判别式需要让 mock 提供可滚动的消息，目前 mock 无消息，无法构造。两项都在条目里写了解锁方式。
2. **`agent-picker-custom-narrowing`（owner S7，保持开放）**——picker 的"仅官方 agent"收窄依赖 `/agent` 响应投影新增 `AgentV2.Info.originRelativePath`，这是服务端合同变更，按计划 §4.3 需先获批；本片只验证了与 provenance 无关的窄屏部分（键盘、完整名称、长列表），没有搁置它，也没有假装它已闭环。
3. **`chat-mode-e4-turn`（owner S9A，新登记）**——五模式 E4 要求对 chat 未达成。实测依据：`e2e/real/session-turn.spec.ts` 创建会话时**不带 `mode`**，所以那条"landed"的 turn E4 跑的是服务端默认（coding）。`modes.chat.e4` 原写 `planned S5` 已改为说明这一点，因为旧字段不能证明用例存在与否——决定它的是 spec 自己的请求。

**台账勘误**：`bench-narrow-review-staging` 的 owner 原为 `S7/S16`。全仓与计划/评审/ADR/PRD 中**不存在 S16**（计划切片止于 S12），已更正为 `S7` 并把理由写进 unlock。manifest 校验器的 owner 正则接受任意 `S\d+`，所以这个错误不会被门禁拦住——这说明该正则无法证明 owner 真实存在。

---

## 7. DoD / PR 对账

- 本片对应主计划 §10（Slice 7）与 §19 的第 6 项 `feat(app): preserve mode panels on narrow screens`；**未创建 PR**，也没有 commit，故不涉及 PR 计数。
- §21 中与本片相关的两项：**"窄屏可达所有已批准模式关键 panel，键盘/focus/a11y 完整；200% 使用真实缩放证据"** —— 模式内容面板的可达性、键盘/焦点、真实缩放均已取证；同一条里的 `back`/scroll 未取证，见 §6。
- §21 其余条目（E1–E4 全量、Session/File/PTY 资源回收、跨包检查、生产性能、共享身份、路由安全、业务 E4、安全恢复、Desktop、文档）**本片未复核**，属 S8–S12，不得据本片推断。
- 生产 benchmark 基线未重跑：本片未改 session/timeline 的性能敏感路径（改动集中在外层 box 与入口），但依据 `packages/app/AGENTS.md` 的要求，**这是一个未做的前置**，应在动 session/timeline 代码的切片开工前补上。

---

## 8. 审批结论与下一步

**状态：本片具备验收条件的是"窄屏模式内容面板可达 + 窄屏身份控件 + 真实 200% 缩放"三块，且均带可复跑证据；不构成 S7 全线完成，也不构成 READY。**

- 请求 READY 的前提（主计划 §17.3 与全部适用 DoD）远未满足：S8–S12 未开工，`back`/scroll 与 chat E4 是 backlog。
- **下一最小垂直切片**（按依赖与已授权范围）：S8 —— Home / Project / Location 生命周期与路径身份（`create/edit/remove/rollback`、alias/unknown、offline、多 server、非 Git、失效路径重定位），因为它是独立且已授权的一片，且 S7 不阻塞它。
- **仍需 Owner 决定的事项（不阻塞 S8 开工）**：
  - `back` 的产品合同：浮层关闭式，还是保持导航语义并据此写断言？
  - `AgentV2.Info.originRelativePath` 是否进入 `/agent` 投影（服务端合同 + Schema/迁移审批）。
  - 主计划 §22 的其余 gate：ADR/迁移/HTTP endpoint、M2 Memory/KB、Work-side custom Preset、附件/导入导出、Desktop packaged smoke 的 release scope、共享权限控制面，以及 Git 授权（commit/push/PR）。

---

# S8（进行中）：Home / Project / Location 生命周期

> 追加于 2026-09-17。S8 尚未关闭：本片落地了第一个垂直单元，其余按下面的账目登记。上文 §1–§8 是 S7 的记录，未改动。

## S8-1 已落地：注册表的目录拼写契约（verified）

**缺陷**：`packages/app/src/context/server.tsx` 的 `open`/`close`/`expand`/`collapse`/`move` 全部逐字比较 `worktree`。同一个目录只要换一种写法就绕过去重 —— `C:\AigcForge\App` 与 `C:/AigcForge/App`（原生 picker 与 URL 各能给一种）会变成两条注册、两个侧栏条目、两个 Location 作用域。

**RED**（目标契约上的失败，非 setup）：三条用例分别断言「同目录只注册一条」「变体拼写能关闭对应注册」「变体拼写能 expand/collapse/reorder」，实测 3 fail；同时新增的守卫用例（关闭只删注册、不动其他 scope 与 `lastProject`）与 `pathKey` 边界用例为 pass，说明红的是目标行为本身。

**GREEN**：复用仓库既有的目录键归一 owner `pathKey`（`packages/app/src/utils/path-key.ts`，已被 11 处使用），`sameDirectory(a, b)` 一个谓词替换五处逐字比较。**边界必须说清**：`pathKey` 归一的是*拼写*（分隔符、结尾斜杠、裸盘符），它**不折叠大小写**，也**不比较任何文件系统事实**，因此对物理身份不做任何断言 —— 这与计划「前端不自行 realpath 猜路径」的要求一致，也是我没有借这个改动去顺手"解决"同 inode 别名的原因。

**新增证据**：`packages/app/src/context/server.test.ts` 新增 4 例。关于 `pathKey` 本身：我先写了一个独立测试文件，随后发现 `packages/app/src/pages/layout/helpers.test.ts:204-215` **已经**覆盖分隔符、结尾斜杠、POSIX 根与裸盘符，于是删掉新文件、只把既有测试缺的那条边界（是否折叠大小写）补进那一处 —— 按「复用 → 归并 → 新增」的顺序，重复铺一套测试不是证据而是负债。

**命令**：`bun --cwd packages/app test:unit:file src/context/server.test.ts src/pages/layout/helpers.test.ts` → **41 pass / 0 fail**。

## S8-2 侦察结论：本片被切成两半（这是本片最重要的发现）

三路侦察（app 层 / core 层 / e2e 覆盖）在开工时改变了 S8 的形状：

1. **路径身份这一半根本不存在 owner，必须单独走 ADR。** 详见计划 §11 新增的实测勘误第 1 条。核心事实：`Project.resolve` 用 git remote / root-commit 标识项目而**不用路径**，非 Git 目录一律落到字面量 `global`；`LocationServiceMap` 以原始 Ref 结构为键，所以同一物理目录的两种拼写会得到两套 Location 服务图。登记 `path-identity`（owner S8，解锁：§22-2 的 ADR + 能"证明"并在无法证明时返回 typed unknown/degraded 的后端合同；任何持久化部分按 §4.3 需兼容解码与回滚设计）。
2. **「多 server 聚合」与 ADR-16 直接冲突。** 计划 §11.1 列了它，同片最后一句又要求 Home 遵守 ADR-16，而 ADR-16 明确把跨 server 合并收敛为后续项。今天 Home 只渲染当前 server。这需要 Owner 裁决，不是我能在实现里选的事 —— 登记 `home-multi-server-aggregation`。**若不登记，照 §11.1 字面实施就会做出 ADR 明确推迟的东西。**
3. **计划点名的"颜色保存失败回滚"有两处真缺陷，且含一个会咬人的陷阱。** 自动上色效应在 `layout.tsx:505` 写入乐观颜色、失败时只清在途守卫（`:520-522`），于是行内颜色是服务端从未接受的值；而**天真回滚会重新触发同一效应、再次发出失败请求**，重试环必须被显式打断。手动编辑对话框从不读 `saveMutation.error`，被拒绝的 PATCH 完全静默。两处都未修，登记 `project-color-save-rollback`：需要先裁决"失败后显示成什么"（中性头像 vs 保留并警示），证据必须是 E3（spec 内 `page.route` 把 `PATCH /project/:id` 改成 500，断言行内不显示被拒颜色**且请求数有界**）。
4. **本片多数行为今天零证据，且 manifest 里原本没有任何相应 key。** 「无 deferred key」不等于免做 —— no-project 恢复只断言了否定的一半，恢复分支从未被驱动；注册时对非法/不可访问路径零校验；项目列表无上限无虚拟化；Home 完全不读 health 状态。分别登记 `home-no-project-recovery`、`project-invalid-path`、`project-large-list`、`home-offline-state`。

**mock 保真度是本片多数的前置**（都写进了各自 unlock）：`GET /path` 恒返回 `config.directory`、`GET /project` 恒一条、`PATCH /project/:id` 未匹配即回 200 `{}`、`GET /file` 恒 `[]`、`/vcs` 恒 git。也就是说非法路径、颜色失败、多项目、picker 驱动的恢复，今天**都无法在 E3 里表达**。

## S8-3 账目

- 本片新登记 6 条 deferred：`path-identity`、`project-color-save-rollback`、`home-multi-server-aggregation`、`home-offline-state`、`project-large-list`、`project-invalid-path`（外加 `home-no-project-recovery`，共 7 条）。
- 计划文档 §11 追加了「实测勘误与边界（2026-09-17）」四条，与 S7 的 §10 处理方式一致：**不降级产品要求，只把实施前必须知道的事实与冲突写明**。
- manifest 用与 `e2e/real/manifest.spec.ts` 同规则的脚本复算通过（entries=2 / modes=5 / deferred=20）。**权威校验器（`e2e/real/manifest.spec.ts`）本轮未运行**：它的 project 会拉起 E4 harness（production build），在本机 FUSE 上代价过大；如实记账，不把它算作已取证。

## S8-4 颜色保存失败：一处修复并取证，一处被实测推翻（进行中）

**产品裁决（2026-09-17，Owner）**：失败后回落到默认颜色。

### 已修并已取证：编辑对话框不再静默失败

`components/dialog-edit-project.tsx` 的 `saveMutation` 从不读取 `error`，被拒绝的 PATCH 表现是"对话框停在那里、Save 重新可用、什么都不说"。现在失败时显示 `role="alert"` 的 `[data-component="project-edit-save-error"]` 且对话框保持打开，新增 `dialog.project.edit.saveFailed`（en/zh/zht 三语，parity 通过）。

**证据**：`project-color-save-failure.spec.ts` 第三条 —— 驱动 Home 的项目菜单 → Edit → 选颜色 → Save 被 spec 内的 500 拦下 → 断言 alert 可见且对话框仍在。**实测 passed**。

### 已修但只覆盖重试边界：自动上色

`context/layout.tsx:484-524` 原先在失败时只删在途守卫、留下乐观颜色，于是**任何后续 effect pass 都会重挑同一颜色、重发同一注定失败的写入**（永久性拒绝下无休止重试）。现在改为：先记录拒绝、再丢弃乐观颜色；服务端一旦报告颜色则清除该记录。

### 被实测推翻的断言（对我自己上一条记录的更正）

我在 S8-2 写过"行内颜色是服务端从未接受的值，于是页面显示一个下次重载就会变的颜色"。**这句不成立**，且错在方法上：我从 `list()` 的合并推断症状，没有去找**决定这个关系的函数以及谁消费它**——正是 `AGENTS.md` 警告的失败模式。

实测与静态追查的结果：

- 乐观颜色只被 `context/layout.tsx:466-472` 的 `list` memo 合并进项目，且只暴露为 `layout.projects.list`；它的消费者（`app.tsx:117`、`titlebar.tsx:146/399`、`dialog-select-file.tsx:292`、`session-header.tsx:135`）都是**按路径查找项目**，不渲染项目。
- 所有**渲染项目头像**的界面读的是 per-server 列表 `context/global.tsx:172`，它只合并 workspace 的 icon override，**从不合并该 store**。
- 浏览器实测（临时探针，已删除）：即使把写入答成 **200**，侧栏项目头像仍是 `data-variant="gray"`（`[data-slot="project-avatar-surface"]`，页面内恰好 1 个；`data-component="project-avatar-v2"` 计数 1）。

**结论**：「回落到默认颜色」在当前界面上是**视觉空操作**，任何 E3 用例都无法在两个方向判别它。因此：

- 我把断言改成**能真正成立且有意义的两条**：拒绝写入会被发出且不被重复（重试环守卫，含"至少发出过一次"以避免空绿），以及 200 下的对照（一次 pass 也是健康的形状，说明上界不是失败的副产品）；并**明确注明**头像的可见回落未被断言及原因。
- 该产品问题登记为 `project-color-fallback-visibility`：需要 Owner 决定自动上色的颜色**是否应该可见**。若应可见，就要让某个渲染路径消费 `layout.projects.list`（或把该 store 合进 per-server 列表），届时回落才可观测并且**必须**被断言——因为"一个会因保存失败而悄悄消失的可见颜色"正是 Owner 反对的状态；若不应可见，则这套自动上色本身就是半接线的死重，值得删除而不是留着。

### 命令与结果（逐条）

| 命令                                                                       | 结果                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `test:e2e --project=chromium`（该 spec，第一次整跑）                       | 2 passed / 1 failed                                                                       |
| 失败项：`is issued, then not repeated`（首例）                             | 挂在 `gotoWhenReady` 就绪探测（环境卡顿，非断言；已登记 `e2e-readiness-predicate-flake`） |
| 失败项单独重跑：`-g "is issued, then not repeated"`                        | **1 passed (43.4s)**                                                                      |
| `an accepted colour write is also issued once` + `the edit dialog says so` | **2 passed**                                                                              |
| `test:unit:file src/i18n/parity.test.ts`                                   | 2 passed / 0 fail                                                                         |
| app typecheck                                                              | exit 0                                                                                    |
| `LINT_BASE_REF=origin/main lint-changed`                                   | passed（129 changed files）                                                               |
| prettier / `git diff --check`                                              | clean                                                                                     |
| manifest 同规则复算                                                        | OK deferred=20 entries=2 modes=5                                                          |

**诚实边界**：这三条没有一次"单次 3/3 全绿"的运行——首例在第一次整跑里被环境卡顿吃掉，随后单独重跑通过。我不把它写成"3 passed"。

## S8-5 无项目恢复的机制追查：收窄了，但没钉死（进行中）

`home-no-project-recovery.spec.ts` 是故意红的复现。这一轮把嫌疑从「机制未知」收窄到一处，**但没有钉死**，原因如实记录。

**静态收窄（已核实，含 file:line）**：

- 路由是 `<Route path="/new-session" component={DraftRoute} />`（`packages/app/src/app.tsx:749`），而 `NewSession` 是 `lazy(() => import("@/pages/new-session"))`（`:79`）。因此"懒模块从未被请求"这一实测事实等价于：**`DraftRoute` 从未渲染出 `ResolvedDraftRoute`**。
- `DraftRoute`（`app.tsx:345-359`）是两层 `Show`：外层 `when={tabs.ready()}`，内层 `when={tabs.store.find(tab => tab.type === "draft" && tab.draftID === search.draftId)}`，且内层带 `fallback={<Navigate href="/" />}`。
- `tabs.ready()` 是 `persisted` 产出的**响应式** accessor（`packages/app/src/utils/persist.ts:622-638`），其 `initialValue` 为 `!isAsync`：对同步的 localStorage 路径**一开始就是 true**。这条把"外层 Show 一直为假"降为弱嫌疑，指向**内层**：
  - 若该瞬间找不到匹配草稿，则触发 `Navigate href="/"`，它会与 picker 流程自己的前向导航相互竞争——这能解释"URL 停在草稿、页面什么都没渲染"；
  - 若匹配到了，则 `ResolvedDraftRoute` 在 `<NewSession />` 之前退出了。

**为什么没钉死**：需要一次带插桩的运行（在 init script 里记录 `history.pushState/replaceState` 与 `popstate` 的实参，并在选择后立刻、以及 1 秒后再各 dump 一次 URL 与草稿标签页的 `draftID` 比对），这能区分"fallback 导航到 `/` 又被流程导航回来"与"外层 Show 从未为真"。本轮为此跑了 4 次，**全部在断言之前死在 `expectDevServerReady`**（本机 FUSE 卡顿），没有一次拿到插桩输出；插桩已还原（`git checkout`），工作树保持已提交状态。

**下一次的最小实验已写进 manifest 的 unlock**，不留给下一次重新推导。

**环境小结（本批）**：这一批 e2e 相关的失败中，绝大多数是就绪卡顿而非断言；私有端口方案会先付约 115 秒的 vite 冷启动，并且我观测到两个 vite 抢同一端口互相拖死（已只清理自己起的进程）。因此在当前主机上，**取证吞吐而不是结论质量**才是瓶颈。

## S8-6 恢复缺陷：可观测机制已钉死，内部原因仍未（按指令不投机修复）

**已钉死的可观测机制**（证据来自在**已提交复现内部**打点，而非另写探针）：

| 观测                              | 结果                                              |
| --------------------------------- | ------------------------------------------------- |
| `DIAG module app.tsx evaluated`   | 触发（应用模块已加载）                            |
| `DIAG Routes render path=…`       | **只出现过 `path=/`，两次**                       |
| `DraftRoute` 自身日志             | **从未触发**                                      |
| 浏览器 URL                        | `/new-session?draftId=<id>`                       |
| 持久草稿的 draftID                | 与 URL 中的 id 相同（**注意：这只是持久化记录**） |
| `[data-component="prompt-input"]` | 缺失                                              |

结论（已按复审收窄）：应用与路由器都挂载了，路由器**只为 `/` 渲染过**，从未为浏览器已显示的 `/new-session?draftId=…` 渲染——即**第一次**导航没有被路由器处理；第二次（不经 picker）正常。插桩确实被 vite 提供（`curl /src/app.tsx` 命中 4 处 DIAG），排除了"打点没生效"这个会否掉结论的可能。

**一处必须纠正的过度推断（复审指出，成立）**：我先前写「持久草稿的 draftID 与 URL 完全相同，因此内存里的 tab lookup 本该匹配」——**后半句越界**。`DraftRoute` 读的是**内存 store**（`tabs.store.find(...)`，`packages/app/src/app.tsx:351`，这才是决定该关系的函数），而我观测到的是**持久化层**的记录；由于 `DraftRoute` 从未被调用，**内存里那一刻 `tabs.store.find` 的结果从未被观测**。正确表述是：持久化记录中的 draftID 与 URL 相同；内存 lookup 在该时刻是否匹配**未知**。

**在本次复现路径与所测变体中，三项均保留同一失败签名；因此它们不是本缺陷的当前解释**（按复审口径，不泛化为普遍因果结论）：

1. **`DirtyDraftGuard`**：URL 确实变了（说明导航未被拦），且它在 Home 上早退（`chat-workspace.tsx:168-181`：无 active tab key、非 dirty）。**注意：这条是运行观测 + 源码结构共同得出，不是纯实验排除**，证据强度弱于第 2 条。
2. **对话框延迟焦点恢复**：停掉 `packages/ui/src/context/dialog.tsx` 的 `current.trigger?.focus()` 后复现依旧红。三条里最干净。
3. **"先提交再关对话框"的顺序**：把 `dialog-select-directory.tsx:120-122` 改成先 `dialog.close()` 再 `onSelect` 后复现依旧红；**但该变体的第一次尝试死在 `expectDevServerReady`，只有重跑才真正到达断言**，故证据强度弱于第 2 条。

不得据此写成"所有焦点恢复路径"或"所有提交/关闭顺序"都已被排除。

**仍未钉死的内部原因**：剩下的是"第一次的导航提交没有抵达路由器"。候选 owner 是 `context/tabs.tsx:174` 拿到的那个 `navigate`，或 picker 回调经 `launchModeSessionOrRoute`/`openProjectNewSession` 调用它的方式。**下一次实验**（已写入 manifest unlock，不留给下次重新推导）：在 `newDraft` 内记录 draftID/href 与 `navigate` 是否真被调用，再记录路由器的导航入口，与 `Routes` 的渲染日志三者对齐，即可在不猜的前提下把断点定位到 `navigate` 的哪一侧。

**为什么没修**：按审批指令，机制未钉死前不得按猜测修复，也不得用 sleep/重试/刷新/放宽断言遮盖。三次实验全部无效应经还原，工作树保持 `dc0fed0ed` 的已提交状态。**取证吞吐是本机瓶颈**：本轮多次尝试在 `expectDevServerReady` 处卡死，包括同一 spec 的热态重跑。

**环境纪律（按复审修正）**：本轮自启的私有 Vite（3033/3034）已清理；未操作用户服务。审查期间存在工具侧 Playwright 进程，不将其计为产品或本轮私有服务器。3000 当时是否健康，本轮未重新验证，也不把当前无监听归因给任何一方。

### S8-6 审批记录（2026-09-18，Owner 主审）

| 项              | 裁决                         |
| --------------- | ---------------------------- |
| S8-6 诊断检查点 | **ACCEPTED**                 |
| 可观测机制      | verified-by-execution-report |
| 内部原因        | **BLOCKED**                  |
| 产品修复        | 未授权、未实施               |
| S8 整体         | **OPEN**                     |
| READY           | **NO**                       |

接受的结论**仅**为：第一次经过 picker 的流程中，地址栏已进入 `/new-session?draftId=…`，但 `Routes` 的观察状态仍只渲染 `/`，`DraftRoute` 未进入，draft surface 未挂载。**不得**扩大为"navigate 一定没被调用"或"一定是某个特定 owner 阻止了导航"。三项候选只按当前实验变体排除（详见上节），不构成普遍因果结论。

**下一步唯一获批动作**：三点对齐实验（`newDraft` / router navigation entry / `Routes` render 三处日志 + 内存 `tabs.store.find` 结果 + URL draftId + 时间戳顺序），必须在健康主机、CI 或 ext4 检出上执行。判读走决策树（见 manifest unlock）。**禁止**：sleep 作修复、自动 retry、reload、重复点击、放宽断言、先改多个候选点再看是否变绿、为取证再压 3000 端口。**若三点对齐仍无法定位断点，不得转为试探性修改**，应上报证据不足并请求扩大取证范围。

### S8-6 后续进展（2026-09-18，第二次裁决之后） — 上面那段已过期

上面 293 行写的是"下一步唯一获批动作：三点对齐实验"。**该实验已经执行完毕**，因此那一段不再是当前状态。本节记录此后发生的事；**当前账目真源是 `packages/app/e2e/coverage-manifest.json` 的 `deferred["home-no-project-recovery"]`**，本节只是索引，冲突时以 manifest 为准。

已落地的三个提交，均只改 `packages/app/e2e/coverage-manifest.json`，未提交任何产品修复：

- `f5efe5479` — 三点对齐 + router 内部实验（Owner 批准的 option A）。排除了"`replaceState(undefined)` 是元凶"这一头号嫌疑：它出现在**每一个**变体里，包括所有正常工作的那些，是 router 内部 `saveCurrentDepth()`（`@solidjs/router/dist/lifecycle.js:36-41`）写 `_depth`，不是 app 的 `clearAuthToken`。
- `5988ccc5c` — 排除 `DraftRoute` 自身的 `tabs.ready()` 闸门与 `keyed` fallback `<Navigate href="/" />`（`app.tsx:345-359`）：三种时序全部正常，fallback 从未触发。
- `8a2b0c80f` — 记录机制和解：URL 由 `navigateEnd` → `setSource` 写入（`@solidjs/router/dist/index.js:744-754`），location signal 由另一条 native 路径提升（`index.js:662-664`），而提升只在 `!Transition.promises.size && !Transition.queue.size` 时发生（`solid-js/dist/solid.js:819`），否则 `completeUpdates` 走 `solid.js:843-849` 直接 return、不跑 effects。

**当前口径：高置信度候选机制，不是浏览器已验证根因。** manifest 自己仍写着 `CONFIRMATION STILL OWED`。证据来自 happy-dom + 真实版本的 `@solidjs/router` / `solid-js` + 库源码 + 已记录的浏览器表面行为；**没有**直接观测浏览器运行时的 `Transition` 状态。把它改写成"根因已验证"会违反 `AGENTS.md:27-30`。

**修复面尚不是 `pages/layout.tsx:99`。** Owner 第二次裁决已明确指出该边界只是候选之一，并且更值得怀疑的是 picker 自身的资源：`dialog-select-directory.tsx:60-68` 与 `dialog-select-directory-v2.tsx:67-74` 都写着 `createResource(() => (missingBase() ? true : undefined), …)`，而 `DESIGN.md:39-43` 恰好把这一形状列为禁止项——"one stray entry silently freezes navigation: no error, no pending request, the old screen simply stays"，这正是本缺陷的签名。首轮-only 的触发也被这一候选解释：`missingBase()` 是 `!(sync.data.path.home || sync.data.path.directory)`，全新 profile 下为真所以 fetch 真的发出；第二轮 `path.home` 已有值，source 为假，根本不 fetch，也就没有 pending。**实际是哪一个资源持有 pending，仍需浏览器时序证据。** 修复 owner 由实验决定，不得预设。

另有一条会改变实验设计的更正：裁决要求的 `Transition.promises.size` / `Transition.queue.size` / `Transition.running` **无法从 app 代码读取**——`Transition` 是模块私有（`solid-js/dist/solid.js:167` 的 `let Transition = null`），精确导出表里有 `startTransition`、`useTransition`，没有裸 `Transition`。公开可用的等价观测是 `useIsRouting()`（router 已导出；transition 被扣住时 router 的 `.finally` 无法运行，该信号会一直为 `true`），配合 route 边界 fallback 的实际出现与否。

**下一步唯一获批动作**：在健康主机、CI 或 ext4 检出上做**一次**聚焦浏览器确认运行，直接对齐 `newDraft` / router received-returned / `pushState` / location signal / `Routes` render / `DraftRoute` / 内存 `tabs.store.find` / 实际 pending resource 的时序，并记录 `pageerror`、console error、ErrorBoundary/`ErrorPage` 是否出现。禁止项同上，另加：不得把 happy-dom 结果改写成浏览器结果、不得改动或提交未跟踪的 `docs/plan/prompt-global-shell-remaining-closure.md`。临时 DIAG 允许，但运行后必须还原，不得进入产品提交。**若该实验确认了具体 owner，则已获条件性预批准进入单变量修复单元，无需再次审批。**

---

## S7 / S11 追加证据（2026-09-19）

本节**追加**，不修改上文任何历史结论。上文 §4.3 的缩放配方已按本节第 3 条复跑确认。

### 1. S7 滚动往返：由 pending 转绿（含变异探针）

上文 §1 记「窄屏 overlay 打开/关闭后的滚动位置保持」为 pending（当时 mock 无消息可滚动）。现在该前提已不成立：mock 改为提供 40 条消息，用例 `mode-slot-fallback-a11y.spec.ts:509` 先断言 fixture 确实会溢出，再用真实滚轮手势把偏移推离底部锚点，然后开/关浮层，最后同时断言**同一个元素仍在挂载**（`data-scroll-probe`）与**偏移未变**。

- 单跑 **1 passed (18.9s)**；整份 spec **15 passed (38.6s)**。
- 可判别性用**变异探针**证明，不是靠断言自证：把 `pages/session.tsx:309-314` 的 `narrowContentPanelOpen()` 强制为 `false` 后，该用例变红于 `the floating panel must mark the session body inert, not remove it`（**1 failed**）；探针已撤回，`git diff --exit-code` 确认 `session.tsx` 与 HEAD 一致。
- 未声称：滚动断言依赖「列只被置 `inert`、不被卸载」（`session.tsx:305-308` + `:2035`），这条链路是**读出来的**，本身没有做变异。

### 2. S11 `hidden-panel-request-and-remount`：补齐节点身份

既有 `mode-surface-wiring.spec.ts:112` 用 `toHaveCount(1)`，而 **1 个新节点同样满足计数**，所以"是否 remount"此前没有证据。新增用例 `:125`：

- 先断言 10 个 slot 全部盖到 `data-node-probe`（少一个就在该步失败，不会滑成空转）；
- 用 rail 按钮做**应用内**切换（不是 `page.goto`），要求 Chat 的 main/sidebar 回来时仍是**同一节点**；
- 请求计数只限定 Chat 自己的 asset 列表（`/workflow-asset` 排除，因为 Work 也读它）——新显示的模式合法加载自己的数据。

计数：单跑 **1 passed (14.7s)**；整份 spec **14 passed (51.3s)**。第二条生命周期（次级侧栏关闭/重开）保持独立覆盖：`mode-slot-fallback-a11y.spec.ts:244-254` 断言关闭时 count 0、打开时有 `role="complementary"` 与 `aria-controls`。

未声称：该用例**没有**跑变异探针。

### 3. 真实 200% 缩放：复跑确认 §4.3 仍然成立

```bash
PLAYWRIGHT_PORT=3082 bun run test:e2e:zoom -- --reporter=line
```

- 结果：**2 passed (10.9s)**（control「the seed is what zooms, not the window」+「a seeded profile zooms, reflows, and must keep the mode panels reachable」）。
- 更正记录：本次会话早前的一次 manifest 编辑曾把 `real-200-percent-zoom` 当作 S7 未取证缺口重新登记——那是错的，依据只是执行手册 §2 的快照，没有先读本报告 §4.3。该条目已从台账移除，证据改记在本节与 S7 条目里。教训与手册 §2 的告诫一致：**旧绿色报告不能单独证明当前通过，但也不能在不复跑的情况下被当作当前缺失。**

### 4. 基础 Chromium E3 全量（DoD 门）

```bash
PLAYWRIGHT_PORT=3082 PLAYWRIGHT_SERVER_PORT=4096 PLAYWRIGHT_WORKERS=1 \
  bun run test:e2e -- --project=chromium --reporter=line --timeout=300000
```

- 结果：**247 passed (14.1m)**，exit 0，workers=1，无 retry，未放宽任何断言。
- 该轮已包含本轮新增的 S11 身份用例与第 1 条的滚动用例。
- 环境：ext4 worktree `/home/keer/s8w`（detached `5473f53a8` + 当时未提交 patch），私有端口 3082。FUSE 工作树上的 dev server 冷启 `ready in 99574 ms`，同一 spec 两次死在 `page.goto` 的 600s 超时——那是环境失败，不计作产品 RED。

### 5. 本节未覆盖的门（不得据本节推断通过）

E4（`test:e2e:real` 两轮 runtime）、`test:bench`、Desktop 独立 launch smoke（脚本尚未建立）、展示矩阵四项目（zh/zht/dark/narrow）、`bun typecheck` 全仓与 `bun run lint` 全量。本节只跑了：zoom 套件、基础 E3 全量、以及若干定向批次（24 passed / 30 passed），外加改动文件的 `oxlint`、`prettier --check`、`tsgo --noEmit -p e2e/tsconfig.json`、`git diff --check`。

---

## S7 presentation-locale repair: closed on the full four-project matrix (2026-09-19)

This section **appends** to the S7 record; the earlier English-only `verified` claims and the
intermediate failure counts above remain part of the history.

### Root cause and change

The remaining presentation failures were test ownership/locator defects, not product failures.
The `Skills` section entry in `ChatFeatureList` had no stable hook, so the spec matched it by an
English-only accessible-name regex. That regex cannot match zh/zht, and the resulting
`locator.click` waited until the 180s test timeout. The fix adds `data-feature={feature.id}` to
the Chat feature button (`packages/app/src/components/mode-surfaces.tsx:124`) and locates the
selection by that hook (`packages/app/e2e/regression/mode-slot-fallback-a11y.spec.ts:306`).
The secondary-sidebar panel/toggle cases now use their stable IDs, so the block tests the
surface it actually opens; the mode-content-panel cases remain on the
`[data-component="session-mode-panel"][data-mode=...]` hooks.

No assertion was weakened, no retry or sleep was added, and no product behaviour was changed.
The earlier failed run is retained as a real RED observation: `chromium-zh` timed out at
`mode-slot-fallback-a11y.spec.ts:307` because the translated label did not match; the run was
interrupted after the unrelated zht readiness failure, so it is **not** counted as a product
failure.

### Verification

Environment: ext4 worktree `/home/keer/s8w` at `5473f53a8` plus the uncommitted S7 patch, private
Vite on port 3083, API port 4096; `workers=1`, `--retries=0`; the user's process on port 3000 was
not started or stopped.

```bash
cd /home/keer/s8w/packages/app

PLAYWRIGHT_PORT=3083 PLAYWRIGHT_SERVER_PORT=4096 PLAYWRIGHT_WORKERS=1 \
  bun run test:e2e -- e2e/regression/mode-slot-fallback-a11y.spec.ts \
  --project=chromium-zh --project=chromium-zht --workers=1 --retries=0 --reporter=line
# 28 passed (1.1m), exit 0

PLAYWRIGHT_PORT=3083 PLAYWRIGHT_SERVER_PORT=4096 PLAYWRIGHT_WORKERS=1 \
  bun run test:e2e -- e2e/regression/mode-slot-fallback-a11y.spec.ts \
  --project=chromium-dark --project=chromium-zh --project=chromium-zht --project=chromium-narrow \
  --workers=1 --retries=0 --reporter=line
# 56 passed (2.5m), exit 0

PLAYWRIGHT_PORT=3083 PLAYWRIGHT_SERVER_PORT=4096 PLAYWRIGHT_WORKERS=1 \
  bun run test:e2e --project=chromium-dark --project=chromium-zh --project=chromium-zht \
  --project=chromium-narrow --workers=1 --retries=0 --reporter=line
# 76 passed (3.3m), exit 0
```

The full matrix includes `global-shell-presentation.spec.ts`,
`narrow-composer-controls.spec.ts`, `presentation-matrix.spec.ts`, and the complete S7/S11
`mode-slot-fallback-a11y.spec.ts` file, so this closes the manifest entry
`mode-panel-locale-locators` with all four presentation projects green. The previous 66/10
count is superseded by the final 76/0 count and is retained above as the RED history.

### Residual note

The old `getByRole("complementary", { name: ... })` assertion was not asserting the mode content
panel; its English-profile pass came from the separately named secondary sidebar. The repair
removes that ownership ambiguity. No separate landmark-naming defect is registered here because
the current source has one `role="complementary"` (the secondary sidebar at
`packages/app/src/components/secondary-sidebar.tsx:553-555`, with an explicit `aria-label`), and
the plan's S7 contract requires the panel entry, Escape, focus restore, and aria relationships
that the passing cases now assert. If a future accessibility audit wants a named landmark on a
mode content wrapper, it must be filed with its own evidence and owner rather than inferred from
this locator repair.

---

## S8 offline notice: the cached-session half, and the first authoritative manifest run (2026-09-19)

This section **appends**; the S8 record above is unchanged. Item (1) of `home-offline-state`
("the notice above a NON-empty list is implemented but unasserted") is now asserted, and the
entry's evidence half closes with it.

### What was owed, and why the three landed cases could not pay it

All three abort `/global/health` and the session endpoints _before_ the first load, so they can
only observe Home with nothing to lose. The open question is the additive one: once a healthy
server has handed Home a session list and the server then becomes unreachable, does the notice
sit **above** that list, or does the empty state (or the notice) replace it? Those are different
products, and the implementation claims the former. A `toHaveCount(0)`-style negative cannot
distinguish them, which is why this half was left unasserted rather than asserted weakly.

### The case

`e2e/regression/home-server-unreachable.spec.ts:131` loads one session from a healthy mock,
flips a mutable `offline` switch so the health and session routes start aborting, then requires
**both** the notice (`:140`) and the session row (`:141`) to be visible.

The switch is a box the two route handlers consult per request, so the case starts healthy and
loses the server mid-page without a reload. Folding it in also removed the second copy of mocks,
routes and init script: all four cases now share the single `openHome` setup. The 15s budget on
the notice is deliberate — one health-poll interval is 10s (`utils/server-health.ts`, `pollMs`),
so a failure there means the poll stopped reporting rather than that it was given too little
time. Event-driven polling; no sleep and no retry anywhere in the file.

### Discriminating power, measured rather than asserted

A green that only says "a row is visible" could be satisfied by a row that never depended on the
notice. So the case was also run against a mutation: the group block at `home-overview.tsx:316`
becomes `Show when={!offlineServer() && (pinned().pinned || groups().length > 0)}`, i.e. the
notice _replaces_ the list instead of sitting above it. Result: **1 failed** at `:141`, with
`:140` (notice visible) already green — the notice appeared and the list is exactly what
disappeared. The mutation was reverted and `git diff --exit-code` confirms the file is identical
to HEAD.

### Runs

| command                                                                                 | result                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------- |
| `bun run test:e2e -- e2e/regression/home-server-unreachable.spec.ts --project=chromium` | **4 passed (22.0s)**                   |
| same, with the replacement mutation applied                                             | **1 failed** (the new case, at `:141`) |
| same, after folding the setup back into `openHome`                                      | **4 passed (22.4s)**                   |

All on the ext4 worktree `/home/keer/s8w` at `87b9d0af2` + this patch, private port 3083,
`workers=1`, `--retries=0`, no sleep, no relaxed assertion. The user's port 3000 was neither
started nor stopped.

### The authoritative manifest validator has now been run

`e2e/real/manifest.spec.ts` — the machine-readable entry contract that forbids silent `test.fixme`
quarantine and requires every deferred scope to carry an owner and an unlock — had been recorded
as **not run** through S7 and S8 because its project boots the full E4 stack (production build +
backend). It runs on the ext4 worktree in about a minute:

```bash
cd /home/keer/s8w/packages/app
E4_RUN_DIR=/tmp/e4-manifest-run bun run test:e2e:real -- --project=chromium-real manifest --reporter=line
# build 47.11s, preview up, 4 passed (56.0s)
# [E4] teardown gate passed: ports free, process group gone, workspace clean, backend local, report clean (SIGTERM)
# [E4] teardown report: leaked=[] providerRequests=0
```

Four cases pass against the manifest as edited by this slice: every entry carries the full
route × mode × layer × failure × platform contract; every quarantined `test.fixme` case has an
entry; all five modes declare their coverage layer; no deferred scope floats without an owner
and an unlock. The prior "not run" note is therefore stale in the direction of _less_ coverage
than exists — but note what this does **not** say: it validates the ledger's shape, not that any
behaviour in it is verified, and the 4 passing cases are not E4 lifelines.

### Lint gate repair inherited from `5473f53a8`

`LINT_BASE_REF=origin/main bun run script/lint-changed.ts` was **red on this branch** before this
slice: `packages/app/src/components/directory-picker-domain.test.ts` carried an added line,
`} as unknown as Parameters<typeof createDirectorySearch>[0]["sdk"]`, against the guarded rule
`typescript/no-unsafe-type-assertion`. The gate checks _added_ lines only, which is why the
identical assertion 21 lines above it (grandfathered, unchanged) is not reported: the violation
belongs to the commit that added the unexpected-body case, not to this one.

Repair, in the "depend on the interface you use" direction rather than by loosening the test:
`createDirectorySearch` now takes `DirectorySearchSdk` (`directory-picker-domain.ts:269-283`) —
its two reads, with response bodies typed `unknown`. That is already what the body assumes (it
narrows with `isPickerNode`, which landed with the recovery fix in the same file), and it lets a
caller supply those two reads without fabricating an entire SDK. The **input** types stay sourced
from `ServerSDK` through `Parameters<...>`, so they cannot drift from it. Types only, no runtime
change; both real callers (`dialog-select-directory.tsx:76`, `dialog-select-directory-v2.tsx:85`)
pass a full `ServerSDK` and still typecheck.

### Gates (exit codes)

`bun --cwd packages/app typecheck` **0** · `bun --cwd packages/app test:unit` **1048 pass / 0 fail**
· `test:virtualizer` **3 pass / 0 fail** · `prettier --check` clean · `LINT_BASE_REF=origin/main
lint-changed` **passed** (138 changed files) · `git diff --check` clean.

### Not covered by this section

The presentation matrix, `test:bench`, Desktop, the full-repo `bun typecheck` and the E4 lifelines
(turn/files/pty/identity/v2-admission) were **not** re-run here; only the E4 _manifest_ spec was.
`home-offline-state` keeps one open item that is a product question, not a gap in evidence:
whether the offline state owes a retry affordance of its own (today it reuses the app-level
"Retrying automatically..." wording and points at Manage servers).

## S9A opening: the chat-mode E4 turn, and the default it replaces (2026-09-19)

This section **appends**. It closes deferred `chat-mode-e4-turn` and moves `modes.chat` to
`landed` for E4 — with the scope of that claim written down rather than implied.

### What was missing, and why the existing turn E4 could not cover it

`e2e/real/session-turn.spec.ts` created its session with no `mode` field, so the "landed" turn E4
was driving the server default. A `planned` field cannot settle that question — the spec's own
request does — which is why the entry was registered during S7 instead of being left implied by
the S5 label. Two things followed: the five-mode requirement in plan §5.2 was unmet for chat, and
the sentence "the landed turn E4 runs under coding" was itself unmeasured.

### The two cases

`session-turn.spec.ts:146` creates a session with `mode: "chat"` and drives exactly the chain the
coding case drives: submit through `[data-component="prompt-input"]`, the real provider's turn
reaching the timeline, then a reload serving that projection from the real DB. `:166` applies the
same reader to a session created _without_ a mode.

The mode is **read back** from the session record (`persistedSession(...)`), not inferred: it is
not in the turn's projection and it is not in the URL. One reader, two create payloads, two
different answers in the same run — `chat` versus `coding` — and that A/B is what makes the chat
assertion discriminating, rather than a mutation probe. The turn also runs under a different
agent policy than the coding case (`resolvePrimaryAgent`: chat → `meta`,
`packages/core/src/product-mode-agent-policy.ts:52-56`), so it exercises a different system
prompt and a different set of panels.

### Runs

All on the ext4 worktree `/home/keer/s8w` at `d5a938f6b` + this patch, `--project=chromium-real`,
`workers=1`, `retries=0`, no sleep and no relaxed assertion. Every run ends with the harness's own
teardown gate (ports free, process group gone, workspace clean, backend local, report clean):

| command                                                             | result                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| the two new cases only, `-g "chat-mode session\|without a mode"`    | **2 passed (7.0m)**                                 |
| the whole `session-turn.spec.ts` file                               | **4 passed (8.1m)**                                 |
| the authoritative validator `manifest.spec.ts` on the edited ledger | **4 passed (6.1m)**, `leaked=[] providerRequests=0` |

Boot dominates these numbers: the same manifest spec took 56.0s on a warm earlier run and 6.1m
here, so the durations are not a property of the cases.

### Ledger

- `modes.chat.e4` rewritten to what actually landed, including its limit; `modes.chat.status`
  `planned` → `landed`.
- `chat-mode-e4-turn` **removed as delivered** (deferred 23 → 22). The old text is retained in
  the entry's history in this report's §6, which is why §6's "pending" row above is now stale —
  the manifest is the live ledger, this report is the record.
- Plan §5.2's "one happy path per mode" is now met for chat **only**. work, assistant and custom
  keep their own S9A/S9B/S9C E4 entries; nothing here touches them.

### Not covered by this section

No product code changed: the E4 provider still streams only its success script, so the rest of
`provider-scenario-scripts` (tool call, HTTP failure, SSE interruption, duplicate/out-of-order,
slow response) stays open with its unlock unchanged — plan §12.4's provider failure/recovery E4 is
still owed. Also not run: the presentation matrix, `test:bench`, Desktop, `bun typecheck` for the
whole repo, and the other E4 lifelines (files/pty/identity/not-found/v2-admission).

## S9A: a transient provider failure is retried, and the turn still lands (2026-09-19)

This section **appends**. It delivers the HTTP-failure family of plan §12.4's provider
failure/recovery E4 and narrows the `provider-scenario-scripts` entry to the families that remain.

### What was owed

`provider-scenario-scripts` listed tool call, HTTP failure, SSE interruption,
duplicate/out-of-order and slow response, with the unlock "each remaining scenario is added with
the spec that needs it". §12.4 requires provider failure **and recovery**, and the harness could
only answer success: its `/chat/completions` handler had exactly one script.

### The harness knob

`POST /e4/provider-failures?count=N` arms the next N completion requests to answer a real 5xx
(`packages/app/e2e/real/orchestrator.ts`). A query parameter rather than a body, matching
`/e4/admission`, so the harness still parses no request bodies — and the failure happens _inside a
real turn_ instead of being faked in the test. The counter is bounded by construction, so an
unarmed provider behaves exactly as before and no other case changes.

Why the retry observed is the product's own: `retryable` treats any status ≥ 500 as retryable
regardless of what the provider SDK reports (`packages/aigcfroge/src/session/retry.ts:74`), and
the turn path sets the SDK's own `maxRetries` to 0
(`packages/aigcfroge/src/session/prompt.ts:1545` — against the title path's 2, which no case here
reaches because every case passes an explicit title, so `isDefaultTitle` is false and no title
call is made). Backoff is 2s then 4s (`RETRY_INITIAL_DELAY` 2000 × factor 2, capped at 30s), so
two armed failures hold the retry status on screen for about six seconds: long enough to assert
presence without asserting timing.

### The cases

`session-turn.spec.ts:214` arms two failures, prompts once, and asserts four things: the retry
surface becomes visible (`[data-slot="session-turn-retry"]`, rendered from the backend's own
status by `SessionRetry`), the turn then lands with no second prompt and no reload, the provider
was asked exactly 3 times, and the retry surface is gone at the end. `:199` is the control —
nothing armed, exactly 1 completion. That pair is what makes the count attributable: one reader
(`providerCompletions`, a filtered read of `/e4/provider-requests`), two states of the harness.

### Runs

All on the ext4 worktree `/home/keer/s8w` at `4eb723700` + this patch, `--project=chromium-real`,
`workers=1`, `retries=0`, no sleep, no relaxed assertion:

| command                                         | result                                               |
| ----------------------------------------------- | ---------------------------------------------------- |
| the armed case alone                            | **1 passed (1.9m)**                                  |
| both provider-failure cases                     | **2 passed (7.0m)**                                  |
| the whole `session-turn.spec.ts` file (6 cases) | **6 passed (8.0m)**, `leaked=[] providerRequests=19` |

### Ledger

`provider-scenario-scripts` stays **open**, with a narrower scope: the HTTP-5xx family is
delivered; the interruption/variance family (tool call, SSE interruption, duplicate/out-of-order,
slow response) is not, and its unlock now says those need different harness knobs before they can
have a spec. Closing the entry on this run would be the "registered debt as completion" the
protocol forbids.

### Not covered

SSE interruption, duplicate/out-of-order delivery, slow responses and tool calls; S9A's Work
persistent-contract half (needs the Schema/migration approval, so it is not started here); the
presentation matrix, `test:bench`, Desktop, the full-repo `bun typecheck` and the other E4
lifelines.

## Session verification round (2026-09-19)

Appended for the runs that close this session's slices. Nothing above is rewritten. Two citations
in the sections above went stale when later cases were appended to the same file; they are
corrected here rather than edited in place, because those sections were committed with them.

### E4, default environment, all eight specs at `a4f0e6720`

```bash
cd /home/keer/s8w/packages/app
E4_RUN_DIR=/tmp/e4-default-all bun run test:e2e:real -- --project=chromium-real --reporter=line
# 23 passed, 1 skipped (7.9m); [E4] teardown gate passed: ports free, process group gone,
# workspace clean, backend local, report clean
```

The one skip is the V2 variant's own switch, by design: `v2-admission-gap.spec.ts:25` —
`test.skip(() => !e4().v2Runtime, "V2 variant only — run with E4_V2_RUNTIME=1")`. So the default
round does **not** pin the V2 admission gap; that is the second round below. The other four
`test.skip` calls in `e2e/real/` are the mirror image (they skip when `v2Runtime` is true), which
is exactly why the two rounds exist rather than one.

### E4, V2 variant, same commit

```bash
E4_V2_RUNTIME=1 E4_RUN_DIR=/tmp/e4-v2-round bun run test:e2e:real -- --project=chromium-real --reporter=line
# 10 passed, 14 skipped (6.8m); teardown gate passed
```

14 skipped = the four V1 chains (files 3, identity 2, pty 3, turn 6). 10 passed = manifest 4,
lifeline 3, not-found 2, and `v2-admission-gap.spec.ts:71` — whose green means **the gap is still
there**, not that V2 works: durable admission lands, execution is not dispatched, and the
V1-shaped projection is empty. Do not read that tally as S9C progress.

### E3, base Chromium, all 247 cases at the same commit

```bash
PLAYWRIGHT_PORT=3083 PLAYWRIGHT_SERVER_PORT=4096 PLAYWRIGHT_WORKERS=1 \
  bun run test:e2e -- --project=chromium --workers=1 --retries=0 --reporter=line
# 246 passed, 1 failed (18.0m), exit 1
```

The failure is `session-todo-progress.spec.ts:85` — `page.waitForResponse` for
`PATCH /session/:id/task` never resolved after a Kobalte checkbox click, hitting the 180s test
budget while the failure snapshot shows the page itself healthy and rendered. It was classified
rather than excused:

- the whole spec file passed alone immediately afterwards in the same environment, same commit,
  same private port: **17 passed (45.1s)**, the failing case included;
- nothing in this session touched the todo-progress path. The only production change was a
  type-only narrowing in `components/directory-picker-domain.ts`;
- it is registered as `session-todo-writeback-order-flake` (`entries`, `flake-observed-once`,
  owner S3) with the baseline-protocol re-run as its unlock, and **not** quarantined.

So the honest reading of that round is **246/247 with one unclassified-but-registered order
flake**, not "green" and not "a regression".

### Corrections to two citations in the sections above

- the chat-mode cases moved when the provider-failure cases were appended to the same file: they
  are `session-turn.spec.ts:169` and `:189`, not `:146` and `:166`. The provider-failure cases are
  `:199` and `:214`, as recorded.
- `DirectorySearchSdk` is declared at `directory-picker-domain.ts:277` and consumed as the
  parameter type at `:356`, so the earlier "269-283" was the pre-edit range.

### Gates this session did not run

The presentation matrix (zh/zht/dark/narrow), `test:bench`, `bun --cwd packages/desktop test`,
Desktop launch smoke (the script still does not exist), `bun typecheck` for the whole repo, and
`bun run lint` in full. The E4 rounds above, the base E3 round, `bun --cwd packages/app test`
(1048 pass), the app typecheck, `lint-changed` and `prettier --check` are the ones that ran.

## S9A: an interrupted provider stream is retried, not left hanging (2026-09-19)

Appends to the provider failure/recovery work above. This delivers the second family of plan
§12.4's requirement and leaves `provider-scenario-scripts` open for the variance family only.

### The knob

The existing endpoint gains a mode: `POST /e4/provider-failures?count=N&mode=sse-cut` writes one
delta and then destroys the response socket, with no finish reason and no `[DONE]` — so unlike the
5xx family there is no HTTP status for the client to classify. `mode` defaults to `http-500`, so
the calls the earlier cases make are unchanged, and an unknown mode is refused with 400 rather
than defaulted: a knob that silently fell back to another family would let a case pass while
testing nothing.

### Measured before asserted

The first run of the case was deliberately a probe. It asserted only that _some_ terminal surface
appears and printed which one; the result was `retry=1 error=0`, i.e. a terminated stream is
classified as retryable and is not claimed as a failure. The probe was then replaced by the
measured assertions and the union is gone.

### The case

`session-turn.spec.ts:248` arms one cut, prompts once, and asserts: the retry surface appears
(`[data-slot="session-turn-retry"]`, driven by the backend's own status), no Error row is claimed
for it, the answer lands with no second prompt and no reload, the provider was asked exactly 2
times (the cut plus the attempt that recovered), and a later turn still reaches the provider — the
interruption does not wedge the session.

### Runs

Ext4 worktree `/home/keer/s8w` at `91fa40088` + this patch, `--project=chromium-real`, workers=1,
retries=0, no sleep:

| command                                          | result                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| the interrupted-stream case alone                | **1 passed (6.7m)**                                   |
| the whole file (7 cases)                         | **7 passed (12.1m)**, `leaked=[] providerRequests=28` |
| the authoritative validator on the edited ledger | **4 passed (5.9m)**                                   |

Not asserted, and worth saying out loud: the case does not bound how long the client takes to
notice the cut. That one case took 6.7m where the 5xx family's single case took 1.9m, and the
difference is consistent with the client waiting on its own stream timeout rather than reacting to
the socket teardown — but that is an inference from two durations, not a measurement, so no timing
claim is made here or in the assertions.

### Ledger

`provider-scenario-scripts` stays **open** and now names one remaining family: tool call,
duplicate/out-of-order, slow response — each needing its own knob before it can have a spec.

---

## S9A provider variance: slow and duplicate completion evidence (2026-09-19)

This section appends the final evidence for the `slow` and `duplicate` deterministic-provider
scenarios; it does not rewrite the earlier HTTP-5xx or interrupted-stream evidence.

- `mode=slow` withholds response headers for 5 seconds. The harness records only non-prompt
  metadata (`scenario`, `receivedAt`, `responseStartedAt`), and the spec requires the consumed
  scenario to be `slow` plus at least 4500ms between receipt and response start. This makes the
  case discriminating without a test-side sleep or an inference from total UI duration.
- `mode=duplicate` sends one byte-identical content delta twice from the same completion. The real
  projection persists exactly one assistant message and still has one after reload. The measured
  text is doubled: `E4 deterministic responseE4 deterministic response`.
- Each case disarms the harness in `afterEach`, so a failure before dispatch cannot leak an armed
  scenario into the next test. Unknown scenario names still fail closed with HTTP 400.
- Readiness polling now bounds each external health/preview fetch to 5 seconds; readiness still
  comes only from the real endpoint and the existing outer deadline, not from a fixed sleep.

Final run on the isolated ext4 E4 worktree (`workers=1`, `retries=0`):

```text
session-turn.spec.ts: 9 passed (3.8m)
manifest.spec.ts: 4 passed (51.5s)
teardown: ports free, process group gone, workspace clean, backend local, leaked=[]
```

Owner ruling for provider text duplication: **no heuristic text deduplication without a per-delta
identity**. Repeated content is a legitimate provider answer and cannot be distinguished from an
unidentified proxy replay. The delivered contract is message identity, not content rewriting.
Identifiable SSE/WS replay after reconnect remains an independent S10 idempotency obligation.

---

## S8 router/error-boundary root cause: fixed without reducing fatal coverage (2026-09-19)

The open `router-recreated-by-error-boundary-reset` defect is closed. The measured RED was already
recorded above: after an error reached the app-level Solid `ErrorBoundary`, the router's next
transition reset that boundary, re-evaluated its children, created a second Router before
`navigateEnd` committed history, and then pushed the URL through the dead first context.

### Ruling and implementation

The selected structure is **stable Router outside, the existing complete fatal boundary inside the
Router root**. It is deliberately not “add another inner boundary” (the outer boundary would still
be reset and recreate the Router), and not “wrap only the route outlet” (which would silently drop
fatal coverage for the shell and Provider constructors).

`AppRouterBoundary.Root` now owns that invariant. `AppBaseProviders` puts Query, WSL, Dialog,
Marked, FileComponent, `AppInterface`, the server/global/settings providers, the shell, and the
route outlet under the one existing Sentry + `ErrorPage` boundary. Only Router construction itself
is outside it. Web passes `Router`; Desktop passes `MemoryRouter` to the same owner and consumes a
lazy route-outlet accessor only after its startup resources are ready.

### Discriminating evidence

`packages/app/src/app-router-boundary.test.tsx` uses the real Solid Router integration and asserts:

1. after one render error reaches the fatal fallback, the next navigation renders `/next`, history
   is `/next`, and Router construction count remains exactly 1;
2. a Provider-construction error still reaches the fatal fallback exactly once;
3. the error-free control also navigates with one Router and no fallback.

Final targeted result: **3 passed / 0 failed**.

Two temporary mutations proved both halves and were reverted:

- moving the boundary back outside Router made the first test RED with Router mounts **2 instead
  of 1**;
- moving the provider/shell render outside the boundary made `provider-construction` escape and
  the second test RED.

Browser controls on the ext4 worktree, private Vite 3083, workers=1/retries=0:

```text
home-no-project-recovery.spec.ts: 1 passed (11.6s)
new-session-route.spec.ts: 4 passed (13.4s)
```

The private server was stopped after the runs and port 3083 was confirmed free. No process on port
3000 was started or stopped.
