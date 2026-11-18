# P2.2T / S1 验收退回：当前 Panel 的宽度约束

状态：根已完成限定审批；独立子智能体和关联实施会话的只读核对均无阻断。正式派发前仍无开工权。主调度的正式派发消息和[实施者记录](v2-implementation-owner-2026-10-29.json)共同决定写入权。S1 尚未通过，不进入下一实施节。

依据：[唯一现行计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)、[共用底座决定](../research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md)、默认工作区 CLAUDE.md 的共同根因、复用与真实验证规则。用户在本轮真实桌面验收中指出：会话详情左右主区域几乎无法拖动宽度。

## 可复查事实

原生 Electron 窗口为1280×800；已清除 agent-browser 的尺寸模拟。当前右区选中 Prompt proposals，分隔线命中 ResizeHandle，mousedown 后 body.userSelect=none，鼠标移动已进入真实拖拽流程。左区宽度被限制为450–456px，右区至少800px；向右拖100px实际仅变化6px。原生窗口扩大到1440px，同样操作能从456变为556px。证据：`/home/keer/task-backups/shared-foundation-review-20261029/s1-native-divider-check.json`。原生窄屏/尺寸模拟的纠正记录另存 `s1-native-responsive-correction.json`，不能把模拟视口截图当作完整窗口响应式验收。

决定链：

- `runtime/extension/panels.tsx` 的 createRegion：active/byKey 已决定当前真实 RegionEntry；wide 在第231行却扫描所有 region providers。
- `gui-extensions/src/review/renderer.tsx:141`：diffStyle=split 时声明 wide，即使当前显示别的 Panel。
- `session/screen-layout.ts:46`：tabsOpen && input.wide 决定 splitSide。
- `session/session-panel-width.ts:11`：split 最小右区800；普通最小480；左区最小450。1280窗口扣除边距与间隙后只有1256可用，宽度范围因此只剩6px。
- `session/screen.tsx:417` 与 `ui/src/components/resize-handle.tsx` 的事件链确实生效，无需新建分隔组件或修改事件系统。

上述宽度扫描和最小宽度常量与固定上游4617210822bdbb31e5749751afbfb4584ccedac8一致。这不是伪称上游回归：候选面板接入共用宿主后，隐藏的分栏审查持续约束当前内容，是本次需要明确修正的宿主语义。保留分栏审查自己的约束，不对全部模式或所有右区简单放宽常量。

## 限定方案

复用 createRegion 中实际选择的 RegionEntry，仅由当前显示的 provider.wide 决定宽度需求。若为复用而提取 selected memo，应让返回的 selected 和 wide 共用同一决定函数；不得另建选择状态或第二注册器。当前选择、hidden tab、fallback、关闭后回退和懒加载行为继续由原 active/byKey/strip 规则决定。

SDK 的 wide 注释应明确它约束当前显示的 Panel。保留属性类型与调用方式，不新建能力字段。普通面板仍使用原480px约束，分栏Review仍使用800px；左区450px及已保存的用户请求宽度保持原owner，不在切tab时改写用户偏好。切回较宽内容时可以按原clamp临时限制显示宽度，切回普通面板应恢复可用的请求宽度。

对冲方案：直接降低800px、放大拖拽命中区或给候选Panel写例外，都绕过真实owner，不采用。当前方案只收敛“谁提供当前宽度需求”的判定，不修改布局架构。

## 允许文件与保护边界

正式允许文件仅为：

- `packages/app/src/runtime/extension/panels.tsx`：只改 createRegion 的当前选择/宽度判定；保持已通过窄屏修复的 MobilePanel 身份边界。
- `packages/gui-extensions/src/sdk/registries.ts`：只澄清现有 wide 注释，无API类型变更。
- `packages/gui-extensions/README.md`：依该包AGENTS同步wide合同说明，仅这一处相关guide文档。
- `packages/app/e2e/regression/side-panels.spec.ts`：扩展现有keeper，保留原有候选与资产流程断言。

`host-apis.tsx`、原S1 renderer、mobile keeper、timeline fixture、数据库五文件及全部其他WIP冻结。不得顺手改Review宽度常量、ResizeHandle、CSS、依赖、生成物、Core/Server/Client、数据库、资产文件、上述guide之外的文档或账本。默认工作区只读；禁止Git提交/推送/重置、桌面/服务操作。额外必要文件先给具体理由，由根审核。

## 验证与交付

先在当前生产代码下得到真实keeper红证：分栏Review已声明wide但当前为非wide Panel，在1280px桌面下拖动左右主分隔线应获得有效变化；旧全provider扫描应失败。通过公开UI触发真实布局，不修改布局内部状态来伪造结果。复用已有fixture和扩展宿主。

修复后的keeper至少覆盖：普通Panel可拖动；切到split Review仍遵守其800px约束；切回普通Panel保留用户请求宽度；关闭当前Panel由原fallback规则选择后，相应约束更新；重开恢复正确需求，选中Review时split/unified的响应变化仍生效。可在一个连续场景内完成，避免按七类/主题重复复制。若fixture或现实入口限制某个合同，明确回报，不降低断言。

所有包检查串行，使用 `script/bun`、包cwd、workers=1/retries=0。执行受影响side/header keeper、mobile keeper、已有drawer/host/graph与timeline/geometry回归，以及App/E2E类型、格式、原增量lint、修改行lint和GUI SDK文档/guide校验。记录每条命令/cwd/exit/实际计数及其输入源码hash，保留失败日志，不累加不同轮次结果。

生产前基准复用 `benchmark-mobile-after.json` 与 `mobile-source-hashes.json`；根已核3197个生产源文件零变化。实现方交付冻结后停止，根再做同条件生产基准、真正原生窗口1280和断点拖拽、各受影响面板及真实DeepSeek Flash验收。模拟视口只可用于隔离功能测试，不能冒充原生窗口布局证据。

原S1尚待最终子会话/长标题验收；一次真实task调用因既有attended默认路径不受支持而未创建child，未计通过。该链由根使用现有受支持的显式unattended输入复验，不属于本次生产修复范围。
