---
name: drizzle-kit push UNIQUE-on-populated-table prompt
description: Why adding a UNIQUE constraint via drizzle-kit push breaks non-interactive schema sync, and the structural-uniqueness workaround.
---

# drizzle-kit push blocks on adding UNIQUE to a table with rows

Adding a `.unique()` column/constraint to an already-populated table makes
`drizzle-kit push` emit an interactive prompt ("...contains N items. If this
statement fails... Do you want to truncate <table>?"). In a non-TTY shell (our
`pnpm --filter @workspace/db run push`, CI, and production deploys) it throws
`Interactive prompts require a TTY terminal` and the whole push fails.

**Why this matters:** this repo has NO versioned migrations and NO automated prod
migration hook — schema is synced only via `drizzle-kit push`. So a change that
only pushes interactively is not portable to prod.

**How to apply / options when you hit it:**
- If uniqueness is *structurally guaranteed* (e.g. a value derived
  deterministically from an identity/serial column that never repeats), just DROP
  the `.unique()` from the Drizzle schema. Uniqueness holds without the
  constraint and push runs clean. (This is what the `account_id` / `account_seq`
  columns do.)
- Adding a plain (non-unique) index does NOT trigger the prompt — indexes are
  non-destructive.
- `drizzle-kit push --force` (`push-force` script) auto-answers prompts, but for
  a truncate prompt that can mean data loss — do not use it to force a UNIQUE add
  on real data.
- For a truly-needed UNIQUE on populated data, apply it with a raw
  `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` via psql instead of push (but then
  the Drizzle schema and DB drift unless the schema also declares it).
