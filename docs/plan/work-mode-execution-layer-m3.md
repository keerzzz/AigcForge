# Work 模式 M3 实施计划：Mermaid 内嵌图表（L1）

> 状态：**Approved**（L1，2026-08-07）
> 日期：2026-08-07
> Owner：Core + App + Session-UI
> 范围：`packages/session-ui`（Mermaid 渲染）+ `packages/core`（SYSTEM_PROMPT）+ `packages/app`（preset guidance + i18n）
> 关联：[M3 调研报告](work-mode-m3-research.md)（L1/L2 分层决策）、[Work 路线图](work-mode-roadmap.md) §3.5（M3 L1）、[Work M1 计划](work-mode-execution-layer-m1.md)（候选稿载体 D1）、[Work M1.5 计划](work-mode-execution-layer-m1.5.md)（SYSTEM_PROMPT 步骤化）、[Work M2 计划](work-mode-execution-layer-m2.md)（存为资产）、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)（TDD 范式）
> 分支：**work-m3**（从最新 main 切出）
> 最后更新：2026-08-07

---

## 0. 审批状态与执行 Gate

| Gate | 条件 | 状态 | 阻塞范围 |
|---|---|---|---|
| **G0 范围真源** | [M3 调研报告](work-mode-m3-research.md) Approved（L1 收窄，L2 延后 M3.5） | ✅ 已满足 | 全部 Phase |
| **G1 依赖就绪** | M1-M2 已合入 main（候选稿=消息正文 M1 D1 + work-orchestrator SYSTEM_PROMPT M1.5 步骤化） | ✅ 已满足 | 全部 Phase |
| **G2 Mermaid 接入方式** | work-orchestrator SYSTEM_PROMPT 通用教 Mermaid + guidance 示例聚焦 PRD/文献综述 | ✅ 已确认 | Phase B |
| **G3 preset 范围** | PRD/文献综述加 Mermaid 示例；视频分镜/行政公文不加 | ✅ 已确认 | Phase B |
| **G4 安全** | Mermaid 渲染为 SVG，DOMPurify config 已保留 svg/path（[markdown-cache.tsx:18](packages/session-ui/src/components/markdown-cache.tsx)），无 CSP 问题 | ✅ 已确认 | 无需 Security 评审 |

**与 M3.5（L2）的边界**：M3 只做 Mermaid 内嵌（SVG，安全）。**不做** iframe sandbox / 独立 HTML 图表 / Chart.js/Vis.js / CSP 评审 -- 那是 M3.5 远期范围。

---

## 1. 目标、非目标与本次收敛

### 1.1 M3（L1）目标

Work 候选稿（Markdown 消息正文）支持 **Mermaid 图表内嵌**：LLM 在候选稿中写 `\`\`\`mermaid` 代码块，右栏 Artifact Tab 只读预览渲染为 SVG 图表。覆盖流程/拓扑/时序/甘特/数据/思维导图等 15+ 类型。

### 1.2 非目标

- ❌ 不做独立 HTML 图表产出（M3.5 L2，需 iframe sandbox + CSP 评审）
- ❌ 不引 Chart.js / Vis.js / ECharts（那些是 L2 范畴）
- ❌ 不改 M1 候选稿载体（候选稿=assistant 消息正文，不变）
- ❌ 不改 M1 落盘模型（原子写入 + 路径校验，不变）
- ❌ 不改 M2 存为资产链路（prompt 资产 template=候选稿，Mermaid 代码块作为 template 一部分自然携带）
- ❌ 不新增 CSP 评审 / Security owner（Mermaid SVG 安全）
- ❌ 不新建数据库 migration（无新表）
- ❌ 不给所有 preset 强加 Mermaid（视频分镜/行政公文不加）

### 1.3 相对 PRD/路线图的收敛

| 原 PRD/路线图 | M3（L1）收敛 |
|---|---|
| M3 = DataAnalysis / 图表 HTML 产出（路线图 §3.5 原） | **收窄为 Mermaid 内嵌**（L1）；HTML 图表延后 M3.5 |
| PRD §5 数据分析师交付"Markdown Data Insights" | Mermaid 在 Data Insights 内嵌数据图表（pie/xychart），仍是 Markdown |
| 全栈可视化文档的 4 模块（独立 HTML） | 归 M3.5（L2），M3 不做 |

---

## 2. 背景与当前状态

### 2.1 已就绪基座（复用）

| 能力 | 位置 | 状态 |
|---|---|---|
| Markdown 渲染（marked + DOMPurify） | [markdown.tsx](packages/session-ui/src/components/markdown.tsx) :352 | ✅ marked.parse + sanitizeMarkdown |
| DOMPurify config（保留 SVG） | [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) :13-20 | ✅ `ADD_TAGS: ["svg","path"]` + `ADD_ATTR: ["viewBox","d",...]` -- **SVG 已支持，无需改** |
| WorkArtifactContent 候选预览 | [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx) :68 | ✅ M1 已实现（Markdown 渲染候选稿） |
| work-orchestrator SYSTEM_PROMPT | [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | ✅ M1.5 已步骤化（Plan/Execute/Produce/Resume），M3 加 Mermaid 指引 |
| Preset Registry（4 预设） | [work-preset.ts](packages/core/src/session/work-preset.ts) | ✅ M1 已实现（guidance 字段，M3 加 Mermaid 示例） |
| Work 候选稿提取 | [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts) | ✅ findLatestAssistantMarkdown（不变） |

### 2.2 需新建/修改

| 交付物 | 位置 | 动作 |
|---|---|---|
| Mermaid 库依赖 | [session-ui/package.json](packages/session-ui/package.json) | 新增：`mermaid` 依赖 |
| Mermaid 渲染集成 | [markdown.tsx](packages/session-ui/src/components/markdown.tsx) | 修改：marked code renderer 自定义（language=mermaid -> mermaid.render -> SVG）或后处理替换 |
| work-orchestrator SYSTEM_PROMPT Mermaid 指引 | [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改：步骤5 Produce 加"适合时用 Mermaid 图表" |
| PRD preset guidance Mermaid 示例 | [work-preset.ts](packages/core/src/session/work-preset.ts) | 修改：PRD 预设 guidance 加 Mermaid 流程图/拓扑示例 |
| 文献综述 preset guidance Mermaid 示例 | [work-preset.ts](packages/core/src/session/work-preset.ts) | 修改：文献综述 guidance 加对比矩阵/思维导图示例 |
| i18n（可选） | [en.ts](packages/app/src/i18n/en.ts) + zh.ts + zht.ts | 修改（若需图表加载/错误提示文案） |

---

## 3. 范围与设计决策

### 3.1 D1：Mermaid 渲染集成方式

**现状**：[markdown.tsx:352](packages/session-ui/src/components/markdown.tsx) 用 `marked.parse(block.src)` 解析 markdown，`sanitizeMarkdown` 清理。Mermaid 代码块被 marked 输出为 `<pre><code class="language-mermaid">`，DOMPurify 保留但不渲染图表。

**M3 决策**：两种集成方式（Phase A 实施时择优）：

| 方式 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）** | marked 自定义 renderer：`code` 代码块，language=mermaid 时调 `mermaid.render(id, src)` 返回 SVG | 渲染时机早（parse 阶段） | marked renderer 需异步处理（mermaid.render 是 async） |
| B | 后处理：DOM 渲染后找 `.language-mermaid` 代码块，异步替换为 SVG | 不改 marked | 需额外 DOM 扫描 + 时序处理 |

**推荐 A**：marked renderer 自定义，Mermaid 在 parse 阶段渲染为 SVG，后续 sanitizeMarkdown 保留 SVG（config 已支持）。

**Mermaid 库引入**：
- `bun add mermaid` in packages/session-ui
- 动态 import（`await import("mermaid")`）避免初始包过大（mermaid ~500KB 含 d3）
- mermaid.initialize 一次（theme 配置对齐 v2 token）

### 3.2 D2：DOMPurify 安全（已就绪，无需改）

[markdown-cache.tsx:13-20](packages/session-ui/src/components/markdown-cache.tsx) config：
```ts
ADD_TAGS: ["svg", "path"]
ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"]
```
- **SVG 元素已允许**（svg/path）
- **SVG 属性已允许**（viewBox/d/preserveAspectRatio/xmlns）
- Mermaid 渲染为 SVG 后，DOMPurify 保留

**结论**：L1 安全门槛确认低，**无需改 DOMPurify config**，无需 CSP 评审。

**注意**：Mermaid SVG 可能含更多元素/属性（如 `<g>`, `<text>`, `<rect>`, `<circle>`, `fill`, `stroke`）。Phase A 需验证 DOMPurify 是否保留这些，若被清则扩展 ADD_TAGS/ADD_ATTR。实施时 grep Mermaid SVG 输出结构确认。

### 3.3 D3：preloadMarkdown 跳过 code 块

[markdown-cache.tsx:62](packages/session-ui/src/components/markdown-cache.tsx) `if (block.mode === "code") return` -- code 代码块跳过缓存预加载。

**影响**：Mermaid 代码块不走 preloadMarkdown 缓存，需在渲染时（markdown.tsx parse 阶段）处理。

**决策**：不改 preloadMarkdown（保持 code 跳过，因为 Mermaid 渲染慢且含动态 import）。Mermaid 在 marked renderer 里渲染，结果 SVG 经 sanitizeMarkdown 后入 markdown.tsx 的渲染流。

### 3.4 D4：work-orchestrator SYSTEM_PROMPT Mermaid 指引

在 [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) 步骤5 "Produce the candidate" 加 Mermaid 指引：

```
5. **Produce the candidate**: Write the full Markdown document as your assistant message body following the preset guidance. Do not write it to a file and do not call edit/write tools.

   **Use Mermaid diagrams when text alone is unclear** (flowchart for processes, sequenceDiagram for API interactions, gantt for timelines, mindmap for structure, pie/xychart for data, erDiagram for DB schema, etc.). Wrap diagrams in ```mermaid fenced code blocks. Only use a diagram when it genuinely clarifies; do not force diagrams into every document.
```

**通用指引**（不绑特定 preset）：教 LLM"文字表达不清时用 Mermaid"，不强制每个文档都加图表。

### 3.5 D5：preset guidance Mermaid 示例

| preset | Mermaid 示例 | 理由 |
|---|---|---|
| PRD | 流程图（业务流程）+ 拓扑（依赖）+ 甘特（排期） | PRD 天然需要流程/拓扑/排期图 |
| 文献综述 | 对比矩阵（原生表格）+ 思维导图（文献结构） | 综述需要对比 + 结构 |
| 视频分镜 | **不加** | 双栏分镜表已够（M1 D1） |
| 行政公文 | **不加** | 公文是规范文字，图表无必要 |

**guidance 示例格式**：在 preset 的 guidance 字段加一段"建议图表"示例，如：
```
当涉及业务流程时，用 ```mermaid flowchart 绘制；当涉及需求依赖时，用 graph 绘制拓扑。
```

---

## 4. 关键设计

### 4.1 Mermaid 渲染流程

```
work-orchestrator 生成候选稿（含 ```mermaid 代码块）
  -> findLatestAssistantMarkdown 提取候选稿（M1，不变）
  -> WorkArtifactContent 渲染（M1，不变）
  -> marked.parse(block.src)
       -> code renderer: language=mermaid?
            -> 是: await mermaid.render(id, src) -> SVG
            -> 否: 默认 <pre><code> 输出
  -> sanitizeMarkdown(html)  // DOMPurify 保留 SVG（config 已支持）
  -> 右栏 Artifact Tab 显示含 SVG 图表的 Markdown
```

### 4.2 Mermaid 库初始化

```ts
// markdown.tsx 或 mermaid-renderer.ts（新建）
let mermaidReady: Promise<typeof import("mermaid")> | undefined
async function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",  // 对齐 v2 token（实施时确认主题）
        securityLevel: "strict",  // 禁止 mermaid 内 HTML/script
      })
      return m.default
    })
  }
  return mermaidReady
}
```

**securityLevel: "strict"**：Mermaid 自身安全级别，禁止图表内含 HTML/script（额外防护，即使 DOMPurify 漏过）。

### 4.3 SYSTEM_PROMPT 改造（work-orchestrator.ts）

在步骤5 Produce the candidate 后加 Mermaid 指引段落（见 §3.4 D4）。不改其他步骤（Plan/Execute/Resume 保持 M1.5）。

### 4.4 preset guidance 改造（work-preset.ts）

PRD 预设 guidance 末尾加：
```
## 建议图表
- 业务流程：\`\`\`mermaid flowchart TD
- 需求依赖：\`\`\`mermaid graph
- 路线排期：\`\`\`mermaid gantt
仅在文字表达不清时使用，不强制。
```

文献综述预设 guidance 末尾加：
```
## 建议图表
- 文献对比：原生 Markdown 表格
- 文献结构：\`\`\`mermaid mindmap
仅在文字表达不清时使用，不强制。
```

视频分镜/行政公文 guidance **不改**。

---

## 5. 阶段划分（TDD：红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。对齐 [M1 TDD 手册](work-mode-m1-tdd-prompt.md) §5 范式。

### Phase A - Mermaid 渲染集成（估时 1d）

| 步骤 | 内容 |
|---|---|
| **红** | 新建 `packages/session-ui/src/components/mermaid-renderer.test.ts`：`\`\`\`mermaid` 代码块（flowchart/sequence/gantt/pie）-> 渲染为 SVG（含 `<svg>` 元素）；非 mermaid 代码块 -> 默认 `<pre><code>`；Mermaid 语法错误 -> 降级显示原代码块（不崩） |
| **绿** | `bun add mermaid` in session-ui；新建 `mermaid-renderer.ts`（getMermaid 动态 import + initialize strict + render）；markdown.tsx 的 marked code renderer 接入（language=mermaid -> mermaid.render -> SVG） |
| **重构** | 确认 DOMPurify 保留 Mermaid SVG 全部元素/属性（g/text/rect/circle/fill/stroke）；若被清则扩展 ADD_TAGS/ADD_ATTR；mermaid.initialize 一次（cached） |
| **退出** | `bun --cwd packages/session-ui test` 绿；`bun --cwd packages/session-ui typecheck` 绿；Mermaid 代码块渲染为 SVG |

### Phase B - SYSTEM_PROMPT + preset guidance（估时 1d）

| 步骤 | 内容 |
|---|---|
| **红** | 扩展 `packages/core/test/work-orchestrator.test.ts`：SYSTEM_PROMPT 含 "Mermaid" + "```mermaid" + "when text alone is unclear"。扩展 `packages/core/test/work-preset.test.ts`：PRD guidance 含 Mermaid 示例；文献综述 guidance 含对比/思维导图；视频分镜/行政公文 guidance 不含 Mermaid |
| **绿** | work-orchestrator.ts 步骤5 加 Mermaid 指引（§3.4 D4）；work-preset.ts PRD/文献综述 guidance 加 Mermaid 示例（§3.5 D5）；视频分镜/行政公文不改 |
| **重构** | SYSTEM_PROMPT Mermaid 指引通用（不绑 preset）；guidance 示例精准（PRD 流程/拓扑/甘特，文献对比/思维导图） |
| **退出** | core test 绿；prompt 结构 + guidance 内容测试通过 |

### Phase C - 端到端 + 打磨（估时 1d）

| 步骤 | 内容 |
|---|---|
| **红** | 新建/扩展 `packages/app/e2e/` spec：Work 选 PRD 预设 -> 生成候选稿含 Mermaid 代码块 -> 右栏 Artifact Tab 渲染 SVG 图表（`<svg>` 可见）；文献综述同理；视频分镜不含 Mermaid |
| **绿** | 端到端联调；修 Mermaid 渲染时序（async）、动态 import、主题对齐 |
| **重构** | Mermaid 动态 import 不阻塞首屏；主题对齐 v2 token（`--v2-*`）；i18n 补图表加载/错误提示（若需） |
| **退出** | 端到端通过；typecheck（tsgo -b app + tsgo --noEmit core/session-ui）+ lint + test 全绿；改完即审 7 步 |

---

## 6. 关键文件

| 文件 | 动作 | 说明 |
|---|---|---|
| [session-ui/package.json](packages/session-ui/package.json) | 修改 | 新增 `mermaid` 依赖 |
| `packages/session-ui/src/components/mermaid-renderer.ts` | 新增 | getMermaid 动态 import + initialize strict + render |
| `packages/session-ui/src/components/mermaid-renderer.test.ts` | 新增 | Mermaid 渲染单测（TDD 红测试） |
| [markdown.tsx](packages/session-ui/src/components/markdown.tsx) | 修改 | marked code renderer 接入 mermaid-renderer（language=mermaid -> SVG） |
| [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) | 验证（可能改） | 确认 DOMPurify 保留 Mermaid SVG 全部元素/属性；若不足扩展 ADD_TAGS/ADD_ATTR |
| [work-orchestrator.ts](packages/core/src/agent/prompt/work-orchestrator.ts) | 修改 | 步骤5 Produce 加 Mermaid 指引 |
| [work-preset.ts](packages/core/src/session/work-preset.ts) | 修改 | PRD/文献综述 guidance 加 Mermaid 示例 |
| [en.ts](packages/app/src/i18n/en.ts) + zh.ts + zht.ts | 修改（可选） | 图表加载/错误提示文案（若需） |

**不改的文件**：
- [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)（M1 候选预览，不变）
- [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts)（候选提取，不变）
- [artifact.ts](packages/core/src/session/artifact.ts)（WorkArtifact Service，不变）
- [ui.ts](packages/aigcfroge/src/server/shared/ui.ts)（CSP，Mermaid SVG 不触发 CSP）

---

## 7. 测试策略

### 7.1 新建测试

| 测试文件 | 覆盖 |
|---|---|
| `packages/session-ui/src/components/mermaid-renderer.test.ts` | Mermaid 代码块 -> SVG（flowchart/sequence/gantt/pie）；非 mermaid -> 默认；语法错误 -> 降级 |
| `packages/app/e2e/` spec | Work 选 PRD 预设 -> 候选含 Mermaid -> 右栏渲染 SVG |

### 7.2 扩展现有测试

| 现有测试 | 扩展 |
|---|---|
| [work-orchestrator.test.ts](packages/core/test/work-orchestrator.test.ts) | SYSTEM_PROMPT 含 Mermaid 指引 |
| [work-preset.test.ts](packages/core/test/work-preset.test.ts) | PRD/文献综述 guidance 含 Mermaid 示例；视频分镜/行政公文不含 |

### 7.3 命令（CLAUDE.md 测试规范，永不从根跑）

```bash
bun --cwd packages/session-ui test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/session-ui typecheck
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck       # tsgo -b
bun run lint
```

### 7.4 硬性规则

- Mermaid.render 是 async，测试用 `it.live`（真实 async + DOM）
- 禁止 `as any`、`@ts-ignore`
- 测试实际渲染输出（SVG 元素存在），不 mock mermaid

---

## 8. 验收清单

- [ ] `bun add mermaid` 装入 session-ui
- [ ] Mermaid 代码块（```mermaid）渲染为 SVG（flowchart/sequence/gantt/pie 至少 4 种）
- [ ] 非 mermaid 代码块仍渲染为默认 `<pre><code>`
- [ ] Mermaid 语法错误时降级显示原代码块（不崩）
- [ ] DOMPurify 保留 Mermaid SVG 全部元素/属性（g/text/rect/circle/fill/stroke）
- [ ] Mermaid 动态 import 不阻塞首屏
- [ ] mermaid.initialize securityLevel="strict"（额外防护）
- [ ] work-orchestrator SYSTEM_PROMPT 含 Mermaid 通用指引
- [ ] PRD preset guidance 含 Mermaid 示例（流程/拓扑/甘特）
- [ ] 文献综述 preset guidance 含 Mermaid 示例（对比/思维导图）
- [ ] 视频分镜/行政公文 guidance 不含 Mermaid
- [ ] Work 选 PRD 预设 -> 候选含 Mermaid -> 右栏渲染 SVG（E2E）
- [ ] M1 候选稿载体/落盘/M2 存为资产链路无回归
- [ ] typecheck + lint + test 全绿

---

## 9. 估算

| Phase | 估时 |
|---|---|
| A Mermaid 渲染集成 | 1d |
| B SYSTEM_PROMPT + guidance | 1d |
| C 端到端 + 打磨 | 1d |
| **总计** | **3d** |

（M1.5 7.5d / M2 6.5d；M3 L1 复用 M1-M2 链路 + Mermaid 标准库，范围最小）

---

## 10. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| DOMPurify 清掉 Mermaid SVG 的某些元素/属性（g/text/fill） | 中 | 中 | Phase A 验证 Mermaid SVG 结构；扩展 ADD_TAGS/ADD_ATTR |
| Mermaid.render async 与 marked sync renderer 冲突 | 中 | 中 | 用 async renderer（marked 支持）或后处理替换（D1 方案 B fallback） |
| Mermaid 库 ~500KB 增大包体 | 中 | 低 | 动态 import（不进首屏包） |
| LLM 过度使用 Mermaid（每文档都加图表） | 中 | 低 | SYSTEM_PROMPT 强约束"仅在文字表达不清时用"；guidance 示例精准 |
| Mermaid 主题与 v2 token 不一致 | 低 | 低 | mermaid.initialize theme 配置对齐 v2（Phase C 确认） |
| 视频分镜/行政公文 LLM 误加 Mermaid | 低 | 低 | guidance 不提 Mermaid；SYSTEM_PROMPT"按 preset guidance"约束 |

---

## 11. 技术债声明

| 负债 | 风险 | 到期 |
|---|---|---|
| L2 独立 HTML 图表延后 M3.5 | 汇报场景（团队全景/数据大屏）暂不支持 | 待产品确认 + CSP 评审后立项 M3.5 |
| Mermaid 主题用 base（非 v2 token 精确对齐） | 图表配色与 v2 token 可能略有差异 | Phase C 调优或后续主题迭代 |
| Mermaid 渲染不走 preloadMarkdown 缓存 | 首次渲染稍慢（动态 import + parse） | 可接受（后续可加 Mermaid 结果缓存） |

---

## 12. 关联文档

- [M3 调研报告](work-mode-m3-research.md) - L1/L2 分层决策（范围真源）
- [Work 路线图](work-mode-roadmap.md) - §3.5 M3（L1）+ §3.6 M3.5（L2 远期）
- [Work M1 计划](work-mode-execution-layer-m1.md) - 候选稿载体 D1
- [Work M1.5 计划](work-mode-execution-layer-m1.5.md) - SYSTEM_PROMPT 步骤化
- [Work M2 计划](work-mode-execution-layer-m2.md) - 存为资产链路
- [M1 TDD 手册](work-mode-m1-tdd-prompt.md) - TDD 红绿重构范式
- [markdown-cache.tsx](packages/session-ui/src/components/markdown-cache.tsx) - DOMPurify config（SVG 已支持）
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) - 架构边界
