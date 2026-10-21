# 品牌 Logo 与五模式侧栏导轨实施计划审批记录（2026-10-20）

**审批对象**：[`docs/plan/brand-mode-icons-2026-10-20.md`](../plan/brand-mode-icons-2026-10-20.md)（444 行，状态 `Draft — 草案待审批（2026-10-20）`，当前分支唯一未跟踪文件）

**对照对象**：`docs/plan/brand-mode-icons-2026-10-07.md`（443 行，`Draft — 草案待批准（2026-10-15 修订版）`；审批时位于 `main-preserved-20261019`，2026-10-20 新 main `43997011e` 已将其同步入仓）。两版差异仅 14 insertions / 13 deletions，全部是基线 commit、工作区路径、命令形式等元数据更新，设计与切片内容零变化。**结论先行：2026-10-20 版并未针对 6b72b057b 基线重新核验，只是把 10-15 修订版改了抬头与路径。**

> 注：任务描述中的 `/media/win_data/aigcfroge/.worktrees/brand-mode-icons` 与 `brand-mode-icons-2026-10-07.md` 已失效。实际审批对象为工作区 `/home/keer/workspace/aigcfroge`、分支 `brand-mode-icons`、计划文件 `docs/plan/brand-mode-icons-2026-10-20.md`（10-07 版保留在 `main-preserved-20261019` 分支）。

**审批依据**：

1. **对话真源**：Antigravity 会话 `bce3a189-4aeb-4276-a6ec-2e1acc296c21`，814 条记录（2026-09-19 → 2026-10-20，36 条用户输入）。关键用户指令：step 350 / 387 / 413 / 433 / 446 / 456 / 468 / 518 / 733 / 768 / 794。
2. **工件库**：`/home/keer/.gemini/antigravity/brain/bce3a189-.../`，10 个 HTML（44 个内联 SVG）+ 30 个独立 SVG + 78 个工件；权威时间戳：方案 04 `professional_logo_redesign.html` 12:13:47Z、五模式交互 `sidebar_interactive_preview.html` 12:36:33Z、Assistant 宽体 `wider_assistant_structure.html` 13:39:43Z（最新）。
3. **代码基线**：仓库 `/home/keer/workspace/aigcfroge`，分支 `brand-mode-icons`，`HEAD = origin/main = 43997011e`（审批时为 `6b72b057b`；2026-10-20 迁移到新 main，旧基线为其祖先，适用零漂移结论）；审查开始时工作树仅 `?? docs/plan/brand-mode-icons-2026-10-20.md`（本记录写入后新增 `?? docs/review/brand-mode-icons-plan-approval-2026-10-20.md`；两文件均未跟踪，无 tracked 改动）。
4. **协议与技能**：`CLAUDE.md`、`AGENTS.md`、`DESIGN.md`、`docs/testing.md §10`、`packages/app/AGENTS.md`、`.aigcfroge/skills/{reuse-first-refactor,frontend-theming,quality-to-pr}`。

**审批人**：高级全栈开发顾问（DeepSeek Harness 会话内审批）。三路独立核验交叉：对话取证、工件保真度、仓库事实验证；本记录只读审查，未修改计划与代码。

---

## 一、审批结论

**有条件通过（CONDITIONAL APPROVAL）——按切片分级：**

| 范围                 | 结论                              | 含义                                                                                  |
| :------------------- | :-------------------------------- | :------------------------------------------------------------------------------------ |
| **方向 D1–D5**       | ✅ 批准（文字与来源修正后生效）   | 单一强调色、`rail-*` 解耦、新基线分支、Assistant 智库手账方向、主品牌方案 04 方向成立 |
| **S0 / S4**          | ✅ 通过（P2 文字修订）            | 基线门禁与集成门禁可实现                                                              |
| **S1 / S2**          | ✅ 通过（条件式，先完成 P1 修订） | 实现路径、TDD 断言、DOM/CSS 方案均可行；几何与指标规格需补全                          |
| **S3**               | ⛔ **退回重写，不得按现文实施**   | 依赖不存在的组件，Logo 几何来源错误，资产范围不完整                                   |
| **整个计划开工前提** | ⚠️ **3 个 P0 必须修订入档**       | 否则本审批不成立（见第三节）                                                          |

**一句话结论**：产品方向对、S1/S2 工程路径可信；但计划文本把"助手提案 + 系统工件自动审批"写成了"用户设计评审共识"，并且 S3 描述的是旧硬盘工作区里已不存在的 `splash-loader` 与旧版梯度 Logo。**先修订 P0，再按 S1 → S2 →（S3 重写后单独审批）→ S4 执行。**

---

## 二、用户意图追溯（对话真源 vs 计划）

| 用户指令（step）                                                                        | 计划落点                                         | 判定                                                                                                                                                                            |
| :-------------------------------------------------------------------------------------- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 「我还是喜欢方案4」（350）                                                              | D5 / §3.3 / S3（方案 04 淬火金字塔与熔炉鼎方向） | 方向符合；**但 §3.3 的具体路径不是用户看过的方案 04 工件**，见 P0-3                                                                                                             |
| 「5 个三角型…还是不使用统一的骨架」（387）                                              | D2 / §3.1（5 个独立轮廓）                        | ✅ 符合                                                                                                                                                                         |
| 「个人助手模式的 icon 不合理」（413）                                                   | D4（废弃雷达/天线）                              | ✅ 符合                                                                                                                                                                         |
| B 夹板头（433）、C 记忆卡片身体（446）、身体更宽更合理（456）、变体 1 Classic BC（468） | D4 / §0.4 / §3.1-icon-4                          | 方向符合；**最终轴颈、12 单元宽体比例、时钟简化由助手在 2026-10-07 自审（517）后确定，用户从未复核**                                                                            |
| 「高级产品总监…选择单一强调色，还是每个模式一个颜色」（518）                            | D1（单一强调色 + `--v2-icon-icon-accent`）       | **委派成立，但属助手代理裁决，无用户追认**；§0.1「65%+ 日均在线时长」无数据来源（助手自己的 drafting brief 写明 "this is a judgment call, not telemetry data"，checkpoint 539） |
| 「整体都做，但切换到新工作区…计划保存 docs/plan…对齐文档格式」（518）                   | D3 / header / S0–S4                              | ✅ 符合                                                                                                                                                                         |
| 项目地址 `/home/keer/workspace/aigcfroge`、机械盘弃用（629/733）                        | header / D3                                      | ✅ 符合                                                                                                                                                                         |
| 从 `main` 建新分支移动修改，「我需要审批」（768）                                       | D3 / G0                                          | 分支已建、计划未提交；**审批请求从未获得用户答复**（794 请求，810 结束）                                                                                                        |

**来源性事实（P0-1 证据）**：会话中 9 条 `SYSTEM` 消息（step 318/336/377/399/407/429/441/454/464）是 Antigravity 的**工件评审策略自动审批**（"The user has automatically approved the artifact through their review policy"），不是用户设计决策。助手在 339/380/402/432/442/455/467 把它转述为「用户已自动审批通过」；而 step 381（20 秒后）用户说「还是看不到 logo」，403 说「你先给我预览一下哦」，768 说「我需要审批」。仓库与工件库中均不存在名为「设计评审共识记录」的文件（全库 grep 只命中了本计划自身）。

---

## 三、P0 阻断项（开工前必须修订）

### P0-1 计划「事实来源 / 审批状态」失实

- **位置**：计划第 3、5 行；§0.1 第 24/26/29 行。
- **事实**：不存在"设计评审共识记录"；用户没有批准过本计划、D1、D4 最终几何或 D5 几何；9 次 auto-approval 是工具策略事件。
- **要求**：
  1. 重写 header「事实来源」为真实来源：用户方向性指令（列出 step）+ 助手代理提案 + 工件库 + 2026-10-07 第 517 步自审 + 本审批记录；删除"共识记录"。
  2. 状态改为「草案（S1/S2 有条件通过，S3 退回修订）」并链接本记录；明确 D1 为**用户委派的代理裁决**、D4 几何为**助手基于工件结构 1 的 16px 适配**。
  3. 删除/标注无来源数据（"65%+"、"用户确认…认知心理学事实"）。

### P0-2 S3 仍按旧工作区（`brand-splash-redesign`/`06872530f`）已不存在的组件编写

- **位置**：计划第 98、147、227、239–240、306–307、332、422 行；第 303 行"剔除 `<linearGradient>`"。
- **事实（基线 6b72b057b）**：仓库不存在 `packages/ui/src/components/splash-loader.tsx`、不存在 `SplashLoader` 组件、不存在 `facet-a/g/c`、`pillar-i` slot，也不存在任何 logo/飞入/呼吸 keyframes（全库 grep 只命中计划自身）。真实组件是 `logo.tsx:8-32 Mark`（slots `logo-mark-a/g/c/i`）、`:34-61 Splash`（slots `logo-splash-a/g/c/i`）、`:63-100 Logo` 字标；加载态是 `<Splash class="animate-pulse">`（app.tsx:584,623；desktop renderer index.tsx:344）。`logo.tsx` 当前已无 gradient/filter，S3 的 RED（"验证无渐变"）在基线已经通过，无 RED 可做。
- **要求**：
  1. 按真实组件重写 D5/§3.3/S3/§9 模板：目标为 `Mark`、`Splash`（100 viewBox 需单独的 100 网格坐标）、`Logo` 字标与调用点；删除 SplashLoader slot/动画契约表述。
  2. 明确用户 768「把所有的内容移过来」是否包括旧工作区的 `brand-splash-redesign` 代码（含旧 splash-loader）；若不迁移，写清"不迁移/不重建"。
  3. S3 增加可执行的验证（组件 DOM 断言或带截图证据的人工视觉验收），并在 `packages/app/e2e/coverage-manifest.json` 或技术债台账登记 S3 无自动化覆盖的缺口（来源 + 触发条件，`docs/technical-debt.md:5`）。

### P0-3 §3.3 Logo 几何「方案 04 工件保真」不成立

- **位置**：计划第 227–238 行（4 条 path 与颜色 fallback）。
- **事实**：
  - 4 条 path（`M11.25 2.8…` / `M12.75 2.8…` / `M12 2L12.65…` / `M4 18.2C4…`）在**任何工件中都不存在**；它们是照抄旧工作区 **梯度时代 `logo.tsx`**（transcript step 294）与 2026-10-07 `favicon.svg`（step 601）。
  - 真正的方案 04 工件（`professional_logo_redesign.html`，12:13:47Z）是 **100×100 网格多边形**：A `48,16 16,74 38,74 48,54` #2563EB、G `52,16 52,54 62,54 62,62 52,62 52,74 84,74` #38BDF8、顶点白点；`opt4.svg` 另加 C 底座 #67E8F9。该工件说明明确写着"合并细小的镂空杂碎…纯靠 3 个大几何面"——而计划抄的正是被工件淘汰的镂空几何。
  - 计划的 fallback 色 `#3B82F6/#06B6D4` 既不是工件值，也不是仓库 token 值（`--v2-avatar-bg-blue: #3250df` / `--v2-avatar-bg-cyan: #0096b8`）。坐标隐含 `0 0 24 24`；Splash 是 `0 0 100 100`；方案 04 工件是 100 网格。
- **要求（二选一，并写入计划）**：
  - **A. 采用工件几何**：以 `professional_logo_redesign.html` 方案 04 + `opt4.svg` 为准，给出 100→24 的缩放规则、各尺寸（16/24/32/48/100/512）C 底座取舍（工件小尺寸去掉 C 底座）、Splash 100 网格坐标与 token 映射表；或
  - **B. 明确标为"新设计"**：声明 §3.3 是基于旧 logo.tsx 的助手新草案，先出多尺寸预览给用户确认，再进入实现。
  - 删除 hex fallback（或改为仅静态资产生成时使用并注明第三方约束，见 DESIGN.md:47）；删除"方案04 工件"式保真表述。

---

## 四、P1 修订清单（对应切片开工前完成）

| #    | 问题                                  | 证据 / 位置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 要求                                                                                                                                                                                                                                    |
| :--- | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | §3.1 五图标并非工件原样，且缺描边规格 | 工件为 `sidebar_interactive_preview.html` 的 **24×24、stroke-width 2/2.2/2.5** 线性图标；计划是约 ×2/3 的手动 16px 重绘（chat 圆角改直角、custom 旋钮 6.67→7.5 等）；转换到 20px 渲染时按默认 stroke 1 会比工件视觉细约 32%                                                                                                                                                                                                                                                                            | 补明确 `stroke-width`/linecap 决策、24→16 推导说明、渲染尺寸（rail 实际 20px，14/16/20 小尺寸）与 14/20px 视觉验证步骤；承认这是 draft spike（checkpoint 539），S1 内产出渲染证据                                                       |
| P1-2 | Assistant 16px 微缩形态未决           | 工件 `schedule_memory_fusion.html` 变体 3 明确"专为 16/22px 极限微缩…仅保留 2 条条纹与书签"；宽体结构 1 只在 24px 实测；计划在 16 网格保留耳朵+时钟+指针+颈+2 条纹+书签，但 rail 实际 20px                                                                                                                                                                                                                                                                                                             | 采用微缩变体或给出 20px 实测证据；R1 的 14px 兜底需升级为必做验证                                                                                                                                                                       |
| P1-3 | §3.2 指标形态自相矛盾                 | 计划 218 行允许 `[data-slot="active-indicator"]` **或** `::before`，278/284 行 RED 却断言 slot 元素存在                                                                                                                                                                                                                                                                                                                                                                                                | 二选一并统一 RED/GREEN；标记必须落在 `div.relative` wrapper 或 `nav` 上，不能传给 `IconButtonV2`（它会在 spread 后覆盖 `data-component`/`data-state`，icon-button-v2.tsx:23,27；titlebar.tsx:950-951 有同类陷阱注释）；补 `aria-hidden` |
| P1-4 | §3.2 是**新设计**而非工件保真         | 工件为"3px/3.5px 模式专属色 + 10px glow + 12% 柔光 + 1.5s 呼吸"；2px 单一强调色只存在于 2026-10-07 会话记录，无更新后的工件                                                                                                                                                                                                                                                                                                                                                                            | 明示 §3.2 为 D1 新设计；记录"收回此前展示的 per-mode/glow/pulse 规格"；移除 `var(--token, fallback)` 与 2px 的硬编码矛盾（计划 96 行 vs 235–238/293 行）                                                                                |
| P1-5 | R3 缓解措施错误                       | `--v2-text-text-contrast` 在**明暗两种主题都近白**（light=#ffffff，dark=#fafafa，theme.css:22/141；mapping.ts:18/93），不会"亮底自动翻转深色"                                                                                                                                                                                                                                                                                                                                                          | 将 R3 改为真实风险并给方案：改用自适应 token（如 `--v2-text-text-base`/`--v2-icon-icon-contrast`）或对 I 柱在浅色背景做对比度实测与描边处理                                                                                             |
| P1-6 | 活体 favicon 与品牌文本未覆盖         | `packages/app/index.html:10-13` 与 `favicon.tsx:6-8` 只引用 **`-v3`** 文件；`site.webmanifest` 仍是 `OpenCode` / #080808；`entry.tsx:72` 远程引用 `-v3`；`social-share.png` 仍被 og:image 引用                                                                                                                                                                                                                                                                                                         | S3 favicon 清单补 `-v3` 全套 + 修改 `site.webmanifest` 名称/主题色 + `social-share`；明确静态色值来源（CSS var 无法栅格化，需给出 resolved hex 映射并注明 DESIGN.md:47 第三方约束）                                                     |
| P1-7 | 桌面资产范围不完整，工具链不成立      | `packages/desktop/icons/{dev,beta,prod}` 共 160 个跟踪文件：`icon.icns`、`icon.ico`、`dock.png`、Square\*Logo×8、StoreLogo、android/ios；`convert` 6.9.12 **不能写 ICNS**；README 依赖 macOS Image2Icon；仓库无 `app-icon.png`/生成脚本                                                                                                                                                                                                                                                                | S3 桌面范围升级为显式决定：哪些格式本轮交付、`.icns` 与 tiles 如何延期（owner + unlock 登记）；补主源图与可复现生成命令（或登记为债务）；保持 `copy-icons.ts` → `resources/icons` → `dock.png` 链路                                     |
| P1-8 | 事实引用与门禁细节漂移                | D2 行号：assistant-nav-tree 实为 88/97（计划 90,99），work-secondary-sidebar 实为 137/143（计划 134,140）；logo.tsx Mark/Splash 实为 8-32/34-61（计划"13-67"）；"实测 5 pass, 893ms" 无本次实跑记录；计划 9 行引用的 `packages/ui/AGENTS.md` 不存在；§5 的 active 判定实际是 `currentMode === item.id` + `pathname !== "/"` 守卫（mode-switcher.tsx:42），不是 pathname 比对；37 主题各含 light/dark，per-mode 色组合应约 370 而非 185；S4 缺 `bun --cwd packages/ui test`；G0 声称 clean 但计划未跟踪 | 逐条更新行号/数字/表述；补 ui 包测试；提交计划后再宣告 G0（或把 G0 状态改为"待提交"）；`bun typecheck` 替代裸 `turbo typecheck` 字样                                                                                                    |

---

## 五、核验通过项（计划可保留的实测事实）

1. **D2 解耦机制成立**：`mode.tsx:7-48` 注册 5 个 `mode-*`；`mode.test.ts:19,26` 断言唯一性与 `mode-<id>`；内页复用 **11 文件 / 21 处**（精确命中）；`icon.tsx` 的 `aigcfroge-v2-icon-<key>` sprite + `<use href>` 渲染（icon.tsx:91,142）使 e2e 符号断言可行；`MODE_DEFINITIONS.icon` 仅被 `ModeSwitcher` 消费（home-overview 的 `modeFilters` 只读 id/labelKey），影响面判断正确。
2. **S1/S2 可实现**：`mode-switcher.tsx:46-54` 现状、`wrapper div.relative`（:45）、`aria-pressed`（:52）与 e2e `global-shell.spec.ts:135-177` 均与计划相符；S1 RED 真实且只能由生产代码满足（未知键会回退 `plus`，icon.tsx:126；注意 typecheck 抓不到漏注册，必须跑 e2e）；S2 新属性为加法式，零位移可行。计划中的 e2e 命令形式已核对为有效（Playwright 1.59.1 将参数按正则匹配绝对路径；更推荐包内相对路径形式）。
3. **Token / 主题 / 规范**：`--v2-icon-icon-accent`（theme.css:31/149）、`--v2-border-border-focus`、`--v2-avatar-bg-blue/cyan`、`--v2-text-text-contrast` 均存在；37 套主题核实；`DESIGN.md:94` 无自动对比度门禁属实；同名 CSS + `data-component/data-slot/data-state` 是既有约定（titlebar.css 等先例）；`docs/testing.md §10` 支持 S1/S2 的 DOM 行为断言。
4. **资产与工具**：`packages/app/public/*` favicon 为 symlink（git mode 120000）属实；`convert` 可用；桌面 `icons/{dev,beta,prod}`、`copy-icons.ts`、`dock.png`/`app.dock.setIcon` 链路属实；分支命名与提交类型合规。
5. **前次审批（2026-10-07 step 517）闭环**：B1（mode-\* 波及 6 文件）→ D2 已闭环；B2（轴颈几何错误）→ `M8 7.5V8.5` 已闭环；B3（硬编码色）→ 部分闭环（token 化，但 fallback/静态资产仍违）；B4（品牌多来源）→ 部分闭环且**因基线漂移而重新打开**（splash-loader/favicon -v3/字标/桌面）；M1 呼吸脉冲→已登记 §7；M2 ⌘ 快捷键→已删除；M3 视觉验证缺口→部分（S1/S2 有 DOM 断言，但无截图基线/S3 无 RED）。

---

## 六、设计资产保真度（摘要）

| 项目              | 结论                                                                                 | 关键差距                                                                                                                                                                                     |
| :---------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4 Assistant 图标 | **NEAR-MATCH** 最终工件 `wider_v1_pedestal.svg`（结构 1 轴颈台座 · 首推，13:39:43Z） | 宽体 body 归一化后与计划完全一致（2/8.5/12/6）；头部压扁 0.86u、耳朵/轴颈由实心圆角矩形改为 1px 描边；"变体1 智库手账 Classic BC 宽体修正版"是计划自造复合名，工件无此标题；bc_v1 窄体不匹配 |
| §3.1 五图标       | **NEAR-MATCH**（手动 16px 重绘）                                                     | 源为 24×24 线性图标；chat 直角化、prompt 角度、custom 旋钮位移、描边未继承；工件无 16 viewBox 矢量                                                                                           |
| §3.2 激活光轨     | **新设计（非工件）**                                                                 | 工件是 3px/3.5px 模式色 + glow + tint + pulse；2px 单一强调色只在会话记录中，需按 P1-4 重标                                                                                                  |
| §3.3 Logo         | **MISMATCH / 来源错误（P0-3）**                                                      | 计划路径 = 旧梯度 logo.tsx/favicon.svg；方案 04 工件是 100 网格多边形 + 白点；fallback 色既非工件也非 token                                                                                  |
| 多尺寸形态        | 工件有明确的小尺寸简化（16/32/48 去掉 C 底座、G 简化）；计划对所有尺寸用同一组 path  | S3 需补尺寸分级规则                                                                                                                                                                          |

---

## 七、门禁与证据（本次审批已执行 / 未执行）

**已执行（只读）**：`git rev-parse HEAD origin/main`（审批时均 6b72b057b；迁移后均 43997011e）、`git status --short`、`git log/show`、`diff --no-index`（两版计划）、`grep` 精确计数（mode-\* 21/11、token、SplashLoader、favicon、icns 等）、逐文件读取（mode.tsx/mode.test.ts/mode-switcher.tsx/icon.tsx/logo.tsx/favicon.tsx/theme.css/global-shell.spec.ts 等）、`node -e` 读 package scripts、Playwright CLI 参数语义核对、`command -v convert` 与 ImageMagick 格式表、工件库 44 个内联 SVG + 30 个独立 SVG 的路径/颜色精确比对、对话 814 条记录的用户指令与审批状态取证。

**未执行（UNVERIFIED，按计划应在各切片内补证）**：typecheck / 单测 / e2e / 构建 / 资产生成 / 像素渲染对比 / 浅色主题实际对比度 / `/mode/assistant` mock fixture 兼容性 / 旧 commit `06872530f`（当前 clone 不存在，只能经 transcript 取证）。

---

## 八、批准范围与执行序列

1. **修订计划（P0-1/P0-2/P0-3 + P1 全部）**，更新 header 状态并链接本记录；计划文件提交为 `docs(plan)`（当前未跟踪）。
2. **S0**：G0 改为可复现（`git rev-parse`、`git status`、计划已提交）；记录 typecheck/lint 基线输出。
3. **S1**（用 `rail-*` 方案，按 P1-1/P1-2 补规格与渲染证据）：RED（e2e `<use href="#aigcfroge-v2-icon-rail-*">` + 内页回归断言）→ GREEN → 单包 typecheck → 提交 `feat(ui)` / `test(app)`。注意内页 `mode-*` 断言是回归断言，不是 RED。
4. **S2**（按 P1-3/P1-4）：统一 indicator 元素形态；wrapper/nav 承载 `data-*`；RED 只断言新增属性；提交 `feat(app)`。
5. **S3 重写后单独审批**：先解决 P0-2/P0-3/P1-5/P1-6/P1-7，再进入实施；不得与 S1/S2 混在同一评审批次。
6. **S4**：补 `bun --cwd packages/ui test`、coverage/debt 登记、截图证据；最终 `bun typecheck` + `LINT_BASE_REF=origin/main bun run script/lint-changed.ts` + `check-refs.sh`。

**复核触发条件**：几何/颜色/资产规格任何变更（尤其 §3.1、§3.3、Splash）、重新引入 per-mode 色或发光、或用户对方案 04/Assistant 微缩形态提出新意见时，必须重新走本审批。

---

**签名**：高级全栈开发顾问（DeepSeek Harness 会话内审批）
**日期**：2026-10-20（Asia/Shanghai）
**关联**：本记录为三路独立核验（对话 / 工件 / 仓库）的汇总结论；原始取证报告仅存于会话临时目录，未入仓。

---

## 修订回执（2026-10-20，审批后执行）

**① 计划已按本记录 P0/P1 修订入档**

- 文件：[`docs/plan/brand-mode-icons-2026-10-20.md`](../plan/brand-mode-icons-2026-10-20.md)，409 行，状态改为「修订版（2026-10-20）— S1/S2 有条件通过，S3 退回修订后单独审批」。
- P0-1：删除"设计评审共识记录"；事实来源改为"用户方向性指令 + 助手代理提案 + 工件库 + 2026-10-07 自审 + 本审批记录"；明确"此前从未获得用户批准"。
- P0-2：S3 已按当前基线重写，目标改为 `logo.tsx` 的 `Mark/Splash/Logo`，保留 `<Splash class="animate-pulse">`，删除 SplashLoader/facet slot/旧 keyframes。
- P0-3：§3.3 采用方案 04 工件几何（100 网格 A/G 多边形 + 顶点 + C 底座），删除旧梯度 path 与 hex fallback；新增 16/20/24、32/48、100/160 三档简化规则与 token/color-mix 映射。
- P1：§3.1 改为 24 网格工件的 16 网格适配并补 `stroke-width=1.5`；§3.2 固定 `<span data-slot="active-indicator">` 与 wrapper 标记；§0.1 修正 65%/185 数字并声明助理裁决；§6 R3 改为真实对比度验证；favicon 补 `-v3` 套件与 `site.webmanifest`；桌面资产按 160 文件盘点并延期 `.icns`/tiles；行号、§5 状态流、S4 UI 包测试与 G0 表述均已修正。

**② 高保真审批预览已产出并通过本机渲染验证**

- HTML（单文件、无外部资源、`file://` 可开）：[`docs/research/brand-mode-icons/brand-mode-icons-preview-2026-10-20.html`](../research/brand-mode-icons/brand-mode-icons-preview-2026-10-20.html)
- 截图证据：[`docs/research/brand-mode-icons/screenshots/`](../research/brand-mode-icons/screenshots/)（dawn/light 双主题、Mark 尺寸阶梯、rail 五图标、Assistant 标注、真实外壳、规格表）
- Playwright（Chromium，1440×1200，deviceScaleFactor 2）实测：0 console errors；5 个 section；5 个 rail 按钮；主题切换、模式切换、确认清单联动均生效。
- 实测几何：rail 64px、按钮 40×40px、图标 20px、激活条 2×20px 且颜色 = `#a2bcff`（`--v2-icon-icon-accent` 暗色），绝对定位、无布局位移。
- 交互实测：点击 Assistant 后 `aria-pressed` 互斥迁移、侧栏/主区标题与图标同步、检查清单计数更新。

**③ 待用户视觉确认（预览页第 06 节清单）**

1. C 底座候选 2（`color-mix(cyan 55%, text-contrast)`）是否采纳；
2. 小尺寸 Mark 简化规则（≤24 双面 / 32–48 带顶点 / ≥100 完整含 C）；
3. rail 图标统一 stroke 1.5 + 14px Assistant 微缩；
4. 确认收回 per-mode 3.5px/12% 柔光/呼吸脉冲，采用 2px 单一强调色。

---

## 复核与修复记录（2026-10-20，独立工件复核后）

独立复核（task-8）对照修订计划与工件后给出结论：Logo 几何 PASS、五图标 PASS（微缩 PARTIAL）、Assistant PASS、指示器 PASS（DOM 契约 PARTIAL）、来源 PASS、Token 亮色 PASS / **暗色 FAIL**、Mark 尺寸规则 PARTIAL。Lead 已按复核结果修复并复验：

| 复核发现                                                                                                                                                      | 修复                                                                                                                                                                                                                           | 复验                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| P1-1 预览暗色 token 抄了 theme.css 中**注释掉的 prefers-color-scheme** 副本，8 个值与生产不符（如 bg-base #242424→应为 #161616、avatar blue #3250df→#263fa9） | 预览 `[data-theme="dark"]` 全部改为 active `[data-color-scheme="dark"]` 值（bg-base #161616 / bg-deep #080808 / layer-01 #242424 / layer-02 #2e2e2e / text #fafafa / contrast #ffffff / avatar #263fa9·#005a6e）；Token 表同步 | Playwright 读取 computedStyle：9 个 token 全部匹配 active dark；0 console errors |
| P1-2 计划 §3.3 的 32–48 标准规则与 §0.5 的 40–56 完整规则冲突；预览缺 40/56 行                                                                                | 计划改为：应用内 Mark（40/56px）固定完整形态；16–48px 简化仅用于静态资产母版（16/20/24 紧凑、32/48 标准、100/160 完整）；预览新增 56/40 应用内 Mark 与 64×80 / 48×60 Splash 实渲行，并修正"160px 用于 splash"的误述            | 预览新增行渲染正常；计划 §3.3 与 §0.5 一致                                       |
| P2 微缩符号与计划不一致（r1.4/0.5/10.6H8 vs 1.5/0.55/10.8H7.6）                                                                                               | 预览对齐计划值                                                                                                                                                                                                                 | DOM 断言通过                                                                     |
| P2 外壳未体现 §3.2 data-\* 契约                                                                                                                               | nav 增加 `data-component="mode-switcher"`，按钮增加 `data-slot="rail-item"`/`data-mode`/`data-state`；JS 同步切换；caption 注明真实 IconButtonV2 需 wrapper 承载                                                               | 切换后 `data-state` 互斥迁移，指示器 opacity=1                                   |
| P2 "用户只确认了"表述过强                                                                                                                                     | 改为"用户指定了方向（step 433/446/456）"                                                                                                                                                                                       | —                                                                                |
| P2 缺 Splash 预览                                                                                                                                             | 品牌章节新增 Splash 实渲尺寸（64×80 / 48×60）                                                                                                                                                                                  | 已渲染                                                                           |

**⑥ 2026-10-20 视觉反馈修订（rail-chat）**

用户反馈：旧版 rail-chat 使用 `>_` 提示符，"完全看不到是 chat 的功能，感觉是终端"。已改为**对话气泡 + 三点省略号**（新设计，非工件原样），并在预览中实测三版候选：

| 候选               | 结果                                                              |
| :----------------- | :---------------------------------------------------------------- |
| 旧版 bubble + `>_` | 废弃（终端语义）                                                  |
| **A 气泡 + 三点**  | **采用**：20/16/14px 均可辨识，与 coding/work/custom 轮廓差异明确 |
| B 双气泡 + 三点    | 不采用：20px 下两气泡重叠发糊，14px 不可辨                        |
| C 气泡 + 消息线    | 不采用：更像"批注/备注"，对话语义弱于三点                         |

- 计划 §3.1 已同步新几何，并注明"rail-chat 为用户反馈后的新设计，其余四枚仍为工件 16px 适配"。
- 预览 `#rail-chat`、§03 说明、真实外壳导轨均已更新；截图 `10-chat-icon-options.png`。
- Playwright 复验 0 console errors；20px 实渲、14px 仍可辨。

**⑦ 2026-10-20 亮色顶点修正（Mark 方案 04）**

用户反馈："亮色模式下顶部的圆点看不到"。复现确认：顶点绑定 `--v2-text-text-contrast`，该 token 在明暗两主题都近白（#ffffff / #fafafa），白点落在浅色卡片上不可见。

- 修正：顶点改用**自适应前景** `--v2-text-text-base`（浅色 #161616 / 深色 #fafafa），不引入新 token、不改几何。
- 计划同步：§0.5 颜色映射、§3.3 几何/颜色映射、§6 R3 风险描述；预览 `#mk-full`/`#mk-standard` 顶点、图例、Token 表同步。
- 复验：Playwright 读取 computedStyle：dark `--v2-text-text-base=#fafafa`、light `#161616`；亮/暗品牌章节截图确认顶点可见（`02-brand-dark.png` / `03-brand-light.png`）；0 console errors。
- 静态资产注意（S3）：favicon.svg 可用内嵌 `prefers-color-scheme` 媒体查询切换顶点色；栅格资产需固定色值（建议透明底 + 深色点，或在生成脚本中输出亮/暗两套，列入 S3 资审）。

**⑧ 视觉确认回执（2026-10-20，用户勾选 4/4）**

用户提交审批预览截图：确认清单 **4 / 4 已确认**，并选择 **C 底座候选 2（55% 混白）**。

| 确认项      | 结论                                                                                                                                                                                     |
| :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C 底座      | **候选 2**：`color-mix(in srgb, var(--v2-avatar-bg-cyan) 55%, var(--v2-text-text-contrast))`；浅色约 #73c5d8、深色约 #73a4af（sRGB 55% 混合，随主题 token 变化），均比实色低一个视觉层级 |
| 小尺寸 Mark | 16/20/24 紧凑（A+G）、32/48 标准（A+G+顶点）、100/160 完整（含 C）；仅用于资产母版                                                                                                       |
| rail 图标   | 统一 stroke 1.5；14px Assistant 切换微缩变体                                                                                                                                             |
| 激活态      | 收回 per-mode 3.5px / 12% 柔光 / 呼吸脉冲，采用 2px 单一强调色                                                                                                                           |

同日已确认：rail-chat 采用「气泡 + 三点」；Mark 顶点改用自适应前景。

- 计划头部状态更新为「视觉确认完成（2026-10-20）— S1/S2 可开工；S3 退回修订后单独审批」。
- 预览页已标记确认状态（4/4、候选 2 已采纳）；截图 `11-c-base-confirmed.png`、`12-checklist-confirmed.png`。
- **S1/S2 的开工条件现已全部满足**；剩余步骤：提交 `docs(plan)`（计划 + 本记录 + 预览 + 截图）→ S1 RED。

---

**⑨ 基线迁移回执（2026-10-20 10:30，新 main 落盘后）**

- 用户确认新基线：`main = origin/main = 43997011e`（0 领先 / 0 落后），要求重建分支。
- 迁移前核验：`43997011e` 相对 `6b72b057b` 仅 **docs/ + CLAUDE.md** 变更（27 文件、6970 insertions、1 deletion），计划涉及代码路径 diff 为空（mode.tsx / mode.test.ts / mode-switcher.tsx / icon.tsx / logo.tsx / favicon / theme.css / global-shell.spec.ts / desktop icons / package scripts 零漂移）；旧分支 `brand-mode-icons` 无独有提交。
- 分支重建：删除旧 `brand-mode-icons`（原指向 `6b72b057b`），从 `43997011e` 重建并切换；计划、审批记录、预览与截图随工作树迁移（未跟踪状态保留，随后提交）。
- 文档回写：计划「实施基线」与 §0.2/§0.3/§1.1 的 commit 引用更新为 `43997011e`；旧 plan `2026-10-07` 现已在 main 入仓，对照路径更新；预览中的基线标签同步。
- 结论：**基线迁移不改变任何已审批事实与视觉方案**；S1/S2 开工条件继续成立。
  **当前预览状态**：单文件 `docs/research/brand-mode-icons/brand-mode-icons-preview-2026-10-20.html`；Playwright 实测 0 console errors；暗/亮主题 token 与采集值一致；rail 64px / 按钮 40px / 图标 20px / 激活条 2×20px；主题切换、模式切换、确认清单联动均正常。截图更新于 `docs/research/brand-mode-icons/screenshots/`。

**仍未验证**：像素级对比度实测、真实组件（IconButtonV2/Solid）接入后的 DOM 行为、favicon/桌面资产实际生成——分别留待 S1/S2/S3 的 RED/GREEN 与视觉验收。

**④ 下一步**

- 用户确认上述 4 项后 → 提交 `docs(plan)`（计划 + 本记录 + 预览 + 截图）→ 按 S1 RED 开工。
- S3 仍须在 Web 资产与桌面资产视觉确认后单独审批；本回执不改变 S3 的"退回"状态。
- 本预览为视觉审批文件，**不进入产品代码**；S1/S2/S3 的真实 RED/GREEN 与对比度实测尚未执行（UNVERIFIED）。

## ⑩ 实施阶段描边复核回执（2026-10-20）

用户反馈真实导轨图标偏粗，要求先预览 1.0 与 1.25。实施会话提供真实组件几何的亮/暗 × 14/16/20px × 1.0/1.25/1.5 并排比较后，用户明确选择「采用 1.0」。

本回执覆盖先前 ⑧ 的「stroke 1.5」一项：五个 `rail-*` 与 `rail-assistant-micro` 统一显式 `stroke-width="1"`；20px 下描边为 1.25 CSS px。所有几何坐标、实心细节、微缩选择规则、S2 指示条规格和 S3 冻结状态保持原批准内容。

证据：[描边对比](brand-mode-icons-s1-s2-2026-10-20/screenshots/stroke-comparison.png)；[实施报告](brand-mode-icons-s1-s2-2026-10-20/README.md)。首次审批 HTML/截图保持历史原样，当前描边以本回执及实施计划修订节为准。
