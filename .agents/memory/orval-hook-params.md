---
name: Orval hook params — direct args
description: How to pass query params to Orval-generated React Query hooks in this project
---

Orval generates hooks with this signature:
  `useListClientes(params?: ListClientesParams, options?)`
  `useGetDashboardMetrics(params?: GetDashboardMetricsParams, options?)`

The params are passed as the first argument directly, NOT wrapped in `{ params: {} }`. This is the opposite of what you might expect from a generic wrapper pattern.

**Why:** This project uses Orval's `react-query` client mode with a custom fetch, which extracts query params from the first argument and builds the URL query string internally.

**How to apply:**
- Correct: `useListClientes({ q: "search" })`
- Wrong: `useListClientes({ params: { q: "search" } })`
- Correct: `getGetDashboardMetricsQueryKey({ periodo: "mes" })`
- Wrong: `getGetDashboardMetricsQueryKey({ params: { periodo: "mes" } })`
