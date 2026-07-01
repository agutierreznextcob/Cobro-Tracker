---
name: Landing page routing (root "/")
description: The root route always shows the marketing landing; it must never auto-redirect authenticated users.
---

# Landing page routing (`/`)

The root route `/` ALWAYS renders the marketing landing page, for both anonymous
and authenticated users. It must NOT auto-redirect a logged-in user to
`/dashboard`.

**Why:** users (including authenticated ones) need to reach the public marketing
site — pricing, "cómo funciona", legal links, sales chat — at nextcob.com. An
earlier version redirected authenticated sessions from `/` straight to
`/dashboard`, which made the landing unreachable while logged in. Removed.

**How to apply:** access control lives on the protected routes, not on `/`.
`/dashboard` (and other app routes) are wrapped in their own auth guard that
redirects unauthenticated users to login. Do not reintroduce an auth-based
redirect inside the landing page component.
