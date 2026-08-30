---
name: OpenAPI date coercion
description: Non-obvious runtime semantics of generated Zod validators for OpenAPI date fields.
---

OpenAPI fields with `format: date` or `format: date-time` are generated as coercing Zod date validators, so validated route data contains `Date` objects even when clients sent strings.

**Why:** Treating a validated date-only value as a string and appending a time suffix produced an invalid timestamp at runtime despite passing TypeScript checks.

**How to apply:** After codegen, inspect the generated validator and normalize from `Date` semantics in route handlers. For date-only business fields, preserve the intended calendar day explicitly before storing it.