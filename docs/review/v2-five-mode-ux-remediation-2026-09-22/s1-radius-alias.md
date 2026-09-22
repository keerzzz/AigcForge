# S1：radius 真源归并证据

- Slice：S1 `--radius-*` 字面量真源归并
- 基线 SHA：`fc2e53e30`
- 结论：alias 方案通过，保留 `theme.css:45-49` 为唯一字面量真源。

## SPIKE

```text
输入：packages/ui/src/styles/tailwind/index.css
编译：@tailwindcss/node compile + build(["rounded-xs", "rounded-md", "rounded-full"])
结果：
  --radius-* 的 alias 声明先出现；
  theme.css 的 0.125rem / 0.25rem / 0.375rem / 0.5rem / 0.625rem 后出现并赢得 cascade；
  .rounded-md -> var(--radius-md)；
  .rounded-full 仍存在。

Chrome computed style：
{"xs":"0.125rem","sm":"0.25rem","md":"0.375rem","lg":"0.5rem","xl":"0.625rem","roundedMd":"6px","roundedXs":"2px","roundedFull":"3.35544e+07px"}
```

## 门禁

```text
bun --cwd packages/ui typecheck
$ tsgo --noEmit
rc=0

bun --cwd packages/ui test
21 pass, 0 fail, 370 expect() calls

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed: no changed JavaScript or TypeScript files
```

## 数据流复查

`theme.css:45-49` → CSS 构建 cascade → `tailwind/index.css` 注册 radius namespace → `.rounded-*` 工具类 → 组件 class。浏览器计算值等于权威值。

## 未做/偏离

本项只改变真源组织，不改变运行时值，因此没有可满足“先失败”的行为 RED；用构建产物与浏览器计算值代替源码字符串断言，符合修订版 S1 spike 条件。
