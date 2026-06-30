---
name: database
description: "AigcForge database layer — Drizzle ORM + Effect SQLite integration, TypeScript migration system, schema definition conventions, custom column types, and migration lifecycle. Activates when working on Drizzle schema definitions, migration files in packages/core/src/database/migration/, schema.gen.ts, migration.gen.ts, effect-drizzle-sqlite package, or database Layer setup in packages/core/src/database/"
allowed-tools: Read Edit Write Bash Glob Grep
---

# Database (Drizzle + SQLite)

## Essential Principles

### 1. 字段命名用 snake_case，不写列名字符串

Drizzle ORM 定义表时，字段名即列名。使用 snake_case 避免重复写 column name。

```ts
// ✅ Good
const table = sqliteTable("workspace", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  time_created: integer().notNull(),
})

// ❌ Bad — 额外写列名字符串
const table = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

### 2. 迁移用 TypeScript，不用 SQL 文件

每个迁移是一个单独的 `.ts` 文件，导出 `DatabaseMigration.Migration` 兼容对象：

```ts
export default {
  id: "20260630143921_ordinary_vulcan",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE TABLE ...`)
      yield* tx.run(`CREATE INDEX ...`)
    })
  },
} satisfies DatabaseMigration.Migration
```

- `id` = 时间戳 `YYYYMMDDHHMMSS` + 随机英文名（`kebab_case`）
- `up` 接收 `tx: Transaction`，返回 `Effect.Effect<void, unknown>`
- 禁止 `down`，SQLite 不支持 DDL 事务回滚

### 3. Schema 引导 + 增量迁移

- `schema.gen.ts` 包含完整的基础 DDL（首次创建数据库时一次性执行）
- `migration.gen.ts` 自动 import 所有 `migration/*.ts` 并按顺序执行
- 迁移系统检测 `session` 表是否存在来判断是否需走 `applyOnly()`（增量迁移）

### 4. 所有数据库操作通过 Effect Drizzle 接口

不直接使用原始 SQLite driver。通过 `EffectDrizzleSqlite` 获取类型安全的 `EffectSQLiteDatabase` 实例。

---

## When to Use

- 定义或修改 Drizzle 表 schema
- 添加新迁移文件（`packages/core/src/database/migration/*.ts`）
- 更新 `schema.gen.ts` 或 `migration.gen.ts`
- 调试数据库 Layer（`database.ts` 中的 `layer`、`defaultLayer`）
- 新增自定义列类型（如 `path.ts` 中的 `absoluteColumn`）
- 修改迁移系统逻辑（`migration.ts` 中的 `apply`/`applyOnly`）

## When NOT to Use

- 通用 SQL 查询编写（不涉及 Drizzle schema 或迁移）
- 非 SQLite 数据库操作
- `effect-drizzle-sqlite` 包本身的 API 设计（涉及 Drizzle 库升级）

---

## Architecture

```text
packages/core/src/database/
├── database.ts          -- Layer 定义、PRAGMA 配置、path 推导
├── migration.ts         -- 迁移引擎 (apply/applyOnly, Semaphore 锁)
├── migration.gen.ts     -- 自动生成的 migrations import 列表
├── schema.gen.ts        -- 基础 DDL（首次建表）
├── schema.sql.ts        -- Timestamps 通用字段 + sql 辅助
├── path.ts              -- 自定义列类型 (absolute/path/directory/absoluteArray)
└── migration/*.ts       -- 单个迁移文件（按 timestamp 排序）

packages/effect-drizzle-sqlite/   -- Drizzle ORM + Effect SqlClient 桥接
└── src/
    ├── effect-sqlite/driver.ts   -- EffectSQLiteDatabase 类
    ├── effect-sqlite/session.ts  -- Effect 感知的 Session
    └── up-migrations/            -- Drizzle 原生的迁移表升级逻辑
```

---

## Phase 1: Schema 定义

**Entry**: 需要新建或修改表定义

**Actions**:

1. 打开 `schema.gen.ts` 找到对应表的 CREATE TABLE 语句
2. 字段名用 snake_case
3. 时间戳字段复用 `Timestamps`：`...Timestamps` (来自 `schema.sql.ts`)
4. 外键用 `CONSTRAINT fk_xxx FOREIGN KEY (...) REFERENCES table(col) ON DELETE ...` 语法
5. 添加索引时紧跟 CREATE TABLE 语句之后

**Exit**: DDL 定义完成，确认所有表和字段命名符合 snake_case 规范

## Phase 2: 创建迁移文件

**Entry**: schema DDL 变更确定，需要创建迁移

**Actions**:

1. 在 `packages/core/src/database/migration/` 下创建 `YYYYMMDDHHMMSS_name.ts`
2. 文件名必须唯一且按时间排序
3. 迁移内容：
   - `id` = 文件名（不含 `.ts`）
   - `up(tx)` = Effect.gen 包裹的 SQL 执行
   - 每个 DDL 操作一个 `yield* tx.run(...)`
4. 单个字段变更（新增列）用 `ALTER TABLE ... ADD COLUMN`，index 用 `CREATE INDEX`

**Exit**: 迁移文件创建完成，符合标准模板

## Phase 3: 注册迁移

**Entry**: 迁移文件已创建

**Actions**:

1. 在 `migration.gen.ts` 末尾添加新的 `import("./migration/YYYYMMDDHHMMSS_name")`
2. 确保 import 顺序与文件名时间戳顺序一致（在已有的 `migration.gen.ts` 中按排序追加）

**Exit**: `migration.gen.ts` 已更新

## Phase 4: 验证

**Entry**: schema + migration 完成

**Actions**:

1. 运行 `bun --cwd packages/core typecheck`
2. 运行 `bun --cwd packages/core test`（至少包含数据库相关测试）
3. 确认新的数据表/列名在已有代码中没有引用旧的命名

**Exit**: 数据库变更验证通过

---

## Quick Reference

### 数据库 Layer 配置

```ts
// database.ts — 自动推导 DB 路径
// 优先级：Flag.AIGCFROGE_DB → 按 channel 分路径 → 默认 aigcfroge.db
// PRAGMA 固定值：
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
PRAGMA cache_size = -64000   // 64MB
PRAGMA foreign_keys = ON
```

### 自定义列类型 (path.ts)

| 类型 | 用途 | 行为 |
|---|---|---|
| `absoluteColumn` | 存储绝对路径 | 验证 isAbsolute，Windows 路径归一化 |
| `directoryColumn` | 存储目录路径 | 允许空字符串（兼容旧数据），否则验证 absolute |
| `pathColumn` | 存储路径（无校验） | 仅做 storage path 转换（Win → POSIX） |
| `absoluteArrayColumn` | 绝对路径数组 | JSON 序列化/反序列化 |

### 迁移文件模板

```ts
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "YYYYMMDDHHMMSS_descriptive_name",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`-- SQL here`)
      yield* tx.run(`-- More SQL`)
    })
  },
} satisfies DatabaseMigration.Migration
```

### 迁移生命周期

```text
apply(db)
  ├── 检查 sqlite_master 中是否有 session 表
  │   ├── 有 → applyOnly(db, migrations)  // 增量运行未执行的迁移
  │   └── 无 → check 是否有其他表
  │       ├── 有 → Effect.die("Database is not empty")
  │       └── 无 → 执行 schema.gen.ts 全量 DDL → 记录所有 migration 为已完成
  └── 使用 Semaphore 锁确保单进程执行

applyOnly(db, migrations)
  ├── 读取 migration 表中已完成的 id
  ├── 兼容 __drizzle_migrations 表（旧版 Drizzle SQL 迁移）
  └── 逐个执行未完成的 migration（每个在 transaction 内）
```

### 关键类型

| 类型 | 来源 | 用途 |
|---|---|---|
| `DatabaseMigration.Migration` | `migration.ts` | `{ id: string, up: (tx) => Effect }` |
| `EffectDrizzleSqlite.EffectSQLiteDatabase` | `effect-drizzle-sqlite` | 类型安全 DB 实例 |
| `Transaction` | `migration.ts` line 10 | migration 内 `tx.run(...)` 类型 |
| `Service` (Database) | `database.ts` | `{ db: DatabaseShape }` |
| `AbsolutePath` | `schema.ts` Brand | 标记的绝对路径类型 |

### 文件位置

| 路径 | 内容 |
|---|---|
| `packages/core/src/database/database.ts` | Database Layer、PRAGMA、路径推导 |
| `packages/core/src/database/migration.ts` | 迁移引擎（apply/applyOnly） |
| `packages/core/src/database/migration.gen.ts` | 迁移文件自动注册 |
| `packages/core/src/database/schema.gen.ts` | 基础 DDL (首次建表) |
| `packages/core/src/database/schema.sql.ts` | `Timestamps` 辅助字段 |
| `packages/core/src/database/path.ts` | 自定义列类型 |
| `packages/core/src/database/migration/*.ts` | 单个迁移文件 |
| `packages/effect-drizzle-sqlite/src/` | Drizzle-Effect 桥接层 |
| `packages/core/schema.json` | Drizzle Kit schema 快照 |

## Success Criteria

- [ ] 所有表字段使用 snake_case 命名
- [ ] 迁移文件 id = 文件名（不含 `.ts`），按时间排序
- [ ] `migration.gen.ts` 的 import 顺序与文件时间戳一致
- [ ] typecheck 通过（`bun --cwd packages/core typecheck`）
- [ ] 测试通过（`bun --cwd packages/core test`）
- [ ] 迁移引擎验证：现有的 session 表数据不丢失
