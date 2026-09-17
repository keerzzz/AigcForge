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
