# S2a：radius 复用证据

- Slice：S2a 107 处无争议映射
- 基线 SHA：`edf0b37a9`
- 结论：S2a 完成；20 处孤儿值未改动。

## RED

新增两份 token-reuse 契约测试，先证明现状不满足统一 owner：

```text
bun --cwd packages/app test:unit:file src/radius-token-usage.test.ts
FAIL: mapped app radii use the shared radius utilities

bun --cwd packages/ui test src/v2/components/radius-token-usage.test.ts
FAIL: mapped v2 radii use the shared radius tokens
```

测试头注明：颜色/圆角值相同时，行为测试无法区分硬编码与 token 引用；本测试固定的是 design-system ownership 决策，不是渲染实现文本。

## GREEN

```text
app：2px 1、4px 15、6px 40、8px 6、10px 6、rounded-r-[6px] 1 = 69 处
v2：单角声明 37、四角复合声明 1（映射为 var(--radius-sm) 0 0 var(--radius-sm)） = 38 处
合计 107 处；剩余孤儿值 20 处。
```

验证：

```text
bun --cwd packages/app test:unit:file src/radius-token-usage.test.ts
1 pass, 0 fail

bun --cwd packages/ui test src/v2/components/radius-token-usage.test.ts
22 pass, 0 fail, 371 expect() calls

bun --cwd packages/app typecheck
rc=0

bun --cwd packages/ui typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 全包测试

```text
bun --cwd packages/ui test
22 pass, 0 fail, 371 expect() calls

bun --cwd packages/app test
1102 pass, 2 fail, 5595 expect() calls

失败项：
- src/context/comments.test.ts：beforeEach/afterEach hook timed out
- src/context/permission-identity.test.ts：beforeEach/afterEach hook timed out

两项单独复跑仍分别在 18.7s / 13.0s 超时，和半径改动无调用关系，登记为当前环境基线失败，不冒充本批绿证。
```

## 数据流复查

- app：`theme.css:45-49` → `tailwind/index.css` radius alias → `.rounded-{xs,sm,md,lg,xl}` → 组件 class。
- v2：`theme.css:45-49` → `var(--radius-*)` → v2 component CSS。
- `rounded-full` 保持原生 `.rounded-full`，不属于本批映射。

## 未做/偏离

- 1px / 3px / 12px / 9999px 的 20 处孤儿值未动，留给 S2b。
- 未跑完整五模式 e2e；本批只改确定性圆角值和 token ownership，S2a 的视觉验证另行执行。
