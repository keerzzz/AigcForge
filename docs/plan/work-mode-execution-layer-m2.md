# Work 模式 M2 实施计划：资产沉淀联动

> 状态：**Approved**（2026-08-07 审批通过，4 项修改已落地：G4 Flag 推翻为不门控、CandidateInfo 补 content/status、mode 接口名修正、§2.1 字段说明）
> 日期：2026-08-07
> Owner：Core + App
> 范围：`packages/app`（主，0 新建 Service/HTTP/审查 UI）
> 关联：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §10.2/§6.2（范围真源）、[Work 路线图](work-mode-roadmap.md) §3.4（本计划上级）、[Work M1 计划](work-mode-execution-layer-m1.md)（已合入，本计划前置）、[Work M1.5 计划](work-mode-execution-layer-m1.5.md)（并行，互不依赖）、[Chat 资产 PRD](../prd/chat-mode-creation-layer.md)（资产接口真源）、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)（TDD 范式参考）
> 分支：**work-m2**（从最新 main 切出；与 work-m1.5 分支并行，互不依赖。连字符分隔、无斜杠无类型前缀，符合 AGENTS.md Branch 规范）
> 最后更新：2026-08-07

---

## 0. 审批状态与执行 Gate

| Gate                | 条件                                                                                                                                                                                                                                                                                                                                                                                           | 状态                        | 阻塞范围   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------- |
| **G0 范围真源**     | Work PRD v4.1 Approved；§10.2"产出消息下方存为资产按钮"+ §6.2"存为资产通道"已定义                                                                                                                                                                                                                                                                                                              | ✅ 已满足                   | 全部 Phase |
| **G1 依赖就绪**     | Work M1 已合入 main（`a041ca617`）：WorkArtifact Service + work.artifact_applied 事件 + 候选稿提取（findLatestAssistantMarkdown）；Chat 资产 M1-M7 已合入：7 类资产 Schema + PromptAssetService（propose/apply/delete）+ HTTP API + propose candidate store + Chat 右栏审查 UI + applyAssetCandidate                                                                                           | ✅ 已满足                   | 全部 Phase |
| **G2 资产类型**     | Work 候选稿映射为 **prompt 资产**（template 字段 = 候选稿正文），M1 计划 §3.5 D4 已定"prompt 资产仅 template"                                                                                                                                                                                                                                                                                  | ✅ 已确认                   | Phase A-D  |
| **G3 propose 策略** | Work 不调 LLM 工具，直接构造 CandidateInfo + setProposeCandidate 复用 Chat 审查链路。代码验证：apply 从 `candidate.name` 经 `nameToRelativePath` 计算路径（[prompt-asset-service.ts:207](packages/core/src/prompt-asset-service.ts)），空 relativePath 安全；Chat 右栏 `exists=false` 时不读 relativePath（[chat-right-panel.tsx:165](packages/app/src/components/chat/chat-right-panel.tsx)） | ✅ 已确认（审批验证）       | Phase A-B  |
| **G4 门控策略**     | **不门控**。Flag `AIGCFROGE_EXPERIMENTAL_CHAT_ASSET` 只门控 Core 端 LLM propose 工具（[propose-prompt-asset.ts:26](packages/core/src/tool/propose-prompt-asset.ts)），Work 存为资产不经 LLM 工具，与 Chat 资产 App UI（AssetWorkbench/chat-right-panel/applyAssetCandidate）同层不门控                                                                                                         | ✅ 已确认（审批推翻原决策） | Phase B    |

**与 M1/M1.5 的关系**：M2 不依赖 M1.5（ProgressLedger/Resume），只依赖 M1（候选稿产出）。M2 继承 M1 的候选稿载体（D1：候选稿=assistant 消息正文），存为资产时从消息正文读取。

---

## 1. 目标、非目标与本次收敛

### 1.1 M2 目标

Work 会话生成候选稿后，用户点击**"存为资产"按钮**（右栏 Artifact Tab，与"应用到当前项目"并列），Work 将候选稿映射为 prompt 资产 CandidateInfo（`kind=prompt`，`template=候选稿正文`，`name=标题`，`description=摘要`，`content=template`，`status="valid"`），通过 `setProposeCandidate` 注入 Chat 已有的 propose candidate store，切换到 Chat 模式后右栏自动显示候选审查 UI，用户确认后 `applyAssetCandidate` 经 SDK 落盘，新会话可复用该资产。

### 1.2 非目标

- ❌ 不新建资产类型（复用 prompt 资产，template 字段）
- ❌ 不新建 propose 工具（复用 Chat 已有 propose_prompt_asset LLM 工具 + PromptAssetService）
- ❌ 不新建审查 UI（复用 Chat 右栏 chat-right-panel.tsx 的候选审查）
- ❌ 不新建 apply 链路（复用 applyAssetCandidate + SDK client.promptAsset.apply）
- ❌ 不做 Work 模式内的资产编辑器（修改走 Chat 资产工作室）
- ❌ 不做跨 Location 资产同步（资产落当前 Location，对齐 ADR-14）
- ❌ 不改 M1 的候选稿载体 / 落盘模型（D1/D2 不变）
- ❌ 不依赖 M1.5（ProgressLedger/Resume 是独立轨道）
- ❌ 不新增数据库 migration（资产走 Chat 已有表）

### 1.3 相对 PRD 的收敛

| PRD 描述                                                             | M2 实施收敛                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产出消息下方"存为资产"按钮（§10.2）                                  | 按钮放**右栏 Artifact Tab**（与"应用到当前项目"并列），不放消息流下方--右栏是 Work 产出的唯一聚集地（M1 已定），消息下方按钮会与 Artifact Tab 重复。PRD"消息下方"指产出消息的操作区，右栏 Artifact Tab 即该操作的载体 |
| 路由协议：Work 产出 -> Chat 资产注册（预填 propose\_\*\_asset 入参） | **不经 LLM propose 工具**（那是 Chat orchestrator 的链路）。Work UI 直接构造 CandidateInfo + setProposeCandidate，复用 Chat 右栏审查 UI（见 §3.3 D3）                                                                 |
| 预填数据模型：产出 digest -> 资产字段映射                            | 纯函数 `captureWorkArtifactAsCandidate(content)`：候选稿正文 -> template + content，首行标题 -> name，首段摘要 -> description，status="valid"                                                                         |
| 存为资产按钮（§6.2）                                                 | **不门控**（G4：Work 不经 LLM 工具，对齐 Chat 资产 App UI 策略）。按钮显隐只看候选稿存在 + 未 applied                                                                                                                 |

---

## 2. 背景与当前状态

### 2.1 已就绪基座（全部复用，不新建）

| 能力                                                       | 位置                                                                                                          | 状态                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkArtifact Service（apply + work.artifact_applied 事件） | [artifact.ts](packages/core/src/session/artifact.ts)                                                          | ✅ M1 已实现；注释 :16-17 明确"保留供 M2 存为资产消费"                                                                                                                                                                                                      |
| Work 候选稿提取                                            | [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts)                                   | ✅ `findLatestAssistantMarkdown` + `draftFilename`（首行标题 -> 文件名）                                                                                                                                                                                    |
| Work 右栏 Artifact Tab                                     | [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx) :68                                 | ✅ M1 已实现 WorkArtifactContent（候选预览 + apply 按钮 + 冲突 dialog）                                                                                                                                                                                     |
| prompt 资产 Schema（Name/Description/Template/Candidate）  | [prompt-asset.ts](packages/schema/src/prompt-asset.ts)                                                        | ✅ Template branded 1-100000 bytes；Candidate.make                                                                                                                                                                                                          |
| PromptAssetService（propose/apply/delete）                 | [prompt-asset-service.ts](packages/core/src/prompt-asset-service.ts) :132-135                                 | ✅ apply 从 `candidate.name` 计算 relativePath（:207），不用传入 relativePath；完整事务模式（InvalidCandidate/StaleRevision/OverwriteRequired 等错误）                                                                                                      |
| prompt-asset HTTP API（list/content/apply/delete）         | [groups/prompt-asset.ts](packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts) :49-86 | ✅ 已注册                                                                                                                                                                                                                                                   |
| propose candidate store（全局 store）                      | [prompt-asset-store.ts](packages/app/src/components/chat/prompt-asset-store.ts)                               | ✅ `setProposeCandidate`/`useProposeCandidate`/`clearProposeCandidate`/`setApplying`/`setApplied`。**CandidateInfo 必含 `content` + `status` 字段**（见下行）                                                                                               |
| CandidateInfo 归一化（7 类 kind 判别联合）                 | [prompt-asset-candidate.ts](packages/app/src/components/chat/prompt-asset-candidate.ts) :9-25/:42-48/:166     | ✅ `CandidateBase` 含 name/description/**content**/relativePath/exists/revision/nameConflict/pathConflict/**status**；`status` 由 `statusFrom(exists, nameConflict, pathConflict)` 派生（"valid"/"conflict"/"exists"）；prompt kind 的 `content = template` |
| Chat 右栏候选审查 UI                                       | [chat-right-panel.tsx](packages/app/src/components/chat/chat-right-panel.tsx) :36                             | ✅ `useProposeCandidate()` 读取后自动渲染候选 + apply 按钮；`:165` `if (!c?.exists) return null`--exists=false 时不读 relativePath 做 diff，空 relativePath 安全                                                                                            |
| applyAssetCandidate（7 类 apply）                          | [asset-insert.ts](packages/app/src/components/chat/asset-insert.ts) :42                                       | ✅ prompt kind 分支 `client.promptAsset.apply({ ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } })`（末尾 return）                                                                                                   |
| Chat ImportDialog                                          | [chat-import-dialog.tsx](packages/app/src/components/chat/chat-import-dialog.tsx)                             | ✅ 资产导入对话框（参考）                                                                                                                                                                                                                                   |
| mode 切换                                                  | [mode.tsx](packages/app/src/context/mode.tsx) :69-70                                                          | ✅ `useMode()` 返回 `{ currentMode, setCurrentMode }`；setCurrentMode 切换模式                                                                                                                                                                              |

### 2.2 需新建/修改

| 交付物                                  | 位置                                                                                                                 | 动作                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Work 候选稿 -> CandidateInfo 映射纯函数 | `packages/app/src/pages/work-asset-capture.ts`                                                                       | 新增：`captureWorkArtifactAsCandidate(content, title?)` -> prompt kind CandidateInfo（含 content + status） |
| "存为资产"按钮                          | [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx) WorkArtifactContent                        | 修改：与"应用到当前项目"并列加按钮；点击 -> 映射 + setProposeCandidate + showToast（不自动切 mode，见 D5）  |
| i18n 文案                               | [en.ts](packages/app/src/i18n/en.ts) + [zh.ts](packages/app/src/i18n/zh.ts) + [zht.ts](packages/app/src/i18n/zht.ts) | 修改：`work.asset.save` / `work.asset.save.success` 文案                                                    |

---

## 3. 范围与设计决策

### 3.1 D1：资产类型 = prompt 资产

Work 候选稿是 Markdown 文档，映射为 prompt 资产最自然：

- `kind = "prompt"`
- `template = 候选稿正文`（1-100000 bytes，PromptAsset.Template branded 约束）
- `name = 首行标题`（draftFilename 已派生逻辑，复用）
- `description = 首段摘要`（候选稿第一段，截断 300 chars，PromptAsset.Description 约束）

**依据**：M1 计划 §3.5 D4 已定"prompt 资产仅 template，无 questions/artifact 契约"。Work 产出是纯文档，不需要 skill/mcp/command/agent/workflow/plugin 的结构化字段。

### 3.2 D2：复用 Chat propose candidate store + 审查 UI + apply

**不新建**任何审查/apply 代码，全链路复用 Chat：

```
Work 点"存为资产"
  -> captureWorkArtifactAsCandidate(content) 构造 CandidateInfo（kind=prompt, content=template, status="valid"）
  -> setProposeCandidate(sessionID, candidate)  // 注入全局 store
  -> showToast(work.asset.save.success)  // 引导用户手动切 Chat（D5：不自动切 mode）
  -> 用户手动切 Chat -> Chat 右栏（chat-right-panel.tsx:36 useProposeCandidate）渲染候选审查 UI
  -> 用户确认 -> applyAssetCandidate(client, { sessionID, candidate, overwrite })
  -> SDK client.promptAsset.apply -> PromptAssetService.apply（从 name 计算 relativePath 落盘）
  -> clearProposeCandidate
```

**理由**：极致减法。Chat 已有完整的 propose -> store -> 审查 -> apply 链路（M1-M7 打磨过），Work 重复造轮子会双源真相。Work 只做"按钮 + 映射 + 注入 + toast 引导"（不自动切 mode，见 §3.5 D5）。

### 3.3 D3：propose 策略 - 直接构造 CandidateInfo

**现状**：Chat 的 propose 流程是 LLM 调 propose_prompt_asset 工具 -> PromptAssetService.propose -> 返回 ProposeResult（含 relativePath/exists/revision/nameConflict/pathConflict）-> normalizeProposeCandidate -> setProposeCandidate。审查 UI 依赖 status/content 字段展示。

**M2 决策**：Work **不调 propose**，直接构造完整 CandidateInfo（含 content + status，relativePath 留空），setProposeCandidate。apply 时由 PromptAssetService.apply 从 name 计算 relativePath 落盘，冲突由 OverwriteRequiredError 兜底。

**代码验证（审批确认可行）**：

- [prompt-asset-service.ts:207-211](packages/core/src/prompt-asset-service.ts) apply 用 `PromptAssetPath.nameToRelativePath(input.candidate.name)` 计算路径，**不用传入的 relativePath**
- [chat-right-panel.tsx:165](packages/app/src/components/chat/chat-right-panel.tsx) `if (!c?.exists) return null`--exists=false 时不读 relativePath 做 diff
- [asset-insert.ts](packages/app/src/components/chat/asset-insert.ts) 末尾 prompt 分支传 `relativePath: candidate.relativePath`（空字符串），apply 端忽略，安全

**方案对比**：

| 方案          | 做法                                               | 优点                     | 缺点                                                           |
| ------------- | -------------------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| **A（采用）** | Work 直接构造 CandidateInfo，不调 propose          | 零新 HTTP 端点；复用最大 | 审查 UI 无冲突预检信息（apply 时 OverwriteRequiredError 兜底） |
| B             | 新增 HTTP propose 端点，Work 调 propose 拿冲突信息 | 审查 UI 有完整冲突预检   | 需加 HTTP 端点 + SDK 重gen；新增负债                           |

**选 A 的协议依据**：CLAUDE.md「以创造接口为耻，以复用现有为荣」+「新增即负债」。方案 B 新增 HTTP 端点 + SDK 重gen 是负债，方案 A 复用现有 setProposeCandidate + applyAssetCandidate。

**技术债声明**（方案对冲要求）：方案 A 无冲突预检，apply 时才发现同名冲突由 OverwriteRequiredError 触发 Chat 右栏覆盖确认（已有逻辑）。无 relativePath 预览（用户在 Chat 右栏看不到"将保存到 xxx"路径）。

### 3.4 D4：按钮位置 = 右栏 Artifact Tab

"存为资产"按钮放 WorkArtifactContent（work-artifact-panel.tsx:68），与"应用到当前项目"按钮并列。不放消息流下方--M1 已定右栏 Artifact Tab 是 Work 产出的唯一聚集地，消息下方按钮会重复。

**按钮显隐**（不门控，对齐 G4）：

- 候选稿存在（`candidate() !== null`）时显示
- 未 applied（`!appliedCurrent()`）时显示
- applied 后隐藏或变为"已应用"

### 3.5 D5：跨 mode 路由 = setProposeCandidate（不自动切 mode）

点击"存为资产"：

1. `captureWorkArtifactAsCandidate(content)` 构造 CandidateInfo
2. `setProposeCandidate(sessionID, candidate)` 注入全局 store
3. `showToast(work.asset.save.success)` 提示用户切换 Chat 模式查看审查
4. 用户手动切 Chat -> 右栏自动读取 useProposeCandidate 显示候选
5. 用户 apply 后 `clearProposeCandidate`

**实现约束（审批修订，原计划自动切 mode）**：不调 `mode.setCurrentMode("chat")`。根因：session 页以 `session.mode` 为权威，app.tsx session effect 会把 mode 锁回 session.mode（自动切 chat 会被覆盖，无效操作）。替代方案：ChatRightPanel 是 render-all 常驻（`display:none` 时 DOM 已渲染），store 注入后审查 UI 自动出现在 DOM（e2e `toBeAttached` 验证）；work mode 下审查 UI 不可见，靠 toast（`work.asset.save.success`）引导用户手动切 Chat。

**mode 切换 API**：`useMode().setCurrentMode`（[mode.tsx:70](packages/app/src/context/mode.tsx)）存在但**不调用**（session effect 锁回）。**不可新建路由**。

### 3.6 D6：不门控

**决策**：Work 存为资产按钮**不门控**（审批推翻原"复用 Flag"决策）。

**根因追溯**（CLAUDE.md「拒绝表面回答 -> 追溯根因」）：

- Flag `AIGCFROGE_EXPERIMENTAL_CHAT_ASSET` 的门控对象是 **Core 端 LLM propose 工具注册**（[propose-prompt-asset.ts:26](packages/core/src/tool/propose-prompt-asset.ts) `if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return`）
- Work 存为资产**不经 LLM 工具**（App 端直接构造 CandidateInfo + setProposeCandidate）
- Chat 资产 App UI（AssetWorkbench / chat-right-panel 审查 / applyAssetCandidate）均不经 Flag（grep App 端无 Flag 读取先例）
- Work 按钮与 Chat 资产 App UI 同层 -> 不门控

**影响**：按钮显隐只看候选稿存在 + 未 applied，不读 Flag。

---

## 4. 关键设计

### 4.1 用户主流程

```
用户在 Work 会话生成候选稿（M1 流程）
  -> 右栏 Artifact Tab 显示候选预览 + "应用到当前项目" + "存为资产"按钮
  -> 用户点"存为资产"
  -> captureWorkArtifactAsCandidate(content) 构造 prompt kind CandidateInfo（content=template, status="valid"）
  -> setProposeCandidate(sessionID, candidate)
  -> showToast（引导用户切 Chat，D5：不自动切 mode）
  -> 用户手动切 Chat -> Chat 右栏显示候选审查 UI（名称/描述/模板预览/apply 按钮，status="valid" 分支）
  -> 用户审查 -> 点 apply
  -> applyAssetCandidate -> client.promptAsset.apply -> PromptAssetService.apply（从 name 计算 relativePath）-> 落盘到当前 Location
  -> clearProposeCandidate
  -> 新会话可在 Chat 资产工作室看到该 prompt 资产 -> 插入 Composer 复用
```

### 4.2 映射纯函数（work-asset-capture.ts）

```ts
import type { CandidateInfo } from "@/components/chat/prompt-asset-candidate"

/** 从候选稿首行 # 标题提取资产名；无标题返回 null。 */
function extractTitle(content: string): string | null {
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("# "))
  return firstLine?.replace(/^#\s+/, "").trim() ?? null
}

/** 从候选稿首段（标题后第一段非空文本）提取摘要，截断 maxLen chars。 */
function extractSummary(content: string, maxLen: number): string {
  const body = content.replace(/^#\s+.*/m, "").trim()
  const firstPara =
    body
      .split(/\n\s*\n/)[0]
      ?.replace(/\n/g, " ")
      .trim() ?? ""
  return firstPara.length > maxLen ? firstPara.slice(0, maxLen - 1) + "…" : firstPara
}

/**
 * Work 候选稿 -> prompt 资产 CandidateInfo（D3 方案 A：不调 propose）。
 * CandidateInfo = CandidateBase & CandidateByKind：
 * - CandidateBase 必含 content（展示文本，prompt kind = template）+ status（statusFrom 派生）
 * - CandidateByKind prompt: { kind: "prompt", candidate: Omit<PromptAssetCandidate, "relativePath"> }
 * - relativePath 留空：apply 从 name 计算路径（prompt-asset-service.ts:207），空安全
 */
export function captureWorkArtifactAsCandidate(content: string): CandidateInfo {
  const title = extractTitle(content) ?? "Work 产出"
  const description = extractSummary(content, 300) || "From Work session"
  return {
    // CandidateBase
    name: title,
    description,
    content, // prompt kind: content = template = 候选稿正文
    relativePath: "", // apply 从 name 计算路径，空安全（chat-right-panel.tsx:165 exists=false 不读）
    exists: false,
    revision: null,
    nameConflict: false,
    pathConflict: false,
    status: "valid", // statusFrom(false, false, false) = "valid"
    // CandidateByKind (prompt)
    kind: "prompt",
    candidate: {
      kind: "prompt",
      name: title,
      description,
      template: content, // Omit<PromptAssetCandidate, "relativePath">：不含 relativePath
    },
  }
}
```

**归并机会（极致减法）**：`extractTitle` 与 [draftFilename](packages/app/src/pages/work-artifact-extract.ts) 的首行 # 标题提取逻辑重复。实施时可提取共享 helper `extractFirstHeading(markdown): string | null`，draftFilename 和 extractTitle 都复用。

### 4.3 按钮集成（work-artifact-panel.tsx）

在 WorkArtifactContent（:68）的"应用到当前项目"按钮旁加"存为资产"按钮：

```tsx
;<Show when={candidate() !== null && !appliedCurrent()}>
  <button type="button" data-component="work-save-asset-button" onClick={onSaveAsset}>
    {language.t("work.asset.save")}
  </button>
</Show>

const onSaveAsset = () => {
  const id = sessionId()
  const content = candidate()
  if (!id || !content) return
  const candidateInfo = captureWorkArtifactAsCandidate(content)
  if (!candidateInfo) return // 空/超长返回 null（No Null Pointer）
  setProposeCandidate(id, candidateInfo)
  showToast({ title: language.t("work.asset.save.success") }) // D5：不自动切 mode，靠 toast 引导
}
```

**显隐条件**（D6 不门控）：`candidate() !== null && !appliedCurrent()`，不读 Flag。

### 4.4 不改的链路（复用验证点）

- Chat 右栏审查 UI（[chat-right-panel.tsx:36](packages/app/src/components/chat/chat-right-panel.tsx)）已读 useProposeCandidate，Work 注入后自动显示；`:165` exists=false 时不读 relativePath，空字段安全
- applyAssetCandidate（[asset-insert.ts](packages/app/src/components/chat/asset-insert.ts) 末尾）prompt kind 分支已支持
- PromptAssetService.apply（[prompt-asset-service.ts:207](packages/core/src/prompt-asset-service.ts)）从 name 计算 relativePath，已有 OverwriteRequiredError 冲突处理
- SDK client.promptAsset.apply 已生成

---

## 5. 阶段划分（TDD：红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。对齐 [M1 TDD 手册](work-mode-m1-tdd-prompt.md) §5 范式。

### Phase A - 候选映射（估时 1d）

| 步骤     | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 新建 `packages/app/src/pages/work-asset-capture.test.ts`：`captureWorkArtifactAsCandidate` 对含标题/无标题/超长描述/空内容的候选稿，产出**完整合法** CandidateInfo（kind=prompt，name ≤80 code points，description ≤300，template 1-100000 bytes，**content=template**，**status="valid"**，relativePath=""，exists=false，revision=null，candidate 不含 relativePath）。类型对齐 CandidateInfo（CandidateBase & CandidateByKind prompt） |
| **绿**   | 实现 `work-asset-capture.ts`（extractTitle + extractSummary + captureWorkArtifactAsCandidate，含 content + status 字段）                                                                                                                                                                                                                                                                                                                  |
| **重构** | extractTitle 与 work-artifact-extract.ts 的 draftFilename 首行提取归并为共享 helper `extractFirstHeading`                                                                                                                                                                                                                                                                                                                                 |
| **退出** | `bun --cwd packages/app test` 绿；`bun --cwd packages/app typecheck`（tsgo -b）绿                                                                                                                                                                                                                                                                                                                                                         |

### Phase B - 存为资产按钮 + 跨 mode 路由（估时 2d）

| 步骤     | 内容                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 组件测试：WorkArtifactContent 在候选存在 + 未 applied 时显示"存为资产"按钮；applied 后隐藏；点击后调用 setProposeCandidate + showToast。**不测 Flag**（D6 不门控）；**不调 setCurrentMode**（D5：session effect 锁回） |
| **绿**   | work-artifact-panel.tsx 加按钮（Show 守卫 + onSaveAsset 回调）；接入 prompt-asset-store.setProposeCandidate + showToast（work.asset.save.success）                                                                     |
| **重构** | onSaveAsset 顺序：构造 -> null 守卫 -> setProposeCandidate -> showToast；不调 setCurrentMode（session effect 锁回，见 §3.5 D5）                                                                                        |
| **退出** | 组件测试绿；点击后 Chat 右栏能读到 candidate（store 注入验证）                                                                                                                                                         |

### Phase C - 审查集成验证（估时 1d）

| 步骤     | 内容                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **红**   | 集成测试：Work 注入 candidate（status="valid", relativePath=""）-> 切 chat -> chat-right-panel 渲染候选（status="valid" 分支显示 apply 按钮，名称/描述/模板预览）-> apply -> PromptAssetService.apply 落盘（从 name 计算路径）-> clearProposeCandidate |
| **绿**   | 验证 chat-right-panel 对 Work 来源 candidate（空 relativePath + status="valid"）渲染正常；若有缺陷修补（应无需改，:165 exists=false 不读 relativePath）                                                                                                |
| **重构** | 确认 applyAssetCandidate prompt kind 分支已支持（asset-insert.ts 末尾已有）                                                                                                                                                                            |
| **退出** | Work -> Chat 审查 -> apply 端到端通；apply 按钮可见（status="valid" 分支命中）                                                                                                                                                                         |

### Phase D - 端到端（估时 1.5d）

| 步骤     | 内容                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红**   | 新建/扩展 `packages/app/e2e/` spec：Work 选预设 -> 生成候选 -> 点"存为资产" -> 切 Chat -> 审查（status="valid" + apply 按钮可见）-> apply -> Chat 资产工作室列表出现该 prompt 资产 -> 新会话插入 Composer 复用 |
| **绿**   | 端到端联调；修 mode 切换、store 时序问题                                                                                                                                                                       |
| **重构** | E2E 复用现有 mock-server fixture（参考 session-todo-progress.spec.ts）                                                                                                                                         |
| **退出** | 端到端通过；资产落盘可复用                                                                                                                                                                                     |

### Phase E - 打磨（估时 1d）

| 步骤      | 内容                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **红/绿** | i18n：en + zh + zht 补 `work.asset.save`/`work.asset.save.success`（**parity.test.ts 约束 en/zh/zht 三 locale**）；埋点 `work_asset_saved` 事件（对齐 work.artifact_applied 事件定义范式 [artifact.ts:32-40](packages/core/src/session/artifact.ts)）；测试补齐 |
| **退出**  | `tsgo -b`（app）+ `bun run lint` + 全包 test 绿；parity 通过；改完即审 7 步全过                                                                                                                                                                                 |

---

## 6. 关键文件

| 文件                                                                                                                 | 动作         | 说明                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/pages/work-asset-capture.ts`                                                                       | 新增         | captureWorkArtifactAsCandidate 纯函数 + extractTitle/extractSummary（含 content + status 字段）                 |
| `packages/app/src/pages/work-asset-capture.test.ts`                                                                  | 新增         | 映射纯函数单测（TDD 红测试，验证 CandidateInfo 完整字段）                                                       |
| [work-artifact-panel.tsx](packages/app/src/pages/work-artifact-panel.tsx)                                            | 修改         | WorkArtifactContent 加"存为资产"按钮（Show 守卫 + onSaveAsset：setProposeCandidate + showToast，不自动切 mode） |
| [work-artifact-extract.ts](packages/app/src/pages/work-artifact-extract.ts)                                          | 修改（可选） | 若 extractFirstHeading 归并，draftFilename 复用                                                                 |
| [en.ts](packages/app/src/i18n/en.ts) + [zh.ts](packages/app/src/i18n/zh.ts) + [zht.ts](packages/app/src/i18n/zht.ts) | 修改         | `work.asset.*` 文案                                                                                             |
| [prompt-asset-store.ts](packages/app/src/components/chat/prompt-asset-store.ts)                                      | 验证         | 确认 setProposeCandidate 接受 Work 构造的 CandidateInfo（应无需改）                                             |
| [chat-right-panel.tsx](packages/app/src/components/chat/chat-right-panel.tsx)                                        | 验证         | 确认 Work 来源 candidate（status="valid", relativePath=""）渲染正常（应无需改，:165 exists=false 不读路径）     |
| [asset-insert.ts](packages/app/src/components/chat/asset-insert.ts)                                                  | 验证         | 确认 applyAssetCandidate prompt kind 分支（末尾已有）                                                           |
| [mode.tsx](packages/app/src/context/mode.tsx)                                                                        | 验证         | 确认 session effect 锁回 session.mode（D5：M2 不调 setCurrentMode）                                             |

**不改的文件**（复用）：

- [artifact.ts](packages/core/src/session/artifact.ts)（WorkArtifact Service，M1 不变）
- [prompt-asset-service.ts](packages/core/src/prompt-asset-service.ts)（PromptAssetService，复用 apply，apply 从 name 计算路径）
- [prompt-asset.ts](packages/schema/src/prompt-asset.ts)（Schema，不改）
- [groups/prompt-asset.ts](packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts)（HTTP API，不改）
- [propose-prompt-asset.ts](packages/core/src/tool/propose-prompt-asset.ts)（LLM 工具，M2 不经 LLM）
- [prompt-asset-candidate.ts](packages/app/src/components/chat/prompt-asset-candidate.ts)（归一化，不改）
- [flag.ts](packages/core/src/flag/flag.ts)（Flag，M2 不门控，不读）

---

## 7. 测试策略

### 7.1 新建测试

| 测试文件                                            | 覆盖                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/pages/work-asset-capture.test.ts` | captureWorkArtifactAsCandidate 映射（含标题/无标题/超长/空内容 + CandidateInfo 完整字段：content/status/relativePath/exists/revision/candidate 结构） |

### 7.2 扩展现有测试

| 现有测试文件                         | 扩展内容                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| work-artifact-panel 组件测试（若有） | "存为资产"按钮显隐（候选存在 + 未 applied）+ 点击路由（setProposeCandidate + showToast，不调 setCurrentMode） |
| `packages/app/e2e/`                  | Work -> Chat 资产端到端 spec                                                                                  |

### 7.3 命令（CLAUDE.md / AGENTS.md 测试规范，永不从根跑）

```bash
bun --cwd packages/app test
bun --cwd packages/app typecheck       # tsgo -b
bun run lint
```

### 7.4 三模式选择

| 模式        | 用于                                                      |
| ----------- | --------------------------------------------------------- |
| 普通 `it`   | 纯函数单测（captureWorkArtifactAsCandidate 是同步纯函数） |
| `it.effect` | 若涉及 Schema encode/decode 验证                          |
| E2E         | Work -> Chat 端到端                                       |

### 7.5 硬性规则

- 用 `testEffect(...)` 若涉及 Effect；纯函数用普通 `it`
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不复制逻辑
- 禁止 `Effect.sleep(N)` 等 fiber--用 readiness 信号

---

## 8. 验收清单

- [ ] Work 候选稿存在 + 未 applied 时，右栏 Artifact Tab 显示"存为资产"按钮
- [ ] applied 后按钮隐藏
- [ ] 点击"存为资产" -> 构造 prompt kind CandidateInfo（content=template, status="valid"）-> setProposeCandidate
- [ ] 点击后 setProposeCandidate + toast 提示；用户手动切 Chat 后右栏显示候选审查 UI（status="valid" 分支，apply 按钮可见）
- [ ] 用户 apply -> PromptAssetService.apply 从 name 计算 relativePath 落盘到当前 Location
- [ ] apply 后 clearProposeCandidate，Chat 资产工作室列表出现该 prompt 资产
- [ ] 新会话可插入该 prompt 资产到 Composer 复用
- [ ] 候选稿无标题时用通用名（"Work 产出"）
- [ ] description 超长时截断 300 chars
- [ ] CandidateInfo 字段完整（content + status + candidate 不含 relativePath）
- [ ] work-orchestrator 仍无 edit/shell（M2 不改 agent 权限）
- [ ] 埋点 `work_asset_saved` 上报
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck + lint + test 全绿

---

## 9. 估算

| Phase                         | 估时     |
| ----------------------------- | -------- |
| A 候选映射                    | 1d       |
| B 存为资产按钮 + 跨 mode 路由 | 2d       |
| C 审查集成验证                | 1d       |
| D 端到端                      | 1.5d     |
| E 打磨                        | 1d       |
| **总计**                      | **6.5d** |

（M1.5 为 7.5d；M2 复用 Chat 全链路，新建最少，估时略低）

---

## 10. 风险与应对

| 风险                                                                             | 概率 | 影响 | 应对                                                                                    |
| -------------------------------------------------------------------------------- | ---- | ---- | --------------------------------------------------------------------------------------- |
| CandidateInfo 字段构造不完整（漏 content/status）导致 Chat 右栏 apply 按钮不显示 | 中   | 高   | Phase A TDD 红测试验证完整字段；§4.2 已明确 content=template + status="valid"           |
| Chat 右栏对 Work 来源 candidate（空 relativePath + status="valid"）渲染异常      | 低   | 中   | Phase C 集成测试验证；:165 exists=false 不读 relativePath，应安全                       |
| 用户点"存为资产"后不切 Chat 看不到审查 UI（D5 不自动切 mode）                    | 中   | 中   | 已补 toast 引导；ChatRightPanel render-all 保证 store 注入后 DOM 就绪，用户切 Chat 即见 |
| 候选稿超 100000 bytes（PromptAsset.Template 上限）                               | 低   | 低   | 映射时校验，超长提示用户裁剪；M1 候选稿通常远低于上限                                   |
| Work -> Chat 切换后用户丢失 Work 会话上下文                                      | 中   | 中   | 切换前 Work 会话保留（mode 切换不关会话）；用户可切回 Work                              |
| D3 方案 A 无冲突预检，apply 时 OverwriteRequired 体验差                          | 中   | 低   | Chat 右栏已有覆盖确认逻辑（OverwriteRequiredError 触发）；若反馈差，fallback 方案 B     |

---

## 11. 技术债声明

| 负债                                                                                 | 风险                                                                                      | 到期                                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D3 方案 A 不调 propose，无冲突预检                                                   | apply 时才发现同名冲突，体验略差                                                          | 若用户反馈，升级方案 B（加 HTTP propose 端点）                                                             |
| D3 方案 A 无 relativePath 预览                                                       | 用户在 Chat 右栏看不到"将保存到 xxx"路径                                                  | 可接受（apply 从 name 计算路径，落盘后资产列表可见）                                                       |
| Work -> Chat 切换是单向路由（无"返回 Work"按钮）                                     | 用户需手动切回 Work                                                                       | M3 或 UX 迭代时加返回按钮                                                                                  |
| description 摘要用首段截断（启发式）                                                 | 摘要质量依赖候选稿结构                                                                    | 未来可用 LLM 生成摘要（M3+）                                                                               |
| work.asset_saved 在通用 apply 发布（PromptAssetService.apply 是 Chat+Work 共用入口） | Chat apply prompt 资产也触发 work.\* 事件，未来消费者统计 Work 存为资产次数会被 Chat 污染 | 当前无消费者影响为零；未来若有消费者，改名为 `asset.saved`（通用）或加 source 参数区分来源（需 SDK 重gen） |
| D5 不自动切 mode（session effect 锁回 session.mode）                                 | 用户点"存为资产"后需手动切 Chat 才能看到审查 UI                                           | 已补 toast 引导；未来若 session effect 解除，可恢复自动切 mode                                             |

---

## 12. 关联文档

- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - §10.2 存为资产按钮、§6.2 存为资产通道（范围真源）
- [Work 路线图](work-mode-roadmap.md) - §3.4 M2 阶段定义
- [Work M1 计划](work-mode-execution-layer-m1.md) - 前置阶段（候选稿载体 D1/D2）
- [Work M1.5 计划](work-mode-execution-layer-m1.5.md) - 并行阶段（互不依赖）
- [M1 TDD 手册](work-mode-m1-tdd-prompt.md) - TDD 红绿重构范式参考
- [Chat 资产 PRD](../prd/chat-mode-creation-layer.md) - 资产接口真源
- [ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) / [ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md) - 架构边界
