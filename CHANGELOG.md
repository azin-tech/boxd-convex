# Changelog

## 0.1.0 (unreleased)

- First release: create, fork, pause, resume, hibernate, wake, stop, start,
  refresh and destroy boxd machines; run commands; read, write and list files;
  expose ports over HTTPS.
- Machine options: size, `autoSuspendSeconds`, `autoDestroySeconds` and
  `isolated`, for machines that run untrusted code.
- Reactive `machines` and `executions` tables, scoped by `ownerId`.
- Coded `ConvexError`s and `isBoxdError`.
- `BOXD_API_KEY` bound through component env; one cached session token per key
  and endpoint.
