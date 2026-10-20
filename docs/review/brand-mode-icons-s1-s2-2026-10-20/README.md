# brand-mode-icons S1/S2 实施证据（2026-10-20）

实施基线：`main = origin/main = 43997011e`；本批起点 `e02392ce1`；分支 `brand-mode-icons`。
范围依据：[实施计划](../../plan/brand-mode-icons-2026-10-20.md) §3.1/§3.2/§4；S3 保持冻结。

## S1 复查结论

- 影响文件：`packages/ui/src/v2/components/icon.tsx`、`packages/app/src/context/mode.tsx`、`mode.test.ts`、`packages/app/e2e/regression/global-shell.spec.ts`。
- 命中 skills：protocols / reuse-first-refactor / frontend-theming / quality-to-pr / enterprise-code-standard。
- 安全门禁：仅展示层；保留 ARIA、tooltip、badge；无网络、存储、权限接口变更。
- 工程门禁：ui/app 类型检查 exit 0；模式单测 5 pass / 0 fail / 53 expect；e2e 完整 15 passed；增量 lint exit 0；diff check exit 0。
- RED：完整首轮 14 passed / 1 failed（原始临时日志未保留）；生产代码回退复验 1 failed / 1 passed，唯一失败为 Chat 实际 `mode-chat` 与预期 `rail-chat` 不符。内页回归始终为绿。
- GREEN：完整 e2e 15 passed (1.2m)；最终成员守卫修改后定向 e2e 2 passed (35.1s)。详见 logs 原始命令输出。
- 视觉证据：screenshots/s1-icons-light.png 与 s1-icons-dark.png；通过临时 Vite 页面导入真实 `Icon` 和真实 v2 theme CSS，渲染 14/16/20 × 五模式。15 个 DOM 尺寸/href 值见 logs/s1-matrix-light.json；14px Assistant 指向 micro。临时页面已删除。
- 剩余风险：无新增截图基线；仅验证默认 v2 亮/暗主题，未审计全部 37 套主题；全量门禁留到 S4。

### 复用决策

| 候选 | 决定性证据 | 决策 |
| --- | --- | --- |
| 现有 sprite 注册/选择 | icon.tsx 的 ensureSprite 与 Icon；Icon 的成员守卫决定未知键回退 | 扩展注册表；批准的六个符号（五模式 + micro）不改变旧 mode-* 几何 |
| 现有模式注册表 | modeDefinition 在 mode.tsx:60 按 id 查找；ModeSwitcher 在 mode-switcher.tsx:50 消费 icon | 仅改注册表 icon 字段，复用路由与模式状态 |
| 现有 shell fixture/定位器 | global-shell.spec.ts 的 installServerMock 与 modeButton | 复用 mock、英文标签与桌面 viewport；无平行测试实现 |

采用既有 sprite 与 CSS 状态呈现；无需新组件或状态层。无本切片未交付项。

## S2 / S4

待实施。提交清单将在本批收尾从 git log 机械生成。
